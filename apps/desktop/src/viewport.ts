import type { Point } from './editorMovement';
export type View = { cx: number; cy: number; scale: number };
export function zoomAt(view: View, anchor: Point, factor: number, fittedScale: number): View | null {
  if (!Number.isFinite(factor) || factor <= 0) return null;
  const scale = Math.max(fittedScale / 100, Math.min(fittedScale * 100, view.scale * factor));
  const ratio = scale / view.scale;
  const next = { cx: anchor[0] + (view.cx - anchor[0]) / ratio,
    cy: anchor[1] + (view.cy - anchor[1]) / ratio, scale };
  return scale > 0 && Object.values(next).every(Number.isFinite) ? next : null;
}
export function panView(view: View, origin: Point, position: Point): View | null {
  const next = { ...view, cx: view.cx - (position[0] - origin[0]), cy: view.cy - (position[1] - origin[1]) };
  return Object.values(next).every(Number.isFinite) ? next : null;
}
export type CanvasSize = { width: number; height: number };
export function fitLayout(points: Point[], size: CanvasSize): View | null {
  if (points.some(p => p.some(v => !Number.isFinite(v)))) return null;
  const source = points.length ? points : [[-50, 0], [50, 0]];
  const xs = source.map(p => p[0]), ys = source.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const result = { cx: minX / 2 + maxX / 2, cy: minY / 2 + maxY / 2,
    scale: Math.min(Math.max(1, size.width - 160) / Math.max(maxX - minX, 1), Math.max(1, size.height - 120) / Math.max(maxY - minY, 1)) };
  return result.scale > 0 && Object.values(result).every(Number.isFinite) ? result : null;
}
