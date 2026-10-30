#[path = "sensor.rs"]
mod sensor;
use sensor::*;

#[test]
fn renamed_field() {
    let r = Reading { sensor: "a".into(), celsius: 100.0 };
    assert_eq!(r.fahrenheit(), 212.0);
    let all = vec![Reading::new("x", 3.0), Reading::new("y", 7.5), Reading::new("z", -1.0)];
    assert_eq!(hottest(&all).unwrap().sensor, "y");
    assert_eq!(Reading::new("q", 1.5).celsius, 1.5);
}
