import type { TimelineForm } from "@/lib/csmCalls";
import type { FormEntry, OnboardingRow } from "@/lib/onboardingCore";
import type { Already, FormConfig, FormContext, FormSend } from "./formConfig";
import { atWhen, kuwaitDay, kuwaitTime } from "./formTime";

/**
 * After a send: the trail of four stops, worked out again from the reads
 * each time (KICKOFF.md 4). Nothing about the trail is stored; a later read
 * of the same data gives the same trail. Pure, with the server's clock.
 */

export type StopKey = "sent" | "typeform" | "card" | "link";

export interface TrailStop {
  key: StopKey;
  /** In the tense of its state: "Make updates the card", "Make updated the card at 14:03". */
  label: string;
  done: boolean;
  /** A line under the label, when it adds something. */
  line: string | null;
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
  const current = stops.find(s => !s.done)?.key ?? null;

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

/** The trail in a few words, for a folded panel: "Kickoff sent · waiting for Make". */
export function trailSummary(
  cfg: Pick<FormConfig, "title" | "after">,
  trail: Pick<Trail, "current" | "late">,
): string {
  const head = `${cfg.title} sent`;
  if (trail.late === "make") return `${head} · Make is late`;
  if (trail.late === "typeform") return `${head} · Typeform is late`;
  switch (trail.current) {
    case null:
      return `${head} · every step done`;
    case "typeform":
      return `${head} · waiting for Typeform`;
    case "card":
      return `${head} · waiting for Make`;
    case "link":
      return `${head} · waiting for ${cfg.after.linkBack?.short ?? "Make"}`;
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
