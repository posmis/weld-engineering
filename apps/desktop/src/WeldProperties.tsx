import type { SegmentInput } from './contracts';
import { PropertyGroup, PropertyRow, PropertyTable } from './PropertyTable';
import { NumberField } from './NumberField';
import type ru from './locales/ru.json';
export function WeldProperties({ segments, selected, onChange, onRemove, disabled, t }: {
  segments: SegmentInput[]; selected: number; onChange: (segments: SegmentInput[]) => void; onRemove: () => void; disabled: boolean; t: typeof ru;
}) {
  const segment = segments[selected];
  if (!segment) return <p className="empty">{t.noWelds}</p>;
  function change(index: number, value: number) {
    const next: SegmentInput = { ...segment, start_mm: [...segment.start_mm], end_mm: [...segment.end_mm] };
    if (index < 2) next.start_mm[index] = value;
    else if (index < 4) next.end_mm[index - 2] = value;
    else next.effective_width_mm = value;
    onChange(segments.map((s, i) => i === selected ? next : s));
  }
  return <fieldset disabled={disabled} className="weld-properties" key={selected}>
    <div className="property-heading">{t.weld} S{selected + 1}</div>
    <PropertyTable label={`${t.weld} S${selected+1}`} t={t}>
      <PropertyGroup>{t.startPoint}</PropertyGroup>
      {[0,1].map(i=><PropertyRow key={`start-${i}`} label={['X₁','Y₁'][i]} unit="mm"><NumberField label={`S${selected+1} ${['X1','Y1'][i]}`} value={segment.start_mm[i]} onChange={n=>change(i,n)}/></PropertyRow>)}
      <PropertyGroup>{t.endPoint}</PropertyGroup>
      {[0,1].map(i=><PropertyRow key={`end-${i}`} label={['X₂','Y₂'][i]} unit="mm"><NumberField label={`S${selected+1} ${['X2','Y2'][i]}`} value={segment.end_mm[i]} onChange={n=>change(i+2,n)}/></PropertyRow>)}
      <PropertyRow label={t.width} unit="mm"><NumberField label={`S${selected+1} a`} value={segment.effective_width_mm} onChange={n=>change(4,n)}/></PropertyRow>
    </PropertyTable>
    <button className="remove-weld" aria-label={`${t.remove} S${selected + 1}`} onClick={onRemove}>{t.remove} S{selected + 1}</button>
    <details className="scope"><summary>{t.sectionModel}</summary><p>{t.scope}</p></details>
  </fieldset>;
}
