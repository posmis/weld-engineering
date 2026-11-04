//! Experimental mathematical primitives. No normative strength assessment.

#[derive(Debug, Clone, PartialEq)]
pub enum Error {
    NonFinite,
    NonPositiveDimension,
    EmptyGroup,
    ZeroLength,
    NumericalRange,
    UnsupportedMethod,
}

macro_rules! unit {
    ($name:ident) => {
        #[derive(Debug, Clone, Copy, PartialEq)]
        pub struct $name(f64);
        impl $name {
            pub fn new(value: f64) -> Result<Self, Error> {
                if !value.is_finite() {
                    return Err(Error::NonFinite);
                }
                Ok(Self(value))
            }
            pub fn value(self) -> f64 {
                self.0
            }
        }
    };
}
unit!(Millimetres);
unit!(Newtons);
unit!(NewtonMillimetres);
unit!(SquareMillimetres);
unit!(FourthPowerMillimetres);
unit!(Megapascals);

#[derive(Debug, Clone, Copy)]
pub struct Point2 {
    pub x: Millimetres,
    pub y: Millimetres,
}

#[derive(Debug, Clone, Copy)]
pub struct Segment {
    pub start: Point2,
    pub end: Point2,
    /// User-supplied mathematical width; NOT derived from penetration or leg size.
    pub effective_width: Millimetres,
}

#[derive(Debug, Clone, Copy)]
pub struct Properties {
    pub length: Millimetres,
    pub area: SquareMillimetres,
    pub centroid: Point2,
    pub ix: FourthPowerMillimetres,
    pub iy: FourthPowerMillimetres,
    pub ixy: FourthPowerMillimetres,
    pub polar: FourthPowerMillimetres,
}

/// Integrates constant-width line elements in XY. See docs/engineering-methods.md.
/// A straight line is valid for geometry, even though some stress methods are singular.
pub fn properties(segments: &[Segment]) -> Result<Properties, Error> {
    if segments.is_empty() {
        return Err(Error::EmptyGroup);
    }
    let mut items = Vec::with_capacity(segments.len());
    let (mut length, mut area, mut sx, mut sy) = (0.0, 0.0, 0.0, 0.0);
    for s in segments {
        let a = s.effective_width.value();
        if a <= 0.0 {
            return Err(Error::NonPositiveDimension);
        }
        let dx = s.end.x.value() - s.start.x.value();
        let dy = s.end.y.value() - s.start.y.value();
        let l = dx.hypot(dy);
        if l == 0.0 {
            return Err(Error::ZeroLength);
        }
        let weight = a * l;
        let cx = s.start.x.value() * 0.5 + s.end.x.value() * 0.5;
        let cy = s.start.y.value() * 0.5 + s.end.y.value() * 0.5;
        length += l;
        area += weight;
        sx += weight * cx;
        sy += weight * cy;
        items.push((weight, cx, cy, dx, dy));
    }
    if !area.is_finite() || area <= 0.0 {
        return Err(Error::NumericalRange);
    }
    let (cx, cy) = (sx / area, sy / area);
    let (mut ix, mut iy, mut ixy) = (0.0, 0.0, 0.0);
    for (a, x, y, dx, dy) in items {
        ix += a * ((y - cy).powi(2) + dy * dy / 12.0);
        iy += a * ((x - cx).powi(2) + dx * dx / 12.0);
        ixy += a * ((x - cx) * (y - cy) + dx * dy / 12.0);
    }
    if [length, cx, cy, ix, iy, ixy, ix + iy]
        .iter()
        .any(|v| !v.is_finite())
    {
        return Err(Error::NumericalRange);
    }
    Ok(Properties {
        length: Millimetres::new(length)?,
        area: SquareMillimetres::new(area)?,
        centroid: Point2 {
            x: Millimetres::new(cx)?,
            y: Millimetres::new(cy)?,
        },
        ix: FourthPowerMillimetres::new(ix)?,
        iy: FourthPowerMillimetres::new(iy)?,
        ixy: FourthPowerMillimetres::new(ixy)?,
        polar: FourthPowerMillimetres::new(ix + iy)?,
    })
}

/// Right-handed coordinates. Returns M + (P - O) cross F, in N mm.
pub fn moment_about(
    force: [Newtons; 3],
    couple: [NewtonMillimetres; 3],
    application: [Millimetres; 3],
    reference: [Millimetres; 3],
) -> Result<[NewtonMillimetres; 3], Error> {
    let r = std::array::from_fn::<_, 3, _>(|i| application[i].value() - reference[i].value());
    let f = force.map(Newtons::value);
    let cross = [
        r[1] * f[2] - r[2] * f[1],
        r[2] * f[0] - r[0] * f[2],
        r[0] * f[1] - r[1] * f[0],
    ];
    Ok([
        NewtonMillimetres::new(couple[0].value() + cross[0])?,
        NewtonMillimetres::new(couple[1].value() + cross[1])?,
        NewtonMillimetres::new(couple[2].value() + cross[2])?,
    ])
}

/// No verified strength method has been imported. Never returns a pass result.
pub fn assess_strength() -> Result<(), Error> {
    Err(Error::UnsupportedMethod)
}

/// Nominal uniform traction on a user-defined effective section in the XY plane.
/// This is F/A only, with force applied at the section centroid and no couple.
/// No weld orientation transformation, resistance or acceptance check is implied.
#[derive(Debug, Clone, Copy)]
pub struct DirectTraction {
    pub section: Properties,
    pub shear_x: Megapascals,
    pub shear_y: Megapascals,
    pub normal_z: Megapascals,
}

/// Centred, static direct loading only. Eccentric loading must not use this method.
/// N/mm² equals MPa exactly; see docs/engineering-methods.md.
pub fn centred_direct_traction(
    segments: &[Segment],
    force_at_centroid: [Newtons; 3],
) -> Result<DirectTraction, Error> {
    let section = properties(segments)?;
    let area = section.area.value();
    Ok(DirectTraction {
        section,
        shear_x: Megapascals::new(force_at_centroid[0].value() / area)?,
        shear_y: Megapascals::new(force_at_centroid[1].value() / area)?,
        normal_z: Megapascals::new(force_at_centroid[2].value() / area)?,
    })
}
