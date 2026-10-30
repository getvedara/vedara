#[path = "registry.rs"]
mod registry;
use registry::*;

#[test]
fn find_returns_result() {
    let mut r = Registry::default();
    r.add(1, "ada");
    assert_eq!(r.find(1).map(|u| u.name.as_str()), Ok("ada"));
    assert_eq!(r.find(5), Err(LookupError::NotFound(5)));
    assert_eq!(r.display_name(1), "ada");
    assert_eq!(r.display_name(9), "<unknown #9>");
}
