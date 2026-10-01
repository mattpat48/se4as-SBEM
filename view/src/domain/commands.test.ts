import fixtureModel from '../test/fixtures/model.json';
import {
  ACK_TIMEOUT_MS, JUMP_PRESETS, LOG_MAX, buildCommandMessage, commandFields, jumpMessage, speedMessage, validateCommand,
} from './commands';

const T = fixtureModel.device_types as any;

test('form fields from the catalogue', () => {
  expect(commandFields(T.hvac)).toEqual([
    { key: 'mode', type: 'enum', options: ['off', 'heat', 'cool'] },
    { key: 'setpoint', type: 'number', min: 16, max: 30, integer: false }]);
  expect(commandFields(T.resident_display)).toEqual([
    { key: 'message', type: 'string' },
    { key: 'level', type: 'enum', options: ['info', 'warning', 'danger'] },
    { key: 'clear', type: 'bool' }]);
  expect(commandFields(T.ventilation)).toEqual([{ key: 'level', type: 'number', min: 0, max: 3, integer: true }]);
});

test('every actuator of the catalogue has a form', () => {
  for (const t of Object.values(T) as any[]) if (t.kind === 'actuator') expect(commandFields(t).length).toBeGreaterThan(0);
});

test('validation with the simulator reasons', () => {
  expect(validateCommand(T.ventilation, { level: 2.5 })).toBe('level deve essere intero');
  expect(validateCommand(T.ventilation, { level: 5 })).toBe('level 5 fuori da 0–3');
  expect(validateCommand(T.ventilation, { level: '2' })).toBe('level deve essere un numero');
  expect(validateCommand(T.window, { position: 'ajar' })).toBe("position 'ajar' non ammesso (valori: open, closed)");
  expect(validateCommand(T.window, {})).toBe('comando vuoto');
  expect(validateCommand(T.window, { foo: 1 })).toBe('chiave sconosciuta: foo');
  expect(validateCommand(T.hvac, { setpoint: 40 })).toBe('setpoint 40 fuori da 16–30');
  expect(validateCommand(T.resident_display, { message: 3 })).toBe('message deve essere un testo');
  expect(validateCommand(T.resident_display, { clear: 'yes' })).toBe('clear deve essere true/false');
  expect(validateCommand(T.resident_display, { clear: true })).toBeNull();
  expect(validateCommand(T.hvac, { mode: 'cool', setpoint: 24 })).toBeNull();
});

test('command message', () => {
  expect(buildCommandMessage({ position: 'open' }, 'id1', 1_700_000_000_000))
    .toEqual({ cmd_id: 'id1', command: { position: 'open' }, issued_by: 'debug', timestamp: 1_700_000_000 });
});

test('clock messages', () => {
  expect(speedMessage(60, 60)).toEqual({ speed: 60 });
  expect(() => speedMessage(0, 60)).toThrow('velocità non valida');
  expect(() => speedMessage(61, 60)).toThrow('velocità non valida: 61 (ammessa 1–60)');
  expect(jumpMessage('22:00')).toEqual({ jump_to: '22:00' });
  expect(jumpMessage('2027-01-15T08:00:00')).toEqual({ jump_to: '2027-01-15T08:00:00' });
  expect(() => jumpMessage('25:00')).toThrow('orario non valido');
  expect(() => jumpMessage('2027-02-30T08:00:00')).toThrow('orario non valido: 2027-02-30T08:00:00');
  expect(JUMP_PRESETS.map(([name]) => name)).toEqual(['alba', 'mezzogiorno', 'tramonto', 'notte']);
  expect([ACK_TIMEOUT_MS, LOG_MAX]).toEqual([5000, 10]);
});
