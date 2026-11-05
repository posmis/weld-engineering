import {useEffect,useRef,useState} from 'react';
import {backend} from './backend';
import type {CustomProperty,MaterialCard,MaterialEvaluation,MaterialPropertyKind,MaterialSelection} from './contracts';
import {NumberField} from './NumberField';
import {sameValue} from './projectHistory';
import type ru from './locales/ru.json';
export const materialKinds:MaterialPropertyKind[]=['yield_strength','tensile_strength','elastic_modulus','density'];
export function MaterialDialog({selection,t,describeError,onApply,onCancel}:{selection?:MaterialSelection;t:typeof ru;describeError:(e:unknown)=>string;onApply:(selection:MaterialSelection)=>void;onCancel:()=>void}){
 const [draft,setDraft]=useState<MaterialSelection>(()=>selection?structuredClone(selection):{context:{thickness_mm:NaN,temperature_c:NaN},base:null,weld:null});
 const [preview,setPreview]=useState<{draft:MaterialSelection;value:MaterialEvaluation;source:MaterialSelection|undefined}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const mounted=useRef(true),root=useRef<HTMLDivElement>(null),current=useRef(draft),source=useRef(selection);current.current=draft;source.current=selection;
 useEffect(()=>{mounted.current=true;const previous=document.activeElement;root.current?.querySelector('input')?.focus();return()=>{mounted.current=false;if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();};},[]);
 function card(role:'base'|'weld',value:MaterialCard|null){setDraft({...draft,[role]:value});}
 function property(role:'base'|'weld',index:number,value:CustomProperty){const c=draft[role]!;card(role,{...c,properties:c.properties.map((p,i)=>i===index?value:p)});}
 const valid=Number.isFinite(draft.context.thickness_mm)&&draft.context.thickness_mm>0&&Number.isFinite(draft.context.temperature_c)&&draft.context.temperature_c>=-273.15&&[draft.base,draft.weld].every(c=>!c||(c.designation.trim().length>0&&c.properties.every(p=>p.source.trim().length>0&&Number.isFinite(p.value)&&p.value>0&&[...p.thickness_mm,...p.temperature_c].every(Number.isFinite)&&p.thickness_mm[0]>=0&&p.thickness_mm[1]>p.thickness_mm[0]&&p.temperature_c[0]>=-273.15&&p.temperature_c[1]>=p.temperature_c[0])));
 async function check(){if(!valid||busy)return;const request=draft,origin=selection;setBusy(true);setError('');try{const value=await backend.evaluateMaterials({schema_version:1,selection:request});if(!mounted.current||current.current!==request||source.current!==origin)return;if(value.schema_version!==1||!sameValue(value.selection,JSON.parse(JSON.stringify(request))))throw {code:'invalid_material'};setPreview({draft:request,value,source:origin});}catch(e){if(mounted.current)setError(describeError(e));}finally{if(mounted.current)setBusy(false);}}
 const value=preview?.draft===draft&&preview.source===selection?preview.value:null;
 return <div className="modal-backdrop"><div ref={root} className="unsaved-dialog" role="dialog" aria-modal="true" aria-labelledby="materials-title" onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();onCancel();}if(e.key==='Tab'){const fields=[...(root.current?.querySelectorAll<HTMLElement>('input:not(:disabled),select:not(:disabled),button:not(:disabled)')??[])];if(e.shiftKey&&document.activeElement===fields[0]){e.preventDefault();fields.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===fields.at(-1)){e.preventDefault();fields[0]?.focus();}}}}>
 <h2 id="materials-title">{t.materials}</h2><p>{t.materialScope}</p><fieldset disabled={busy}>
 <label className="settings-field">{t.materialThickness}<NumberField label={t.materialThickness} value={draft.context.thickness_mm} onChange={n=>setDraft({...draft,context:{...draft.context,thickness_mm:n}})}/></label>
 <label className="settings-field">{t.materialTemperature}<NumberField label={t.materialTemperature} value={draft.context.temperature_c} onChange={n=>setDraft({...draft,context:{...draft.context,temperature_c:n}})}/></label>
 {(['base','weld'] as const).map(role=>{const c=draft[role],name=role==='base'?t.materialBase:t.materialWeld;return <fieldset key={role}><legend>{name}</legend>
 <label><input type="checkbox" aria-label={`${t.materialUse} ${name}`} checked={!!c} onChange={e=>card(role,e.target.checked?{kind:'custom',designation:'',product_form:null,condition:null,properties:[]}:null)}/>{t.materialUse}</label>
 {c&&<><label className="settings-field">{t.materialDesignation}<input aria-label={`${name} · ${t.materialDesignation}`} maxLength={100} value={c.designation} onChange={e=>card(role,{...c,designation:e.target.value})}/></label>
 {(['product_form','condition'] as const).map(field=><label className="settings-field" key={field}>{field==='product_form'?t.materialForm:t.materialCondition}<input aria-label={`${name} · ${field}`} maxLength={field==='product_form'?100:200} value={c[field]??''} onChange={e=>card(role,{...c,[field]:e.target.value.trim()===''?null:e.target.value})}/></label>)}
 {c.properties.map((p,index)=>{const prefix=`${name} · ${index+1}`;return <fieldset key={index}><legend>{index+1}</legend><label className="settings-field">{t.materialProperty}<select aria-label={`${prefix} · ${t.materialProperty}`} value={p.kind} onChange={e=>property(role,index,{...p,kind:e.target.value as MaterialPropertyKind})}>{materialKinds.map((kind,i)=><option key={kind} value={kind}>{t.materialPropertyNames[i]}</option>)}</select></label>
 <label className="settings-field">{t.materialValue} · {p.kind==='density'?'kg/m3':'MPa'}<NumberField label={`${prefix} · ${t.materialValue}`} value={p.value} onChange={n=>property(role,index,{...p,value:n})}/></label>
 {(['thickness_mm','temperature_c'] as const).flatMap(field=>[0,1].map(i=><label key={`${field}${i}`} className="settings-field">{field==='thickness_mm'?`t ${i?'max':'min'}, mm`:`T ${i?'max':'min'}, °C`}<NumberField label={`${prefix} · ${field} ${i}`} value={p[field][i]} onChange={n=>{const bounds:[number,number]=[...p[field]];bounds[i]=n;property(role,index,{...p,[field]:bounds});}}/></label>))}
 <label className="settings-field">{t.materialSource}<input aria-label={`${prefix} · ${t.materialSource}`} maxLength={500} value={p.source} onChange={e=>property(role,index,{...p,source:e.target.value})}/></label>
 <button onClick={()=>card(role,{...c,properties:c.properties.filter((_,i)=>i!==index)})} aria-label={`${t.remove} ${prefix}`}>{t.remove}</button></fieldset>;})}
 <button disabled={c.properties.length>=32} onClick={()=>card(role,{...c,properties:[...c.properties,{kind:'yield_strength',value:NaN,thickness_mm:[0,NaN],temperature_c:[NaN,NaN],source:''}]})} aria-label={`${t.materialAddProperty} ${name}`}>{t.materialAddProperty}</button></>}
 </fieldset>;})}
 <button disabled={!valid} onClick={()=>void check()}>{busy?t.busy:t.materialCheck}</button>
 <button disabled={!value||!valid} onClick={()=>{if(value)onApply(value.selection);}}>{t.materialApply}</button></fieldset>
 {value&&<section aria-label={t.materialResolved}>{(['base','weld'] as const).map(role=><div key={role}><h3>{role==='base'?t.materialBase:t.materialWeld}</h3><p>{value[role].designation??t.materialUnknown}</p><ul>{value[role].properties.map(p=><li key={p.kind}>{t.materialPropertyNames[materialKinds.indexOf(p.kind)]}: {p.value===null?t.materialUnknown:`${p.value} ${p.unit} · ${t.materialUserProvided}`} {p.source&&`· ${p.source}`}</li>)}</ul></div>)}</section>}
 {error&&<p role="alert">{error}</p>}<button onClick={onCancel}>{t.cancel}</button>
 </div></div>;
}
