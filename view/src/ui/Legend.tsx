// Colour legend of the heat map (view spec §8.6); hidden when the heat map is off.
import { HEAT_SCALES, HEAT_STOPS } from '../domain/heat';
import { useUiStore } from '../store/ui';

export function Legend() {
  const q = useUiStore((s) => s.heatQuantity);
  const on = useUiStore((s) => s.heatOn);
  if (!on) return null;
  const s = HEAT_SCALES[q];
  const max = s.max === 'residents' ? 'residenti' : String(s.max);
  return (
    <div className="legend" aria-label="Legenda della mappa di calore">
      <span className="legend__title">{s.label}</span>
      <span>{s.min}</span>
      <span className="legend__bar" style={{ background: `linear-gradient(to right, ${HEAT_STOPS.join(', ')})` }} />
      <span>{max} {s.unit}</span>
    </div>
  );
}
