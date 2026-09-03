import { Component, ErrorInfo, ReactNode } from "react";
import { isChunkLoadError, reloadForStaleChunk } from "@/lib/lazyWithReload";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  staleChunk: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    staleChunk: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
      staleChunk: isChunkLoadError(error),
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (isChunkLoadError(error)) {
      // A new build replaced the chunk this tab was about to load. Reload once
      // to the fresh index.html instead of showing a crash screen.
      reloadForStaleChunk();
      return;
    }
    this.setState({ errorInfo });
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError && this.state.staleChunk) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background px-6 text-center">
          <div className="max-w-sm space-y-3">
            <h1 className="text-xl font-semibold text-foreground">
              Updating SafeDrive
            </h1>
            <p className="text-sm text-muted-foreground">
              A newer version was just released. Reloading to pick it up...
            </p>
            <button
              className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              onClick={() => window.location.reload()}
            >
              Reload now
            </button>
          </div>
        </div>
      );
    }

    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-red-950/20 text-red-500 p-10 font-mono text-sm">
          <h1 className="text-2xl font-bold mb-4">React App Crashed</h1>
          <p className="mb-4">
            An unexpected TypeError occurred in the component tree.
          </p>
          <div className="bg-black/50 p-4 rounded-xl overflow-auto border border-red-900">
            <h2 className="text-lg font-semibold mb-2">
              {this.state.error?.toString()}
            </h2>
            <pre className="whitespace-pre-wrap">{this.state.error?.stack}</pre>
            <hr className="my-4 border-red-900/50" />
            <pre className="whitespace-pre-wrap">
              {this.state.errorInfo?.componentStack}
            </pre>
          </div>
          <button
            className="mt-6 px-4 py-2 bg-red-900 text-white rounded hover:bg-red-800"
            onClick={() => (window.location.href = "/")}
          >
            Reload App
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
