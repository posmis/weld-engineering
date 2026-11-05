use weld_application::{
    calculate,
    geometry_templates::{generate, GeometryTemplateRequest, TemplateKind},
    geometry_transform::{transform, GeometryTransformRequest, MirrorAxis, Transform},
    ApplicationPoint, CalculationInput,
};
fn request(op: Transform) -> GeometryTransformRequest {
    GeometryTransformRequest {
        schema_version: 1,
        segments: generate(&GeometryTemplateRequest {
            schema_version: 1,
            kind: TemplateKind::LShape,
            width_mm: 100.0,
            height_mm: 40.0,
            effective_width_mm: 2.0,
            origin_mm: [0.0, 0.0],
        })
        .unwrap()
        .segments,
        transform: op,
    }
}
fn geometry(r: &GeometryTransformRequest) -> weld_application::GeometryResult {
    calculate(&CalculationInput {
        forces: None,
        schema_version: 1,
        segments: transform(r).unwrap().segments,
        force_n: [0.0; 3],
        couple_n_mm: [0.0; 3],
        application: ApplicationPoint::Centroid,
    })
    .unwrap()
    .geometry
}
fn near(a: f64, b: f64) {
    assert!(
        (a - b).abs() <= 1e-9 * a.abs().max(b.abs()).max(1.0),
        "{a} vs {b}"
    );
}
#[test]
fn translation_preserves_width_area_inertia_and_offsets_centre() {
    let mut r = request(Transform::Translate {
        delta_mm: [0.0, 0.0],
    });
    let g = geometry(&r);
    r.transform = Transform::Translate {
        delta_mm: [125.0, -50.0],
    };
    let moved = transform(&r).unwrap();
    let h = geometry(&r);
    assert_eq!(moved.segments[0].start_mm, [75.0, -70.0]);
    assert!(moved.segments.iter().all(|s| s.effective_width_mm == 2.0));
    near(h.area_mm2, g.area_mm2);
    near(h.ix_mm4, g.ix_mm4);
    near(h.iy_mm4, g.iy_mm4);
    near(h.ixy_mm4, g.ixy_mm4);
    near(h.centroid_mm[0], g.centroid_mm[0] + 125.0);
    near(h.centroid_mm[1], g.centroid_mm[1] - 50.0);
}
#[test]
fn quarter_turn_and_reflection_have_independent_centres_and_inertia_signs() {
    let mut r = request(Transform::Translate {
        delta_mm: [0.0, 0.0],
    });
    let g = geometry(&r);
    r.transform = Transform::Rotate {
        origin_mm: [10.0, -5.0],
        angle_deg: 450.0,
    };
    let turned = transform(&r).unwrap();
    assert_eq!(turned.segments[0].start_mm, [25.0, -65.0]);
    assert_eq!(turned.segments[0].end_mm, turned.segments[1].start_mm);
    let h = geometry(&r);
    near(h.centroid_mm[0], 5.0 - g.centroid_mm[1]);
    near(h.centroid_mm[1], g.centroid_mm[0] - 15.0);
    near(h.ix_mm4, g.iy_mm4);
    near(h.iy_mm4, g.ix_mm4);
    near(h.ixy_mm4, -g.ixy_mm4);
    for axis in [MirrorAxis::X, MirrorAxis::Y] {
        r.transform = Transform::Mirror {
            origin_mm: [10.0, -5.0],
            axis,
        };
        let h = geometry(&r);
        near(h.ix_mm4, g.ix_mm4);
        near(h.iy_mm4, g.iy_mm4);
        near(h.ixy_mm4, -g.ixy_mm4);
        match axis {
            MirrorAxis::X => {
                near(h.centroid_mm[0], g.centroid_mm[0]);
                near(h.centroid_mm[1], -10.0 - g.centroid_mm[1]);
            }
            MirrorAxis::Y => {
                near(h.centroid_mm[0], 20.0 - g.centroid_mm[0]);
                near(h.centroid_mm[1], g.centroid_mm[1]);
            }
        }
    }
}
#[test]
fn arbitrary_rotation_preserves_invariants_and_inverse_recovers_coordinates() {
    let mut r = request(Transform::Rotate {
        origin_mm: [15.0, -10.0],
        angle_deg: 37.0,
    });
    let before = r.segments.clone();
    let h = geometry(&r);
    near(h.area_mm2, 280.0);
    near(h.length_mm, 140.0);
    r.segments = transform(&r).unwrap().segments;
    r.transform = Transform::Rotate {
        origin_mm: [15.0, -10.0],
        angle_deg: -37.0,
    };
    let after = transform(&r).unwrap();
    for (a, b) in before.iter().zip(after.segments) {
        for (x, y) in a
            .start_mm
            .iter()
            .chain(a.end_mm.iter())
            .zip(b.start_mm.iter().chain(b.end_mm.iter()))
        {
            near(*x, *y);
        }
    }
}
#[test]
fn schema_invalid_source_nonfinite_overflow_and_precision_loss_are_rejected() {
    for op in [
        Transform::Translate {
            delta_mm: [f64::NAN, 0.0],
        },
        Transform::Rotate {
            origin_mm: [0.0, 0.0],
            angle_deg: f64::INFINITY,
        },
        Transform::Mirror {
            origin_mm: [f64::INFINITY, 0.0],
            axis: MirrorAxis::Y,
        },
        Transform::Translate {
            delta_mm: [1e308, 1e308],
        },
        Transform::Rotate {
            origin_mm: [1e308, 1e308],
            angle_deg: 45.0,
        },
    ] {
        assert!(transform(&request(op)).is_err());
    }
    let mut r = request(Transform::Translate {
        delta_mm: [0.0, 0.0],
    });
    r.schema_version = 2;
    assert!(transform(&r).is_err());
    r.schema_version = 1;
    r.segments[0].end_mm = r.segments[0].start_mm;
    assert!(transform(&r).is_err());
    let mut v = serde_json::to_value(request(Transform::Translate {
        delta_mm: [0.0, 0.0],
    }))
    .unwrap();
    v["transform"]["angle_deg"] = 10.into();
    assert!(serde_json::from_value::<GeometryTransformRequest>(v).is_err());
}
