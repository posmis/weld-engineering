use weld_application::{
    calculate,
    cases::{calculate_cases, CaseBook, LoadCase},
    combinations::{create, CombinationRequest, CombinationTerm},
    forces::AppliedForce,
    inertia::MassLoad,
    projects::{Project, ProjectStore},
    ApplicationPoint, CalculationInput, SegmentInput,
};
fn request() -> CombinationRequest {
    let input = CalculationInput {
        schema_version: 1,
        segments: vec![SegmentInput {
            section: None,
            start_mm: [-50.0, 0.0],
            end_mm: [50.0, 0.0],
            effective_width_mm: 2.0,
        }],
        force_n: [0.0; 3],
        couple_n_mm: [10.0, 20.0, 30.0],
        application: ApplicationPoint::Centroid,
        forces: Some(vec![AppliedForce {
            inertia: Some(MassLoad {
                mass_kg: 10.0,
                gravity_m_s2: [0.0, 0.0, -10.0],
                acceleration_m_s2: [2.0, 0.0, 0.0],
            }),
            id: "mass".into(),
            title: "Mass".into(),
            force_n: [-20.0, 0.0, -100.0],
            application: ApplicationPoint::Point {
                point_mm: [10.0, 20.0, 30.0],
            },
        }]),
    };
    let a = LoadCase {
        combination: None,
        id: "a".into(),
        title: "A".into(),
        forces: input.forces.clone(),
        force_n: input.force_n,
        couple_n_mm: input.couple_n_mm,
        application: input.application.clone(),
        last_calculation: None,
    };
    let b = LoadCase {
        combination: None,
        id: "b".into(),
        title: "B".into(),
        forces: None,
        force_n: [0.0, 5.0, 0.0],
        couple_n_mm: [1.0, 2.0, 3.0],
        application: ApplicationPoint::Point {
            point_mm: [-10.0, 0.0, 20.0],
        },
        last_calculation: None,
    };
    CombinationRequest {
        replace_case_id: None,
        schema_version: 1,
        project: Project {
            materials: None,
            schema_version: 1,
            title: "Combination reference".into(),
            input,
            last_calculation: None,
            casebook: Some(CaseBook {
                schema_version: 1,
                active_id: "a".into(),
                cases: vec![a, b],
            }),
        },
        title: "2A - 3B".into(),
        terms: vec![
            CombinationTerm {
                case_id: "a".into(),
                factor: 2.0,
            },
            CombinationTerm {
                case_id: "b".into(),
                factor: -3.0,
            },
        ],
    }
}
#[test]
fn pointwise_superposition_preserves_mass_source_and_matches_independent_equilibrium() {
    let req = request();
    let p = create(&req).unwrap();
    let result = calculate(&p.input).unwrap();
    assert_eq!(result.resultant_force_n, Some([-40.0, -15.0, -200.0]));
    assert_eq!(result.moment_at_centroid_n_mm, [-3683.0, 834.0, 1001.0]);
    let f = p.input.forces.as_ref().unwrap();
    assert_eq!(f.len(), 2);
    assert_eq!(
        f[0].application,
        ApplicationPoint::Point {
            point_mm: [10.0, 20.0, 30.0]
        }
    );
    assert_eq!(
        f[1].application,
        ApplicationPoint::Point {
            point_mm: [-10.0, 0.0, 20.0]
        }
    );
    assert!(f.iter().all(|f| f.inertia.is_none()));
    let source = &p.casebook.as_ref().unwrap().cases[2]
        .combination
        .as_ref()
        .unwrap()
        .sources[0];
    assert_eq!(
        source.load.forces.as_ref().unwrap()[0]
            .inertia
            .as_ref()
            .unwrap()
            .mass_kg,
        10.0
    );
    assert_eq!(
        &p.casebook.as_ref().unwrap().cases[..2],
        &req.project.casebook.as_ref().unwrap().cases[..]
    );
    let calculated = calculate_cases(&p).unwrap().project;
    let store = ProjectStore::in_memory().unwrap();
    let id = store.save(&calculated).unwrap();
    assert_eq!(store.load(&id).unwrap(), calculated);
    assert_eq!(
        Project::from_json(&calculated.to_json().unwrap()).unwrap(),
        calculated
    );
}
#[test]
fn frozen_combination_survives_source_removal_and_detects_changed_materialized_loads() {
    let mut p = create(&request()).unwrap();
    let old = p.input.clone();
    p.casebook.as_mut().unwrap().cases.remove(0);
    p.validate().unwrap();
    assert_eq!(p.input, old);
    p.input.segments[0].effective_width_mm = 3.0;
    p.validate().unwrap();
    p.casebook.as_mut().unwrap().cases[1].couple_n_mm[0] += 1.0;
    assert_eq!(p.validate().unwrap_err().code, "combination_load_mismatch");
    let mut p = create(&request()).unwrap();
    p.casebook.as_mut().unwrap().cases[2]
        .combination
        .as_mut()
        .unwrap()
        .sources[0]
        .factor = 3.0;
    assert_eq!(p.validate().unwrap_err().code, "combination_load_mismatch");
}
#[test]
fn invalid_sources_factors_nested_cases_and_numeric_range_are_rejected() {
    for factor in [f64::NAN, f64::INFINITY, f64::MAX, f64::from_bits(1)] {
        let mut r = request();
        r.terms[0].factor = factor;
        assert!(create(&r).is_err());
    }
    let mut r = request();
    r.terms[1].case_id = "a".into();
    assert_eq!(create(&r).unwrap_err().code, "invalid_combination");
    r.terms[1].case_id = "missing".into();
    assert!(create(&r).is_err());
    r = request();
    for t in &mut r.terms {
        t.factor = 0.0;
    }
    assert!(create(&r).is_err());
    r = request();
    r.schema_version = 2;
    assert!(create(&r).is_err());
    let p = create(&request()).unwrap();
    r = request();
    r.terms = vec![CombinationTerm {
        case_id: p.casebook.as_ref().unwrap().active_id.clone(),
        factor: 1.0,
    }];
    r.project = p;
    assert!(create(&r).is_err());
}
#[test]
fn force_limit_zero_terms_case_limit_and_compensated_couple_sum_are_enforced() {
    let mut r = request();
    let book = r.project.casebook.as_mut().unwrap();
    book.cases[0].forces = Some(
        (0..64)
            .map(|i| AppliedForce {
                inertia: None,
                id: i.to_string(),
                title: "F".into(),
                force_n: [1.0, 0.0, 0.0],
                application: ApplicationPoint::Centroid,
            })
            .collect(),
    );
    let load = book.cases[0].clone();
    r.project.input = load.input(&r.project);
    assert_eq!(create(&r).unwrap_err().code, "combination_force_limit");
    r.terms[1].factor = 0.0;
    assert_eq!(create(&r).unwrap().input.forces.unwrap().len(), 64);
    let mut r = request();
    let mut cases = Vec::new();
    for (i, m) in [1e16, 1.0, -1e16].into_iter().enumerate() {
        let mut c = r.project.casebook.as_ref().unwrap().cases[0].clone();
        c.id = i.to_string();
        c.forces = Some(vec![]);
        c.force_n = [0.0; 3];
        c.couple_n_mm = [m, 0.0, 0.0];
        cases.push(c);
    }
    r.project.input = cases[0].input(&r.project);
    r.project.casebook = Some(CaseBook {
        schema_version: 1,
        active_id: "0".into(),
        cases,
    });
    r.terms = (0..3)
        .map(|i| CombinationTerm {
            case_id: i.to_string(),
            factor: 1.0,
        })
        .collect();
    assert_eq!(create(&r).unwrap().input.couple_n_mm, [1.0, 0.0, 0.0]);
    let mut r = request();
    let mut cases = r.project.casebook.as_ref().unwrap().cases.clone();
    while cases.len() < 32 {
        let mut c = cases[0].clone();
        c.id = format!("extra{}", cases.len());
        cases.push(c);
    }
    r.project.casebook.as_mut().unwrap().cases = cases;
    assert!(create(&r).is_err());
}

#[test]
fn coefficient_edit_uses_frozen_mass_and_point_loads_after_live_sources_are_deleted() {
    let mut r = request();
    let p = create(&r).unwrap();
    let original = p.clone();
    let id = p.casebook.as_ref().unwrap().active_id.clone();
    r.project = p;
    r.project
        .casebook
        .as_mut()
        .unwrap()
        .cases
        .retain(|c| c.id == id);
    r.replace_case_id = Some(id.clone());
    r.title = "3A - 2B".into();
    r.terms = vec![
        CombinationTerm {
            case_id: "b".into(),
            factor: -2.0,
        },
        CombinationTerm {
            case_id: "a".into(),
            factor: 3.0,
        },
    ];
    let edited = create(&r).unwrap();
    let result = calculate(&edited.input).unwrap();
    assert_eq!(edited.casebook.as_ref().unwrap().cases.len(), 1);
    assert_eq!(edited.casebook.as_ref().unwrap().active_id, id);
    assert_eq!(result.resultant_force_n, Some([-60.0, -10.0, -300.0]));
    assert_eq!(result.moment_at_centroid_n_mm, [-5772.0, 1256.0, 1384.0]);
    let old = original.casebook.as_ref().unwrap().cases[2]
        .combination
        .as_ref()
        .unwrap();
    let new = edited.casebook.as_ref().unwrap().cases[0]
        .combination
        .as_ref()
        .unwrap();
    assert_eq!(old.sources[0].load, new.sources[0].load);
    assert_eq!(old.sources[1].load, new.sources[1].load);
    assert_eq!(new.sources[0].factor, 3.0);
    assert_eq!(new.sources[1].factor, -2.0);
    assert_eq!(edited.input.forces.as_ref().unwrap()[0].id, "c1-f1");
    assert_eq!(edited.input.forces.as_ref().unwrap()[1].id, "c2-f1");
}
#[test]
fn coefficient_edit_preserves_other_case_results_and_old_sqlite_revision() {
    let mut r = request();
    let p = calculate_cases(&create(&r).unwrap()).unwrap().project;
    let id = p.casebook.as_ref().unwrap().active_id.clone();
    let store = ProjectStore::in_memory().unwrap();
    let revision = store.save(&p).unwrap();
    r.project = p.clone();
    r.replace_case_id = Some(id.clone());
    r.terms[0].factor = 1.0;
    // Target need not be the active case when the API request is sent.
    let first = r.project.casebook.as_ref().unwrap().cases[0].clone();
    r.project.input = first.input(&r.project);
    r.project.last_calculation = first.last_calculation.clone();
    r.project.casebook.as_mut().unwrap().active_id = first.id;
    let edited = create(&r).unwrap();
    assert_eq!(edited.casebook.as_ref().unwrap().active_id, id);
    assert!(edited.last_calculation.is_none());
    assert_eq!(
        edited.casebook.as_ref().unwrap().cases[..2],
        p.casebook.as_ref().unwrap().cases[..2]
    );
    assert!(edited.casebook.as_ref().unwrap().cases[2]
        .last_calculation
        .is_none());
    let next = store.save(&edited).unwrap();
    assert_ne!(revision, next);
    assert_eq!(store.load(&revision).unwrap(), p);
    assert_eq!(store.load(&next).unwrap(), edited);
    assert_eq!(
        Project::from_json(&edited.to_json().unwrap()).unwrap(),
        edited
    );
}
#[test]
fn edit_requires_complete_unique_frozen_sources_and_can_replace_at_case_limit() {
    let mut r = request();
    r.project = create(&r).unwrap();
    let id = r.project.casebook.as_ref().unwrap().active_id.clone();
    r.replace_case_id = Some(id.clone());
    for target in ["missing", "a"] {
        let mut bad = r.clone();
        bad.replace_case_id = Some(target.into());
        assert!(create(&bad).is_err());
    }
    let mut bad = r.clone();
    bad.terms.pop();
    assert!(create(&bad).is_err());
    bad = r.clone();
    bad.terms[1].case_id = "a".into();
    assert!(create(&bad).is_err());
    bad = r.clone();
    bad.terms[1].case_id = "unknown".into();
    assert!(create(&bad).is_err());
    let mut bad = r.clone();
    for t in &mut bad.terms {
        t.factor = 0.0;
    }
    assert!(create(&bad).is_err());
    while r.project.casebook.as_ref().unwrap().cases.len() < 32 {
        let mut c = r.project.casebook.as_ref().unwrap().cases[0].clone();
        c.id = format!("extra{}", r.project.casebook.as_ref().unwrap().cases.len());
        r.project.casebook.as_mut().unwrap().cases.push(c);
    }
    let edited = create(&r).unwrap();
    assert_eq!(edited.casebook.as_ref().unwrap().cases.len(), 32);
    assert_eq!(edited.casebook.as_ref().unwrap().active_id, id);
    r.replace_case_id = None;
    assert!(create(&r).is_err());
}
