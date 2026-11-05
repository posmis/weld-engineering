import { useEffect, useRef, useState } from 'react';
import { backend } from './backend';
import type { AppliedForce, MassLoad, Vec3 } from './contracts';
import { NumberField } from './NumberField';
import type ru from './locales/ru.json';
export function MassLoadEditor({ force, disabled, t, onApply, onManual }: {
  force: AppliedForce; disabled: boolean; t: typeof ru;
  onApply: (model: MassLoad, force: Vec3) => void; onManual: () => void;
}) {
  const [model,setModel]=useState<MassLoad>(force.inertia ?? {mass_kg:1,gravity_m_s2:[0,0,-9.80665],acceleration_m_s2:[0,0,0]});
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const mounted=useRef(true),current=useRef(force),apply=useRef(onApply);current.current=force;apply.current=onApply;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{if(force.inertia)setModel(force.inertia);},[force.inertia]);
  function vector(field:'gravity_m_s2'|'acceleration_m_s2',index:number,value:number){const next:Vec3=[...model[field]];next[index]=value;setModel({...model,[field]:next});}
  async function submit(){
    const source=current.current;setBusy(true);setError('');
    try{
      const value=await backend.deriveMassLoad({schema_version:1,model});
      if(!mounted.current)return;
      if(current.current!==source){setError(t.massChanged);return;}
      if(value.schema_version!==1||value.method_id!=='translating-mass-equivalent-load-v1'||value.model.mass_kg!==model.mass_kg||!['gravity_m_s2','acceleration_m_s2'].every(k=>(value.model[k as 'gravity_m_s2'] as Vec3).every((n,i)=>n===model[k as 'gravity_m_s2'][i]))||value.force_n.length!==3||!value.force_n.every(Number.isFinite))throw new Error('invalid mass load result');
      apply.current(value.model,value.force_n);
    }catch{if(mounted.current)setError(t.massError);}
    finally{if(mounted.current)setBusy(false);}
  }
  return <details className="scope"><summary>{t.massLoad}</summary><fieldset disabled={disabled||busy}>
    <p className="hint">{t.massAssumption}</p>
    <label className="settings-field">{t.massKg}<NumberField label={t.massKg} value={model.mass_kg} onChange={n=>setModel({...model,mass_kg:n})}/></label>
    {(['gravity_m_s2','acceleration_m_s2'] as const).map(field=><fieldset key={field}><legend>{field==='gravity_m_s2'?t.gravity:t.acceleration}</legend>{model[field].map((n,i)=><label key={i} className="settings-field">{'xyz'[i]}<NumberField label={`${field} ${'xyz'[i]}`} value={n} onChange={v=>vector(field,i,v)}/></label>)}</fieldset>)}
    <button disabled={model.mass_kg<=0||![model.mass_kg,...model.gravity_m_s2,...model.acceleration_m_s2].every(Number.isFinite)} onClick={()=>void submit()}>{busy?t.busy:t.applyMass}</button>
    {force.inertia&&<button onClick={onManual}>{t.manualForce}</button>}
    {error&&<p role="alert">{error}</p>}
  </fieldset></details>;
}
