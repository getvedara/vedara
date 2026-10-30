pub fn format_percent(ratio: f64) -> String {
    let clamped = ratio.clamp(0.0, 1.0);
    format!("{:.1}%", clamped * 100.0)
}

pub fn progress_line(label: &str, done: u64, total: u64) -> String {
    let ratio = if total == 0 { 1.0 } else { done as f64 / total as f64 };
    format!("{label}: {done}/{total} ({})", format_percent(ratio))
}
