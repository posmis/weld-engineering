use weld_application::{
    calculate,
    cases::{CaseBook, LoadCase},
    projects::{Project, ProjectStore},
    user_limits::*,
    ApplicationPoint, CalculationInput, SegmentInput,
};
fn limits() -> UserLimits {
    UserLimits {
        method_id: LimitMethod::IndependentNominalComponentsV1,
        tension: StressLimit {
            value_mpa: 3.0,
            source: "User T-001".into(),
        },
        compression: StressLimit {
            value_mpa: 4.0,
            source: "User C-001".into(),
        },
        shear: StressLimit {
            value_mpa: 5.0,
            source: "User S-001".into(),
        },
    }
}
fn project() -> Project {
    let input = CalculationInput {
        schema_version: 1,
        segments: vec![SegmentInput {
            section: None,
            start_mm: [-50.0, 0.0],
            end_mm: [50.0, 0.0],
            effective_width_mm: 2.0,
        }],
        force_n: [800.0, 600.0, 600.0],
        forces: None,
        couple_n_mm: [0.0; 3],
        application: ApplicationPoint::Centroid,
    };
    let result = calculate(&input).unwrap();
    Project {
        user_limits: Some(limits()),
        materials: None,
        schema_version: 1,
        title: "Threshold test".into(),
        input,
        last_calculation: Some(result),
        casebook: None,
    }
}
fn evaluate_project(project: Project) -> LimitEvaluation {
    evaluate(&EvaluateLimitsRequest {
        schema_version: 1,
        project,
    })
    .unwrap()
}
#[test]
fn independent_signed_normal_and_vector_shear_limits_include_equality_and_detect_excess() {
    let mut p = project();
    let r = evaluate_project(p.clone());
    assert_eq!(r.status, ComparisonStatus::WithinUserLimits);
    assert_eq!(r.maximum_ratio, Some(1.0));
    assert_eq!(r.cases[0].tension.as_ref().unwrap().demand_mpa, 3.0);
    assert_eq!(r.cases[0].compression.as_ref().unwrap().demand_mpa, 0.0);
    assert_eq!(r.cases[0].shear.as_ref().unwrap().demand_mpa, 5.0);
    assert!(r.cases[0].compression.as_ref().unwrap().point.is_none());
    assert_eq!(
        r.strength_status,
        weld_application::StrengthStatus::UnsupportedCalculation
    );
    p.input.force_n[2] = -800.0;
    p.last_calculation = Some(calculate(&p.input).unwrap());
    assert_eq!(
        evaluate_project(p.clone()).status,
        ComparisonStatus::WithinUserLimits
    );
    p.input.force_n[2] = -1000.0;
    p.last_calculation = Some(calculate(&p.input).unwrap());
    let r = evaluate_project(p);
    assert_eq!(r.status, ComparisonStatus::ExceedsUserLimits);
    assert_eq!(r.cases[0].compression.as_ref().unwrap().ratio, 1.25);
    assert!(matches!(
        r.governing.unwrap().component,
        LimitComponent::Compression
    ));
}
#[test]
fn affine_bending_extrema_retain_governing_segment_and_roundtrip_limits_without_changing_stress() {
    let mut p = project();
    p.input.segments = vec![
        SegmentInput {
            section: None,
            start_mm: [-50.0, -20.0],
            end_mm: [50.0, -20.0],
            effective_width_mm: 2.0,
        },
        SegmentInput {
            section: None,
            start_mm: [-50.0, 20.0],
            end_mm: [50.0, 20.0],
            effective_width_mm: 2.0,
        },
    ];
    p.input.force_n = [0.0, 0.0, 600.0];
    p.input.couple_n_mm = [160000.0, 0.0, 0.0];
    p.last_calculation = Some(calculate(&p.input).unwrap());
    p.user_limits.as_mut().unwrap().tension.value_mpa = 20.0;
    p.user_limits.as_mut().unwrap().compression.value_mpa = 20.0;
    let r = evaluate_project(p.clone());
    assert_eq!(r.cases[0].tension.as_ref().unwrap().demand_mpa, 21.5);
    assert_eq!(r.cases[0].compression.as_ref().unwrap().demand_mpa, 18.5);
    assert_eq!(r.maximum_ratio, Some(1.075));
    let point = r.governing.unwrap().point.unwrap();
    assert_eq!(point.segment_index, 1);
    assert!(matches!(point.endpoint, Endpoint::Start));
    let store = ProjectStore::in_memory().unwrap();
    let mut old = p.clone();
    old.user_limits = None;
    let first = store.save(&old).unwrap();
    let next = store.save(&p).unwrap();
    assert!(store.load(&first).unwrap().user_limits.is_none());
    assert_eq!(store.load(&next).unwrap(), p);
    assert_eq!(Project::from_json(&p.to_json().unwrap()).unwrap(), p);
    assert_eq!(old.last_calculation, p.last_calculation);
}
#[test]
fn unsupported_and_missing_cases_cannot_disappear_into_a_complete_within_limits_summary() {
    let mut p = project();
    let a = LoadCase {
        combination: None,
        forces: None,
        id: "A".into(),
        title: "A".into(),
        force_n: p.input.force_n,
        couple_n_mm: p.input.couple_n_mm,
        application: p.input.application.clone(),
        last_calculation: p.last_calculation.clone(),
    };
    let mut input = p.input.clone();
    input.application = ApplicationPoint::Point {
        point_mm: [0.0, 20.0, 0.0],
    };
    let b = LoadCase {
        id: "B".into(),
        title: "B".into(),
        application: input.application.clone(),
        last_calculation: Some(calculate(&input).unwrap()),
        ..a.clone()
    };
    assert_eq!(
        b.last_calculation.as_ref().unwrap().analysis_status,
        weld_application::AnalysisStatus::UnsupportedLoading
    );
    p.casebook = Some(CaseBook {
        schema_version: 1,
        active_id: "A".into(),
        cases: vec![a, b],
    });
    let r = evaluate_project(p.clone());
    assert_eq!(r.available, 1);
    assert_eq!(r.total, 2);
    assert_eq!(r.status, ComparisonStatus::Incomplete);
    assert_eq!(r.cases[1].reason.as_deref(), Some("unsupported_loading"));
    assert!(r.cases[1].tension.is_none());
    p.casebook.as_mut().unwrap().cases[1].last_calculation = None;
    p.user_limits.as_mut().unwrap().tension.value_mpa = 1.0;
    let r = evaluate_project(p);
    assert_eq!(r.exceeded, 1);
    assert_eq!(r.status, ComparisonStatus::Incomplete);
    assert_eq!(r.cases[1].reason.as_deref(), Some("not_computed"));
    assert_eq!(r.maximum_ratio, Some(3.0));
}
#[test]
fn invalid_limits_unsupported_schema_and_unrepresentable_ratios_are_rejected() {
    for v in [0.0, -1.0, f64::NAN, f64::INFINITY] {
        let mut l = limits();
        l.tension.value_mpa = v;
        assert!(validate(&l).is_err());
    }
    let mut l = limits();
    l.shear.source.clear();
    assert!(validate(&l).is_err());
    let mut p = project();
    p.user_limits = None;
    assert_eq!(
        evaluate(&EvaluateLimitsRequest {
            schema_version: 1,
            project: p
        })
        .unwrap_err()
        .code,
        "missing_user_limits"
    );
    for v in [f64::MAX, f64::from_bits(1)] {
        let mut p = project();
        p.user_limits.as_mut().unwrap().tension.value_mpa = v;
        assert_eq!(
            evaluate(&EvaluateLimitsRequest {
                schema_version: 1,
                project: p
            })
            .unwrap_err()
            .code,
            "numerical_range"
        );
    }
    assert!(validate_request(&ValidateLimitsRequest {
        schema_version: 2,
        limits: limits()
    })
    .is_err());
    let mut json = serde_json::to_value(limits()).unwrap();
    json["method_id"] = "verified_gost_pass".into();
    assert!(serde_json::from_value::<UserLimits>(json).is_err());
}
