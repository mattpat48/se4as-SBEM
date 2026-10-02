import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { cameraApi } from './scene/CameraRig';
import { useCommandStore } from './store/commands';
import { useConnectionStore } from './store/connection';
import { useLiveStore } from './store/live';
import { useModelStore } from './store/model';
import { useUiStore } from './store/ui';
import { doorOpenness, useWalkStore, walker } from './store/walk';

// Development only: the stores are reachable from the browser console as window.__view.
if (import.meta.env.DEV) {
  (window as any).__view = { useUiStore, useLiveStore, useModelStore, useConnectionStore, useCommandStore, cameraApi, useWalkStore, walker, doorOpenness };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
