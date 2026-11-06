use weld_application::{
    materials::{
        CustomProperty, MaterialCard, MaterialContext, MaterialKind, MaterialSelection,
        PropertyKind,
    },
    quantities::*,
    sections::SectionModel,
    SegmentInput,
};
fn request() -> QuantityRequest {
    QuantityRequest {
        schema_version: 1,
        segments: vec![SegmentInput {
            start_mm: [0.0, 0.0],
            end_mm: [100.0, 0.0],
            effective_width_mm: 2.4,
            section: Some(SectionModel::IdealizedRightAngleFillet {
                leg_1_mm: 3.0,
                leg_2_mm: 4.0,
            }),
        }],
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
                    thickness_mm: [0.0, 20.0],
                    temperature_c: [20.0, 20.0],
                    source: "User density Q-001".into(),
                }],
            }),
        }),
    }
}
#[test]
fn triangular_volume_and_si_mass_are_distinct_from_effective_area_and_preserve_source() {
    let r = request();
    let before = r.clone();
    let value = evaluate(&r).unwrap();
    assert_eq!(value.source, before);
    assert_eq!(r, before);
    assert!(value.complete);
    assert_eq!(value.volume_mm3, Some(600.0));
    assert_eq!(value.segments[0].section_area_mm2, Some(6.0));
    assert!((value.mass_kg.unwrap() - 0.0048).abs() < 1e-15);
    assert_eq!(value.density_source.as_deref(), Some("User density Q-001"));
    let mut doubled = r.clone();
    doubled.segments[0].effective_width_mm = 4.8;
    doubled.segments[0].section = Some(SectionModel::IdealizedRightAngleFillet {
        leg_1_mm: 6.0,
        leg_2_mm: 8.0,
    });
    let d = evaluate(&doubled).unwrap();
    assert_eq!(d.volume_mm3, Some(2400.0));
    assert!((d.mass_kg.unwrap() - 0.0192).abs() < 1e-15);
}
#[test]
fn unknown_sections_remain_unknown_and_partial_sum_is_explicit() {
    let mut r = request();
    r.segments.push(SegmentInput {
        start_mm: [0.0, 20.0],
        end_mm: [100.0, 20.0],
        effective_width_mm: 2.0,
        section: None,
    });
    let v = evaluate(&r).unwrap();
    assert!(!v.complete);
    assert_eq!(v.known_segments, 1);
    assert_eq!(v.known_volume_mm3, 600.0);
    assert!(v.volume_mm3.is_none() && v.mass_kg.is_none());
    assert!(v.segments[1].volume_mm3.is_none() && v.segments[1].mass_kg.is_none());
    r.segments.remove(0);
    let v = evaluate(&r).unwrap();
    assert_eq!(v.known_segments, 0);
    assert_eq!(v.known_volume_mm3, 0.0);
    assert!(v.volume_mm3.is_none());
}
#[test]
fn weld_density_is_never_taken_from_base_or_extrapolated() {
    let mut r = request();
    let material = r.materials.as_mut().unwrap();
    material.base = material.weld.take();
    let v = evaluate(&r).unwrap();
    assert_eq!(v.volume_mm3, Some(600.0));
    assert!(v.density_kg_m3.is_none() && v.mass_kg.is_none());
    r.materials.as_mut().unwrap().weld = r.materials.as_ref().unwrap().base.clone();
    r.materials.as_mut().unwrap().context.thickness_mm = 21.0;
    assert!(evaluate(&r).unwrap().mass_kg.is_none());
    r.materials.as_mut().unwrap().context.thickness_mm = 10.0;
    r.materials.as_mut().unwrap().context.temperature_c = 21.0;
    assert!(evaluate(&r).unwrap().mass_kg.is_none());
}
#[test]
fn versions_mismatched_sections_and_overflow_are_explicit_errors() {
    let mut r = request();
    r.schema_version = 2;
    assert_eq!(evaluate(&r).unwrap_err().code, "unsupported_schema");
    r.schema_version = 1;
    r.segments[0].effective_width_mm = 2.0;
    assert!(evaluate(&r).is_err());
    let mut r = request();
    r.segments[0].end_mm[0] = 1e10;
    r.materials
        .as_mut()
        .unwrap()
        .weld
        .as_mut()
        .unwrap()
        .properties[0]
        .value = f64::MAX;
    assert_eq!(evaluate(&r).unwrap_err().code, "numerical_range");
}
