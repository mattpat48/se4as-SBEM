// Simulated clock (view spec §6.4). sim_time is naive local time of L'Aquila;
// the view represents it as "naive ms" = Date.UTC(y, m-1, d, h, mi, s).
import type { ClockMsg } from './messages';

export interface ClockState { simMs: number; speed: number; receivedAtMs: number }

const SIM_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/;

export function parseSimTime(s: string): number | null {
  const m = SIM_TIME_RE.exec(s);
  if (!m) return null;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number);
  const ms = Date.UTC(y, mo - 1, d, h, mi, se);
  // Reject values that Date.UTC would silently roll over (month 13, hour 99…).
  return formatSimTime(ms) === `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` ? ms : null;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function formatSimTime(ms: number): string {
  const p = simParts(ms);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

export function clockFromMessage(msg: ClockMsg, receivedAtMs: number): ClockState | null {
  const simMs = parseSimTime(msg.sim_time);
  if (simMs === null || !(msg.speed > 0)) return null;
  return { simMs, speed: msg.speed, receivedAtMs };
}

/** Shown time = last sim_time + speed × (now − arrival). */
export function simNowMs(c: ClockState, nowMs: number): number {
  return c.simMs + c.speed * (nowMs - c.receivedAtMs);
}

export function simParts(ms: number) {
  const d = new Date(ms);
  return {
    year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
    hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(), weekday: d.getUTCDay(),
  };
}

const DAYS = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

/** Top-bar label, e.g. "mer 30 set · 21:15 · ×60". */
export function formatClockLabel(ms: number, speed: number): string {
  const p = simParts(ms);
  return `${DAYS[p.weekday]} ${p.day} ${MONTHS[p.month - 1]} · ${pad(p.hour)}:${pad(p.minute)} · ×${Math.round(speed * 10) / 10}`;
}
