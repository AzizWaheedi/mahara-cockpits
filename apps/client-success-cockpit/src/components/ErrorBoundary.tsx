import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { hostFrame } from "@/present/useHost";
import { FrameLine } from "./FrameLine";

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

  // The Brand Blueprint's frame in the creative director cockpit (a stale
  // chunk after a deploy lands here): the page around it says what to do,
  // and no stack trace shows inside another cockpit's page (EMBED.md 4.6).
  componentDidCatch() {
    hostFrame()?.post({
      type: "failed",
      message:
        "The Blueprint could not be drawn. Reload it to go on. Nothing you saved is lost.",
    });
  }

  render() {
    if (this.state.hasError && hostFrame())
      return <FrameLine>The Blueprint could not be drawn.</FrameLine>;
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen p-8 bg-background">
          <div className="flex flex-col items-center w-full max-w-2xl p-8">
            <AlertTriangle
              size={48}
              className="text-destructive mb-6 flex-shrink-0"
            />

            <h2 className="text-xl mb-4">An unexpected error occurred.</h2>

            <div className="p-4 w-full rounded bg-muted overflow-auto mb-6">
              <pre className="text-sm text-muted-foreground whitespace-break-spaces">
                {this.state.error?.stack}
              </pre>
            </div>

            <button
              onClick={() => window.location.reload()}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg",
                "bg-primary text-primary-foreground",
                "hover:opacity-90 cursor-pointer",
              )}
            >
              <RotateCcw size={16} />
              Reload page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
