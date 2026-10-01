// Text formatting shared by labels (scene) and cards (ui).
import { HEAT_SCALES, type HeatQuantity } from './heat';
import type { SensorType } from './messages';

const INTEGER_UNITS = new Set(['ppm', 'lux', 'W', 'persone']);

/** 1 decimal, 0 decimals for ppm, lux, W, persone. */
export function formatValue(v: number, unit: string): string {
  const d = INTEGER_UNITS.has(unit) ? 0 : 1;
  const text = v.toFixed(d);
  return `${/^-0(\.0+)?$/.test(text) ? text.slice(1) : text} ${unit}`;
}

/** ▲ / ▼ / = comparing the last value with the previous one; threshold 1% of the scale. */
export function trend(type: string, last: number, prev: number | undefined, types: Record<string, SensorType>): '▲' | '▼' | '=' {
  if (prev === undefined) return '=';
  const heat = HEAT_SCALES[type as HeatQuantity];
  const span = heat && typeof heat.max === 'number' ? heat.max - heat.min
    : types[type] ? types[type].valid_range[1] - types[type].valid_range[0] : 0;
  const threshold = 0.01 * span;
  if (last - prev > threshold) return '▲';
  if (prev - last > threshold) return '▼';
  return '=';
}

export const DEVICE_ICONS: Record<string, string> = {
  temperature: '🌡️', humidity: '💧', co2: '🫧', noise_level: '🔊', occupancy: '👥', light: '🔆',
  smoke: '💨', gas: '🔥', co: '☠️', power: '⚡', water_flow: '🚰', gas_flow: '🧯', pv_power: '☀️',
  rain_level: '🌧️', wind_speed: '🌬️', seismic: '📈', pm10: '🌫️', pm2_5: '🌫️', soil_moisture: '🌱',
  hvac: '❄️', ventilation: '🌀', window: '🪟', blinds: '🪟', lights: '💡', gas_valve: '🔧', alarm: '🚨',
  resident_display: '📟', stair_lights: '💡', smoke_vent: '🪟', evacuation_siren: '🚨', elevator: '🛗',
  battery: '🔋', irrigation: '💦', park_lights: '💡', evacuation_signs: '🚸', ev_charger: '🔌',
};

const pct = (v: unknown) => (typeof v === 'number' ? `${Math.round(v)} %` : String(v));

/** The one-line state of an actuator, for labels. */
export function mainStateText(type: string, s: Record<string, unknown>): string {
  switch (type) {
    case 'lights': case 'blinds': return pct(s.level ?? s.position);
    case 'hvac': return s.mode === 'off' ? 'off' : `${s.mode} ${s.setpoint} °C`;
    case 'ventilation': return `livello ${s.level}`;
    case 'alarm': case 'evacuation_siren': return String(s.siren);
    case 'resident_display': return s.message ? `${s.level}: ${s.message}` : '—';
    case 'battery': return `${s.mode} ${pct(s.soc_pct)}`;
    case 'irrigation': case 'park_lights': case 'evacuation_signs': return String(s.state);
    case 'window': case 'gas_valve': case 'smoke_vent': return String(s.position);
    case 'stair_lights': case 'elevator': case 'ev_charger': return String(s.mode);
    default: {
      const [k, v] = Object.entries(s)[0] ?? ['—', ''];
      return `${k}: ${v}`;
    }
  }
}

const ORIENTATION: Record<string, string> = { N: 'nord', S: 'sud', E: 'est', O: 'ovest' };
export const orientationWord = (o: string) => ORIENTATION[o] ?? o;
