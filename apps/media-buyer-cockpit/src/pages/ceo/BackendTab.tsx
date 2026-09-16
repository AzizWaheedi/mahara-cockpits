import {
  CircleCheck,
  ExternalLink,
  OctagonAlert,
  Rocket,
  ShieldCheck,
} from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { Delta } from "@/components/ceo/Delta";
import { EmptyState } from "@/components/ceo/EmptyState";
import {
  capitalize,
  change,
  count,
  date,
  dateTime,
  diff,
  isNum,
  kuwaitDay,
  minutes,
  money,
  pct,
  plural,
} from "@/components/ceo/format";
import { churnHeadline, highRiskCount } from "@/components/ceo/metrics";
import { Na } from "@/components/ceo/Na";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatTile } from "@/components/ceo/StatTile";
import {
  gateLabel,
  gateTone,
  STATUS_COLOR,
  StatusChip,
  type StatusTone,
} from "@/components/ceo/StatusChip";
import { TabLink } from "@/components/ceo/TabLink";
import type { CeoSections } from "@/components/ceo/useCeo";
import { cn } from "@/lib/utils";
import type {
  CallsPayload,
  ClientRow,
  ClientsPayload,
  DeliveryPayload,
  Note,
} from "../../../convex/ceo/payloads";
import type { CeoTabProps } from "./types";

type GoTab = CeoTabProps["goTab"];

/**
 * The first call to a new lead should land within this many minutes. This is
 * the cockpit's own target, not one Aziz has set, so anything it colours says
 * so on screen.
 */
const SPEED_TARGET_MIN = 5;

// --- Notes ----------------------------------------------------------------

// Every delivery note lands on one of the two delivery cards, so no caveat is
// dropped on the way to this rollup.
const STUCK_NOTE = /launch|ad account|no Ads Management card|no board card/i;

/** The call notes a reader needs in order to read these headline numbers. */
const CALL_NOTE = /dials and connections|speed to lead|maqsam accounts/i;

/** The clients note that spells out the risk point rules. */
const CLIENT_NOTE = /risk points/i;

/** Warnings always, plus the info notes that qualify a number on this card. */
function keepNotes(notes: Note[] | null | undefined, keep: RegExp): Note[] {
  return (notes ?? []).filter(n => n.level === "warn" || keep.test(n.text));
}

function routeDeliveryNotes(notes: Note[] | null | undefined) {
  const all = notes ?? [];
  return {
    stuck: all.filter(n => STUCK_NOTE.test(n.text)),
    media: all.filter(n => !STUCK_NOTE.test(n.text)),
  };
}

// --- Shared bits ----------------------------------------------------------

/** A cost against its gate. The gates are plan defaults, which the note says. */
function gateChip(
  value: number | null | undefined,
  gate: number,
  noun: string,
) {
  const tone = gateTone(value, gate);
  if (tone === "neutral") return undefined;
  return (
    <StatusChip
      tone={tone}
      label={gateLabel(tone, gate)}
      hint={`${noun} ${money(value)} against the ${money(gate)} gate, a plan default until the official gates are set.`}
    />
  );
}

/** Talk time reads in hours past an hour; format.minutes turns 48 hours into days. */
function talk(v: number | null | undefined): string {
  if (!isNum(v)) return minutes(v);
  if (v === 0) return "0 min";
  if (v < 60) return minutes(v);
  const h = Math.floor(v / 60);
  const m = Math.round(v % 60);
  if (h >= 10) return `${count(Math.round(v / 60))} h`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** A block of tiles separated from the one above it. */
function TileRow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid min-w-0 grid-cols-2 gap-x-6 gap-y-5 @2xl:grid-cols-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Service delivery in one view: media buying, the call centre, client success. */
export function BackendTab({ sections, now, day, goTab }: CeoTabProps) {
  const today = day ?? kuwaitDay(now);
  const deliveryPayload = sections.delivery?.payload ?? null;
  const deliveryNotes = useMemo(
    () => routeDeliveryNotes(deliveryPayload?.notes),
    [deliveryPayload],
  );

  return (
    <div className="@container grid min-w-0 gap-4 lg:gap-6">
      <MediaBuyingCard
        section={sections.delivery}
        notes={deliveryNotes.media}
        goTab={goTab}
      />

      <div className="grid min-w-0 items-start gap-4 lg:gap-6 @4xl:grid-cols-2">
        <CallCentreCard
          section={sections.calls}
          now={now}
          today={today}
          goTab={goTab}
        />
        <ClientSuccessCard section={sections.clients} goTab={goTab} />
      </div>

      <StuckCard
        section={sections.delivery}
        notes={deliveryNotes.stuck}
        goTab={goTab}
      />

      <NotMeasuredCard />
    </div>
  );
}

// --- 1. Media buying ------------------------------------------------------

function MediaBuyingCard({
  section,
  notes,
  goTab,
}: {
  section: CeoSections["delivery"];
  notes: Note[];
  goTab: GoTab;
}) {
  const d = section?.payload ?? null;
  return (
    <SectionCard
      kicker="Media buying, month to date"
      title="Client ads"
      section={section}
      notes={notes}
      actions={
        <>
          {d
            ? gateChip(
                d.last7.cpl,
                d.gates.cpl,
                "Cost per lead over the last 7 days is",
              )
            : null}
          <TabLink tab="delivery" label="Delivery" goTab={goTab} />
        </>
      }
      order={0}
      bodyClassName="@container"
    >
      {p => <MediaBuyingBody d={p} />}
    </SectionCard>
  );
}

function MediaBuyingBody({ d }: { d: DeliveryPayload }) {
  const bad = d.clients.filter(c => c.status === "bad").length;
  const watch = d.clients.filter(c => c.status === "watch").length;
  const withSpend = d.clients.length;
  const spendLine = `of ${plural(withSpend, "client")} with spend in the last 7 days`;
  const vs = "vs the 7 days before";

  return (
    <div className="min-w-0 space-y-6">
      <TileRow className="@5xl:grid-cols-5">
        <StatTile
          variant="plain"
          label="Client ad spend"
          hint="Money spent on client ad accounts. Mahara's own lead-gen spend is a different pool and sits on the Marketing tab. The two are never added."
          value={money(d.mtd.spend)}
          delta={
            <Delta
              value={change(d.last7.spend, d.prevLast7.spend)}
              goodWhen="neither"
              vs={vs}
            />
          }
          sub={`${money(d.last7.spend)} in the last 7 days`}
        />
        <StatTile
          variant="plain"
          label="Leads"
          hint="Leads on client ad accounts. Mahara's own leads are on the Marketing tab."
          value={count(d.mtd.leads)}
          delta={
            <Delta value={change(d.last7.leads, d.prevLast7.leads)} vs={vs} />
          }
          sub={`${count(d.last7.leads)} in the last 7 days`}
        />
        <StatTile
          variant="plain"
          label="Cost per lead"
          hint="Client ad spend over client leads. Mahara's own cost per lead is on the Marketing tab and is a different number."
          value={money(d.mtd.cpl)}
          naHint={
            d.mtd.leads === 0 ? "No client leads this month yet" : undefined
          }
          status={gateChip(
            d.mtd.cpl,
            d.gates.cpl,
            "Cost per lead this month is",
          )}
          delta={
            <Delta
              value={change(d.last7.cpl, d.prevLast7.cpl)}
              goodWhen="down"
              vs={vs}
            />
          }
          sub={`${money(d.last7.cpl)} in the last 7 days`}
        />
        <StatTile
          variant="plain"
          label="Bookings"
          value={count(d.mtd.bookings)}
          delta={
            <Delta
              value={change(d.last7.bookings, d.prevLast7.bookings)}
              vs={vs}
            />
          }
          sub={`${count(d.last7.bookings)} in the last 7 days`}
        />
        <StatTile
          variant="plain"
          label="Cost per booking"
          value={money(d.mtd.cpb)}
          naHint={
            d.mtd.bookings === 0
              ? "No client booking this month is read yet"
              : undefined
          }
          status={gateChip(
            d.mtd.cpb,
            d.gates.cpb,
            "Cost per booking this month is",
          )}
          delta={
            <Delta
              value={change(d.last7.cpb, d.prevLast7.cpb)}
              goodWhen="down"
              vs={vs}
            />
          }
          sub={`${money(d.last7.cpb)} in the last 7 days`}
        />
      </TileRow>

      <TileRow className="border-t pt-5">
        <StatTile
          variant="plain"
          label="Campaigns running"
          value={count(d.campaigns.running)}
          sub="Live on Meta and on the Ads Management board"
        />
        <StatTile
          variant="plain"
          label="Clients off track"
          value={count(bad)}
          status={
            bad > 0 ? <StatusChip tone="serious" label="Needs a look" /> : null
          }
          sub={spendLine}
          hint="No leads at all, or a cost per lead more than 50% over the gate, in the last 7 days."
        />
        <StatTile
          variant="plain"
          label="Clients on watch"
          value={count(watch)}
          status={
            watch > 0 ? <StatusChip tone="warning" label="Watch" /> : null
          }
          sub={spendLine}
          hint="Leads are coming, but cost per lead is a little over the gate, cost per booking is over its gate, or no booking is read yet."
        />
      </TileRow>
    </div>
  );
}

// --- 2. Call centre -------------------------------------------------------

function CallCentreCard({
  section,
  now,
  today,
  goTab,
}: {
  section: CeoSections["calls"];
  now: number;
  today: string;
  goTab: GoTab;
}) {
  const c = section?.payload ?? null;
  const computedDay = section?.computedAt
    ? kuwaitDay(section.computedAt)
    : today;
  const behind = c !== null && computedDay !== today;
  const notes: Note[] = [
    ...(behind
      ? [
          {
            level: "warn" as const,
            text: `These call numbers were computed on ${date(computedDay)} and have not refreshed since, so today means ${date(computedDay)}.`,
          },
        ]
      : []),
    ...keepNotes(c?.notes, CALL_NOTE),
  ];
  const median = c?.speedToLead.medianMinutes7d ?? null;
  const speedTone = gateTone(median, SPEED_TARGET_MIN);

  return (
    <SectionCard
      kicker="Call centre, today"
      title="Dials, connections and speed to lead"
      section={section}
      notes={notes}
      actions={
        <>
          {isNum(median) && speedTone !== "neutral" ? (
            <StatusChip
              tone={speedTone}
              label={
                speedTone === "good"
                  ? `First call within ${SPEED_TARGET_MIN} min`
                  : `First call over ${SPEED_TARGET_MIN} min`
              }
              hint={`Median time from a new lead to its first call over the last 7 days, against a ${SPEED_TARGET_MIN} minute target. The target is a cockpit default until Aziz sets the official one.`}
            />
          ) : null}
          <TabLink tab="calls" label="Calls" goTab={goTab} />
        </>
      }
      order={1}
      bodyClassName="@container"
    >
      {p => <CallCentreBody c={p} now={now} />}
    </SectionCard>
  );
}

function CallCentreBody({ c, now }: { c: CallsPayload; now: number }) {
  const s = c.speedToLead;
  const noDials = c.today.dials === 0 ? "No dial today yet" : undefined;
  const noSample =
    s.sample === 0
      ? "No new lead has been called in the last 7 days"
      : undefined;
  const vs = "vs the 7 days before";

  return (
    <div className="min-w-0 space-y-6">
      <TileRow>
        <StatTile
          variant="plain"
          label="Dials today"
          value={count(c.today.dials)}
          delta={
            <Delta value={change(c.last7.dials, c.prevLast7.dials)} vs={vs} />
          }
          sub={`${count(c.last7.dials)} in the last 7 days`}
        />
        <StatTile
          variant="plain"
          label="Connected today"
          value={count(c.today.connected)}
          delta={
            <Delta
              value={change(c.last7.connected, c.prevLast7.connected)}
              vs={vs}
            />
          }
          sub={`${count(c.last7.connected)} in the last 7 days`}
        />
        <StatTile
          variant="plain"
          label="Connect rate today"
          value={pct(c.today.connectRate)}
          naHint={noDials}
          delta={
            <Delta
              value={diff(c.last7.connectRate, c.prevLast7.connectRate)}
              kind="points"
              vs={vs}
            />
          }
          sub={`${pct(c.last7.connectRate)} over the last 7 days`}
        />
        <StatTile
          variant="plain"
          label="Talk time today"
          value={talk(c.today.talkMinutes)}
          sub={`${talk(c.last7.talkMinutes)} in the last 7 days`}
        />
        <StatTile
          variant="plain"
          label="Conversations today"
          value={count(c.today.conversations90s)}
          hint="Connected calls that lasted 90 seconds or more. The Calls tab shows the same number as conversations over 90 s."
          sub={`${count(c.last7.conversations90s)} in the last 7 days`}
        />
        <StatTile
          variant="plain"
          label="Median time to first call"
          value={minutes(s.medianMinutes7d)}
          naHint={noSample}
          hint={
            s.sample > 0
              ? `Across ${plural(s.sample, "called lead")} in the last 7 days${s.since ? `, counting from ${date(s.since)}, the first day calls carry the lead phone` : ""}.`
              : "From a new lead landing to the first outbound call to that phone."
          }
          sub={
            isNum(s.within5minShare7d)
              ? `${pct(s.within5minShare7d)} called within ${SPEED_TARGET_MIN} min`
              : undefined
          }
        />
      </TileRow>

      <p className="border-t pt-4 text-xs leading-relaxed text-muted-foreground">
        {speedSentences(s, c.lastCallAt, now).join(" ")}
      </p>
    </div>
  );
}

/** The sentences under the call tiles: what speed to lead covers, and how fresh the store is. */
function speedSentences(
  s: CallsPayload["speedToLead"],
  lastCallAt: number | null,
  now: number,
): string[] {
  const out: string[] = [
    s.sample > 0
      ? `Speed to lead covers ${plural(s.sample, "lead")} that were actually called over the last 7 days, so a lead nobody has called never lengthens the median.`
      : "Speed to lead counts only leads that were actually called, so a lead nobody has called never lengthens the median.",
  ];
  if (s.since)
    out.push(
      `Counting starts ${date(s.since)}, the first day calls carry the lead phone.`,
    );
  out.push(
    lastCallAt
      ? `Newest call in the store: ${dateTime(lastCallAt, now)}.`
      : "No call has reached the store yet.",
  );
  return out;
}

// --- 3. Client success ----------------------------------------------------

const RISK: Record<
  ClientRow["risk"]["level"],
  { tone: StatusTone; label: string }
> = {
  high: { tone: "serious", label: "High risk" },
  medium: { tone: "warning", label: "Medium risk" },
  low: { tone: "neutral", label: "Low risk" },
};

function ClientSuccessCard({
  section,
  goTab,
}: {
  section: CeoSections["clients"];
  goTab: GoTab;
}) {
  const p = section?.payload ?? null;
  const high = p ? highRiskCount(p) : null;
  return (
    <SectionCard
      kicker="Client success"
      title="The roster and who needs attention"
      section={section}
      notes={[
        ...keepNotes(p?.notes, CLIENT_NOTE),
        // The churn tiles' known weaknesses stay beside them (payloads.ts
        // ChurnPayload): the warnings only, the rule is on the tile's hint.
        ...(p?.churn?.notes ?? []).filter(n => n.level === "warn"),
      ]}
      actions={
        <>
          {high === null ? null : high > 0 ? (
            <StatusChip
              tone="serious"
              label={`${count(high)} at high risk`}
              hint="Active and onboarding clients with 5 or more risk points."
            />
          ) : (
            <StatusChip tone="good" label="No client at high risk" />
          )}
          <TabLink tab="client-success" label="Client success" goTab={goTab} />
        </>
      }
      order={2}
      bodyClassName="@container"
    >
      {c => <ClientSuccessBody p={c} />}
    </SectionCard>
  );
}

function ClientSuccessBody({ p }: { p: ClientsPayload }) {
  const { counts } = p;
  const live = counts.active + counts.onboarding;
  const high = highRiskCount(p);
  const churn = churnHeadline(p);
  const attention = p.atRisk.filter(r => r.risk.level !== "low").slice(0, 8);

  return (
    <div className="min-w-0 space-y-6">
      <TileRow>
        <StatTile variant="plain" label="Active" value={count(counts.active)} />
        <StatTile
          variant="plain"
          label="Onboarding"
          value={count(counts.onboarding)}
        />
        <StatTile variant="plain" label="Paused" value={count(counts.paused)} />
        <StatTile
          variant="plain"
          label="Churned"
          value={count(counts.churned)}
          hint="How many clients sit in a churned stage today. This is a snapshot of the roster, not a churn rate."
        />
        <StatTile
          variant="plain"
          label="High risk"
          value={count(high)}
          sub={`of ${count(live)} active and onboarding`}
          hint="5 or more risk points. The point rules are in the note under this card."
        />
        <StatTile
          variant="plain"
          label="On the roster"
          value={count(counts.total)}
        />
      </TileRow>

      <TileRow className="border-t pt-5">
        <StatTile
          variant="plain"
          label={churn.label}
          value={count(churn.value)}
          sub={churn.sub}
          hint={churn.hint}
          naHint={churn.naHint}
        />
        <StatTile
          variant="plain"
          label="Lost before launch"
          value={count(churn.lostBeforeLaunch)}
          sub={churn.lostSub}
          hint="Clients with no Launch Date that stopped this month. A sales and onboarding loss, not a retention one."
          naHint={churn.naHint}
        />
      </TileRow>

      <div className="min-w-0 border-t pt-5">
        <p className="text-[13px] font-medium text-foreground">
          Needs attention
        </p>
        {attention.length === 0 ? (
          <EmptyState
            icon={CircleCheck}
            title="No client is at high or medium risk"
            text={`Across ${plural(live, "active or onboarding client", "active and onboarding clients")}.`}
            compact
            className="mt-1"
          />
        ) : (
          <ul className="mt-2">
            {attention.map(r => (
              <ClientRiskRow key={r.clickupTaskId || r.name} row={r} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ClientRiskRow({ row }: { row: ClientRow }) {
  const risk = RISK[row.risk.level];
  const meta = [
    row.csm ? `${row.csm} (CSM)` : "No CSM",
    isNum(row.silentDays)
      ? `${plural(row.silentDays, "day")} since the last contact`
      : "No contact date on the card",
  ].join(" · ");
  return (
    <li className="border-b border-[color:var(--ceo-grid)] py-3 first:pt-0 last:border-0 last:pb-0">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium text-foreground">
              {row.name}
            </span>
            {row.clickupTaskId ? (
              <a
                href={`https://app.clickup.com/t/${encodeURIComponent(row.clickupTaskId)}`}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open ${row.name} in ClickUp`}
                className="inline-flex shrink-0 rounded-sm text-muted-foreground/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            ) : null}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {meta}
          </p>
        </div>
        <StatusChip
          tone={risk.tone}
          label={risk.label}
          hint={plural(row.risk.score, "risk point")}
        />
      </div>
      {row.risk.reasons.length ? (
        <ul
          className="mt-2 flex flex-wrap gap-1.5"
          aria-label={`Why ${row.name} is at risk`}
        >
          {row.risk.reasons.map(reason => (
            <li
              key={reason}
              className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] leading-4 text-foreground/80"
            >
              {capitalize(reason)}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

// --- 4. What is stuck -----------------------------------------------------

// The verdicts the media buyer sync writes; anything else shows in neutral.
const VERDICT_TONE: Record<string, StatusTone> = {
  scale: "good",
  hold: "warning",
  fatiguing: "serious",
  "below KPI": "serious",
  kill: "critical",
  "no delivery": "neutral",
};

function StuckCard({
  section,
  notes,
  goTab,
}: {
  section: CeoSections["delivery"];
  notes: Note[];
  goTab: GoTab;
}) {
  const d = section?.payload ?? null;
  const issues = d
    ? d.launches.stuck.length +
      d.accountIssues.length +
      d.campaigns.boardOffButRunning +
      d.campaigns.spendingNotOnBoard
    : null;
  return (
    <SectionCard
      kicker="Across the three departments"
      title="What is stuck"
      section={section}
      notes={notes}
      actions={
        <>
          {issues === null ? null : issues === 0 ? (
            <StatusChip tone="good" label="Nothing stuck" />
          ) : (
            <StatusChip
              tone={d && d.accountIssues.length > 0 ? "critical" : "warning"}
              label={`${count(issues)} to clear`}
            />
          )}
          <TabLink tab="delivery" label="Delivery" goTab={goTab} />
        </>
      }
      order={3}
      bodyClassName="@container"
    >
      {p => <StuckBody d={p} />}
    </SectionCard>
  );
}

function StuckBody({ d }: { d: DeliveryPayload }) {
  const { inFlight, stuck } = d.launches;
  const verdicts = Object.entries(d.campaigns.verdicts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const judged = verdicts.reduce((total, [, n]) => total + n, 0);

  return (
    <div className="min-w-0 space-y-6">
      <TileRow className="@5xl:grid-cols-5">
        <StatTile
          variant="plain"
          label="Launches in flight"
          value={count(inFlight)}
          sub="Clients in an onboarding stage"
        />
        <StatTile
          variant="plain"
          label="Launches past the target"
          value={count(stuck.length)}
          status={
            stuck.length > 0 ? (
              <StatusChip tone="warning" label="Past launch target" />
            ) : null
          }
          sub="Onboarding longer than the launch target"
        />
        <StatTile
          variant="plain"
          label="Ad accounts blocked or flagged"
          value={count(d.accountIssues.length)}
          status={
            d.accountIssues.length > 0 ? (
              <StatusChip tone="critical" label="Cannot spend" />
            ) : null
          }
          sub="Client ad accounts on the board"
        />
        <StatTile
          variant="plain"
          label="Off on the board, still running"
          value={count(d.campaigns.boardOffButRunning)}
          status={
            d.campaigns.boardOffButRunning > 0 ? (
              <StatusChip tone="warning" label="Needs a look" />
            ) : null
          }
          sub="Marked off in ClickUp but live on Meta"
        />
        <StatTile
          variant="plain"
          label="Spending, not on the board"
          value={count(d.campaigns.spendingNotOnBoard)}
          status={
            d.campaigns.spendingNotOnBoard > 0 ? (
              <StatusChip tone="warning" label="Needs a look" />
            ) : null
          }
          sub="Spend in 7 days with no board card, left out of these numbers"
        />
      </TileRow>

      <div className="min-w-0 border-t pt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-[13px] font-medium text-foreground">
            Verdicts on running campaigns
          </p>
          <p className="text-xs tabular-nums text-muted-foreground">
            {plural(judged, "campaign")} judged on the last 7 days
          </p>
        </div>
        {verdicts.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            No running campaign carries a verdict yet.
          </p>
        ) : (
          <ul className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
            {verdicts.map(([key, n]) => {
              const tone = VERDICT_TONE[key] ?? "neutral";
              return (
                <li
                  key={key}
                  className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground"
                >
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor:
                        tone === "neutral"
                          ? "var(--ceo-deemphasis)"
                          : STATUS_COLOR[tone],
                    }}
                  />
                  <span className="truncate">{capitalize(key)}</span>
                  <span className="font-semibold tabular-nums text-foreground">
                    {count(n)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="grid min-w-0 items-start gap-6 border-t pt-5 @3xl:grid-cols-2">
        <StuckLaunches d={d} />
        <AccountIssues d={d} />
      </div>
    </div>
  );
}

function StuckLaunches({ d }: { d: DeliveryPayload }) {
  const { inFlight, stuck } = d.launches;
  const shown = stuck.slice(0, 5);
  return (
    <div className="min-w-0">
      <p className="text-[13px] font-medium text-foreground">
        Launches past the target
      </p>
      {stuck.length === 0 ? (
        <EmptyState
          icon={inFlight > 0 ? Rocket : CircleCheck}
          title="No launch is stuck"
          text={
            inFlight > 0
              ? `${plural(inFlight, "launch", "launches")} in flight, all within the target.`
              : undefined
          }
          compact
          className="mt-1"
        />
      ) : (
        <>
          <ol className="mt-2 min-w-0">
            {shown.map((s, i) => (
              <li
                key={`${s.client}-${i}`}
                className="flex min-w-0 items-start justify-between gap-3 border-b border-[color:var(--ceo-grid)] py-3 first:pt-0 last:border-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-foreground">
                    {s.client}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {s.blocker ?? "No blocker recorded."}
                  </p>
                </div>
                <span className="shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums text-foreground">
                  {plural(s.days, "day")}
                </span>
              </li>
            ))}
          </ol>
          {stuck.length > shown.length ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {plural(
                stuck.length - shown.length,
                "more launch",
                "more launches",
              )}{" "}
              on the Delivery tab.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

function AccountIssues({ d }: { d: DeliveryPayload }) {
  const shown = d.accountIssues.slice(0, 5);
  return (
    <div className="min-w-0">
      <p className="text-[13px] font-medium text-foreground">
        Ad account issues
      </p>
      {d.accountIssues.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No ad account issues"
          text="Every client ad account on the board can spend."
          compact
          className="mt-1"
        />
      ) : (
        <>
          <ul className="mt-2 min-w-0">
            {shown.map((a, i) => (
              <li
                key={`${a.client}-${i}`}
                className="flex min-w-0 items-start gap-2.5 border-b border-[color:var(--ceo-grid)] py-3 first:pt-0 last:border-0 last:pb-0"
              >
                <OctagonAlert
                  className="mt-0.5 size-4 shrink-0"
                  style={{ color: "var(--ceo-critical)" }}
                  aria-label="Account issue"
                />
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-foreground">
                    {a.client}
                  </p>
                  <p className="mt-0.5 break-words text-xs leading-relaxed text-muted-foreground">
                    {a.issue}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          {d.accountIssues.length > shown.length ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {plural(d.accountIssues.length - shown.length, "more account")} on
              the Delivery tab.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

// --- 5. What this tab cannot tell you -------------------------------------

/** Delivery questions with no source in anything the cockpit reads. */
const NOT_MEASURED: { label: string; why: string }[] = [
  {
    label: "One delivery health score across the three departments",
    why: "There is no agreed weighting. Pulse covers client success only and is the cockpit's own rule, not a company standard.",
  },
  {
    label: "Creative production throughput",
    why: "No source the cockpit reads carries creative output. Creative Triage holds leads, appointments, ad spend and rosters.",
  },
  {
    label: "Service level on a client request",
    why: "No ticket or request table exists anywhere in the stack.",
  },
  {
    label: "Delivery cost per client",
    why: "Hubstaff is a vendor line in the expense import only, so no time spent on an account reaches the cockpit.",
  },
  {
    label: "Retention and churn rate over time",
    why: "The churned count is a snapshot of the roster today. The churn tiles above date each loss from the cockpit's own daily history of each client's stage, which started in September 2026, so they cover this month only. A trend needs several complete months of it.",
  },
];

function NotMeasuredCard() {
  return (
    <SectionCard
      kicker="Not measured yet"
      title="What this tab cannot tell you"
      order={4}
      bodyClassName="@container"
    >
      <dl className="grid min-w-0 gap-5 @2xl:grid-cols-2 @5xl:grid-cols-3">
        {NOT_MEASURED.map(item => (
          <div key={item.label} className="min-w-0">
            <dt className="min-w-0 text-[13px] text-muted-foreground">
              {item.label}
            </dt>
            <dd className="mt-1 text-lg font-semibold tracking-tight">
              <Na hint={item.why} />
            </dd>
            <dd className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {item.why}
            </dd>
          </div>
        ))}
      </dl>
    </SectionCard>
  );
}
