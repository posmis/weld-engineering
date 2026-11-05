use weld_core::{section::right_angle_fillet_throat, Millimetres};
fn throat(a: f64, b: f64) -> f64 {
    right_angle_fillet_throat(Millimetres::new(a).unwrap(), Millimetres::new(b).unwrap())
        .unwrap()
        .value()
}
#[test]
fn independent_345_triangle_and_equal_legs_have_expected_altitudes() {
    assert_eq!(throat(3.0, 4.0), 2.4);
    assert_eq!(throat(4.0, 3.0), 2.4);
    assert!((throat(6.0, 6.0) - 6.0 / 2.0_f64.sqrt()).abs() < 1e-14);
    assert_eq!(throat(30.0, 40.0), 24.0);
}
#[test]
fn scaled_formula_handles_extreme_finite_legs_without_intermediate_overflow() {
    let a = throat(1e308, 1e308);
    assert!(a.is_finite());
    assert!((a / 1e308 - 1.0 / 2.0_f64.sqrt()).abs() < 1e-15);
    assert_eq!(throat(1e-300, 1e300), 1e-300);
}
#[test]
fn nonpositive_and_unresolvable_subnormal_geometry_is_rejected() {
    for a in [0.0, -1.0] {
        assert!(right_angle_fillet_throat(
            Millimetres::new(a).unwrap(),
            Millimetres::new(3.0).unwrap()
        )
        .is_err());
    }
    let tiny = f64::from_bits(1);
    assert!(right_angle_fillet_throat(
        Millimetres::new(tiny).unwrap(),
        Millimetres::new(tiny).unwrap()
    )
    .is_err());
}
