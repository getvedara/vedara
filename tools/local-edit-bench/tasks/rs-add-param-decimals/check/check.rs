#[path = "percent.rs"]
mod percent;
use percent::*;

#[test]
fn decimals_parameter() {
    assert_eq!(format_percent(0.12345, 2), "12.35%");
    assert_eq!(format_percent(0.5, 0), "50%");
    assert_eq!(format_percent(1.7, 1), "100.0%");
    assert_eq!(progress_line("copy", 1, 3), "copy: 1/3 (33.3%)");
    assert_eq!(progress_line("none", 0, 0), "none: 0/0 (100.0%)");
}
