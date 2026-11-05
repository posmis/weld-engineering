import {useEffect,useState} from 'react';
import {backend} from './backend';
import type {LimitEvaluation,Project,SourceLoad} from './contracts';
import {sameValue} from './projectHistory';
import type ru from './locales/ru.json';
export function UserLimitResults({project,t}:{project:Project;t:typeof ru}){
 const [received,setReceived]=useState<{project:Project;value:LimitEvaluation}|null>(null),[failed,setFailed]=useState<Project|null>(null);
 const numbers=(v:SourceLoad)=>[...v.force_n,...v.couple_n_mm,...(v.application.kind==='point'?v.application.point_mm:[]),...(v.forces??[]).flatMap(f=>[...f.force_n,...(f.application.kind==='point'?f.application.point_mm:[])])];
 const finite=[...project.input.segments.flatMap(s=>[...s.start_mm,...s.end_mm,s.effective_width_mm]),...numbers(project.input),...(project.casebook?.cases??[]).flatMap(numbers)].every(Number.isFinite);
 const hasResults=project.casebook?project.casebook.cases.some(c=>c.last_calculation):!!project.last_calculation;
 useEffect(()=>{if(!project.user_limits||!hasResults||!finite)return;let active=true;const timer=setTimeout(()=>{void backend.evaluateUserLimits({schema_version:1,project}).then(value=>{if(value.schema_version!==1||value.strength_status!=='unsupported_calculation'||!sameValue(value.limits,project.user_limits))throw new Error('invalid limit comparison');if(active)setReceived({project,value});}).catch(()=>{if(active)setFailed(project);});},250);return()=>{active=false;clearTimeout(timer);};},[project,hasResults,finite]);
 if(!project.user_limits)return null;
 const value=finite&&received?.project===project?received.value:null;
 const status=(s:string)=>s==='within_user_limits'?t.withinUserLimits:s==='exceeds_user_limits'?t.exceedsUserLimits:t.incompleteUserLimits;
 const display=(n:number)=>new Intl.NumberFormat(undefined,{maximumSignificantDigits:10}).format(n);
 return <details className="case-results"><summary>{t.userLimitComparison} · {value?`${value.available}/${value.total} — ${status(value.status)}`:failed===project?t.error:(!hasResults||!finite)?t.incompleteUserLimits:'…'}</summary><p className="hint">{t.userLimitsScope}</p>
 {value&&<><p>{t.knownLimitExcesses}: {value.exceeded}. {t.limitMaximum}: {value.maximum_ratio===null?'—':display(value.maximum_ratio)}</p>{value.cases.map(c=><section key={c.case_id}><h3>{c.title} · {c.status==='unavailable'?c.reason==='not_computed'?t.caseNotComputed:t.caseUnsupported:status(c.status)}</h3><dl className="metric-grid">{(['tension','compression','shear'] as const).map((key,i)=>{const p=c[key];return <div key={key}><dt>{t.limitNames[i]}</dt><dd>{p?`${display(p.demand_mpa)} / ${display(p.limit_mpa)} MPa = ${display(p.ratio)}`:'—'}</dd>{p?.point&&<small>S{p.point.segment_index+1} · {p.point.endpoint==='start'?'1':'2'}</small>}</div>;})}</dl></section>)}</>}
 </details>;
}
