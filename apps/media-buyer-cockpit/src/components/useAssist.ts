import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { waitingLabel } from "../../convex/driveCreative";

/**
 * Hand a job over and watch it come back.
 *
 * The cockpit itself cannot write copy or reach Drive — those run through a
 * service that has gone down on us before. So the button does not "call an AI":
 * it files a request, and this hook watches the row until Viktor has done it.
 * The panel therefore shows real progress ("queued", "Viktor is on it") instead
 * of an error, and nothing is lost if a step is slow.
 */
export type AssistKind = "copy" | "creative" | "launch";

export type AssistRow = {
  _id: Id<"assistRequests">;
  kind: string;
  status: string;
  note?: string;
  error?: string;
  requestedAt: number;
  variants?: {
    headline: string;
    message: string;
    description?: string;
    angle?: string;
  }[];
  media?: {
    name: string;
    link: string;
    kind?: string;
    imageHash?: string;
    videoId?: string;
    thumbUrl?: string;
    error?: string;
    percent?: number;
  }[];
  steps?: { label: string; state: string; detail?: string }[];
} | null;

export function useAssist(kind: AssistKind) {
  const enqueue = useMutation(api.assist.enqueue);
  const [id, setId] = useState<Id<"assistRequests"> | null>(null);
  const row = useQuery(api.assist.get, id ? { id } : "skip") as AssistRow;

  const ask = useCallback(
    async (args: {
      campaignName?: string;
      client?: string;
      brief?: string;
      language?: string;
      driveLinks?: string[];
    }) => {
      const newId = await enqueue({ kind, ...args });
      setId(newId);
      return newId;
    },
    [enqueue, kind],
  );

  const waiting =
    !!id && (!row || row.status === "queued" || row.status === "working");

  // A clock for the wait, so "working" is never a spinner with no age.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [waiting]);

  /** Follow a request somebody else queued (the add-creative action does, for a Drive link). */
  const watch = useCallback(
    (requestId: Id<"assistRequests">) => setId(requestId),
    [],
  );

  return { ask, watch, row, waiting, now, reset: () => setId(null) };
}

/** The wait on a Drive fetch, with its age and the upload percent when there is one. */
export function creativeWaitLabel(
  row: AssistRow,
  waiting: boolean,
  now: number,
): string | null {
  if (!waiting)
    return row?.status === "failed" ? (row.error ?? "That one failed.") : null;
  if (!row || row.status === "queued")
    return "Queued. Picked up within a few seconds.";
  return waitingLabel(row.media ?? undefined, row.requestedAt, now);
}

/** What to show her while she waits — plain words, never a spinner alone. */
export function assistLabel(row: AssistRow, waiting: boolean): string | null {
  if (!waiting && !row) return null;
  if (!row || row.status === "queued")
    return "Queued. Picked up within a few minutes.";
  if (row.status === "working") return "Working on it now.";
  if (row.status === "failed") return row.error ?? "That one failed.";
  return null;
}
