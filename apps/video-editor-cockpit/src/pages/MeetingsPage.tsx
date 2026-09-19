import { CalendarDays, ExternalLink } from "lucide-react";
import { useMemo } from "react";
import { Empty, Fold, Problem, Prose, Spinner } from "../components/bits";
import { useMeetings } from "../lib/data";
import { moment } from "../lib/format";

/**
 * Team meetings, from Fathom.
 *
 * Only the ones you were on the invite for. That is decided in Postgres, not
 * here: an internal call can carry pay, performance or a disagreement about
 * somebody, so being on the editor list is not a reason to read a meeting
 * you were not in. Admins see all of them.
 */
function minutesBetween(a: string | null, b: string | null): string {
  if (!a || !b) return "";
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return `${Math.round(ms / 60_000)} min`;
}

export default function MeetingsPage() {
  const meetings = useMeetings();

  const mine = useMemo(() => meetings.data ?? [], [meetings.data]);
  const actions = useMemo(
    () =>
      mine.flatMap(m =>
        (m.action_items ?? []).map(a => ({ ...a, from: m.title })),
      ),
    [mine],
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Meetings</h1>
        <p className="muted mt-1 text-sm">
          The team meetings you were on, recorded by Fathom. Client calls are
          not here.
        </p>
      </header>

      {meetings.error && (
        <Problem>These could not be read: {meetings.error}</Problem>
      )}
      {meetings.loading && <Spinner what="Reading the meetings" />}
      {!meetings.loading && !mine.length && (
        <Empty>No team meetings you were on in the last few weeks.</Empty>
      )}

      {actions.length ? (
        <section className="panel mb-5 overflow-hidden">
          <header className="border-b hairline px-4 py-2.5">
            <h2 className="text-sm font-semibold tracking-tight">
              What came out of them
            </h2>
          </header>
          <ul className="divide-y divide-[color:var(--border)]">
            {actions.slice(0, 12).map(a => (
              <li
                key={`${a.from}-${a.text}`}
                className="flex gap-3 px-4 py-2.5 text-sm"
              >
                <span
                  aria-hidden
                  className="mt-1.5 size-1.5 shrink-0 rounded-full"
                  style={{ background: "var(--primary)" }}
                />
                <span dir="auto" className="rtl-safe min-w-0 flex-1">
                  {a.text}
                </span>
                {a.for ? (
                  <span className="muted shrink-0 text-xs">{a.for}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ul className="space-y-3">
        {mine.map(m => (
          <li key={m.recording_id} className="panel overflow-hidden">
            <div className="flex flex-wrap items-start gap-3 px-4 py-3">
              <CalendarDays
                className="mt-0.5 size-4 shrink-0"
                strokeWidth={1.75}
                style={{ color: "var(--primary)" }}
              />
              <div className="min-w-0 flex-1">
                <p dir="auto" className="text-sm font-medium">
                  {m.title || "Untitled meeting"}
                </p>
                <p className="muted mt-0.5 text-xs">
                  {moment(m.started_at)}
                  {minutesBetween(m.started_at, m.ended_at)
                    ? ` · ${minutesBetween(m.started_at, m.ended_at)}`
                    : ""}
                  {m.host ? ` · recorded by ${m.host}` : ""}
                </p>
                {m.invitees?.length ? (
                  <p className="muted mt-1 truncate text-xs">
                    {m.invitees.map(i => i.name || i.email).join(", ")}
                  </p>
                ) : null}
              </div>
              {m.share_url || m.url ? (
                <a
                  href={m.share_url ?? m.url ?? ""}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex shrink-0 items-center gap-1 text-xs text-[color:var(--primary)] underline underline-offset-2"
                >
                  Watch
                  <ExternalLink className="size-3" strokeWidth={2} />
                </a>
              ) : null}
            </div>

            {m.summary_md ? (
              <div className="px-4 pb-1">
                <Fold title="Summary">
                  <Prose text={m.summary_md} />
                </Fold>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
