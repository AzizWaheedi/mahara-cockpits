import { useMemo, useState } from "react";
import {
  Empty,
  Fold,
  Out,
  Page,
  PageHeader,
  Problem,
  Prose,
  Spinner,
} from "../components/bits";
import { Button } from "../components/ui/button";
import { useMeetings } from "../lib/data";
import { moment } from "../lib/format";

/**
 * Team meetings, from Fathom.
 *
 * Only the ones you were on the invite for. That is decided in Postgres, not
 * here: an internal call can carry pay, performance or a disagreement about
 * somebody, so being on the editor list is not a reason to read a meeting
 * you were not in. Admins see all of them.
 *
 * The last two weeks first; older ones are one tap away, not sixty cards
 * down the page.
 */
const RECENT_DAYS = 14;

function minutesBetween(a: string | null, b: string | null): string {
  if (!a || !b) return "";
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return `${Math.round(ms / 60_000)} min`;
}

export default function MeetingsPage() {
  const meetings = useMeetings();
  const [showOlder, setShowOlder] = useState(false);

  const mine = useMemo(() => meetings.data ?? [], [meetings.data]);
  const cutoff = useMemo(() => Date.now() - RECENT_DAYS * 86_400_000, []);
  const recent = useMemo(
    () =>
      mine.filter(
        m => m.started_at && new Date(m.started_at).getTime() >= cutoff,
      ),
    [mine, cutoff],
  );
  const shown = showOlder ? mine : recent;
  const older = mine.length - recent.length;

  // What came out of the meetings on screen, so the list and the actions
  // above it cover the same stretch of time.
  const actions = useMemo(
    () =>
      shown.flatMap(m =>
        (m.action_items ?? []).map(a => ({ ...a, from: m.title })),
      ),
    [shown],
  );

  return (
    <Page>
      <PageHeader
        title="Meetings"
        sub="The team meetings you were on, recorded by Fathom. Client calls are not here."
      />

      {meetings.error && (
        <Problem>These could not be read: {meetings.error}</Problem>
      )}
      {meetings.loading && <Spinner what="Reading the meetings" />}
      {!meetings.loading && !mine.length && (
        <Empty>No team meetings you were on in the last few weeks.</Empty>
      )}

      <div className="space-y-4 sm:space-y-6">
        {actions.length ? (
          <section className="overflow-hidden rounded-2xl border bg-card">
            <h2 className="border-b px-4 py-3 text-[15px] font-semibold tracking-tight sm:px-6">
              What came out of them
            </h2>
            <ul className="divide-y">
              {actions.slice(0, 12).map(a => (
                <li
                  key={`${a.from}-${a.text}`}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 text-sm sm:px-6"
                >
                  <span dir="auto" className="rtl-safe min-w-0 flex-1">
                    {a.text}
                  </span>
                  {a.for ? (
                    <span className="basis-full text-xs text-muted-foreground sm:basis-auto">
                      {a.for}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {!meetings.loading && mine.length && !shown.length ? (
          <Empty>No team meetings in the last {RECENT_DAYS} days.</Empty>
        ) : null}

        {shown.length ? (
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {shown.map(m => {
              const length = minutesBetween(m.started_at, m.ended_at);
              return (
                <li key={m.recording_id} className="px-4 py-3 sm:px-6">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <p
                      dir="auto"
                      className="min-w-0 flex-1 text-sm font-medium"
                    >
                      {m.title || "Untitled meeting"}
                    </p>
                    {m.share_url || m.url ? (
                      <span className="text-xs font-medium">
                        <Out href={m.share_url ?? m.url}>Watch</Out>
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {moment(m.started_at)}
                    {length ? ` · ${length}` : ""}
                    {m.host ? ` · recorded by ${m.host}` : ""}
                  </p>
                  {m.summary_md ? (
                    <div className="mt-1">
                      <Fold title="Summary">
                        <Prose text={m.summary_md} />
                      </Fold>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}

        {older > 0 ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowOlder(o => !o)}
          >
            {showOlder
              ? `Only the last ${RECENT_DAYS} days`
              : `Show older (${older})`}
          </Button>
        ) : null}
      </div>
    </Page>
  );
}
