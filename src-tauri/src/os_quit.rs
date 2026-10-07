//! The quits the OS starts rather than the app's own menu: Dock > Quit (or any
//! other quit Apple event) on macOS, and the end of the session (logout,
//! restart, shutdown) on both platforms. Each reaches the main window's close
//! path (src/hooks/use-window-close.ts), the one place pending work is saved
//! (unsaved-edits-conventions, Quitting).
//!
//! - A quit the user started asks the main window to close, exactly as the
//!   menu's Quit does (`menu::request_quit`), so a save that fails can hold it.
//! - The end of a session never prompts: the window is told to settle its
//!   writes without asking anything, and the session goes on when the window
//!   reports back or when `SESSION_END_WAIT` has passed, whichever is first.
//!
//! tao and Tauri see neither route in time. On macOS both arrive as
//! `terminate:`, and nothing in tao implements `applicationShouldTerminate:`,
//! so the app exited without the webview ever hearing of it; this module adds
//! that method to tao's application delegate. On Windows tao answers
//! WM_ENDSESSION by ending the event loop, so the window is asked earlier, at
//! WM_QUERYENDSESSION, while the session can still wait.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::Duration;

use serde_json::json;
use tauri::AppHandle;
#[cfg(any(target_os = "macos", windows))]
use tauri::Emitter;

use crate::logging;

/// Tells the main window that the session is ending (src/repositories/session-end.ts).
pub const SESSION_ENDING_EVENT: &str = "session-ending";

/// The longest the end of a session waits for the main window. It exceeds the
/// window's own bound (CLOSE_WAIT_MS in src/hooks/use-window-close.ts), so the
/// window can log what it could not save before the session goes on, and stays
/// under the five seconds Windows gives an app to answer the end of a session.
pub const SESSION_END_WAIT: Duration = Duration::from_millis(4000);

static APP: OnceLock<AppHandle> = OnceLock::new();
// True from asking the window to settle until the session is let go.
static SESSION_END_PENDING: AtomicBool = AtomicBool::new(false);

/// Hooks the OS quit routes. Called once, after the main window exists.
pub fn install(app: &AppHandle) {
    if APP.set(app.clone()).is_err() {
        return;
    }
    platform::install(app);
}

/// The main window reports that its writes are settled (or past its bound).
pub fn session_end_settled() {
    release_session("settled");
}

// Asks the main window to settle its writes for the end of the session.
// Returns false when there is no window to ask, so the session goes on at once.
#[cfg(any(target_os = "macos", windows))]
fn begin_session_end(app: &AppHandle) -> bool {
    if SESSION_END_PENDING.swap(true, Ordering::SeqCst) {
        return true;
    }
    logging::info("session ending", json!({}));
    if let Err(error) = app.emit_to("main", SESSION_ENDING_EVENT, ()) {
        logging::warn("session end event failed", json!({ "error": error.to_string() }));
        SESSION_END_PENDING.store(false, Ordering::SeqCst);
        return false;
    }
    true
}

// Lets the session go on, once, whichever of the window's report and the
// bound comes first.
fn release_session(reason: &str) {
    if !SESSION_END_PENDING.swap(false, Ordering::SeqCst) {
        return;
    }
    if reason != "settled" {
        logging::warn("session end went on without the window", json!({ "reason": reason }));
    }
    platform::release();
}

#[cfg(target_os = "macos")]
mod platform {
    use std::ffi::c_void;

    use objc2::runtime::{AnyClass, AnyObject, Bool, Imp, Sel};
    use objc2::{class, msg_send, sel};
    use serde_json::json;
    use tauri::{AppHandle, Manager};

    use super::{begin_session_end, release_session, APP, SESSION_END_WAIT};
    use crate::{logging, menu};

    // NSApplicationTerminateReply.
    const TERMINATE_CANCEL: usize = 0;
    const TERMINATE_NOW: usize = 1;
    const TERMINATE_LATER: usize = 2;

    // keyAEQuitReason: loginwindow sets it on the quit event it sends at
    // logout, restart and shutdown. Dock > Quit sends the event without it.
    const QUIT_REASON: u32 = u32::from_be_bytes(*b"why?");

    #[repr(C)]
    struct DispatchQueue {
        _opaque: [u8; 0],
    }

    extern "C" {
        static _dispatch_main_q: DispatchQueue;
        fn dispatch_async_f(
            queue: *const DispatchQueue,
            context: *mut c_void,
            work: extern "C" fn(*mut c_void),
        );
    }

    pub fn install(_app: &AppHandle) {
        // SAFETY: called on the main thread after tao set its delegate. The
        // method's signature matches its type encoding: an NSUInteger return,
        // self, _cmd and the sender.
        unsafe {
            let ns_app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            let delegate: *mut AnyObject = msg_send![ns_app, delegate];
            if delegate.is_null() {
                logging::warn("quit hook not installed", json!({ "reason": "no application delegate" }));
                return;
            }
            let class = (*delegate).class() as *const AnyClass as *mut AnyClass;
            let method: extern "C-unwind" fn(&AnyObject, Sel, *mut AnyObject) -> usize = should_terminate;
            let added = objc2::ffi::class_addMethod(
                class,
                sel!(applicationShouldTerminate:),
                std::mem::transmute::<_, Imp>(method),
                c"Q@:@".as_ptr(),
            );
            if !added.as_bool() {
                logging::warn("quit hook not installed", json!({ "reason": "method already present" }));
                return;
            }
            // AppKit may note which delegate methods exist when the delegate is
            // set, so it is set again to be seen with this one.
            let _: () = msg_send![ns_app, setDelegate: std::ptr::null_mut::<AnyObject>()];
            let _: () = msg_send![ns_app, setDelegate: delegate];
        }
    }

    extern "C-unwind" fn should_terminate(_this: &AnyObject, _cmd: Sel, _sender: *mut AnyObject) -> usize {
        let Some(app) = APP.get() else {
            return TERMINATE_NOW;
        };
        if app.get_webview_window("main").is_none() {
            return TERMINATE_NOW;
        }
        if session_is_ending() {
            if !begin_session_end(app) {
                return TERMINATE_NOW;
            }
            std::thread::spawn(|| {
                std::thread::sleep(SESSION_END_WAIT);
                release_session("timed out");
            });
            return TERMINATE_LATER;
        }
        logging::info("quit requested by the system", json!({}));
        menu::request_quit(app);
        TERMINATE_CANCEL
    }

    fn session_is_ending() -> bool {
        // SAFETY: AppKit calls applicationShouldTerminate: on the main thread,
        // inside the quit event's handling, where the current event is valid.
        unsafe {
            let manager: *mut AnyObject = msg_send![class!(NSAppleEventManager), sharedAppleEventManager];
            let event: *mut AnyObject = msg_send![manager, currentAppleEvent];
            if event.is_null() {
                return false;
            }
            let reason: *mut AnyObject = msg_send![event, attributeDescriptorForKeyword: QUIT_REASON];
            !reason.is_null()
        }
    }

    // Replying runs AppKit's termination, which reaches tao's event handler
    // (applicationWillTerminate: and then RunEvent::Exit). Queued on the main
    // queue, it runs outside that handler, and also while AppKit waits for the
    // reply in its modal run loop mode.
    pub fn release() {
        // SAFETY: the main queue is a static libdispatch object, and the work
        // function takes no context.
        unsafe { dispatch_async_f(&_dispatch_main_q, std::ptr::null_mut(), reply_terminate) };
    }

    extern "C" fn reply_terminate(_context: *mut c_void) {
        // SAFETY: runs on the main thread, from the main queue.
        unsafe {
            let ns_app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            let _: () = msg_send![ns_app, replyToApplicationShouldTerminate: Bool::YES];
        }
    }
}

#[cfg(windows)]
mod platform {
    use std::ffi::c_void;
    use std::sync::atomic::Ordering;
    use std::time::Instant;

    use serde_json::json;
    use tauri::{AppHandle, Manager};

    use super::{begin_session_end, release_session, APP, SESSION_END_PENDING, SESSION_END_WAIT};
    use crate::logging;

    type Hwnd = *mut c_void;
    type SubclassProc = unsafe extern "system" fn(Hwnd, u32, usize, isize, usize, usize) -> isize;

    // winuser.h.
    const WM_QUERYENDSESSION: u32 = 0x0011;
    const WM_QUIT: u32 = 0x0012;
    const WM_NCDESTROY: u32 = 0x0082;
    const PM_REMOVE: u32 = 0x0001;
    const QS_ALLINPUT: u32 = 0x04FF;
    // Any value unique among this window's subclasses.
    const SUBCLASS_ID: usize = 0x444B;
    // How often the wait looks at the window's report when no message wakes it.
    const POLL_MS: u128 = 50;

    #[repr(C)]
    struct Point {
        x: i32,
        y: i32,
    }

    #[repr(C)]
    struct Msg {
        hwnd: Hwnd,
        message: u32,
        wparam: usize,
        lparam: isize,
        time: u32,
        pt: Point,
        private: u32,
    }

    #[link(name = "comctl32")]
    extern "system" {
        fn SetWindowSubclass(hwnd: Hwnd, subclass: SubclassProc, id: usize, data: usize) -> i32;
        fn RemoveWindowSubclass(hwnd: Hwnd, subclass: SubclassProc, id: usize) -> i32;
        fn DefSubclassProc(hwnd: Hwnd, msg: u32, wparam: usize, lparam: isize) -> isize;
    }

    #[link(name = "user32")]
    extern "system" {
        fn PeekMessageW(msg: *mut Msg, hwnd: Hwnd, min: u32, max: u32, remove: u32) -> i32;
        fn TranslateMessage(msg: *const Msg) -> i32;
        fn DispatchMessageW(msg: *const Msg) -> isize;
        fn MsgWaitForMultipleObjects(
            count: u32,
            handles: *const *mut c_void,
            wait_all: i32,
            milliseconds: u32,
            wake_mask: u32,
        ) -> u32;
        fn PostQuitMessage(code: i32);
    }

    pub fn install(app: &AppHandle) {
        let Some(window) = app.get_webview_window("main") else {
            return;
        };
        let installed = match window.hwnd() {
            // SAFETY: the handle is the live main window's, on its own thread.
            Ok(hwnd) => unsafe { SetWindowSubclass(hwnd.0, subclass, SUBCLASS_ID, 0) != 0 },
            Err(error) => {
                logging::warn("quit hook not installed", json!({ "error": error.to_string() }));
                return;
            }
        };
        if !installed {
            logging::warn("quit hook not installed", json!({ "reason": "SetWindowSubclass failed" }));
        }
    }

    unsafe extern "system" fn subclass(
        hwnd: Hwnd,
        msg: u32,
        wparam: usize,
        lparam: isize,
        _id: usize,
        _data: usize,
    ) -> isize {
        if msg == WM_QUERYENDSESSION {
            if let Some(app) = APP.get() {
                if begin_session_end(app) {
                    wait_for_window();
                }
            }
        }
        if msg == WM_NCDESTROY {
            RemoveWindowSubclass(hwnd, subclass, SUBCLASS_ID);
        }
        DefSubclassProc(hwnd, msg, wparam, lparam)
    }

    // Keeps the window's messages flowing (its writes and its report reach the
    // core through them) until it reports back or the bound passes. Windows
    // waits for this answer before it ends any window's session, so tao's own
    // WM_ENDSESSION handling comes only after it.
    fn wait_for_window() {
        let deadline = Instant::now() + SESSION_END_WAIT;
        // SAFETY: a zeroed MSG is a valid out-parameter, and every message is
        // dispatched on the thread that owns its window.
        unsafe {
            let mut msg: Msg = std::mem::zeroed();
            while SESSION_END_PENDING.load(Ordering::SeqCst) {
                let now = Instant::now();
                if now >= deadline {
                    release_session("timed out");
                    return;
                }
                let wait = (deadline - now).as_millis().min(POLL_MS) as u32;
                MsgWaitForMultipleObjects(0, std::ptr::null(), 0, wait, QS_ALLINPUT);
                loop {
                    if !SESSION_END_PENDING.load(Ordering::SeqCst) {
                        return;
                    }
                    if Instant::now() >= deadline {
                        release_session("timed out");
                        return;
                    }
                    if PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_REMOVE) == 0 {
                        break;
                    }
                    if msg.message == WM_QUIT {
                        PostQuitMessage(msg.wparam as i32);
                        release_session("quit");
                        return;
                    }
                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
        }
    }

    // The wait above watches the flag release_session cleared.
    pub fn release() {}
}

#[cfg(not(any(target_os = "macos", windows)))]
mod platform {
    use tauri::AppHandle;

    pub fn install(_app: &AppHandle) {}

    pub fn release() {}
}
