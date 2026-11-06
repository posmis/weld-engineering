use weld_application::{
    calculate,
    cases::{CaseBook, LoadCase},
    combinations::{self, CombinationRequest, CombinationTerm},
    forces::AppliedForce,
    inertia::MassLoad,
    materials::{MaterialContext, MaterialSelection},
    projects::{Project, ProjectStore},
    sections::SectionModel,
    user_limits::{LimitMethod, StressLimit, UserLimits},
    width_study::*,
    ApplicationPoint, CalculationInput, SegmentInput,
};
fn project() -> Project {
    let input = CalculationInput {
        schema_version: 1,
        segments: vec![
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
        ],
        force_n: [400.0, -200.0, 600.0],
        forces: None,
        couple_n_mm: [160000.0, 0.0, 0.0],
        application: ApplicationPoint::Centroid,
    };
    let result = calculate(&input).unwrap();
    Project {
        user_limits: Some(UserLimits {
            method_id: LimitMethod::IndependentNominalComponentsV1,
            tension: StressLimit {
                value_mpa: 20.0,
                source: "User T".into(),
            },
            compression: StressLimit {
                value_mpa: 20.0,
                source: "User C".into(),
            },
            shear: StressLimit {
                value_mpa: 5.0,
                source: "User S".into(),
            },
        }),
        materials: Some(MaterialSelection {
            context: MaterialContext {
                thickness_mm: 10.0,
                temperature_c: 20.0,
            },
            base: None,
            weld: None,
        }),
        schema_version: 1,
        title: "Width study".into(),
        input,
        last_calculation: Some(result),
        casebook: None,
    }
}
#[test]
fn global_width_scaling_recomputes_independent_inverse_stress_and_user_ratio_reference() {
    let p = project();
    let result = evaluate(&WidthStudyRequest {
        constraints: vec![],
        objective: None,
        schema_version: 1,
        project: p.clone(),
        factors: vec![1.0, 2.0, 0.5],
    })
    .unwrap();
    assert_eq!(result.source_project, p);
    assert_eq!(result.rows.len(), 3);
    for (row, factor) in result.rows.iter().zip([1.0, 2.0, 0.5]) {
        assert_eq!(row.status, WidthStudyStatus::Complete);
        assert_eq!(row.area_mm2, Some(400.0 * factor));
        assert_eq!(
            row.summary
                .as_ref()
                .unwrap()
                .normal_max
                .as_ref()
                .unwrap()
                .value_mpa,
            21.5 / factor
        );
        assert_eq!(
            row.summary
                .as_ref()
                .unwrap()
                .normal_min
                .as_ref()
                .unwrap()
                .value_mpa,
            -18.5 / factor
        );
        assert_eq!(
            row.comparison.as_ref().unwrap().maximum_ratio,
            Some(1.075 / factor)
        );
        assert_eq!(
            row.comparison.as_ref().unwrap().strength_status,
            weld_application::StrengthStatus::UnsupportedCalculation
        );
    }
    let scaled = apply(&ApplyWidthScaleRequest {
        constraints: vec![],
        schema_version: 1,
        project: p.clone(),
        factor: 2.0,
    })
    .unwrap();
    assert_eq!(scaled.input.segments[0].effective_width_mm, 4.0);
    assert_eq!(scaled.input.force_n, p.input.force_n);
    assert_eq!(scaled.input.couple_n_mm, p.input.couple_n_mm);
    assert_eq!(scaled.materials, p.materials);
    assert!(scaled.casebook.is_none());
    assert_eq!(
        scaled.last_calculation.as_ref().unwrap().geometry.area_mm2,
        800.0
    );
}
#[test]
fn fillet_legs_mass_sources_frozen_combinations_and_old_sqlite_revision_are_preserved() {
    let mut p = project();
    p.input.segments[0].section = Some(SectionModel::IdealizedRightAngleFillet {
        leg_1_mm: 3.0,
        leg_2_mm: 4.0,
    });
    p.input.segments[0].effective_width_mm = 2.4;
    p.last_calculation = None;
    let a = LoadCase {
        combination: None,
        forces: None,
        id: "A".into(),
        title: "A".into(),
        force_n: p.input.force_n,
        couple_n_mm: p.input.couple_n_mm,
        application: p.input.application.clone(),
        last_calculation: None,
    };
    let b = LoadCase {
        combination: None,
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
                point_mm: [10.0, 0.0, 0.0],
            },
        }]),
        id: "B".into(),
        title: "B".into(),
        force_n: [0.0; 3],
        couple_n_mm: [0.0; 3],
        application: ApplicationPoint::Centroid,
        last_calculation: None,
    };
    p.casebook = Some(CaseBook {
        schema_version: 1,
        active_id: "A".into(),
        cases: vec![a, b],
    });
    p = combinations::create(&CombinationRequest {
        replace_case_id: None,
        schema_version: 1,
        project: p,
        title: "A+B".into(),
        terms: vec![
            CombinationTerm {
                case_id: "A".into(),
                factor: 1.0,
            },
            CombinationTerm {
                case_id: "B".into(),
                factor: 1.0,
            },
        ],
    })
    .unwrap();
    let store = ProjectStore::in_memory().unwrap();
    let old = store.save(&p).unwrap();
    let scaled = apply(&ApplyWidthScaleRequest {
        constraints: vec![],
        schema_version: 1,
        project: p.clone(),
        factor: 2.0,
    })
    .unwrap();
    assert_eq!(scaled.input.segments[0].effective_width_mm, 4.8);
    assert_eq!(
        scaled.input.segments[0].section,
        Some(SectionModel::IdealizedRightAngleFillet {
            leg_1_mm: 6.0,
            leg_2_mm: 8.0
        })
    );
    assert_eq!(
        scaled.casebook.as_ref().unwrap().active_id,
        p.casebook.as_ref().unwrap().active_id
    );
    for (new, old) in scaled
        .casebook
        .as_ref()
        .unwrap()
        .cases
        .iter()
        .zip(&p.casebook.as_ref().unwrap().cases)
    {
        let mut new = new.clone();
        assert!(new.last_calculation.is_some());
        new.last_calculation = None;
        assert_eq!(&new, old);
    }
    assert_eq!(scaled.input.forces, p.input.forces);
    let id = store.save(&scaled).unwrap();
    assert_eq!(store.load(&old).unwrap(), p);
    assert_eq!(store.load(&id).unwrap(), scaled);
    assert_eq!(
        Project::from_json(&scaled.to_json().unwrap()).unwrap(),
        scaled
    );
}
#[test]
fn failed_and_unsupported_candidates_remain_visible_and_cannot_be_applied() {
    let p = project();
    let result = evaluate(&WidthStudyRequest {
        constraints: vec![],
        objective: None,
        schema_version: 1,
        project: p.clone(),
        factors: vec![1.0, 2.0, 1e308],
    })
    .unwrap();
    assert_eq!(result.rows.len(), 3);
    assert_eq!(result.rows[2].status, WidthStudyStatus::Failed);
    assert_eq!(
        result.rows[2].error.as_ref().unwrap().code,
        "numerical_range"
    );
    assert!(result.rows[2].summary.is_none());
    let mut p = p;
    p.input.segments.truncate(1);
    p.last_calculation = None;
    let result = evaluate(&WidthStudyRequest {
        constraints: vec![],
        objective: None,
        schema_version: 1,
        project: p.clone(),
        factors: vec![1.0],
    })
    .unwrap();
    assert_eq!(result.rows[0].status, WidthStudyStatus::Incomplete);
    assert_eq!(result.rows[0].summary.as_ref().unwrap().computed, 0);
    assert_eq!(
        apply(&ApplyWidthScaleRequest {
            constraints: vec![],
            schema_version: 1,
            project: p,
            factor: 1.0
        })
        .unwrap_err()
        .code,
        "width_study_incomplete"
    );
}
#[test]
fn invalid_factors_versions_and_explicit_work_budget_are_rejected() {
    for factors in [
        vec![],
        vec![0.0],
        vec![-1.0],
        vec![f64::NAN],
        vec![f64::INFINITY],
        vec![1.0, 1.0],
        (1..=17).map(f64::from).collect(),
    ] {
        assert!(evaluate(&WidthStudyRequest {
            constraints: vec![],
            objective: None,
            schema_version: 1,
            project: project(),
            factors
        })
        .is_err());
    }
    assert!(evaluate(&WidthStudyRequest {
        constraints: vec![],
        objective: None,
        schema_version: 2,
        project: project(),
        factors: vec![1.0]
    })
    .is_err());
    let mut p = project();
    p.input.segments = (0..256)
        .map(|i| SegmentInput {
            section: None,
            start_mm: [0.0, f64::from(i) * 2.0],
            end_mm: [1.0, f64::from(i) * 2.0],
            effective_width_mm: 2.0,
        })
        .collect();
    p.last_calculation = None;
    let cases = (0..32)
        .map(|i| LoadCase {
            combination: None,
            forces: None,
            id: i.to_string(),
            title: "Case".into(),
            force_n: p.input.force_n,
            couple_n_mm: p.input.couple_n_mm,
            application: p.input.application.clone(),
            last_calculation: None,
        })
        .collect();
    p.casebook = Some(CaseBook {
        schema_version: 1,
        active_id: "0".into(),
        cases,
    });
    assert_eq!(
        evaluate(&WidthStudyRequest {
            constraints: vec![],
            objective: None,
            schema_version: 1,
            project: p,
            factors: vec![1.0, 2.0, 3.0, 4.0, 5.0]
        })
        .unwrap_err()
        .code,
        "width_study_budget"
    );
}

fn sizing_project() -> Project {
    let mut p = project();
    p.last_calculation = None;
    p.input.force_n = [0.0, 0.0, 600.0];
    p.input.couple_n_mm = [0.0; 3];
    for s in &mut p.input.segments {
        s.section = Some(SectionModel::IdealizedRightAngleFillet {
            leg_1_mm: 3.0,
            leg_2_mm: 4.0,
        });
        s.effective_width_mm = 2.4;
    }
    let limits = p.user_limits.as_mut().unwrap();
    limits.tension.value_mpa = 2.0;
    limits.compression.value_mpa = 2.0;
    limits.shear.value_mpa = 2.0;
    p.materials.as_mut().unwrap().weld = Some(weld_application::materials::MaterialCard {
        kind: weld_application::materials::MaterialKind::Custom,
        designation: "Synthetic weld".into(),
        product_form: None,
        condition: None,
        properties: vec![weld_application::materials::CustomProperty {
            kind: weld_application::materials::PropertyKind::Density,
            value: 8000.0,
            thickness_mm: [0.0, 20.0],
            temperature_c: [20.0, 20.0],
            source: "User density S-001".into(),
        }],
    });
    p
}
#[test]
fn finite_candidate_volume_and_mass_selection_rejects_excess_and_recalculates_every_metric() {
    for objective in [WidthObjective::MinimumVolume, WidthObjective::MinimumMass] {
        let p = sizing_project();
        let original = p.clone();
        let result = evaluate(&WidthStudyRequest {
            constraints: vec![],
            objective: Some(objective),
            schema_version: 1,
            project: p,
            factors: vec![2.0, 1.0, 0.5],
        })
        .unwrap();
        let selection = result.selection.unwrap();
        assert_eq!(result.source_project, original);
        assert_eq!(selection.status, SelectionStatus::Complete);
        assert_eq!(selection.eligible_count, 2);
        assert_eq!(selection.unavailable_count, 0);
        assert_eq!(selection.selected_row_index, Some(1));
        assert_eq!(selection.exclusions[0].row_index, 2);
        assert_eq!(
            selection.exclusions[0].reason,
            ExclusionReason::LimitsExceeded
        );
        for (row, volume) in result.rows.iter().zip([4800.0, 1200.0, 300.0]) {
            let q = row.quantities.as_ref().unwrap();
            assert_eq!(q.volume_mm3, Some(volume));
            assert!((q.mass_kg.unwrap() - volume * 1e-9 * 8000.0).abs() < 1e-15);
            assert_eq!(
                row.comparison.as_ref().unwrap().strength_status,
                weld_application::StrengthStatus::UnsupportedCalculation
            );
        }
        let expected = if objective == WidthObjective::MinimumVolume {
            1200.0
        } else {
            0.0096
        };
        assert!((selection.objective_value.unwrap() - expected).abs() < 1e-15);
    }
}
#[test]
fn an_unknown_quantity_or_failed_candidate_blocks_discrete_selection_even_with_known_eligible_rows()
{
    let p = sizing_project();
    let result = evaluate(&WidthStudyRequest {
        constraints: vec![],
        objective: Some(WidthObjective::MinimumMass),
        schema_version: 1,
        project: p.clone(),
        factors: vec![1.0, 2.0, 1e308],
    })
    .unwrap();
    let s = result.selection.unwrap();
    assert_eq!(s.eligible_count, 2);
    assert_eq!(s.unavailable_count, 1);
    assert_eq!(s.status, SelectionStatus::Incomplete);
    assert!(s.selected_row_index.is_none() && s.objective_value.is_none());
    let mut p = p;
    p.input.segments[0].section = None;
    p.last_calculation = None;
    let result = evaluate(&WidthStudyRequest {
        constraints: vec![],
        objective: Some(WidthObjective::MinimumVolume),
        schema_version: 1,
        project: p,
        factors: vec![1.0, 2.0],
    })
    .unwrap();
    let s = result.selection.unwrap();
    assert_eq!(s.status, SelectionStatus::Incomplete);
    assert_eq!(s.unavailable_count, 2);
    assert!(s.selected_row_index.is_none());
    assert_eq!(s.exclusions[0].reason, ExclusionReason::QuantityUnavailable);
}
#[test]
fn no_eligible_candidate_missing_limits_and_out_of_domain_density_never_produce_a_minimum() {
    let mut p = sizing_project();
    let result = evaluate(&WidthStudyRequest {
        constraints: vec![],
        objective: Some(WidthObjective::MinimumVolume),
        schema_version: 1,
        project: p.clone(),
        factors: vec![0.1, 0.2],
    })
    .unwrap();
    let s = result.selection.unwrap();
    assert_eq!(s.status, SelectionStatus::Complete);
    assert_eq!(s.eligible_count, 0);
    assert_eq!(s.unavailable_count, 0);
    assert!(s.selected_row_index.is_none());
    p.materials.as_mut().unwrap().context.temperature_c = 21.0;
    let result = evaluate(&WidthStudyRequest {
        constraints: vec![],
        objective: Some(WidthObjective::MinimumMass),
        schema_version: 1,
        project: p.clone(),
        factors: vec![1.0, 2.0],
    })
    .unwrap();
    assert_eq!(
        result.selection.unwrap().status,
        SelectionStatus::Incomplete
    );
    p.user_limits = None;
    assert_eq!(
        evaluate(&WidthStudyRequest {
            constraints: vec![],
            objective: Some(WidthObjective::MinimumVolume),
            schema_version: 1,
            project: p.clone(),
            factors: vec![1.0]
        })
        .unwrap_err()
        .code,
        "width_study_limits_required"
    );
    assert!(evaluate(&WidthStudyRequest {
        constraints: vec![],
        objective: None,
        schema_version: 1,
        project: p,
        factors: vec![1.0]
    })
    .unwrap()
    .selection
    .is_none());
}

#[test]
fn quantity_numerical_error_does_not_change_analysis_status_but_blocks_objective_selection() {
    let mut p = sizing_project();
    for s in &mut p.input.segments {
        let model = SectionModel::IdealizedRightAngleFillet {
            leg_1_mm: 1e140,
            leg_2_mm: 1e140,
        };
        s.effective_width_mm = weld_application::sections::width(&model).unwrap();
        s.section = Some(model);
    }
    p.materials
        .as_mut()
        .unwrap()
        .weld
        .as_mut()
        .unwrap()
        .properties[0]
        .value = 1e60;
    let r = evaluate(&WidthStudyRequest {
        constraints: vec![],
        objective: Some(WidthObjective::MinimumMass),
        schema_version: 1,
        project: p,
        factors: vec![1.0],
    })
    .unwrap();
    assert_eq!(r.rows[0].status, WidthStudyStatus::Complete);
    assert_eq!(
        r.rows[0].quantity_error.as_ref().unwrap().code,
        "numerical_range"
    );
    let selection = r.selection.unwrap();
    assert_eq!(selection.status, SelectionStatus::Incomplete);
    assert_eq!(
        selection.exclusions[0].reason,
        ExclusionReason::QuantityError
    );
    assert!(selection.selected_row_index.is_none());
}

#[test]
fn explicit_size_constraints_exclude_known_violations_and_are_enforced_again_on_apply() {
    use weld_application::size_limits::{SizeConstraint, SizeDimension, SizeStatus};
    let p = sizing_project();
    let constraints = vec![SizeConstraint {
        dimension: SizeDimension::EffectiveWidth,
        minimum_mm: 3.0,
        maximum_mm: 4.0,
        source: "User bound B-001".into(),
    }];
    let result = evaluate(&WidthStudyRequest {
        constraints: constraints.clone(),
        objective: Some(WidthObjective::MinimumMass),
        schema_version: 1,
        project: p.clone(),
        factors: vec![1.0, 1.5, 2.0],
    })
    .unwrap();
    let rank = result.selection.unwrap();
    assert_eq!(result.constraints, constraints);
    assert_eq!(rank.selected_row_index, Some(1));
    assert_eq!(rank.eligible_count, 1);
    assert_eq!(rank.unavailable_count, 0);
    assert_eq!(
        rank.exclusions
            .iter()
            .map(|e| &e.reason)
            .collect::<Vec<_>>(),
        vec![
            &ExclusionReason::SizeLimitsExceeded,
            &ExclusionReason::SizeLimitsExceeded
        ]
    );
    assert_eq!(
        result.rows[1].size_checks.as_ref().unwrap().status,
        SizeStatus::WithinLimits
    );
    assert_eq!(
        result.rows[1].size_checks.as_ref().unwrap().checks[0].values[0].value_mm,
        Some(3.6)
    );
    assert_eq!(
        apply(&ApplyWidthScaleRequest {
            constraints: constraints.clone(),
            schema_version: 1,
            project: p.clone(),
            factor: 1.0
        })
        .unwrap_err()
        .code,
        "width_study_size_limits_not_met"
    );
    let updated = apply(&ApplyWidthScaleRequest {
        constraints,
        schema_version: 1,
        project: p,
        factor: 1.5,
    })
    .unwrap();
    assert_eq!(updated.input.segments[0].effective_width_mm, 3.6);
}
#[test]
fn an_unavailable_leg_constraint_blocks_selection_and_manual_application() {
    use weld_application::size_limits::{SizeConstraint, SizeDimension};
    let mut p = sizing_project();
    p.input.segments[0].section = None;
    let constraints = vec![SizeConstraint {
        dimension: SizeDimension::Leg1,
        minimum_mm: 1.0,
        maximum_mm: 10.0,
        source: "User leg bound".into(),
    }];
    let r = evaluate(&WidthStudyRequest {
        constraints: constraints.clone(),
        objective: Some(WidthObjective::MinimumVolume),
        schema_version: 1,
        project: p.clone(),
        factors: vec![1.0],
    })
    .unwrap();
    let rank = r.selection.unwrap();
    assert_eq!(rank.status, SelectionStatus::Incomplete);
    assert_eq!(rank.unavailable_count, 1);
    assert_eq!(
        rank.exclusions[0].reason,
        ExclusionReason::SizeLimitsUnknown
    );
    assert!(rank.selected_row_index.is_none());
    assert_eq!(
        apply(&ApplyWidthScaleRequest {
            constraints,
            schema_version: 1,
            project: p,
            factor: 1.0
        })
        .unwrap_err()
        .code,
        "width_study_size_limits_not_met"
    );
}
