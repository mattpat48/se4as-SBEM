// First-person minimap (V21): an SVG plan of the complex, north up, with the open building marked
// and an arrow for the walker, moved every animation frame without React renders.
import { useEffect, useRef } from 'react';
import { MINIMAP_EXTENT_M } from '../domain/camera';
import type { BuildingGeom, ComplexLayout, RectGeom } from '../domain/layout';
import { placeLabel } from '../domain/whereabouts';
import { useUiStore } from '../store/ui';
import { useWalkStore, walker } from '../store/walk';

const SIZE_PX = 200;
const E = MINIMAP_EXTENT_M;

function corners(b: BuildingGeom): string {
  const c = Math.cos(b.rotationY), s = Math.sin(b.rotationY);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => {
    const lx = (i * b.width) / 2, lz = (j * b.depth) / 2;
    return `${b.center.x + lx * c + lz * s},${b.center.z - lx * s + lz * c}`;
  }).join(' ');
}
const rect = (r: RectGeom) => ({ x: r.center.x - r.width / 2, y: r.center.z - r.depth / 2, width: r.width, height: r.depth });

export function WalkMinimap({ layout }: { layout: ComplexLayout }) {
  const arrow = useRef<SVGGElement>(null);
  const open = useWalkStore((s) => s.openBuilding);
  const place = useWalkStore((s) => s.place);
  useEffect(() => {
    let frame = 0, last = -Infinity, shown = '';
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (document.hidden || now - last < (useUiStore.getState().lowPerformance ? 1000 / 15 : 1000 / 30)) return;
      last = now;
      const transform = `translate(${walker.x} ${walker.z}) rotate(${(-walker.yaw * 180) / Math.PI})`;
      if (transform !== shown) { arrow.current?.setAttribute('transform', transform); shown = transform; }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div className="minimap walk-minimap" style={{ width: SIZE_PX, height: SIZE_PX }}>
      <svg viewBox={`${-E} ${-E} ${2 * E} ${2 * E}`} width={SIZE_PX} height={SIZE_PX} role="img" aria-label="Minimappa della prima persona">
        <rect x={-E} y={-E} width={2 * E} height={2 * E} fill="#c9c3b4" />
        <rect {...rect(layout.park)} fill="#8fbf7a" />
        <rect {...rect(layout.parking)} fill="#9aa1aa" />
        <circle cx={layout.park.center.x} cy={layout.park.center.z} r={3.4} fill="#7dd3fc" />
        {layout.buildings.map((b) => (
          <polygon key={b.id} points={corners(b)} fill={b.id === open ? '#d8b77e' : '#e7e1d6'} stroke="#334155" strokeWidth={0.6} />
        ))}
        {layout.buildings.map((b) => (
          <text key={`t${b.id}`} x={b.center.x} y={b.center.z + 2.5} fontSize={7} textAnchor="middle" fill="#172333">{b.id}</text>
        ))}
        <g ref={arrow}>
          <polygon points="0,5 -3.2,-3 3.2,-3" fill="#dc2626" stroke="#fff" strokeWidth={0.8} />
        </g>
      </svg>
      <span className="minimap__north">▲ N</span>
      <span className="minimap__label">{placeLabel(place)}</span>
    </div>
  );
}
