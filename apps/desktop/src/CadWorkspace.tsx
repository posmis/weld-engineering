import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { defaultWorkspaceLayout, readWorkspaceLayout, saveWorkspaceLayout, type WorkspaceLayout } from './workspaceLayout';
import type ru from './locales/ru.json';
type Resize = { pointer: number; kind: 'side' | 'properties' | 'results'; origin: number; original: number };
export function CadWorkspace({ sidebar, properties, viewport, results, resultsOpen, t }: {
  sidebar: ReactNode; properties: ReactNode; viewport: ReactNode; results: ReactNode; resultsOpen: boolean; t: typeof ru;
}) {
  const [initial] = useState(readWorkspaceLayout);
  const [sideWidth, setSideWidth] = useState(initial.layout.tree_width_px), [propertiesWidth, setPropertiesWidth] = useState(initial.layout.properties_width_px), [resultsHeight, setResultsHeight] = useState(initial.layout.results_height_px);
  const [issue, setIssue] = useState<'read' | 'save' | null>(initial.failed ? 'read' : null);
  const [viewportMinimum, setViewportMinimum] = useState(260);
  const root = useRef<HTMLDivElement>(null), resize = useRef<Resize | null>(null);
  const widths = useRef({ sideWidth, propertiesWidth, resultsHeight }); widths.current = { sideWidth, propertiesWidth, resultsHeight };
  useLayoutEffect(() => {
    const element = root.current; if (!element || typeof ResizeObserver === 'undefined') return;
    const title = element.querySelector<HTMLElement>('.viewport-title'), controls = element.querySelector<HTMLElement>('.view-controls');
    const fit = () => {
      if (element.clientWidth <= 0 || element.clientHeight <= 0) return;
      const reserved = Math.max(240, Math.ceil((title?.getBoundingClientRect().height ?? 25) + (controls?.getBoundingClientRect().height ?? 42) + 182));
      setViewportMinimum(reserved);
      const available = Math.max(400, element.clientWidth - 332);
      let side = widths.current.sideWidth, properties = widths.current.propertiesWidth;
      let excess = Math.max(0, side + properties - available);
      const shrinkSide = Math.min(side - 160, excess / 2); side -= shrinkSide; excess -= shrinkSide;
      const shrinkProperties = Math.min(properties - 240, excess); properties -= shrinkProperties; excess -= shrinkProperties;
      side -= Math.min(side - 160, excess);
      const height = Math.max(80, Math.min(widths.current.resultsHeight, 4096, element.clientHeight-reserved));
      widths.current = {sideWidth:side,propertiesWidth:properties,resultsHeight:height};
      setSideWidth(side); setPropertiesWidth(properties); setResultsHeight(height);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element); if(title)observer.observe(title); if(controls)observer.observe(controls); return () => observer.disconnect();
  }, [viewport]);
  function limits(kind: Resize['kind']) {
    return kind !== 'results' ? [kind === 'side' ? 160 : 240, Math.max(kind === 'side' ? 160 : 240, Math.min(420, (root.current?.clientWidth || 1024) - (kind === 'side' ? propertiesWidth : sideWidth) - 332))]
      : [80, Math.max(80, Math.min(4096, (root.current?.clientHeight || 700) - viewportMinimum))];
  }
  function persist(layout?: WorkspaceLayout) {
    const current = widths.current;
    const value: WorkspaceLayout = layout ?? { schema_version: 1, tree_width_px: current.sideWidth, properties_width_px: current.propertiesWidth, results_height_px: current.resultsHeight };
    setIssue(saveWorkspaceLayout(value) ? null : 'save');
  }
  function reset() {
    resize.current = null;
    const value = defaultWorkspaceLayout, height = Math.min(value.results_height_px, limits('results')[1]);
    widths.current = {sideWidth:value.tree_width_px,propertiesWidth:value.properties_width_px,resultsHeight:height};
    setSideWidth(value.tree_width_px);setPropertiesWidth(value.properties_width_px);setResultsHeight(height);persist(value);
  }
  function change(kind: Resize['kind'], value: number, commit = false) {
    const [min, max] = limits(kind); const next = Math.max(min, Math.min(max, value));
    const key = kind === 'side' ? 'sideWidth' : kind === 'properties' ? 'propertiesWidth' : 'resultsHeight';
    widths.current = { ...widths.current, [key]: next };
    if (kind === 'side') setSideWidth(next); else if (kind === 'properties') setPropertiesWidth(next); else setResultsHeight(next);
    if (commit) persist();
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
        if (resize.current?.pointer === event.pointerId) { resize.current = null; persist(); }
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }} onPointerCancel={() => { if (resize.current) change(kind, resize.current.original); resize.current = null; }}
      onLostPointerCapture={() => { if (resize.current) change(kind, resize.current.original); resize.current = null; }}
      onKeyDown={event => {
        if (event.key === 'Escape' && resize.current) { change(kind, resize.current.original); resize.current = null; event.preventDefault(); }
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); const [min, max] = limits(kind);
          change(kind, event.key === 'Home' ? min : event.key === 'End' ? max : current + (['ArrowRight', 'ArrowUp'].includes(event.key) ? 16 : -16), true);
        }
      }}/>;
  }
  return <div ref={root} className="cad-workspace" style={{ '--side-width': `${sideWidth}px`, '--properties-width': `${propertiesWidth}px`, '--results-height': `${resultsHeight}px`, '--viewport-minimum': `${viewportMinimum}px` } as CSSProperties}>
    <aside className="cad-sidebar" aria-label={t.modelOutline}>{sidebar}</aside>
    {separator('side')}
    <aside className="cad-properties" aria-label={t.elementProperties}>
      <div className="dock-title"><span>{t.properties}</span><button aria-label={t.resetWorkspace} title={t.resetWorkspace} onClick={reset}>↺</button></div>
      {issue && <p className="workspace-notice" role="alert">{issue === 'read' ? t.layoutReadError : t.layoutSaveError}</p>}
      {properties}
    </aside>
    {separator('properties')}
    <div className={`cad-view${resultsOpen ? ' with-results' : ''}`}>
      {viewport}
      {resultsOpen && separator('results')}
      <div className="result-dock" hidden={!resultsOpen}>{results}</div>
    </div>
  </div>;
}
