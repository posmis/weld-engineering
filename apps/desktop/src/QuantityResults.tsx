import {useEffect,useMemo,useState} from 'react';
import {backend} from './backend';
import type {Project,QuantityRequest,QuantityResult} from './contracts';
import {sameValue} from './projectHistory';
import type ru from './locales/ru.json';
export function QuantityResults({project,t}:{project:Project;t:typeof ru}){
 const [open,setOpen]=useState(false),[received,setReceived]=useState<{request:QuantityRequest;value:QuantityResult}|null>(null),[failed,setFailed]=useState<QuantityRequest|null>(null);
 const request=useMemo<QuantityRequest>(()=>({schema_version:1,segments:project.input.segments,materials:project.materials??null}),[project.input.segments,project.materials]);
 const finite=request.segments.every(s=>[...s.start_mm,...s.end_mm,s.effective_width_mm,...(s.section?[s.section.leg_1_mm,s.section.leg_2_mm]:[])].every(Number.isFinite));
 useEffect(()=>{if(!open||!finite)return;let active=true;const timer=setTimeout(()=>{void backend.quantities(request).then(value=>{if(value.schema_version!==1||value.method_id!=='prismatic-right-triangle-quantities-v1'||!sameValue(JSON.parse(JSON.stringify(value.source)),JSON.parse(JSON.stringify(request))))throw new Error('Stale quantities');if(active)setReceived({request,value});}).catch(()=>{if(active)setFailed(request);});},250);return()=>{active=false;clearTimeout(timer);};},[request,open,finite]);
 const value=finite&&received?.request===request?received.value:null;
 const number=(n:number|null)=>n===null?t.quantityUnknown:n!==0&&(Math.abs(n)<1e-5||Math.abs(n)>=1e8)?n.toExponential(6):new Intl.NumberFormat(undefined,{maximumSignificantDigits:10}).format(n);
 return <details className="case-results" onToggle={e=>setOpen(e.currentTarget.open)}><summary>{t.quantities}</summary><p className="hint">{t.quantityScope}</p>
 {value?<><p>{value.known_segments}/{value.total_segments} · {value.complete?t.quantityComplete:t.quantityMissing}</p><dl className="metric-grid"><div><dt>{t.quantityVolume}, mm³</dt><dd>{number(value.volume_mm3)}</dd></div><div><dt>{t.quantityKnownVolume}, mm³</dt><dd>{number(value.known_volume_mm3)}</dd></div><div><dt>{t.quantityMass}, kg</dt><dd>{number(value.mass_kg)}</dd></div><div><dt>{t.quantityDensity}, kg/m³</dt><dd>{number(value.density_kg_m3)}</dd><small>{value.density_source}</small></div></dl>
 <table tabIndex={0} aria-label={t.quantities}><thead><tr><th>#</th><th>{t.quantityLength}, mm</th><th>{t.quantityArea}, mm²</th><th>V, mm³</th><th>m, kg</th></tr></thead><tbody>{value.segments.map(s=><tr key={s.segment_index}><td>S{s.segment_index+1}</td><td>{number(s.length_mm)}</td><td>{number(s.section_area_mm2)}</td><td>{number(s.volume_mm3)}</td><td>{number(s.mass_kg)}</td></tr>)}</tbody></table></>:<p>{failed===request||!finite?t.error:open?t.busy:'—'}</p>}
 </details>;
}
