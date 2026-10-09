use crate::window_placement::{
    placement_after_close, ClosingState, NormalRectangle, Placement,
};

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
