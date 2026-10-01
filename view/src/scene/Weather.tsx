// Rain from the park's rain_level (view spec §7.7): up to 3000 instanced streaks over 200 m.
// Clouds dim the sun in Lighting; wind sways the trees and spins the anemometer in Park.
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { rainDensity } from '../domain/effects';
import { mulberry32 } from '../domain/random';
import { readingNow } from './readings';

const MAX_DROPS = 3000;
const AREA_M = 200;
const HEIGHT_M = 40;
const FALL_M_S = 18;
const STREAK = new THREE.BoxGeometry(0.03, 0.9, 0.03);

export function Weather() {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const drops = useMemo(() => {
    const rnd = mulberry32(7);
    return Array.from({ length: MAX_DROPS }, () => ({ x: (rnd() - 0.5) * AREA_M, z: (rnd() - 0.5) * AREA_M, y0: rnd() * HEIGHT_M }));
  }, []);
  const material = useMemo(() => new THREE.MeshBasicMaterial({ color: '#cbd5e1', transparent: true, opacity: 0.55, depthWrite: false }), []);
  const m = useMemo(() => new THREE.Matrix4(), []);

  useFrame(({ clock }) => {
    const w = mesh.current;
    if (!w) return;
    const count = Math.round(rainDensity(readingNow('park.rain_level')) * MAX_DROPS);
    w.count = count;
    if (count === 0) return;
    const fall = clock.elapsedTime * FALL_M_S;
    for (let i = 0; i < count; i++) {
      const d = drops[i];
      m.makeTranslation(d.x, HEIGHT_M - ((d.y0 + fall) % HEIGHT_M), d.z);
      w.setMatrixAt(i, m);
    }
    w.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={mesh} args={[STREAK, material, MAX_DROPS]} frustumCulled={false} />;
}
