import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { frameRate, shadowInterval } from '../domain/renderPolicy';
import { useUiStore } from '../store/ui';
import { useWalkStore } from '../store/walk';

/** A single owner of the frame clock: Drei invalidations cannot bypass the FPS budget.
 * advance() receives seconds in `never` mode. Hidden tabs sleep and resume without a large dt.
 */
export function FrameScheduler({ onOverload }: { onOverload(): void }) {
  const state = useThree();
  const controls = useThree((s) => s.controls);
  useEffect(() => {
    let raf = 0, last = performance.now(), elapsed = state.clock.elapsedTime;
    let movingUntil = 0, shadowAt = -Infinity, renderedAt = last;
    let windowAt = last, frames = 0, previousRate = 0, overloaded = 0;
    const oldAutoUpdate = state.gl.shadowMap.autoUpdate;
    const oldEnabled = state.gl.shadowMap.enabled;
    state.gl.shadowMap.autoUpdate = false;
    const moving = () => { movingUntil = performance.now() + 600; };
    const wake = () => { last = performance.now(); renderedAt = last; windowAt = last; frames = 0; if (!document.hidden) { moving(); cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); } else cancelAnimationFrame(raf); };
    const events = ['pointerdown', 'wheel', 'keydown'] as const;
    for (const event of events) window.addEventListener(event, moving, { passive: true });
    // CameraControls emits change throughout damping and scripted camera transitions.
    const cameraControls = controls as unknown as { addEventListener?(name: string, cb: () => void): void; removeEventListener?(name: string, cb: () => void): void; readonly active?: boolean } | null;
    const cameraMoving = () => { if (cameraControls?.active !== false) moving(); };
    cameraControls?.addEventListener?.('update', cameraMoving);
    document.addEventListener('visibilitychange', wake);
    function tick(now: number) {
      if (document.hidden) return;
      raf = requestAnimationFrame(tick);
      const ui = useUiStore.getState();
      const low = ui.lowPerformance;
      state.gl.shadowMap.enabled = ui.mode !== '2d';
      const rate = frameRate(low, useWalkStore.getState().active, now < movingUntil);
      if (rate !== previousRate) { previousRate = rate; windowAt = now; frames = 0; overloaded = 0; }
      const interval = 1000 / rate;
      if (now - last < interval - 1) return;
      const dt = Math.min((now - renderedAt) / 1000, .1);
      renderedAt = now;
      // Preserve the phase on displays whose refresh is not a multiple of the chosen frame rate.
      last = now - Math.max(0, (now - last) % interval < 1 ? 0 : (now - last) % interval);
      elapsed += dt;
      if (elapsed - shadowAt >= shadowInterval(low)) {
        state.gl.shadowMap.needsUpdate = true;
        shadowAt = elapsed;
      }
      state.advance(elapsed, true);
      frames++;
      if (now - windowAt >= 2500) {
        const actual = frames * 1000 / (now - windowAt);
        overloaded = actual < rate * .75 ? overloaded + 1 : 0;
        if (overloaded >= 2) { onOverload(); overloaded = 0; }
        windowAt = now; frames = 0;
      }
    }
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      for (const event of events) window.removeEventListener(event, moving);
      cameraControls?.removeEventListener?.('update', cameraMoving);
      document.removeEventListener('visibilitychange', wake);
      state.gl.shadowMap.autoUpdate = oldAutoUpdate;
      state.gl.shadowMap.enabled = oldEnabled;
    };
  }, [state, controls, onOverload]);
  return null;
}
