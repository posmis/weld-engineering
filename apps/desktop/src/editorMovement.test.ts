import { expect, test } from 'vitest';
import { defaultSettings, moveWeld, translate } from './editorMovement';
import type { SegmentInput } from './contracts';
const weld: SegmentInput = { start_mm: [.3, .2], end_mm: [100.3, .2], effective_width_mm: 3 };
test('movement quantizes deltas symmetrically and preserves original fractional coordinates', () => {
  const moved = moveWeld([weld], 0, 'whole', [-2.5, 2.5], defaultSettings, 1, true)!;
  expect(moved.segment.start_mm).toEqual([-2.7, 3.2]);
  expect(moved.segment.end_mm).toEqual([97.3, 3.2]);
  expect(moved.segment.effective_width_mm).toBe(3);
});
test('endpoint snap overrides coarse movement step and respects CSS pixel radius and Alt', () => {
  const other: SegmentInput = { start_mm: [7, 0], end_mm: [20, 0], effective_width_mm: 2 };
  const settings = { ...defaultSettings, movement_step_mm: 10 };
  expect(moveWeld([weld, other], 0, 'start_mm', [6, 0], settings, 5)!.segment.start_mm).toEqual([7, 0]);
  expect(moveWeld([weld, other], 0, 'start_mm', [6, 0], settings, 100)!.snap).toBeNull();
  expect(moveWeld([weld, other], 0, 'start_mm', [6, 0], settings, 5, true)!.snap).toBeNull();
  expect(moveWeld([weld], 0, 'start_mm', [0, 0], settings, 5)!.snap).toBeNull();
});
test('whole weld snaps its end without changing its vector or other welds', () => {
  const other: SegmentInput = { start_mm: [110.3, 20.2], end_mm: [200, 20.2], effective_width_mm: 2 };
  const moved = moveWeld([weld, other], 0, 'whole', [9, 20], defaultSettings, 5)!;
  expect(moved.segment.end_mm).toEqual(other.start_mm);
  expect(moved.segment.start_mm[0]).toBeCloseTo(10.3);
  expect(moved.segment.end_mm[0] - moved.segment.start_mm[0]).toBeCloseTo(100);
  expect(weld.start_mm).toEqual([.3, .2]);
});
test('grid, midpoint, and axis snaps have explicit targets', () => {
  const grid = moveWeld([weld], 0, 'whole', [2, 3], { ...defaultSettings, snap_grid: true, grid_step_mm: 5 }, 1)!;
  expect(grid.segment.start_mm).toEqual([0, 5]);
  expect(grid.segment.end_mm[0] - grid.segment.start_mm[0]).toBeCloseTo(100);
  const axis = moveWeld([weld], 0, 'start_mm', [1, 20], { ...defaultSettings, snap_axes: true }, 5)!;
  expect(axis.segment.start_mm[0]).toBe(0);
  const midpoint = moveWeld([weld, { ...weld, start_mm: [0, 20], end_mm: [20, 20] }], 0, 'start_mm', [9, 20], { ...defaultSettings, snap_endpoints: false, snap_midpoints: true }, 5)!;
  expect(midpoint.segment.start_mm).toEqual([10, 20]);
});
test('unrepresentable translations are refused instead of collapsing the weld', () => {
  expect(translate(weld, [1e30, 0])).toBeNull();
  expect(translate(weld, [Infinity, 0])).toBeNull();
});
