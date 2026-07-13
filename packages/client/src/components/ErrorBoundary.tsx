import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { PixelIcon } from './PixelIcon';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen items-center justify-center bg-background p-6">
          <div className="sticker max-w-md rounded-[1.75rem] bg-card p-8 text-center">
            <PixelIcon name="file-error" className="animate-px-bob mx-auto h-14 w-14 text-destructive" />
            <h1 className="mt-4 font-display text-2xl text-foreground [text-transform:lowercase]">
              something glitched
            </h1>
            <p className="mt-2.5 text-sm text-muted-foreground">
              {this.state.error?.message || 'An unexpected error occurred.'}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="sticker-sm sticker-press mt-5 rounded-full bg-primary px-5 py-2.5 font-display text-sm text-primary-foreground [text-transform:lowercase]"
            >
              reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
