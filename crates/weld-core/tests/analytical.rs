use weld_core::*;

fn mm(v: f64) -> Millimetres {
    Millimetres::new(v).unwrap()
}
fn point(x: f64, y: f64) -> Point2 {
    Point2 { x: mm(x), y: mm(y) }
}
fn line(x: f64, y: f64) -> Segment {
    Segment {
        start: point(x - 50.0, y),
        end: point(x + 50.0, y),
        effective_width: mm(2.0),
    }
}
fn near(a: f64, b: f64) {
    assert!((a - b).abs() <= 1e-9 * b.abs().max(1.0), "{a} != {b}");
}

#[test]
fn analytical_straight_section() {
    let p = properties(&[line(50.0, 0.0)]).unwrap();
    near(p.length.value(), 100.0);
    near(p.area.value(), 200.0);
    near(p.centroid.x.value(), 50.0);
    near(p.centroid.y.value(), 0.0);
    near(p.ix.value(), 0.0);
    near(p.iy.value(), 200.0 * 10000.0 / 12.0);
}

#[test]
fn parallel_sections_and_translation() {
    let a = properties(&[line(0.0, -20.0), line(0.0, 20.0)]).unwrap();
    near(a.area.value(), 400.0);
    near(a.ix.value(), 160000.0);
    near(a.iy.value(), 400.0 * 10000.0 / 12.0);
    near(a.ixy.value(), 0.0);
    let b = properties(&[line(123.0, 57.0), line(123.0, 97.0)]).unwrap();
    near(b.centroid.x.value(), 123.0);
    near(b.centroid.y.value(), 77.0);
    near(a.ix.value(), b.ix.value());
    near(a.iy.value(), b.iy.value());
}

#[test]
fn force_moment_and_sign() {
    for sign in [-1.0, 0.0, 1.0] {
        let f = [0.0, sign * 10.0, 0.0].map(|v| Newtons::new(v).unwrap());
        let m = moment_about(
            f,
            [NewtonMillimetres::new(0.0).unwrap(); 3],
            [mm(100.0), mm(0.0), mm(0.0)],
            [mm(0.0); 3],
        )
        .unwrap();
        near(m[2].value(), sign * 1000.0);
    }
}

#[test]
fn rejects_invalid_inputs_and_unverified_strength() {
    assert_eq!(Millimetres::new(f64::NAN), Err(Error::NonFinite));
    assert!(matches!(properties(&[]), Err(Error::EmptyGroup)));
    let mut s = line(0.0, 0.0);
    s.end = s.start;
    assert!(matches!(properties(&[s]), Err(Error::ZeroLength)));
    s = line(0.0, 0.0);
    s.effective_width = mm(-1.0);
    assert!(matches!(properties(&[s]), Err(Error::NonPositiveDimension)));
    assert_eq!(assess_strength(), Err(Error::UnsupportedMethod));
}

#[test]
fn direct_traction_matches_independent_force_balance() {
    // A = 2 mm * 100 mm = 200 mm², so F/A = (2, -1, 3) MPa.
    let f = [400.0, -200.0, 600.0].map(|v| Newtons::new(v).unwrap());
    let result = centred_direct_traction(&[line(0.0, 0.0)], f).unwrap();
    near(result.shear_x.value(), 2.0);
    near(result.shear_y.value(), -1.0);
    near(result.normal_z.value(), 3.0);
}

#[test]
fn direct_traction_obeys_linear_load_and_area_invariants() {
    for sign in [-1.0, 0.0, 1.0] {
        let f = [400.0 * sign, -200.0 * sign, 600.0 * sign].map(|v| Newtons::new(v).unwrap());
        let a = centred_direct_traction(&[line(0.0, 0.0)], f).unwrap();
        let mut wider = line(0.0, 0.0);
        wider.effective_width = mm(4.0);
        let b = centred_direct_traction(&[wider], f).unwrap();
        near(a.shear_x.value(), 2.0 * sign);
        near(a.shear_y.value(), -sign);
        near(a.normal_z.value(), 3.0 * sign);
        near(b.normal_z.value(), a.normal_z.value() / 2.0);
    }
}

#[test]
fn direct_traction_does_not_hide_invalid_section() {
    let f = [Newtons::new(0.0).unwrap(); 3];
    assert!(matches!(
        centred_direct_traction(&[], f),
        Err(Error::EmptyGroup)
    ));
}

#[test]
fn quarter_rotation_exchanges_second_moments_and_preserves_polar() {
    let horizontal = line(20.0, 10.0);
    let rotate = |p: Point2| point(-p.y.value(), p.x.value());
    let vertical = Segment {
        start: rotate(horizontal.start),
        end: rotate(horizontal.end),
        effective_width: horizontal.effective_width,
    };
    let a = properties(&[horizontal]).unwrap();
    let b = properties(&[vertical]).unwrap();
    near(a.ix.value(), b.iy.value());
    near(a.iy.value(), b.ix.value());
    near(a.polar.value(), b.polar.value());
    near(b.centroid.x.value(), -a.centroid.y.value());
    near(b.centroid.y.value(), a.centroid.x.value());
}

#[test]
fn translating_reference_and_application_preserves_moment() {
    let f = [3.0, 5.0, 7.0].map(|v| Newtons::new(v).unwrap());
    let m = [NewtonMillimetres::new(0.0).unwrap(); 3];
    let a = moment_about(f, m, [mm(10.0), mm(20.0), mm(30.0)], [mm(0.0); 3]).unwrap();
    let b = moment_about(
        f,
        m,
        [mm(110.0), mm(-30.0), mm(37.0)],
        [mm(100.0), mm(-50.0), mm(7.0)],
    )
    .unwrap();
    for i in 0..3 {
        near(a[i].value(), b[i].value());
    }
}

#[test]
fn underflowing_segment_area_cannot_silently_disappear_from_group() {
    let tiny = Segment {
        start: point(0.0, 0.0),
        end: point(1e-200, 0.0),
        effective_width: mm(1e-200),
    };
    assert!(matches!(
        properties(&[line(0.0, 0.0), tiny]),
        Err(Error::NumericalRange)
    ));
}
