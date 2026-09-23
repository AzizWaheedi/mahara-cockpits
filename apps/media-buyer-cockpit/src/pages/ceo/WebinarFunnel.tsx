import { useMemo, useState } from "react";
import { EmptyState } from "@/components/ceo/EmptyState";
import { FilterChips } from "@/components/ceo/FilterChips";
import {
  count,
  dateTime,
  decimal,
  minutes,
  money,
  NA,
  pct,
  shortDate,
} from "@/components/ceo/format";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatTile } from "@/components/ceo/StatTile";
import { StatusChip } from "@/components/ceo/StatusChip";
import type { CeoSection } from "@/components/ceo/useCeo";
import type {
  WebinarPayload,
  WebinarRound,
} from "../../../convex/ceo/payloads";

/**
 * The webinar funnel, beside the call funnel on the Frontend tab (Aziz,
 * 2026-09-23). The stages, metrics, sources of truth and targets are the Live
 * Training tracking brief's (6 August 2026). Each number says where it comes
 * from, and a metric whose source is not connected says so instead of
 * showing zero.
 *
 * The one visual idea: the stage list is a funnel rail. Each stage carries a
 * bar as long as its people are a share of the registrants, so the drop from
 * registered to closed reads down the page at a glance.
 */

type Status = WebinarPayload["tracking"][number]["status"];

const DOT: Record<Status, string> = {
  live: "var(--ceo-good)",
  waiting: "var(--ceo-warning)",
  missing: "var(--ceo-critical)",
};
const STATUS_WORD: Record<Status, string> = {
  live: "Live",
  waiting: "Waiting for data",
  missing: "Not connected",
};

function StatusDot({ status }: { status: Status }) {
  return (
    <span
      className="inline-block size-1.5 shrink-0 rounded-full"
      style={{ background: DOT[status] }}
      role="img"
      title={STATUS_WORD[status]}
      aria-label={STATUS_WORD[status]}
    />
  );
}

type Row = {
  label: string;
  value: string;
  target?: string;
  source: string;
  status: Status;
};

function MetricRows({ rows }: { rows: Row[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {rows.map(r => (
        <div key={r.label} className="grid min-w-0 gap-0.5">
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <StatusDot status={r.status} />
            <span className="truncate">{r.label}</span>
          </dt>
          <dd className="flex flex-wrap items-baseline gap-x-2">
            <span
              className={`text-lg font-semibold tabular-nums ${r.status === "missing" ? "text-muted-foreground" : ""}`}
            >
              {r.value}
            </span>
            {r.target ? (
              <span className="text-xs text-muted-foreground">
                target {r.target}
              </span>
            ) : null}
          </dd>
          <dd className="text-[11px] text-muted-foreground">{r.source}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A stage on the funnel rail: its number, name, bar and metrics. */
function Stage({
  n,
  title,
  question,
  people,
  of,
  rows,
}: {
  n: number;
  title: string;
  question: string;
  /** People at this stage, for the bar; null for stages without a headcount. */
  people: number | null;
  of: number;
  rows: Row[];
}) {
  const share = people !== null && of > 0 ? Math.min(1, people / of) : null;
  return (
    <li className="relative grid gap-3 pl-10 sm:pl-12">
      <span
        className="absolute left-0 top-0 flex size-7 items-center justify-center rounded-full border text-xs font-semibold tabular-nums sm:size-8"
        aria-hidden
      >
        {n}
      </span>
      <div className="grid gap-1">
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{question}</p>
        {share !== null ? (
          <div className="mt-1 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--ceo-emphasis-track)]">
              <div
                className="h-full rounded-full bg-[var(--ceo-emphasis)]"
                style={{ width: `${Math.max(share * 100, people ? 1.5 : 0)}%` }}
              />
            </div>
            <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {count(people)} of {count(of)}
            </span>
          </div>
        ) : null}
      </div>
      <MetricRows rows={rows} />
    </li>
  );
}

function statusOf(p: WebinarPayload, match: string): Status {
  return (
    p.tracking.find(t => t.metric.toLowerCase().includes(match.toLowerCase()))
      ?.status ?? "waiting"
  );
}

const range = (low: number, high: number, f: (x: number) => string) =>
  `${f(low)}–${f(high)}`;

function stages(p: WebinarPayload, r: WebinarRound) {
  const t = p.targets;
  const reg = r.registration.registrations;
  const pctf = (x: number) => pct(x);
  const moneyf = (x: number) => money(x);
  const s = {
    spend: statusOf(p, "Spend, impressions"),
    reach: statusOf(p, "Reach and frequency"),
    page: statusOf(p, "Landing page"),
    reg: statusOf(p, "Registrations and cost"),
    ad: statusOf(p, "down to the ad"),
    qual: statusOf(p, "Qualification"),
    lead: statusOf(p, "Days between"),
    remind: statusOf(p, "Reminders"),
    cal: statusOf(p, "Calendar-add"),
    attend: statusOf(p, "Attendees, show rate"),
    zoom: statusOf(p, "Watch time"),
    chat: statusOf(p, "Chat, polls"),
    pitch: statusOf(p, "Pitch link"),
    booked: statusOf(p, "Calls booked"),
    survey: statusOf(p, "survey completions"),
    sales: statusOf(p, "Call held"),
    speed: statusOf(p, "Speed to first"),
    objection: statusOf(p, "Objection"),
  };
  const shownNA = (ok: boolean, v: string) => (ok ? v : NA);
  const att = r.showUp.attendanceRecorded;
  return [
    {
      title: "Traffic and registration",
      question:
        "Did the ads bring the right people to register, and at what cost?",
      people: reg,
      rows: [
        {
          label: "Spend",
          value: money(r.traffic.spend),
          target: `${money(t.plannedSpend)} planned`,
          source: "Meta, ad level",
          status: s.spend,
        },
        {
          label: "Impressions",
          value: count(r.traffic.impressions),
          source: "Meta",
          status: s.spend,
        },
        {
          label: "Reach and frequency",
          value:
            r.traffic.reach === null
              ? NA
              : `${count(r.traffic.reach)} at ${decimal(r.traffic.frequency, 2)}`,
          source: "Meta insights for the round's dates",
          status: s.reach,
        },
        {
          label: "Clicks and CTR",
          value: `${count(r.traffic.clicks)} at ${pct(r.traffic.ctr)}`,
          source: `Link clicks ${count(r.traffic.linkClicks)} at ${pct(r.traffic.linkCtr)}`,
          status: s.spend,
        },
        {
          label: "Landing page visitors",
          value: NA,
          target: `page conversion ${range(t.pageConversion.low, t.pageConversion.high, pctf)}`,
          source: "Landing page events",
          status: s.page,
        },
        {
          label: "Registrations",
          value: count(reg),
          target: `${range(t.registrations.low, t.registrations.high, x => count(x))}, plan ${count(t.registrations.plan)}`,
          source: "HighLevel, tagged webby-registered",
          status: s.reg,
        },
        {
          label: "Cost per registration",
          value: money(r.registration.costPerRegistration),
          target: `${range(t.costPerRegistration.low, t.costPerRegistration.high, moneyf)}, plan ${money(t.costPerRegistration.plan)}`,
          source: "Spend over registrations",
          status: s.reg,
        },
        {
          label: "Registrations tied to an ad",
          value: reg
            ? `${count(r.registration.withAdId)} of ${count(reg)}`
            : NA,
          source: "utm_content on the ad URL",
          status: s.ad,
        },
        {
          label: "Qualified registrations",
          value: NA,
          source: "Form fields the opt-in does not ask yet",
          status: s.qual,
        },
        {
          label: "Days before the session",
          value: r.registration.leadDays
            ? `${r.registration.leadDays.d0_1} / ${r.registration.leadDays.d2_3} / ${r.registration.leadDays.d4_7} / ${r.registration.leadDays.d8plus}`
            : NA,
          source: "Registrants 0–1, 2–3, 4–7 and 8+ days out",
          status: s.lead,
        },
      ] as Row[],
    },
    {
      title: "Show-up",
      question: "Of the people who registered, how many came?",
      people: att ? r.showUp.attended : null,
      rows: [
        {
          label: "Reminders sent, opened, clicked",
          value: NA,
          source: "HighLevel and Kit stats",
          status: s.remind,
        },
        {
          label: "Calendar-add clicks",
          value: NA,
          source: "Thank-you page event",
          status: s.cal,
        },
        {
          label: "Attended",
          value: shownNA(att, count(r.showUp.attended)),
          source: `No-show ${shownNA(att, count(r.showUp.noShow))}`,
          status: s.attend,
        },
        {
          label: "Show rate",
          value: pct(r.showUp.showRate),
          target: range(t.showRate.low, t.showRate.high, pctf),
          source: "Attended over registered",
          status: s.attend,
        },
        {
          label: "Show rate by lead time",
          value: r.showUp.showRateByLead
            ? r.showUp.showRateByLead
                .map(b =>
                  b.registrants ? pct(b.attended / b.registrants) : "–",
                )
                .join(" / ")
            : NA,
          source: "0–1, 2–3, 4–7, 8+ days out",
          status: s.attend,
        },
      ] as Row[],
    },
    {
      title: "In the room",
      question: "Did they stay for the pitch?",
      people: null,
      rows: [
        {
          label: "Average watch time",
          value: NA,
          source: "Zoom join and leave times",
          status: s.zoom,
        },
        {
          label: "Retention at pitch 1",
          value: NA,
          target: `${pct(t.retentionAtPitch1)} of peak`,
          source: "Zoom",
          status: s.zoom,
        },
        {
          label: "Chat, polls, Q&A",
          value: NA,
          source: "Zoom",
          status: s.chat,
        },
      ] as Row[],
    },
    {
      title: "Conversion on the session",
      question: "Did the pitch turn attendees into booked calls?",
      people: r.conversion.booked,
      rows: [
        {
          label: "Pitch link clicks",
          value: NA,
          source: "One booking link per pitch",
          status: s.pitch,
        },
        {
          label: "Calls booked",
          value: count(r.conversion.booked),
          source: `${count(r.conversion.bookedIntro)} intro, ${count(r.conversion.bookedDemo)} demo${r.conversion.bookedWhileLive !== null ? `, ${count(r.conversion.bookedWhileLive)} while live` : ""}`,
          status: s.booked,
        },
        {
          label: "Attendee to booked",
          value: pct(r.conversion.attendeeToBooked),
          target: range(t.attendeeToBooked.low, t.attendeeToBooked.high, pctf),
          source: "Attendees who booked",
          status: att ? s.booked : s.attend,
        },
        {
          label: "Registrant to booked",
          value: pct(r.conversion.registrantToBooked),
          source: "Registrants who booked",
          status: s.booked,
        },
        {
          label: "Cost per booked call",
          value: money(r.conversion.costPerBooked),
          source: "Spend over registrants who booked",
          status: s.booked,
        },
        {
          label: "Survey completions",
          value: count(r.conversion.surveys),
          source:
            p.surveyResponses === null
              ? "webby-survey-done tag"
              : `webby-survey-done tag; Typeform has ${count(p.surveyResponses)} responses in 120 days`,
          status: s.survey,
        },
      ] as Row[],
    },
    {
      title: "Sales outcomes",
      question: "Did the calls close, and did the money come in?",
      people: r.sales.closes,
      rows: [
        {
          label: "Calls held",
          value: `${count(r.sales.held)} of ${count(r.sales.due)} due`,
          target: `${pct(t.bookedToHeld)} of booked`,
          source: "HighLevel appointment status",
          status: s.sales,
        },
        {
          label: "Closes and close rate",
          value: `${count(r.sales.closes)} at ${pct(r.sales.closeRate)}`,
          target: pct(t.closeRate),
          source: "Closer form, over calls held",
          status: s.sales,
        },
        {
          label: "Contracted and cash",
          value: `${money(r.sales.contracted)} and ${money(r.sales.cash)}`,
          source: `${money(r.sales.cashConfirmed)} of the cash confirmed on Whop or the bank`,
          status: s.sales,
        },
        {
          label: "CAC and ROAS",
          value: `${money(r.sales.cac)} and ${decimal(r.sales.roasCash, 2)}×`,
          source: `Contracted ROAS ${decimal(r.sales.roasContracted, 2)}×`,
          status: s.sales,
        },
        {
          label: "Speed to first contact",
          value: minutes(r.sales.firstContactMedianMin),
          source: `Median, Maqsam; ${count(r.sales.neverContacted)} never called`,
          status: s.speed,
        },
        {
          label: "Objection categories",
          value: NA,
          source: "Fathom transcripts",
          status: s.objection,
        },
      ] as Row[],
    },
  ];
}

function roundName(r: WebinarRound): string {
  return r.sessionAt ? `${r.label}, ${shortDate(r.sessionAt)}` : r.label;
}

export function WebinarFunnel({
  section,
}: {
  section: CeoSection<"webinar"> | null;
}) {
  const p = section?.payload ?? null;
  const [picked, setPicked] = useState<string | null>(null);
  const round = useMemo(() => {
    if (!p?.rounds.length) return null;
    return p.rounds.find(r => r.key === picked) ?? p.rounds[0];
  }, [p, picked]);

  return (
    <div className="grid gap-5 lg:gap-7">
      <SectionCard
        title="Webinar funnel"
        kicker={round ? roundName(round) : "Live training"}
        section={section}
        notes={p?.notes}
        order={0}
      >
        {payload =>
          !round ? (
            <EmptyState
              title="The webinar has not started"
              text="No registrant carries a webby tag and no webinar campaign has spent yet. Everything below fills in by itself once the Webinar Opt In form takes its first registration."
            />
          ) : (
            <div className="grid gap-5">
              {payload.rounds.length > 1 ? (
                <FilterChips
                  ariaLabel="Which session"
                  value={round.key}
                  onChange={setPicked}
                  options={payload.rounds.map(r => ({
                    key: r.key,
                    label: roundName(r),
                    count: r.registration.registrations,
                  }))}
                />
              ) : null}
              <p className="text-sm text-muted-foreground">
                {round.sessionAt
                  ? `${round.status === "upcoming" ? "Goes live" : "Went live"} ${dateTime(round.sessionAt)}.`
                  : "No session date on the registrants yet."}{" "}
                {round.spendFrom
                  ? `Ads ran ${shortDate(round.spendFrom)} to ${shortDate(round.spendTo)}.`
                  : "No webinar campaign has spent for this session."}
              </p>
              <Headline p={payload} r={round} />
            </div>
          )
        }
      </SectionCard>

      {p && round ? (
        <SectionCard
          title="Stage by stage"
          kicker="The tracking brief's six stages"
          section={section}
          hideAsOf
          order={1}
        >
          {() => (
            <div className="grid gap-5">
              <ol className="grid gap-8">
                {stages(p, round).map((s, i) => (
                  <Stage
                    key={s.title}
                    n={i + 1}
                    title={s.title}
                    question={s.question}
                    people={s.people}
                    of={round.registration.registrations}
                    rows={s.rows}
                  />
                ))}
                <li className="relative grid gap-3 pl-10 sm:pl-12">
                  <span
                    className="absolute left-0 top-0 flex size-7 items-center justify-center rounded-full border text-xs font-semibold sm:size-8"
                    aria-hidden
                  >
                    6
                  </span>
                  <h3 className="text-base font-semibold">Every session</h3>
                  <RollUp p={p} />
                </li>
              </ol>
              <Legend />
            </div>
          )}
        </SectionCard>
      ) : null}

      {p && round ? <Ads p={p} round={round} section={section} /> : null}

      {p ? <Tracking p={p} section={section} /> : null}
    </div>
  );
}

function Headline({ p, r }: { p: WebinarPayload; r: WebinarRound }) {
  const t = p.targets;
  const cpr = r.registration.costPerRegistration;
  const kill =
    cpr !== null &&
    r.traffic.spend >= t.killRule.spendAfter &&
    cpr > t.killRule.costPerRegistrationAbove;
  const cprTone =
    cpr === null
      ? null
      : kill
        ? "critical"
        : cpr <= t.costPerRegistration.high
          ? "good"
          : "warning";
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <StatTile
        label="Spend"
        value={money(r.traffic.spend)}
        sub={`of ${money(t.plannedSpend)} planned`}
      />
      <StatTile
        label="Registrations"
        value={count(r.registration.registrations)}
        sub={`target ${count(t.registrations.low)}–${count(t.registrations.high)}`}
      />
      <StatTile
        label="Cost per registration"
        value={money(cpr)}
        sub={`target ${money(t.costPerRegistration.low)}–${money(t.costPerRegistration.high)}`}
        status={
          cprTone ? (
            <StatusChip
              tone={cprTone}
              label={
                kill
                  ? "Swap the creative"
                  : cprTone === "good"
                    ? "On target"
                    : "Above target"
              }
              hint={
                kill
                  ? `Over ${money(t.killRule.costPerRegistrationAbove)} after the first ${money(t.killRule.spendAfter)}: the brief says the creative is wrong, not the budget. Pause and swap before spending more.`
                  : undefined
              }
            />
          ) : undefined
        }
      />
      <StatTile
        label="Show rate"
        value={pct(r.showUp.showRate)}
        sub={
          r.showUp.attendanceRecorded
            ? `${count(r.showUp.attended)} came, target ${pct(t.showRate.low)}–${pct(t.showRate.high)}`
            : "Attendance not recorded yet"
        }
      />
      <StatTile
        label="Calls booked"
        value={count(r.conversion.booked)}
        sub={`${pct(r.conversion.registrantToBooked)} of registrants`}
      />
      <StatTile
        label="Cash"
        value={money(r.sales.cash)}
        sub={`${count(r.sales.closes)} closed, ROAS ${decimal(r.sales.roasCash, 2)}×`}
      />
    </div>
  );
}

function RollUp({ p }: { p: WebinarPayload }) {
  return (
    <div className="ceo-scroll-x overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 pr-3 font-normal">Session</th>
            <th className="py-2 pr-3 text-right font-normal">Registered</th>
            <th className="py-2 pr-3 text-right font-normal">Show rate</th>
            <th className="py-2 pr-3 text-right font-normal">Booked</th>
            <th className="py-2 pr-3 text-right font-normal">Closed</th>
            <th className="py-2 pr-3 text-right font-normal">Cash</th>
            <th className="py-2 pr-3 text-right font-normal">CAC</th>
            <th className="py-2 text-right font-normal">ROAS</th>
          </tr>
        </thead>
        <tbody>
          {p.rounds.map(r => (
            <tr key={r.key} className="border-b last:border-b-0">
              <td className="py-2 pr-3">{roundName(r)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {count(r.registration.registrations)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {pct(r.showUp.showRate)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {count(r.conversion.booked)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {count(r.sales.closes)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {money(r.sales.cash)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {money(r.sales.cac)}
              </td>
              <td className="py-2 text-right tabular-nums">
                {decimal(r.sales.roasCash, 2)}×
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Legend() {
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {(["live", "waiting", "missing"] as const).map(s => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <StatusDot status={s} />
          {STATUS_WORD[s]}
        </span>
      ))}
      <span>
        The bar under a stage is its people as a share of the registrants.
      </span>
    </p>
  );
}

function Ads({
  p,
  round,
  section,
}: {
  p: WebinarPayload;
  round: WebinarRound;
  section: CeoSection<"webinar"> | null;
}) {
  const ads = p.ads.filter(a => a.roundKey === round.key);
  return (
    <SectionCard
      title="Ads, spend to cash"
      kicker={roundName(round)}
      section={section}
      hideAsOf
      order={2}
    >
      {() =>
        ads.length ? (
          <div className="ceo-scroll-x overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-normal">Ad</th>
                  <th className="py-2 pr-3 text-right font-normal">Spend</th>
                  <th className="py-2 pr-3 text-right font-normal">CTR</th>
                  <th className="py-2 pr-3 text-right font-normal">
                    Registered
                  </th>
                  <th className="py-2 pr-3 text-right font-normal">Per reg.</th>
                  <th className="py-2 pr-3 text-right font-normal">Came</th>
                  <th className="py-2 pr-3 text-right font-normal">Booked</th>
                  <th className="py-2 pr-3 text-right font-normal">Closed</th>
                  <th className="py-2 text-right font-normal">Cash</th>
                </tr>
              </thead>
              <tbody>
                {ads.map(a => (
                  <tr key={a.adId} className="border-b last:border-b-0">
                    <td
                      className="max-w-[16rem] truncate py-2 pr-3"
                      title={a.adName}
                    >
                      {a.adName}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {money(a.spend)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {pct(a.ctr)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {count(a.registrations)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {money(a.costPerRegistration)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {count(a.attended)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {count(a.booked)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {count(a.closes)}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {money(a.cash)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No webinar ad has run for this session"
            text="Ads appear here with their registrations, attendees, bookings and cash once a webinar campaign spends."
            compact
          />
        )
      }
    </SectionCard>
  );
}

function Tracking({
  p,
  section,
}: {
  p: WebinarPayload;
  section: CeoSection<"webinar"> | null;
}) {
  const open = p.tracking.filter(t => t.status !== "live");
  const [all, setAll] = useState(false);
  const shown = all ? p.tracking : open;
  return (
    <SectionCard
      title="What still has to be connected"
      kicker="From the tracking brief"
      section={section}
      hideAsOf
      order={3}
    >
      {() => (
        <div className="grid gap-3">
          <p className="text-sm text-muted-foreground">
            {open.length
              ? `${p.tracking.length - open.length} of ${p.tracking.length} metrics flow today. The rest need the setup below; until then they show n/a, never zero.`
              : "Every metric in the brief flows."}
          </p>
          <ul className="grid gap-2.5">
            {shown.map(t => (
              <li
                key={t.metric}
                className="grid gap-0.5 border-b pb-2.5 last:border-b-0 last:pb-0"
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <StatusDot status={t.status} />
                  {t.metric}
                  <span className="text-xs font-normal text-muted-foreground">
                    stage {t.stage}
                  </span>
                </span>
                <span className="pl-3.5 text-sm text-muted-foreground">
                  {t.note}
                </span>
                <span className="pl-3.5 text-[11px] text-muted-foreground">
                  Source: {t.source}
                </span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="w-fit text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            onClick={() => setAll(a => !a)}
          >
            {all ? "Show only what is not flowing" : "Show every metric"}
          </button>
        </div>
      )}
    </SectionCard>
  );
}
