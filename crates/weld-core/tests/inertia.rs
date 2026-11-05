use weld_core::{inertia::equivalent_force, Kilograms, MetresPerSecondSquared};
fn force(m: f64, g: [f64; 3], a: [f64; 3]) -> Result<[f64; 3], weld_core::Error> {
    equivalent_force(
        Kilograms::new(m)?,
        g.map(|v| MetresPerSecondSquared::new(v).unwrap()),
        a.map(|v| MetresPerSecondSquared::new(v).unwrap()),
    )
    .map(|v| v.map(|n| n.value()))
}
#[test]
fn gravity_and_acceleration_have_correct_reaction_signs_and_si_units() {
    assert_eq!(
        force(10.0, [0.0, 0.0, -10.0], [2.0, 0.0, 0.0]).unwrap(),
        [-20.0, 0.0, -100.0]
    );
    assert_eq!(
        force(10.0, [0.0, 0.0, -10.0], [0.0, 0.0, 2.0]).unwrap(),
        [0.0, 0.0, -120.0]
    );
    assert_eq!(
        force(10.0, [0.0, 0.0, -10.0], [0.0, 0.0, -10.0]).unwrap(),
        [0.0; 3]
    );
    assert_eq!(
        force(20.0, [0.0; 3], [3.0, -4.0, 5.0]).unwrap(),
        [-60.0, 80.0, -100.0]
    );
}
#[test]
fn opposite_extreme_accelerations_can_have_a_finite_small_mass_result() {
    let f = force(0.25, [f64::MAX, 0.0, 0.0], [-f64::MAX, 0.0, 0.0]).unwrap();
    assert_eq!(f[0], f64::MAX * 0.5);
    assert_eq!(force(f64::MAX, [1e308; 3], [1e308; 3]).unwrap(), [0.0; 3]);
}
#[test]
fn invalid_mass_overflow_and_vanishing_nonzero_loads_are_rejected() {
    for m in [0.0, -1.0, f64::NAN, f64::INFINITY] {
        assert!(force(m, [0.0; 3], [1.0; 3]).is_err());
    }
    assert!(force(f64::MAX, [0.0; 3], [2.0; 3]).is_err());
    assert!(force(f64::MIN_POSITIVE, [0.0; 3], [0.1; 3]).is_err());
}
