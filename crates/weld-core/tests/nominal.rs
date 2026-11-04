use weld_core::{
    nominal::{nominal_traction, NominalTraction, PRECISION_LIMIT},
    *,
};
fn segment(a: [f64; 2], b: [f64; 2], width: f64) -> Segment {
    let point = |p: [f64; 2]| Point2 {
        x: Millimetres::new(p[0]).unwrap(),
        y: Millimetres::new(p[1]).unwrap(),
    };
    Segment {
        start: point(a),
        end: point(b),
        effective_width: Millimetres::new(width).unwrap(),
    }
}
fn parallel(y: f64) -> Vec<Segment> {
    vec![
        segment([-50.0, -y], [50.0, -y], 2.0),
        segment([-50.0, y], [50.0, y], 2.0),
    ]
}
fn solve(s: &[Segment], f: [f64; 3], m: [f64; 3]) -> Result<NominalTraction, Error> {
    nominal_traction(
        s,
        f.map(|v| Newtons::new(v).unwrap()),
        m.map(|v| NewtonMillimetres::new(v).unwrap()),
    )
}
fn near(a: f64, b: f64) {
    assert!((a - b).abs() <= 1e-9 * b.abs().max(1.0), "{a} != {b}");
}
fn asymmetric() -> Vec<Segment> {
    vec![
        segment([0.0, 0.0], [100.0, 0.0], 2.0),
        segment([100.0, 0.0], [100.0, 70.0], 3.0),
        segment([100.0, 70.0], [30.0, 90.0], 1.5),
    ]
}
#[test]
fn analytical_bending_about_x_has_the_right_sign_and_range() {
    // Two A=200 lines at y=+-20: Ix=160000; sigma=600/400 + y.
    let result = solve(&parallel(20.0), [0.0, 0.0, 600.0], [160000.0, 0.0, 0.0]).unwrap();
    near(result.segments[0].start[2].value(), -18.5);
    near(result.segments[1].end[2].value(), 21.5);
    near(result.normal_range[0].value(), -18.5);
    near(result.normal_range[1].value(), 21.5);
    near(
        result.bending_rcond.unwrap(),
        160000.0 / (400.0 * 10000.0 / 12.0),
    );
}
#[test]
fn analytical_bending_about_y_uses_negative_normal_gradient() {
    let result = solve(
        &parallel(20.0),
        [0.0; 3],
        [0.0, 400.0 * 10000.0 / 12.0, 0.0],
    )
    .unwrap();
    near(result.segments[0].start[2].value(), 50.0);
    near(result.segments[0].end[2].value(), -50.0);
}
#[test]
fn analytical_polar_torsion_field_is_tangential() {
    let j = 160000.0 + 400.0 * 10000.0 / 12.0;
    let result = solve(&parallel(20.0), [0.0; 3], [0.0, 0.0, j]).unwrap();
    near(result.segments[1].start[0].value(), -20.0);
    near(result.segments[1].start[1].value(), -50.0);
    near(result.max_shear.value(), 20.0_f64.hypot(50.0));
    assert_eq!(result.bending_rcond, None);
}
#[test]
fn independent_gauss_integration_recovers_all_six_resultants_on_an_unsymmetric_layout() {
    let s = asymmetric();
    let f = [123.0, -456.0, 789.0];
    let m = [15000.0, -27000.0, 45000.0];
    let result = solve(&s, f, m).unwrap();
    assert!(result.section.ixy.value().abs() > 1.0);
    let mut integrated = [0.0; 6];
    // Independent three-point Gauss-Legendre integration, not the solver's Simpson rule.
    let q = (3.0_f64 / 5.0).sqrt();
    for (line, stress) in s.iter().zip(&result.segments) {
        let area = line.effective_width.value()
            * (line.end.x.value() - line.start.x.value())
                .hypot(line.end.y.value() - line.start.y.value());
        for (z, weight) in [(-q, 5.0 / 18.0), (0.0, 4.0 / 9.0), (q, 5.0 / 18.0)] {
            let t = (z + 1.0) / 2.0;
            let x = (1.0 - t) * line.start.x.value() + t * line.end.x.value()
                - result.section.centroid.x.value();
            let y = (1.0 - t) * line.start.y.value() + t * line.end.y.value()
                - result.section.centroid.y.value();
            let v: [f64; 3] = std::array::from_fn(|i| {
                (1.0 - t) * stress.start[i].value() + t * stress.end[i].value()
            });
            let terms = [v[0], v[1], v[2], y * v[2], -x * v[2], x * v[1] - y * v[0]];
            for (total, term) in integrated.iter_mut().zip(terms) {
                *total += area * weight * term;
            }
        }
    }
    for (actual, expected) in integrated.into_iter().zip(f.into_iter().chain(m)) {
        near(actual, expected);
    }
    assert!(result.equilibrium_error < PRECISION_LIMIT);
}
#[test]
fn rotation_and_translation_preserve_the_stress_vector_field() {
    let s = asymmetric();
    let f = [123.0, -456.0, 789.0];
    let m = [15000.0, -27000.0, 45000.0];
    let angle = 0.63_f64;
    let (sin, cos) = angle.sin_cos();
    let rotate = |v: [f64; 3]| [cos * v[0] - sin * v[1], sin * v[0] + cos * v[1], v[2]];
    let transform = |p: Point2| {
        let r = rotate([p.x.value(), p.y.value(), 0.0]);
        [r[0] + 1000.0, r[1] - 2000.0]
    };
    let moved: Vec<_> = s
        .iter()
        .map(|l| {
            segment(
                transform(l.start),
                transform(l.end),
                l.effective_width.value(),
            )
        })
        .collect();
    let a = solve(&s, f, m).unwrap();
    let b = solve(&moved, rotate(f), rotate(m)).unwrap();
    for (x, y) in a.segments.iter().zip(&b.segments) {
        for (vx, vy) in [(x.start, y.start), (x.end, y.end)] {
            for (actual, expected) in vy
                .into_iter()
                .map(Megapascals::value)
                .zip(rotate(vx.map(Megapascals::value)))
            {
                near(actual, expected);
            }
        }
    }
}
#[test]
fn reversing_load_and_doubling_width_obey_superposition_and_area_scaling() {
    let s = asymmetric();
    let f = [123.0, -456.0, 789.0];
    let m = [15000.0, -27000.0, 45000.0];
    let wider: Vec<_> = s
        .iter()
        .map(|l| Segment {
            effective_width: Millimetres::new(l.effective_width.value() * 2.0).unwrap(),
            ..*l
        })
        .collect();
    let a = solve(&s, f, m).unwrap();
    let b = solve(&wider, f.map(|v| -v), m.map(|v| -v)).unwrap();
    for (x, y) in a.segments.iter().zip(&b.segments) {
        for (i, value) in x.start.iter().enumerate() {
            near(y.start[i].value(), -value.value() / 2.0);
            near(y.end[i].value(), -x.end[i].value() / 2.0);
        }
    }
}
#[test]
fn changing_geometry_scale_and_load_units_preserves_stress() {
    let s = asymmetric();
    let f = [123.0, -456.0, 789.0];
    let m = [15000.0, -27000.0, 45000.0];
    let a = solve(&s, f, m).unwrap();
    for k in [1e-3_f64, 1e3] {
        let scaled: Vec<_> = s
            .iter()
            .map(|l| {
                segment(
                    [l.start.x.value() * k, l.start.y.value() * k],
                    [l.end.x.value() * k, l.end.y.value() * k],
                    l.effective_width.value() * k,
                )
            })
            .collect();
        let b = solve(&scaled, f.map(|v| v * k.powi(2)), m.map(|v| v * k.powi(3))).unwrap();
        for (x, y) in a.segments.iter().zip(&b.segments) {
            for (i, value) in x.start.iter().enumerate() {
                near(y.start[i].value(), value.value());
                near(y.end[i].value(), x.end[i].value());
            }
        }
    }
}
#[test]
fn singular_bending_is_rejected_but_direct_loading_and_polar_torsion_are_available() {
    let s = [segment([-50.0, 0.0], [50.0, 0.0], 2.0)];
    assert!(matches!(
        solve(&s, [0.0; 3], [1e-30, 0.0, 0.0]),
        Err(Error::IllConditionedSection)
    ));
    let torsion = solve(&s, [0.0; 3], [0.0, 0.0, 1000.0]).unwrap();
    near(torsion.segments[0].end[1].value(), 0.3);
    let direct = solve(&s, [400.0, -200.0, 600.0], [0.0; 3]).unwrap();
    near(direct.segments[0].start[2].value(), 3.0);
}
#[test]
fn nearly_collinear_bending_is_refused_before_dividing_by_a_small_determinant() {
    assert!(matches!(
        solve(&parallel(1e-6), [0.0; 3], [1000.0, 0.0, 0.0]),
        Err(Error::IllConditionedSection)
    ));
    assert!(solve(&parallel(1.0), [0.0; 3], [1000.0, 0.0, 0.0]).is_ok());
}
#[test]
fn overflow_and_unrepresentable_tiny_loads_never_become_a_computed_zero_field() {
    assert!(matches!(
        solve(
            &[segment([0.0, 0.0], [1e-5, 0.0], 1e-10)],
            [f64::MAX, 0.0, 0.0],
            [0.0; 3]
        ),
        Err(Error::NumericalRange)
    ));
    assert!(matches!(
        solve(
            &[segment([0.0, 0.0], [1e25, 0.0], 1e25)],
            [1e-320, 0.0, 0.0],
            [0.0; 3]
        ),
        Err(Error::NumericalRange)
    ));
}
