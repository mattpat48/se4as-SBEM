// Detail card (view spec §8.7): the selected unit's sensors and actuators, ≤ 2 Hz.
import { useEffect, useState } from 'react';
import { formatValue, orientationWord, trend } from '../domain/format';
import { isStale } from '../domain/interpolate';
import type { SensorType, Unit } from '../domain/messages';
import { useLiveStore } from '../store/live';
import { useModelStore } from '../store/model';
import { useUiStore } from '../store/ui';
import { Sparkline } from './Sparkline';

export { formatValue } from '../domain/format';

const KIND_LABEL: Record<Unit['kind'], string> = {
  apartment: 'appartamento', stairwell: 'vano scale', building: 'palazzo', park: 'parco', charger: 'colonnina',
};

function header(u: Unit): string {
  if (u.kind !== 'apartment') return `${u.id} · ${KIND_LABEL[u.kind]}`;
  const a = u.attrs;
  return `${u.id} · ${a.profile} · ${a.residents} residenti · soggiorno a ${orientationWord(String(a.orientation))}`;
}

/** Re-render at most twice a second, and at least once a second (for "non aggiornato"). */
function useRefresh(active: boolean): void {
  useLiveStore((s) => active ? s.revision : 0);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
}

export function DetailCard() {
  const unitId = useUiStore((s) => s.selectedUnit);
  const model = useModelStore((s) => s.model);
  const [open, setOpen] = useState<string | null>(null);
  const selectedDevice = useUiStore((s) => s.selectedDevice);
  useEffect(() => { setOpen(selectedDevice); }, [selectedDevice]);
  useRefresh(!!unitId);
  const unit = model?.units.find((u) => u.id === unitId);
  if (!model || !unit) return null;

  const live = useLiveStore.getState();
  const types = model.device_types as Record<string, SensorType>;
  const now = Date.now();
  const period = model.complex.sampling_period_s * 1000;
  const ui = useUiStore.getState();

  return (
    <aside className="card" aria-label="Scheda di dettaglio">
      <header className="card__header">
        <h3>{header(unit)}</h3>
        <button className="card__close" onClick={() => ui.clearSelection()} aria-label="Chiudi">×</button>
      </header>
      {unit.sensors.length > 0 && <h4>Sensori</h4>}
      <ul className="card__list">
        {unit.sensors.map((type) => {
          const id = `${unit.id}.${type}`;
          const r = live.readings.get(id);
          const unitText = r?.unit || types[type]?.unit || '';
          const stale = r ? isStale(r.lastAt, now, period) : false;
          return (
            <li key={id}>
              <button className="card__row" onClick={() => setOpen(open === id ? null : id)} aria-expanded={open === id}>
                <span className="card__key">{type}</span>
                {!r && <span className="card__muted">in attesa</span>}
                {r && <span className={stale ? 'card__stale' : ''}>
                  {formatValue(r.last, unitText)} {trend(type, r.last, r.prev, types)}{stale ? ' · non aggiornato' : ''}
                </span>}
              </button>
              {open === id && r && <Sparkline history={r.history} unit={unitText} />}
            </li>
          );
        })}
      </ul>
      {unit.actuators.length > 0 && <h4>Attuatori</h4>}
      <ul className="card__list">
        {unit.actuators.map((type) => {
          const id = `${unit.id}.${type}`;
          const s = live.states.get(id);
          return (
            <li key={id}>
              <button className="card__row" title="Apri nel pannello di debug" onClick={() => {
                ui.selectDevice(id);
                ui.setDebugTab('commands');
                if (!useUiStore.getState().debugOpen) ui.toggleDebug();
              }}>
                <span className="card__key">{type}</span>
                <span>{s ? Object.entries(s.state).map(([k, v]) => `${k}: ${v}`).join(' · ') : <span className="card__muted">in attesa</span>}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
