// The 3D canvas: renderer settings, adaptive resolution, camera rig, scene, minimap pass.
import { PerformanceMonitor } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Suspense, useState } from 'react';
import * as THREE from 'three';
import type { ComplexLayout } from '../domain/layout';
import { useWalkStore } from '../store/walk';
import { CameraRig } from './CameraRig';
import { Complex } from './Complex';
import { Furniture } from './Furniture';
import { Hazards } from './Hazards';
import { HeatPainter } from './HeatPainter';
import { Labels } from './Labels';
import { Lighting } from './Lighting';
import { MinimapPass } from './Minimap';
import { ModelBoundary } from './ModelBoundary';
import { People } from './People';
import { Weather } from './Weather';

export function Viewport({ layout }: { layout: ComplexLayout }) {
  const walking = useWalkStore((s) => s.active);
  // Rain only reaches the walker outdoors or on a balcony (V21).
  const sheltered = useWalkStore((s) => s.active && (s.place.kind === 'apartment' || s.place.kind === 'stairwell'));
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
      <Complex layout={layout} />
      <HeatPainter layout={layout} />
      {/* External models load in the background, each layer on its own: the rest of the scene
          neither waits for them nor fails with them. */}
      <ModelBoundary name="arredi"><Suspense fallback={null}><Furniture layout={layout} /></Suspense></ModelBoundary>
      <ModelBoundary name="residenti"><Suspense fallback={null}><People layout={layout} /></Suspense></ModelBoundary>
      <Hazards layout={layout} />
      <group visible={!sheltered}><Weather /></group>
      {!walking && <Labels layout={layout} />}
      {!walking && <MinimapPass />}
    </Canvas>
  );
}
