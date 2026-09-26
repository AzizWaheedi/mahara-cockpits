import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useReviewAsks } from "../lib/data";
import { ago } from "../lib/format";
import { toast } from "../lib/toast";
import type { Me } from "../lib/types";
import { button, StatusChip } from "./kit";

/**
 * Ask Vince, the AI reviewer, for a review of this call. The desk on the VPS
 * answers asks every two minutes; while one is open this looks again every
 * twenty seconds and says where it is.
 */
export function ReviewAsk({
  me,
  recordingId,
  hasTranscript,
  reviewed,
  onReviewed,
}: {
  me: Me;
  recordingId: string;
  hasTranscript: boolean;
  reviewed: boolean;
  onReviewed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const asks = useReviewAsks([recordingId], 20_000);
  const last = asks.data?.[0] ?? null;
  const open = last && (last.state === "queued" || last.state === "reviewing");
  // When an ask finishes, the page reads the review again.
  const seen = useRef<string | null>(null);
  const done = last?.state === "done" ? last.id : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: fire once per finished ask
  useEffect(() => {
    if (done && seen.current !== done) {
      seen.current = done;
      onReviewed();
    }
  }, [done]);

  if (!hasTranscript)
    return (
      <p className="muted text-sm">
        No transcript came with this call, so Vince cannot review it.
      </p>
    );
  if (reviewed && !me.manager) return null;

  async function ask() {
    setBusy(true);
    try {
      await api("review.ask", { recording_id: recordingId });
      toast.success("Asked. Vince reviews it within a few minutes.");
      asks.reload();
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  if (open)
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <StatusChip
          tone="neutral"
          label={
            last.state === "reviewing" ? "Vince is reviewing" : "Review asked"
          }
          size="md"
        />
        <span className="muted">
          Asked by {last.requested_by.split("@")[0]} {ago(last.requested_at)}.
          This updates by itself.
        </span>
      </div>
    );
  return (
    <div className="space-y-2">
      {last?.state === "failed" ? (
        <p className="callout-bad rounded-[var(--radius-md)] border px-3 py-2 text-sm">
          The last review did not finish: {last.error ?? "no reason given"}.
        </p>
      ) : null}
      <button type="button" onClick={ask} disabled={busy} className={button}>
        <Sparkles className="size-3.5" aria-hidden />
        {busy
          ? "Asking…"
          : reviewed
            ? "Ask Vince to review it again"
            : "Ask Vince to review this call"}
      </button>
    </div>
  );
}
