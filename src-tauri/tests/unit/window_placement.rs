use crate::window_placement::{
    placement_after_close, ClosingState, NormalRectangle, Placement,
};
use tauri::{PhysicalPosition, PhysicalSize, WindowEvent};

fn rectangle(x: i32, y: i32, width: u32, height: u32) -> NormalRectangle {
    NormalRectangle {
        x,
        y,
        width,
        height,
    }
}

#[test]
fn normal_close_replaces_the_complete_rectangle() {
    let closing = rectangle(-900, 40, 900, 1000);
    assert_eq!(
        placement_after_close(
            Some(Placement {
                normal: rectangle(10, 20, 800, 600),
                maximized: true
            }),
            ClosingState::Normal(closing),
            true,
        ),
        Some(Placement {
            normal: closing,
            maximized: false
        })
    );
}

#[test]
fn maximized_close_retains_normal_bounds_and_selects_platform_mode() {
    let previous = Placement {
        normal: rectangle(120, 80, 720, 640),
        maximized: false,
    };
    assert_eq!(
        placement_after_close(Some(previous), ClosingState::Maximized, true),
        Some(Placement {
            normal: previous.normal,
            maximized: true
        })
    );
    assert_eq!(
        placement_after_close(Some(previous), ClosingState::Maximized, false),
        Some(previous)
    );
}

#[test]
fn transient_close_retains_the_whole_record() {
    let previous = Placement {
        normal: rectangle(120, 80, 720, 640),
        maximized: true,
    };
    assert_eq!(
        placement_after_close(Some(previous), ClosingState::Transient, true),
        Some(previous)
    );
}

#[test]
fn normal_geometry_events_replace_the_whole_rectangle_before_maximized_close() {
    // Native getters are the outbound boundary. These cases exercise the
    // actual event admission and placement owner, not an OS window manager.
    let changed = rectangle(-700, 65, 960, 730);
    for event in [
        WindowEvent::Moved(PhysicalPosition::new(changed.x, changed.y)),
        WindowEvent::Resized(PhysicalSize::new(changed.width, changed.height)),
    ] {
        for remember_maximized in [false, true] {
            let tracked = super::TrackedWindow::new("test", "window.json");
            super::set_state(&tracked, Some(Placement {
                normal: rectangle(10, 20, 800, 600),
                maximized: false,
            }));
            super::capture_event(
                &tracked,
                &event,
                || Ok(ClosingState::Normal(changed)),
                remember_maximized,
            );
            super::capture_sample(&tracked, Ok(ClosingState::Maximized), remember_maximized);

            let expected = Placement { normal: changed, maximized: remember_maximized };
            let captured = super::state_value(&tracked).unwrap();
            assert_eq!(captured, expected);

            let dir = tempfile::tempdir().unwrap();
            let file = dir.path().join("window.json");
            std::fs::write(&file, super::file_text(captured).unwrap()).unwrap();
            assert_eq!(super::load_file_owned(&file).unwrap(), super::SavedPlacement::Found(expected));
        }
    }
}

#[test]
fn geometry_events_in_other_display_modes_do_not_replace_normal_bounds() {
    let tracked = super::TrackedWindow::new("test", "window.json");
    let normal = rectangle(-700, 65, 960, 730);
    super::set_state(&tracked, Some(Placement { normal, maximized: false }));
    let event = WindowEvent::Resized(PhysicalSize::new(2560, 1440));

    super::capture_event(&tracked, &event, || Ok(ClosingState::Maximized), true);
    assert_eq!(super::state_value(&tracked), Some(Placement { normal, maximized: true }));
    super::capture_event(&tracked, &event, || Ok(ClosingState::Transient), true);
    assert_eq!(super::state_value(&tracked), Some(Placement { normal, maximized: true }));
}

#[test]
fn hidden_construction_geometry_retains_absence_or_the_closed_windows_placement() {
    let saved = Placement { normal: rectangle(-700, 65, 960, 730), maximized: true };
    for previous in [None, Some(saved)] {
        let tracked = super::TrackedWindow::new("test", "window.json");
        super::set_state(&tracked, previous);
        // current_state classifies a hidden native window as transient;
        // construction must not seed or replace the owner used by restore.
        super::capture_event(
            &tracked,
            &WindowEvent::Resized(PhysicalSize::new(1200, 760)),
            || Ok(ClosingState::Transient),
            true,
        );
        assert_eq!(super::state_value(&tracked), previous);
    }
}

#[test]
fn unrelated_window_events_do_not_sample_geometry() {
    let tracked = super::TrackedWindow::new("test", "window.json");
    super::capture_event(
        &tracked,
        &WindowEvent::Focused(true),
        || panic!("focus must not sample placement"),
        true,
    );
    assert_eq!(super::state_value(&tracked), None);
}

// The three-display layout this rule was checked on: two 2560x1440 displays
// side by side, the left one's work area above its Dock, at scale 1.
fn displays() -> Vec<super::WorkArea> {
    vec![
        super::WorkArea { x: 0, y: 0, width: 2560, height: 1341, scale: 1.0 },
        super::WorkArea { x: 2560, y: 0, width: 2560, height: 1440, scale: 1.0 },
    ]
}

#[test]
fn a_window_whose_title_bar_shows_on_a_display_is_restored() {
    assert!(super::grabbable(rectangle(300, 200, 1200, 800), &displays()));
    // Straddling two displays is fine.
    assert!(super::grabbable(rectangle(2000, 200, 1200, 800), &displays()));
    // Enough of the title bar left on screen to grab.
    assert!(super::grabbable(rectangle(5120 - 96, 200, 1200, 800), &displays()));
}

#[test]
fn a_sliver_or_a_title_bar_off_screen_is_not_restored() {
    // Two pixels on the right display, as macOS would restore it.
    assert!(!super::grabbable(rectangle(5118, 200, 1200, 800), &displays()));
    assert!(!super::grabbable(rectangle(-1198, 200, 1200, 800), &displays()));
    // Title bar above the top of every display, body still visible.
    assert!(!super::grabbable(rectangle(300, -20, 1200, 800), &displays()));
    // Title bar below the left display's work area, on its Dock.
    assert!(!super::grabbable(rectangle(300, 1330, 1200, 800), &displays()));
    assert!(!super::grabbable(rectangle(300, 200, 0, 800), &displays()));
}

#[test]
fn the_grab_area_scales_with_the_display() {
    let retina = [super::WorkArea { x: 0, y: 0, width: 3024, height: 1890, scale: 2.0 }];
    assert!(super::grabbable(rectangle(3024 - 192, 100, 1600, 1000), &retina));
    assert!(!super::grabbable(rectangle(3024 - 100, 100, 1600, 1000), &retina));
}

// Whether tao reports a move or resize while maximizing before its maximized
// flag reads true, so a maximized frame would be sampled as the normal
// rectangle and Restore after relaunch would reopen at the maximized size.
// Only a real window answers it, and only Windows keeps the maximized flag for
// relaunch; the body compiles on the Mac so it stays type-checked there.
#[test]
#[cfg_attr(not(windows), ignore = "Windows only: maximizes a real window through tao")]
fn maximizing_keeps_the_latest_normal_rectangle() {
    #[cfg(any(windows, target_os = "macos"))]
    {
        use super::{on_window_event, state_value, WindowPlacements};
        use std::sync::mpsc;
        use std::time::Duration;
        use tauri::Manager;

        let builder = tauri::Builder::default()
            .manage(WindowPlacements::new())
            .on_window_event(|window, event| {
                on_window_event(window, event, &window.state::<WindowPlacements>());
            });
        #[cfg(windows)]
        let builder = builder.any_thread();
        let app = builder.build(crate::context()).expect("test app builds");
        let handle = app.handle().clone();
        let (report, outcome) = mpsc::channel();
        std::thread::spawn(move || {
            let pause = || std::thread::sleep(Duration::from_millis(800));
            pause();
            let window = handle.get_webview_window("main").expect("the configured main window");
            window.show().unwrap();
            window.set_position(PhysicalPosition::new(120, 140)).unwrap();
            window.set_size(PhysicalSize::new(820u32, 610u32)).unwrap();
            pause();
            let placements = handle.state::<WindowPlacements>();
            let before = state_value(&placements.main);
            window.maximize().unwrap();
            pause();
            let after = state_value(&placements.main);
            let _ = report.send((before, after, window.is_maximized().unwrap_or(false)));
            handle.exit(0);
        });
        app.run_return(|_, _| {});
        let (before, after, maximized) = outcome.recv().expect("the window reported its placements");
        let before = before.expect("a normal sample before maximizing");
        let after = after.expect("a sample after maximizing");
        assert!(maximized, "the window maximized");
        assert_eq!(after.normal, before.normal, "maximizing replaced the normal rectangle");
        assert!(after.maximized, "Windows remembers the maximized state");
    }
}
