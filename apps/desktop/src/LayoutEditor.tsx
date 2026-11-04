import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { CalculationInput, SegmentInput } from './contracts';
import type ru from './locales/ru.json';

type View = { cx: number; cy: number; scale: number };
type Point = [number, number];
type Drag = { pointerId: number; segment: number; end: 'start_mm' | 'end_mm'; original: SegmentInput[]; view: View; offset: Point };

export function LayoutEditor({ input, centre, selected, onSelect, onChange, disabled, t, onDragStart, onDragCancel, onDragFinish }: {
  input: CalculationInput; centre?: Point; selected: number; onSelect: (n: number) => void;
  onChange: (segments: SegmentInput[]) => void; disabled: boolean; t: typeof ru;
  onDragStart?: () => void; onDragCancel?: () => void; onDragFinish?: () => void;
}) {
  const svg = useRef<SVGSVGElement>(null), menu = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [fixedView, setFixedView] = useState<View | null>(null);
  const [context, setContext] = useState<{ x: number; y: number; point: Point; segment?: number } | null>(null);
  useEffect(() => {
    const close = (event: Event) => { if (!menu.current?.contains(event.target as Node)) setContext(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setContext(null); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, []);
  useEffect(() => { if (disabled) setContext(null); }, [disabled]);
  const points = input.segments.flatMap(s => [s.start_mm, s.end_mm]);
  if (!points.length || points.some(p => p.some(v => !Number.isFinite(v)))) return <div className="drawing empty">{t.bounds}</div>;
  // These are screen transforms, not engineering calculations. Use equal XY scales.
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const fitted: View = { cx: minX / 2 + maxX / 2, cy: minY / 2 + maxY / 2,
    scale: Math.min(440 / Math.max(maxX - minX, 1), 280 / Math.max(maxY - minY, 1)) };
  const view = fixedView ?? fitted;
  if (![view.cx, view.cy, view.scale].every(Number.isFinite) || view.scale <= 0) return <div className="drawing empty">{t.bounds}</div>;
  const x = (value: number) => 300 + (value - view.cx) * view.scale;
  const y = (value: number) => 200 - (value - view.cy) * view.scale;
  function world(clientX: number, clientY: number, mapping: View): Point | null {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return null;
    const { a, b, c, d, e, f } = matrix, determinant = a * d - b * c;
    if (!Number.isFinite(determinant) || determinant === 0) return null;
    const sx = (d * (clientX - e) - c * (clientY - f)) / determinant;
    const sy = (-b * (clientX - e) + a * (clientY - f)) / determinant;
    const result: Point = [(sx - 300) / mapping.scale + mapping.cx, (200 - sy) / mapping.scale + mapping.cy];
    return result.every(Number.isFinite) ? result : null;
  }
  function move(segment: number, end: Drag['end'], point: Point) {
    if (!point.every(Number.isFinite)) return;
    onChange(input.segments.map((s, i) => i === segment ? { ...s, [end]: point } : s));
  }
  function begin(event: ReactPointerEvent<SVGCircleElement>, segment: number, end: Drag['end']) {
    if (disabled || event.button !== 0) return;
    const position = world(event.clientX, event.clientY, view);
    if (!position) return;
    event.preventDefault(); onSelect(segment); event.currentTarget.focus(); onDragStart?.();
    const original = input.segments[segment][end];
    drag.current = { pointerId: event.pointerId, segment, end, original: input.segments, view,
      offset: [position[0] - original[0], position[1] - original[1]] };
    setFixedView(view); svg.current?.setPointerCapture?.(event.pointerId);
  }
  function finish(cancel: boolean) {
    const active = drag.current; drag.current = null; setFixedView(null);
    if (!active) return;
    if (cancel) { if (onDragCancel) onDragCancel(); else onChange(active.original); }
    onDragFinish?.();
    if (svg.current?.hasPointerCapture?.(active.pointerId)) svg.current.releasePointerCapture(active.pointerId);
  }
  return <>
    <svg ref={svg} className="drawing editable" viewBox="0 0 600 410" preserveAspectRatio="xMidYMid meet" aria-label="XY weld layout" role="group" tabIndex={0}
      onPointerMove={event => {
        const active = drag.current;
        if (!active || disabled || active.pointerId !== event.pointerId) return;
        const position = world(event.clientX, event.clientY, active.view);
        if (position) move(active.segment, active.end, [position[0] - active.offset[0], position[1] - active.offset[1]]);
      }} onPointerUp={event => { if (drag.current?.pointerId === event.pointerId) finish(false); }}
      onPointerCancel={() => finish(true)} onLostPointerCapture={() => { if (drag.current) finish(true); }}
      onKeyDown={event => { if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopPropagation(); finish(true); } }}
      onContextMenu={event => {
        event.preventDefault(); if (disabled || drag.current) return;
        const point = world(event.clientX, event.clientY, view); if (!point) return;
        const element = (event.target as Element).closest('[data-segment-index]');
        const index = element ? Number(element.getAttribute('data-segment-index')) : undefined;
        if (index !== undefined) onSelect(index);
        setContext({ x: Math.max(8, Math.min(event.clientX, window.innerWidth - 250)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 150)), point, segment: index });
      }}>
      <defs><pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="currentColor" strokeWidth=".3"/></pattern></defs>
      <rect width="600" height="410" fill="url(#grid)" className="grid"/>
      <path d="M25 375h45m-45 0v-45" className="axis"/><text x="74" y="380">X</text><text x="20" y="322">Y</text>
      {input.segments.map((s, i) => <g key={i} data-segment-index={i} className={i === selected ? 'segment selected' : 'segment'} onClick={() => { if (!disabled) onSelect(i); }}>
        <line x1={x(s.start_mm[0])} y1={y(s.start_mm[1])} x2={x(s.end_mm[0])} y2={y(s.end_mm[1])} className="hit"/>
        <line x1={x(s.start_mm[0])} y1={y(s.start_mm[1])} x2={x(s.end_mm[0])} y2={y(s.end_mm[1])}/>
        {(['start_mm', 'end_mm'] as const).map(end => <circle key={end} cx={x(s[end][0])} cy={y(s[end][1])} r="6" role="button" aria-label={`S${i + 1} ${end === 'start_mm' ? t.startPoint : t.endPoint}`} tabIndex={disabled ? -1 : 0} aria-disabled={disabled}
          onPointerDown={event => begin(event, i, end)} onKeyDown={event => {
            if (disabled || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault(); const step = event.shiftKey ? 10 : 1; const p: Point = [...s[end]];
            if (event.key === 'ArrowLeft') p[0] -= step; if (event.key === 'ArrowRight') p[0] += step;
            if (event.key === 'ArrowUp') p[1] += step; if (event.key === 'ArrowDown') p[1] -= step;
            onSelect(i); move(i, end, p);
          }}/>) }
        <text x={x(s.start_mm[0] / 2 + s.end_mm[0] / 2)} y={y(s.start_mm[1] / 2 + s.end_mm[1] / 2) - 12}>S{i + 1} · a={s.effective_width_mm} mm</text>
      </g>)}
      {centre && <g className="centroid"><circle cx={x(centre[0])} cy={y(centre[1])} r="7"/><text x={x(centre[0]) + 12} y={y(centre[1]) + 22}>C</text></g>}
      {input.application.kind === 'point' && input.application.point_mm.every(Number.isFinite) && <g className="application-point"><circle cx={x(input.application.point_mm[0])} cy={y(input.application.point_mm[1])} r="6"/><text x={x(input.application.point_mm[0]) + 12} y={y(input.application.point_mm[1]) - 10}>P</text></g>}
    </svg>
    <p className="hint">{t.dragHelp}</p>
    {context && !disabled && <div ref={menu} role="menu" aria-label={t.geometry} className="editor-context" style={{ left: context.x, top: context.y }}>
      <button role="menuitem" disabled={input.segments.length >= 256} onClick={() => { onChange([...input.segments, { start_mm: context.point, end_mm: [context.point[0] + 100, context.point[1]], effective_width_mm: 2 }]); setContext(null); }}>{t.addHere}</button>
      {context.segment !== undefined && <button role="menuitem" onClick={() => { onChange(input.segments.filter((_, i) => i !== context.segment)); onSelect(0); setContext(null); }}>{t.deleteSegment} S{context.segment + 1}</button>}
      <button role="menuitem" onClick={() => { setContext(null); svg.current?.focus(); }}>{t.closeMenu}</button>
    </div>}
  </>;
}
