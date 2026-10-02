import fixtureModel from '../test/fixtures/model.json';
import { dispatch } from '../mqtt/dispatch';
import { resetStores } from '../test/reset';
import { useLiveStore } from './live';
import { useModelStore } from './model';
import { useUiStore } from './ui';

const enc = (o: unknown) => JSON.stringify(o);
const raw = (unit: string, type: string, value: number) =>
  enc({ device_id: `${unit}.${type}`, value, unit: 'x', timestamp: 1, sim_time: '2026-09-30T21:15:00' });
const state = (unit: string, type: string, s: Record<string, unknown>) =>
  enc({ device_id: `${unit}.${type}`, state: s, power_w: 0, timestamp: 1 });
const loadModel = () => dispatch('Complex/model', enc(fixtureModel), 0);

beforeEach(resetStores);

test('model indexes all devices', () => {
  loadModel();
  expect(useModelStore.getState().devices.size).toBe(697);   // 414 sensors + 283 actuators
  expect(useModelStore.getState().devices.get('A-2-1.co2'))
    .toEqual({ deviceId: 'A-2-1.co2', unitId: 'A-2-1', area: 'A', type: 'co2', kind: 'sensor' });
  expect(useModelStore.getState().version).toBe(1);
  expect(useModelStore.getState().layout?.apartments.length).toBe(32);
});

test('raw keeps previous value and bounded history', () => {
  loadModel();
  for (let i = 0; i <= 60; i++) dispatch('Complex/raw/A/A-2-1/co2', enc({ device_id: 'A-2-1.co2', value: 400 + i, unit: 'ppm', timestamp: i, sim_time: '2026-09-30T21:15:00' }), i * 10_000);
  const r = useLiveStore.getState().readings.get('A-2-1.co2')!;
  expect([r.prev, r.last, r.history.length]).toEqual([459, 460, 60]);
  expect([r.prevAt, r.lastAt, r.unit]).toEqual([590_000, 600_000, 'ppm']);
});

test('unknown device and garbage are discarded', () => {
  loadModel();
  dispatch('Complex/raw/A/Z-9-9/co2', enc({ device_id: 'Z-9-9.co2', value: 1, unit: 'ppm', timestamp: 1, sim_time: 'x' }), 0);
  dispatch('Complex/raw/A/A-2-1/co2', 'not json', 0);
  expect(useLiveStore.getState().discarded).toBe(2);
});

test('topic and device_id must agree', () => {
  loadModel();
  dispatch('Complex/raw/A/A-2-1/co2', raw('A-2-2', 'co2', 500), 0);
  expect(useLiveStore.getState().discarded).toBe(1);
  expect(useLiveStore.getState().readings.size).toBe(0);
});

test('status offline then online', () => {
  dispatch('Complex/status/simulator', 'offline', 0); expect(useLiveStore.getState().simulator).toBe('offline');
  dispatch('Complex/status/simulator', 'online', 0);  expect(useLiveStore.getState().simulator).toBe('online');
});

test('clock and scenarios', () => {
  dispatch('Complex/clock', enc({ sim_time: '2026-09-30T21:15:00', speed: 60, timestamp: 1 }), 1234);
  expect(useLiveStore.getState().clock).toEqual({ simMs: Date.UTC(2026, 8, 30, 21, 15), speed: 60, receivedAtMs: 1234 });
  dispatch('Complex/scenarios', enc({ active: [{ scenario_id: 'sc-1', scenario: 'fire', target: 'A-2-1', params: {},
    started_at: 1, sim_started_at: '2026-09-30T21:15:00' }] }), 0);
  expect(useLiveStore.getState().scenarios.map((s) => s.scenario)).toEqual(['fire']);
});

test('same model twice keeps readings', () => {
  loadModel();
  dispatch('Complex/raw/A/A-2-1/co2', raw('A-2-1', 'co2', 500), 0);
  loadModel();
  expect(useLiveStore.getState().readings.has('A-2-1.co2')).toBe(true);
  expect(useModelStore.getState().version).toBe(1);
});

test('different model clears live data', () => {
  loadModel();
  dispatch('Complex/raw/A/A-2-1/co2', raw('A-2-1', 'co2', 500), 0);
  useUiStore.getState().selectUnit('A-2-1');
  const smaller = { ...fixtureModel, units: fixtureModel.units.filter((u) => u.id !== 'EV-D') };
  dispatch('Complex/model', enc(smaller), 0);
  expect(useLiveStore.getState().readings.size).toBe(0);
  expect(useModelStore.getState().version).toBe(2);
  expect(useUiStore.getState().selectedUnit).toBeNull();
});

test('summary text', () => {
  loadModel();
  dispatch('Complex/raw/A/A-2-1/co2', raw('A-2-1', 'co2', 500), 0);
  dispatch('Complex/raw/park/park/rain_level', raw('park', 'rain_level', 0), 0);
  dispatch('Complex/state/A/A-2-1/window', state('A-2-1', 'window', { position: 'closed' }), 0);
  dispatch('Complex/state/A/A-S/smoke_vent', state('A-S', 'smoke_vent', { position: 'closed' }), 0);
  dispatch('Complex/state/parking/EV-A/ev_charger', state('EV-A', 'ev_charger', { mode: 'charge' }), 0);
  expect(useLiveStore.getState().receivedSummary()).toBe('2 sensori · 3 attuatori ricevuti');
});

test('revision is bumped at most every 500 ms', () => {
  loadModel();
  const r0 = useLiveStore.getState().revision;
  dispatch('Complex/raw/A/A-2-1/co2', raw('A-2-1', 'co2', 500), 10_000);
  dispatch('Complex/raw/A/A-2-1/co2', raw('A-2-1', 'co2', 501), 10_100);
  expect(useLiveStore.getState().revision).toBe(r0 + 1);
  dispatch('Complex/raw/A/A-2-1/co2', raw('A-2-1', 'co2', 502), 10_600);
  expect(useLiveStore.getState().revision).toBe(r0 + 2);
});

test('ui defaults and clearSelection', () => {
  const ui = useUiStore.getState();
  expect([ui.mode, ui.building, ui.floor, ui.selectedUnit, ui.selectedDevice, ui.heatQuantity, ui.heatOn, ui.dataMode, ui.debugOpen, ui.debugTab])
    .toEqual(['3d', null, null, null, null, 'temperature', true, false, false, 'commands']);
  ui.selectUnit('A-2-1'); ui.selectDevice('A-2-1.window'); useUiStore.getState().clearSelection();
  expect([useUiStore.getState().selectedUnit, useUiStore.getState().selectedDevice]).toEqual([null, null]);
});


test('first-person entry and exit preserve filters and restore heat map', () => {
  const ui = useUiStore.getState();
  ui.enterApartment('B-2-2', 'B', 2);
  expect(useUiStore.getState()).toMatchObject({ firstPersonUnit: 'B-2-2', building: 'B', floor: 2, mode: '3d', heatOn: false });
  ui.exitApartment();
  expect(useUiStore.getState()).toMatchObject({ firstPersonUnit: null, building: 'B', floor: 2, heatOn: true });
  ui.enterApartment('A-1-1', 'A', 1);
  ui.setMode('2d');
  expect(useUiStore.getState()).toMatchObject({ firstPersonUnit: null, mode: '2d', heatOn: true });
});
