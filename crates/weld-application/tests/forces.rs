use weld_application::{
    calculate,
    forces::AppliedForce,
    projects::{Project, ProjectStore},
    ApplicationPoint, CalculationInput, SegmentInput,
};
fn force(id: &str, f: [f64; 3], p: [f64; 3]) -> AppliedForce {
    AppliedForce {
        inertia: None,
        id: id.into(),
        title: id.into(),
        force_n: f,
        application: ApplicationPoint::Point { point_mm: p },
    }
}
fn input() -> CalculationInput {
    CalculationInput {
        schema_version: 1,
        segments: vec![SegmentInput {
            section: None,
            start_mm: [-50.0, 0.0],
            end_mm: [50.0, 0.0],
            effective_width_mm: 2.0,
        }],
        force_n: [0.0; 3],
        couple_n_mm: [0.0; 3],
        application: ApplicationPoint::Centroid,
        forces: Some(vec![]),
    }
}
#[test]
fn simultaneous_forces_have_independent_points_and_can_form_a_pure_couple() {
    let mut i = input();
    i.forces = Some(vec![
        force("F1", [0.0, 100.0, 0.0], [50.0, 0.0, 0.0]),
        force("F2", [0.0, -100.0, 0.0], [-50.0, 0.0, 0.0]),
    ]);
    let r = calculate(&i).unwrap();
    assert_eq!(r.resultant_force_n, Some([0.0; 3]));
    assert_eq!(r.moment_at_centroid_n_mm, [0.0, 0.0, 10000.0]);
    assert!(r.distribution.is_some());
    assert_eq!(
        r.strength_status,
        weld_application::StrengthStatus::UnsupportedCalculation
    );
}
#[test]
fn balanced_eccentric_forces_produce_uniform_total_traction_and_roundtrip() {
    let mut i = input();
    i.forces = Some(vec![
        force("F1", [0.0, 0.0, 300.0], [-25.0, 0.0, 0.0]),
        force("F2", [0.0, 0.0, 300.0], [25.0, 0.0, 0.0]),
    ]);
    let r = calculate(&i).unwrap();
    assert_eq!(r.resultant_force_n, Some([0.0, 0.0, 600.0]));
    assert_eq!(r.moment_at_centroid_n_mm, [0.0; 3]);
    assert_eq!(r.traction_mpa, Some([0.0, 0.0, 3.0]));
    let p = Project {
        schema_version: 1,
        title: "Multiple forces".into(),
        input: i,
        last_calculation: Some(r),
        casebook: None,
    };
    let store = ProjectStore::in_memory().unwrap();
    let id = store.save(&p).unwrap();
    assert_eq!(store.load(&id).unwrap(), p);
    assert_eq!(Project::from_json(&p.to_json().unwrap()).unwrap(), p);
    let mut bad = p.clone();
    bad.last_calculation.as_mut().unwrap().resultant_force_n = None;
    assert!(bad.validate().is_err());
}
#[test]
fn summation_retains_small_residuals_and_handles_empty_force_lists() {
    let mut i = input();
    i.forces = Some(vec![
        force("A", [1e16, 0.0, 0.0], [0.0; 3]),
        force("B", [1.0, 0.0, 0.0], [0.0; 3]),
        force("C", [-1e16, 0.0, 0.0], [0.0; 3]),
    ]);
    assert_eq!(
        calculate(&i).unwrap().resultant_force_n,
        Some([1.0, 0.0, 0.0])
    );
    i.forces = Some(vec![]);
    assert_eq!(calculate(&i).unwrap().traction_mpa, Some([0.0; 3]));
}
#[test]
fn ambiguous_nonfinite_duplicate_and_excess_forces_are_rejected() {
    let mut i = input();
    i.forces = Some(vec![force("A", [0.0, 0.0, 1.0], [0.0; 3])]);
    i.force_n[2] = 1.0;
    assert!(calculate(&i).is_err());
    i.force_n = [0.0; 3];
    i.forces.as_mut().unwrap()[0].force_n[0] = f64::NAN;
    assert!(calculate(&i).is_err());
    i.forces = Some(vec![force("A", [0.0; 3], [0.0; 3]); 65]);
    assert!(calculate(&i).is_err());
    i.forces.as_mut().unwrap().truncate(2);
    assert!(calculate(&i).is_err());
    i.forces = Some(vec![
        force("A", [f64::MAX, 0.0, 0.0], [0.0; 3]),
        force("B", [f64::MAX, 0.0, 0.0], [0.0; 3]),
    ]);
    assert!(calculate(&i).is_err());
}
