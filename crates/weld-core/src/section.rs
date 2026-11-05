//! Geometric idealization only. No process, GOST eligibility or strength rule.
use crate::{Error, Millimetres};
/// Altitude from a 90-degree root to the straight face joining the two toes.
/// Assumes a right triangular section, no credited penetration and no concavity.
pub fn right_angle_fillet_throat(
    leg_1: Millimetres,
    leg_2: Millimetres,
) -> Result<Millimetres, Error> {
    let a = leg_1.value();
    let b = leg_2.value();
    if a <= 0.0 || b <= 0.0 {
        return Err(Error::NonPositiveDimension);
    }
    let low = a.min(b);
    let high = a.max(b);
    // low / hypot(1, low/high) avoids overflow in both the product and chord.
    let denominator = 1.0_f64.hypot(low / high);
    let throat = low / denominator;
    if !throat.is_finite()
        || throat <= 0.0
        || (throat / low - 1.0 / denominator).abs() > f64::EPSILON.sqrt()
    {
        return Err(Error::NumericalRange);
    }
    Millimetres::new(throat)
}
