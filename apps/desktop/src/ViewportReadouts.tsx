import type { CalculationInput } from './contracts';
import type { ContourField, StressComponent } from './stressContour';
import type ru from './locales/ru.json';
const number = (v: number) => Number.isFinite(v) ? new Intl.NumberFormat('ru-RU', { maximumSignificantDigits: 7 }).format(v === 0 ? 0 : v) : '—';
export function LoadReadout({ input, pointVisible, pendingCentre, t }: { input: CalculationInput; pointVisible: boolean; pendingCentre: boolean; t: typeof ru }) {
  return <div className="viewport-loads" role="group" aria-label={t.loadReadout}>
    <strong>{t.appliedLoads}</strong><div>F: {input.force_n.map(number).join(' / ')} N</div>
    <div>M: {input.couple_n_mm.map(number).join(' / ')} N·mm <span>({t.freeCoupleShort})</span></div>
    <div>{input.application.kind === 'point' ? `P: ${input.application.point_mm.map(number).join(' / ')} mm` : t.forceAtCentre}</div>
    {(pendingCentre || !pointVisible) && <div className="view-note">{pendingCentre ? t.centreAfterCalculation : t.loadPointOutside}</div>}
  </div>;
}
export function ContourLegend({ field, component, selected, t }: { field: ContourField; component: StressComponent; selected: number; t: typeof ru }) {
  const pair = field.pairs[selected];
  return <div className="contour-legend" role="group" aria-label={t.contourLegend}>
    <strong>{['τx', 'τy', 'σz'][component]} · MPa</strong><div className={field.extent > 0 ? 'contour-ramp' : 'contour-ramp uniform'}/>
    <div className="contour-scale"><span>{number(-field.extent)}</span>{field.extent > 0 && <span>0</span>}<span>{number(field.extent)}</span></div>
    {pair && <div>S{selected + 1}: {number(pair[0])} / {number(pair[1])} MPa</div>}
    <div className="view-note">{t.contourScope}</div>
  </div>;
}
