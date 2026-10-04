import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, type ReactNode } from "react";

/**
 * A screen that throws shows this instead of a blank page: try again keeps
 * the rest of the app, reload starts over, and the failure is reported once
 * so Hermes gets a fix job without anyone having to write it up.
 */
type Props = {
  children: ReactNode;
  report?: (r: { title: string; detail: string }) => Promise<unknown>;
};
type State = { error: Error | null; key: number; reported: boolean };

export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: 0, reported: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error) {
    const sig = `${window.location.pathname}|${error.message}`.slice(0, 200);
    try {
      if (sessionStorage.getItem(`reported:${sig}`)) {
        this.setState({ reported: true });
        return;
      }
    } catch {
      /* Storage may be unavailable. */
    }
    if (!this.props.report) return;
    void this.props
      .report({
        title: `Screen error: ${window.location.pathname}`,
        detail: `${error.message}\n${error.stack ?? ""}`.slice(0, 4000),
      })
      .then(() => {
        this.setState({ reported: true });
        try {
          sessionStorage.setItem(`reported:${sig}`, "1");
        } catch {
          /* Optional cache. */
        }
      })
      .catch(() => this.setState({ reported: false }));
  }

  render() {
    if (!this.state.error)
      return <div key={this.state.key}>{this.props.children}</div>;
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-3 p-10 text-center">
        <AlertTriangle className="size-8 text-destructive" />
        <h2 className="text-lg font-semibold">This screen hit an error</h2>
        <p className="text-sm text-muted-foreground">
          {this.state.reported
            ? "An issue report is queued. "
            : "The issue report has not been saved. "}
          Try again or open another page from the menu.
        </p>
        <p className="max-w-full truncate rounded bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
          {this.state.error.message}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() =>
              this.setState(s => ({
                error: null,
                key: s.key + 1,
                reported: false,
              }))
            }
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm"
          >
            <RotateCcw className="size-3.5" /> Reload
          </button>
        </div>
      </div>
    );
  }
}
