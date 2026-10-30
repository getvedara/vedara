pub fn word_count(text: &str) -> usize {
    text.split_whitespace().count()
}

pub fn longest_word(text: &str) -> Option<&str> {
    text.split_whitespace().max_by_key(|w| w.len())
}
