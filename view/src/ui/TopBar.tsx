// Top bar (view spec §8.5): name, simulated time, 2D/3D, building and floor filters.
import { useEffect, useState } from 'react';
import { formatClockLabel, simNowMs } from '../domain/clock';
import { HEAT_SCALES, type HeatQuantity } from '../domain/heat';
import { useConnectionStore } from '../store/connection';
import { useLiveStore } from '../store/live';
import { useModelStore } from '../store/model';
import { useUiStore } from '../store/ui';

function useClockLabel(): string {
  const [label, setLabel] = useState('—');
  useEffect(() => {
    const tick = () => {
      const c = useLiveStore.getState().clock;
      setLabel(c ? formatClockLabel(simNowMs(c, Date.now()), c.speed) : '—');
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, []);
  return label;
}

const SCENARIO_EMOJI: Record<string, string> = {
  fire: '🔥', gas_leak: '💨', co_poisoning: '☠️', earthquake: '🌍', storm: '⛈️', heatwave: '🌡️', cold_wave: '❄️',
  pollution: '🏭', power_peak: '⚡', solar_surplus: '☀️', blackout: '🔌', sensor_fault: '🛠️', actuator_fault: '🛠️', cascade: '⛓️',
};

const BROKER_TEXT = { online: 'broker collegato', connecting: 'broker: collegamento…', offline: 'broker non raggiungibile', auth_failed: 'credenziali rifiutate' };
const SIM_TEXT = { online: 'simulatore in linea', offline: 'simulatore non in linea', unknown: 'simulatore: stato sconosciuto' };

function StatusDots() {
  const broker = useConnectionStore((s) => s.broker);
  const sim = useLiveStore((s) => s.simulator);
  const dot = (ok: boolean, warn: boolean) => `dot ${ok ? 'dot--ok' : warn ? 'dot--warn' : 'dot--bad'}`;
  return (
    <span className="topbar__status">
      <span className={dot(broker === 'online', broker === 'connecting')} title={BROKER_TEXT[broker]} aria-label={BROKER_TEXT[broker]} />
      <span className={dot(sim === 'online', sim === 'unknown')} title={SIM_TEXT[sim]} aria-label={SIM_TEXT[sim]} />
    </span>
  );
}

function ScenarioChips() {
  const scenarios = useLiveStore((s) => s.scenarios);
  if (scenarios.length === 0) return null;
  return (
    <span className="topbar__chips">
      {scenarios.map((sc) => (
        <span key={sc.scenario_id} className="chip" title={`avviato alle ${sc.sim_started_at.slice(11, 16)} (ora simulata)`}>
          {SCENARIO_EMOJI[sc.scenario] ?? '•'} {sc.scenario} · {sc.target}
        </span>
      ))}
    </span>
  );
}

export function TopBar() {
  const name = useModelStore((s) => s.model?.complex.name ?? 'Complesso');
  const layout = useModelStore((s) => s.layout);
  const buildings = layout?.buildings ?? [];
  const mode = useUiStore((s) => s.mode);
  const building = useUiStore((s) => s.building);
  const floor = useUiStore((s) => s.floor);
  const heatQuantity = useUiStore((s) => s.heatQuantity);
  const heatOn = useUiStore((s) => s.heatOn);
  const dataMode = useUiStore((s) => s.dataMode);
  const ui = useUiStore.getState();
  const clock = useClockLabel();
  const floors = Math.max(0, ...buildings.map((b) => b.floors));

  return (
    <header className="topbar">
      <strong className="topbar__name">{name}</strong>
      <span className="topbar__clock">{clock}</span>
      <div className="segmented" role="group" aria-label="Modalità">
        <button className={mode === '3d' ? 'is-on' : ''} onClick={() => ui.setMode('3d')} title="3 = vista 3D">3D</button>
        <button className={mode === '2d' ? 'is-on' : ''} onClick={() => ui.setMode('2d')} title="2 = planimetria 2D">2D</button>
      </div>
      <label className="topbar__field">Palazzo
        <select value={building ?? ''} onChange={(e) => ui.setBuilding(e.target.value || null)}>
          <option value="">Tutti</option>
          {buildings.map((b) => <option key={b.id} value={b.id}>{b.id}</option>)}
        </select>
      </label>
      <label className="topbar__field">Piano
        <select value={floor ?? ''} onChange={(e) => ui.setFloor(e.target.value === '' ? null : Number(e.target.value))}>
          {mode === '3d' && <option value="">Tutti</option>}
          {Array.from({ length: floors }, (_, f) => <option key={f} value={f}>{f === 0 ? 'T' : f}</option>)}
        </select>
      </label>
      <label className="topbar__field">Mappa
        <select value={heatQuantity} onChange={(e) => ui.setHeatQuantity(e.target.value as HeatQuantity)}>
          {(Object.keys(HEAT_SCALES) as HeatQuantity[]).map((q) => <option key={q} value={q}>{HEAT_SCALES[q].label}</option>)}
        </select>
      </label>
      <button className={`switch ${heatOn ? 'is-on' : ''}`} role="switch" aria-checked={heatOn} onClick={() => ui.toggleHeat()} title="H = mappa di calore">
        Mappa di calore
      </button>
      <button className={`switch ${dataMode ? 'is-on' : ''}`} role="switch" aria-checked={dataMode} onClick={() => ui.toggleDataMode()} title="M = modalità dati">
        Modalità dati
      </button>
      <ScenarioChips />
      <StatusDots />
    </header>
  );
}
