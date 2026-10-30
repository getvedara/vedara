use crate::types::Unit;

fn grams_per(unit: Unit) -> f64 {
    match unit {
        Unit::Gram => 1.0,
        Unit::Kilogram => 1000.0,
        Unit::Pound => 453.59237,
    }
}

pub fn convert(value: f64, from: Unit, to: Unit) -> f64 {
    value * grams_per(from) / grams_per(to)
}

pub fn to_kilos(value: f64, from: Unit) -> f64 {
    convert(value, from, Unit::Kilogram)
}
