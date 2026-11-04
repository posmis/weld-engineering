import { useState } from 'react';
import type { CalculationResult } from './contracts';
import { NominalResults } from './NominalResults';
import type ru from './locales/ru.json';
const formatter = new Intl.NumberFormat('ru-RU', { maximumSignificantDigits: 9 });
const display = (n: number) => formatter.format(n);
export function ProjectResults({ result, t, selected, onSelect }: { result: CalculationResult | null; t: typeof ru; selected: number; onSelect: (index: number) => void }) {
  const [tab, setTab] = useState<'stress' | 'geometry'>('stress');
  return <>
    <div className="result-warning"><span className="unsupported">{t.unsupported}</span><span className="validation" title={t.validation}>{t.validation}</span></div>
    <div className="result-tabs" role="tablist" aria-label={t.resultTabs}>
      <button role="tab" aria-selected={tab === 'stress'} aria-controls="stress-results" id="stress-tab" onClick={() => setTab('stress')}>{t.stresses}</button>
      <button role="tab" aria-selected={tab === 'geometry'} aria-controls="geometry-results" id="geometry-tab" onClick={() => setTab('geometry')}>{t.geometry}</button>
    </div>
    {!result ? <p className="empty">{t.noResult}</p> : <>
      <div role="tabpanel" id="stress-results" aria-labelledby="stress-tab" hidden={tab !== 'stress'}>
        {result.traction_mpa ? <><h3>{t.traction}</h3><dl className="metric-grid">{result.traction_mpa.map((value, i) => <div className="metric" key={i}><dt>{['τx', 'τy', 'σz'][i]}</dt><dd>{display(value)} <small>MPa</small></dd></div>)}</dl></> : result.distribution ? <NominalResults distribution={result.distribution} selected={selected} onSelect={onSelect} t={t}/> : <p>{result.warnings.includes('ill_conditioned_section') ? t.illConditioned : t.momentNotice}</p>}
        <p className="hint">{t.safety}</p>
      </div>
      <div role="tabpanel" id="geometry-results" aria-labelledby="geometry-tab" hidden={tab !== 'geometry'}>
        <dl className="metric-grid"><div className="metric"><dt>{t.length}</dt><dd>{display(result.geometry.length_mm)} <small>mm</small></dd></div><div className="metric"><dt>{t.area}</dt><dd>{display(result.geometry.area_mm2)} <small>mm²</small></dd></div>
          <div className="metric"><dt>{t.centre} X / Y</dt><dd>{result.geometry.centroid_mm.map(display).join(' / ')} <small>mm</small></dd></div>
          {(['ix_mm4', 'iy_mm4', 'ixy_mm4', 'polar_mm4'] as const).map((key, i) => <div className="metric" key={key}><dt>{['Ix', 'Iy', 'Ixy', 'J'][i]}</dt><dd>{display(result.geometry[key])} <small>mm⁴</small></dd></div>)}
        </dl>
        <h3>{t.momentCentre}</h3><p className="values">{result.moment_at_centroid_n_mm.map(display).join(' / ')} N·mm</p>
        <p className="engine">{result.method_id}<br/>Engine {result.engine_version} · schema {result.schema_version}</p>
      </div>
    </>}
  </>;
}
