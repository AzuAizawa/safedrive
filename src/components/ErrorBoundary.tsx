import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
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
