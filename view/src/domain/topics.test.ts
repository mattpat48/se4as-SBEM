import { CLOCK_CONTROL_TOPIC, SUBSCRIPTIONS, deviceTopic, parseTopic } from './topics';

test('parses device topics', () => {
  expect(parseTopic('Complex/raw/A/A-2-1/co2'))
    .toEqual({ layer: 'raw', area: 'A', unitId: 'A-2-1', deviceType: 'co2', deviceId: 'A-2-1.co2' });
  expect(parseTopic('Complex/state/parking/EV-A/ev_charger')?.layer).toBe('state');
});

test('parses the single-level topics', () => {
  expect(parseTopic('Complex/model')).toEqual({ layer: 'model' });
  expect(parseTopic('Complex/clock')).toEqual({ layer: 'clock' });
  expect(parseTopic('Complex/scenarios')).toEqual({ layer: 'scenarios' });
  expect(parseTopic('Complex/status/simulator')).toEqual({ layer: 'status', service: 'simulator' });
});

test('rejects malformed topics', () => {
  for (const bad of ['City/data/x/co2', 'Complex/raw/A/A-2-1', 'Complex/raw//A-2-1/co2', 'Complex/foo/A/A-2-1/co2', ''])
    expect(parseTopic(bad)).toBeNull();
});

test('builds device topics', () => {
  expect(deviceTopic('cmd', 'A', 'A-2-1', 'window')).toBe('Complex/cmd/A/A-2-1/window');
  expect(CLOCK_CONTROL_TOPIC).toBe('Complex/control/clock');
});

test('subscriptions match the view ACL', () => {
  expect(Object.keys(SUBSCRIPTIONS).sort()).toEqual(['Complex/ack/#', 'Complex/clock', 'Complex/model', 'Complex/raw/#',
    'Complex/scenarios', 'Complex/state/#', 'Complex/status/#']);
  expect(SUBSCRIPTIONS['Complex/raw/#'].qos).toBe(0);
  expect(SUBSCRIPTIONS['Complex/state/#'].qos).toBe(1);
});
