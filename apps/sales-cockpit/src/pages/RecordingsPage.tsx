import { FileText, Mic, Phone, Plus, Search, Video } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { CoachReviewForm, CoachReviewList } from "../components/CoachReviews";
import {
  button,
  EmptyState,
  Failed,
  field,
  page,
  Segmented,
  SourceNote,
  StatusChip,
} from "../components/kit";
import { GradeChip } from "../components/ReviewCard";
import {
  PAGE,
  useCoachReviews,
  useLeadsById,
  useRecordings,
  useReps,
  useReviewAsks,
  useReviews,
} from "../lib/data";
import { day, duration } from "../lib/format";
import type { Me, Recording, Review, ReviewAsk } from "../lib/types";

/**
 * Every recorded sales call, newest first, Vince's reviews of them, and
 * Aziz's own reviews. Everyone reads everyone's calls (Aziz, 2026-09-26:
 * "They should be allowed to pick all the recordings") and can ask Vince to
 * review any of them.
 */
export default function RecordingsPage({ me }: { me: Me }) {
  const [params, setParams] = useSearchParams();
  const tab =
    params.get("tab") === "reviews"
      ? "reviews"
      : params.get("tab") === "aziz"
        ? "aziz"
        : "calls";
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
    <main className={page}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Recordings</h1>
          <p className="muted mt-1 text-sm">
            Every recorded sales call, video and phone, newest first. Open any
            call to ask Vince to review it.
          </p>
        </div>
        <Segmented
          label="Show"
          value={tab}
          options={[
            ["calls", "Calls"],
            ["reviews", "Vince's reviews"],
            ["aziz", "Aziz's reviews"],
          ]}
          onChange={k => set({ tab: k === "calls" ? null : k, page: null })}
        />
      </header>

      {tab === "calls" ? (
        <Calls params={params} set={set} reps={reps.data ?? []} />
      ) : tab === "reviews" ? (
        <Reviews me={me} params={params} set={set} reps={reps.data ?? []} />
      ) : (
        <AzizReviews me={me} />
      )}

      <SourceNote label="Where these calls come from">
        Video calls come from Fathom and phone calls from Maqsam (every answered
        call with a transcript since January, setters and closers). A video call
        belongs to a lead when an invitee's email is the lead's, or when that
        lead's intro or demo began within 30 minutes of it; a phone call belongs
        to the lead whose number matches. Reviews are Vince's: the ones he wrote
        before he stopped in August, and the ones drafted since with his
        template and framework.
      </SourceNote>
    </main>
  );
}

type RepList = NonNullable<ReturnType<typeof useReps>["data"]>;

function Calls({
  params,
  set,
  reps,
}: {
  params: URLSearchParams;
  set: (p: Record<string, string | null>) => void;
  reps: RepList;
}) {
  const by = params.get("by") ?? "";
  const kind = (params.get("kind") ?? "") as "" | "video" | "phone";
  const rep = reps.find(r => r.id === by) ?? null;
  const addresses = rep
    ? [rep.fathom_email, rep.maqsam_email]
        .filter((x): x is string => Boolean(x))
        .map(x => x.toLowerCase())
    : [];
  const page = Math.max(0, Number(params.get("page") ?? 1) - 1) || 0;
  const [text, setText] = useState(params.get("q") ?? "");
  useEffect(() => {
    const t = window.setTimeout(() => {
      if ((params.get("q") ?? "") !== text.trim())
        set({ q: text.trim() || null, page: null });
    }, 300);
    return () => window.clearTimeout(t);
  }, [text, params, set]);

  const calls = useRecordings({
    q: params.get("q") ?? "",
    by: addresses,
    kind,
    page,
  });
  const rows = calls.data ?? [];
  const reviews = useReviews({ recordingIds: rows.map(r => r.recording_id) });
  const asks = useReviewAsks(rows.map(r => r.recording_id));
  const askOf = useMemo(() => {
    const m = new Map<string, ReviewAsk>();
    for (const a of asks.data ?? [])
      if (!m.has(a.recording_id)) m.set(a.recording_id, a);
    return m;
  }, [asks.data]);
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
  const recorders = reps.filter(r => r.fathom_email || r.maqsam_email);

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
            <option key={r.id} value={r.id}>
              {r.display_name}
            </option>
          ))}
        </select>
        <select
          aria-label="Video or phone"
          value={kind}
          onChange={e => set({ kind: e.target.value || null, page: null })}
          className={`${field} sm:w-40`}
        >
          <option value="">Video and phone</option>
          <option value="video">Video calls</option>
          <option value="phone">Phone calls</option>
        </select>
      </div>

      {calls.error ? (
        <Failed what="The calls" error={calls.error} retry={calls.reload} />
      ) : calls.loading && !rows.length ? (
        <p className="muted text-sm">Reading the calls…</p>
      ) : !rows.length ? (
        <section className="panel">
          <EmptyState
            icon={Mic}
            title="No calls here"
            text={
              by || kind || params.get("q")
                ? "Nothing matches. Clear the search or pick everyone's calls."
                : "Recorded sales calls appear here within half an hour of Fathom or Maqsam having them."
            }
          />
        </section>
      ) : (
        <ul className="panel divide-y hairline overflow-hidden">
          {rows.map(r => (
            <CallRow
              key={r.recording_id}
              r={r}
              review={reviewOf.get(r.recording_id)}
              ask={askOf.get(r.recording_id)}
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
  ask,
  lead,
}: {
  r: Recording;
  review?: Review;
  ask?: ReviewAsk;
  lead?: string | null;
}) {
  const asked = ask && (ask.state === "queued" || ask.state === "reviewing");
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
        {r.source === "maqsam" ? (
          <Phone className="muted size-3.5 shrink-0" aria-label="Phone call" />
        ) : (
          <Video className="muted size-3.5 shrink-0" aria-label="Video call" />
        )}
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
          {review ? (
            <GradeChip r={review} />
          ) : asked ? (
            <StatusChip tone="neutral" label="Review asked" />
          ) : null}
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
        <section className="panel">
          <EmptyState
            icon={Mic}
            title="No reviews yet"
            text="Vince reviews each new recorded call within the hour of it reaching the cockpit."
          />
        </section>
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

/** Aziz's own call reviews, from Skool or written here, for the whole team. */
function AzizReviews({ me }: { me: Me }) {
  const reviews = useCoachReviews({ all: true });
  const [adding, setAdding] = useState(false);
  return (
    <section className="panel space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="muted text-sm">
          Aziz's own reviews of calls, the ones on Skool and any written here.
          Read the ones meant for you first.
        </p>
        {me.manager && !adding ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className={button}
          >
            <Plus className="size-3.5" aria-hidden /> Add a review
          </button>
        ) : null}
      </div>
      {adding ? (
        <CoachReviewForm
          me={me}
          onDone={() => {
            setAdding(false);
            reviews.reload();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : null}
      {reviews.error ? (
        <Failed
          what="Aziz's reviews"
          error={reviews.error}
          retry={reviews.reload}
        />
      ) : reviews.loading && !reviews.data ? (
        <p className="muted text-sm">Reading the reviews…</p>
      ) : (
        <CoachReviewList
          me={me}
          reviews={[...(reviews.data ?? [])].sort(
            (a, b) =>
              Number(b.for_email === me.email) -
              Number(a.for_email === me.email),
          )}
          onChange={reviews.reload}
        />
      )}
    </section>
  );
}
