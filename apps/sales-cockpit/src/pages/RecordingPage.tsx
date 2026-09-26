import { ArrowLeft, ExternalLink, Plus, Search } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { CoachReviewForm, CoachReviewList } from "../components/CoachReviews";
import {
  button,
  EmptyState,
  Failed,
  field,
  SectionCard,
} from "../components/kit";
import { Prose } from "../components/Prose";
import { ReviewAsk } from "../components/ReviewAsk";
import { ReviewCard } from "../components/ReviewCard";
import {
  loadTranscript,
  useCoachReviews,
  useLead,
  useQuery,
  useRecording,
  useReviews,
} from "../lib/data";
import { clock, day, duration } from "../lib/format";
import { supabase } from "../lib/supabase";
import type { Me, Recording, Review } from "../lib/types";

/**
 * One recorded call: Vince's review (or the button to ask for one), Aziz's
 * own review when he has written one, the summary and the transcript.
 */
export default function RecordingPage({ me }: { me: Me }) {
  const { id = "" } = useParams();
  const rec = useRecording(id);
  const reviews = useReviews({ recordingIds: id ? [id] : [] });
  const coach = useCoachReviews({ recordingId: id });
  const [adding, setAdding] = useState(false);
  const r = rec.data;
  const lead = useLead(r?.contact_id ?? "");

  if (rec.error)
    return (
      <Shell>
        <Failed what="This call" error={rec.error} retry={rec.reload} />
      </Shell>
    );
  if (!r)
    return (
      <Shell>
        {rec.loading ? (
          <p className="muted text-sm">Loading the call…</p>
        ) : (
          <EmptyState
            title="This call is not here"
            text="It may not have been copied from Fathom yet. Try again in half an hour."
          />
        )}
      </Shell>
    );

  const review = (reviews.data ?? [])[0];
  return (
    <Shell>
      <Link
        to={r.contact_id ? `/lead/${r.contact_id}` : "/recordings"}
        className="muted inline-flex items-center gap-1 text-sm hover:underline"
      >
        <ArrowLeft className="size-3.5" aria-hidden />{" "}
        {r.contact_id ? (lead.data?.name ?? "The lead") : "Recordings"}
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight" dir="auto">
            {r.title ?? "Untitled call"}
          </h1>
          <p className="muted text-sm">
            {[
              `${day(r.started_at)} ${clock(r.started_at)}`,
              duration(r.duration_s),
              r.recorded_by?.split("@")[0],
              r.language ? r.language.toUpperCase() : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {r.share_url ? (
            <a
              href={r.share_url}
              target="_blank"
              rel="noreferrer noopener"
              className={button}
            >
              <ExternalLink className="size-3.5" aria-hidden /> Watch in Fathom
            </a>
          ) : null}
          {r.contact_id ? (
            <Link to={`/lead/${r.contact_id}`} className={button}>
              Open the lead
            </Link>
          ) : null}
        </div>
      </header>

      <SectionCard title="Vince's review">
        {reviews.error ? (
          <Failed
            what="The review"
            error={reviews.error}
            retry={reviews.reload}
          />
        ) : (
          <div className="space-y-4">
            {review ? <ReviewCard r={review} /> : null}
            {!review && r.transcript_path ? (
              <p className="muted text-sm">
                Not reviewed yet. Vince reviews new calls on his own; ask for
                this one and it is done within a few minutes.
              </p>
            ) : null}
            <ReviewAsk
              me={me}
              recordingId={r.recording_id}
              hasTranscript={Boolean(r.transcript_path)}
              reviewed={Boolean(review)}
              onReviewed={reviews.reload}
            />
          </div>
        )}
      </SectionCard>

      {(coach.data ?? []).length || me.manager ? (
        <SectionCard
          title="Aziz's review"
          side={
            me.manager && !adding ? (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="muted inline-flex items-center gap-1 text-xs hover:underline"
              >
                <Plus className="size-3" aria-hidden /> Add your review
              </button>
            ) : null
          }
        >
          <div className="space-y-4">
            {adding ? (
              <CoachReviewForm
                me={me}
                recordingId={r.recording_id}
                contactId={r.contact_id}
                onDone={() => {
                  setAdding(false);
                  coach.reload();
                }}
                onCancel={() => setAdding(false)}
              />
            ) : null}
            {coach.error ? (
              <Failed
                what="Aziz's reviews"
                error={coach.error}
                retry={coach.reload}
              />
            ) : (
              <CoachReviewList
                me={me}
                reviews={coach.data ?? []}
                onChange={coach.reload}
                showCall={false}
              />
            )}
          </div>
        </SectionCard>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="Fathom's summary">
          {r.summary ? (
            <Prose text={r.summary} />
          ) : (
            <p className="muted text-sm">
              Fathom wrote no summary of this call.
            </p>
          )}
        </SectionCard>
        <SectionCard title="Action items">
          {r.action_items ? (
            <Prose text={r.action_items} />
          ) : (
            <p className="muted text-sm">No action items on this call.</p>
          )}
          {r.people?.length ? (
            <div className="mt-4 border-t hairline pt-3">
              <p className="muted mb-1 text-xs">On the invite</p>
              <ul className="space-y-0.5 text-sm">
                {r.people.map(p => (
                  <li key={`${p.name}|${p.email}`} dir="auto">
                    {p.name || p.email}
                    {p.name && p.email ? (
                      <span className="muted"> · {p.email}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </SectionCard>
      </div>

      <Transcript r={r} />
    </Shell>
  );
}

/** A review that never had a recording (Vince read some from Google Docs). */
export function ReviewOnlyPage() {
  const { id = "" } = useParams();
  const review = useQuery<Review>(
    () =>
      supabase
        .from("cockpit_sales_reviews")
        .select("*")
        .eq("id", id)
        .maybeSingle(),
    [id],
  );
  const r = review.data;
  return (
    <Shell>
      <Link
        to="/recordings?tab=reviews"
        className="muted inline-flex items-center gap-1 text-sm hover:underline"
      >
        <ArrowLeft className="size-3.5" aria-hidden /> Vince's reviews
      </Link>
      {review.error ? (
        <Failed what="This review" error={review.error} retry={review.reload} />
      ) : !r ? (
        <p className="muted text-sm">
          {review.loading ? "Loading the review…" : "This review is not here."}
        </p>
      ) : (
        <>
          <h1 className="text-xl font-semibold tracking-tight" dir="auto">
            {r.lead_name ?? "A lead"}
          </h1>
          <p className="muted text-sm">
            Vince read this call from a document, so there is no recording in
            the cockpit to go with it.
            {r.contact_id ? (
              <>
                {" "}
                <Link
                  to={`/lead/${r.contact_id}`}
                  className="underline underline-offset-2"
                >
                  Open the lead
                </Link>
                .
              </>
            ) : null}
          </p>
          <SectionCard title="Vince's review">
            <ReviewCard r={r} />
          </SectionCard>
        </>
      )}
    </Shell>
  );
}

function Transcript({ r }: { r: Recording }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [find, setFind] = useState("");

  const lines = useMemo(() => {
    if (!text) return [];
    return text
      .split("\n")
      .map(l => {
        const m = /^\*\*(.+?)\*\*\s*\(([\d:]+)\):\s*(.*)$/.exec(l.trim());
        return m
          ? { who: m[1], at: m[2], say: m[3] }
          : { who: "", at: "", say: l.trim() };
      })
      .filter(l => l.say);
  }, [text]);
  const shown = find.trim()
    ? lines.filter(l =>
        `${l.who} ${l.say}`.toLowerCase().includes(find.trim().toLowerCase()),
      )
    : lines;

  async function open() {
    if (!r.transcript_path) return;
    setBusy(true);
    setError(null);
    try {
      setText(await loadTranscript(r.transcript_path));
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard
      title="Transcript"
      side={
        r.transcript_chars ? (
          <span className="muted text-xs">
            {Math.round(r.transcript_chars / 1000)}k characters
          </span>
        ) : undefined
      }
    >
      {!r.transcript_path ? (
        <p className="muted text-sm">No transcript came with this call.</p>
      ) : error ? (
        <Failed what="The transcript" error={error} retry={open} />
      ) : text === null ? (
        <button type="button" onClick={open} disabled={busy} className={button}>
          {busy ? "Opening…" : "Show the transcript"}
        </button>
      ) : (
        <div className="space-y-3">
          <label className="relative block">
            <span className="sr-only">Find in the transcript</span>
            <Search
              className="muted pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              aria-hidden
            />
            <input
              value={find}
              onChange={e => setFind(e.target.value)}
              placeholder="Find a word or a name"
              className={`${field} pl-9`}
              dir="auto"
            />
          </label>
          <p className="muted text-xs">
            {find.trim()
              ? `${shown.length} of ${lines.length} lines`
              : `${lines.length} lines`}
          </p>
          <ol className="max-h-[70vh] space-y-2 overflow-y-auto pe-2">
            {shown.map((l, i) => (
              <li
                key={`${l.at}|${String(i)}`}
                className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 text-sm"
              >
                <span className="muted text-xs tabular-nums">{l.at}</span>
                <p dir="auto">
                  {l.who ? (
                    <span className="font-medium">{l.who}: </span>
                  ) : null}
                  {l.say}
                </p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </SectionCard>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6 md:px-6">
      {children}
    </main>
  );
}
