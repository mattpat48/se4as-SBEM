import fixtureModel from '../test/fixtures/model.json';
import { dispatch } from '../mqtt/dispatch';
import { resetStores } from '../test/reset';
import { sendClock, useCommandStore } from './commands';
import { useConnectionStore, type PublishJson } from './connection';
import type { Mock } from 'vitest';

let publish: Mock<PublishJson>;
const send = (id: string, cmd: Record<string, unknown>) => useCommandStore.getState().send(id, cmd);
const log = () => useCommandStore.getState().log;
const ack = (cmdId: string | null, status: 'ok' | 'rejected', reason?: string) =>
  dispatch('Complex/ack/A/A-2-1/window', JSON.stringify({ cmd_id: cmdId, status, reason, timestamp: 1 }), 0);

beforeEach(() => {
  vi.useFakeTimers();
  resetStores();
  useCommandStore.setState({ log: [] });
  publish = vi.fn<PublishJson>();
  useConnectionStore.setState({ publishJson: publish, broker: 'online' });
  dispatch('Complex/model', JSON.stringify(fixtureModel), 0);
});
afterEach(() => vi.useRealTimers());

test('send publishes on the cmd topic and logs pending', () => {
  expect(send('A-2-1.window', { position: 'open' })).toBeNull();
  expect(publish).toHaveBeenCalledWith('Complex/cmd/A/A-2-1/window', expect.objectContaining({ issued_by: 'debug', command: { position: 'open' } }), 1);
  expect(log()[0]).toMatchObject({ deviceId: 'A-2-1.window', status: 'pending', command: { position: 'open' } });
  expect(log()[0].cmdId).toBe((publish.mock.calls[0][1] as { cmd_id: string }).cmd_id);
});

test('ack ok and rejected (through dispatch)', () => {
  send('A-2-1.window', { position: 'open' });
  const first = log()[0].cmdId;
  ack(first, 'ok');
  expect(log()[0].status).toBe('ok');
  send('A-2-1.window', { position: 'closed' });
  ack(log()[0].cmdId, 'rejected', 'attuatore in manutenzione');
  expect(log()[0]).toMatchObject({ status: 'rejected', reason: 'attuatore in manutenzione' });
  expect(log()[1].status).toBe('ok');
});

test('no ack after 5 s', () => {
  send('A-2-1.window', { position: 'open' });
  const id = log()[0].cmdId;
  vi.advanceTimersByTime(4999);
  expect(log()[0].status).toBe('pending');
  vi.advanceTimersByTime(1);
  expect(log()[0].status).toBe('no_ack');
  ack(id, 'ok');
  expect(log()[0].status).toBe('no_ack');
});

test('invalid command is not sent', () => {
  expect(send('A-2-1.window', { position: 'ajar' })).toMatch(/non ammesso/);
  expect(send('Z-9-9.window', { position: 'open' })).toBe('dispositivo sconosciuto: Z-9-9.window');
  expect(send('A-2-1.co2', { value: 1 })).toBe('A-2-1.co2 non è un attuatore');
  expect(publish).not.toHaveBeenCalled();
  expect(log()).toEqual([]);
});

test('log keeps the last 10', () => {
  for (let i = 0; i < 11; i++) send('A-2-1.lights', { level: i });
  expect(log().length).toBe(10);
  expect(log()[0].command).toEqual({ level: 10 });
  expect(log()[9].command).toEqual({ level: 1 });
});

test('offline broker: not sent', () => {
  useConnectionStore.setState({ publishJson: null });
  expect(send('A-2-1.window', { position: 'open' })).toBe('broker non collegato');
  expect(log()).toEqual([]);
});

test('clock control goes to Complex/control/clock with QoS 1', () => {
  expect(sendClock({ speed: 60 })).toBeNull();
  expect(publish).toHaveBeenCalledWith('Complex/control/clock', { speed: 60 }, 1);
  useConnectionStore.setState({ publishJson: null });
  expect(sendClock({ jump_to: '22:00' })).toBe('broker non collegato');
});
