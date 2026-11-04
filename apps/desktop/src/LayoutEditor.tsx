import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { CalculationInput, SegmentInput } from './contracts';
import { moveWeld, type EditorSettings, type Handle } from './editorMovement';
import { panView, zoomAt, type View } from './viewport';
import type ru from './locales/ru.json';

type Point = [number, number];
type Drag = { pointerId: number; segment: number; end: Handle; original: SegmentInput[]; view: View; origin: Point; previousView: View | null };

export function LayoutEditor({ input, centre, selected, onSelect, onChange, disabled, t, settings, onDragStart, onDragCancel, onDragFinish }: {
  input: CalculationInput; centre?: Point; selected: number; onSelect: (n: number) => void;
  onChange: (segments: SegmentInput[]) => void; disabled: boolean; t: typeof ru; settings: EditorSettings;
  onDragStart?: () => void; onDragCancel?: () => void; onDragFinish?: () => void;
}) {
  const svg = useRef<SVGSVGElement>(null), menu = useRef<HTMLDivElement>(null);
  const expectedSegments = useRef(input.segments);
  const drag = useRef<Drag | null>(null);
  const pan = useRef<{ pointerId: number; origin: Point; view: View; previousView: View | null } | null>(null);
  const wheel = useRef<((event: WheelEvent) => void) | null>(null); wheel.current = null;
  const [panMode, setPanMode] = useState(false), [panning, setPanning] = useState(false);
  const [dragging, setDragging] = useState(false);
  // React wheel listeners can be passive. Prevent document/browser zoom only on this canvas.
  useEffect(() => {
    const element = svg.current; if (!element) return;
    const listener = (event: WheelEvent) => wheel.current?.(event);
    element.addEventListener('wheel', listener, { passive: false });
    return () => element.removeEventListener('wheel', listener);
  });
  const [fixedView, setFixedView] = useState<View | null>(null);
  const [snap, setSnap] = useState<Point | null>(null);
  const [context, setContext] = useState<{ x: number; y: number; point: Point; segment?: number } | null>(null);
  useEffect(() => {
    const close = (event: Event) => { if (!menu.current?.contains(event.target as Node)) setContext(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setContext(null); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape); };
  }, []);
  useEffect(() => { if (disabled) { setContext(null); finishPan(true); } }, [disabled]);
  const points = input.segments.flatMap(s => [s.start_mm, s.end_mm]);
  if (points.some(p => p.some(v => !Number.isFinite(v)))) return <div className="drawing empty">{t.bounds}</div>;
  // These are screen transforms, not engineering calculations. Use equal XY scales.
  if (!points.length) points.push([-50, 0], [50, 0]);
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
  function apply(segment: number, changed: SegmentInput) {
    const current = input.segments[segment];
    if (JSON.stringify(current) === JSON.stringify(changed)) return;
    const next = input.segments.map((s, i) => i === segment ? changed : s);
    expectedSegments.current = next; onChange(next);
  }
  function begin(event: ReactPointerEvent<SVGElement>, segment: number, end: Drag['end']) {
    if (disabled || event.button !== 0 || drag.current || pan.current || panMode) return;
    const position = world(event.clientX, event.clientY, view);
    if (!position) return;
    event.preventDefault(); event.stopPropagation(); onSelect(segment); event.currentTarget.focus(); onDragStart?.();
    expectedSegments.current = input.segments;
    drag.current = { pointerId: event.pointerId, segment, end, original: input.segments, view,
      origin: position, previousView: fixedView };
    setDragging(true); setFixedView(view); svg.current?.setPointerCapture?.(event.pointerId);
  }
  function keyboard(event: React.KeyboardEvent<SVGElement>, segment: number, end: Handle) {
    if (disabled || drag.current || pan.current || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const step = settings.movement_step_mm * (event.shiftKey ? 10 : 1);
    const delta: Point = [event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
      event.key === 'ArrowDown' ? -step : event.key === 'ArrowUp' ? step : 0];
    const moved = moveWeld(input.segments, segment, end, delta, settings, view.scale, true);
    if (moved) { setFixedView(view); onSelect(segment); apply(segment, moved.segment); }
  }
  function finish(cancel: boolean) {
    const active = drag.current; drag.current = null; setSnap(null); setDragging(false);
    if (!active) return;
    if (cancel && expectedSegments.current === input.segments) { setFixedView(active.previousView); if (onDragCancel) onDragCancel(); else onChange(active.original); }
    onDragFinish?.();
    if (svg.current?.hasPointerCapture?.(active.pointerId)) svg.current.releasePointerCapture(active.pointerId);
  }
  function finishPan(cancel: boolean) {
    const active = pan.current; if (!active) return;
    pan.current = null; setPanning(false);
    if (cancel) setFixedView(active.previousView);
    if (svg.current?.hasPointerCapture?.(active.pointerId)) svg.current.releasePointerCapture(active.pointerId);
  }
  function zoom(factor: number, anchor: Point = [view.cx, view.cy]) {
    if (disabled || drag.current || pan.current) return;
    const next = zoomAt(view, anchor, factor, fitted.scale);
    if (next) { setFixedView(next); setContext(null); }
  }
  wheel.current = event => {
    if (disabled) return;
    event.preventDefault();
    if (drag.current || pan.current) return;
    const anchor = world(event.clientX, event.clientY, view); if (!anchor) return;
    const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 410 : 1;
    zoom(Math.exp(-Math.max(-500, Math.min(500, event.deltaY * units)) * .002), anchor);
  };
  const pitch = settings.grid_step_mm * view.scale;
  const visiblePitch = Number.isFinite(pitch) && pitch > 0 ? pitch * Math.max(1, Math.ceil(12 / pitch)) : 20;
  return <>
    <div className="view-controls" role="group" aria-label={t.viewControls}>
      <button disabled={disabled || dragging || panning} onClick={() => setFixedView(null)}>{t.fitView}</button>
      <button disabled={disabled || dragging || panning} aria-label={t.zoomIn} onClick={() => zoom(1.25)}>+</button>
      <button disabled={disabled || dragging || panning} aria-label={t.zoomOut} onClick={() => zoom(.8)}>−</button>
      <button disabled={disabled || dragging || panning} aria-pressed={panMode} onClick={() => setPanMode(!panMode)}>{t.panMode}</button>
      <span>{Math.round(view.scale / fitted.scale * 100)}%</span>
    </div>
    <svg ref={svg} className={`drawing editable${panMode || panning ? " pan-mode" : ""}`} viewBox="0 0 600 410" preserveAspectRatio="xMidYMid meet" aria-label="XY weld layout" role="group" tabIndex={0}
      onAuxClick={event => { if (event.button === 1) event.preventDefault(); }}
      onPointerDownCapture={event => {
        if (disabled || drag.current || pan.current || !(event.button === 1 || (panMode && event.button === 0))) return;
        const origin = world(event.clientX, event.clientY, view); if (!origin) return;
        event.preventDefault(); event.stopPropagation(); setContext(null); svg.current?.focus();
        pan.current = { pointerId: event.pointerId, origin, view, previousView: fixedView };
        setPanning(true); setFixedView(view); svg.current?.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={event => {
        const navigation = pan.current;
        if (navigation) {
          if (disabled || navigation.pointerId !== event.pointerId) return;
          const position = world(event.clientX, event.clientY, navigation.view);
          const next = position && panView(navigation.view, navigation.origin, position);
          if (next) setFixedView(next); return;
        }
        const active = drag.current;
        if (!active || disabled || active.pointerId !== event.pointerId) return;
        if (expectedSegments.current !== input.segments) { finish(false); return; }
        const position = world(event.clientX, event.clientY, active.view);
        if (position) {
          const matrix = svg.current?.getScreenCTM();
          const pixelsPerMm = active.view.scale * Math.hypot(matrix?.a ?? 1, matrix?.b ?? 0);
          const moved = moveWeld(active.original, active.segment, active.end,
            [position[0] - active.origin[0], position[1] - active.origin[1]], settings, pixelsPerMm, event.altKey);
          if (moved) { apply(active.segment, moved.segment); setSnap(moved.snap); }
        }
      }} onPointerUp={event => { if (pan.current?.pointerId === event.pointerId) finishPan(false); if (drag.current?.pointerId === event.pointerId) finish(false); }}
      onPointerCancel={() => { finishPan(true); finish(true); }} onLostPointerCapture={() => { finishPan(true); if (drag.current) finish(true); }}
      onKeyDown={event => {
        if (event.key === 'Escape' && pan.current) { event.preventDefault(); event.stopPropagation(); finishPan(true); return; }
        if (!disabled && event.key === 'Escape' && panMode) { event.preventDefault(); setPanMode(false); }
        if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopPropagation(); finish(true); } }}
      onContextMenu={event => {
        event.preventDefault(); if (disabled || drag.current || pan.current) return;
        const point = world(event.clientX, event.clientY, view); if (!point) return;
        const element = (event.target as Element).closest('[data-segment-index]');
        const index = element ? Number(element.getAttribute('data-segment-index')) : undefined;
        if (index !== undefined) onSelect(index);
        setContext({ x: Math.max(8, Math.min(event.clientX, window.innerWidth - 250)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 150)), point, segment: index });
      }}>
      <defs><pattern id="grid" x={x(0)} y={y(0)} width={visiblePitch} height={visiblePitch} patternUnits="userSpaceOnUse"><path d={`M ${visiblePitch} 0 L 0 0 0 ${visiblePitch}`} fill="none" stroke="currentColor" strokeWidth=".3"/></pattern></defs>
      <rect width="600" height="410" fill={settings.snap_grid ? "url(#grid)" : "none"} className="grid"/>
      {settings.snap_axes && <g className="world-axes" pointerEvents="none"><path d={`M ${x(0)} 0 V 410 M 0 ${y(0)} H 600`} className="axis" strokeDasharray="4 4"/></g>}
      <path d="M25 375h45m-45 0v-45" className="axis"/><text x="74" y="380">X</text><text x="20" y="322">Y</text>
      {input.segments.map((s, i) => <g key={i} data-segment-index={i} className={i === selected ? 'segment selected' : 'segment'} onClick={() => { if (!disabled) onSelect(i); }}>
        <line x1={x(s.start_mm[0])} y1={y(s.start_mm[1])} x2={x(s.end_mm[0])} y2={y(s.end_mm[1])} className="hit" role="button" aria-label={`${t.moveWhole} S${i + 1}`} tabIndex={disabled ? -1 : 0} aria-disabled={disabled}
          onPointerDown={event => begin(event, i, 'whole')} onKeyDown={event => keyboard(event, i, 'whole')}/>
        <line x1={x(s.start_mm[0])} y1={y(s.start_mm[1])} x2={x(s.end_mm[0])} y2={y(s.end_mm[1])} pointerEvents="none"/>
        {(['start_mm', 'end_mm'] as const).map(end => <circle key={end} cx={x(s[end][0])} cy={y(s[end][1])} r="6" role="button" aria-label={`S${i + 1} ${end === 'start_mm' ? t.startPoint : t.endPoint}`} tabIndex={disabled ? -1 : 0} aria-disabled={disabled}
          onPointerDown={event => begin(event, i, end)} onKeyDown={event => keyboard(event, i, end)}/>) }
        <text x={x(s.start_mm[0] / 2 + s.end_mm[0] / 2)} y={y(s.start_mm[1] / 2 + s.end_mm[1] / 2) - 12}>S{i + 1} · a={s.effective_width_mm} mm</text>
      </g>)}
      {snap && <circle className="snap-marker" cx={x(snap[0])} cy={y(snap[1])} r="10"/>}
      {centre && <g className="centroid"><circle cx={x(centre[0])} cy={y(centre[1])} r="7"/><text x={x(centre[0]) + 12} y={y(centre[1]) + 22}>C</text></g>}
      {input.application.kind === 'point' && input.application.point_mm.every(Number.isFinite) && <g className="application-point"><circle cx={x(input.application.point_mm[0])} cy={y(input.application.point_mm[1])} r="6"/><text x={x(input.application.point_mm[0]) + 12} y={y(input.application.point_mm[1]) - 10}>P</text></g>}
    </svg>
    <p className="hint">{t.dragHelp}<br/>{t.navigationHelp}</p>
    {context && !disabled && <div ref={menu} role="menu" aria-label={t.geometry} className="editor-context" style={{ left: context.x, top: context.y }}>
      <button role="menuitem" disabled={input.segments.length >= 256} onClick={() => { onChange([...input.segments, { start_mm: context.point, end_mm: [context.point[0] + 100, context.point[1]], effective_width_mm: 2 }]); setContext(null); }}>{t.addHere}</button>
      {context.segment !== undefined && <button role="menuitem" onClick={() => { onChange(input.segments.filter((_, i) => i !== context.segment)); onSelect(0); setContext(null); }}>{t.deleteSegment} S{context.segment + 1}</button>}
      <button role="menuitem" onClick={() => { setContext(null); svg.current?.focus(); }}>{t.closeMenu}</button>
    </div>}
  </>;
}
