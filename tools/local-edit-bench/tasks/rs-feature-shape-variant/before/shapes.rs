use std::f64::consts::PI;

#[derive(Debug, Clone, PartialEq)]
pub enum Shape {
    Circle { radius: f64 },
    Rect { width: f64, height: f64 },
}

impl Shape {
    pub fn area(&self) -> f64 {
        match self {
            Shape::Circle { radius } => PI * radius * radius,
            Shape::Rect { width, height } => width * height,
        }
    }

    pub fn name(&self) -> &'static str {
        match self {
            Shape::Circle { .. } => "circle",
            Shape::Rect { .. } => "rect",
        }
    }

    pub fn scale(&self, factor: f64) -> Shape {
        match self {
            Shape::Circle { radius } => Shape::Circle { radius: radius * factor },
            Shape::Rect { width, height } => Shape::Rect { width: width * factor, height: height * factor },
        }
    }
}
