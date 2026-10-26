import type { TimelineForm } from "@/lib/csmCalls";
import type { FormEntry, OnboardingRow } from "@/lib/onboardingCore";
import type {
  Already,
  FormConfig,
  FormContext,
  FormSend,
  NoticeView,
} from "./formConfig";
import { atWhen, kuwaitDay, kuwaitTime } from "./formTime";

/**
 * After a send: the trail of stops, worked out again from the reads each
 * time (KICKOFF.md 4). Nothing about the trail is stored; a later read of
 * the same data gives the same trail. Pure, with the server's clock. The
 * last stop is the cockpit's own Slack notice (docs/forms/STAGE1-CONTRACT.md
 * 6.1), only on a screen that reads the notices.
 */

export type StopKey = "sent" | "typeform" | "card" | "link" | "slack";

export interface TrailStop {
  key: StopKey;
  /** In the tense of its state: "Make updates the card", "Make updated the card at 14:03". */
  label: string;
  done: boolean;
  /** A line under the label, when it adds something. */
  line: string | null;
  /** It stopped and needs a person: "Not posted. … Tell the tech lead." */
  problem?: boolean;
  /** A problem's own words ("Not posted."), drawn in the warning tone before the reason. */
  lead?: string;
  /** The Slack stop's place: "#csm-general", or "Slack" while the channel is not known. */
  where?: string;
  /** Done, but not a success: a notice that was turned off or skipped. */
  quiet?: boolean;
  /** The stop could not be read: neither done nor the current stop. */
  unread?: boolean;
  /** A link beside the label: "Open in Slack". */
  link?: { href: string; label: string };
}

/** The send's Slack notice as the trail reads it; undefined: no Slack stop. */
export interface SlackRead {
  notice: NoticeView | null;
  /** The last read of the notices failed, in plain words. */
  unread?: string | null;
}

/**
 * The send's own notice from the context: the config's notice kind with
 * this response's ID. Undefined when the config has no notice or this
 * screen does not read them (the deck), so the trail has no Slack stop.
 */
export function sendNotice(
  cfg: Pick<FormConfig, "after">,
  ctx: Pick<FormContext, "notices" | "failed">,
  responseId: string,
): SlackRead | undefined {
  const want = cfg.after.notice;
  if (!want) return undefined;
  if (!ctx.notices && !ctx.failed.notices) return undefined;
  const notice =
    ctx.notices?.notices.find(
      n => n.kind === want.kind && n.responseId === responseId,
    ) ?? null;
  return { notice, unread: ctx.failed.notices ?? null };
}

/** A reason inside a sentence: its own last full stop goes. */
const clause = (s: string) => s.trim().replace(/\.\s*$/, "");

/** "Tell the tech lead.", unless the reason already says who to tell. */
const tell = (reason: string) =>
  /tech lead/i.test(reason) ? "" : " Tell the tech lead.";

/** A reason as a sentence of its own, after the stop's own lead. */
const sentence = (reason: string) =>
  `${reason.charAt(0).toUpperCase()}${reason.slice(1)}.`;

/**
 * Where a notice goes, in words: its channel's name ("#csm-general"), which
 * the server gives for a queued notice from Settings as they are now (D17),
 * or "Slack" while it is not known. Never a channel written in code.
 */
export function noticeWhere(n: Pick<NoticeView, "channel"> | null): string {
  return n?.channel?.name ? `#${n.channel.name}` : "Slack";
}

/** The Slack stop, by the notice's state (STAGE1-CONTRACT.md 6.1). */
export function slackStop(
  cfg: Pick<FormConfig, "after">,
  slack: SlackRead,
): TrailStop {
  const want = cfg.after.notice;
  const n = slack.notice;
  const where = noticeWhere(n);
  const reason = clause(n?.reason ?? "") || "no reason was given";
  const base = { key: "slack" as const, line: null, where };
  const pending = want ? want.pending(where) : `The team hears in ${where}`;
  if (!n) {
    if (slack.unread)
      return {
        ...base,
        label:
          "The cockpit could not read the Slack notice just now. Check now reads it again.",
        done: false,
        unread: true,
      };
    return {
      ...base,
      label: pending,
      done: false,
      line: want?.line ?? null,
    };
  }
  switch (n.state) {
    case "posted":
      return {
        ...base,
        label: `Posted in ${where} at ${kuwaitTime(n.at)}`,
        done: true,
        line:
          n.variant === "late"
            ? "It says the card was not updated, so the team checks it."
            : null,
        link: n.permalink
          ? { href: n.permalink, label: "Open in Slack" }
          : undefined,
      };
    case "queued":
    case "sending":
      return {
        ...base,
        label: pending,
        done: false,
        line: want?.line ?? null,
      };
    case "failed":
      return {
        ...base,
        label: `Not posted. ${sentence(reason)}${tell(reason)}`,
        lead: "Not posted.",
        done: false,
        problem: true,
      };
    // It may have reached Slack; the sender never posts it twice.
    case "unknown":
      return {
        ...base,
        label: `Not confirmed. ${sentence(reason)}${tell(reason)}`,
        lead: "Not confirmed.",
        done: false,
        problem: true,
      };
    case "muted":
      return {
        ...base,
        label: "Not posted: the kickoff notice is off in Settings.",
        done: true,
        quiet: true,
      };
    case "skipped":
      return {
        ...base,
        label: `Not posted. ${sentence(reason)}`,
        done: true,
        quiet: true,
      };
  }
}

export interface Trail {
  stops: TrailStop[];
  /** The first stop not done yet; null once every stop is. */
  current: StopKey | null;
  /** After the late limit: who has not done their part. */
  late: "make" | "typeform" | null;
  lateLine: string | null;
}

/** The card stages that come with or after Brand Blueprint Booked. */
const BLUEPRINT_ON =
  /brand blueprint booked|launch booked|ready for launch|^\s*active\s*$/i;

/**
 * Make 12 has done its part: the card is at Brand Blueprint Booked (or a
 * later stage) and ClickUp says the card changed at or after the send. A
 * card already at that stage counts only with a newer change.
 */
export function kickoffCardDone(
  row: Pick<OnboardingRow, "client_status" | "card_updated_at">,
  sentAt: string,
): boolean {
  const updated = Date.parse(String(row.card_updated_at ?? ""));
  const sent = Date.parse(sentAt);
  return (
    BLUEPRINT_ON.test(String(row.client_status ?? "")) &&
    Number.isFinite(updated) &&
    Number.isFinite(sent) &&
    updated >= sent
  );
}

/** This response as Typeform lists it: the mirror's entry, or the form history's. */
function listed(
  ctx: Pick<FormContext, "row" | "timeline">,
  key: FormConfig["key"],
  responseId: string,
): { at: string | null } | null {
  const entry = (
    ctx.row.forms as Record<string, FormEntry | undefined> | undefined
  )?.[key];
  if (entry?.response_id === responseId)
    return { at: entry.submitted_at ?? null };
  const hist = ctx.timeline?.forms.find(f => f.token === responseId);
  return hist ? { at: hist.submittedAt ?? null } : null;
}

/** Typeform lists this response: the mirror has it, or the form history does. */
export function typeformHas(
  ctx: Pick<FormContext, "row" | "timeline">,
  key: FormConfig["key"],
  responseId: string,
): boolean {
  return listed(ctx, key, responseId) !== null;
}

export function trailFor(
  cfg: Pick<FormConfig, "key" | "after" | "title">,
  ctx: Pick<FormContext, "row" | "timeline">,
  /** `noted: false` once the cockpit's note of the send has failed. */
  send: Pick<FormSend, "responseId" | "sentAt"> & { noted?: boolean },
  nowMs: number,
  /** The send's notice (sendNotice); undefined: no Slack stop. */
  slack?: SlackRead,
): Trail {
  const seen = listed(ctx, cfg.key, send.responseId);
  const typeform = seen !== null;
  const card = cfg.after.cardDone(ctx.row, send.sentAt);
  const back = cfg.after.linkBack;
  const linked = Boolean(card && back && ctx.row.links?.[back.key]);
  const sentTime = kuwaitTime(send.sentAt);
  const stops: TrailStop[] = [
    {
      key: "sent",
      label: "Sent",
      done: true,
      line:
        send.noted === false
          ? `Sent at ${sentTime}. Not noted in the cockpit yet.`
          : `Sent from the cockpit at ${sentTime}.`,
    },
    typeform || card
      ? {
          key: "typeform",
          label: "Typeform has it",
          done: true,
          line: seen?.at ? `Submitted at ${kuwaitTime(seen.at)}.` : null,
        }
      : {
          key: "typeform",
          label: "Typeform lists it",
          done: false,
          line: "Usually within a minute.",
        },
    card
      ? {
          key: "card",
          label: `Make updated the card at ${kuwaitTime(ctx.row.card_updated_at)}`,
          done: true,
          line: cfg.after.cardLine(ctx.row),
        }
      : {
          key: "card",
          label: "Make updates the card",
          done: false,
          line: "Usually within a minute of Typeform.",
        },
  ];
  if (back)
    stops.push({
      key: "link",
      label: linked ? back.label : back.pending,
      done: linked,
      line: null,
    });
  if (slack && cfg.after.notice) stops.push(slackStop(cfg, slack));
  // A stop that could not be read is not where the trail stands.
  const current = stops.find(s => !s.done && !s.unread)?.key ?? null;

  const sent = Date.parse(send.sentAt);
  const overdue =
    Number.isFinite(sent) && nowMs - sent >= cfg.after.lateAfterMin * 60_000;
  let late: Trail["late"] = null;
  let lateLine: string | null = null;
  if (overdue && !card) {
    const name = cfg.title.toLowerCase();
    if (typeform) {
      late = "make";
      lateLine = cfg.after.lateMake;
    } else {
      late = "typeform";
      lateLine = `Typeform has not listed this ${name} after ${cfg.after.lateAfterMin} minutes. Look for it in Typeform's results before anything else, and do not send it again.`;
    }
  }
  return { stops, current, late, lateLine };
}

/**
 * The after panel's headline and the line under it, from the trail as it
 * stands: the late sentence while a step is late; once Make has done its
 * part, the done sentence; the "team hears" line only while the Slack stop
 * still waits (once it is posted, off or stopped, the stop itself says so).
 */
export function afterLines(
  cfg: Pick<FormConfig, "after">,
  trail: Pick<Trail, "stops" | "late">,
): { say: string; sub: string | null } {
  if (trail.late) return { say: cfg.after.lateSay[trail.late], sub: null };
  const cardDone = trail.stops
    .filter(s => s.key === "card" || s.key === "link")
    .every(s => s.done);
  const slack = trail.stops.find(s => s.key === "slack");
  const waits = slack ? !slack.done && !slack.problem : !cardDone;
  return {
    say: cardDone ? cfg.after.doneSay : cfg.after.say,
    sub: waits ? cfg.after.sub(slack?.where ?? "Slack") : null,
  };
}

/** Every stop done, and none of them quietly (a notice off or skipped is not a success). */
export const trailAllDone = (trail: Pick<Trail, "stops">) =>
  trail.stops.every(s => s.done && !s.quiet);

/** The trail in a few words, for a folded panel: "Kickoff sent · waiting for Make". */
export function trailSummary(
  cfg: Pick<FormConfig, "title" | "after">,
  trail: Pick<Trail, "current" | "late"> & { stops?: TrailStop[] },
): string {
  const head = `${cfg.title} sent`;
  const slack = trail.stops?.find(s => s.key === "slack");
  // A stop that needs a person outranks every wait: on a phone the fold is all
  // the CSM sees, so the action leads and fits at 320 px (the window's own
  // header already names the form, and the trail says it was sent).
  if (slack?.problem)
    return `${slack.lead === "Not confirmed." ? "Not confirmed" : "Not posted"} in Slack · tell the tech lead`;
  if (trail.late === "make") return `${head} · Make is late`;
  if (trail.late === "typeform") return `${head} · Typeform is late`;
  switch (trail.current) {
    case null:
      if (!slack) return `${head} · every step done`;
      if (slack.unread) return `${head} · Slack notice not read`;
      return slack.quiet
        ? `${head} · not posted in Slack`
        : `${head} · posted in Slack`;
    case "typeform":
      return `${head} · waiting for Typeform`;
    case "card":
      return `${head} · waiting for Make`;
    case "link":
      return `${head} · waiting for ${cfg.after.linkBack?.short ?? "Make"}`;
    case "slack":
      return `${head} · waiting for the Slack notice`;
    default:
      return head;
  }
}

/** A form history entry as the answers sheet reads it. */
export function historyEntry(f: TimelineForm): FormEntry {
  const text = (v: unknown): string =>
    v === null || v === undefined
      ? ""
      : Array.isArray(v)
        ? v.map(text).filter(Boolean).join(", ")
        : typeof v === "boolean"
          ? v
            ? "Yes"
            : "No"
          : typeof v === "object"
            ? JSON.stringify(v)
            : String(v);
  return {
    form_id: f.formId,
    response_id: f.token,
    submitted_at: f.submittedAt,
    answers: f.answers
      .map((a, i) => ({
        ref: a.ref ?? `answer-${i}`,
        title: String(a.title ?? ""),
        value: text(a.value),
      }))
      .filter(a => a.value),
  };
}

/**
 * A kickoff already on record (KICKOFF.md 4.4): on the card's record (either
 * form version), sent from the cockpit, or in the form history.
 */
export function kickoffAlready(
  ctx: Pick<FormContext, "row" | "sends" | "timeline">,
): Already | null {
  const k = ctx.row.forms?.kickoff;
  if (k) return { at: k.submitted_at, by: null, from: "record", entry: k };
  const send = ctx.sends.find(s => s.formKey === "kickoff");
  if (send)
    return { at: send.sentAt, by: send.sentBy, from: "cockpit", entry: null };
  const hist = ctx.timeline?.forms.find(
    f => f.kind === "kickoff" || f.kind === "kickoff_old",
  );
  if (hist)
    return {
      at: hist.submittedAt,
      by: null,
      from: "history",
      entry: historyEntry(hist),
    };
  return null;
}

/**
 * The one-line state for the Onboarding panel's kickoff row: "Sent from the
 * cockpit today at 14:02 by Lina. Make updated the card at 14:03." The day
 * is said, so the line still reads right the next day.
 */
export function sendLine(
  cfg: { after: Pick<FormConfig["after"], "cardDone"> },
  send: Pick<FormSend, "sentAt" | "sentBy">,
  row: OnboardingRow | null,
  nowIso: string,
): string {
  const by = send.sentBy ? ` by ${send.sentBy}` : "";
  const first = `Sent from the cockpit ${atWhen(send.sentAt, nowIso)}${by}.`;
  if (row && cfg.after.cardDone(row, send.sentAt)) {
    const sameDay = kuwaitDay(row.card_updated_at) === kuwaitDay(send.sentAt);
    return `${first} Make updated the card ${
      sameDay
        ? `at ${kuwaitTime(row.card_updated_at)}`
        : atWhen(row.card_updated_at, nowIso)
    }.`;
  }
  return first;
}
