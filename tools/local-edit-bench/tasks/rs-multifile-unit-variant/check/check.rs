#[path = "types.rs"]
mod types;
#[path = "convert.rs"]
mod convert;
use convert::*;
use types::Unit;

#[test]
fn kilogram_variant() {
    assert_eq!(Unit::Kilogram.symbol(), "kg");
    assert_eq!(Unit::parse("kg"), Some(Unit::Kilogram));
    assert_eq!(convert(2.0, Unit::Kilogram, Unit::Gram), 2000.0);
    assert!((to_kilos(1.0, Unit::Pound) - 0.45359237).abs() < 1e-12);
}
