// Cars at the chargers when `car_connected`, and the charger LED (pulsing at 1 Hz while charging,
// steady in pause) — view spec §7.4.
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { chargerVisual } from '../domain/actuatorVisual';
import type { ComplexLayout } from '../domain/layout';
import { useLiveStore } from '../store/live';
import { UNIT_BOX, fixedMat } from './materials';

const CAR_COLORS = ['#b91c1c', '#1d4ed8', '#f8fafc', '#334155'];

function Charger({ id, position, color }: { id: string; position: { x: number; z: number }; color: string }) {
  const car = useRef<THREE.Group>(null);
  const led = useMemo(() => new THREE.MeshStandardMaterial({ color: '#22c55e', emissive: '#22c55e', emissiveIntensity: 0 }), []);
  const body = useMemo(() => new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3 }), [color]);

  useFrame(({ clock }) => {
    const e = useLiveStore.getState().states.get(`${id}.ev_charger`);
    const v = chargerVisual(e?.state ?? {}, e?.powerW ?? 0);
    if (car.current) car.current.visible = v.car;
    led.emissiveIntensity = v.led === 'pulse' ? 1 + Math.sin(2 * Math.PI * clock.elapsedTime) : v.led === 'steady' ? 1.5 : 0;
  });

  return (
    <group userData={{ deviceId: `${id}.ev_charger` }}>
      <mesh geometry={UNIT_BOX} material={led} position={[position.x, 1.3, position.z + 0.21]} scale={[0.4, 0.15, 0.05]} />
      <group ref={car} position={[position.x, 0, position.z + 3.6]} visible={false}>
        <mesh geometry={UNIT_BOX} material={body} position={[0, 0.6, 0]} scale={[1.8, 0.8, 4.2]} castShadow />
        <mesh geometry={UNIT_BOX} material={fixedMat('carGlass', () => new THREE.MeshStandardMaterial({ color: '#1f2937', roughness: 0.2 }))}
          position={[0, 1.3, 0.2]} scale={[1.6, 0.6, 2.2]} castShadow />
      </group>
    </group>
  );
}

export function Cars({ layout }: { layout: ComplexLayout }) {
  return (
    <group>
      {layout.chargers.map((c, i) => <Charger key={c.id} id={c.id} position={c.position} color={CAR_COLORS[i % CAR_COLORS.length]} />)}
    </group>
  );
}
