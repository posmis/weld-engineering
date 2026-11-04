import { useState } from 'react';
import type { NominalDistribution } from './contracts';
import type ru from './locales/ru.json';
const formatter = new Intl.NumberFormat('ru-RU', { maximumSignificantDigits: 9 });
const display = (v: number) => formatter.format(v);
export function NominalResults({ distribution, selected, onSelect, t }: {
  distribution: NominalDistribution; selected: number; onSelect: (index: number) => void; t: typeof ru;
}) {
  const [component, setComponent] = useState(2);
  const index = Math.max(0, Math.min(selected, distribution.segments.length - 1));
  const segment = distribution.segments[index]; if (!segment) return null;
  const start = segment.start_mpa[component], end = segment.end_mpa[component];
  // Screen coordinates only. All stresses and extrema are supplied by Rust.
  const extent = Math.max(Math.abs(start), Math.abs(end)) || 1;
  const y = (v: number) => 100 - (v / extent) * 65;
  return <div className="nominal-results"><h3>{t.nominalDistribution}</h3><p className="hint">{t.nominalHelp}</p>
    <dl><dt>{t.normalRange}</dt><dd>{distribution.normal_range_mpa.map(display).join(' / ')} <small>MPa</small></dd>
      <dt>{t.maxShear}</dt><dd>{display(distribution.max_shear_mpa)} <small>MPa</small></dd></dl>
    <label className="stress-choice">{t.stressSegment}<select aria-label={t.stressSegment} value={index} onChange={e => onSelect(Number(e.target.value))}>
      {distribution.segments.map((_, i) => <option key={i} value={i}>S{i + 1}</option>)}
    </select></label>
    <label className="stress-choice">{t.stressComponent}<select aria-label={t.stressComponent} value={component} onChange={e => setComponent(Number(e.target.value))}>
      {['τx', 'τy', 'σz'].map((name, i) => <option key={name} value={i}>{name}</option>)}
    </select></label>
    <svg className="stress-chart" viewBox="0 0 340 210" role="img" aria-label={t.distributionChart}>
      <path d="M45 20V180H320 M45 100H320" className="axis"/>
      <path d={`M45 ${y(start)} L315 ${y(end)}`} className="stress-profile"/>
      <circle cx="45" cy={y(start)} r="4"/><circle cx="315" cy={y(end)} r="4"/>
      <text x="48" y="16">{['τx', 'τy', 'σz'][component]}, MPa</text>
      <text x="48" y="200">0</text><text x="260" y="200">s/L = 1</text>
      <text x="48" y="90">0</text>
      <text x="52" y={Math.max(30, y(start) - 8)}>{display(start)}</text>
      <text x="310" textAnchor="end" y={Math.max(30, y(end) - 8)}>{display(end)}</text>
    </svg>
    <table aria-label={t.stressValues}><thead><tr><th>S{index + 1}</th><th>τx, MPa</th><th>τy, MPa</th><th>σz, MPa</th></tr></thead>
      <tbody>{[segment.start_mpa, segment.end_mpa].map((value, i) => <tr key={i}><th>{i === 0 ? t.startPoint : t.endPoint}</th>{value.map((v, j) => <td key={j}>{display(v)}</td>)}</tr>)}</tbody></table>
    <p className="hint">{t.equilibriumError}: {distribution.equilibrium_error.toExponential(2)}
      {distribution.bending_rcond !== null && <><br/>{t.bendingCondition}: {distribution.bending_rcond.toExponential(2)}</>}</p>
  </div>;
}
