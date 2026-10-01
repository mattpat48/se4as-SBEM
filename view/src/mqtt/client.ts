// MQTT over WebSocket: connect, subscribe, dispatch, publish. mqtt.js retries on its own.
import mqtt from 'mqtt';
import type { ViewConfig } from '../config';
import { SUBSCRIPTIONS } from '../domain/topics';
import { useConnectionStore } from '../store/connection';
import { dispatch } from './dispatch';

export interface MqttLike {
  on(event: string, cb: (...a: any[]) => void): void;
  subscribe(t: Record<string, { qos: 0 | 1 }>): void;
  publish(topic: string, payload: string, opts: { qos: 0 | 1; retain: false }): void;
  end(force?: boolean): void;
}

type Factory = (url: string, opts: object) => MqttLike;

const defaultFactory: Factory = (url, opts) => mqtt.connect(url, opts) as unknown as MqttLike;

function randomSuffix(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 8 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

function isAuthError(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  return e?.code === 4 || e?.code === 5 || /not authori[sz]ed|bad user/i.test(String(e?.message ?? ''));
}

export function connectView(cfg: ViewConfig, factory: Factory = defaultFactory): () => void {
  const conn = useConnectionStore.getState();
  conn.setBroker('connecting');
  const client = factory(cfg.mqttUrl, {
    clientId: 'view-' + randomSuffix(),
    username: cfg.username,
    password: cfg.password,
    clean: true,
    keepalive: 30,
    reconnectPeriod: 2000,
  });
  // auth_failed sticks until a successful connect, so retries do not hide it.
  const setUnlessAuth = (b: 'connecting' | 'offline') => {
    if (useConnectionStore.getState().broker !== 'auth_failed') conn.setBroker(b);
  };

  client.on('connect', () => {
    client.subscribe(SUBSCRIPTIONS);
    conn.setPublisher((topic, obj, qos) => client.publish(topic, JSON.stringify(obj), { qos, retain: false }));
    conn.setBroker('online');
  });
  client.on('reconnect', () => setUnlessAuth('connecting'));
  client.on('close', () => {
    conn.setPublisher(null);
    setUnlessAuth('offline');
  });
  client.on('offline', () => setUnlessAuth('offline'));
  client.on('error', (err: unknown) => {
    if (isAuthError(err)) conn.setBroker('auth_failed');
    else console.warn('mqtt error', err);
  });
  client.on('message', (topic: string, payload: Uint8Array) => dispatch(topic, payload, Date.now()));

  return () => {
    client.end(true);
    conn.setPublisher(null);
  };
}
