import type { SegmentInput } from './contracts';
export type Point = [number, number];
export type EditorSettings = {
  schema_version: number; movement_step_mm: number; grid_step_mm: number; snap_tolerance_px: number;
  show_grid: boolean; snap_grid: boolean; snap_endpoints: boolean; snap_midpoints: boolean; snap_axes: boolean;
};
export const defaultSettings: EditorSettings = { schema_version: 1, movement_step_mm: 1, grid_step_mm: 1,
  snap_tolerance_px: 10, show_grid: false, snap_grid: false, snap_endpoints: true, snap_midpoints: false, snap_axes: false };
export type Handle = 'start_mm' | 'end_mm' | 'whole';
const round = (n: number, step: number) => Math.sign(n) * Math.round(Math.abs(n) / step) * step;
export function translate(s: SegmentInput, delta: Point): SegmentInput | null {
  const next = { ...s, start_mm: s.start_mm.map((v, i) => v + delta[i]) as Point, end_mm: s.end_mm.map((v, i) => v + delta[i]) as Point };
  if (![...next.start_mm, ...next.end_mm].every(Number.isFinite)) return null;
  for (const i of [0, 1]) {
    const length = s.end_mm[i] - s.start_mm[i], moved = next.end_mm[i] - next.start_mm[i];
    if (length !== 0 && moved === 0) return null;
    if (Math.abs(length - moved) > Math.max(1, Math.abs(length)) * Math.sqrt(Number.EPSILON)) return null;
    if (delta[i] !== 0 && (next.start_mm[i] === s.start_mm[i] || next.end_mm[i] === s.end_mm[i])) return null;
  }
  return next;
}
export function moveWeld(segments: SegmentInput[], index: number, handle: Handle, rawDelta: Point,
  settings: EditorSettings, pixelsPerMm: number, bypass = false): { segment: SegmentInput; snap: Point | null } | null {
  const s = segments[index];
  let delta: Point = rawDelta.map(v => round(v, settings.movement_step_mm)) as Point;
  let snap: Point | null = null;
  let snappedAnchor = 0;
  const anchors = handle === 'whole' ? [s.start_mm, s.end_mm] : [s[handle]];
  if (!bypass) {
    const targets: Point[] = segments.flatMap((other, i) => i === index ? [] : [
      ...(settings.snap_endpoints ? [other.start_mm, other.end_mm] : []),
      ...(settings.snap_midpoints ? [[other.start_mm[0] / 2 + other.end_mm[0] / 2, other.start_mm[1] / 2 + other.end_mm[1] / 2] as Point] : []),
    ]);
    let nearest = settings.snap_tolerance_px / pixelsPerMm;
    for (const [anchorIndex, anchor] of anchors.entries()) for (const target of targets) {
      const distance = Math.hypot(anchor[0] + rawDelta[0] - target[0], anchor[1] + rawDelta[1] - target[1]);
      if (distance <= nearest) { nearest = distance; delta = [target[0] - anchor[0], target[1] - anchor[1]]; snap = target; snappedAnchor = anchorIndex; }
    }
    if (!snap) {
      const anchor = anchors[0];
      if (settings.snap_grid) {
        snap = anchor.map((v, i) => round(v + rawDelta[i], settings.grid_step_mm)) as Point;
        delta = [snap[0] - anchor[0], snap[1] - anchor[1]];
      }
      if (settings.snap_axes) {
        for (const i of [0, 1]) if (Math.abs(anchor[i] + rawDelta[i]) * pixelsPerMm <= settings.snap_tolerance_px) {
          delta[i] = -anchor[i]; snap = [anchor[0] + delta[0], anchor[1] + delta[1]];
        }
      }
    }
  }
  const segment = handle === 'whole' ? translate(s, delta) : { ...s, [handle]: snap ?? s[handle].map((v, i) => v + delta[i]) };
  if (segment && handle === 'whole' && snap) {
    // Preserve exact shared coordinates: subtract/add round trips can miss the target by an ULP.
    const vector: Point = [s.end_mm[0] - s.start_mm[0], s.end_mm[1] - s.start_mm[1]];
    if (snappedAnchor === 0) { segment.start_mm = [...snap]; segment.end_mm = [snap[0] + vector[0], snap[1] + vector[1]]; }
    else { segment.end_mm = [...snap]; segment.start_mm = [snap[0] - vector[0], snap[1] - vector[1]]; }
    if (vector.some((v, i) => v !== 0 && segment.end_mm[i] === segment.start_mm[i])) return null;
  }
  if (!segment || ![...segment.start_mm, ...segment.end_mm].every(Number.isFinite)) return null;
  return { segment, snap };
}
