import { useEffect, useRef, useState } from 'react';
import type ru from './locales/ru.json';
export function ModelTree({ count, selected, panel, disabled, onWeld, onLoads, onResults, t }: {
  count: number; selected: number; panel: 'weld' | 'loads'; disabled: boolean;
  onWeld: (index: number) => void; onLoads: () => void; onResults: () => void; t: typeof ru;
}) {
  const [expanded, setExpanded] = useState(true), [focus, setFocus] = useState('weld-0');
  const root = useRef<HTMLDivElement>(null), branch = useRef<HTMLDivElement>(null);
  useEffect(() => { setFocus(panel === 'loads' ? 'loads' : expanded && count ? `weld-${selected}` : 'welds'); }, [selected, panel, expanded, count]);
  return <div ref={root} className="model-tree" role="tree" aria-label={t.modelTree} onKeyDown={event => {
    if (disabled) return;
    const items = [...(root.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])].filter(item => !item.closest('[hidden]'));
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
      items[next]?.focus();
    }
    if (event.key === 'ArrowLeft' && (event.target as HTMLElement).dataset.weld) { event.preventDefault(); branch.current?.focus(); }
  }}>
    <div ref={branch} role="treeitem" aria-label={t.welds} aria-expanded={expanded} tabIndex={!disabled && focus === 'welds' ? 0 : -1}
      onFocus={event => { if (event.target === event.currentTarget) setFocus('welds'); }}
      onKeyDown={event => {
        if (disabled || event.target !== event.currentTarget) return;
        if (['ArrowRight', 'ArrowLeft', 'Enter', ' '].includes(event.key)) {
          event.preventDefault(); setExpanded(event.key === 'ArrowRight' || (event.key !== 'ArrowLeft' && !expanded));
        }
      }}>
      <div className="tree-branch" onClick={() => { if (!disabled) setExpanded(!expanded); }}><span aria-hidden="true">{expanded ? '▾' : '▸'}</span> {t.welds} <small>({count})</small></div>
      <div role="group" hidden={!expanded}>
        {Array.from({ length: count }, (_, index) => <button key={index} role="treeitem" data-weld="true" aria-label={`${t.weld} S${index + 1}`} aria-selected={panel === 'weld' && selected === index}
          tabIndex={focus === `weld-${index}` ? 0 : -1} disabled={disabled} onFocus={() => setFocus(`weld-${index}`)} onClick={() => onWeld(index)}>
          <span className="tree-line-icon" aria-hidden="true"/>{t.weld} S{index + 1}
        </button>)}
      </div>
    </div>
    <div className="tree-category">{t.analysis}</div>
    <button role="treeitem" aria-selected={panel === 'loads'} tabIndex={focus === 'loads' ? 0 : -1} disabled={disabled} onFocus={() => setFocus('loads')} onClick={onLoads}><span aria-hidden="true">↗</span>{t.loads}</button>
    <button role="treeitem" tabIndex={focus === 'results' ? 0 : -1} disabled={disabled} onFocus={() => setFocus('results')} onClick={onResults}><span aria-hidden="true">▤</span>{t.results}</button>
  </div>;
}
