// MQTT message → store action. Never throws: invalid or unknown messages are counted.
import {
  decodeJson, parseAck, parseClock, parseModel, parseRaw, parseScenarios, parseState, parseStatus,
} from '../domain/messages';
import { clockFromMessage } from '../domain/clock';
import { parseTopic } from '../domain/topics';
import { useCommandStore } from '../store/commands';
import { useLiveStore } from '../store/live';
import { useModelStore } from '../store/model';

function knownDevice(deviceId: string, kind: 'sensor' | 'actuator'): boolean {
  return useModelStore.getState().devices.get(deviceId)?.kind === kind;
}

export function dispatch(topic: string, payload: Uint8Array | string, nowMs: number): void {
  const live = useLiveStore.getState();
  try {
    const info = parseTopic(topic);
    if (!info) return live.countDiscarded();
    switch (info.layer) {
      case 'status': {
        const status = parseStatus(payload);
        if (status === null) return live.countDiscarded();
        if (info.service === 'simulator') live.setSimulator(status);
        return;
      }
      case 'model': {
        const m = parseModel(decodeJson(payload));
        return m ? useModelStore.getState().setModel(m) : live.countDiscarded();
      }
      case 'clock': {
        const c = parseClock(decodeJson(payload));
        return c && clockFromMessage(c, nowMs) ? live.onClock(c, nowMs) : live.countDiscarded();
      }
      case 'scenarios': {
        const s = parseScenarios(decodeJson(payload));
        return s ? live.onScenarios(s) : live.countDiscarded();
      }
      case 'raw': {
        const r = parseRaw(decodeJson(payload));
        if (!r || r.device_id !== info.deviceId || !knownDevice(r.device_id, 'sensor')) return live.countDiscarded();
        return live.onRaw(r, nowMs);
      }
      case 'state': {
        const s = parseState(decodeJson(payload));
        if (!s || s.device_id !== info.deviceId || !knownDevice(s.device_id, 'actuator')) return live.countDiscarded();
        return live.onState(s, nowMs);
      }
      case 'ack': {
        const a = parseAck(decodeJson(payload));
        return a ? useCommandStore.getState().resolveAck(a) : live.countDiscarded();
      }
      default:
        return live.countDiscarded();
    }
  } catch (err) {
    console.error('dispatch failed', topic, err);
    live.countDiscarded();
  }
}
