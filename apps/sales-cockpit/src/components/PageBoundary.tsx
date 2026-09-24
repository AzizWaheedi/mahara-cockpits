import { Component, type ErrorInfo, type ReactNode } from "react";
import { buttonPrimary } from "./kit";

/** An old tab asking for a page file that a newer deploy replaced. */
function isStaleBuild(error: Error) {
  return /dynamically imported module|Importing a module script failed|error loading dynamically/i.test(
    error.message,
  );
}

/**
 * A page that throws while drawing says what happened and how to get past
 * it. Without this React empties the whole screen. Around the routes the
 * rail and the tab bar keep working; around the app (main.tsx) it is the
 * last word before a blank page.
 */
export class PageBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("The page stopped:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = isStaleBuild(error);
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center" role="alert">
        <h1 className="text-lg font-semibold">
          {stale
            ? "The cockpit was updated"
            : "This page stopped with an error"}
        </h1>
        <p className="muted mt-2 text-sm">
          {stale
            ? "A newer version came out while this tab was open. Reload to open it."
            : "Reload the page. If it happens again, send a screenshot of this to your manager."}
        </p>
        {stale ? null : (
          <p className="muted mt-3 rounded-[var(--radius-md)] bg-[color:var(--muted)] px-3 py-2 font-mono text-xs break-words">
            {error.message || String(error)}
          </p>
        )}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className={`${buttonPrimary} mt-6`}
        >
          Reload
        </button>
      </div>
    );
  }
}
