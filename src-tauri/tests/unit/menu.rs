// The catalogue keys the native menu reads, derived from menu.rs's syntax
// tree: every string literal under the nativeMenu. prefix, wherever it is used
// (a t() call or a platform layout field). Building the menu itself needs a
// running app.
use syn::visit::Visit;

const PREFIX: &str = "nativeMenu.";

#[derive(Default)]
struct Keys(Vec<String>);

impl<'ast> Visit<'ast> for Keys {
    fn visit_lit_str(&mut self, literal: &'ast syn::LitStr) {
        let value = literal.value();
        if value.len() > PREFIX.len() && value.starts_with(PREFIX) && !self.0.contains(&value) {
            self.0.push(value);
        }
    }
}

fn keys_in(source: &str) -> Vec<String> {
    let mut keys = Keys::default();
    keys.visit_file(&syn::parse_file(source).expect("menu source parses"));
    keys.0
}

/// Every catalogue key menu.rs reads.
pub(crate) fn menu_keys() -> Vec<String> {
    keys_in(include_str!("../../src/menu.rs"))
}

#[test]
fn finds_keys_in_calls_and_layout_fields() {
    let planted = r#"fn build() { t("nativeMenu.edit"); let key = if mac { "nativeMenu.zoom" } else { "nativeMenu.maximize" }; t("other.key"); }"#;
    assert_eq!(keys_in(planted), ["nativeMenu.edit", "nativeMenu.zoom", "nativeMenu.maximize"]);
}

#[test]
fn every_layout_key_is_one_menu_rs_reads() {
    let keys = menu_keys();
    assert!(keys.len() >= 20, "the menu's keys were found");
    for macos in [true, false] {
        let layout = super::layout(macos);
        assert!(keys.iter().any(|key| key == layout.quit_key));
        assert!(keys.iter().any(|key| key == layout.maximize_key));
    }
}
