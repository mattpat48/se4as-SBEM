// Whole-height walls of one apartment, with door and window openings and their wooden frames:
// shared by the first-person visit and the 3D cut floor (V20).
import { useLayoutEffect, useMemo } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { interiorShell } from '../domain/interior';
import type { ApartmentGeom, BuildingGeom } from '../domain/layout';
import { PLAN_D, PLAN_W, PLINTH_M } from '../domain/plan';
import { planLocal } from './geom';
import { mat } from './materials';

export function InteriorWalls({ b, apt, ceiling, entryOpen = false, faded = false, children }: {
  b: BuildingGeom; apt: ApartmentGeom; ceiling: number; entryOpen?: boolean; faded?: boolean; children?: React.ReactNode;
}) {
  const geometries = useMemo(() => {
    const boxes = interiorShell(ceiling, { entryOpen });
    return (['wall', 'wood'] as const).map((role) => {
      const parts = boxes.filter((p) => p.role === role)
        .map((p) => new THREE.BoxGeometry(p.w, p.y1 - p.y0, p.d).translate(p.u, (p.y0 + p.y1) / 2, p.v));
      const g = mergeGeometries(parts)!;
      parts.forEach((p) => p.dispose());
      return { role, g };
    });
  }, [ceiling, entryOpen]);
  useLayoutEffect(() => () => geometries.forEach((p) => p.g.dispose()), [geometries]);
  const [x, z] = planLocal(b, 0, 0, apt.mirrored);
  return (
    <group position={[x, PLINTH_M + apt.floor * b.floorHeight, z]} rotation={[0, apt.mirrored ? Math.PI : 0, 0]}
      scale={[b.width / PLAN_W, 1, b.depth / PLAN_D]}>
      {geometries.map(({ role, g }) => (
        <mesh key={role} geometry={g} material={mat(role, faded)} dispose={null} castShadow receiveShadow />
      ))}
      {children}
    </group>
  );
}
