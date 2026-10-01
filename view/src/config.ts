// Runtime configuration injected by public/config.js as window.__VIEW_CONFIG__.

export interface ViewConfig {
  mqttUrl: string;
  username: string;
  password: string;
}

const DEFAULTS: ViewConfig = { mqttUrl: 'ws://localhost:9001', username: 'view', password: '' };

export function readConfig(src: unknown): ViewConfig {
  const o = (typeof src === 'object' && src !== null ? src : {}) as Record<string, unknown>;
  const str = (k: keyof ViewConfig) => (typeof o[k] === 'string' ? (o[k] as string) : DEFAULTS[k]);
  return { mqttUrl: str('mqttUrl'), username: str('username'), password: str('password') };
}

export const config: ViewConfig = readConfig((globalThis as any).__VIEW_CONFIG__);
