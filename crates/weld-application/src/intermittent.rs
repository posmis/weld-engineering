//! Explicit intermittent geometry. No standard pitch, minimum length or strength
//! reduction is inferred: these remain engineer-supplied geometric dimensions.
use crate::{validate_input, AppError, CalculationInput, SegmentInput, MAX_SEGMENTS};
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IntermittentInput {
    pub input: CalculationInput,
    pub segment_index: usize,
    pub weld_length_mm: f64,
    pub pitch_mm: f64,
    pub count: u16,
}
pub fn generate(request: &IntermittentInput) -> Result<CalculationInput, AppError> {
    validate_input(&request.input)?;
    let error = || AppError::new("invalid_pattern", Some("intermittent"));
    let segment = request
        .input
        .segments
        .get(request.segment_index)
        .ok_or_else(error)?;
    let count = usize::from(request.count);
    if count == 0
        || count > MAX_SEGMENTS
        || request.input.segments.len() - 1 + count > MAX_SEGMENTS
        || !request.weld_length_mm.is_finite()
        || !request.pitch_mm.is_finite()
        || request.weld_length_mm <= 0.0
        || request.pitch_mm <= 0.0
        || (count > 1 && request.pitch_mm <= request.weld_length_mm)
    {
        return Err(error());
    }
    let dx = segment.end_mm[0] - segment.start_mm[0];
    let dy = segment.end_mm[1] - segment.start_mm[1];
    let span = dx.hypot(dy);
    let last = (count - 1) as f64 * request.pitch_mm + request.weld_length_mm;
    if !span.is_finite() || !last.is_finite() {
        return Err(AppError::new("numerical_range", None));
    }
    if last > span {
        return Err(error());
    }
    let point = |offset: f64| {
        if offset == 0.0 {
            segment.start_mm
        } else if offset == span {
            segment.end_mm
        } else {
            [
                segment.start_mm[0] + (dx / span) * offset,
                segment.start_mm[1] + (dy / span) * offset,
            ]
        }
    };
    let pieces = (0..count).map(|i| {
        let start = i as f64 * request.pitch_mm;
        SegmentInput {
            start_mm: point(start),
            end_mm: point(start + request.weld_length_mm),
            effective_width_mm: segment.effective_width_mm,
        }
    });
    let mut result = request.input.clone();
    result
        .segments
        .splice(request.segment_index..=request.segment_index, pieces);
    validate_input(&result)?;
    Ok(result)
}
