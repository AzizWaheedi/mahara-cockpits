import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-6">
          <div className="flex w-full max-w-lg flex-col items-center text-center">
            <AlertTriangle
              size={40}
              className="mb-4 flex-shrink-0 txt-bad"
              aria-hidden
            />
            <h2 className="text-xl font-semibold tracking-tight">
              This screen hit a problem
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Reload the page to try again. If it happens again, tell Aziz what
              you were doing when it broke.
            </p>

            <button
              type="button"
              onClick={() => window.location.reload()}
              className={cn(
                "mt-6 flex items-center gap-2 rounded-lg px-4 py-2",
                "bg-primary text-primary-foreground",
                "cursor-pointer hover:opacity-90",
              )}
            >
              <RotateCcw size={16} aria-hidden />
              Reload the page
            </button>

            {this.state.error?.stack ? (
              <details className="mt-6 w-full text-left text-sm">
                <summary className="text-muted-foreground">
                  Technical details
                </summary>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-break-spaces rounded-xl bg-muted p-4 text-xs text-muted-foreground">
                  {this.state.error.stack}
                </pre>
              </details>
            ) : null}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
