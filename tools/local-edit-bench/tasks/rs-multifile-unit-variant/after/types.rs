#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unit {
    Gram,
    Kilogram,
    Pound,
}

impl Unit {
    pub fn symbol(self) -> &'static str {
        match self {
            Unit::Gram => "g",
            Unit::Kilogram => "kg",
            Unit::Pound => "lb",
        }
    }

    pub fn parse(s: &str) -> Option<Unit> {
        match s {
            "g" => Some(Unit::Gram),
            "k" | "kg" => Some(Unit::Kilogram),
            "lb" => Some(Unit::Pound),
            _ => None,
        }
    }
}
