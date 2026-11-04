import { useEffect, useState } from 'react';

export function NumberField({ value, label, onChange }: { value: number; label: string; onChange: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(Number.isFinite(value) ? String(value) : ''); }, [value]);
  return <input aria-label={label} inputMode="decimal" type="text" value={text}
    aria-invalid={!Number.isFinite(value)} onChange={e => {
      const raw = e.target.value; setText(raw);
      const normalised = raw.trim().replace(',', '.');
      onChange(normalised === '' ? NaN : Number(normalised));
    }} />;
}
