// Live data: readings, actuator states, clock, scenarios, simulator status.
// The Maps are mutated in place so that measurements do not re-render React:
// the scene reads them every frame, React consumers follow `revision` (≤ 2 Hz).
import { create } from 'zustand';
import { clockFromMessage, type ClockState } from '../domain/clock';
import type { ActiveScenario, ClockMsg, RawMsg, ScenariosMsg, StateMsg } from '../domain/messages';

export const HISTORY_MAX = 60;
const REVISION_MIN_MS = 500;

export interface Reading { last: number; lastAt: number; prev?: number; prevAt?: number; unit: string; history: number[] }
export interface ActuatorEntry { state: Record<string, unknown>; powerW: number; at: number }

interface LiveState {
  readings: Map<string, Reading>;
  states: Map<string, ActuatorEntry>;
  clock: ClockState | null;
  scenarios: ActiveScenario[];
  simulator: 'online' | 'offline' | 'unknown';
  discarded: number;
  revision: number;
  onRaw(msg: RawMsg, nowMs: number): void;
  onState(msg: StateMsg, nowMs: number): void;
  onClock(msg: ClockMsg, nowMs: number): void;
  onScenarios(msg: ScenariosMsg): void;
  setSimulator(s: 'online' | 'offline' | 'unknown'): void;
  countDiscarded(): void;
  resetLive(): void;
  receivedSummary(): string;
}

let lastBumpAt = -Infinity;
let trailing: ReturnType<typeof setTimeout> | null = null;

export const useLiveStore = create<LiveState>()((set, get) => {
  // Throttled revision bump, with a trailing bump so the last change is never lost.
  const touch = (nowMs: number) => {
    if (nowMs - lastBumpAt >= REVISION_MIN_MS || nowMs < lastBumpAt) {
      lastBumpAt = nowMs;
      set((s) => ({ revision: s.revision + 1 }));
    } else if (trailing === null) {
      trailing = setTimeout(() => {
        trailing = null;
        set((s) => ({ revision: s.revision + 1 }));
      }, REVISION_MIN_MS);
    }
  };

  return {
    readings: new Map(),
    states: new Map(),
    clock: null,
    scenarios: [],
    simulator: 'unknown',
    discarded: 0,
    revision: 0,
    onRaw(msg, nowMs) {
      const r = get().readings.get(msg.device_id);
      if (r) {
        r.prev = r.last;
        r.prevAt = r.lastAt;
        r.last = msg.value;
        r.lastAt = nowMs;
        r.unit = msg.unit;
        r.history.push(msg.value);
        if (r.history.length > HISTORY_MAX) r.history.splice(0, r.history.length - HISTORY_MAX);
      } else {
        get().readings.set(msg.device_id, { last: msg.value, lastAt: nowMs, unit: msg.unit, history: [msg.value] });
      }
      touch(nowMs);
    },
    onState(msg, nowMs) {
      get().states.set(msg.device_id, { state: msg.state, powerW: msg.power_w, at: nowMs });
      touch(nowMs);
    },
    onClock(msg, nowMs) {
      const clock = clockFromMessage(msg, nowMs);
      if (clock) set({ clock });
    },
    onScenarios: (msg) => set({ scenarios: msg.active }),
    setSimulator: (simulator) => set({ simulator }),
    countDiscarded: () => set((s) => ({ discarded: s.discarded + 1 })),
    resetLive() {
      get().readings.clear();
      get().states.clear();
      set((s) => ({ clock: null, scenarios: [], revision: s.revision + 1 }));
    },
    receivedSummary() {
      const { readings, states } = get();
      return `${readings.size} sensori · ${states.size} attuatori ricevuti`;
    },
  };
});
