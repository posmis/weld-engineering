import type { CalculationInput } from './contracts';
export function LoadGlyphs({ input, anchor }: { input: CalculationInput; anchor: [number, number] }) {
  const [x, y] = anchor, [fx, fy, fz] = input.force_n;
  const peak = Math.max(Math.abs(fx), Math.abs(fy));
  const length = peak > 0 ? Math.hypot(fx / peak, fy / peak) : 0;
  const dx = length > 0 ? (fx / peak) / length : 0, dy = length > 0 ? -(fy / peak) / length : 0;
  const end = [x + dx * 64, y + dy * 64];
  const mz = input.couple_n_mm[2], sign = mz > 0 ? 1 : -1;
  return <g className="load-glyphs" pointerEvents="none" aria-label="Fxy / Fz / Mz">
    {Number.isFinite(length) && length > 0 && <g data-load-glyph="Fxy"><path d={`M${x} ${y} L${end[0]} ${end[1]}`}/><path className="load-arrowhead" d={`M${end[0]} ${end[1]} L${end[0] - dx * 10 - dy * 5} ${end[1] - dy * 10 + dx * 5} L${end[0] - dx * 10 + dy * 5} ${end[1] - dy * 10 - dx * 5} Z`}/><text x={end[0] + 8} y={end[1] - 8}>Fxy</text></g>}
    {Number.isFinite(fz) && fz !== 0 && <g data-load-glyph={fz > 0 ? 'Fz+' : 'Fz-'}>
      <path className="load-leader" d={`M${x} ${y} L${x - 28} ${y - 40}`}/><circle cx={x - 28} cy={y - 40} r="9"/>
      {fz > 0 ? <circle className="load-arrowhead" cx={x - 28} cy={y - 40} r="2.5"/> : <path d={`M${x - 33} ${y - 45}l10 10 m-10 0l10 -10`}/>}
      <text x={x - 38} y={y - 54}>Fz</text>
    </g>}
    {Number.isFinite(mz) && mz !== 0 && <g className="moment-glyph" data-load-glyph={mz > 0 ? 'Mz+' : 'Mz-'}>
      <path d={`M${x + 26} ${y} A26 26 0 1 ${mz > 0 ? 0 : 1} ${x - 26} ${y}`}/>
      <path className="load-arrowhead" d={`M${x - 26} ${y} L${x - 31} ${y - sign * 9} L${x - 21} ${y - sign * 9} Z`}/><text x={x + 29} y={y + 24}>Mz</text>
    </g>}
  </g>;
}
