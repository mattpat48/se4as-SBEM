import {
  batteryVisual, blindsCover, chargerVisual, displayVisual, elevatorVisual, hvacFlow, lightLevel, parkState,
  sirenOn, smokeVentOpen, stairLightsVisual, valveOpen, ventTurnsPerSecond, windowAngle,
} from './actuatorVisual';

test('apartment actuators', () => {
  expect(windowAngle({ position: 'open' })).toBeCloseTo(70 * Math.PI / 180);
  expect(windowAngle({ position: 'closed' })).toBe(0);
  expect([blindsCover({ position: 100 }), blindsCover({ position: 0 }), blindsCover({ position: 30 })]).toEqual([0, 1, 0.7]);
  expect([lightLevel({ level: 100 }), lightLevel({ level: 0 }), lightLevel({})]).toEqual([1, 0, 0]);
  expect(hvacFlow({ mode: 'off', setpoint: 21 })).toBeNull();
  expect([hvacFlow({ mode: 'cool' }), hvacFlow({ mode: 'heat' })]).toEqual(['cool', 'heat']);
  expect([ventTurnsPerSecond({ level: 3 }), ventTurnsPerSecond({ level: 0 })]).toEqual([3, 0]);
  expect([valveOpen({ position: 'open' }), valveOpen({ position: 'closed' })]).toEqual([true, false]);
  expect([sirenOn({ siren: 'on' }), sirenOn({ siren: 'off' })]).toEqual([true, false]);
});

test('display', () => {
  expect(displayVisual({ message: '', level: 'info' }).visible).toBe(false);
  expect(displayVisual({ message: 'Evacuare', level: 'danger' })).toEqual({ visible: true, color: '#ef4444', message: 'Evacuare' });
  expect(displayVisual({ message: 'Prova', level: 'warning' }).color).toBe('#eab308');
  expect(displayVisual({ message: 'Ciao', level: 'info' }).color).toBe('#3b82f6');
});

test('stairwell, building, park, parking', () => {
  expect([stairLightsVisual({ mode: 'off' }), stairLightsVisual({ mode: 'normal' }), stairLightsVisual({ mode: 'evacuation' })])
    .toEqual(['off', 'normal', 'evacuation']);
  expect([smokeVentOpen({ position: 'open' }), smokeVentOpen({ position: 'closed' })]).toEqual([true, false]);
  expect(elevatorVisual({ mode: 'recall' })).toEqual({ doorsOpen: true, lamp: 'red' });
  expect(elevatorVisual({ mode: 'normal' })).toEqual({ doorsOpen: false, lamp: 'green' });
  expect(batteryVisual({ mode: 'charge', soc_pct: 55 })).toEqual({ fill: 0.55, arrow: 'up' });
  expect(batteryVisual({ mode: 'discharge', soc_pct: 120 })).toEqual({ fill: 1, arrow: 'down' });
  expect(batteryVisual({ mode: 'idle', soc_pct: 10 })).toEqual({ fill: 0.1, arrow: null });
  expect([parkState({ state: 'on' }), parkState({ state: 'off' })]).toEqual([true, false]);
  expect(chargerVisual({ mode: 'charge', car_connected: true }, 7400)).toEqual({ car: true, led: 'pulse' });
  expect(chargerVisual({ mode: 'pause', car_connected: true }, 0)).toEqual({ car: true, led: 'steady' });
  expect(chargerVisual({ mode: 'charge', car_connected: false }, 0)).toEqual({ car: false, led: 'off' });
});
