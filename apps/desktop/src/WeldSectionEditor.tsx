import { useEffect, useRef, useState } from 'react';
import { backend } from './backend';
import type { SectionModel, SegmentInput } from './contracts';
import { NumberField } from './NumberField';
import type ru from './locales/ru.json';
export function WeldSectionEditor({ segment, disabled, t, onApply, onManual }: {
  segment: SegmentInput; disabled: boolean; t: typeof ru;
  onApply: (model: SectionModel, width: number) => void; onManual: () => void;
}) {
  const [leg1,setLeg1]=useState(segment.section?.leg_1_mm ?? 3),[leg2,setLeg2]=useState(segment.section?.leg_2_mm ?? 3);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const mounted=useRef(true),current=useRef(segment),apply=useRef(onApply);current.current=segment;apply.current=onApply;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{if(segment.section){setLeg1(segment.section.leg_1_mm);setLeg2(segment.section.leg_2_mm);}},[segment.section]);
  async function submit(){
    const source=current.current,model:SectionModel={kind:'idealized_right_angle_fillet',leg_1_mm:leg1,leg_2_mm:leg2};setBusy(true);setError('');
    try{
      const value=await backend.deriveSection({schema_version:1,model});
      if(!mounted.current)return;
      if(current.current!==source){setError(t.sectionChanged);return;}
      if(value.schema_version!==1||value.status!=='idealized_geometry'||value.model.kind!==model.kind||value.model.leg_1_mm!==leg1||value.model.leg_2_mm!==leg2||!Number.isFinite(value.effective_width_mm)||value.effective_width_mm<=0)throw new Error('invalid section result');
      apply.current(value.model,value.effective_width_mm);
    }catch{if(mounted.current)setError(t.sectionError);}
    finally{if(mounted.current)setBusy(false);}
  }
  return <fieldset disabled={disabled||busy}><p className="hint">{t.filletAssumption}</p>
    <label className="settings-field">{t.filletLeg1}<NumberField label={t.filletLeg1} value={leg1} onChange={setLeg1}/></label>
    <label className="settings-field">{t.filletLeg2}<NumberField label={t.filletLeg2} value={leg2} onChange={setLeg2}/></label>
    <button disabled={![leg1,leg2].every(n=>Number.isFinite(n)&&n>0)} onClick={()=>void submit()}>{busy?t.busy:t.applySection}</button>
    {segment.section && <button onClick={onManual}>{t.manualSection}</button>}
    {error&&<p role="alert">{error}</p>}
  </fieldset>;
}
