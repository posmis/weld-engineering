use weld_application::{
    calculate,
    geometry_templates::{generate, GeometryTemplateRequest, TemplateKind},
    ApplicationPoint, CalculationInput,
};
fn request(kind: TemplateKind) -> GeometryTemplateRequest {
    GeometryTemplateRequest {
        schema_version: 1,
        kind,
        width_mm: 100.0,
        height_mm: 40.0,
        effective_width_mm: 2.0,
        origin_mm: [0.0, 0.0],
    }
}
fn geometry(request: &GeometryTemplateRequest) -> weld_application::GeometryResult {
    calculate(&CalculationInput {
        forces: None,
        schema_version: 1,
        segments: generate(request).unwrap().segments,
        force_n: [0.0; 3],
        couple_n_mm: [0.0; 3],
        application: ApplicationPoint::Centroid,
    })
    .unwrap()
    .geometry
}
#[test]
fn closed_rectangle_has_independent_perimeter_area_and_translated_centre() {
    let mut r = request(TemplateKind::Rectangle);
    r.origin_mm = [10.0, -5.0];
    let g = geometry(&r);
    assert_eq!(g.length_mm, 280.0);
    assert_eq!(g.area_mm2, 560.0);
    assert_eq!(g.centroid_mm, [10.0, -5.0]);
    assert!((g.ix_mm4 - 181333.33333333334).abs() < 1e-8);
    assert!((g.iy_mm4 - 733333.3333333334).abs() < 1e-8);
    assert!(g.ixy_mm4.abs() < 1e-8);
}
#[test]
fn open_group_centres_are_not_confused_with_the_bounding_box_origin() {
    let u = geometry(&request(TemplateKind::UShape));
    assert_eq!(u.length_mm, 180.0);
    assert_eq!(u.area_mm2, 360.0);
    assert!(u.centroid_mm[0].abs() < 1e-12);
    assert!((u.centroid_mm[1] + 100.0 / 9.0).abs() < 1e-12);
    let l = geometry(&request(TemplateKind::LShape));
    assert_eq!(l.area_mm2, 280.0);
    assert!((l.centroid_mm[0] + 100.0 / 7.0).abs() < 1e-12);
    assert!((l.centroid_mm[1] - 100.0 / 7.0).abs() < 1e-12);
    let parallel = geometry(&request(TemplateKind::Parallel));
    assert_eq!(parallel.length_mm, 200.0);
    assert_eq!(parallel.centroid_mm, [0.0, 0.0]);
}
#[test]
fn invalid_dimensions_schema_nonfinite_and_coordinate_collapse_are_rejected() {
    for change in 0..7 {
        let mut r = request(TemplateKind::Rectangle);
        match change {
            0 => r.width_mm = 0.0,
            1 => r.height_mm = -1.0,
            2 => r.effective_width_mm = f64::NAN,
            3 => r.origin_mm[1] = f64::INFINITY,
            4 => r.schema_version = 2,
            5 => r.origin_mm[0] = 1e308,
            _ => {
                r.origin_mm[0] = 1.7e308;
                r.width_mm = 1e308;
            }
        }
        assert!(generate(&r).is_err(), "change {change}");
    }
    let text = r#"{"schema_version":1,"kind":"rectangle","width_mm":100,"height_mm":40,"effective_width_mm":2,"origin_mm":[0,0],"leg_size_mm":2}"#;
    assert!(serde_json::from_str::<GeometryTemplateRequest>(text).is_err());
}
