// Topics of the Complex/… contract (Monitor v2 spec §7) as seen by the view.

export type DeviceLayer = 'raw' | 'state' | 'ack' | 'cmd';

export type TopicInfo =
  | { layer: DeviceLayer; area: string; unitId: string; deviceType: string; deviceId: string }
  | { layer: 'model' }
  | { layer: 'clock' }
  | { layer: 'scenarios' }
  | { layer: 'status'; service: string };

const ROOT = 'Complex';
const DEVICE_LAYERS: readonly string[] = ['raw', 'state', 'ack', 'cmd'];

export function parseTopic(topic: string): TopicInfo | null {
  const parts = topic.split('/');
  if (parts[0] !== ROOT || parts.some((p) => p === '')) return null;
  if (parts.length === 2) {
    if (parts[1] === 'model') return { layer: 'model' };
    if (parts[1] === 'clock') return { layer: 'clock' };
    if (parts[1] === 'scenarios') return { layer: 'scenarios' };
    return null;
  }
  if (parts.length === 3 && parts[1] === 'status') return { layer: 'status', service: parts[2] };
  if (parts.length === 5 && DEVICE_LAYERS.includes(parts[1])) {
    const [, layer, area, unitId, deviceType] = parts;
    return { layer: layer as DeviceLayer, area, unitId, deviceType, deviceId: `${unitId}.${deviceType}` };
  }
  return null;
}

export function deviceTopic(layer: DeviceLayer, area: string, unitId: string, deviceType: string): string {
  return `${ROOT}/${layer}/${area}/${unitId}/${deviceType}`;
}

/** The filters the `view` user reads (view spec §5.3), with their QoS (§6.1). */
export const SUBSCRIPTIONS: Record<string, { qos: 0 | 1 }> = {
  'Complex/model': { qos: 1 },
  'Complex/clock': { qos: 1 },
  'Complex/scenarios': { qos: 1 },
  'Complex/status/#': { qos: 1 },
  'Complex/state/#': { qos: 1 },
  'Complex/ack/#': { qos: 1 },
  'Complex/raw/#': { qos: 0 },
};

export const CLOCK_CONTROL_TOPIC = 'Complex/control/clock';
