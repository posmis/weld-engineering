import type { CalculationInput, CalculationResult } from './contracts';
export type StressComponent = 0 | 1 | 2;
export interface ContourField { pairs: [number, number][]; extent: number }
// JSON IPC normalises -0 to +0. They describe the same physical input.
function sameSnapshot(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' || typeof b === 'number') return typeof a === 'number' && Number.isFinite(a) && a === b;
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && sameSnapshot((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}
/** Rendering only: select stored Rust components and choose a symmetric colour scale.
 * No stresses, equivalent stresses, strength limits or engineering extrema are solved here. */
export function contourField(input: CalculationInput, result: CalculationResult | null | undefined, component: StressComponent): ContourField | null {
  if (!result || result.analysis_status !== 'computed' || !sameSnapshot(result.input_snapshot, input)) return null;
  const pairs: [number, number][] | undefined = result.traction_mpa
    ? input.segments.map(() => [result.traction_mpa![component], result.traction_mpa![component]])
    : result.distribution?.segments.map(s => [s.start_mpa[component], s.end_mpa[component]]);
  if (!pairs?.length || pairs.length !== input.segments.length || pairs.some(pair => pair.some(v => !Number.isFinite(v)))) return null;
  return { pairs, extent: Math.max(...pairs.flatMap(pair => pair.map(Math.abs))) };
}
export function contourColour(value: number, extent: number): string {
  const unit = extent > 0 ? Math.max(-1, Math.min(1, value / extent)) : 0;
  const neutral = [244, 246, 248], extreme = unit < 0 ? [38, 91, 187] : [193, 44, 56];
  return `rgb(${neutral.map((v, i) => Math.round(v + (extreme[i] - v) * Math.abs(unit))).join(',')})`;
}
export function zeroStop(start: number, end: number, extent: number): number | null {
  if (extent === 0 || !((start < 0 && end > 0) || (start > 0 && end < 0))) return null;
  const a = start / extent, b = end / extent;
  return -a / (b - a); // Normalised screen colour interpolation avoids overflowing end-start.
}
