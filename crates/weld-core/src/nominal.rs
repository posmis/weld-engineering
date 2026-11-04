//! Affine nominal tractions on user-defined XY line elements, not weld resistance.
use crate::{properties, Error, Megapascals, NewtonMillimetres, Newtons, Properties, Segment};

/// Numerical precision policy, not an engineering/geometric tolerance.
pub const PRECISION_LIMIT: f64 = 1.490_116_119_384_765_6e-8; // sqrt(f64::EPSILON)
#[derive(Debug, Clone)]
pub struct SegmentTraction {
    pub start: [Megapascals; 3],
    pub end: [Megapascals; 3],
}
#[derive(Debug, Clone)]
pub struct NominalTraction {
    pub section: Properties,
    pub segments: Vec<SegmentTraction>,
    pub normal_range: [Megapascals; 2],
    pub max_shear: Megapascals,
    pub bending_rcond: Option<f64>,
    pub equilibrium_error: f64,
}

/// t = (Fx/A - Mz*y/J, Fy/A + Mz*x/J, Fz/A + bx*x + by*y).
/// K*[bx,by] = [-My,Mx], K = [[Iy,Ixy],[Ixy,Ix]].
/// This is an assumed nominal field, not Saint-Venant torsion or a local throat model.
pub fn nominal_traction(
    segments: &[Segment],
    force: [Newtons; 3],
    moment: [NewtonMillimetres; 3],
) -> Result<NominalTraction, Error> {
    let section = properties(segments)?;
    let f = force.map(Newtons::value);
    let m = moment.map(NewtonMillimetres::value);
    let direct = f.map(|v| v / section.area.value());
    let mut bx = 0.0;
    let mut by = 0.0;
    let mut bending_rcond = None;
    if m[0] != 0.0 || m[1] != 0.0 {
        let scale = section.ix.value().max(section.iy.value());
        if scale <= 0.0 {
            return Err(Error::IllConditionedSection);
        }
        let xx = section.iy.value() / scale;
        let yy = section.ix.value() / scale;
        let xy = section.ixy.value() / scale;
        let determinant = xx.mul_add(yy, -xy * xy);
        let largest = (xx + yy) / 2.0 + ((xx - yy) / 2.0).hypot(xy);
        let rcond = determinant / largest.powi(2);
        if !rcond.is_finite() || rcond <= PRECISION_LIMIT {
            return Err(Error::IllConditionedSection);
        }
        bending_rcond = Some(rcond.min(1.0));
        let rx = -m[1] / scale;
        let ry = m[0] / scale;
        bx = rx.mul_add(yy, -ry * xy) / determinant;
        by = ry.mul_add(xx, -rx * xy) / determinant;
    }
    let torsion = if m[2] == 0.0 {
        0.0
    } else {
        if section.polar.value() <= 0.0 {
            return Err(Error::NumericalRange);
        }
        m[2] / section.polar.value()
    };
    if direct
        .iter()
        .chain([bx, by, torsion].iter())
        .any(|v| !v.is_finite())
    {
        return Err(Error::NumericalRange);
    }
    let mut values = Vec::with_capacity(segments.len());
    let mut normal_min = f64::INFINITY;
    let mut normal_max = f64::NEG_INFINITY;
    let mut max_shear: f64 = 0.0;
    let mut totals = [0.0; 6];
    let mut scales = [0.0; 6];
    for segment in segments {
        let positions = [segment.start, segment.end].map(|p| {
            [
                p.x.value() - section.centroid.x.value(),
                p.y.value() - section.centroid.y.value(),
            ]
        });
        let traction = positions.map(|[x, y]| {
            [
                (-torsion).mul_add(y, direct[0]),
                torsion.mul_add(x, direct[1]),
                bx.mul_add(x, by.mul_add(y, direct[2])),
            ]
        });
        if traction.iter().flatten().any(|v| !v.is_finite()) {
            return Err(Error::NumericalRange);
        }
        for value in traction {
            normal_min = normal_min.min(value[2]);
            normal_max = normal_max.max(value[2]);
            max_shear = max_shear.max(value[0].hypot(value[1]));
        }
        let area = segment.effective_width.value()
            * (segment.end.x.value() - segment.start.x.value())
                .hypot(segment.end.y.value() - segment.start.y.value());
        // Simpson integration is exact for degree-two r cross t on a straight line.
        let positions_mid: [f64; 2] =
            std::array::from_fn(|i| positions[0][i] / 2.0 + positions[1][i] / 2.0);
        let traction_mid: [f64; 3] =
            std::array::from_fn(|i| traction[0][i] / 2.0 + traction[1][i] / 2.0);
        for (i, mid) in traction_mid.iter().enumerate() {
            totals[i] += area * mid;
            scales[i] += area * (traction[0][i].abs() / 2.0 + traction[1][i].abs() / 2.0);
        }
        for (position, t, weight) in [
            (positions[0], traction[0], 1.0 / 6.0),
            (positions_mid, traction_mid, 2.0 / 3.0),
            (positions[1], traction[1], 1.0 / 6.0),
        ] {
            let moments = [
                position[1] * t[2],
                -position[0] * t[2],
                position[0].mul_add(t[1], -position[1] * t[0]),
            ];
            let bounds = [
                position[1].abs() * t[2].abs(),
                position[0].abs() * t[2].abs(),
                position[0].abs() * t[1].abs() + position[1].abs() * t[0].abs(),
            ];
            for (i, (moment, bound)) in moments.into_iter().zip(bounds).enumerate() {
                totals[i + 3] += area * (weight * moment);
                scales[i + 3] += area * (weight * bound);
            }
        }
        let typed = |v: [f64; 3]| -> Result<[Megapascals; 3], Error> {
            Ok([
                Megapascals::new(v[0])?,
                Megapascals::new(v[1])?,
                Megapascals::new(v[2])?,
            ])
        };
        values.push(SegmentTraction {
            start: typed(traction[0])?,
            end: typed(traction[1])?,
        });
    }
    let mut equilibrium_error: f64 = 0.0;
    for (i, target) in f.into_iter().chain(m).enumerate() {
        // A nonzero requested component must be reproduced relative to itself;
        // a large cancelling background must not hide a tiny lost load.
        let denominator = if target != 0.0 {
            target.abs()
        } else {
            scales[i]
        };
        let residual = (totals[i] - target).abs();
        if !scales[i].is_finite() || !denominator.is_finite() || !residual.is_finite() {
            return Err(Error::NumericalRange);
        }
        let error = if denominator == 0.0 {
            if residual == 0.0 {
                0.0
            } else {
                1.0
            }
        } else {
            residual / denominator
        };
        equilibrium_error = equilibrium_error.max(error);
    }
    if equilibrium_error > PRECISION_LIMIT {
        return Err(Error::NumericalRange);
    }
    Ok(NominalTraction {
        section,
        segments: values,
        normal_range: [Megapascals::new(normal_min)?, Megapascals::new(normal_max)?],
        max_shear: Megapascals::new(max_shear)?,
        bending_rcond,
        equilibrium_error,
    })
}
