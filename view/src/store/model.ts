// The expanded complex model (Complex/model) and the device index.
import { create } from 'zustand';
import { buildComplexLayout, type ComplexLayout } from '../domain/layout';
import type { ComplexModelMsg } from '../domain/messages';
import { useLiveStore } from './live';
import { useUiStore } from './ui';

export interface DeviceInfo { deviceId: string; unitId: string; area: string; type: string; kind: 'sensor' | 'actuator' }

interface ModelState {
  model: ComplexModelMsg | null;
  devices: Map<string, DeviceInfo>;
  layout: ComplexLayout | null;
  version: number;
  setModel(m: ComplexModelMsg): void;
}

function indexDevices(m: ComplexModelMsg): Map<string, DeviceInfo> {
  const devices = new Map<string, DeviceInfo>();
  for (const u of m.units) {
    for (const [kind, types] of [['sensor', u.sensors], ['actuator', u.actuators]] as const) {
      for (const type of types) {
        const deviceId = `${u.id}.${type}`;
        devices.set(deviceId, { deviceId, unitId: u.id, area: u.area, type, kind });
      }
    }
  }
  return devices;
}

let currentJson = '';

export const useModelStore = create<ModelState>()((set) => ({
  model: null,
  devices: new Map(),
  layout: null,
  version: 0,
  setModel(m) {
    const json = JSON.stringify(m);
    if (json === currentJson && useModelStore.getState().model !== null) return;
    currentJson = json;
    useLiveStore.getState().resetLive();
    useUiStore.getState().clearSelection();
    const layout = buildComplexLayout(m);
    for (const w of layout.warnings) console.warn(w);
    set((s) => ({ model: m, devices: indexDevices(m), layout, version: s.version + 1 }));
  },
}));
