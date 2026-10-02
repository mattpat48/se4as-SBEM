// External models (V20) may fail to load (missing file, HTML instead of GLB): the failing layer
// disappears and the error is logged, while the rest of the scene keeps working (spec §9).
import { Component, type ReactNode } from 'react';

export class ModelBoundary extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    console.error(`Modelli 3D (${this.props.name}) non caricati:`, error);
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
