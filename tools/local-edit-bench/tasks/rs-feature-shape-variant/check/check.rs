#[path = "shapes.rs"]
mod shapes;
use shapes::*;

#[test]
fn triangle() {
    let t = Shape::Triangle { base: 4.0, height: 3.0 };
    assert_eq!(t.area(), 6.0);
    assert_eq!(t.name(), "triangle");
    assert_eq!(t.scale(2.0), Shape::Triangle { base: 8.0, height: 6.0 });
    assert_eq!(Shape::Rect { width: 2.0, height: 5.0 }.area(), 10.0);
}
