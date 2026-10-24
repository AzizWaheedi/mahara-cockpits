import { Component, type ReactNode, useCallback } from "react";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { hostFrame } from "./useHost";

/**
 * The shared deck's own error boundaries. The deck is on the client's
 * screen, so a slide that throws (or a deck chunk that fails to load) never
 * shows the app's stack trace: one slide breaks into a calm line and the
 * deck goes on, and the whole deck breaks into one plain screen. Either way
 * the failure is reported once, as the cockpit's own screens report theirs.
 */

type Report = (r: { title: string; detail: string }) => Promise<unknown>;

interface Props {
  children: ReactNode;
  /** What shows instead, with no stack and no error text. */
  fallback: ReactNode;
  report?: Report;
  /** Where the failure was, for the report's title. */
  where?: string;
  /** Told once, when the fallback shows. */
  onFail?: () => void;
}
interface State {
  failed: boolean;
}

export class DeckBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    this.props.onFail?.();
    const at = `${window.location.pathname}${this.props.where ? `#${this.props.where}` : ""}`;
    const sig = `deck|${at}|${error.message}`.slice(0, 200);
    try {
      if (sessionStorage.getItem(`reported:${sig}`)) return;
      sessionStorage.setItem(`reported:${sig}`, "1");
    } catch {
      // storage unavailable: report anyway
    }
    void this.props
      .report?.({
        title: `Deck slide crashed: ${at}`,
        detail: `${error.message}\n\n${error.stack ?? ""}`.slice(0, 4000),
      })
      .catch(() => undefined);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Sends a deck failure to the issue queue, as AppLayout does for its screens. */
export function useDeckReport(): Report {
  const { client } = useCockpitAuth();
  return useCallback(
    async r => {
      if (!client) return;
      // The Blueprint's frame in the creative director cockpit reports as
      // that cockpit: the server takes an app only with its own role
      // (client-success with csm, creative with creative), as the creative
      // director cockpit's own AppLayout reports.
      const hosted = hostFrame() !== null;
      try {
        const { error } = await client.rpc("cockpit_submit_issue_report", {
          p_app: hosted ? "creative" : "client-success",
          p_page: window.location.pathname,
          p_text: `${r.title}\n${r.detail}`.trim(),
          p_role: hosted ? "creative" : "csm",
        });
        if (error) throw error;
      } catch (err) {
        console.error("Failed to report issue:", err);
      }
    },
    [client],
  );
}

/**
 * The whole deck window, around its lazy route: plain words on the deck's
 * own ground (inline, since the deck's stylesheet may be what failed to
 * load), and a way back in.
 */
export function DeckRouteBoundary({ children }: { children: ReactNode }) {
  const report = useDeckReport();
  return (
    <DeckBoundary
      report={report}
      where="deck"
      // In the creative director cockpit's page, the page says it instead.
      onFail={() =>
        hostFrame()?.post({
          type: "failed",
          message:
            "The deck could not be drawn. Reload it to go on. Nothing you saved is lost.",
        })
      }
      fallback={
        <div
          role="alert"
          style={{
            position: "fixed",
            inset: 0,
            display: "grid",
            placeContent: "center",
            gap: 16,
            textAlign: "center",
            background: "#091333",
            color: "rgba(242, 246, 250, 0.7)",
            font: '18px/1.5 "Geist", "IBM Plex Sans Arabic", ui-sans-serif, sans-serif',
          }}
        >
          <strong style={{ fontSize: 28, color: "#f2f6fa", fontWeight: 600 }}>
            The deck could not be drawn.
          </strong>
          <span>Reload this window to go on. Nothing you saved is lost.</span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              justifySelf: "center",
              padding: "8px 18px",
              borderRadius: 999,
              border: "1px solid rgba(255, 255, 255, 0.22)",
              background: "transparent",
              color: "#f2f6fa",
              font: "inherit",
              cursor: "pointer",
            }}
          >
            Reload the deck
          </button>
        </div>
      }
    >
      {children}
    </DeckBoundary>
  );
}
