import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type ru from './locales/ru.json';
type Resize = { pointer: number; kind: 'side' | 'results'; origin: number; original: number };
export function CadWorkspace({ sidebar, viewport, results, resultsOpen, t }: {
  sidebar: ReactNode; viewport: ReactNode; results: ReactNode; resultsOpen: boolean; t: typeof ru;
}) {
  const [sideWidth, setSideWidth] = useState(320), [resultsHeight, setResultsHeight] = useState(260);
  const root = useRef<HTMLDivElement>(null), resize = useRef<Resize | null>(null);
  function limits(kind: Resize['kind']) {
    return kind === 'side' ? [260, Math.max(260, Math.min(520, (root.current?.clientWidth || 1024) / 2))]
      : [160, Math.max(160, (root.current?.clientHeight || 700) - 186)];
  }
  function change(kind: Resize['kind'], value: number) {
    const [min, max] = limits(kind); const next = Math.max(min, Math.min(max, value));
    if (kind === 'side') setSideWidth(next); else setResultsHeight(next);
  }
  function separator(kind: Resize['kind']) {
    const current = kind === 'side' ? sideWidth : resultsHeight;
    return <div role="separator" tabIndex={0} aria-orientation={kind === 'side' ? 'vertical' : 'horizontal'} aria-label={kind === 'side' ? t.resizeSidebar : t.resizeResults}
      aria-valuenow={current} aria-valuemin={limits(kind)[0]} aria-valuemax={limits(kind)[1]} className={`dock-splitter ${kind}`}
      onPointerDown={event => {
        if (event.button !== 0 || resize.current) return; event.preventDefault();
        resize.current = { pointer: event.pointerId, kind, origin: kind === 'side' ? event.clientX : event.clientY, original: current };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }} onPointerMove={event => {
        const active = resize.current; if (!active || active.pointer !== event.pointerId || active.kind !== kind) return;
        const delta = (kind === 'side' ? event.clientX : event.clientY) - active.origin;
        change(kind, active.original + (kind === 'side' ? delta : -delta));
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
  return <div ref={root} className="cad-workspace" style={{ '--side-width': `${sideWidth}px`, '--results-height': `${resultsHeight}px` } as CSSProperties}>
    <aside className="cad-sidebar" aria-label={t.modelAndProperties}>{sidebar}</aside>
    {separator('side')}
    <div className={`cad-view${resultsOpen ? ' with-results' : ''}`}>
      {viewport}
      {resultsOpen && separator('results')}
      <div className="result-dock" hidden={!resultsOpen}>{results}</div>
    </div>
  </div>;
}
