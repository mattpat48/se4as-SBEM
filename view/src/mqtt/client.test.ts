import type { ViewConfig } from '../config';
import { SUBSCRIPTIONS } from '../domain/topics';
import { useConnectionStore } from '../store/connection';
import { useLiveStore } from '../store/live';
import { resetStores } from '../test/reset';
import { connectView, type MqttLike } from './client';

class FakeClient implements MqttLike {
  handlers = new Map<string, ((...a: any[]) => void)[]>();
  subscribe = vi.fn();
  publish = vi.fn();
  end = vi.fn();
  on(event: string, cb: (...a: any[]) => void) { this.handlers.set(event, [...(this.handlers.get(event) ?? []), cb]); }
  emit(event: string, ...args: any[]) { for (const cb of this.handlers.get(event) ?? []) cb(...args); }
}

const cfg: ViewConfig = { mqttUrl: 'ws://h:9001', username: 'view', password: 'p' };
let fake: FakeClient;
let factory: ReturnType<typeof makeFactory>;
const makeFactory = () => vi.fn((_url: string, _opts: object): MqttLike => fake);
const broker = () => useConnectionStore.getState().broker;

beforeEach(() => {
  resetStores();
  fake = new FakeClient();
  factory = makeFactory();
});

test('connect options', () => {
  connectView(cfg, factory);
  const [url, opts] = factory.mock.calls[0] as [string, any];
  expect(url).toBe('ws://h:9001');
  expect(opts).toMatchObject({ username: 'view', password: 'p', clean: true, keepalive: 30, reconnectPeriod: 2000 });
  expect(opts.clientId).toMatch(/^view-[a-z0-9]{8}$/);
  expect(broker()).toBe('connecting');
});

test('connect subscribes and goes online', () => {
  connectView(cfg, factory);
  fake.emit('connect');
  expect(fake.subscribe).toHaveBeenCalledWith(SUBSCRIPTIONS);
  expect(broker()).toBe('online');
  useConnectionStore.getState().publishJson!('Complex/control/clock', { speed: 60 }, 1);
  expect(fake.publish).toHaveBeenCalledWith('Complex/control/clock', '{"speed":60}', { qos: 1, retain: false });
});

test('reconnect sets connecting, close sets offline', () => {
  connectView(cfg, factory);
  fake.emit('connect');
  fake.emit('close');
  expect(broker()).toBe('offline');
  expect(useConnectionStore.getState().publishJson).toBeNull();
  fake.emit('reconnect');
  expect(broker()).toBe('connecting');
});

test('auth error sets auth_failed', () => {
  connectView(cfg, factory);
  fake.emit('error', Object.assign(new Error('Connection refused: Not authorized'), { code: 5 }));
  expect(broker()).toBe('auth_failed');
  fake.emit('close'); fake.emit('reconnect');
  expect(broker()).toBe('auth_failed');   // stays until a successful connect
  fake.emit('connect');
  expect(broker()).toBe('online');
});

test('other errors do not set auth_failed', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  connectView(cfg, factory);
  fake.emit('error', new Error('connect ECONNREFUSED'));
  expect(broker()).toBe('connecting');
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});

test('message is dispatched', () => {
  connectView(cfg, factory);
  fake.emit('message', 'Complex/status/simulator', new TextEncoder().encode('online'));
  expect(useLiveStore.getState().simulator).toBe('online');
});

test('disconnect ends the client', () => {
  const stop = connectView(cfg, factory);
  fake.emit('connect');
  stop();
  expect(fake.end).toHaveBeenCalledWith(true);
  expect(useConnectionStore.getState().publishJson).toBeNull();
});
