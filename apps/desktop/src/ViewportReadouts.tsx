import type { CalculationInput } from './contracts';
import type { ContourField, StressComponent } from './stressContour';
import type ru from './locales/ru.json';
const number = (v: number) => {
  if (!Number.isFinite(v)) return '—';
  const magnitude = Math.abs(v);
  return new Intl.NumberFormat('ru-RU', { maximumSignificantDigits: 7, notation: magnitude >= 1e6 || (magnitude > 0 && magnitude < 1e-4) ? 'scientific' : 'standard' }).format(v === 0 ? 0 : v);
};
export function LoadReadout({ input, resultant, pointVisible, pendingCentre, t }: { input: CalculationInput; resultant?: [number,number,number]; pointVisible: boolean; pendingCentre: boolean; t: typeof ru }) {
  return <div className="viewport-loads" role="group" aria-label={t.loadReadout}>
    {input.forces ? <div><strong>ΣF:</strong> {resultant ? `${resultant.map(number).join(' / ')} N` : t.resultantAfterCalculation} · {input.forces.length} {t.forcesShort}</div> : <div><strong>F:</strong> {input.force_n.map(number).join(' / ')} N {input.application.kind === 'centroid' && <span title={t.forceAtCentre}>· C</span>}</div>}
    <div><strong>M:</strong> {input.couple_n_mm.map(number).join(' / ')} N·mm <span>({t.freeCoupleShort})</span></div>
    {!input.forces && input.application.kind === 'point' && <div>P: {input.application.point_mm.map(number).join(' / ')} mm {!pointVisible && <span className="view-note">{t.loadPointOutside}</span>}</div>}
    {pendingCentre && <div className="view-note">{t.centreAfterCalculation}</div>}
    {!pendingCentre && !pointVisible && input.application.kind === 'centroid' && <div className="view-note">{t.loadPointOutside}</div>}
  </div>;
}
export function ContourLegend({ field, component, selected, t }: { field: ContourField; component: StressComponent; selected: number; t: typeof ru }) {
  const pair = field.pairs[selected];
  return <div className="contour-legend" role="group" aria-label={t.contourLegend}>
    <strong>{`${['τx', 'τy', 'σz'][component]} · MPa`}</strong><div className={field.extent > 0 ? 'contour-ramp' : 'contour-ramp uniform'}/>
    <div className="contour-scale"><span>{number(-field.extent)}</span>{field.extent > 0 && <span>0</span>}<span>{number(field.extent)}</span></div>
    {pair && <div>{`S${selected + 1}: ${number(pair[0])} / ${number(pair[1])} MPa`}</div>}
    <div className="view-note">{t.contourScope}</div>
  </div>;
}
