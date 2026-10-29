import { displayLabel, shortDay } from "@/lib/format";
import type { EffectView } from "./checkinClient";
import type { Answers } from "./checkinForm";
import { callOf } from "./checkinForm";
import { kuwaitDay, kuwaitTime } from "./formTime";

/**
 * After a send: every planned effect as one stop of the trail, in plain
 * words (docs/forms/STAGE2-CONTRACT.md 8.5, The trail). Every owner and
 * state is mapped here, although 2a only meets `shadow` and `skipped`. A
 * quiet stop (skipped) never counts as done, and neither does a plan: only
 * a delivery is done. Pure.
 */

export type StopTone = "plan" | "wait" | "good" | "warn" | "bad" | "quiet";

export interface TrailStop {
  /** The effect's key, or "card" for the card's three fields together. */
  key: string;
  label: string;
  line: string;
  /** A second line under it (a field the card kept). */
  sub?: string;
  tone: StopTone;
  /** Delivered. Never a plan, never a quiet stop. */
  done: boolean;
  quiet: boolean;
  /** Failed or not confirmed: a person looks at it. */
  problem: boolean;
  link?: { href: string; label: string };
}

export interface TrailContext {
  taskId: string;
  clientName: string;
  /** The answers as sent: the card fields' line reads them. */
  answers: Answers;
  submittedAt: string | null;
}

/** The channel the grade posts to (7.1 grade_notice's target). */
export const GRADE_CHANNEL = "C09SVG6FHGU";

const CARD_FIELDS = new Set(["happiness", "last_poc", "last_checkin_call"]);
const FINAL = new Set(["dry_run", "delivered", "skipped", "failed"]);

/** A reason inside a sentence: its own full stop goes, the sentence adds one. */
const clause = (s: string | null | undefined) =>
  String(s ?? "")
    .trim()
    .replace(/\.\s*$/, "");

/** What Make does instead, while it owns an effect (owner `make`, skipped). */
export const MAKE_DOES: Record<string, string> = {
  call_form: "The Typeform keeps the notes until the switch-over.",
  call_match: "The call worker matches the recording until the switch-over.",
  todo_comment: "Make posts the to-do comment until the switch-over.",
  happiness: "Make sets Client Happiness until the switch-over.",
  last_poc: "Make sets Last POC until the switch-over.",
  last_checkin_call:
    "Make does not set Last Check-in Call; the cockpit sets it after the switch-over.",
  grade_notice: "Make posts the call grade until the switch-over.",
  recap: "Make sends the recap until the switch-over.",
};

function working(e: EffectView, ctx: TrailContext): string {
  switch (e.key) {
    case "todo_comment":
      return "Posting the to-do comment on the card…";
    case "happiness":
    case "last_poc":
    case "last_checkin_call":
      return "Updating the card…";
    case "grade_notice":
      return e.state === "queued"
        ? "Waiting to post in #client-call-feedback."
        : "Grading the call…";
    case "recap":
      return "Drafting the client's recap…";
    case "call_form":
      return "Saving the notes…";
    case "call_match":
      return `Putting the recording on ${ctx.clientName || "this client"}…`;
    default:
      return "Working on it…";
  }
}

/** The days the card's dates take (7.1 call_day and checkin_day). */
export function cardDays(
  answers: Answers,
  submittedAt: string | null,
): { poc: string | null; checkin: string | null } {
  const call = callOf(answers.call);
  const end =
    call?.kind === "fathom"
      ? (call.endsAt ?? call.startsAt)
      : call?.kind === "booking"
        ? call.startsAt
        : null;
  const start =
    call?.kind === "fathom" || call?.kind === "booking" ? call.startsAt : null;
  return {
    poc: kuwaitDay(end ?? submittedAt),
    checkin: kuwaitDay(start ?? submittedAt),
  };
}

/**
 * The card's three fields, once delivered, as one line; `only` leaves out
 * a field the card kept (its own date was newer).
 */
export function cardLine(
  answers: Answers,
  submittedAt: string | null,
  only: ReadonlySet<string> = CARD_FIELDS,
): string {
  const days = cardDays(answers, submittedAt);
  const parts: string[] = [];
  if (only.has("happiness") && typeof answers.defcon === "string")
    parts.push(`Client Happiness: ${displayLabel(answers.defcon)}`);
  if (only.has("last_poc") && days.poc)
    parts.push(`Last POC ${shortDay(days.poc)}`);
  if (only.has("last_checkin_call") && days.checkin)
    parts.push(`Last check-in call ${shortDay(days.checkin)}`);
  return parts.length ? `${parts.join(" · ")}.` : "The card is up to date.";
}

/** One effect as one stop. */
export function stopFor(e: EffectView, ctx: TrailContext): TrailStop {
  const base = { key: e.key, label: e.label };
  const stop = (
    line: string,
    tone: StopTone,
    more: Partial<TrailStop> = {},
  ): TrailStop => ({
    ...base,
    line,
    tone,
    done: false,
    quiet: false,
    problem: false,
    ...more,
  });
  if (e.state === "skipped")
    return stop(
      e.owner === "make"
        ? (MAKE_DOES[e.key] ?? "Make does this until the switch-over.")
        : e.reason?.trim() || "Not needed for these notes.",
      "quiet",
      { quiet: true },
    );
  if (e.state === "dry_run") return stop(e.lines[0] ?? e.label, "plan");
  // Only a cockpit effect moves past a plan (the table's CHECK); the rest
  // read as what they are if one ever does.
  if (e.owner !== "cockpit")
    return stop(
      e.owner === "make"
        ? (MAKE_DOES[e.key] ?? "Make does this until the switch-over.")
        : "A shadow run writes the plan only.",
      "quiet",
      { quiet: true },
    );
  switch (e.state) {
    case "planned":
    case "queued":
      return stop(working(e, ctx), "wait");
    case "failed":
      return stop(
        `Not done: ${clause(e.reason) || "the cockpit gave no reason"}. Tell the tech lead.`,
        "bad",
        { problem: true },
      );
    case "unknown":
      return stop(
        `Not confirmed: ${clause(e.reason) || "no answer came back"}. The cockpit checks before it tries again.`,
        "warn",
        { problem: true },
      );
    case "delivered": {
      const at = kuwaitTime(e.at);
      if (e.key === "todo_comment")
        return stop(`On the card at ${at}.`, "good", {
          done: true,
          link: {
            href: `https://app.clickup.com/t/${encodeURIComponent(ctx.taskId)}`,
            label: "Open the card",
          },
        });
      if (e.key === "grade_notice")
        return stop(`Grade posted in #client-call-feedback at ${at}.`, "good", {
          done: true,
          link: {
            href: `https://slack.com/app_redirect?channel=${GRADE_CHANNEL}`,
            label: "Open in Slack",
          },
        });
      if (CARD_FIELDS.has(e.key))
        return stop(
          cardLine(ctx.answers, ctx.submittedAt, new Set([e.key])),
          "good",
          { done: true },
        );
      if (e.key === "call_form")
        return stop("Notes saved.", "good", { done: true });
      if (e.key === "call_match")
        return stop(
          `The recording is on ${ctx.clientName || "this client"} now.`,
          "good",
          { done: true },
        );
      if (e.key === "recap")
        return stop("Waiting for your approval in the cockpit.", "good", {
          done: true,
        });
      return stop("Done.", "good", { done: true });
    }
  }
  return stop(e.lines[0] ?? e.label, "plan");
}

/**
 * The trail in the registry's order. The card's three fields are one stop
 * once the cockpit delivers them (one line, one place on the card); a
 * shadow run keeps one plan per effect, so all eight are shown.
 */
export function trailStops(
  effects: EffectView[],
  ctx: TrailContext,
): TrailStop[] {
  const out: TrailStop[] = [];
  const card = effects.filter(
    e => e.owner === "cockpit" && CARD_FIELDS.has(e.key),
  );
  let cardDone = false;
  for (const e of effects) {
    if (!(e.owner === "cockpit" && CARD_FIELDS.has(e.key))) {
      out.push(stopFor(e, ctx));
      continue;
    }
    if (cardDone) continue;
    cardDone = true;
    out.push(cardStop(card, ctx));
  }
  return out;
}

function cardStop(card: EffectView[], ctx: TrailContext): TrailStop {
  const stops = card.map(e => stopFor(e, ctx));
  const worst =
    stops.find(s => s.tone === "bad") ??
    stops.find(s => s.tone === "warn") ??
    stops.find(s => s.tone === "wait");
  const kept = stops
    .filter(s => s.quiet)
    .map(s => s.line)
    .join(" ");
  const base = {
    key: "card",
    label: "Card fields",
    quiet: false,
  };
  if (worst)
    return {
      ...base,
      line: worst.line,
      tone: worst.tone,
      done: false,
      problem: worst.problem,
    };
  if (stops.every(s => s.quiet))
    return {
      ...base,
      line: kept,
      tone: "quiet",
      done: false,
      quiet: true,
      problem: false,
    };
  const delivered = new Set(
    card.filter(e => e.state === "delivered").map(e => e.key),
  );
  return {
    ...base,
    line: cardLine(ctx.answers, ctx.submittedAt, delivered),
    ...(kept ? { sub: kept } : {}),
    tone: "good",
    done: true,
    problem: false,
  };
}

/** The line under a shadow run's trail. */
export function trailNote(effects: EffectView[]): string | null {
  return effects.some(e => e.owner === "shadow" && e.state === "dry_run")
    ? "Make still does all of this from the Typeform until the switch-over."
    : null;
}

/** Nothing on the trail can still change by itself. */
export function trailSettled(effects: EffectView[]): boolean {
  return effects.every(e => FINAL.has(e.state));
}

/** Every stop is delivered; a quiet stop or a plan is never done. */
export function trailDone(stops: TrailStop[]): boolean {
  return stops.length > 0 && stops.every(s => s.done);
}
