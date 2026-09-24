import {
  ArrowRight,
  CalendarCheck2,
  MessageCircleReply,
  PhoneIncoming,
  TriangleAlert,
} from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router";
import { DayLine } from "../components/DayLine";
import {
  EmptyState,
  Failed,
  Parts,
  SectionCard,
  StatTile,
  StatusChip,
} from "../components/kit";
import { MarkControls } from "../components/MarkControls";
import { type ScopeView, useScope } from "../components/Scope";
import {
  useCalendar,
  useLeadsById,
  useMirrorRun,
  useNewLeads,
  useNow,
  useOwed,
  usePeople,
  useReplies,
  useScoreRows,
} from "../lib/data";
import {
  ago,
  callType,
  classLabel,
  clock,
  count,
  dayLabel,
  kuwaitDay,
  kuwaitMidnight,
  money,
  when,
} from "../lib/format";
import type { CalendarRow, InboxRow, Lead, Me } from "../lib/types";

/** The rep's day: where they are, what they owe, what comes next. */
export default function TodayPage({ me }: { me: Me }) {
  const now = useNow();
  const { scope, view, ScopeSwitch } = useScope(me, { people: true });
  const mine = view.ghl;

  const today = kuwaitDay(now);
  const dayStart = kuwaitMidnight(today).toISOString();
  const dayEnd = new Date(Date.parse(dayStart) + 86_400_000).toISOString();
  const soonEnd = new Date(now + 36 * 3_600_000).toISOString();

  const todays = useCalendar(dayStart, dayEnd, mine);
  const coming = useCalendar(new Date(now).toISOString(), soonEnd, mine);
  const owed = useOwed(mine);
  const newLeads = useNewLeads(48);
  const replies = useReplies(48);
  const mirror = useMirrorRun();

  const upcoming = (coming.data ?? [])
    .filter(r => r.status !== "cancelled")
    .slice(0, 12);
  const leadIds = upcoming
    .map(r => r.contact_id)
    .filter((x): x is string => Boolean(x));
  const briefs = useLeadsById(leadIds);
  const byId = useMemo(
    () => new Map((briefs.data ?? []).map(l => [l.contact_id, l])),
    [briefs.data],
  );

  const unlinked = view.kind === "mine" && !me.ghl_user_id;
  const dateLine = new Date(now).toLocaleDateString("en-GB", {
    timeZone: "Asia/Kuwait",
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <main className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 md:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{dateLine}</h1>
          <MirrorLine run={mirror.data} error={mirror.error} now={now} />
        </div>
        {ScopeSwitch}
      </header>

      {unlinked ? (
        <div className="callout-warn rounded-[var(--radius-md)] border px-3 py-2 text-sm">
          Your seat is not linked to your HighLevel user yet, so the cockpit
          cannot tell which calls are yours. Ask Aziz to link it on the Team
          page.
        </div>
      ) : null}

      <section aria-label="Your day" className="panel p-4">
        {todays.error ? (
          <Failed
            what="Today's calls"
            error={todays.error}
            retry={todays.reload}
          />
        ) : (
          <DayLine rows={todays.data ?? []} now={now} />
        )}
        {!todays.loading && !todays.error && !(todays.data ?? []).length ? (
          <p className="muted mt-3 text-sm">
            No calls on the calendar today
            {view.kind === "team" ? "" : ` for ${view.label}`}.
          </p>
        ) : null}
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="min-w-0 space-y-5 lg:col-span-7">
          <OwedCard
            rows={owed.data}
            error={owed.error}
            reload={owed.reload}
            team={scope === "team"}
          />
          <WeekCard me={me} view={view} />
        </div>
        <div className="min-w-0 space-y-5 lg:col-span-5">
          <SectionCard
            title="Coming up"
            side={<span className="muted text-xs">next 36 hours</span>}
            flush
          >
            {coming.error ? (
              <div className="p-4">
                <Failed
                  what="The calendar"
                  error={coming.error}
                  retry={coming.reload}
                />
              </div>
            ) : upcoming.length ? (
              <ul className="divide-y hairline">
                {upcoming.map(r => (
                  <UpcomingRow
                    key={r.appointment_id}
                    r={r}
                    lead={byId.get(r.contact_id ?? "")}
                    team={scope === "team"}
                  />
                ))}
              </ul>
            ) : (
              <EmptyState
                compact
                icon={CalendarCheck2}
                title="Nothing booked in the next 36 hours"
                text="New bookings appear here within a few minutes of being made in HighLevel."
              />
            )}
          </SectionCard>
          <RepliesCard rows={replies.data} error={replies.error} now={now} />
          <NewLeadsCard
            leads={newLeads.data}
            error={newLeads.error}
            now={now}
          />
        </div>
      </div>
    </main>
  );
}

function MirrorLine({
  run,
  error,
  now,
}: {
  run: {
    finished_at: string | null;
    ok: boolean | null;
    error: string | null;
  } | null;
  error: string | null;
  now: number;
}) {
  if (error)
    return (
      <p className="muted text-sm">
        Could not tell when the calls were last read: {error}
      </p>
    );
  if (!run?.finished_at)
    return (
      <p className="muted text-sm">Waiting for the first read of the CRM.</p>
    );
  const age = now - Date.parse(run.finished_at);
  const stale = age > 20 * 60_000;
  return (
    <p className="muted flex flex-wrap items-center gap-2 text-sm">
      Calls and leads as of {ago(run.finished_at, now)}
      {run.ok === false || stale ? (
        <StatusChip
          tone="warning"
          label={stale ? "The CRM copy is late" : "The last read had a problem"}
          title={run.error ?? "The copy from B2B runs every three minutes."}
        />
      ) : null}
    </p>
  );
}

function OwedCard({
  rows,
  error,
  reload,
  team,
}: {
  rows: CalendarRow[] | null;
  error: string | null;
  reload: () => void;
  team: boolean;
}) {
  const list = rows ?? [];
  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-2">
          Mark these calls
          {list.length ? (
            <span
              className="rounded-full px-1.5 text-[11px] font-semibold tabular-nums"
              style={{ background: "var(--owed)", color: "#1b1300" }}
            >
              {list.length}
            </span>
          ) : null}
        </span>
      }
      side={
        <Link
          to="/calendar?view=owed"
          className="muted inline-flex items-center gap-1 text-xs hover:underline"
        >
          All owed <ArrowRight className="size-3" aria-hidden />
        </Link>
      }
      flush
    >
      {error ? (
        <div className="p-4">
          <Failed what="The calls to mark" error={error} retry={reload} />
        </div>
      ) : list.length ? (
        <>
          <p className="muted border-b hairline px-4 py-2 text-xs">
            A call nobody marks counts as shown in every show rate. Mark each
            one as soon as it ends.
          </p>
          <ul className="divide-y hairline">
            {list.slice(0, 15).map(r => (
              <li
                key={r.appointment_id}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/lead/${r.contact_id ?? ""}`}
                    className="block truncate text-sm font-medium hover:underline"
                    dir="auto"
                  >
                    {r.contact_name ?? "A lead"}
                  </Link>
                  <p className="muted text-xs">
                    {callType(r.call_type)} · {when(r.start_at)}
                    {team && r.assigned_user_name
                      ? ` · ${r.assigned_user_name}`
                      : ""}
                  </p>
                </div>
                <MarkControls row={r} onDone={() => reload()} compact />
              </li>
            ))}
          </ul>
          {list.length > 15 ? (
            <p className="muted border-t hairline px-4 py-2 text-xs">
              {list.length - 15} more on the Calendar.
            </p>
          ) : null}
        </>
      ) : (
        <EmptyState
          compact
          icon={CalendarCheck2}
          title="Every call is marked"
          text="Past intros and demos from the last 30 days all have an outcome."
        />
      )}
    </SectionCard>
  );
}

function UpcomingRow({
  r,
  lead,
  team,
}: {
  r: CalendarRow;
  lead?: Lead;
  team: boolean;
}) {
  const brief = lead ? [lead.revenue, lead.readiness, lead.challenge] : [];
  return (
    <li>
      <Link
        to={`/lead/${r.contact_id ?? ""}`}
        className="flex gap-3 px-4 py-3 hover:bg-[color:var(--secondary)]"
      >
        <div className="w-14 shrink-0 text-right">
          <p className="tabular-nums text-sm font-semibold">
            {clock(r.start_at)}
          </p>
          <p className="muted text-[11px]">{dayLabel(r.start_at)}</p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" dir="auto">
            {r.contact_name ?? "A lead"}
          </p>
          <p className="muted text-xs">
            {callType(r.call_type)}
            {lead?.lead_class ? ` · ${classLabel(lead.lead_class)}` : ""}
            {team && r.assigned_user_name ? ` · ${r.assigned_user_name}` : ""}
          </p>
          {brief.some(Boolean) ? (
            <p className="muted mt-0.5 line-clamp-2 text-xs">
              <Parts items={brief} />
            </p>
          ) : null}
        </div>
      </Link>
    </li>
  );
}

function NewLeadsCard({
  leads,
  error,
  now,
}: {
  leads: Lead[] | null;
  error: string | null;
  now: number;
}) {
  const list = (leads ?? []).filter(l => l.is_lead !== false);
  return (
    <SectionCard
      title="New leads"
      side={<span className="muted text-xs">last 48 hours</span>}
      flush
    >
      {error ? (
        <div className="p-4">
          <Failed what="New leads" error={error} />
        </div>
      ) : list.length ? (
        <ul className="divide-y hairline">
          {list.slice(0, 10).map(l => (
            <li key={l.contact_id}>
              <Link
                to={`/lead/${l.contact_id}`}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-[color:var(--secondary)]"
              >
                <PhoneIncoming className="muted size-4 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" dir="auto">
                    {l.name ?? "Unnamed lead"}
                  </p>
                  <p className="muted text-xs">
                    {classLabel(l.lead_class)} · {ago(l.lead_created_at, now)}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          compact
          title="No new leads in the last two days"
          text="Leads land here within a few minutes of filling the form. The ads have been paused since 9 September."
        />
      )}
    </SectionCard>
  );
}

/** This week against the weekly goal, from B2B's scorecard. */
function WeekCard({ me, view }: { me: Me; view: ScopeView }) {
  const week = useScoreRows("week");
  const people = usePeople();
  const theirRow = (week.data ?? []).find(r => r.person_key === view.repId);
  const rows =
    view.kind === "team" ? (week.data ?? []) : theirRow ? [theirRow] : [];
  const sum = (
    k: "calls_scheduled" | "calls_shown" | "closes" | "cash_collected",
  ) =>
    rows.length ? rows.reduce((a, r) => a + Number(r.row[k] ?? 0), 0) : null;
  const goals =
    view.kind === "mine"
      ? (people.data ?? []).find(p => p.email === me.email)?.goals?.weekly
      : view.kind === "person"
        ? (people.data ?? []).find(p => p.b2b_rep_id === view.repId)?.goals
            ?.weekly
        : undefined;
  const pace = (actual: number | null, goal?: number) => {
    if (actual === null || !goal) return undefined;
    return actual >= goal ? (
      <StatusChip tone="good" label="Goal met" />
    ) : (
      <span className="muted text-xs">goal {goal.toLocaleString("en-US")}</span>
    );
  };
  if (week.error)
    return (
      <SectionCard title="This week">
        <Failed
          what="This week's numbers"
          error={week.error}
          retry={week.reload}
        />
      </SectionCard>
    );
  if (view.kind === "mine" && !me.b2b_rep_id)
    return (
      <SectionCard title="This week">
        <EmptyState
          compact
          icon={TriangleAlert}
          title="Your numbers are not linked yet"
          text="Once Aziz links your seat to your HighLevel user, your calls and closes show here."
        />
      </SectionCard>
    );
  return (
    <SectionCard
      title="This week"
      side={
        <Link
          to="/numbers"
          className="muted inline-flex items-center gap-1 text-xs hover:underline"
        >
          Numbers <ArrowRight className="size-3" aria-hidden />
        </Link>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Booked"
          value={count(sum("calls_scheduled"))}
          status={pace(sum("calls_scheduled"), goals?.booked)}
        />
        <StatTile
          label="Shown"
          value={count(sum("calls_shown"))}
          status={pace(sum("calls_shown"), goals?.shown)}
        />
        <StatTile
          label="Closes"
          value={count(sum("closes"))}
          status={pace(sum("closes"), goals?.closes)}
        />
        <StatTile
          label="Cash collected"
          value={money(sum("cash_collected"))}
          status={pace(sum("cash_collected"), goals?.cash)}
        />
      </div>
      <p className="muted mt-3 text-xs">
        Saturday to today, from the same rep scorecard the CEO cockpit reads. A
        call nobody marked counts as shown until it is marked.
      </p>
    </SectionCard>
  );
}

const CHANNEL_WORDS: [RegExp, string][] = [
  [/WHATSAPP/i, "WhatsApp"],
  [/EMAIL/i, "Email"],
  [/SMS/i, "SMS"],
  [/FACEBOOK/i, "Facebook"],
  [/INSTAGRAM/i, "Instagram"],
];

/** Leads who wrote back and are waiting on us. */
function RepliesCard({
  rows,
  error,
  now,
}: {
  rows: InboxRow[] | null;
  error: string | null;
  now: number;
}) {
  const list = rows ?? [];
  return (
    <SectionCard
      title="Replies waiting"
      side={<span className="muted text-xs">last 48 hours</span>}
      flush
    >
      {error ? (
        <div className="p-4">
          <Failed what="Replies" error={error} />
        </div>
      ) : list.length ? (
        <ul className="divide-y hairline">
          {list.slice(0, 8).map(r => (
            <li key={r.conversation_id}>
              <Link
                to={r.contact_id ? `/lead/${r.contact_id}` : "/leads"}
                className="flex gap-3 px-4 py-2.5 hover:bg-[color:var(--secondary)]"
              >
                <MessageCircleReply
                  className="muted mt-0.5 size-4 shrink-0"
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" dir="auto">
                    {r.contact_name ?? "A lead"}
                  </p>
                  <p className="muted text-xs">
                    {CHANNEL_WORDS.find(([re]) =>
                      re.test(String(r.last_type)),
                    )?.[1] ?? "Message"}{" "}
                    · {ago(r.last_message_at, now)}
                    {r.unread ? ` · ${r.unread} unread` : ""}
                  </p>
                  {r.last_body ? (
                    <p className="muted mt-0.5 line-clamp-2 text-xs" dir="auto">
                      {r.last_body}
                    </p>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          compact
          icon={MessageCircleReply}
          title="Nobody is waiting on a reply"
          text="When a lead writes back on WhatsApp, email or text it shows here within three minutes."
        />
      )}
    </SectionCard>
  );
}
