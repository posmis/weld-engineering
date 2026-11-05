import { expect, test } from 'vitest';
import { contourColour, contourField, zeroStop } from './stressContour';
import { newProject, type CalculationResult } from './contracts';
const input = newProject().input;
function result(): CalculationResult {
  return { schema_version: 1, engine_version: 'fixture', method_id: 'elastic-line-traction-v1', input_snapshot: input,
    geometry: { length_mm: 100, area_mm2: 200, centroid_mm: [0, 0], ix_mm4: 0, iy_mm4: 1, ixy_mm4: 0, polar_mm4: 1 },
    moment_at_centroid_n_mm: [0, 0, 10], traction_mpa: null, distribution: { segments: [{ start_mpa: [-8, -5, -2], end_mpa: [4, 5, 10] }], normal_range_mpa: [-2, 10], max_shear_mpa: 10, bending_rcond: null, equilibrium_error: 0 },
    analysis_status: 'computed', strength_status: 'unsupported_calculation', validation_status: 'not_independently_validated', warnings: [] };
}
test('the colour map uses signed stored endpoint components, including the exact neutral crossing', () => {
  const field = contourField(input, result(), 0)!;
  expect(field.pairs).toEqual([[-8, 4]]); expect(field.extent).toBe(8);
  expect(zeroStop(-8, 4, 8)).toBeCloseTo(2 / 3);
  expect(contourColour(-8, 8)).toBe('rgb(38,91,187)'); expect(contourColour(0, 8)).toBe('rgb(244,246,248)');
});
test('stale, unsupported and incomplete results never produce a coloured map', () => {
  const stale = { ...input, force_n: [0, 0, 1] as [number, number, number] };
  expect(contourField(stale, result(), 2)).toBeNull();
  expect(contourField(input, { ...result(), analysis_status: 'unsupported_loading' }, 2)).toBeNull();
  const missing = result(); missing.distribution!.segments = []; expect(contourField(input, missing, 2)).toBeNull();
});
test('uniform zero loading has a finite neutral scale; extreme values do not overflow the colour interpolation', () => {
  const uniform = { ...result(), traction_mpa: [0, 0, 0] as [number, number, number], distribution: undefined };
  const field = contourField(input, uniform, 2)!;
  expect(field.extent).toBe(0); expect(contourColour(0, 0)).toBe('rgb(244,246,248)'); expect(zeroStop(0, 0, 0)).toBeNull();
  expect(zeroStop(-Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE)).toBe(.5);
});

test('signed zero normalisation at JSON IPC does not hide a current contour', () => {
  const signed = { ...input, force_n: [-0, 0, 600] as [number, number, number] };
  expect(contourField(signed, result(), 2)?.pairs).toEqual([[-2, 10]]);
});
