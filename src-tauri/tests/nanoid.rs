// Integration tests for the nanoid discriminator.
//
// Its only job is to make an atomic write's temp file name unique, so what is
// worth pinning is the shape (length and alphabet) and that the RNG is actually
// wired up rather than handing back a constant.

use dropkick_lib::nanoid::{generate, LENGTH};


#[test]
fn generate_produces_the_documented_length() {
    assert_eq!(generate().len(), LENGTH);
}

#[test]
fn generate_uses_only_the_documented_alphabet() {
    let id = generate();
    assert!(id
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-'));
}

#[test]
fn generate_yields_distinct_values_across_calls() {
    // Not a proof of uniqueness, just a sanity check that the RNG is
    // actually wired up rather than, say, always returning zero bytes.
    let ids: std::collections::HashSet<String> = (0..1000).map(|_| generate()).collect();
    assert_eq!(ids.len(), 1000);
}

#[test]
fn generate_never_produces_a_dot_or_slash() {
    // These would be significant if embedded in a filename; the alphabet
    // simply does not contain them, so this should hold trivially.
    for _ in 0..1000 {
        let id = generate();
        assert!(!id.contains('.'));
        assert!(!id.contains('/'));
        assert!(!id.contains('\\'));
    }
}
