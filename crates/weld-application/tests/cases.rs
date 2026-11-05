use weld_application::{
    cases::{calculate_cases, summarize_cases, CaseBook, LoadCase},
    projects::{Project, ProjectStore},
    ApplicationPoint, CalculationInput, SegmentInput,
};
fn project() -> Project {
    let input = CalculationInput {
        forces: None,
        schema_version: 1,
        segments: vec![SegmentInput {
            start_mm: [-50.0, 0.0],
            end_mm: [50.0, 0.0],
            effective_width_mm: 2.0,
        }],
        force_n: [600.0, 800.0, 600.0],
        couple_n_mm: [0.0; 3],
        application: ApplicationPoint::Centroid,
    };
    let a = LoadCase {
        forces: None,
        id: "a".into(),
        title: "Positive".into(),
        force_n: input.force_n,
        couple_n_mm: input.couple_n_mm,
        application: input.application.clone(),
        last_calculation: None,
    };
    let b = LoadCase {
        forces: None,
        id: "b".into(),
        title: "Negative".into(),
        force_n: [0.0, 0.0, -1000.0],
        ..a.clone()
    };
    Project {
        schema_version: 1,
        title: "Cases".into(),
        input,
        last_calculation: None,
        casebook: Some(CaseBook {
            schema_version: 1,
            active_id: "a".into(),
            cases: vec![a, b],
        }),
    }
}
#[test]
fn batch_envelope_identifies_case_and_preserves_snapshots_through_sqlite() {
    let batch = calculate_cases(&project()).unwrap();
    assert!(batch.summary.complete);
    assert_eq!(batch.summary.computed, 2);
    let min = batch.summary.normal_min.unwrap();
    assert_eq!((min.case_id.as_str(), min.value_mpa), ("b", -5.0));
    assert_eq!(batch.summary.normal_max.unwrap().value_mpa, 3.0);
    assert_eq!(batch.summary.shear_max.unwrap().value_mpa, 5.0);
    let store = ProjectStore::in_memory().unwrap();
    let id = store.save(&batch.project).unwrap();
    assert_eq!(store.load(&id).unwrap(), batch.project);
    assert_eq!(
        Project::from_json(&batch.project.to_json().unwrap()).unwrap(),
        batch.project
    );
}
#[test]
fn unsupported_and_uncomputed_cases_never_produce_a_complete_envelope() {
    let mut p = project();
    let s = summarize_cases(&p).unwrap();
    assert!(!s.complete);
    assert!(s.normal_min.is_none());
    p.casebook.as_mut().unwrap().cases[1].couple_n_mm[0] = 1000.0;
    let batch = calculate_cases(&p).unwrap();
    assert_eq!(batch.summary.computed, 1);
    assert!(!batch.summary.complete);
    assert!(batch.project.casebook.unwrap().cases[1]
        .last_calculation
        .as_ref()
        .unwrap()
        .traction_mpa
        .is_none());
}
#[test]
fn malformed_casebooks_and_mismatched_active_or_historical_inputs_are_rejected() {
    for change in 0..5 {
        let mut p = calculate_cases(&project()).unwrap().project;
        let book = p.casebook.as_mut().unwrap();
        match change {
            0 => book.active_id = "missing".into(),
            1 => book.cases[1].id = "a".into(),
            2 => book.cases[0].force_n[2] = 1.0,
            3 => {
                book.cases[1]
                    .last_calculation
                    .as_mut()
                    .unwrap()
                    .input_snapshot
                    .force_n[2] = 1.0
            }
            _ => book.cases[1].force_n[2] = f64::NAN,
        }
        assert!(p.validate().is_err(), "change {change}");
    }
}
#[test]
fn numeric_failure_does_not_discard_successful_other_cases() {
    let mut p = project();
    p.casebook.as_mut().unwrap().cases[1].application = ApplicationPoint::Point {
        point_mm: [1e308, 0.0, 0.0],
    };
    let batch = calculate_cases(&p).unwrap();
    assert_eq!(batch.failures.len(), 1);
    assert_eq!(batch.failures[0].case_id, "b");
    assert!(!batch.summary.complete);
    assert_eq!(batch.summary.computed, 1);
    batch.project.validate().unwrap();
}
