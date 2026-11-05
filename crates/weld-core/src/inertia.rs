//! Quasi-static equivalent load for a translating lumped mass: F=m(g-a).
//! Acceleration belongs to the carried mass; the load acts on its attachment.
use crate::{Error, Kilograms, MetresPerSecondSquared, Newtons};
pub fn equivalent_force(
    mass: Kilograms,
    gravity: [MetresPerSecondSquared; 3],
    acceleration: [MetresPerSecondSquared; 3],
) -> Result<[Newtons; 3], Error> {
    if mass.value() <= 0.0 {
        return Err(Error::NonPositiveDimension);
    }
    let mut force = [Newtons::new(0.0)?; 3];
    for i in 0..3 {
        let g = gravity[i].value();
        let a = acceleration[i].value();
        let delta = g - a;
        // Opposite extreme accelerations can overflow subtraction even when
        // multiplication by a small mass gives a representable force.
        let value = if delta.is_finite() {
            mass.value() * delta
        } else {
            (mass.value() * (g * 0.5 - a * 0.5)) * 2.0
        };
        if !value.is_finite() || (g != a && (value == 0.0 || value.is_subnormal())) {
            return Err(Error::NumericalRange);
        }
        force[i] = Newtons::new(value)?;
    }
    Ok(force)
}
