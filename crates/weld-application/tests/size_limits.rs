use weld_application::{
    sections::SectionModel,
    size_limits::{self, SizeConstraint, SizeDimension, SizeStatus},
    SegmentInput,
};
fn segment() -> SegmentInput {
    SegmentInput {
        start_mm: [0.0, 0.0],
        end_mm: [100.0, 0.0],
        effective_width_mm: 2.4,
        section: Some(SectionModel::IdealizedRightAngleFillet {
            leg_1_mm: 3.0,
            leg_2_mm: 4.0,
        }),
    }
}
fn bound(dimension: SizeDimension, min: f64, max: f64) -> SizeConstraint {
    SizeConstraint {
        dimension,
        minimum_mm: min,
        maximum_mm: max,
        source: "User bound B-001".into(),
    }
}
#[test]
fn inclusive_explicit_width_and_leg_bounds_keep_per_segment_values_and_sources() {
    assert_eq!(serde_json::to_value(SizeDimension::Leg1).unwrap(), "leg_1");
    let input = vec![segment()];
    let before = input.clone();
    let constraints = vec![
        bound(SizeDimension::EffectiveWidth, 2.4, 2.4),
        bound(SizeDimension::Leg1, 3.0, 3.0),
        bound(SizeDimension::Leg2, 4.0, 4.0),
    ];
    let r = size_limits::evaluate(&input, &constraints)
        .unwrap()
        .unwrap();
    assert_eq!(input, before);
    assert_eq!(r.status, SizeStatus::WithinLimits);
    assert_eq!(r.checks[0].constraint, constraints[0]);
    assert_eq!(r.checks[0].values[0].value_mm, Some(2.4));
    assert_eq!(r.checks[1].values[0].value_mm, Some(3.0));
    assert_eq!(r.checks[2].values[0].value_mm, Some(4.0));
}
#[test]
fn missing_legs_are_unknown_and_known_violations_remain_explicit() {
    let mut s = segment();
    s.section = None;
    let r = size_limits::evaluate(&[s.clone()], &[bound(SizeDimension::Leg1, 1.0, 10.0)])
        .unwrap()
        .unwrap();
    assert_eq!(r.status, SizeStatus::Unknown);
    assert!(r.checks[0].values[0].value_mm.is_none());
    let r = size_limits::evaluate(
        &[s],
        &[
            bound(SizeDimension::EffectiveWidth, 3.0, 4.0),
            bound(SizeDimension::Leg1, 1.0, 10.0),
        ],
    )
    .unwrap()
    .unwrap();
    assert_eq!(r.status, SizeStatus::ExceedsLimits);
    assert_eq!(r.checks[1].status, SizeStatus::Unknown);
}
#[test]
fn duplicate_invalid_bounds_and_missing_sources_are_rejected_without_defaults() {
    for constraints in [
        vec![bound(SizeDimension::Leg1, 0.0, 2.0)],
        vec![bound(SizeDimension::Leg1, 3.0, 2.0)],
        vec![bound(SizeDimension::Leg1, f64::NAN, 2.0)],
        vec![bound(SizeDimension::Leg1, 1.0, f64::INFINITY)],
        vec![bound(SizeDimension::Leg1, 1.0, 2.0); 2],
        vec![SizeConstraint {
            source: " ".into(),
            ..bound(SizeDimension::Leg1, 1.0, 2.0)
        }],
        vec![SizeConstraint {
            source: "a".repeat(501),
            ..bound(SizeDimension::Leg1, 1.0, 2.0)
        }],
    ] {
        assert!(size_limits::validate(&constraints).is_err());
    }
    assert!(size_limits::evaluate(&[segment()], &[]).unwrap().is_none());
}
