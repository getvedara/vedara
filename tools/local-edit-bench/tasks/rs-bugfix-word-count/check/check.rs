#[path = "words.rs"]
mod words;
use words::*;

#[test]
fn whitespace() {
    assert_eq!(word_count("  hello   big\tworld\n"), 3);
    assert_eq!(word_count(""), 0);
    assert_eq!(longest_word("a\nlonger  b"), Some("longer"));
    assert_eq!(longest_word("   "), None);
}
