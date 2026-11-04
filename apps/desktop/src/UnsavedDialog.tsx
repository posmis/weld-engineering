import { useEffect, useRef } from 'react';

export function UnsavedDialog({ title, description, save, discard, cancel, busy, error, onSave, onDiscard, onCancel }: {
  title: string; description: string; save: string; discard: string; cancel: string;
  busy: boolean; error: string; onSave: () => void; onDiscard: () => void; onCancel: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    cancelButton.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <div className="modal-backdrop"><div ref={root} className="unsaved-dialog" role="alertdialog" aria-modal="true" aria-labelledby="unsaved-title" aria-describedby="unsaved-description" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); if (!busy) onCancel(); }
    if (event.key === 'Tab') {
      const buttons = [...(root.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
      if (!buttons.length) { event.preventDefault(); return; }
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }}>
    <h2 id="unsaved-title">{title}</h2><p id="unsaved-description">{description}</p>
    {error && <p className="dialog-error" role="alert">{error}</p>}
    <div className="dialog-actions"><button className="primary" disabled={busy} onClick={onSave}>{save}</button><button disabled={busy} onClick={onDiscard}>{discard}</button><button ref={cancelButton} disabled={busy} onClick={onCancel}>{cancel}</button></div>
  </div></div>;
}
