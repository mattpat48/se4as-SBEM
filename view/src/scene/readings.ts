// Interpolated reading of a device, for frame loops (0 when missing).
import { displayedValue } from '../domain/interpolate';
import { useLiveStore } from '../store/live';
import { useModelStore } from '../store/model';

export function readingNow(deviceId: string, nowMs = Date.now()): number {
  const r = useLiveStore.getState().readings.get(deviceId);
  if (!r) return 0;
  const period = (useModelStore.getState().model?.complex.sampling_period_s ?? 10) * 1000;
  return displayedValue(r, nowMs, period);
}
