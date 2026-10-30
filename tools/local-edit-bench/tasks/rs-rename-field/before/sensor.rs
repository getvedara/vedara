#[derive(Debug, Clone, PartialEq)]
pub struct Reading {
    pub sensor: String,
    pub temp_c: f64,
}

impl Reading {
    pub fn new(sensor: &str, temp_c: f64) -> Self {
        Reading { sensor: sensor.to_string(), temp_c }
    }

    pub fn fahrenheit(&self) -> f64 {
        self.temp_c * 9.0 / 5.0 + 32.0
    }
}

pub fn hottest(readings: &[Reading]) -> Option<&Reading> {
    readings.iter().max_by(|a, b| a.temp_c.partial_cmp(&b.temp_c).unwrap())
}
