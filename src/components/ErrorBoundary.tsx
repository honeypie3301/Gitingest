import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Unhandled React Error:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0d1117] text-white flex flex-col items-center justify-center p-6">
          <div className="max-w-md w-full bg-[#161b22] border-2 border-red-500/60 rounded-2xl p-6 shadow-[4px_4px_0_0_#000000] space-y-4 text-center">
            <div className="w-12 h-12 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-white">Something went wrong</h2>
              <p className="text-xs text-gray-400 mt-1">
                The interface encountered a rendering issue. Your data was not lost.
              </p>
            </div>
            {this.state.error?.message && (
              <pre className="text-[11px] font-mono bg-[#0d1117] p-2.5 rounded-lg border border-[#30363d] text-red-300 text-left overflow-x-auto max-h-32">
                {this.state.error.message}
              </pre>
            )}
            <button
              onClick={this.handleReset}
              className="w-full py-2.5 px-4 bg-amber-500 hover:bg-amber-400 text-gray-950 font-extrabold rounded-xl text-sm transition-transform active:translate-y-0.5 shadow-[2px_2px_0_0_#000000] flex items-center justify-center gap-2 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Reload Application</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
