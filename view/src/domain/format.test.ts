import fixtureModel from '../test/fixtures/model.json';
import { DEVICE_ICONS, formatValue, mainStateText, orientationWord, trend } from './format';
import type { SensorType } from './messages';

const types = fixtureModel.device_types as unknown as Record<string, SensorType>;

test('formatValue: 1 decimal, 0 for ppm, lux, W, persone', () => {
  expect(formatValue(23.84, '°C')).toBe('23.8 °C');
  expect(formatValue(812.4, 'ppm')).toBe('812 ppm');
  expect(formatValue(350.6, 'lux')).toBe('351 lux');
  expect(formatValue(1499.6, 'W')).toBe('1500 W');
  expect(formatValue(2, 'persone')).toBe('2 persone');
  expect(formatValue(-0.04, '°C')).toBe('0.0 °C');
});

test('trend against 1% of the scale', () => {
  expect(trend('temperature', 22.0, 21.8, types)).toBe('▲');   // 1% of 16–30 = 0.14
  expect(trend('temperature', 22.0, 21.9, types)).toBe('=');
  expect(trend('co2', 700, 720, types)).toBe('▼');           // 1% of 400–2000 = 16
  expect(trend('pm10', 30, 29, types)).toBe('=');            // no heat scale: 1% of valid_range 0–1000 = 10
  expect(trend('temperature', 22, undefined, types)).toBe('=');
});

test('main state of actuators', () => {
  expect(mainStateText('window', { position: 'open' })).toBe('open');
  expect(mainStateText('lights', { level: 80 })).toBe('80 %');
  expect(mainStateText('hvac', { mode: 'cool', setpoint: 24 })).toBe('cool 24 °C');
  expect(mainStateText('battery', { mode: 'charge', soc_pct: 55.4 })).toBe('charge 55 %');
  expect(mainStateText('unknown_type', { a: 1 })).toBe('a: 1');
});

test('icons and orientation words', () => {
  expect(DEVICE_ICONS.temperature).toBeTruthy();
  expect(DEVICE_ICONS.window).toBeTruthy();
  expect(['N', 'S', 'E', 'O', '?'].map(orientationWord)).toEqual(['nord', 'sud', 'est', 'ovest', '?']);
});
