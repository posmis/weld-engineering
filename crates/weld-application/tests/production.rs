use weld_application::{
    materials::{
        CustomProperty, MaterialCard, MaterialContext, MaterialKind, MaterialSelection,
        PropertyKind,
    },
    production::{self, ProductionParameters, ProductionRequest},
    projects::{Project, ProjectStore},
    sections::SectionModel,
    ApplicationPoint, CalculationInput, SegmentInput,
};
fn parameters() -> ProductionParameters {
    ProductionParameters {
        process_label: "User process P-001".into(),
        currency_label: "RUB".into(),
        source: "Cost scenario P-001".into(),
        travel_speed_mm_min: 100.0,
        passes: 2,
        arc_time_fraction: 0.5,
        preparation_minutes: 10.0,
        inspection_minutes: 5.0,
        labor_rate_per_hour: 600.0,
        equipment_rate_per_hour: 300.0,
        consumable_price_per_kg: 200.0,
        deposition_efficiency: 0.9,
        external_inspection_cost: 50.0,
    }
}
fn request() -> ProductionRequest {
    ProductionRequest {
        schema_version: 1,
        segments: [-20.0, 20.0]
            .into_iter()
            .map(|y| SegmentInput {
                start_mm: [-50.0, y],
                end_mm: [50.0, y],
                effective_width_mm: 9.0,
                section: Some(SectionModel::IdealizedRightAngleFillet {
                    leg_1_mm: 11.25,
                    leg_2_mm: 15.0,
                }),
            })
            .collect(),
        materials: Some(MaterialSelection {
            context: MaterialContext {
                thickness_mm: 10.0,
                temperature_c: 20.0,
            },
            base: None,
            weld: Some(MaterialCard {
                kind: MaterialKind::Custom,
                designation: "Synthetic weld".into(),
                product_form: None,
                condition: None,
                properties: vec![CustomProperty {
                    kind: PropertyKind::Density,
                    value: 8000.0,
                    thickness_mm: [0.0, 100.0],
                    temperature_c: [20.0, 20.0],
                    source: "User density P-001".into(),
                }],
            }),
        }),
        parameters: parameters(),
    }
}
#[test]
fn independent_single_operation_time_and_cost_reference_uses_mass_efficiency_and_explicit_rates() {
    let r = request();
    let before = r.clone();
    let value = production::evaluate(&r).unwrap();
    assert_eq!(r, before);
    assert_eq!(value.source, before);
    assert_eq!(value.arc_on_minutes, 4.0);
    assert_eq!(value.welding_elapsed_minutes, 8.0);
    assert_eq!(value.total_minutes, 23.0);
    assert!((value.labor_cost - 230.0).abs() < 1e-10);
    assert!((value.equipment_cost - 40.0).abs() < 1e-10);
    assert_eq!(value.external_inspection_cost, 50.0);
    assert!((value.known_subtotal - 320.0).abs() < 1e-10);
    assert!((value.consumed_mass_kg.unwrap() - 0.15).abs() < 1e-12);
    assert!((value.material_cost.unwrap() - 30.0).abs() < 1e-12);
    assert!((value.total_cost.unwrap() - 350.0).abs() < 1e-12);
    assert!(value.complete);
}
#[test]
fn missing_density_or_section_does_not_become_zero_or_a_complete_cheap_total() {
    let mut r = request();
    r.materials.as_mut().unwrap().weld = None;
    let v = production::evaluate(&r).unwrap();
    assert!(
        !v.complete
            && v.total_cost.is_none()
            && v.material_cost.is_none()
            && v.consumed_mass_kg.is_none()
    );
    assert!((v.known_subtotal - 320.0).abs() < 1e-10);
    r = request();
    r.segments[0].section = None;
    r.parameters.consumable_price_per_kg = 0.0;
    let v = production::evaluate(&r).unwrap();
    assert!(!v.complete && v.total_cost.is_none());
    assert_eq!(v.arc_on_minutes, 4.0);
}
#[test]
fn explicit_zero_rates_are_valid_but_overflow_and_invalid_parameters_never_become_cheap_results() {
    let mut r = request();
    r.parameters.labor_rate_per_hour = 0.0;
    r.parameters.equipment_rate_per_hour = 0.0;
    r.parameters.consumable_price_per_kg = 0.0;
    r.parameters.external_inspection_cost = 0.0;
    assert_eq!(production::evaluate(&r).unwrap().total_cost, Some(0.0));
    r.parameters.travel_speed_mm_min = f64::MIN_POSITIVE;
    assert_eq!(
        production::evaluate(&r).unwrap_err().code,
        "numerical_range"
    );
    for p in [
        ProductionParameters {
            passes: 0,
            ..parameters()
        },
        ProductionParameters {
            arc_time_fraction: 1.1,
            ..parameters()
        },
        ProductionParameters {
            deposition_efficiency: 0.0,
            ..parameters()
        },
        ProductionParameters {
            labor_rate_per_hour: -1.0,
            ..parameters()
        },
        ProductionParameters {
            source: " ".into(),
            ..parameters()
        },
        ProductionParameters {
            currency_label: "".into(),
            ..parameters()
        },
        ProductionParameters {
            travel_speed_mm_min: f64::NAN,
            ..parameters()
        },
    ] {
        assert!(production::validate(&p).is_err());
    }
}
#[test]
fn project_sqlite_and_json_keep_cost_parameters_without_changing_nominal_snapshots() {
    let r = request();
    let input = CalculationInput {
        schema_version: 1,
        segments: r.segments,
        force_n: [0.0, 0.0, 600.0],
        couple_n_mm: [0.0; 3],
        application: ApplicationPoint::Centroid,
        forces: None,
    };
    let calculated = weld_application::calculate(&input).unwrap();
    let p = Project {
        production_parameters: Some(r.parameters),
        materials: r.materials,
        user_limits: None,
        schema_version: 1,
        title: "Production reference".into(),
        input,
        last_calculation: Some(calculated),
        casebook: None,
    };
    let store = ProjectStore::in_memory().unwrap();
    let old = store.save(&p).unwrap();
    let mut changed = p.clone();
    changed
        .production_parameters
        .as_mut()
        .unwrap()
        .travel_speed_mm_min = 200.0;
    let new = store.save(&changed).unwrap();
    assert_eq!(store.load(&old).unwrap(), p);
    assert_eq!(store.load(&new).unwrap(), changed);
    assert_eq!(changed.last_calculation, p.last_calculation);
    assert_eq!(
        Project::from_json(&changed.to_json().unwrap()).unwrap(),
        changed
    );
    let mut old_json = serde_json::to_value(&p).unwrap();
    old_json
        .as_object_mut()
        .unwrap()
        .remove("production_parameters");
    assert!(Project::from_json(&old_json.to_string())
        .unwrap()
        .production_parameters
        .is_none());
}
