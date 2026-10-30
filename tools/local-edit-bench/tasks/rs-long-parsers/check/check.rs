#[path = "parsers.rs"]
mod parsers;
use parsers::*;

#[test]
fn pallet_fields() {
    let p = parse_pallet("id=1; width=2; height=3; weight=4").unwrap();
    assert_eq!(p, Pallet { id: 1, width: 2, height: 3, weight: 4 });
}

#[test]
fn others_unchanged() {
    let r = parse_route("id=9;width=8;height=7;weight=6").unwrap();
    assert_eq!(r, Route { id: 9, width: 8, height: 7, weight: 6 });
    assert_eq!(parse_pallet("id=1"), Err(ParseError::MissingField("width")));
}
