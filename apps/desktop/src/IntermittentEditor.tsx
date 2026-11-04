import { useState } from 'react';
import type { IntermittentInput } from './contracts';
import { NumberField } from './NumberField';
import type ru from './locales/ru.json';
export function IntermittentEditor({ t, disabled, onApply }: { t: typeof ru; disabled: boolean; onApply: (params: Omit<IntermittentInput, 'input' | 'segment_index'>) => Promise<void> }) {
  const [length, setLength] = useState(20), [pitch, setPitch] = useState(40), [count, setCount] = useState(3);
  return <details className="intermittent-editor"><summary>{t.intermittent}</summary><fieldset disabled={disabled}>
    <label>{t.weldLength}<NumberField label={t.weldLength} value={length} onChange={setLength}/></label>
    <label>{t.pitch}<NumberField label={t.pitch} value={pitch} onChange={setPitch}/></label>
    <label>{t.pieceCount}<NumberField label={t.pieceCount} value={count} onChange={setCount}/></label>
    <p className="hint">{t.patternHelp}</p><button disabled={![length, pitch, count].every(Number.isFinite) || !Number.isInteger(count) || count < 1 || count > 256 || length <= 0 || pitch <= 0 || (count > 1 && pitch <= length)} onClick={() => void onApply({ weld_length_mm: length, pitch_mm: pitch, count })}>{t.applyPattern}</button>
  </fieldset></details>;
}
