// Debug panel (view spec §8.9, V10): manual actuator commands and the simulated clock.
import { useEffect, useMemo, useState } from 'react';
import { JUMP_PRESETS, commandFields, jumpMessage, speedMessage, type Field } from '../domain/commands';
import type { ActuatorType } from '../domain/messages';
import { sendClock, useCommandStore, type CommandEntry } from '../store/commands';
import { useLiveStore } from '../store/live';
import { useModelStore } from '../store/model';
import { useUiStore } from '../store/ui';

const STATUS_TEXT: Record<CommandEntry['status'], string> = {
  pending: 'in attesa', ok: 'ok', rejected: 'rifiutato', no_ack: 'nessun ack',
};

function initialValues(fields: Field[], state: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.type === 'bool') continue;
    const cur = state?.[f.key];
    if (f.type === 'enum') out[f.key] = typeof cur === 'string' && f.options.includes(cur) ? cur : f.options[0];
    else if (f.type === 'number') out[f.key] = typeof cur === 'number' ? cur : f.min;
    else out[f.key] = typeof cur === 'string' ? cur : '';
  }
  return out;
}

function FieldInput({ field, value, onChange }: { field: Field; value: unknown; onChange: (v: unknown) => void }) {
  switch (field.type) {
    case 'enum':
      return (
        <select value={String(value ?? field.options[0])} onChange={(e) => onChange(e.target.value)}>
          {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    case 'number': {
      const step = field.integer ? 1 : (field.max - field.min) > 100 ? 1 : 0.5;
      // Right after switching device the old values are still in state for one render.
      const n = typeof value === 'number' && Number.isFinite(value) ? value : field.min;
      return (
        <span className="debug__range">
          <input type="range" min={field.min} max={field.max} step={step} value={n}
            onChange={(e) => onChange(Number(e.target.value))} />
          <input type="number" min={field.min} max={field.max} step={step} value={value === '' ? '' : n}
            onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
        </span>
      );
    }
    case 'string':
      return <input type="text" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
    default:
      return null;
  }
}

function CommandsTab() {
  const model = useModelStore((s) => s.model);
  const selectedDevice = useUiStore((s) => s.selectedDevice);
  const selectedUnit = useUiStore((s) => s.selectedUnit);
  const log = useCommandStore((s) => s.log);
  const discarded = useLiveStore((s) => s.discarded);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);

  const units = useMemo(() => (model?.units ?? []).filter((u) => u.actuators.length > 0), [model]);
  const devices = useModelStore.getState().devices;
  const selected = selectedDevice && devices.get(selectedDevice)?.kind === 'actuator' ? devices.get(selectedDevice)! : null;
  const unitId = selected?.unitId ?? (units.some((u) => u.id === selectedUnit) ? selectedUnit : null);
  const unit = units.find((u) => u.id === unitId) ?? null;
  const type = selected ? (model?.device_types[selected.type] as ActuatorType | undefined) : undefined;
  const fields = useMemo(() => (type ? commandFields(type) : []), [type]);

  useEffect(() => {
    setError(null);
    setValues(initialValues(fields, selected ? useLiveStore.getState().states.get(selected.deviceId)?.state : undefined));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.deviceId, fields]);

  const ui = useUiStore.getState();
  const send = (cmd: Record<string, unknown>) => {
    if (!selected) return;
    setError(useCommandStore.getState().send(selected.deviceId, cmd));
  };

  return (
    <div className="debug__tab">
      <div className="debug__row">
        <label>Unità
          <select value={unit?.id ?? ''} onChange={(e) => {
            const u = units.find((x) => x.id === e.target.value);
            ui.selectUnit(u?.id ?? null);
            ui.selectDevice(u ? `${u.id}.${u.actuators[0]}` : null);
          }}>
            <option value="">—</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.id}</option>)}
          </select>
        </label>
        <label>Attuatore
          <select value={selected?.type ?? ''} disabled={!unit} onChange={(e) => ui.selectDevice(unit ? `${unit.id}.${e.target.value}` : null)}>
            <option value="">—</option>
            {unit?.actuators.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
      </div>

      {selected && (
        <form className="debug__form" noValidate onSubmit={(e) => { e.preventDefault(); send(values); }}>
          {fields.filter((f) => f.type !== 'bool').map((f) => (
            <label key={f.key} className="debug__field">
              <span>{f.key}</span>
              <FieldInput field={f} value={values[f.key]} onChange={(v) => setValues({ ...values, [f.key]: v })} />
            </label>
          ))}
          <div className="debug__actions">
            <button type="submit" className="primary">Invia</button>
            {fields.filter((f) => f.type === 'bool').map((f) => (
              <button key={f.key} type="button" onClick={() => send({ [f.key]: true })}>Invia {f.key}</button>
            ))}
          </div>
          {error && <p className="debug__error" role="alert">{error}</p>}
        </form>
      )}
      {!selected && <p className="debug__hint">Scegli un'unità e un attuatore, oppure fai clic su un attuatore nella scheda di dettaglio.</p>}

      <h4>Ultimi comandi</h4>
      <ol className="debug__log">
        {log.length === 0 && <li className="debug__hint">nessun comando inviato</li>}
        {log.map((e) => (
          <li key={e.cmdId} className={`is-${e.status}`}>
            <code>{e.deviceId}</code> {JSON.stringify(e.command)} — {STATUS_TEXT[e.status]}{e.status === 'rejected' ? `: ${e.reason}` : ''}
          </li>
        ))}
      </ol>
      <p className="debug__hint">messaggi scartati: {discarded}</p>
    </div>
  );
}

function ClockTab() {
  const clock = useLiveStore((s) => s.clock);
  const maxSpeed = useModelStore((s) => s.model?.complex.clock.max_speed ?? 60);
  const [speed, setSpeed] = useState(clock?.speed ?? 1);
  const [when, setWhen] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (clock) setSpeed(clock.speed); }, [clock?.speed]);   // eslint-disable-line react-hooks/exhaustive-deps

  const run = (build: () => { speed: number } | { jump_to: string }) => {
    try {
      setError(sendClock(build()));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const commitSpeed = (v: number) => run(() => speedMessage(v, maxSpeed));

  return (
    <div className="debug__tab">
      <label className="debug__field">
        <span>Velocità ×{speed}</span>
        <input type="range" min={1} max={maxSpeed} step={1} value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          onPointerUp={() => commitSpeed(speed)} onKeyUp={() => commitSpeed(speed)} />
      </label>
      <div className="debug__actions">
        {[1, 10, 60].filter((v) => v <= maxSpeed).map((v) => (
          <button key={v} type="button" onClick={() => { setSpeed(v); commitSpeed(v); }}>×{v}</button>
        ))}
      </div>
      <h4>Salta a</h4>
      <div className="debug__actions">
        {JUMP_PRESETS.map(([name, hhmm]) => (
          <button key={name} type="button" onClick={() => run(() => jumpMessage(hhmm))}>{name} {hhmm}</button>
        ))}
      </div>
      <form className="debug__row" onSubmit={(e) => {
        e.preventDefault();
        run(() => jumpMessage(when.length === 16 ? `${when}:00` : when));
      }}>
        <input type="datetime-local" step={1} value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Data e ora" />
        <button type="submit" className="primary">Vai</button>
      </form>
      {error && <p className="debug__error" role="alert">{error}</p>}
    </div>
  );
}

export function DebugPanel() {
  const inside = useUiStore((s) => s.firstPersonUnit);
  const open = useUiStore((s) => s.debugOpen);
  const tab = useUiStore((s) => s.debugTab);
  const ui = useUiStore.getState();
  if (!open) {
    return <button className="debug-toggle" onClick={() => ui.toggleDebug()} title="Apri il pannello di debug">{inside ? '⌨ Comandi' : '⌨ D = debug'}</button>;
  }
  return (
    <aside className="debug" aria-label="Pannello di debug">
      <header className="debug__header">
        <div className="segmented" role="tablist">
          <button role="tab" className={tab === 'commands' ? 'is-on' : ''} onClick={() => ui.setDebugTab('commands')}>Comandi</button>
          <button role="tab" className={tab === 'clock' ? 'is-on' : ''} onClick={() => ui.setDebugTab('clock')}>Orologio</button>
        </div>
        <button className="debug__close" onClick={() => ui.toggleDebug()} aria-label="Chiudi">×</button>
      </header>
      {tab === 'commands' ? <CommandsTab /> : <ClockTab />}
    </aside>
  );
}
