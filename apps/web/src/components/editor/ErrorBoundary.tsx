import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '../ui/index.js';

interface Props { children: ReactNode; fallbackLabel?: string; }
interface State { error: Error | null; }

export class EditorErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[VideoForge] Uncaught editor error:', error, info);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 bg-vf-bg-app text-center p-8">
          <span aria-hidden="true" className="text-4xl">⚠</span>
          <h2 className="text-lg font-bold text-vf-text-primary">
            {this.props.fallbackLabel ?? 'Something went wrong'}
          </h2>
          <p className="max-w-sm text-sm text-vf-text-secondary break-all">
            {this.state.error.message}
          </p>
          <Button variant="secondary" onClick={() => this.setState({ error: null })}>
            Try again
          </Button>
          <Button variant="ghost" onClick={() => window.location.reload()}>
            Reload page
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
