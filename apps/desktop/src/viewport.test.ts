import { expect, test } from 'vitest';
import { fitLayout, panView, zoomAt } from './viewport';
test('zoom keeps the world point under the cursor fixed at equal XY scales', () => {
  const view = { cx: 20, cy: -5, scale: 4 }, anchor: [number, number] = [60, 35];
  const next = zoomAt(view, anchor, 2, 4)!;
  expect((anchor[0] - next.cx) * next.scale).toBe((anchor[0] - view.cx) * view.scale);
  expect((anchor[1] - next.cy) * next.scale).toBe((anchor[1] - view.cy) * view.scale);
  expect(zoomAt(next, anchor, .5, 4)).toEqual(view);
});
test('navigation limits zoom and refuses non-finite camera values', () => {
  const view = { cx: 0, cy: 0, scale: 4 };
  expect(zoomAt(view, [0, 0], 1e12, 4)?.scale).toBe(400);
  expect(zoomAt(view, [0, 0], 1e-12, 4)?.scale).toBe(.04);
  expect(zoomAt(view, [Infinity, 0], 2, 4)).toBeNull();
  expect(zoomAt(view, [0, 0], NaN, 4)).toBeNull();
  expect(panView(view, [0, 0], [Infinity, 0])).toBeNull();
});
test('pan follows the pointer in world coordinates', () => {
  expect(panView({ cx: 20, cy: 30, scale: 4 }, [10, 10], [15, 7])).toEqual({ cx: 15, cy: 33, scale: 4 });
});

test('fit uses the actual wide canvas instead of letterboxing a fixed 600 pixel drawing', () => {
  const points: [number, number][] = [[-50, 0], [50, 0]];
  const narrow = fitLayout(points, { width: 600, height: 400 })!;
  const wide = fitLayout(points, { width: 1800, height: 320 })!;
  expect(narrow.scale).toBe(4.4);
  expect(wide.scale * 100).toBeCloseTo(1640);
  expect(wide.cx).toBe(0); expect(wide.cy).toBe(0);
  const vertical = fitLayout([[0, -50], [0, 50]], { width: 1800, height: 320 })!;
  expect(vertical.scale * 100).toBe(200);
  expect(fitLayout([[Infinity, 0]], { width: 1800, height: 320 })).toBeNull();
});
