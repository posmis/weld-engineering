//! Simultaneously acting forces, each with an explicit application point.
use crate::{AppError, ApplicationPoint, CalculationInput};
use serde::{Deserialize, Serialize};
use weld_core::{Millimetres, NewtonMillimetres, Newtons};
pub const MAX_FORCES: usize = 64;
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AppliedForce {
    pub id: String,
    pub title: String,
    pub force_n: [f64; 3],
    pub application: ApplicationPoint,
}
pub fn validate(input: &CalculationInput) -> Result<(), AppError> {
    let Some(forces) = &input.forces else {
        return Ok(());
    };
    if forces.len() > MAX_FORCES
        || input.force_n.iter().any(|v| *v != 0.0)
        || input.application != ApplicationPoint::Centroid
    {
        return Err(AppError::new("invalid_forces", Some("forces")));
    }
    let mut ids = std::collections::HashSet::new();
    for f in forces {
        if f.id.trim().is_empty()
            || f.id.len() > 64
            || !ids.insert(&f.id)
            || f.title.trim().is_empty()
            || f.title.chars().count() > 100
        {
            return Err(AppError::new("invalid_forces", Some("forces")));
        }
        if !f.force_n.iter().all(|v| v.is_finite())
            || matches!(&f.application, ApplicationPoint::Point { point_mm } if !point_mm.iter().all(|v| v.is_finite()))
        {
            return Err(AppError::new("non_finite", Some("forces")));
        }
    }
    Ok(())
}
#[derive(Default, Clone, Copy)]
struct Sum {
    value: f64,
    correction: f64,
}
impl Sum {
    fn add(&mut self, v: f64) -> Result<(), AppError> {
        let next = self.value + v;
        self.correction += if self.value.abs() >= v.abs() {
            (self.value - next) + v
        } else {
            (v - next) + self.value
        };
        self.value = next;
        if !self.value.is_finite() || !self.correction.is_finite() {
            return Err(AppError::new("numerical_range", Some("forces")));
        }
        Ok(())
    }
    fn total(self) -> Result<f64, AppError> {
        let value = self.value + self.correction;
        if value.is_finite() {
            Ok(value)
        } else {
            Err(AppError::new("numerical_range", Some("forces")))
        }
    }
}
pub fn resultants(
    input: &CalculationInput,
    centre: [f64; 2],
) -> Result<([f64; 3], [f64; 3]), AppError> {
    let centroid = [
        Millimetres::new(centre[0])?,
        Millimetres::new(centre[1])?,
        Millimetres::new(0.0)?,
    ];
    let legacy = [AppliedForce {
        id: "legacy".into(),
        title: "F1".into(),
        force_n: input.force_n,
        application: input.application.clone(),
    }];
    let forces = input.forces.as_deref().unwrap_or(&legacy);
    let mut force = [Sum::default(); 3];
    let mut moment = [Sum::default(); 3];
    for (sum, value) in moment.iter_mut().zip(input.couple_n_mm) {
        sum.add(value)?;
    }
    for f in forces {
        let values = f.force_n.map(Newtons::new);
        let typed = [values[0].clone()?, values[1].clone()?, values[2].clone()?];
        let at = match f.application {
            ApplicationPoint::Centroid => centroid,
            ApplicationPoint::Point { point_mm } => [
                Millimetres::new(point_mm[0])?,
                Millimetres::new(point_mm[1])?,
                Millimetres::new(point_mm[2])?,
            ],
        };
        let m = weld_core::moment_about(typed, [NewtonMillimetres::new(0.0)?; 3], at, centroid)?;
        for (sum, value) in force.iter_mut().zip(f.force_n) {
            sum.add(value)?;
        }
        for (sum, value) in moment.iter_mut().zip(m) {
            sum.add(value.value())?;
        }
    }
    Ok((
        [force[0].total()?, force[1].total()?, force[2].total()?],
        [moment[0].total()?, moment[1].total()?, moment[2].total()?],
    ))
}
