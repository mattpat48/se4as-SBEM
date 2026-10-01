// Heat-map scales (view spec §8.6) and the always-red hazard rule (§7.8, V12, V17).
import { lerpColor } from './palette';
import type { SensorType } from './messages';

export type HeatQuantity = 'temperature' | 'co2' | 'humidity' | 'noise_level' | 'light' | 'occupancy' | 'power';

export const HEAT_SCALES: Record<HeatQuantity, { label: string; unit: string; min: number; max: number | 'residents' }> = {
  temperature: { label: 'Temperatura', unit: '°C', min: 16, max: 30 },
  co2: { label: 'CO₂', unit: 'ppm', min: 400, max: 2000 },
  humidity: { label: 'Umidità', unit: '%', min: 20, max: 80 },
  noise_level: { label: 'Rumore', unit: 'dB', min: 30, max: 80 },
  light: { label: 'Luce', unit: 'lux', min: 0, max: 1000 },
  occupancy: { label: 'Presenze', unit: 'persone', min: 0, max: 'residents' },
  power: { label: 'Consumo elettrico', unit: 'W', min: 0, max: 4000 },
};

export const HEAT_STOPS = ['#3b82f6', '#22c55e', '#eab308', '#f97316', '#ef4444'];

/** Continuous blue → green → yellow → orange → red, clamped to the scale. */
export function heatColor(q: HeatQuantity, value: number, residents?: number): string {
  const s = HEAT_SCALES[q];
  const max = s.max === 'residents' ? (residents ?? 0) : s.max;
  const t = max > s.min ? Math.min(1, Math.max(0, (value - s.min) / (max - s.min))) : 0;
  const x = t * (HEAT_STOPS.length - 1);
  const i = Math.min(HEAT_STOPS.length - 2, Math.floor(x));
  return lerpColor(HEAT_STOPS[i], HEAT_STOPS[i + 1], x - i);
}

export const HAZARD_TYPES = ['smoke', 'gas', 'co'] as const;

/** An apartment pulses red when smoke, gas or CO is above its catalogue rest value. */
export function isHazard(values: Partial<Record<'smoke' | 'gas' | 'co', number>>, types: Record<string, SensorType>): boolean {
  return HAZARD_TYPES.some((t) => {
    const v = values[t];
    return v !== undefined && v > (types[t]?.rest_value ?? 0);
  });
}
