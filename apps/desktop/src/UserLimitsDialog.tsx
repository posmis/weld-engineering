import {useEffect,useRef,useState} from 'react';
import {backend} from './backend';
import type {LimitComponent,UserLimits} from './contracts';
import {NumberField} from './NumberField';
import {sameValue} from './projectHistory';
import type ru from './locales/ru.json';
export const limitComponents:LimitComponent[]=['tension','compression','shear'];
export function UserLimitsDialog({limits,t,describeError,onApply,onCancel}:{limits?:UserLimits;t:typeof ru;describeError:(e:unknown)=>string;onApply:(limits:UserLimits|undefined)=>void;onCancel:()=>void}){
 const [draft,setDraft]=useState<UserLimits>(()=>limits?structuredClone(limits):{method_id:'independent-nominal-components-v1',tension:{value_mpa:NaN,source:''},compression:{value_mpa:NaN,source:''},shear:{value_mpa:NaN,source:''}}),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const root=useRef<HTMLDivElement>(null),mounted=useRef(true),origin=useRef(limits);origin.current=limits;
 useEffect(()=>{mounted.current=true;const previous=document.activeElement;root.current?.querySelector('input')?.focus();return()=>{mounted.current=false;if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();};},[]);
 const valid=limitComponents.every(k=>Number.isFinite(draft[k].value_mpa)&&draft[k].value_mpa>0&&draft[k].source.trim().length>0);
 async function apply(){if(!valid||busy)return;const source=limits;setBusy(true);setError('');try{const value=await backend.validateUserLimits({schema_version:1,limits:draft});if(!mounted.current||origin.current!==source)return;if(!sameValue(value,draft))throw {code:'invalid_user_limits'};onApply(value);}catch(e){if(mounted.current)setError(describeError(e));}finally{if(mounted.current)setBusy(false);}}
 return <div className="modal-backdrop"><div ref={root} role="dialog" aria-modal="true" aria-labelledby="user-limits-title" className="unsaved-dialog" onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();onCancel();}if(e.key==='Tab'){const fields=[...(root.current?.querySelectorAll<HTMLElement>('input:not(:disabled),button:not(:disabled)')??[])];if(e.shiftKey&&document.activeElement===fields[0]){e.preventDefault();fields.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===fields.at(-1)){e.preventDefault();fields[0]?.focus();}}}}><h2 id="user-limits-title">{t.userLimits}</h2><p>{t.userLimitsScope}</p><fieldset disabled={busy}>
 {limitComponents.map((key,i)=><fieldset key={key}><legend>{t.limitNames[i]}</legend><label className="settings-field">MPa<NumberField label={`${t.limitNames[i]}, MPa`} value={draft[key].value_mpa} onChange={n=>setDraft({...draft,[key]:{...draft[key],value_mpa:n}})}/></label><label className="settings-field">{t.limitSource}<input maxLength={500} aria-label={`${t.limitNames[i]} · ${t.limitSource}`} value={draft[key].source} onChange={e=>setDraft({...draft,[key]:{...draft[key],source:e.target.value}})}/></label></fieldset>)}
 <button disabled={!valid} onClick={()=>void apply()}>{busy?t.busy:t.applyUserLimits}</button>{limits&&<button onClick={()=>onApply(undefined)}>{t.removeUserLimits}</button>}</fieldset>{error&&<p role="alert">{error}</p>}<button onClick={onCancel}>{t.cancel}</button></div></div>;
}
