import { readConfig } from './config';

test('defaults when config is missing', () => {
  expect(readConfig(undefined)).toEqual({ mqttUrl: 'ws://localhost:9001', username: 'view', password: '' });
});

test('takes string fields and ignores the rest', () => {
  expect(readConfig({ mqttUrl: 'ws://h:1', username: 7, password: 'p' }))
    .toEqual({ mqttUrl: 'ws://h:1', username: 'view', password: 'p' });
});
