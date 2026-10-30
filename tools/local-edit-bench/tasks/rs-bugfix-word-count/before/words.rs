pub fn word_count(text: &str) -> usize {
    text.split(' ').count()
}

pub fn longest_word(text: &str) -> Option<&str> {
    text.split(' ').max_by_key(|w| w.len())
}
