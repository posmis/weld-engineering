import type { ReactNode } from 'react';
import type ru from './locales/ru.json';
export function PropertyTable({ label, t, children }: { label: string; t: typeof ru; children: ReactNode }) {
  return <table className="property-table" aria-label={label}><colgroup><col className="parameter-column"/><col/><col className="unit-column"/></colgroup>
    <thead><tr><th scope="col">{t.propertyParameter}</th><th scope="col">{t.propertyValue}</th><th scope="col">{t.propertyUnit}</th></tr></thead><tbody>{children}</tbody>
  </table>;
}
export function PropertyRow({ label, unit = '—', children }: { label: string; unit?: string; children: ReactNode }) {
  return <tr><th scope="row">{label}</th><td className="property-value">{children}</td><td className="property-unit">{unit}</td></tr>;
}
export function PropertyGroup({ children }: { children: ReactNode }) {
  return <tr className="property-group"><th colSpan={3}>{children}</th></tr>;
}
