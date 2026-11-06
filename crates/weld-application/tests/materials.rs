use weld_application::{
    calculate,
    materials::*,
    projects::{Project, ProjectStore},
    ApplicationPoint, CalculationInput, SegmentInput,
};
fn property(value: f64, bounds: [f64; 2]) -> CustomProperty {
    CustomProperty {
        kind: PropertyKind::YieldStrength,
        value,
        thickness_mm: bounds,
        temperature_c: [20.0, 40.0],
        source: "User test record M-001 (synthetic)".into(),
    }
}
fn selection() -> MaterialSelection {
    MaterialSelection {
        context: MaterialContext {
            thickness_mm: 10.0,
            temperature_c: 20.0,
        },
        base: Some(MaterialCard {
            kind: MaterialKind::Custom,
            designation: "Synthetic base".into(),
            product_form: None,
            condition: None,
            properties: vec![property(300.0, [0.0, 10.0]), property(280.0, [10.0, 20.0])],
        }),
        weld: None,
    }
}
fn query(s: MaterialSelection) -> MaterialEvaluation {
    evaluate(&MaterialRequest {
        schema_version: 1,
        selection: s,
    })
    .unwrap()
}
#[test]
fn thickness_and_temperature_boundaries_resolve_only_explicit_user_values() {
    let mut s = selection();
    assert_eq!(query(s.clone()).base.properties[0].value, Some(300.0));
    s.context.thickness_mm = 10.00000001;
    assert_eq!(query(s.clone()).base.properties[0].value, Some(280.0));
    s.context.thickness_mm = 20.0;
    s.context.temperature_c = 40.0;
    assert_eq!(query(s.clone()).base.properties[0].value, Some(280.0));
    s.context.thickness_mm = 20.00000001;
    let r = query(s.clone());
    assert!(r.base.properties[0].value.is_none());
    assert!(r.base.properties[0].source.is_none());
    assert!(matches!(
        r.base.properties[0].status,
        PropertyStatus::Unknown
    ));
    s.context.thickness_mm = 5.0;
    s.context.temperature_c = 40.00000001;
    assert!(query(s).base.properties[0].value.is_none());
}
#[test]
fn missing_roles_and_properties_remain_unknown_and_overlapping_domains_are_rejected() {
    let mut s = selection();
    let r = query(s.clone());
    assert!(r.weld.designation.is_none());
    assert!(r
        .weld
        .properties
        .iter()
        .all(|p| p.value.is_none() && p.source.is_none()));
    assert!(r.base.properties[1..].iter().all(|p| p.value.is_none()));
    assert!(matches!(
        r.base.properties[0].status,
        PropertyStatus::UserProvided
    ));
    s.base.as_mut().unwrap().properties[1].thickness_mm = [9.0, 20.0];
    assert_eq!(validate(&s).unwrap_err().code, "material_property_overlap");
    s = selection();
    s.base.as_mut().unwrap().properties[1].thickness_mm = [0.0, 10.0];
    s.base.as_mut().unwrap().properties[1].temperature_c = [40.0, 60.0];
    assert_eq!(validate(&s).unwrap_err().code, "material_property_overlap");
    s.base.as_mut().unwrap().properties[1].temperature_c = [41.0, 60.0];
    s.context.temperature_c = 40.5;
    assert!(query(s).base.properties[0].value.is_none());
}
#[test]
fn invalid_values_contexts_sources_and_forged_verification_are_rejected() {
    for value in [0.0, -1.0, f64::NAN, f64::INFINITY] {
        let mut s = selection();
        s.base.as_mut().unwrap().properties[0].value = value;
        assert!(validate(&s).is_err());
    }
    let mut s = selection();
    s.context.temperature_c = -274.0;
    assert!(validate(&s).is_err());
    s = selection();
    s.context.thickness_mm = 0.0;
    assert!(validate(&s).is_err());
    s = selection();
    s.base.as_mut().unwrap().properties[0].source.clear();
    assert!(validate(&s).is_err());
    let mut json = serde_json::to_value(selection()).unwrap();
    json["base"]["kind"] = "verified_standard".into();
    assert!(serde_json::from_value::<MaterialSelection>(json).is_err());
    let mut json = serde_json::to_value(selection()).unwrap();
    json["base"]["verification_status"] = "verified".into();
    assert!(serde_json::from_value::<MaterialSelection>(json).is_err());
    assert!(evaluate(&MaterialRequest {
        schema_version: 2,
        selection: selection()
    })
    .is_err());
}
#[test]
fn project_material_cards_roundtrip_without_changing_nominal_results_or_old_sqlite_revision() {
    let input = CalculationInput {
        schema_version: 1,
        segments: vec![SegmentInput {
            section: None,
            start_mm: [-50.0, 0.0],
            end_mm: [50.0, 0.0],
            effective_width_mm: 2.0,
        }],
        force_n: [0.0, 0.0, 600.0],
        forces: None,
        couple_n_mm: [0.0; 3],
        application: ApplicationPoint::Centroid,
    };
    let result = calculate(&input).unwrap();
    let mut p = Project {
        production_parameters: None,
        user_limits: None,
        materials: None,
        schema_version: 1,
        title: "Custom material test".into(),
        input,
        last_calculation: Some(result.clone()),
        casebook: None,
    };
    let store = ProjectStore::in_memory().unwrap();
    let old = store.save(&p).unwrap();
    assert!(!p.to_json().unwrap().contains("materials"));
    p.materials = Some(selection());
    p.validate().unwrap();
    assert_eq!(p.last_calculation, Some(result.clone()));
    assert_eq!(calculate(&p.input).unwrap(), result);
    let new = store.save(&p).unwrap();
    assert!(store.load(&old).unwrap().materials.is_none());
    assert_eq!(store.load(&new).unwrap(), p);
    assert_eq!(Project::from_json(&p.to_json().unwrap()).unwrap(), p);
    assert_eq!(
        p.last_calculation.unwrap().strength_status,
        weld_application::StrengthStatus::UnsupportedCalculation
    );
}
