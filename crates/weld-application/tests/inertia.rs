use weld_application::{
    calculate,
    forces::AppliedForce,
    inertia::{derive, MassLoad, MassLoadRequest},
    projects::{Project, ProjectStore},
    ApplicationPoint, CalculationInput, SegmentInput,
};
fn model() -> MassLoad {
    MassLoad {
        mass_kg: 10.0,
        gravity_m_s2: [0.0, 0.0, -10.0],
        acceleration_m_s2: [2.0, 0.0, 0.0],
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
        forces: Some(vec![AppliedForce {
            inertia: Some(model()),
            id: "mass".into(),
            title: "Mass 1".into(),
            force_n: [-20.0, 0.0, -100.0],
            application: ApplicationPoint::Point {
                point_mm: [10.0, 20.0, 30.0],
            },
        }]),
    }
}
#[test]
fn derived_force_and_moment_match_independent_attachment_equilibrium_and_roundtrip() {
    let r = derive(&MassLoadRequest {
        schema_version: 1,
        model: model(),
    })
    .unwrap();
    assert_eq!(r.force_n, [-20.0, 0.0, -100.0]);
    let i = input();
    let r = calculate(&i).unwrap();
    assert_eq!(r.resultant_force_n, Some([-20.0, 0.0, -100.0]));
    assert_eq!(r.moment_at_centroid_n_mm, [-2000.0, 400.0, 400.0]);
    let p = Project {
        production_parameters: None,
        user_limits: None,
        materials: None,
        schema_version: 1,
        title: "Mass load".into(),
        input: i,
        last_calculation: Some(r),
        casebook: None,
    };
    let store = ProjectStore::in_memory().unwrap();
    let id = store.save(&p).unwrap();
    assert_eq!(store.load(&id).unwrap(), p);
    assert_eq!(Project::from_json(&p.to_json().unwrap()).unwrap(), p);
}
#[test]
fn contradictory_force_source_bad_schema_and_nonfinite_acceleration_are_rejected() {
    let mut i = input();
    i.forces.as_mut().unwrap()[0].force_n[0] = 20.0;
    assert_eq!(calculate(&i).unwrap_err().code, "mass_force_mismatch");
    i.forces.as_mut().unwrap()[0].force_n = [-20.0, 1e-300, -100.0];
    assert_eq!(calculate(&i).unwrap_err().code, "mass_force_mismatch");
    assert!(derive(&MassLoadRequest {
        schema_version: 2,
        model: model()
    })
    .is_err());
    let mut m = model();
    m.acceleration_m_s2[1] = f64::NAN;
    assert!(derive(&MassLoadRequest {
        schema_version: 1,
        model: m
    })
    .is_err());
    assert!(serde_json::from_str::<MassLoadRequest>(r#"{"schema_version":1,"model":{"mass_kg":10,"gravity_m_s2":[0,0,-10],"acceleration_m_s2":[0,0,0],"factor":2}}"#).is_err());
}
#[test]
fn multiple_mass_loads_sum_without_inferring_strength_acceptance() {
    let mut i = input();
    i.forces.as_mut().unwrap()[0].application = ApplicationPoint::Centroid;
    let mut copy = i.forces.as_ref().unwrap()[0].clone();
    copy.id = "second".into();
    copy.inertia.as_mut().unwrap().acceleration_m_s2 = [-2.0, 0.0, 0.0];
    copy.force_n = [20.0, 0.0, -100.0];
    i.forces.as_mut().unwrap().push(copy);
    let r = calculate(&i).unwrap();
    assert_eq!(r.resultant_force_n, Some([0.0, 0.0, -200.0]));
    assert_eq!(r.traction_mpa, Some([0.0, 0.0, -1.0]));
    assert_eq!(
        r.strength_status,
        weld_application::StrengthStatus::UnsupportedCalculation
    );
}
