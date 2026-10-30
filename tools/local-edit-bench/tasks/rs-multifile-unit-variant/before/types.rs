#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unit {
    Gram,
    Kilo,
    Pound,
}

impl Unit {
    pub fn symbol(self) -> &'static str {
        match self {
            Unit::Gram => "g",
            Unit::Kilo => "k",
            Unit::Pound => "lb",
        }
    }

    pub fn parse(s: &str) -> Option<Unit> {
        match s {
            "g" => Some(Unit::Gram),
            "k" | "kg" => Some(Unit::Kilo),
            "lb" => Some(Unit::Pound),
            _ => None,
        }
    }
}
