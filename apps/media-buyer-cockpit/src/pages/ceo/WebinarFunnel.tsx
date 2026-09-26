import { useAction } from "convex/react";
import { Check, TriangleAlert } from "lucide-react";
import { type ReactNode, useId, useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarList } from "@/components/ceo/BarList";
import { AXIS_TICK } from "@/components/ceo/chartKit";
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
  plural,
  seconds,
  shortDate,
} from "@/components/ceo/format";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatTile } from "@/components/ceo/StatTile";
import { StatusChip } from "@/components/ceo/StatusChip";
import type { CeoSection } from "@/components/ceo/useCeo";
import { Button } from "@/components/ui/button";
import { api } from "../../../convex/_generated/api";
import type {
  WebinarPayload,
  WebinarRound,
} from "../../../convex/ceo/payloads";
import { webinarReadiness } from "../../../convex/ceo/webinarReadiness";
import type { Room } from "../../../convex/ceo/webinarRoom";
import type { TargetSelection } from "../../../convex/ceo/webinarTargetsModel";
import { WebinarTargetsEditor } from "./WebinarTargetsEditor";

/**
 * The webinar funnel, beside the call funnel on the Frontend tab (Aziz,
 * 2026-09-23). The stages, metrics, sources of truth and targets are the Live
 * Training tracking brief's (6 August 2026). Each number says where it comes
 * from, and a metric whose source is not connected says so instead of
 * showing zero.
 *
 * The one visual idea: the stage list is a funnel rail. Each stage carries a
 * bar as long as its people are a share of the registrants, so the drop from
 * registered to closed reads down the page at a glance. Inside the room
 * (stage 3) the rail opens into the retention curve: people in the room
 * minute by minute, with the two pitches marked (Zoom, via hermes/webinar-
 * pull, 2026-09-23).
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
    <dl className="grid gap-x-6 gap-y-4 @lg:grid-cols-2">
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
          <dd className="text-xs text-muted-foreground">{r.source}</dd>
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
  extra,
}: {
  n: number;
  title: string;
  question: string;
  /** People at this stage, for the bar; null for stages without a headcount. */
  people: number | null;
  of: number;
  rows: Row[];
  /** What the stage shows beyond its numbers (the curve, the profit bands). */
  extra?: ReactNode;
}) {
  const share = people !== null && of > 0 ? Math.min(1, people / of) : null;
  return (
    <li className="relative grid gap-3 pl-10 @md:pl-12">
      <span
        className="absolute left-0 top-0 flex size-7 items-center justify-center rounded-full border text-xs font-semibold tabular-nums @md:size-8"
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
      {extra}
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

type StageDef = {
  title: string;
  question: string;
  people: number | null;
  rows: Row[];
  extra?: ReactNode;
};

function stages(p: WebinarPayload, r: WebinarRound): StageDef[] {
  const t = r.targetSelection?.values ?? p.targets;
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
    join: statusOf(p, "Join-link"),
    attend: statusOf(p, "Attendees, show rate"),
    tied: statusOf(p, "tied to a registrant"),
    zoom: statusOf(p, "Watch time"),
    chat: statusOf(p, "Chat, polls"),
    pitch: statusOf(p, "pitch link"),
    booked: statusOf(p, "Calls booked"),
    survey: statusOf(p, "survey completions"),
    sales: statusOf(p, "Call held"),
    speed: statusOf(p, "Speed to first"),
    objection: statusOf(p, "Objection"),
  };
  const shownNA = (ok: boolean, v: string) => (ok ? v : NA);
  const att = r.showUp.attendanceRecorded;
  const q = r.qualification;
  const room = r.room;
  const pg = r.page;
  const rm = r.reminders;
  const ob = r.objections;
  const share = (a: number, b: number) => (b > 0 ? a / b : null);
  const pitch = (n: 1 | 2) => room?.pitches.find(x => x.n === n) ?? null;
  const p1 = pitch(1);
  const p2 = pitch(2);
  const pitchSource = (x: ReturnType<typeof pitch>, n: 1 | 2) =>
    !room
      ? "Zoom"
      : x
        ? `Minute ${x.minute}, ${count(x.present)} people; ${x.source === "chat" ? "found from the chat's 1s" : "time set here"}`
        : n === 1
          ? "No burst of 1s in the chat; set the time below"
          : "Set the time below";
  const perPerson = r.showUp.personLevel;
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
          value: pg ? count(pg.visitors) : NA,
          source: pg
            ? `${count(pg.sessions)} sessions; ${pct(share(pg.mobile, pg.visitors))} on phones; ${count(pg.withAd)} from an ad`
            : "The page's own events",
          status: s.page,
        },
        {
          label: "Page conversion",
          value: pg ? pct(share(reg, pg.visitors)) : NA,
          target: `${range(t.pageConversion.low, t.pageConversion.high, pctf)}; under ${pct(t.pageConversion.floor)} the page is the problem`,
          source: "HighLevel registrations over page visitors",
          status: s.page,
        },
        {
          label: "Form seen, started, sent",
          value: pg
            ? `${count(pg.formView)} / ${count(pg.formStart)} / ${count(pg.formSubmit)}`
            : NA,
          source: pg
            ? `${pct(share(pg.formStart, pg.visitors))} of visitors started it; ${count(pg.ctaClick)} pressed a register button`
            : "Visitors who saw the form, clicked into it, sent it",
          status: s.page,
        },
        {
          label: "Registered on the page",
          value: pg ? count(pg.thankYou) : NA,
          source: pg
            ? `Thank-you page views, the page's own count; HighLevel counts ${count(reg)}`
            : "Thank-you page views",
          status: s.page,
        },
        {
          label: "Read to the end",
          value: pg ? pct(share(pg.scroll100, pg.visitors)) : NA,
          source: pg
            ? `Half the page: ${pct(share(pg.scroll50, pg.visitors))}; median time on it ${seconds(pg.secondsMedian)}; ${count(pg.videoPlays)} played a testimonial`
            : "Scroll depth and time on the page",
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
          value:
            q.qualified + q.notQualified > 0
              ? `${count(q.qualified)} of ${count(reg)}`
              : NA,
          source: `$${count(q.threshold / 1000)}K+ yearly profit in the survey, or roas-qualified from the booking form; ${count(q.unknown)} answered neither`,
          status: s.qual,
        },
        {
          label: "Cost per qualified registration",
          value: money(q.costPerQualified),
          source: "Spend over qualified registrations",
          status: s.qual,
        },
        {
          label: "Booking form",
          value:
            q.booking.qualified + q.booking.unqualified + q.booking.notReady
              ? `${count(q.booking.qualified)} / ${count(q.booking.unqualified)} / ${count(q.booking.notReady)}`
              : NA,
          source: "Qualified, unqualified, not ready (roas tags)",
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
      extra: q.bands.length ? <ProfitBands q={q} /> : null,
    },
    {
      title: "Show-up",
      question: "Of the people who registered, how many came?",
      people: att ? r.showUp.attended : null,
      rows: [
        {
          label: "WhatsApp reminders",
          value: rm
            ? `${count(rm.whatsapp.sent)} / ${count(rm.whatsapp.delivered)} / ${count(rm.whatsapp.read)}`
            : NA,
          source: rm
            ? `Sent, delivered, read; ${count(rm.whatsapp.failed)} failed; ${count(rm.readAny)} of ${count(reg)} registrants read one`
            : "HighLevel: sent, delivered, read",
          status: s.remind,
        },
        {
          label: "SMS and email",
          value: rm ? `${count(rm.sms.sent)} and ${count(rm.email.sent)}` : NA,
          source: rm
            ? `SMS delivered ${count(rm.sms.delivered)}; email opens and clicks are in Kit`
            : "HighLevel; email opens and clicks are in Kit",
          status: s.remind,
        },
        {
          label: "Calendar-add clicks",
          value: pg ? `${count(pg.calendarAdd)} of ${count(pg.thankYou)}` : NA,
          source: "People on the thank-you page who pressed Add to calendar",
          status: s.cal,
        },
        {
          label: "WhatsApp group button",
          value: pg ? count(pg.whatsapp) : NA,
          source: pg?.whatsappPlaceholder
            ? "The button still has no link on the thank-you page"
            : "Pressed on the thank-you page",
          status: s.cal,
        },
        {
          label: "Welcome video",
          value: pg
            ? `${count(pg.thankYouVideoWatched)} of ${count(pg.thankYouVideo)}`
            : NA,
          source: "Watched three quarters of it, of those it played for",
          status: s.cal,
        },
        {
          label: "Join-link clicks",
          value: pg ? `${count(pg.joinBefore)} and ${count(pg.joinAfter)}` : NA,
          source:
            "Before and after the start: webinar.maharamedia.com/live, the reminders' link",
          status: s.join,
        },
        {
          label: "Attended",
          value: shownNA(att, count(r.showUp.attended)),
          source:
            r.showUp.source === "zoom"
              ? "People in the Zoom room, our team left out"
              : `webby-attended tag; no-show ${shownNA(att, count(r.showUp.noShow))}`,
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
          label: "On time",
          value: pct(room?.onTime),
          source: "Joined within 3 minutes of the start",
          status: s.attend,
        },
        {
          label: "Attendees tied to a registrant",
          value: room
            ? `${count(r.showUp.matched)} of ${count(room.attendees)}`
            : NA,
          source: "By Zoom registration or a signed-in email, never by name",
          status: s.tied,
        },
        {
          label: "Missed it, booked anyway",
          value: r.showUp.salvage
            ? `${count(r.showUp.salvage.booked)} of ${count(r.showUp.salvage.missed)}`
            : NA,
          source: r.showUp.salvage
            ? "Registrants who did not come and booked a call"
            : "Needs attendees tied to registrants",
          status: r.showUp.salvage ? s.attend : s.tied,
        },
        {
          label: "Show rate by lead time",
          value: r.showUp.showRateByLead
            ? r.showUp.showRateByLead
                .map(b =>
                  b.registrants ? pct(b.attended / b.registrants) : NA,
                )
                .join(" / ")
            : NA,
          source: perPerson
            ? "0–1, 2–3, 4–7, 8+ days out"
            : "Needs attendees tied to registrants",
          status: perPerson ? s.attend : s.tied,
        },
      ] as Row[],
      extra: rm?.steps.length ? <ReminderSteps steps={rm.steps} /> : null,
    },
    {
      title: "In the room",
      question: "Did they stay for the pitch?",
      people: null,
      rows: [
        {
          label: "Average watch time",
          value: minutes(room?.watchAvgMin),
          source: room
            ? `Median ${minutes(room.watchMedianMin)}; rejoins counted once`
            : "Zoom join and leave times",
          status: s.zoom,
        },
        {
          label: "Peak in the room",
          value: room ? count(room.peak) : NA,
          source: room ? `At minute ${room.peakMinute}` : "Zoom",
          status: s.zoom,
        },
        {
          label: "Retention at pitch 1",
          value: pct(p1?.retention),
          target: `${pct(t.retentionAtPitch1)} of peak`,
          source: pitchSource(p1, 1),
          status: s.zoom,
        },
        {
          label: "Retention at pitch 2",
          value: pct(p2?.retention),
          source: pitchSource(p2, 2),
          status: s.zoom,
        },
        {
          label: "Stayed to the end",
          value: pct(room?.stayToEnd),
          source: "In the room two minutes before it ended",
          status: s.zoom,
        },
        {
          label: "Chat lines",
          value:
            room && room.chat.complete !== false
              ? count(room.chat.messages)
              : NA,
          source: room
            ? `From ${count(room.chat.people)} people; “drop a 1” at pitch 1: ${count(room.chat.onesAtPitch1)}`
            : "Zoom recording chat",
          status: s.chat,
        },
        {
          label: "Poll answers",
          value: room?.polls ? count(room.polls.answers) : NA,
          source: room?.polls
            ? `From ${count(room.polls.people)} people; Q&A questions ${count(room.qa)}`
            : "Polls and Q&A need the Zoom app keys",
          status: s.chat,
        },
      ] as Row[],
      extra: room ? (
        <RoomCurve room={room} target={t.retentionAtPitch1} />
      ) : null,
    },
    {
      title: "Conversion on the session",
      question: "Did the pitch turn attendees into booked calls?",
      people: r.conversion.booked,
      rows: [
        {
          label: "Pitch link clicks",
          value: pg
            ? `${count(pg.pitch1Clicks)} and ${count(pg.pitch2Clicks)}`
            : NA,
          source: "Pitch 1 and pitch 2: webinar.maharamedia.com/p1 and /p2",
          status: s.pitch,
        },
        {
          label: "Bookings by pitch link",
          value:
            r.pitchBookings.pitch1 + r.pitchBookings.pitch2
              ? `${count(r.pitchBookings.pitch1)} and ${count(r.pitchBookings.pitch2)}`
              : NA,
          source: "Pitch 1 and pitch 2, from utm_content on the booking link",
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
          source:
            att && !perPerson
              ? "Needs attendees tied to registrants"
              : "Attendees who booked",
          status: att ? (perPerson ? s.booked : s.tied) : s.attend,
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
          label: "Survey on the thank-you page",
          value: pg
            ? `${count(pg.surveyStart)} started, ${count(pg.surveySubmit)} sent`
            : NA,
          source: "The gift survey's embed, the page's own count",
          status: s.survey,
        },
        {
          label: "Survey completions",
          value: count(r.conversion.surveys),
          source:
            p.surveyResponses === null
              ? "Registrants who answered the gift survey"
              : `Registrants who answered; ${count(p.surveyResponses)} responses in all, ${count(p.survey.unmatched)} match nobody`,
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
          value: `${money(r.sales.cac)} and ${decimal(r.sales.roasCash, 2)}x`,
          source: `Contracted ROAS ${decimal(r.sales.roasContracted, 2)}x`,
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
          value: ob ? (ob.categories[0]?.label ?? "None raised") : NA,
          source: ob
            ? `${count(ob.calls)} sales calls tagged; ${count(ob.none)} raised none`
            : "Fathom transcripts, tagged by deepseek-flash",
          status: s.objection,
        },
      ] as Row[],
      extra: ob?.categories.length ? <Objections ob={ob} /> : null,
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
  const [savedTargets, setSavedTargets] = useState<
    Record<string, TargetSelection>
  >({});
  const [picked, setPicked] = useState<string | null>(null);
  const round = useMemo(() => {
    if (!p?.rounds.length) return null;
    const r = p.rounds.find(r => r.key === picked) ?? p.rounds[0];
    const saved = savedTargets[`round:${r.key}`];
    return saved && saved.revision >= (r.targetSelection?.revision ?? 0)
      ? { ...r, targetSelection: saved }
      : r;
  }, [p, picked, savedTargets]);

  return (
    <div className="grid gap-4 lg:gap-6">
      {p && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {p.targetStore === "unavailable"
              ? "Saved targets unavailable · showing original plan"
              : round?.targetSelection?.basis === "round"
                ? "Targets saved for this round"
                : "Targets inherited from the plan"}
          </p>
          <WebinarTargetsEditor
            round={round}
            onSaved={(scope, selection) =>
              setSavedTargets(prev => ({ ...prev, [scope]: selection }))
            }
          />
        </div>
      )}
      {p ? <LaunchReadiness p={p} section={section} /> : null}
      <SectionCard
        title="At a glance"
        kicker={round ? roundName(round) : "Live training"}
        section={section}
        notes={p?.notes}
        order={0}
      >
        {payload =>
          !round ? (
            <EmptyState
              title="The webinar has not started"
              text="No webinar registrations or campaign spend have been recorded yet. Complete the checks above, then verify one registration through the full funnel. Unavailable metrics stay empty until their source provides evidence."
            />
          ) : (
            <div className="grid gap-4">
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
          kicker="Six stages"
          section={section}
          hideAsOf
          order={1}
        >
          {() => (
            <div className="grid gap-6">
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
                    extra={s.extra}
                  />
                ))}
                <li className="relative grid gap-3 pl-10 @md:pl-12">
                  <span
                    className="absolute left-0 top-0 flex size-7 items-center justify-center rounded-full border text-xs font-semibold @md:size-8"
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

function LaunchReadiness({
  p,
  section,
}: {
  p: WebinarPayload;
  section: CeoSection<"webinar"> | null;
}) {
  const now = Date.now();
  const cached = p.readiness;
  const stillFresh =
    cached?.checkedAt != null &&
    now - cached.checkedAt >= 0 &&
    now - cached.checkedAt <= 3 * 3600_000;
  const readiness = stillFresh
    ? cached
    : { ...webinarReadiness(null, now), checkedAt: cached?.checkedAt ?? null };
  const blocked = readiness.checks.filter(c => c.status === "blocked").length;
  const unknown = readiness.checks.filter(c => c.status === "unknown").length;
  const ready = readiness.checks.filter(c => c.status === "ready").length;
  return (
    <SectionCard
      title="Before the next training"
      kicker="Launch readiness"
      section={section}
      hideAsOf
      order={0}
    >
      {() => (
        <div className="grid gap-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="max-w-2xl space-y-1">
              <p className="text-sm text-muted-foreground">
                A healthy data sync does not mean registration and reminders are
                ready. These checks read the live setup without changing it.
              </p>
              <p className="text-xs text-muted-foreground">
                {readiness.checkedAt
                  ? `Last checked ${dateTime(readiness.checkedAt)}${readiness.fresh ? "" : " · verification expired"}.`
                  : "The worker has not supplied a readiness check yet."}
              </p>
            </div>
            <StatusChip
              size="md"
              tone={blocked ? "serious" : unknown ? "warning" : "good"}
              label={
                blocked
                  ? `${blocked} to fix · ${unknown} to verify`
                  : unknown
                    ? `${unknown} to verify`
                    : "Automated checks passed"
              }
            />
          </div>
          <div
            className="h-1 overflow-hidden rounded-full bg-muted"
            aria-label={`${ready} of ${readiness.checks.length} setup checks passed`}
            role="img"
          >
            <div
              className="h-full rounded-full bg-[var(--mahara-teal)]"
              style={{ width: `${(ready / readiness.checks.length) * 100}%` }}
            />
          </div>
          <details open={!p.rounds.length}>
            <summary className="cursor-pointer text-sm font-medium">
              Review setup checks
            </summary>
            <ul className="mt-3 grid gap-x-6 md:grid-cols-2">
              {readiness.checks.map(check => (
                <li
                  key={check.key}
                  className="grid content-start gap-2 border-t py-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-medium">{check.label}</h3>
                    <StatusChip
                      tone={
                        check.status === "ready"
                          ? "good"
                          : check.status === "blocked"
                            ? "serious"
                            : "neutral"
                      }
                      label={
                        check.status === "ready"
                          ? "Checked"
                          : check.status === "blocked"
                            ? "Needs action"
                            : "Not verified"
                      }
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {check.detail}
                  </p>
                  {check.status !== "ready" ? (
                    <p className="text-xs leading-relaxed text-foreground">
                      {check.action}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="border-t pt-4 text-xs leading-relaxed text-muted-foreground">
              Before buying traffic: verify one registration, the scheduled
              reminders, a mobile join, pitch booking and attendance match. Meta
              delivery, Kit email engagement and WhatsApp group links also need
              a live check. These configuration checks cannot prove message
              delivery or a completed customer journey.
            </p>
          </details>
        </div>
      )}
    </SectionCard>
  );
}

function Headline({ p, r }: { p: WebinarPayload; r: WebinarRound }) {
  const t = r.targetSelection?.values ?? p.targets;
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
    <div className="grid grid-cols-2 gap-x-6 gap-y-6 border-t pt-4 @lg:grid-cols-3 @4xl:grid-cols-6">
      <StatTile
        variant="plain"
        label="Spend"
        value={money(r.traffic.spend)}
        sub={`of ${money(t.plannedSpend)} planned`}
      />
      <StatTile
        variant="plain"
        label="Registrations"
        value={count(r.registration.registrations)}
        sub={`target ${count(t.registrations.low)}–${count(t.registrations.high)}`}
      />
      <StatTile
        variant="plain"
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
        variant="plain"
        label="Show rate"
        value={pct(r.showUp.showRate)}
        sub={
          r.showUp.attendanceRecorded
            ? `${count(r.showUp.attended)} ${r.showUp.source === "zoom" ? "in the room" : "came"}, target ${pct(t.showRate.low)}–${pct(t.showRate.high)}`
            : "Attendance not recorded yet"
        }
      />
      <StatTile
        variant="plain"
        label="Calls booked"
        value={count(r.conversion.booked)}
        sub={`${pct(r.conversion.registrantToBooked)} of registrants`}
      />
      <StatTile
        variant="plain"
        label="Cash"
        value={money(r.sales.cash)}
        sub={`${count(r.sales.closes)} closed, ROAS ${decimal(r.sales.roasCash, 2)}x`}
      />
    </div>
  );
}

function RollUp({ p }: { p: WebinarPayload }) {
  return (
    <div className="ceo-scroll-x overflow-x-auto">
      <table className="w-full min-w-[820px] text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 pr-3 font-normal">Session</th>
            <th className="py-2 pr-3 text-right font-normal">Registered</th>
            <th className="py-2 pr-3 text-right font-normal">Repeat</th>
            <th className="py-2 pr-3 text-right font-normal">Show rate</th>
            <th className="py-2 pr-3 text-right font-normal">Missed, booked</th>
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
                {count(r.registration.repeat)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {pct(r.showUp.showRate)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {r.showUp.salvage
                  ? `${count(r.showUp.salvage.booked)} of ${count(r.showUp.salvage.missed)}`
                  : NA}
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
                {decimal(r.sales.roasCash, 2)}x
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
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-normal">Ad</th>
                  <th className="py-2 pr-3 text-right font-normal">Spend</th>
                  <th className="py-2 pr-3 text-right font-normal">CTR</th>
                  <th className="py-2 pr-3 text-right font-normal">Visitors</th>
                  <th className="py-2 pr-3 text-right font-normal">
                    Registered
                  </th>
                  <th className="py-2 pr-3 text-right font-normal">
                    Page conversion
                  </th>
                  <th className="py-2 pr-3 text-right font-normal">
                    Cost per registration
                  </th>
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
                      {count(a.visitors)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {count(a.registrations)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {pct(a.pageConversion)}
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
      kicker="Tracking brief"
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
          <Collector p={p} />
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
                    Stage {t.stage}
                  </span>
                </span>
                <span className="pl-3.5 text-sm text-muted-foreground">
                  {t.note}
                </span>
                <span className="pl-3.5 text-xs text-muted-foreground">
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

const DOOR: Record<string, string> = {
  composio: "Composio",
  "zoom-app": "the Zoom app",
};
const doors = (via: string) =>
  via
    .split("+")
    .map(d => DOOR[d] ?? d)
    .join(" and ");

/** When hermes/webinar-pull last read Zoom and the survey, or why it could not. */
function Collector({ p }: { p: WebinarPayload }) {
  const line = (
    name: string,
    run: WebinarPayload["collector"]["zoom"] | undefined,
  ): string =>
    !run
      ? `${name}: not read yet`
      : run.ok === false
        ? `${name}: the last read failed (${run.detail ?? "no reason given"})${run.lastOkAt ? `; last good read ${dateTime(run.lastOkAt)}` : ""}`
        : `${name}: read ${run.lastOkAt ? dateTime(run.lastOkAt) : "never"}${run.via ? ` through ${doors(run.via)}` : ""}`;
  // A payload stored before the collector log existed has none: every
  // source then reads "not read yet" instead of the tab failing.
  const c: Partial<WebinarPayload["collector"]> = p.collector ?? {};
  const runs: [string, WebinarPayload["collector"]["zoom"] | undefined][] = [
    ["Zoom", c.zoom],
    ["Survey", c.typeform],
    ["HighLevel messages", c.reminders],
    ["Fathom calls", c.objections],
  ];
  const failed = runs.filter(([, run]) => run?.ok === false).length;
  // A failed read changes how the numbers read, so the summary says so while
  // the rest of the log stays folded.
  return (
    <details className="group text-xs text-muted-foreground">
      <summary className="flex cursor-pointer select-none items-center gap-2 hover:text-foreground">
        {failed ? (
          <TriangleAlert
            className="size-3.5 shrink-0"
            style={{ color: "var(--ceo-warning)" }}
            aria-hidden
          />
        ) : null}
        {failed
          ? `When each source was last read, ${plural(failed, "read")} failed`
          : "When each source was last read"}
      </summary>
      <ul className="mt-2 grid gap-1">
        {runs.map(([name, run]) => (
          <li key={name}>{line(name, run)}.</li>
        ))}
        <li>
          Zoom, the survey and Fathom are read every hour, HighLevel's messages
          every six hours.
        </li>
      </ul>
    </details>
  );
}

/**
 * The survey writes its lowest band in Arabic ("أقل من $100,000"); the
 * cockpit reads in English, and a mixed-direction label flips its dollar
 * sign, so that band is named here.
 */
function bandLabel(label: string, min: number): string {
  return min === 0 && /[\u0600-\u06FF]/.test(label) ? "Under $100K" : label;
}

/** The survey's yearly profit bands among the round's registrants. */
function ProfitBands({ q }: { q: WebinarRound["qualification"] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="grid content-start gap-2">
        <p className="text-xs text-muted-foreground">
          Yearly net profit, as {count(q.surveyAnswered)} registrants answered
          the survey
        </p>
        <BarList
          ariaLabel="Registrants by yearly net profit band"
          items={q.bands.map(b => ({
            key: b.label,
            label: bandLabel(b.label, b.min),
            value: b.n,
            sub: b.min >= q.threshold ? "Qualified" : undefined,
          }))}
        />
      </div>
      {(
        [
          ["Years in business", q.years],
          ["Type of work", q.work],
        ] as const
      ).map(([label, items]) => (
        <div className="grid content-start gap-2" key={label}>
          <p className="text-xs text-muted-foreground">{label}</p>
          {items?.length ? (
            <BarList
              ariaLabel={`Registrants by ${label.toLowerCase()}`}
              items={items.map(b => ({
                key: b.label,
                label: b.label,
                value: b.n,
              }))}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              No matched answers yet.
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * People in the room minute by minute, the two pitches marked and the three
 * biggest drops dotted. Counted at the middle of each minute from Zoom's
 * join and leave rows, our own team left out.
 */
function RoomCurve({ room, target }: { room: Room; target: number }) {
  const data = room.curve.map((people, minute) => ({ minute, people }));
  const summary = `People in the room by minute: ${count(room.peak)} at the peak, minute ${room.peakMinute}${room.pitches
    .map(
      x =>
        `; ${count(x.present)} at pitch ${x.n}, ${pct(x.retention)} of the peak`,
    )
    .join("")}.`;
  return (
    <div className="grid gap-3">
      {!!room.quality?.warnings.length && (
        <div
          role="status"
          className="rounded-lg border border-[var(--ceo-warning)]/30 bg-[var(--ceo-warning)]/5 p-3 text-xs leading-relaxed"
        >
          <p className="mb-1 font-medium">Check the attendance evidence</p>
          {room.quality.warnings.map(w => (
            <p key={w}>{w}</p>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h4 className="text-sm font-medium">People in the room, by minute</h4>
        <span className="text-xs text-muted-foreground">
          Target at pitch 1: {pct(target)} of the peak
        </span>
      </div>
      {!!room.checkpoints?.length && (
        <details className="rounded-xl bg-muted/40 p-3 text-xs">
          <summary className="cursor-pointer font-medium focus-visible:outline-2">
            Retention checkpoints and watch coverage
          </summary>
          <p className="my-3 text-muted-foreground">
            Peak compares with the largest audience. Starting group tracks
            people who joined within three minutes. Watch coverage adds their
            joined intervals, excluding gaps.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left tabular-nums [&_th]:px-2 [&_td]:px-2 [&_th:first-child]:pl-0 [&_td:first-child]:pl-0 [&_th:last-child]:pr-0 [&_td:last-child]:pr-0">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="py-2">Minute</th>
                  <th>Present</th>
                  <th>Of peak</th>
                  <th>Starting group</th>
                </tr>
              </thead>
              <tbody>
                {room.checkpoints.map(p => (
                  <tr key={p.minute} className="border-b last:border-0">
                    <td className="py-2">{p.minute}</td>
                    <td>{count(p.present)}</td>
                    <td>{pct(p.ofPeak)}</td>
                    <td>{pct(p.initialCohortRemaining)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!!room.watchBands?.length && (
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-muted-foreground">
              {room.watchBands.map(b => (
                <span key={b.percent}>
                  Watched {b.percent}%+:{" "}
                  <strong className="text-foreground">
                    {count(b.people)} people ({pct(b.share)})
                  </strong>
                </span>
              ))}
            </div>
          )}
        </details>
      )}
      <div role="figure" aria-label={summary} className="h-44 @lg:h-52">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 18, right: 12, bottom: 0, left: 0 }}
          >
            <CartesianGrid vertical={false} stroke="var(--ceo-grid)" />
            <XAxis
              dataKey="minute"
              type="number"
              domain={[0, Math.max(1, data.length - 1)]}
              tickLine={false}
              axisLine={false}
              tick={AXIS_TICK}
              tickMargin={8}
              tickFormatter={v => `${v} min`}
              minTickGap={36}
            />
            <YAxis
              width={36}
              tickLine={false}
              axisLine={false}
              tick={AXIS_TICK}
              allowDecimals={false}
              tickCount={4}
            />
            <Tooltip
              isAnimationActive={false}
              cursor={{ stroke: "var(--ceo-crosshair)", strokeWidth: 1 }}
              wrapperStyle={{ outline: "none" }}
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as
                  | { minute: number; people: number }
                  | undefined;
                if (!active || !row) return null;
                const at = room.pitches.find(x => x.minute === row.minute);
                return (
                  <div className="rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                    <p className="text-muted-foreground">
                      Minute {row.minute}
                      {at ? `, pitch ${at.n}` : ""}
                    </p>
                    <p className="font-semibold tabular-nums">
                      {count(row.people)} in the room
                    </p>
                  </div>
                );
              }}
            />
            <Area
              type="monotoneX"
              dataKey="people"
              stroke="var(--ceo-emphasis)"
              strokeWidth={2}
              fill="var(--ceo-emphasis)"
              fillOpacity={0.1}
              dot={false}
              activeDot={{
                r: 4,
                fill: "var(--ceo-emphasis)",
                stroke: "var(--ceo-surface)",
                strokeWidth: 2,
              }}
              isAnimationActive={false}
            />
            {room.pitches.map(x => (
              <ReferenceLine
                key={x.n}
                x={x.minute}
                stroke="var(--muted-foreground)"
                strokeDasharray="4 4"
                label={{
                  value: `Pitch ${x.n}`,
                  position: "top",
                  fill: "var(--muted-foreground)",
                  fontSize: 11,
                }}
              />
            ))}
            {room.drops.map(d => (
              <ReferenceDot
                key={d.minute}
                x={d.minute}
                y={room.curve[d.minute]}
                r={3.5}
                fill="var(--ceo-warning)"
                stroke="var(--ceo-surface)"
                strokeWidth={1.5}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {room.drops.length ? (
        <p className="text-xs text-muted-foreground">
          Biggest drops:{" "}
          {room.drops
            .map(d => `${count(d.lost)} left at minute ${d.minute}`)
            .join(", ")}
          .
        </p>
      ) : null}
      {room.complete ? null : (
        <p className="text-xs text-muted-foreground">
          Zoom is still processing this session's recording; the chat and the
          last joins are read again within the hour.
        </p>
      )}
      <PitchTimes room={room} />
    </div>
  );
}

/** Reads the plain sentence a ConvexError carries, else the error text. */
function errorText(e: unknown): string {
  const data = (e as { data?: unknown })?.data;
  if (data && typeof data === "object" && "message" in data)
    return String((data as { message: unknown }).message);
  if (typeof data === "string") return data;
  return e instanceof Error ? e.message : String(e);
}

/** Pitch times typed by hand, for when the chat does not show them. */
function PitchTimes({ room }: { room: Room }) {
  const setPitches = useAction(api.ceo.webinarPitch.set);
  const id = useId();
  const set = (n: 1 | 2) => {
    const x = room.pitches.find(y => y.n === n);
    return x?.source === "set" ? String(x.minute) : "";
  };
  const [open, setOpen] = useState(false);
  const [one, setOne] = useState(set(1));
  const [two, setTwo] = useState(set(2));
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const field =
    "w-24 rounded-md border bg-background px-2.5 py-1.5 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-[var(--ceo-emphasis)]";
  const minute = (v: string) => (v.trim() === "" ? null : Number(v));

  if (!open)
    return (
      <button
        type="button"
        className="w-fit text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        onClick={() => setOpen(true)}
      >
        Set the pitch times
      </button>
    );
  return (
    <form
      className="grid gap-3 rounded-xl bg-muted/40 p-4"
      onSubmit={async e => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        setSaid(null);
        try {
          await setPitches({
            sessionUuid: room.primaryUuid,
            pitch1Min: minute(one),
            pitch2Min: minute(two),
          });
          setSaid("Pitch times saved. The numbers update within a minute.");
        } catch (err) {
          setError(errorText(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-xs text-muted-foreground">
        Minutes from the start of the session. Leave pitch 1 empty to find it
        from the chat's 1s.
      </p>
      <div className="flex flex-wrap items-end gap-4">
        <div className="grid gap-1">
          <label htmlFor={`${id}-1`} className="text-xs font-medium">
            Pitch 1 starts at minute
          </label>
          <input
            id={`${id}-1`}
            className={field}
            type="number"
            inputMode="numeric"
            min={0}
            max={300}
            step={1}
            value={one}
            onChange={e => setOne(e.target.value)}
          />
        </div>
        <div className="grid gap-1">
          <label htmlFor={`${id}-2`} className="text-xs font-medium">
            Pitch 2 starts at minute
          </label>
          <input
            id={`${id}-2`}
            className={field}
            type="number"
            inputMode="numeric"
            min={0}
            max={300}
            step={1}
            value={two}
            onChange={e => setTwo(e.target.value)}
          />
        </div>
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? "Saving" : "Save pitch times"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen(false)}
        >
          Close
        </Button>
      </div>
      {said ? (
        <p className="flex items-start gap-1.5 text-xs text-foreground">
          <Check
            className="mt-0.5 size-3.5 shrink-0"
            style={{ color: "var(--ceo-good)" }}
            aria-hidden
          />
          {said}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="flex items-start gap-1.5 text-xs text-foreground"
        >
          <TriangleAlert
            className="mt-0.5 size-3.5 shrink-0"
            style={{ color: "var(--ceo-critical)" }}
            aria-hidden
          />
          {error}
        </p>
      ) : null}
    </form>
  );
}

/** Each WEBBY reminder that went out: sent, delivered, read, failed. */
function ReminderSteps({
  steps,
}: {
  steps: NonNullable<WebinarRound["reminders"]>["steps"];
}) {
  return (
    <div className="ceo-scroll-x overflow-x-auto">
      <table className="w-full min-w-[480px] text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 pr-3 font-normal">Reminder</th>
            <th className="py-2 pr-3 text-right font-normal">Sent</th>
            <th className="py-2 pr-3 text-right font-normal">Delivered</th>
            <th className="py-2 pr-3 text-right font-normal">Read</th>
            <th className="py-2 text-right font-normal">Failed</th>
          </tr>
        </thead>
        <tbody>
          {steps.map(x => (
            <tr key={x.key} className="border-b last:border-b-0">
              <td className="py-2 pr-3">{x.label}</td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {count(x.sent)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {count(x.delivered)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {count(x.read)}
              </td>
              <td className="py-2 text-right tabular-nums">
                {count(x.failed)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Objections by the number of sales calls that raised them. */
function Objections({ ob }: { ob: NonNullable<WebinarRound["objections"]> }) {
  return (
    <div className="grid max-w-xl gap-2">
      <p className="text-xs text-muted-foreground">
        Sales calls that raised each objection, of {count(ob.calls)} tagged
      </p>
      <BarList
        ariaLabel="Objections by the number of sales calls that raised them"
        items={ob.categories.map(c => ({
          key: c.key,
          label: c.label,
          value: c.calls,
          sub: `answered ${count(c.handled)} of ${count(c.raised)} times`,
        }))}
      />
    </div>
  );
}
