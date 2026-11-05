use weld_application::{
    calculate,
    projects::{Project, ProjectStore},
    sections::{derive, SectionModel, SectionRequest, SectionStatus},
    ApplicationPoint, CalculationInput, SegmentInput,
};
fn model() -> SectionModel {
    SectionModel::IdealizedRightAngleFillet {
        leg_1_mm: 3.0,
        leg_2_mm: 4.0,
    }
}
fn input() -> CalculationInput {
    CalculationInput {
        schema_version: 1,
        forces: None,
        segments: vec![SegmentInput {
            section: Some(model()),
            start_mm: [-50.0, 0.0],
            end_mm: [50.0, 0.0],
            effective_width_mm: 2.4,
        }],
        force_n: [0.0, 0.0, 600.0],
        couple_n_mm: [0.0; 3],
        application: ApplicationPoint::Centroid,
    }
}
#[test]
fn explicit_legs_drive_nominal_area_and_survive_project_roundtrip() {
    let r = derive(&SectionRequest {
        schema_version: 1,
        model: model(),
    })
    .unwrap();
    assert_eq!(r.status, SectionStatus::IdealizedGeometry);
    assert_eq!(r.effective_width_mm, 2.4);
    let i = input();
    let value = calculate(&i).unwrap();
    assert_eq!(value.geometry.area_mm2, 240.0);
    assert_eq!(value.traction_mpa, Some([0.0, 0.0, 2.5]));
    assert!(value
        .warnings
        .iter()
        .any(|w| w == "idealized_section_geometry"));
    assert_eq!(
        value.strength_status,
        weld_application::StrengthStatus::UnsupportedCalculation
    );
    let p = Project {
        user_limits: None,
        materials: None,
        schema_version: 1,
        title: "Explicit leg geometry".into(),
        input: i,
        last_calculation: Some(value),
        casebook: None,
    };
    let store = ProjectStore::in_memory().unwrap();
    let id = store.save(&p).unwrap();
    assert_eq!(store.load(&id).unwrap(), p);
    assert_eq!(Project::from_json(&p.to_json().unwrap()).unwrap(), p);
}
#[test]
fn inconsistent_width_invalid_legs_and_unsupported_schema_are_rejected() {
    let mut i = input();
    i.segments[0].effective_width_mm = 2.3;
    assert_eq!(calculate(&i).unwrap_err().code, "section_width_mismatch");
    for a in [0.0, -1.0, f64::NAN, f64::INFINITY] {
        assert!(derive(&SectionRequest {
            schema_version: 1,
            model: SectionModel::IdealizedRightAngleFillet {
                leg_1_mm: a,
                leg_2_mm: 4.0
            }
        })
        .is_err());
    }
    assert!(derive(&SectionRequest {
        schema_version: 2,
        model: model()
    })
    .is_err());
    let text = r#"{"schema_version":1,"model":{"kind":"idealized_right_angle_fillet","leg_1_mm":3,"leg_2_mm":4,"penetration_mm":2}}"#;
    assert!(serde_json::from_str::<SectionRequest>(text).is_err());
}
#[test]
fn copy_and_intermittent_generators_preserve_section_provenance() {
    let i = input();
    let copy = weld_application::geometry_transform::transform(
        &weld_application::geometry_transform::GeometryTransformRequest {
            schema_version: 1,
            segments: i.segments.clone(),
            copy_index: Some(0),
            transform: weld_application::geometry_transform::Transform::Translate {
                delta_mm: [0.0, 20.0],
            },
        },
    )
    .unwrap();
    assert!(copy.segments.iter().all(|s| s.section == Some(model())));
    let pieces = weld_application::intermittent::generate(
        &weld_application::intermittent::IntermittentInput {
            input: i,
            segment_index: 0,
            weld_length_mm: 20.0,
            pitch_mm: 40.0,
            count: 3,
        },
    )
    .unwrap();
    assert!(pieces.segments.iter().all(|s| s.section == Some(model())));
    assert_eq!(calculate(&pieces).unwrap().geometry.area_mm2, 144.0);
}
