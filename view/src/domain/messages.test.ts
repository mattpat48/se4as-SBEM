import fixtureModel from '../test/fixtures/model.json';
import { decodeJson, parseAck, parseClock, parseModel, parseRaw, parseScenarios, parseState, parseStatus } from './messages';

test('raw', () => {
  expect(parseRaw({ device_id: 'A-2-1.co2', value: 812.4, unit: 'ppm', timestamp: 1790440000.1, sim_time: '2026-09-30T21:15:00' })?.value).toBe(812.4);
  expect(parseRaw({ device_id: 'A-2-1.co2', value: 'x', unit: 'ppm', timestamp: 1 })).toBeNull();
  expect(parseRaw({ device_id: 'A-2-1.co2', value: NaN, unit: 'ppm', timestamp: 1, sim_time: 'x' })).toBeNull();
});

test('state', () => {
  expect(parseState({ device_id: 'A.battery', state: { mode: 'idle', soc_pct: 50 }, power_w: 0, timestamp: 1 })?.state.soc_pct).toBe(50);
  expect(parseState({ device_id: 'A-2-1.hvac', state: { mode: 'cool', setpoint: 24 }, power_w: 1500,
    timestamp: 1790440000.1, sim_time: '2026-09-30T21:15:00' })?.power_w).toBe(1500);
  expect(parseState({ device_id: 'A.battery', state: [], power_w: 0, timestamp: 1 })).toBeNull();
});

test('ack', () => {
  expect(parseAck({ cmd_id: null, status: 'rejected', reason: 'comando non valido: atteso un oggetto JSON', timestamp: 1 })?.status).toBe('rejected');
  expect(parseAck({ cmd_id: '3f2a', status: 'ok', state: { mode: 'cool', setpoint: 24 }, timestamp: 1790440001.2 })?.state?.mode).toBe('cool');
  expect(parseAck({ cmd_id: 'c1', status: 'maybe', timestamp: 1 })).toBeNull();
});

test('clock and scenarios', () => {
  expect(parseClock({ sim_time: '2026-09-30T21:15:00', speed: 60, timestamp: 1 })?.speed).toBe(60);
  expect(parseClock({ sim_time: 5, speed: 60, timestamp: 1 })).toBeNull();
  expect(parseScenarios({ active: [] })).toEqual({ active: [] });
  expect(parseScenarios({ active: [{ scenario_id: 'sc-0007', scenario: 'fire', target: 'A-2-1', params: {},
    started_at: 1790440000.0, sim_started_at: '2026-09-30T21:15:00' }] })?.active[0].scenario).toBe('fire');
  expect(parseScenarios({ active: 'x' })).toBeNull();
});

test('model', () => {
  expect(parseModel({ units: 'x' })).toBeNull();
  expect(parseModel(fixtureModel)?.units.length).toBe(45);   // 4 buildings + 32 apartments + 4 stairwells + 1 park + 4 chargers
});

test('decodeJson', () => {
  expect(decodeJson('not json')).toBeUndefined();
  expect(decodeJson(new TextEncoder().encode('{"a":1}'))).toEqual({ a: 1 });
});

test('parseStatus accepts plain text', () => {
  expect(parseStatus('online')).toBe('online');
  expect(parseStatus(new TextEncoder().encode('offline'))).toBe('offline');
  expect(parseStatus('"online"')).toBeNull();
  expect(parseStatus('boh')).toBeNull();
});
