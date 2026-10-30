#[path = "quota.rs"]
mod quota;
use quota::*;

#[test]
fn remaining_never_underflows() {
    let mut q = Quota::new(10);
    q.consume(4);
    assert_eq!(q.remaining(), 6);
    q.consume(20);
    assert_eq!(q.remaining(), 0);
    assert!(q.is_exhausted());
}
