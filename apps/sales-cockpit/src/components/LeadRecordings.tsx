import { FileText } from "lucide-react";
import { Link } from "react-router";
import { useReviews } from "../lib/data";
import { day, duration } from "../lib/format";
import type { Recording } from "../lib/types";
import { GradeChip } from "./ReviewCard";

/** A lead's recorded calls, each with Vince's grade when he reviewed it. */
export function LeadRecordings({
  contactId,
  recordings,
}: {
  contactId: string;
  recordings: Recording[];
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
  if (!recordings.length && !loose.length)
    return (
      <p className="muted text-sm">
        No recorded calls with this lead. Calls recorded in Fathom appear here
        within half an hour.
      </p>
    );
  return (
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
              Vince's review of the {r.call_type === "intro" ? "intro" : "demo"}
              <span className="muted"> · no recording</span>
            </span>
            <GradeChip r={r} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
