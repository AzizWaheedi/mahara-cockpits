import type { TimelineForm } from "@/lib/csmCalls";
import type { FormEntry, OnboardingRow } from "@/lib/onboardingCore";
import type { Already, FormConfig, FormContext, FormSend } from "./formConfig";
import { kuwaitTime } from "./formTime";

/**
 * After a send: the trail of four stops, worked out again from the reads
 * each time (KICKOFF.md 4). Nothing about the trail is stored; a later read
 * of the same data gives the same trail. Pure, with the server's clock.
 */

export type StopKey = "sent" | "typeform" | "card" | "link";

export interface TrailStop {
  key: StopKey;
  label: string;
  done: boolean;
  line: string;
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

/** Typeform lists this response: the mirror has it, or the form history does. */
export function typeformHas(
  ctx: Pick<FormContext, "row" | "timeline">,
  key: FormConfig["key"],
  responseId: string,
): boolean {
  const entry = ctx.row.forms?.[key as "kickoff" | "blueprint"];
  if (entry?.response_id === responseId) return true;
  return Boolean(ctx.timeline?.forms.some(f => f.token === responseId));
}

export function trailFor(
  cfg: Pick<FormConfig, "key" | "after" | "title">,
  ctx: Pick<FormContext, "row" | "timeline">,
  send: Pick<FormSend, "responseId" | "sentAt">,
  nowMs: number,
): Trail {
  const typeform = typeformHas(ctx, cfg.key, send.responseId);
  const card = cfg.after.cardDone(ctx.row, send.sentAt);
  const back = cfg.after.linkBack;
  const linked = Boolean(card && back && ctx.row.links?.[back.key]);
  const stops: TrailStop[] = [
    {
      key: "sent",
      label: "Sent",
      done: true,
      line: `Sent from the cockpit at ${kuwaitTime(send.sentAt)}.`,
    },
    {
      key: "typeform",
      label: "Typeform has it",
      done: typeform || card,
      line:
        typeform || card
          ? "Typeform has it."
          : "Waiting for Typeform to list it.",
    },
    {
      key: "card",
      label: "Make updated the card",
      done: card,
      line: card
        ? cfg.after.cardLine(ctx.row)
        : "Waiting for Make to update the card.",
    },
  ];
  if (back)
    stops.push({
      key: "link",
      label: back.label,
      done: linked,
      line: linked ? `${back.label}.` : back.waiting,
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
      lateLine = `Make has not updated the card in ${cfg.after.lateAfterMin} minutes. The ${name} is safe in Typeform. Open the card and look for the ${cfg.title} Handoff comment; if it is not there, tell the tech lead. Do not send the ${name} again.`;
    } else {
      late = "typeform";
      lateLine = `Typeform has not listed this ${name} after ${cfg.after.lateAfterMin} minutes. Look for it in Typeform's results before anything else, and do not send it again.`;
    }
  }
  return { stops, current, late, lateLine };
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
 * cockpit at 14:02 by Lina. Make updated the card at 14:03."
 */
export function sendLine(
  cfg: { after: Pick<FormConfig["after"], "cardDone"> },
  send: Pick<FormSend, "sentAt" | "sentBy">,
  row: OnboardingRow | null,
): string {
  const by = send.sentBy ? ` by ${send.sentBy}` : "";
  const first = `Sent from the cockpit at ${kuwaitTime(send.sentAt)}${by}.`;
  if (row && cfg.after.cardDone(row, send.sentAt))
    return `${first} Make updated the card at ${kuwaitTime(row.card_updated_at)}.`;
  return first;
}
