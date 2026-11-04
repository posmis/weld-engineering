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
