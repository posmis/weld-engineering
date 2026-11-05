import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type ru from './locales/ru.json';
type Resize = { pointer: number; kind: 'side' | 'properties' | 'results'; origin: number; original: number };
export function CadWorkspace({ sidebar, properties, viewport, results, resultsOpen, t }: {
  sidebar: ReactNode; properties: ReactNode; viewport: ReactNode; results: ReactNode; resultsOpen: boolean; t: typeof ru;
}) {
  const [sideWidth, setSideWidth] = useState(220), [propertiesWidth, setPropertiesWidth] = useState(280), [resultsHeight, setResultsHeight] = useState(260);
  const root = useRef<HTMLDivElement>(null), resize = useRef<Resize | null>(null);
  function limits(kind: Resize['kind']) {
    return kind !== 'results' ? [kind === 'side' ? 160 : 240, Math.max(kind === 'side' ? 160 : 240, Math.min(420, (root.current?.clientWidth || 1024) - (kind === 'side' ? propertiesWidth : sideWidth) - 332))]
      : [160, Math.max(160, (root.current?.clientHeight || 700) - 186)];
  }
  function change(kind: Resize['kind'], value: number) {
    const [min, max] = limits(kind); const next = Math.max(min, Math.min(max, value));
    if (kind === 'side') setSideWidth(next); else if (kind === 'properties') setPropertiesWidth(next); else setResultsHeight(next);
  }
  function separator(kind: Resize['kind']) {
    const current = kind === 'side' ? sideWidth : kind === 'properties' ? propertiesWidth : resultsHeight;
    return <div role="separator" tabIndex={0} aria-orientation={kind !== 'results' ? 'vertical' : 'horizontal'} aria-label={kind === 'side' ? t.resizeSidebar : kind === 'properties' ? t.resizeProperties : t.resizeResults}
      aria-valuenow={current} aria-valuemin={limits(kind)[0]} aria-valuemax={limits(kind)[1]} className={`dock-splitter ${kind === 'properties' ? 'side' : kind}`}
      onPointerDown={event => {
        if (event.button !== 0 || resize.current) return; event.preventDefault();
        resize.current = { pointer: event.pointerId, kind, origin: kind !== 'results' ? event.clientX : event.clientY, original: current };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }} onPointerMove={event => {
        const active = resize.current; if (!active || active.pointer !== event.pointerId || active.kind !== kind) return;
        const delta = (kind !== 'results' ? event.clientX : event.clientY) - active.origin;
        change(kind, active.original + (kind !== 'results' ? delta : -delta));
      }} onPointerUp={event => {
        if (resize.current?.pointer === event.pointerId) resize.current = null;
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }} onPointerCancel={() => { if (resize.current) change(kind, resize.current.original); resize.current = null; }}
      onLostPointerCapture={() => { if (resize.current) change(kind, resize.current.original); resize.current = null; }}
      onKeyDown={event => {
        if (event.key === 'Escape' && resize.current) { change(kind, resize.current.original); resize.current = null; event.preventDefault(); }
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); const [min, max] = limits(kind);
          change(kind, event.key === 'Home' ? min : event.key === 'End' ? max : current + (['ArrowRight', 'ArrowUp'].includes(event.key) ? 16 : -16));
        }
      }}/>;
  }
  return <div ref={root} className="cad-workspace" style={{ '--side-width': `${sideWidth}px`, '--properties-width': `${propertiesWidth}px`, '--results-height': `${resultsHeight}px` } as CSSProperties}>
    <aside className="cad-sidebar" aria-label={t.modelOutline}>{sidebar}</aside>
    {separator('side')}
    <aside className="cad-properties" aria-label={t.elementProperties}>{properties}</aside>
    {separator('properties')}
    <div className={`cad-view${resultsOpen ? ' with-results' : ''}`}>
      {viewport}
      {resultsOpen && separator('results')}
      <div className="result-dock" hidden={!resultsOpen}>{results}</div>
    </div>
  </div>;
}
