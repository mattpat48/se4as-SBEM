import fixtureModel from '../test/fixtures/model.json';
import { HAZARD_TYPES, HEAT_SCALES, HEAT_STOPS, heatColor, isHazard } from './heat';
import type { SensorType } from './messages';

const types = fixtureModel.device_types as unknown as Record<string, SensorType>;

test('temperature scale ends and middle', () => {
  expect(heatColor('temperature', 16)).toBe('#3b82f6');
  expect(heatColor('temperature', 23)).toBe('#eab308');
  expect(heatColor('temperature', 30)).toBe('#ef4444');
  expect(heatColor('temperature', -5)).toBe('#3b82f6');
});

test('other scales', () => {
  expect(heatColor('co2', 5000)).toBe('#ef4444');
  expect(heatColor('co2', 800)).toBe('#22c55e');          // (800 − 400) / 1600 = 0.25
  expect(heatColor('occupancy', 2, 4)).toBe('#eab308');
  expect(heatColor('occupancy', 0, 0)).toBe('#3b82f6');    // no residents: never divide by zero
  expect(heatColor('power', 1000)).toBe('#22c55e');
  expect(heatColor('temperature', 16 + 14 * 0.125)).toBe('#2fa4aa');   // halfway between the first two stops
});

test('scales and labels from the spec', () => {
  expect(HEAT_SCALES.temperature).toEqual({ label: 'Temperatura', unit: '°C', min: 16, max: 30 });
  expect(HEAT_SCALES.occupancy.max).toBe('residents');
  expect(Object.values(HEAT_SCALES).map((s) => s.label))
    .toEqual(['Temperatura', 'CO₂', 'Umidità', 'Rumore', 'Luce', 'Presenze', 'Consumo elettrico']);
  expect(HEAT_STOPS).toEqual(['#3b82f6', '#22c55e', '#eab308', '#f97316', '#ef4444']);
});

test('hazard rule uses rest_value', () => {
  expect(HAZARD_TYPES).toEqual(['smoke', 'gas', 'co']);
  expect(isHazard({ smoke: 0, gas: 0, co: 0 }, types)).toBe(false);
  expect(isHazard({ co: 0.4 }, types)).toBe(true);
  expect(isHazard({}, types)).toBe(false);
});
