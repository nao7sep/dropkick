// Both platforms' native-menu layouts read only catalogue keys every language
// has; building the menu itself needs a running app.
use super::{layout, KEYS};

#[test]
fn every_layout_reads_catalogue_keys_the_tests_check() {
    for macos in [true, false] {
        let layout = layout(macos);
        assert!(KEYS.contains(&layout.quit_key));
        assert!(KEYS.contains(&layout.maximize_key));
    }
}
