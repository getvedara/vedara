#[derive(Debug, Clone, PartialEq)]
pub struct Reading {
    pub sensor: String,
    pub celsius: f64,
}

impl Reading {
    pub fn new(sensor: &str, celsius: f64) -> Self {
        Reading { sensor: sensor.to_string(), celsius }
    }

    pub fn fahrenheit(&self) -> f64 {
        self.celsius * 9.0 / 5.0 + 32.0
    }
}

pub fn hottest(readings: &[Reading]) -> Option<&Reading> {
    readings.iter().max_by(|a, b| a.celsius.partial_cmp(&b.celsius).unwrap())
}
