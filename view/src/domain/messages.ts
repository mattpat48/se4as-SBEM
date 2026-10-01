// Message types of the Complex/… contract (Monitor v2 spec §7.3) and their validators.
// Validators never throw: they return a typed object or null.

export interface RawMsg { device_id: string; value: number; unit: string; timestamp: number; sim_time: string }
export interface StateMsg { device_id: string; state: Record<string, unknown>; power_w: number; timestamp: number; sim_time?: string }
export interface AckMsg { cmd_id: string | null; status: 'ok' | 'rejected'; state?: Record<string, unknown>; reason?: string; timestamp: number }
export interface ClockMsg { sim_time: string; speed: number; timestamp: number }
export interface ActiveScenario {
  scenario_id: string; scenario: string; target: string; params: Record<string, unknown>;
  started_at: number; sim_started_at: string;
}
export interface ScenariosMsg { active: ActiveScenario[] }

export type CommandRule = { enum: string[] } | { min: number; max: number; integer?: boolean } | { string: true } | { bool: true };
export interface SensorType { kind: 'sensor'; unit: string; valid_range: [number, number]; rest_value: number | null }
export interface ActuatorType { kind: 'actuator'; commands: Record<string, CommandRule>; default: Record<string, unknown>; essential: boolean }

export type UnitKind = 'building' | 'apartment' | 'stairwell' | 'park' | 'charger';
export interface Unit {
  id: string; kind: UnitKind; area: string; sensors: string[]; actuators: string[];
  attrs: Record<string, any>; adjacent: string[];
}
export interface Rect { x_m: number; y_m: number; width_m: number; depth_m: number }
export interface ComplexModelMsg {
  complex: { name: string; lat: number | null; lon: number | null; sampling_period_s: number; clock: { max_speed: number } };
  device_types: Record<string, SensorType | ActuatorType>;
  units: Unit[];
  layouts: { park: Rect; parking: Rect };
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const isStrArray = (x: unknown): x is string[] => Array.isArray(x) && x.every(isStr);
const isNumOrNull = (x: unknown): x is number | null => x === null || isNum(x);

const decoder = new TextDecoder();
const toText = (payload: Uint8Array | string) => (typeof payload === 'string' ? payload : decoder.decode(payload));

/** Parses a JSON payload; `undefined` when it is not JSON. */
export function decodeJson(payload: Uint8Array | string): unknown {
  try {
    return JSON.parse(toText(payload));
  } catch {
    return undefined;
  }
}

export function parseRaw(x: unknown): RawMsg | null {
  if (!isObj(x) || !isStr(x.device_id) || !isNum(x.value) || !isStr(x.unit) || !isNum(x.timestamp) || !isStr(x.sim_time)) return null;
  return { device_id: x.device_id, value: x.value, unit: x.unit, timestamp: x.timestamp, sim_time: x.sim_time };
}

export function parseState(x: unknown): StateMsg | null {
  if (!isObj(x) || !isStr(x.device_id) || !isObj(x.state) || !isNum(x.power_w) || !isNum(x.timestamp)) return null;
  if (x.sim_time !== undefined && !isStr(x.sim_time)) return null;
  const msg: StateMsg = { device_id: x.device_id, state: x.state, power_w: x.power_w, timestamp: x.timestamp };
  if (isStr(x.sim_time)) msg.sim_time = x.sim_time;
  return msg;
}

export function parseAck(x: unknown): AckMsg | null {
  if (!isObj(x) || !(x.cmd_id === null || isStr(x.cmd_id)) || (x.status !== 'ok' && x.status !== 'rejected') || !isNum(x.timestamp)) return null;
  if ((x.state !== undefined && !isObj(x.state)) || (x.reason !== undefined && !isStr(x.reason))) return null;
  const msg: AckMsg = { cmd_id: x.cmd_id, status: x.status, timestamp: x.timestamp };
  if (isObj(x.state)) msg.state = x.state;
  if (isStr(x.reason)) msg.reason = x.reason;
  return msg;
}

export function parseClock(x: unknown): ClockMsg | null {
  if (!isObj(x) || !isStr(x.sim_time) || !isNum(x.speed) || !isNum(x.timestamp)) return null;
  return { sim_time: x.sim_time, speed: x.speed, timestamp: x.timestamp };
}

function parseActiveScenario(x: unknown): ActiveScenario | null {
  if (!isObj(x) || !isStr(x.scenario_id) || !isStr(x.scenario) || !isStr(x.target) || !isObj(x.params)
    || !isNum(x.started_at) || !isStr(x.sim_started_at)) return null;
  return { scenario_id: x.scenario_id, scenario: x.scenario, target: x.target, params: x.params,
    started_at: x.started_at, sim_started_at: x.sim_started_at };
}

export function parseScenarios(x: unknown): ScenariosMsg | null {
  if (!isObj(x) || !Array.isArray(x.active)) return null;
  const active = x.active.map(parseActiveScenario);
  return active.every((a): a is ActiveScenario => a !== null) ? { active } : null;
}

function isRect(x: unknown): x is Rect {
  return isObj(x) && isNum(x.x_m) && isNum(x.y_m) && isNum(x.width_m) && isNum(x.depth_m);
}

function isDeviceType(x: unknown): x is SensorType | ActuatorType {
  if (!isObj(x)) return false;
  if (x.kind === 'sensor') {
    return isStr(x.unit) && Array.isArray(x.valid_range) && x.valid_range.length === 2
      && x.valid_range.every(isNum) && isNumOrNull(x.rest_value);
  }
  if (x.kind === 'actuator') return isObj(x.commands) && isObj(x.default) && typeof x.essential === 'boolean';
  return false;
}

const UNIT_KINDS: readonly string[] = ['building', 'apartment', 'stairwell', 'park', 'charger'];

function isUnit(x: unknown): x is Unit {
  return isObj(x) && isStr(x.id) && isStr(x.kind) && UNIT_KINDS.includes(x.kind) && isStr(x.area)
    && isStrArray(x.sensors) && isStrArray(x.actuators) && isObj(x.attrs) && isStrArray(x.adjacent);
}

export function parseModel(x: unknown): ComplexModelMsg | null {
  if (!isObj(x) || !isObj(x.complex) || !isObj(x.device_types) || !Array.isArray(x.units) || !isObj(x.layouts)) return null;
  const c = x.complex;
  if (!isNum(c.sampling_period_s) || c.sampling_period_s <= 0 || !isStr(c.name) || !isNumOrNull(c.lat ?? null)
    || !isNumOrNull(c.lon ?? null) || !isObj(c.clock) || !isNum(c.clock.max_speed)) return null;
  if (!Object.values(x.device_types).every(isDeviceType) || !x.units.every(isUnit)) return null;
  if (!isRect(x.layouts.park) || !isRect(x.layouts.parking)) return null;
  return {
    complex: { name: c.name, lat: (c.lat ?? null) as number | null, lon: (c.lon ?? null) as number | null,
      sampling_period_s: c.sampling_period_s, clock: { max_speed: c.clock.max_speed } },
    device_types: x.device_types as Record<string, SensorType | ActuatorType>,
    units: x.units,
    layouts: { park: x.layouts.park, parking: x.layouts.parking },
  };
}

/** `Complex/status/<service>` carries plain text, not JSON. */
export function parseStatus(payload: Uint8Array | string): 'online' | 'offline' | null {
  const text = toText(payload).trim();
  return text === 'online' || text === 'offline' ? text : null;
}
