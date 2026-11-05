import { useCallback, useEffect, useLayoutEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { CalculationInput, CalculationResult, SegmentInput } from './contracts';
import { moveWeld, type EditorSettings, type Handle } from './editorMovement';
import { fitLayout, panView, zoomAt, type CanvasSize, type View } from './viewport';
import { contourColour, contourField, zeroStop, type StressComponent } from './stressContour';
import { LoadGlyphs } from './LoadGlyphs';
import { ContourLegend, LoadReadout } from './ViewportReadouts';
import type ru from './locales/ru.json';

type Point = [number, number];
type Drag = { pointerId: number; segment: number; end: Handle; original: SegmentInput[]; view: View; origin: Point; previousView: View | null };

export function LayoutEditor({ input, centre, result, displayComponent = null, showLoads = true, selected, onSelect, onChange, disabled, t, settings, compact = false, onDragStart, onDragCancel, onDragFinish }: {
  input: CalculationInput; centre?: Point; result?: CalculationResult | null; displayComponent?: StressComponent | null; showLoads?: boolean; selected: number; onSelect: (n: number) => void;
  onChange: (segments: SegmentInput[]) => void; disabled: boolean; t: typeof ru; settings: EditorSettings; compact?: boolean;
  onDragStart?: () => void; onDragCancel?: () => void; onDragFinish?: () => void;
}) {
  const drawingId = useId().replace(/:/g, '');
  const [includeLoadPoint, setIncludeLoadPoint] = useState(false);
  const svg = useRef<SVGSVGElement>(null), menu = useRef<HTMLDivElement>(null);
  const [canvas, setCanvas] = useState<SVGSVGElement | null>(null);
  const attachCanvas = useCallback((node: SVGSVGElement | null) => { svg.current = node; setCanvas(node); }, []);
  const [size, setSize] = useState<CanvasSize>({ width: 600, height: 400 });
  useLayoutEffect(() => {
    if (!canvas) return;
    const host = canvas.parentElement ?? canvas;
    const resize = () => {
      const width = host.clientWidth, height = host.clientHeight;
      if (width <= 0 || height <= 0) return;
      setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    };
    resize();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(resize);
    // Observe the HTML viewport, not SVG's graphics bounding box. Dock changes
    // must update the CSS canvas size even when the SVG geometry stays the same.
    observer.observe(host);
    return () => observer.disconnect();
  }, [canvas]);
  const previousSize = useRef(size);
  useLayoutEffect(() => {
    if (previousSize.current === size) return;
    previousSize.current = size;
    // A resize cannot change the coordinate mapping halfway through a gesture.
    if (drag.current) finish(true); finishPan(true); setFixedView(null);
  }, [size]);
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
  const field = displayComponent === null ? null : contourField(input, result, displayComponent);
  const points = input.segments.flatMap(s => [s.start_mm, s.end_mm]);
  if (includeLoadPoint && input.application.kind === 'point' && input.application.point_mm.every(Number.isFinite)) points.push([input.application.point_mm[0], input.application.point_mm[1]]);
  const fitted = fitLayout(points, size, field ? 260 : 80) ?? fitLayout(input.segments.flatMap(s => [s.start_mm, s.end_mm]), size);
  if (!fitted) return <div className="drawing empty">{t.bounds}</div>;
  const fittedScale = fitted.scale;
  const view = fixedView ?? fitted;
  if (![view.cx, view.cy, view.scale].every(Number.isFinite) || view.scale <= 0) return <div className="drawing empty">{t.bounds}</div>;
  const x = (value: number) => size.width / 2 + (value - view.cx) * view.scale;
  const y = (value: number) => size.height / 2 - (value - view.cy) * view.scale;
  const loadPoint: Point | undefined = input.application.kind === 'point' ? [input.application.point_mm[0], input.application.point_mm[1]] : centre;
  const loadScreen: Point | null = loadPoint ? [x(loadPoint[0]), y(loadPoint[1])] : null;
  const pointVisible = !!loadScreen && loadScreen.every(Number.isFinite) && loadScreen[0] >= 0 && loadScreen[0] <= size.width && loadScreen[1] >= 0 && loadScreen[1] <= size.height;
  function world(clientX: number, clientY: number, mapping: View): Point | null {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return null;
    const { a, b, c, d, e, f } = matrix, determinant = a * d - b * c;
    if (!Number.isFinite(determinant) || determinant === 0) return null;
    const sx = (d * (clientX - e) - c * (clientY - f)) / determinant;
    const sy = (-b * (clientX - e) + a * (clientY - f)) / determinant;
    const result: Point = [(sx - size.width / 2) / mapping.scale + mapping.cx, (size.height / 2 - sy) / mapping.scale + mapping.cy];
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
    const next = zoomAt(view, anchor, factor, fittedScale);
    if (next) { setFixedView(next); setContext(null); }
  }
  wheel.current = event => {
    if (disabled) return;
    event.preventDefault();
    if (drag.current || pan.current) return;
    const anchor = world(event.clientX, event.clientY, view); if (!anchor) return;
    const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1;
    zoom(Math.exp(-Math.max(-500, Math.min(500, event.deltaY * units)) * .002), anchor);
  };
  const pitch = settings.grid_step_mm * view.scale;
  const visiblePitch = Number.isFinite(pitch) && pitch > 0 ? pitch * Math.max(1, Math.ceil(12 / pitch)) : 20;
  return <>
    <div className="view-controls" role="group" aria-label={t.viewControls}>
      <button disabled={disabled || dragging || panning} onClick={() => { setIncludeLoadPoint(false); setFixedView(null); }}>{t.fitView}</button>
      <button disabled={disabled || dragging || panning} aria-label={t.zoomIn} onClick={() => zoom(1.25)}>+</button>
      <button disabled={disabled || dragging || panning} aria-label={t.zoomOut} onClick={() => zoom(.8)}>−</button>
      <button disabled={disabled || dragging || panning} aria-pressed={panMode} onClick={() => setPanMode(!panMode)}>{t.panMode}</button>
      {input.application.kind === 'point' && <button disabled={disabled || dragging || panning || !input.application.point_mm.every(Number.isFinite)} onClick={() => { setIncludeLoadPoint(true); setFixedView(null); }}>{t.fitLoadsView}</button>}
      <span className="movement-readout">{t.stepShort}: {settings.movement_step_mm} mm</span><span className="zoom-level">{`${Math.round(view.scale / fittedScale * 100)}%`}</span>
    </div>
    <div className="viewport-canvas">
    <svg ref={attachCanvas} className={`drawing editable${panMode || panning ? " pan-mode" : ""}`} viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="xMidYMid meet" aria-label="XY weld layout" role="group" tabIndex={0}
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
      {field && <defs>{field.pairs.map(([start, end], i) => {
        const segment = input.segments[i], zero = zeroStop(start, end, field.extent);
        return <linearGradient key={i} id={`${drawingId}-stress-${i}`} gradientUnits="userSpaceOnUse" x1={x(segment.start_mm[0])} y1={y(segment.start_mm[1])} x2={x(segment.end_mm[0])} y2={y(segment.end_mm[1])}>
          <stop offset="0" stopColor={contourColour(start, field.extent)}/>{zero !== null && <stop offset={zero} stopColor={contourColour(0, field.extent)}/>}
          <stop offset="1" stopColor={contourColour(end, field.extent)}/>
        </linearGradient>;
      })}</defs>}
      {settings.show_grid && <g role="img" aria-label={t.coordinateGrid} pointerEvents="none"><rect width={size.width} height={size.height} fill="url(#grid)" className="grid"/></g>}
      {settings.snap_axes && <g className="world-axes" pointerEvents="none"><path d={`M ${x(0)} 0 V ${size.height} M 0 ${y(0)} H ${size.width}`} className="axis" strokeDasharray="4 4"/></g>}
      {input.segments.map((s, i) => <g key={i} data-segment-index={i} className={i === selected ? 'segment selected' : 'segment'} onClick={() => { if (!disabled) onSelect(i); }}>
        <line x1={x(s.start_mm[0])} y1={y(s.start_mm[1])} x2={x(s.end_mm[0])} y2={y(s.end_mm[1])} className="hit" role="button" aria-label={`${t.moveWhole} S${i + 1}`} tabIndex={disabled ? -1 : 0} aria-disabled={disabled}
          onPointerDown={event => begin(event, i, 'whole')} onKeyDown={event => keyboard(event, i, 'whole')}/>
        <line x1={x(s.start_mm[0])} y1={y(s.start_mm[1])} x2={x(s.end_mm[0])} y2={y(s.end_mm[1])} pointerEvents="none" style={field ? { stroke: `url(#${drawingId}-stress-${i})`, strokeWidth: i === selected ? 9 : 7 } : undefined}/>
        {(['start_mm', 'end_mm'] as const).map(end => <circle key={end} cx={x(s[end][0])} cy={y(s[end][1])} r="8" role="button" aria-label={`S${i + 1} ${end === 'start_mm' ? t.startPoint : t.endPoint}`} tabIndex={disabled ? -1 : 0} aria-disabled={disabled}
          onPointerDown={event => begin(event, i, end)} onKeyDown={event => keyboard(event, i, end)}/>) }
        <text textAnchor="end" x={x(s.start_mm[0] / 2 + s.end_mm[0] / 2)} y={y(s.start_mm[1] / 2 + s.end_mm[1] / 2) - 12}>S{i + 1} · a={s.effective_width_mm} mm</text>
      </g>)}
      {showLoads && pointVisible && loadScreen && <LoadGlyphs input={input} anchor={loadScreen}/>}
      {snap && <circle className="snap-marker" cx={x(snap[0])} cy={y(snap[1])} r="10"/>}
      {centre && <g className="centroid"><circle cx={x(centre[0])} cy={y(centre[1])} r="7"/><text x={x(centre[0]) + 12} y={y(centre[1]) + 22}>C</text></g>}
      {input.application.kind === 'point' && input.application.point_mm.every(Number.isFinite) && <g className="application-point"><circle cx={x(input.application.point_mm[0])} cy={y(input.application.point_mm[1])} r="6"/><text x={x(input.application.point_mm[0]) + 12} y={y(input.application.point_mm[1]) - 10}>P</text></g>}
    </svg>
    <div className="viewport-corner">
    <svg className="viewport-orientation" viewBox="0 0 86 78" role="img" aria-label={t.coordinateAxes}><path d="M15 62h45m-45 0v-45" className="axis"/><text x="65" y="67">X</text><text x="10" y="12">Y</text></svg>
    {showLoads && <LoadReadout input={input} pointVisible={pointVisible} pendingCentre={input.application.kind === 'centroid' && !centre} t={t}/>}
    </div>
    {field && displayComponent !== null && <ContourLegend field={field} component={displayComponent} selected={selected} t={t}/>}
    </div>
    <details className="editor-help" hidden={compact}><summary>{t.editorHelp}</summary><p className="hint">{t.dragHelp}<br/>{t.navigationHelp}<br/>{t.choose}</p></details>
    {context && !disabled && <div ref={menu} role="menu" aria-label={t.geometry} className="editor-context" style={{ left: context.x, top: context.y }}>
      <button role="menuitem" disabled={input.segments.length >= 256} onClick={() => { onChange([...input.segments, { start_mm: context.point, end_mm: [context.point[0] + 100, context.point[1]], effective_width_mm: 2 }]); onSelect(input.segments.length); setContext(null); }}>{t.addHere}</button>
      {context.segment !== undefined && <button role="menuitem" onClick={() => { onChange(input.segments.filter((_, i) => i !== context.segment)); onSelect(0); setContext(null); }}>{t.deleteSegment} S{context.segment + 1}</button>}
      <button role="menuitem" onClick={() => { setContext(null); svg.current?.focus(); }}>{t.closeMenu}</button>
    </div>}
  </>;
}
