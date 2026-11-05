import {useEffect,useRef,useState} from 'react';
import {backend} from './backend';
import type {Project} from './contracts';
import {NumberField} from './NumberField';
import type ru from './locales/ru.json';
export function CombinationDialog({project,t,describeError,onApply,onCancel}:{project:Project;t:typeof ru;describeError:(e:unknown)=>string;onApply:(project:Project)=>void;onCancel:()=>void}){
 const cases=project.casebook?.cases.filter(c=>!c.combination)??[];
 const [title,setTitle]=useState(t.combinationDefault),[factors,setFactors]=useState(()=>Object.fromEntries(cases.map(c=>[c.id,1]))),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const root=useRef<HTMLDivElement>(null),mounted=useRef(true),current=useRef(project);current.current=project;
 useEffect(()=>{mounted.current=true;const previous=document.activeElement;root.current?.querySelector('input')?.focus();return()=>{mounted.current=false;if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();};},[]);
 const valid=title.trim().length>0&&Array.from(title).length<=100&&cases.length>0&&cases.every(c=>Number.isFinite(factors[c.id]))&&cases.some(c=>factors[c.id]!==0);
 async function submit(){if(!valid||busy)return;const source=project;setBusy(true);setError('');try{
  const next=await backend.combineCases({schema_version:1,project,title,terms:cases.map(c=>({case_id:c.id,factor:factors[c.id]}))});
  if(!mounted.current)return;if(current.current!==source)throw {code:'combination_source_changed'};
  if(next.schema_version!==1||next.casebook?.cases.find(c=>c.id===next.casebook?.active_id)?.combination?.method_id!=='user-linear-load-combination-v1')throw {code:'invalid_combination'};
  onApply(next);
 }catch(e){if(mounted.current)setError(describeError(e));}finally{if(mounted.current)setBusy(false);}}
 return <div className="modal-backdrop"><div ref={root} role="dialog" aria-modal="true" aria-labelledby="combination-title" className="unsaved-dialog" onKeyDown={e=>{
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();onCancel();}
  if(e.key==='Tab'){const fields=[...(root.current?.querySelectorAll<HTMLElement>('input:not(:disabled),button:not(:disabled)')??[])];if(e.shiftKey&&document.activeElement===fields[0]){e.preventDefault();fields.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===fields.at(-1)){e.preventDefault();fields[0]?.focus();}}
 }}><h2 id="combination-title">{t.combineCases}</h2><p>{t.combinationAssumption}</p><form onSubmit={e=>{e.preventDefault();void submit();}}><fieldset disabled={busy}>
 <label className="settings-field">{t.combinationTitle}<input aria-label={t.combinationTitle} maxLength={100} value={title} onChange={e=>setTitle(e.target.value)}/></label>
 {cases.map(c=><label key={c.id} className="settings-field">{c.title}<NumberField label={`${t.combinationFactor} ${c.title}`} value={factors[c.id]} onChange={n=>setFactors({...factors,[c.id]:n})}/></label>)}
 <button type="submit" disabled={!valid}>{busy?t.busy:t.createCombination}</button></fieldset><button type="button" onClick={onCancel}>{t.cancel}</button></form>{error&&<p role="alert">{error}</p>}</div></div>;
}
