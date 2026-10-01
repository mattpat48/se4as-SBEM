// Debug commands (view spec §6.5): form fields from the catalogue, validation with the
// same Italian reasons as simulator/devices.py::validate_command, clock control messages.
import { parseSimTime } from './clock';
import type { ActuatorType, CommandRule } from './messages';

export type Field =
  | { key: string; type: 'enum'; options: string[] }
  | { key: string; type: 'number'; min: number; max: number; integer: boolean }
  | { key: string; type: 'string' }
  | { key: string; type: 'bool' };

export const ACK_TIMEOUT_MS = 5000;
export const LOG_MAX = 10;
export const JUMP_PRESETS = [['alba', '06:30'], ['mezzogiorno', '12:00'], ['tramonto', '19:00'], ['notte', '22:00']] as const;

function fieldOf(key: string, rule: CommandRule): Field | null {
  if ('enum' in rule) return { key, type: 'enum', options: [...rule.enum] };
  if ('min' in rule) return { key, type: 'number', min: rule.min, max: rule.max, integer: rule.integer === true };
  if ('string' in rule) return { key, type: 'string' };
  if ('bool' in rule) return { key, type: 'bool' };
  return null;
}

export function commandFields(t: ActuatorType): Field[] {
  return Object.entries(t.commands).map(([k, r]) => fieldOf(k, r)).filter((f): f is Field => f !== null);
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** Python's "{:g}" for the values the catalogue uses. */
const fmtG = (v: number) => String(Number(v.toPrecision(6)));

export function validateCommand(t: ActuatorType, cmd: Record<string, unknown>): string | null {
  const entries = Object.entries(cmd);
  if (entries.length === 0) return 'comando vuoto';
  for (const [key, value] of entries) {
    const rule = t.commands[key];
    if (!rule) return `chiave sconosciuta: ${key}`;
    if ('enum' in rule) {
      if (typeof value !== 'string' || !rule.enum.includes(value))
        return `${key} '${String(value)}' non ammesso (valori: ${rule.enum.join(', ')})`;
    } else if ('min' in rule) {
      if (!isNumber(value)) return `${key} deve essere un numero`;
      if (rule.integer && !Number.isInteger(value)) return `${key} deve essere intero`;
      if (value < rule.min || value > rule.max) return `${key} ${fmtG(value)} fuori da ${fmtG(rule.min)}–${fmtG(rule.max)}`;
    } else if ('string' in rule) {
      if (typeof value !== 'string') return `${key} deve essere un testo`;
    } else if ('bool' in rule) {
      if (typeof value !== 'boolean') return `${key} deve essere true/false`;
    }
  }
  return null;
}

export function buildCommandMessage(cmd: Record<string, unknown>, cmdId: string, nowMs: number) {
  return { cmd_id: cmdId, command: cmd, issued_by: 'debug' as const, timestamp: nowMs / 1000 };
}

export function speedMessage(speed: number, maxSpeed: number): { speed: number } {
  if (!isNumber(speed) || speed < 1 || speed > maxSpeed) throw new Error(`velocità non valida: ${speed} (ammessa 1–${maxSpeed})`);
  return { speed };
}

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function jumpMessage(target: string): { jump_to: string } {
  if (HH_MM.test(target) || parseSimTime(target) !== null) return { jump_to: target };
  throw new Error(`orario non valido: ${target}`);
}
