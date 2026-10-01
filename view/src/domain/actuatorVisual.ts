// How each actuator's declared state is drawn (view spec §7.4). `s` is the state object.
type S = Record<string, unknown>;

const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export const windowAngle = (s: S) => (s.position === 'open' ? (70 * Math.PI) / 180 : 0);
export const blindsCover = (s: S) => clamp01((100 - num(s.position, 100)) / 100);
export const lightLevel = (s: S) => clamp01(num(s.level) / 100);
export const hvacFlow = (s: S): 'cool' | 'heat' | null => (s.mode === 'cool' || s.mode === 'heat' ? s.mode : null);
export const ventTurnsPerSecond = (s: S) => Math.max(0, num(s.level));
export const valveOpen = (s: S) => s.position === 'open';
export const sirenOn = (s: S) => s.siren === 'on';
export const smokeVentOpen = (s: S) => s.position === 'open';
export const parkState = (s: S) => s.state === 'on';

const DISPLAY_COLORS: Record<string, string> = { info: '#3b82f6', warning: '#eab308', danger: '#ef4444' };

export function displayVisual(s: S): { visible: boolean; color: string; message: string } {
  const message = typeof s.message === 'string' ? s.message : '';
  return { visible: message !== '', color: DISPLAY_COLORS[String(s.level)] ?? DISPLAY_COLORS.info, message };
}

export function stairLightsVisual(s: S): 'off' | 'normal' | 'evacuation' {
  return s.mode === 'normal' || s.mode === 'evacuation' ? s.mode : 'off';
}

export function elevatorVisual(s: S): { doorsOpen: boolean; lamp: 'green' | 'red' } {
  return s.mode === 'recall' ? { doorsOpen: true, lamp: 'red' } : { doorsOpen: false, lamp: 'green' };
}

export function batteryVisual(s: S): { fill: number; arrow: 'up' | 'down' | null } {
  return { fill: clamp01(num(s.soc_pct) / 100), arrow: s.mode === 'charge' ? 'up' : s.mode === 'discharge' ? 'down' : null };
}

export function chargerVisual(s: S, powerW: number): { car: boolean; led: 'pulse' | 'steady' | 'off' } {
  const car = s.car_connected === true;
  if (powerW > 0) return { car, led: 'pulse' };
  return { car, led: car && s.mode === 'pause' ? 'steady' : 'off' };
}
