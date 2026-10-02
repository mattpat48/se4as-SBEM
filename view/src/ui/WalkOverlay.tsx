// First-person panel (V21): where you are, the "Vai a…" jump, device names, door messages, and
// the on-screen walking pad.
import { useEffect, useState, type FormEvent, type PointerEvent } from 'react';
import { placeLabel } from '../domain/whereabouts';
import { useModelStore } from '../store/model';
import { useUiStore } from '../store/ui';
import { useWalkStore } from '../store/walk';
import { clearWalkInput, walkInput } from '../store/walkInput';

const NOTICE_MS = 3000;
const floorName = (f: number) => (f === 0 ? 'T' : String(f));

export function WalkOverlay() {
  const active = useWalkStore((s) => s.active);
  const place = useWalkStore((s) => s.place);
  const notice = useWalkStore((s) => s.notice);
  const layout = useModelStore((s) => s.layout);
  const show = useUiStore((s) => s.showDeviceNames);
  const [target, setTarget] = useState({ building: '', floor: 0, number: 1 });

  // The jump form starts from the apartment the visit began in.
  useEffect(() => {
    if (!active) return;
    const p = useWalkStore.getState().place;
    if (p.kind === 'apartment') {
      const apt = layout?.apartments.find((a) => a.id === p.unitId);
      if (apt) setTarget({ building: apt.building, floor: apt.floor, number: apt.number });
    }
  }, [active, layout]);
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => useWalkStore.getState().setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(t);
  }, [notice]);

  if (!active || !layout) return null;
  const buildings = layout.buildings.filter((b) => b.supportsPlan);
  const chosen = buildings.find((b) => b.id === target.building) ?? buildings[0];
  const floors = Array.from({ length: chosen?.floors ?? 0 }, (_, f) => f);
  const numbers = layout.apartments.filter((a) => a.building === chosen?.id && a.floor === target.floor).map((a) => a.number).sort();
  const jump = (e: FormEvent) => {
    e.preventDefault();
    if (chosen) useWalkStore.getState().start(layout, `${chosen.id}-${target.floor}-${target.number}`);
  };
  const hold = (field: keyof typeof walkInput, value: number) => (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); walkInput[field] = value;
  };
  const button = (label: string, text: string, field: keyof typeof walkInput, value: number) => (
    <button aria-label={label} onPointerDown={hold(field, value)} onPointerUp={clearWalkInput} onPointerCancel={clearWalkInput}
      onLostPointerCapture={clearWalkInput}
      onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); walkInput[field] = value; } }}
      onKeyUp={clearWalkInput}>{text}</button>
  );
  return <>
    <div className="walk-heading">
      <strong>{placeLabel(place)} · Prima persona</strong>
      <form className="walk-jump" onSubmit={jump} aria-label="Vai a un appartamento">
        <span>Vai a</span>
        <select aria-label="Palazzo" value={chosen?.id ?? ''} onChange={(e) => setTarget({ building: e.target.value, floor: 0, number: 1 })}>
          {buildings.map((b) => <option key={b.id} value={b.id}>{b.id}</option>)}
        </select>
        <select aria-label="Piano" value={target.floor} onChange={(e) => setTarget({ ...target, floor: Number(e.target.value), number: 1 })}>
          {floors.map((f) => <option key={f} value={f}>{floorName(f)}</option>)}
        </select>
        <select aria-label="Interno" value={target.number} onChange={(e) => setTarget({ ...target, number: Number(e.target.value) })}>
          {numbers.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <button type="submit">Vai</button>
      </form>
      {notice && <span className="walk-notice" role="status">{notice}</span>}
      <span>Clicca un dispositivo per vedere i dettagli, una porta per aprirla</span>
      <button aria-pressed={show} onClick={() => useUiStore.getState().toggleDeviceNames()}>{show ? 'Nascondi' : 'Mostra'} nomi dispositivi</button>
    </div>
    <section className="walk-controls" aria-label="Movimento in prima persona">
      <p>Trascina per guardarti intorno · W A S D o frecce per camminare · Shift per correre · E apre e chiude le porte · Esc per uscire</p>
      <div className="walk-pad">
        {button('Gira a sinistra', '↶', 'turn', -1)}{button('Cammina avanti', '↑', 'forward', 1)}{button('Gira a destra', '↷', 'turn', 1)}
        {button('Passo a sinistra', '←', 'right', -1)}{button('Cammina indietro', '↓', 'forward', -1)}{button('Passo a destra', '→', 'right', 1)}
      </div>
    </section>
  </>;
}
