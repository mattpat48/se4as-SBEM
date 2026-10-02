import { useLayoutEffect, useMemo } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mat } from './materials';

type ShellType = 'hvac' | 'ventilation' | 'alarm' | 'keypad' | 'resident_display' | 'meters' | 'light';

/** Static details share two material batches per fixture; animated parts stay in Devices. */
export function DeviceShell({ type }: { type: ShellType }) {
  const geometries = useMemo(() => {
    const body: THREE.BufferGeometry[] = [], detail: THREE.BufferGeometry[] = [];
    const box = (out: THREE.BufferGeometry[], x: number, y: number, z: number, w: number, h: number, d: number) =>
      out.push(new THREE.BoxGeometry(w, h, d).translate(x, y, z));
    switch (type) {
      case 'light':
        box(body, 0, 0, 0, .2, .28, .08);
        for (const y of [-.13, .13]) box(detail, 0, y, .06, .22, .035, .12);
        break;
      case 'hvac':
        box(body, 0, 0, 0, 0.9, 0.28, 0.22);
        box(detail, 0, -0.055, 0.115, 0.77, 0.09, 0.012);
        for (let i = 0; i < 4; i++) box(body, 0, -0.09 + i * 0.023, 0.13, 0.74, 0.008, 0.035);
        box(detail, 0.34, 0.067, 0.115, 0.05, 0.023, 0.01);
        break;
      case 'ventilation':
        for (const x of [-0.22, 0.22]) box(body, x, 0, 0, 0.06, 0.04, 0.5);
        for (const z of [-0.22, 0.22]) box(body, 0, 0, z, 0.4, 0.04, 0.06);
        for (let i = 0; i < 6; i++) box(detail, -0.15 + i * 0.06, 0.045, 0, 0.012, 0.015, 0.38);
        break;
      case 'alarm':
        body.push(new THREE.CylinderGeometry(0.19, 0.19, 0.07, 16));
        for (let i = 0; i < 6; i++) box(detail, -0.13 + i * 0.05, 0.04, 0, 0.015, 0.01, 0.12);
        break;
      case 'keypad':
        box(body, 0, 0, 0, 0.16, 0.23, 0.04);
        box(detail, 0, 0.064, 0.024, 0.115, 0.048, 0.008);
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++)
          box(detail, (c - 1) * 0.035, -r * 0.031, 0.026, 0.022, 0.018, 0.008);
        break;
      case 'resident_display':
        box(body, 0, 0, 0, 0.27, 0.17, 0.035);
        break;
      case 'meters':
        box(body, 0, 0, -0.052, 0.9, 0.34, 0.045);
        for (const x of [-0.44, 0.44]) box(detail, x, 0, -0.025, 0.012, 0.34, 0.012);
        break;
    }
    return [body, detail].map((parts) => {
      const merged = parts.length ? mergeGeometries(parts) : null;
      parts.forEach((p) => p.dispose());
      return merged;
    });
  }, [type]);
  useLayoutEffect(() => () => geometries.forEach((g) => g?.dispose()), [geometries]);
  return <>{geometries.map((g, i) => g && <mesh key={i} geometry={g} material={mat(i === 0 ? 'furniture' : 'metal')} dispose={null} />)}</>;
}
