// Debug command log: send, wait for the ack (5 s), keep the last 10.
// (Spec §4 puts ack waiting in mqtt/client.ts; it lives here so it can be tested with fake timers.)
import { create } from 'zustand';
import { ACK_TIMEOUT_MS, LOG_MAX, buildCommandMessage, validateCommand } from '../domain/commands';
import type { AckMsg, ActuatorType } from '../domain/messages';
import { CLOCK_CONTROL_TOPIC, deviceTopic } from '../domain/topics';
import { useConnectionStore } from './connection';
import { useModelStore } from './model';

export interface CommandEntry {
  cmdId: string; deviceId: string; command: Record<string, unknown>;
  status: 'pending' | 'ok' | 'rejected' | 'no_ack'; reason?: string; sentAtMs: number;
}

interface CommandState {
  log: CommandEntry[];
  send(deviceId: string, cmd: Record<string, unknown>): string | null;
  resolveAck(a: AckMsg): void;
}

const newId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID()
  : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`);

export const useCommandStore = create<CommandState>()((set, get) => {
  const update = (cmdId: string, patch: Partial<CommandEntry>, onlyIfPending: boolean) => set({
    log: get().log.map((e) => (e.cmdId === cmdId && (!onlyIfPending || e.status === 'pending') ? { ...e, ...patch } : e)),
  });

  return {
    log: [],
    send(deviceId, cmd) {
      const { devices, model } = useModelStore.getState();
      const dev = devices.get(deviceId);
      if (!dev || !model) return `dispositivo sconosciuto: ${deviceId}`;
      if (dev.kind !== 'actuator') return `${deviceId} non è un attuatore`;
      const reason = validateCommand(model.device_types[dev.type] as ActuatorType, cmd);
      if (reason) return reason;
      const publish = useConnectionStore.getState().publishJson;
      if (!publish) return 'broker non collegato';
      const cmdId = newId();
      const now = Date.now();
      publish(deviceTopic('cmd', dev.area, dev.unitId, dev.type), buildCommandMessage(cmd, cmdId, now), 1);
      set({ log: [{ cmdId, deviceId, command: cmd, status: 'pending' as const, sentAtMs: now }, ...get().log].slice(0, LOG_MAX) });
      setTimeout(() => update(cmdId, { status: 'no_ack' }, true), ACK_TIMEOUT_MS);
      return null;
    },
    resolveAck(a) {
      if (a.cmd_id === null) return;
      update(a.cmd_id, a.status === 'ok' ? { status: 'ok' } : { status: 'rejected', reason: a.reason ?? '' }, true);
    },
  };
});

/** Publishes a clock control message ({speed} or {jump_to}); returns an error text or null. */
export function sendClock(msg: { speed: number } | { jump_to: string }): string | null {
  const publish = useConnectionStore.getState().publishJson;
  if (!publish) return 'broker non collegato';
  publish(CLOCK_CONTROL_TOPIC, msg, 1);
  return null;
}
