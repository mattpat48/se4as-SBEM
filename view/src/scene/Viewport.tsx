// The 3D canvas: renderer settings, adaptive resolution, camera rig, scene, minimap pass.
import { PerformanceMonitor } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Suspense, useState } from 'react';
import * as THREE from 'three';
import type { ComplexLayout } from '../domain/layout';
import { useUiStore } from '../store/ui';
import { ApartmentInterior } from './ApartmentInterior';
import { CameraRig } from './CameraRig';
import { Complex } from './Complex';
import { Furniture } from './Furniture';
import { Hazards } from './Hazards';
import { HeatPainter } from './HeatPainter';
import { Labels } from './Labels';
import { Lighting } from './Lighting';
import { MinimapPass } from './Minimap';
import { People } from './People';
import { Weather } from './Weather';

export function Viewport({ layout }: { layout: ComplexLayout }) {
  const inside = useUiStore((s) => s.firstPersonUnit);
  const apt = layout.apartments.find((a) => a.id === inside);
  const [dpr, setDpr] = useState(Math.min(2, window.devicePixelRatio || 1));
  return (
    <Canvas
      shadows={{ type: THREE.PCFShadowMap }}
      dpr={dpr}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace }}
    >
      <PerformanceMonitor onDecline={() => setDpr((d) => Math.max(1, d - 0.5))} onIncline={() => setDpr((d) => Math.min(2, d + 0.25))} />
      <CameraRig layout={layout} />
      <Lighting />
      {apt ? <ApartmentInterior layout={layout} apt={apt}/> : <Complex layout={layout} />}
      <HeatPainter layout={layout} />
      {/* External models load in the background; the rest of the scene does not wait for them. */}
      <Suspense fallback={null}>
        <Furniture layout={layout} />
        <People layout={layout} />
      </Suspense>
      <Hazards layout={layout} />
      {!apt && <Weather />}
      {!apt && <Labels layout={layout} />}
      {!apt && <MinimapPass />}
    </Canvas>
  );
}
