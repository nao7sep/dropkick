// The Records window's address: the page reads the context the main window
// handed it from here, before its first frame.

use dropkick_lib::records_window::{page_url, RecordsWindowContext};

fn context(time_zone: Option<&str>) -> RecordsWindowContext {
    RecordsWindowContext {
        min_width: 744.0,
        min_height: 257.0,
        list_width: 412.6,
        language: "pt-BR".to_string(),
        locale: "pt-BR".to_string(),
        time_zone: time_zone.map(str::to_string),
        theme: "dark".to_string(),
    }
}

#[test]
fn the_page_carries_the_list_width_language_locale_and_zone() {
    assert_eq!(
        page_url(&context(Some("America/Sao_Paulo"))),
        "records.html?listWidth=413&language=pt-BR&locale=pt-BR&timeZone=America%2FSao_Paulo"
    );
}

#[test]
fn the_computers_own_zone_is_left_out() {
    assert_eq!(
        page_url(&context(None)),
        "records.html?listWidth=413&language=pt-BR&locale=pt-BR"
    );
}
