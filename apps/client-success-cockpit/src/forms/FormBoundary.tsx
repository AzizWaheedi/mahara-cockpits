import type { ReactNode } from "react";
import { DeckBoundary, useDeckReport } from "@/present/DeckBoundary";

/**
 * The form window's own error boundary, the decks' pattern with the form's
 * words: no stack and no error text on a window that may be shared, one
 * plain sentence, a way back in, and the failure reported once.
 */
export function FormRouteBoundary({ children }: { children: ReactNode }) {
  const report = useDeckReport();
  return (
    <DeckBoundary
      report={report}
      where="form"
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
            padding: 16,
            background: "#091333",
            color: "rgba(242, 246, 250, 0.7)",
            font: '16px/1.5 "Geist", "IBM Plex Sans Arabic", ui-sans-serif, sans-serif',
          }}
        >
          <strong style={{ fontSize: 22, color: "#f2f6fa", fontWeight: 600 }}>
            The form window could not be drawn.
          </strong>
          <span>
            Reload this window to go on. Anything already sent is safe in
            Typeform.
          </span>
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
            Reload the window
          </button>
        </div>
      }
    >
      {children}
    </DeckBoundary>
  );
}
