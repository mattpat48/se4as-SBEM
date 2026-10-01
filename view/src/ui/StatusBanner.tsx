// Connection / simulator / model status, in priority order (view spec §9).
import { useConnectionStore } from '../store/connection';
import { useLiveStore } from '../store/live';
import { useModelStore } from '../store/model';

function webglAvailable(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

const HAS_WEBGL = typeof document !== 'undefined' && webglAvailable();

export function statusMessage(s: {
  webgl: boolean; broker: string; simulator: string; hasModel: boolean;
}): string | null {
  if (!s.webgl) return 'WebGL non è disponibile in questo browser';
  if (s.broker === 'auth_failed') return 'credenziali MQTT rifiutate';
  if (s.broker !== 'online') return 'broker non raggiungibile, riprovo…';
  if (s.simulator === 'offline') return 'simulatore non in linea';
  if (!s.hasModel) return 'in attesa del modello del complesso';
  return null;
}

export function StatusBanner() {
  const broker = useConnectionStore((s) => s.broker);
  const simulator = useLiveStore((s) => s.simulator);
  useLiveStore((s) => s.revision);
  const hasModel = useModelStore((s) => s.model !== null);
  const message = statusMessage({ webgl: HAS_WEBGL, broker, simulator, hasModel });

  if (message) {
    return <div className="status-banner status-banner--alert" role="status">{message}</div>;
  }
  return <div className="status-badge" role="status">{useLiveStore.getState().receivedSummary()}</div>;
}
