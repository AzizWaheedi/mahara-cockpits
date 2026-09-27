import { FileText } from "lucide-react";
import { Link } from "react-router";
import { useReviews } from "../lib/data";
import { day, duration } from "../lib/format";
import type { Recording } from "../lib/types";
import { Failed, Reading } from "./kit";
import { GradeChip } from "./ReviewCard";

/**
 * A lead's recorded calls (video calls from Fathom, phone calls from
 * Maqsam), each with Vince's grade when he reviewed it. The parent owns the
 * recordings' read and says when it is still on its way or failed; until
 * both it and the reviews are in, nothing here says "no recordings".
 */
export function LeadRecordings({
  contactId,
  recordings,
  loading = false,
  error = null,
  retry,
}: {
  contactId: string;
  recordings: Recording[];
  /** The recordings have not been read yet. */
  loading?: boolean;
  /** Why the recordings could not be read. */
  error?: string | null;
  retry?: () => void;
}) {
  const reviews = useReviews({ contactId });
  const byCall = new Map(
    (reviews.data ?? [])
      .filter(r => r.recording_id)
      .map(r => [String(r.recording_id), r] as const),
  );
  const loose = (reviews.data ?? []).filter(
    r =>
      !r.recording_id ||
      !recordings.some(x => x.recording_id === r.recording_id),
  );
  if (error)
    return (
      <Failed what="This lead's recorded calls" error={error} retry={retry} />
    );
  if (loading) return <Reading what="the recorded calls" />;
  const reviewsFailed = reviews.error ? (
    <Failed
      what="Vince's reviews of this lead"
      error={reviews.error}
      retry={reviews.reload}
    />
  ) : null;
  if (!recordings.length && !loose.length) {
    // A review with no recording still shows here, so "none" waits for the reviews too.
    if (reviewsFailed) return reviewsFailed;
    if (!reviews.data) return <Reading what="the recorded calls" />;
    return (
      <p className="muted text-sm">
        No recorded calls with this lead yet. Video calls from Fathom and
        answered phone calls from Maqsam appear here within half an hour.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <ul className="divide-y hairline">
        {recordings.map(r => {
          const review = byCall.get(r.recording_id);
          return (
            <li key={r.recording_id}>
              <Link
                to={`/recording/${encodeURIComponent(r.recording_id)}`}
                className="flex items-center gap-3 py-2.5 hover:underline"
              >
                <span className="w-20 shrink-0 text-xs tabular-nums">
                  {day(r.started_at)}
                  <span className="muted block">{duration(r.duration_s)}</span>
                </span>
                <span className="min-w-0 flex-1 truncate text-sm" dir="auto">
                  {r.title ?? "Untitled call"}
                </span>
                {r.transcript_path ? (
                  <FileText
                    className="muted size-3.5 shrink-0"
                    aria-label="Has a transcript"
                  />
                ) : null}
                {review ? <GradeChip r={review} /> : null}
              </Link>
            </li>
          );
        })}
        {loose.map(r => (
          <li key={r.id}>
            <Link
              to={`/review/${r.id}`}
              className="flex items-center gap-3 py-2.5 hover:underline"
            >
              <span className="w-20 shrink-0 text-xs tabular-nums">
                {day(r.call_at)}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">
                Vince's review of the{" "}
                {r.call_type === "intro" ? "intro" : "demo"}
                <span className="muted"> · no recording</span>
              </span>
              <GradeChip r={r} />
            </Link>
          </li>
        ))}
      </ul>
      {reviewsFailed}
    </div>
  );
}
