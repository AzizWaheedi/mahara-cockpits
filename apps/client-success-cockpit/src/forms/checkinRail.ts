import { buildBrief, formAnswer } from "@/lib/clientBrief";
import { CALL_NAMES, type Timeline, type TimelineCall } from "@/lib/csmCalls";
import { displayLabel, shortDay } from "@/lib/format";
import { kuwaitDay, kuwaitTime } from "./formTime";

/**
 * What the cockpit knows beside the 1-1 notes (docs/forms/STAGE2-CONTRACT.md
 * 8.2 and 8.5, Rail): the last 1-1 (the newest check-in form on the
 * client's timeline), the open promises the client brief finds, the next
 * booked call, and the DEFCON line's card value. The window opens in its
 * own tab and shares nothing with the client page, so the card comes from
 * cockpit_form_open's `client`. Pure.
 */

export interface RailClient {
  name: string;
  stage: string | null;
  happiness: string | null;
}

export interface RailPromise {
  side: "ours" | "theirs";
  text: string;
  source: string;
  day?: string;
}

export interface RailFacts {
  last: {
    day: string;
    defcon: string | null;
    priority: string | null;
    weOwed: number;
  } | null;
  promises: RailPromise[];
  /** Where the promises come from ("Next steps from the 14 Oct call"). */
  promisesFrom: string | null;
  next: { label: string; at: string } | null;
  /** The next booked check-in, for Next check-in. */
  nextCheckin: { at: string } | null;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Sun 25 Oct", in Kuwait. */
export function kuwaitWeekday(iso: string | null | undefined): string {
  const day = kuwaitDay(iso);
  if (!day) return "";
  const wd = WEEKDAYS[new Date(`${day}T12:00:00Z`).getUTCDay()];
  return `${wd} ${shortDay(day)}`;
}

/** "Sun 2 Nov, 10:30", in Kuwait. */
export function kuwaitWhen(iso: string | null | undefined): string {
  const d = kuwaitWeekday(iso);
  return d ? `${d}, ${kuwaitTime(iso)}` : "";
}

/** The DEFCON line's card value (8.5): "On the card: Happy". */
export function cardHappiness(happiness: string | null | undefined): string {
  const h = displayLabel(happiness);
  return h ? `On the card: ${h}` : "Not set on the card";
}

const asMs = (iso?: string | null) => {
  const ms = Date.parse(String(iso ?? ""));
  return Number.isFinite(ms) ? ms : Number.NaN;
};

const GONE = new Set(["cancelled", "gone", "no_show"]);

function upcoming(calls: TimelineCall[], now: number): TimelineCall[] {
  return calls
    .filter(
      c =>
        !GONE.has(c.status) &&
        c.source === "ghl_appointment" &&
        asMs(c.startsAt) > now,
    )
    .sort((a, b) => asMs(a.startsAt) - asMs(b.startsAt));
}

export function railFacts({
  timeline,
  client,
  now,
}: {
  timeline: Timeline | null;
  client: RailClient;
  now: number;
}): RailFacts {
  const forms = (timeline?.forms ?? [])
    .filter(f => f.kind === "checkin")
    .sort((a, b) => asMs(b.submittedAt) - asMs(a.submittedAt));
  const newest = forms[0];
  let promises: RailPromise[] = [];
  let promisesFrom: string | null = null;
  let weOwed = 0;
  if (timeline)
    try {
      const brief = buildBrief({
        now,
        client: { ...client },
        timeline,
        digests: [],
      });
      const tag =
        (side: RailPromise["side"]) =>
        (l: (typeof brief.promises.ours)[number]) => ({
          side,
          text: l.text,
          source: l.source,
          ...(l.day ? { day: l.day } : {}),
        });
      promises = [
        ...brief.promises.ours.map(tag("ours")),
        ...brief.promises.theirs.map(tag("theirs")),
      ];
      weOwed = brief.promises.ours.length;
      promisesFrom = brief.promises.from ?? null;
    } catch {
      // The rail still shows the last 1-1 and the next call.
    }
  const calls = upcoming(timeline?.calls ?? [], now);
  const next = calls[0];
  const checkin = calls.find(c => c.kind === "checkin");
  return {
    last: newest
      ? {
          day: kuwaitDay(newest.submittedAt) ?? "",
          defcon: formAnswer(newest, /defcon/i) || null,
          priority: formAnswer(newest, /priority/i) || null,
          weOwed,
        }
      : null,
    promises,
    promisesFrom,
    next: next?.startsAt
      ? {
          label: CALL_NAMES[next.kind] ?? "Call",
          at: next.startsAt,
        }
      : null,
    nextCheckin: checkin?.startsAt ? { at: checkin.startsAt } : null,
  };
}
