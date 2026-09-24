import { FileText, Mic, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { EmptyState, Failed, field, SourceNote } from "../components/kit";
import { GradeChip } from "../components/ReviewCard";
import {
  PAGE,
  useLeadsById,
  useRecordings,
  useReps,
  useReviews,
} from "../lib/data";
import { day, duration } from "../lib/format";
import type { Me, Recording, Review } from "../lib/types";

/**
 * Every recorded sales call, newest first, and Vince's reviews of them. The
 * team reads each other's calls, as they read each other's reviews in
 * Slack; a rep opens on their own.
 */
export default function RecordingsPage({ me }: { me: Me }) {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "reviews" ? "reviews" : "calls";
  const reps = useReps();
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  return (
    <main className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6 md:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Recordings</h1>
          <p className="muted text-sm">
            Every recorded sales call, newest first. Vince reviews each new one.
          </p>
        </div>
        <div
          className="raised inline-flex rounded-[var(--radius-md)] p-0.5 text-sm"
          role="group"
          aria-label="Show"
        >
          {(
            [
              ["calls", "Calls"],
              ["reviews", "Vince's reviews"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={tab === k}
              onClick={() => set({ tab: k === "calls" ? null : k, page: null })}
              className={`rounded-[calc(var(--radius-md)-2px)] px-3 py-1 ${tab === k ? "bg-[color:var(--card)] font-medium shadow-sm" : "muted"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      {tab === "calls" ? (
        <Calls me={me} params={params} set={set} reps={reps.data ?? []} />
      ) : (
        <Reviews me={me} params={params} set={set} reps={reps.data ?? []} />
      )}

      <SourceNote>
        Calls come from Fathom: the Obsidian vault's copy of every recorded
        sales call, and the desk's own look at the last 14 days. A call belongs
        to a lead when an invitee's email is the lead's, or when that lead's
        intro or demo began within 30 minutes of it. Reviews are Vince's: his
        121 from before he stopped in August, and the ones the desk has written
        since with his template and framework.
      </SourceNote>
    </main>
  );
}

type RepList = NonNullable<ReturnType<typeof useReps>["data"]>;

function Calls({
  me,
  params,
  set,
  reps,
}: {
  me: Me;
  params: URLSearchParams;
  set: (p: Record<string, string | null>) => void;
  reps: RepList;
}) {
  const mine = (me.fathom_email ?? "").toLowerCase();
  const by = params.get("by") ?? (me.manager ? "" : mine);
  const page = Math.max(0, Number(params.get("page") ?? 1) - 1) || 0;
  const [text, setText] = useState(params.get("q") ?? "");
  useEffect(() => {
    const t = window.setTimeout(() => {
      if ((params.get("q") ?? "") !== text.trim())
        set({ q: text.trim() || null, page: null });
    }, 300);
    return () => window.clearTimeout(t);
  }, [text, params, set]);

  const calls = useRecordings({ q: params.get("q") ?? "", by, page });
  const rows = calls.data ?? [];
  const reviews = useReviews({ recordingIds: rows.map(r => r.recording_id) });
  const reviewOf = useMemo(
    () =>
      new Map(
        (reviews.data ?? []).map(r => [String(r.recording_id), r] as const),
      ),
    [reviews.data],
  );
  const leads = useLeadsById(
    rows.map(r => r.contact_id).filter((x): x is string => Boolean(x)),
  );
  const leadName = useMemo(
    () => new Map((leads.data ?? []).map(l => [l.contact_id, l.name] as const)),
    [leads.data],
  );
  const recorders = reps.filter(r => r.fathom_email);

  return (
    <>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="relative flex-1">
          <span className="sr-only">Search the calls</span>
          <Search
            className="muted pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden
          />
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Search by the call's title"
            className={`${field} pl-9`}
            dir="auto"
          />
        </label>
        <select
          aria-label="Whose calls"
          value={by}
          onChange={e => set({ by: e.target.value || null, page: null })}
          className={`${field} sm:w-56`}
        >
          <option value="">Everyone's calls</option>
          {recorders.map(r => (
            <option key={r.id} value={String(r.fathom_email).toLowerCase()}>
              {r.display_name}
            </option>
          ))}
        </select>
      </div>

      {calls.error ? (
        <Failed what="The calls" error={calls.error} retry={calls.reload} />
      ) : calls.loading && !rows.length ? (
        <p className="muted text-sm">Reading the calls…</p>
      ) : !rows.length ? (
        <EmptyState
          icon={Mic}
          title="No calls here"
          text={
            by || params.get("q")
              ? "Nothing matches. Clear the search or pick everyone's calls."
              : "Recorded sales calls appear here within half an hour of Fathom having them."
          }
        />
      ) : (
        <ul className="panel divide-y hairline overflow-hidden">
          {rows.map(r => (
            <CallRow
              key={r.recording_id}
              r={r}
              review={reviewOf.get(r.recording_id)}
              lead={r.contact_id ? leadName.get(r.contact_id) : undefined}
            />
          ))}
        </ul>
      )}

      <Pager
        page={page}
        more={rows.length >= PAGE}
        onPage={p => set({ page: p ? String(p + 1) : null })}
      />
    </>
  );
}

function CallRow({
  r,
  review,
  lead,
}: {
  r: Recording;
  review?: Review;
  lead?: string | null;
}) {
  return (
    <li>
      <Link
        to={`/recording/${encodeURIComponent(r.recording_id)}`}
        className="flex items-center gap-3 px-4 py-3 hover:bg-[color:var(--secondary)]"
      >
        <div className="w-20 shrink-0 text-xs tabular-nums">
          <p>{day(r.started_at)}</p>
          <p className="muted">{duration(r.duration_s)}</p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" dir="auto">
            {r.title ?? "Untitled call"}
          </p>
          <p className="muted truncate text-xs" dir="auto">
            {[
              lead
                ? `with ${lead}`
                : r.contact_id
                  ? "with a lead"
                  : "no lead matched",
              r.recorded_by?.split("@")[0],
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {r.transcript_path ? (
            <FileText
              className="muted size-3.5"
              aria-label="Has a transcript"
            />
          ) : null}
          {review ? <GradeChip r={review} /> : null}
        </div>
      </Link>
    </li>
  );
}

function Reviews({
  me,
  params,
  set,
  reps,
}: {
  me: Me;
  params: URLSearchParams;
  set: (p: Record<string, string | null>) => void;
  reps: RepList;
}) {
  const rep = params.get("rep") ?? (me.manager ? "" : (me.b2b_rep_id ?? ""));
  const reviews = useReviews(
    rep ? { repKey: rep, limit: 200 } : { all: true, limit: 200 },
  );
  const rows = reviews.data ?? [];
  const graded = rows.filter(r => r.score !== null && r.score_max);
  const avg = graded.length
    ? graded.reduce((a, r) => a + Number(r.score) / Number(r.score_max), 0) /
      graded.length
    : null;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <select
          aria-label="Whose reviews"
          value={rep}
          onChange={e => set({ rep: e.target.value || null })}
          className={`${field} sm:w-56`}
        >
          <option value="">Everyone's reviews</option>
          {reps.map(r => (
            <option key={r.id} value={r.id}>
              {r.display_name}
            </option>
          ))}
        </select>
        {avg !== null ? (
          <p className="muted text-sm">
            {graded.length} graded · average {Math.round(avg * 100)}% of the
            marks
          </p>
        ) : null}
      </div>
      {reviews.error ? (
        <Failed
          what="The reviews"
          error={reviews.error}
          retry={reviews.reload}
        />
      ) : reviews.loading && !rows.length ? (
        <p className="muted text-sm">Reading the reviews…</p>
      ) : !rows.length ? (
        <EmptyState
          icon={Mic}
          title="No reviews yet"
          text="Vince reviews each new recorded call within the hour of it reaching the cockpit."
        />
      ) : (
        <ul className="panel divide-y hairline overflow-hidden">
          {rows.map(r => (
            <li key={r.id}>
              <Link
                to={
                  r.recording_id
                    ? `/recording/${encodeURIComponent(r.recording_id)}`
                    : `/review/${r.id}`
                }
                className="flex items-center gap-3 px-4 py-3 hover:bg-[color:var(--secondary)]"
              >
                <p className="w-20 shrink-0 text-xs tabular-nums">
                  {day(r.call_at)}
                </p>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" dir="auto">
                    {r.lead_name ?? "A lead"}
                  </p>
                  <p className="muted truncate text-xs">
                    {r.call_type === "intro" ? "Intro" : "Demo"} ·{" "}
                    {r.rep_name ?? "a rep"}
                    {r.recording_id ? "" : " · no recording"}
                  </p>
                </div>
                <GradeChip r={r} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Pager({
  page,
  more,
  onPage,
}: {
  page: number;
  more: boolean;
  onPage: (p: number) => void;
}) {
  if (!page && !more) return null;
  return (
    <div className="flex items-center justify-between text-sm">
      <button
        type="button"
        disabled={!page}
        onClick={() => onPage(page - 1)}
        className="muted underline-offset-4 hover:underline disabled:opacity-40"
      >
        Newer
      </button>
      <span className="muted">
        {page * PAGE + 1}–{page * PAGE + PAGE}
      </span>
      <button
        type="button"
        disabled={!more}
        onClick={() => onPage(page + 1)}
        className="muted underline-offset-4 hover:underline disabled:opacity-40"
      >
        Older
      </button>
    </div>
  );
}
