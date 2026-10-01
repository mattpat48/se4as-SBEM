// Short history of a sensor (last 60 samples, ≈10 minutes) as a 200 × 40 SVG line.
import { formatValue } from '../domain/format';

export function Sparkline({ history, unit }: { history: number[]; unit: string }) {
  const W = 200, H = 40;
  if (history.length < 2) return <p className="card__hint">storico in costruzione…</p>;
  const min = Math.min(...history), max = Math.max(...history);
  const span = max - min || 1;
  const points = history.map((v, i) => `${(i / (history.length - 1)) * W},${H - 2 - ((v - min) / span) * (H - 4)}`).join(' ');
  return (
    <div className="sparkline">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Storico breve">
        <polyline points={points} fill="none" stroke="#f59e0b" strokeWidth="1.5" />
      </svg>
      <div className="sparkline__range"><span>min {formatValue(min, unit)}</span><span>max {formatValue(max, unit)}</span></div>
    </div>
  );
}
