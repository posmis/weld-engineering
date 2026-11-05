import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AppliedForce, CalculationInput } from './contracts';
import type ru from './locales/ru.json';
export function ModelTree({ input, count, selected, panel, forces, activeForce, loadView, disabled, canAddWeld, canAddForce, onCopyWeld, onDeleteWeld, onCopyForce, onDeleteForce, onAddWeld, onAddForce, onForce, onCouple, onWeld, onLoads, onResults, t }: {
  input: CalculationInput; count: number; selected: number; panel: 'weld' | 'loads'; forces: AppliedForce[]; activeForce?: string; loadView: 'overview' | 'force' | 'couple'; disabled: boolean;
  onCopyWeld: (index: number) => void; onDeleteWeld: (index: number) => void; onCopyForce: (id: string) => void; onDeleteForce: (id: string) => void;
  canAddWeld: boolean; canAddForce: boolean; onAddWeld: () => void; onAddForce: () => void;
  onForce: (id: string) => void; onCouple: () => void; onWeld: (index: number) => void; onLoads: () => void; onResults: () => void; t: typeof ru;
}) {
  const [expanded, setExpanded] = useState({ welds: true, loads: true });
  const [focus, setFocus] = useState('weld-0');
  const [context, setContext] = useState<{ x: number; y: number; trigger: HTMLElement; key?: string } | null>(null);
  const focusAfterAction = useRef(false);
  const root = useRef<HTMLDivElement>(null), menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const key = panel === 'loads' ? !expanded.loads || loadView === 'overview' || (loadView === 'force' && !activeForce) ? 'loads' : loadView === 'couple' ? 'couple' : `force-${activeForce}` : expanded.welds && count ? `weld-${selected}` : 'welds';
    setFocus(key);
    if (focusAfterAction.current) {
      focusAfterAction.current = false;
      [...(root.current?.querySelectorAll<HTMLElement>('[data-tree-key]') ?? [])].find(item => item.dataset.treeKey === key)?.focus();
    }
  }, [selected, panel, expanded, count, activeForce, loadView]);
  useEffect(() => { setContext(null); }, [input]);
  useEffect(() => { if (disabled) setContext(null); }, [disabled]);
  useEffect(() => {
    if (!context) return;
    menu.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
    const outside = (e: PointerEvent) => { if (!menu.current?.contains(e.target as Node)) setContext(null); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [context]);
  function close() { context?.trigger.focus(); setContext(null); }
  function open(target: HTMLElement, x: number, y: number) {
    if (disabled) return;
    const key = target.closest<HTMLElement>('[data-tree-key]')?.dataset.treeKey;
    if (key?.startsWith('weld-')) onWeld(Number(key.slice(5)));
    else if (key?.startsWith('force-')) onForce(key.slice(6));
    else if (key === 'couple') onCouple();
    else if (key === 'loads') onLoads();
    setContext({ x: Math.max(8, Math.min(x, window.innerWidth - 260)), y: Math.max(8, Math.min(y, window.innerHeight - 250)), key, trigger: target.closest<HTMLElement>('[role=treeitem]') ?? target });
  }
  function leaf(key: string, name: string, active: boolean, action: () => void, icon: string) {
    return <button key={key} role="treeitem" data-tree-key={key} aria-label={name} aria-selected={active} tabIndex={focus === key ? 0 : -1} disabled={disabled} onFocus={() => setFocus(key)} onClick={action}><span className="tree-node-icon" aria-hidden="true">{icon}</span>{name}</button>;
  }
  function branch(key: 'welds' | 'loads', label: string, total: number, children: ReactNode) {
    return <div role="treeitem" data-tree-key={key} aria-label={label} aria-expanded={expanded[key]} onClick={e => { if (!disabled && (e.target as HTMLElement).closest('[role=treeitem]') === e.currentTarget) { setExpanded(v => ({...v,[key]:!v[key]})); if (key === 'loads') onLoads(); } }} tabIndex={!disabled && focus === key ? 0 : -1}
      onFocus={e => { if (e.target === e.currentTarget) setFocus(key); }}
      onKeyDown={e => {
        if (disabled || e.target !== e.currentTarget) return;
        if (['ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(e.key)) {
          e.preventDefault();
          if (e.key === 'ArrowRight' && expanded[key]) e.currentTarget.querySelector<HTMLElement>('[role=group] [role=treeitem]')?.focus();
          else setExpanded(v => ({ ...v, [key]: e.key === 'ArrowRight' || (e.key !== 'ArrowLeft' && !v[key]) }));
          if (key === 'loads' && ['Enter',' '].includes(e.key)) onLoads();
        }
      }}><div className="tree-branch"><span aria-hidden="true">{expanded[key] ? '▾' : '▸'}</span>{label}<small>({total})</small></div><div role="group" hidden={!expanded[key]}>{children}</div></div>;
  }
  return <><div ref={root} className="model-tree" role="tree" aria-label={t.modelTree} onContextMenu={e => { e.preventDefault(); e.stopPropagation(); open(e.target as HTMLElement, e.clientX, e.clientY); }} onKeyDown={e => {
    if (disabled || e.defaultPrevented) return;
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); const target = e.target as HTMLElement, box = target.getBoundingClientRect(); open(target, box.left + 20, box.bottom); return; }
    const items = [...(root.current?.querySelectorAll<HTMLElement>('[role=treeitem]') ?? [])].filter(item => !item.closest('[hidden]'));
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (['ArrowDown','ArrowUp','Home','End'].includes(e.key)) { e.preventDefault(); items[e.key === 'Home' ? 0 : e.key === 'End' ? items.length-1 : Math.max(0,Math.min(items.length-1,index+(e.key==='ArrowDown'?1:-1)))]?.focus(); }
    if (e.key === 'ArrowLeft') { const node = (e.target as HTMLElement).parentElement?.closest<HTMLElement>('[role=treeitem][aria-expanded]'); if (node) { e.preventDefault(); node.focus(); } }
  }}>
    {branch('welds',t.welds,count,Array.from({length:count},(_,i)=>leaf(`weld-${i}`,`${t.weld} S${i+1}`,panel==='weld'&&selected===i,()=>onWeld(i),'╱')))}
    {branch('loads',t.loads,forces.length+1,<>{forces.map(f=>leaf(`force-${f.id}`,`${t.force} ${f.title}`,panel==='loads'&&loadView==='force'&&activeForce===f.id,()=>onForce(f.id),'↗'))}{leaf('couple',t.freeCoupleNode,panel==='loads'&&loadView==='couple',onCouple,'↶')}</>)}
    {leaf('results',t.results,false,onResults,'▤')}
  </div>{context && !disabled && <div ref={menu} className="editor-context tree-context" role="menu" aria-label={t.treeCommands} style={{left:context.x,top:context.y}} onKeyDown={e=>{
    if(e.key==='Escape'||e.key==='Tab'){e.preventDefault();e.stopPropagation();close();}
    if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault(); const items=[...(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')??[])];const i=items.indexOf(document.activeElement as HTMLButtonElement);items[e.key==='Home'?0:e.key==='End'?items.length-1:(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();}
  }}>
    <button role="menuitem" disabled={!canAddWeld} onClick={()=>{focusAfterAction.current=true;setExpanded(v=>({...v,welds:true}));setContext(null);onAddWeld();}}>{t.add}</button>
    <button role="menuitem" disabled={!canAddForce} onClick={()=>{focusAfterAction.current=true;setExpanded(v=>({...v,loads:true}));setContext(null);onAddForce();}}>{t.addForce}</button>
    {context.key?.startsWith('weld-') && <>
      <button role="menuitem" disabled={!canAddWeld} onClick={()=>{const index=Number(context.key!.slice(5));setContext(null);onCopyWeld(index);}}>{t.copyWeld}</button>
      <button role="menuitem" onClick={()=>{const index=Number(context.key!.slice(5));focusAfterAction.current=true;setContext(null);onDeleteWeld(index);}}>{t.deleteWeld}</button>
    </>}
    {context.key?.startsWith('force-') && <>
      <button role="menuitem" disabled={!canAddForce} onClick={()=>{const id=context.key!.slice(6);focusAfterAction.current=true;setContext(null);onCopyForce(id);}}>{t.copyForce}</button>
      <button role="menuitem" onClick={()=>{const id=context.key!.slice(6);focusAfterAction.current=true;setContext(null);onDeleteForce(id);}}>{t.removeForce}</button>
    </>}
    <button role="menuitem" onClick={close}>{t.closeMenu}</button>
  </div>}</>;
}
