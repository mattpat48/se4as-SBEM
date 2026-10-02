import { useEffect } from 'react';
import { useUiStore } from './store/ui';
import { WalkOverlay } from './ui/WalkOverlay';
import { config } from './config';
import { connectView } from './mqtt/client';
import { MinimapOverlay } from './scene/Minimap';
import { Viewport } from './scene/Viewport';
import { useModelStore } from './store/model';
import { DebugPanel } from './ui/DebugPanel';
import { DetailCard } from './ui/DetailCard';
import { Legend } from './ui/Legend';
import { StatusBanner } from './ui/StatusBanner';
import { TopBar } from './ui/TopBar';
import { useShortcuts } from './ui/useShortcuts';

export default function App() {
  useEffect(() => connectView(config), []);
  useShortcuts();
  const layout = useModelStore((s) => s.layout);
  const inside = useUiStore((s) => s.firstPersonUnit);
  const version = useModelStore((s) => s.version);

  return (
    <div className="app">
      {layout && <Viewport key={version} layout={layout} />}
      <TopBar />
      {layout && !inside && <MinimapOverlay />}
      <WalkOverlay />
      {layout && <DetailCard />}
      {layout && !inside && <Legend />}
      {layout && <DebugPanel />}
      <StatusBanner />
    </div>
  );
}
