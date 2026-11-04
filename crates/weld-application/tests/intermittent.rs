use weld_application::{
    calculate,
    intermittent::{generate, IntermittentInput},
    ApplicationPoint, CalculationInput, SegmentInput,
};
fn request() -> IntermittentInput {
    IntermittentInput {
        input: CalculationInput {
            schema_version: 1,
            segments: vec![SegmentInput {
                start_mm: [-50.0, 0.0],
                end_mm: [50.0, 0.0],
                effective_width_mm: 2.0,
            }],
            force_n: [0.0, 0.0, 600.0],
            couple_n_mm: [0.0; 3],
            application: ApplicationPoint::Centroid,
        },
        segment_index: 0,
        weld_length_mm: 20.0,
        pitch_mm: 40.0,
        count: 3,
    }
}
#[test]
fn gaps_contribute_no_area_and_analytical_stress_uses_only_actual_weld_length() {
    let input = generate(&request()).unwrap();
    assert_eq!(input.segments.len(), 3);
    assert_eq!(input.segments[0].start_mm, [-50.0, 0.0]);
    assert_eq!(input.segments[0].end_mm, [-30.0, 0.0]);
    assert_eq!(input.segments[1].start_mm, [-10.0, 0.0]);
    assert_eq!(input.segments[2].end_mm, [50.0, 0.0]);
    let result = calculate(&input).unwrap();
    assert_eq!(result.geometry.length_mm, 60.0);
    assert_eq!(result.geometry.area_mm2, 120.0);
    assert_eq!(result.traction_mpa.unwrap()[2], 5.0);
}
#[test]
fn direction_and_effective_width_are_preserved_for_an_oblique_reversed_weld() {
    let mut r = request();
    r.input.segments[0].start_mm = [60.0, 80.0];
    r.input.segments[0].end_mm = [0.0, 0.0];
    let input = generate(&r).unwrap();
    assert_eq!(input.segments[0].end_mm, [48.0, 64.0]);
    assert_eq!(input.segments[2].end_mm, [0.0, 0.0]);
    assert!(input.segments.iter().all(|s| s.effective_width_mm == 2.0));
}
#[test]
fn invalid_patterns_and_existing_or_generated_intersections_are_rejected() {
    for change in 0..7 {
        let mut r = request();
        match change {
            0 => r.count = 0,
            1 => r.count = 257,
            2 => r.weld_length_mm = f64::NAN,
            3 => r.pitch_mm = 20.0,
            4 => r.pitch_mm = 41.0,
            5 => r.segment_index = 1,
            _ => r.input.segments.push(SegmentInput {
                start_mm: [0.0, -10.0],
                end_mm: [0.0, 10.0],
                effective_width_mm: 2.0,
            }),
        }
        assert!(generate(&r).is_err(), "change {change}");
    }
}
