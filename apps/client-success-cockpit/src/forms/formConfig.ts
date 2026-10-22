import type { Timeline } from "@/lib/csmCalls";
import {
  FORMS,
  type FormEntry,
  type OnboardingRow,
  onboardingFormLink,
} from "@/lib/onboardingCore";
import type { DeckSources } from "@/present/sources";
import { kickoffRail } from "./formRail";
import { kickoffAlready, kickoffCardDone } from "./formStatus";
import { buildHidden, KICKOFF_HIDDEN, type Prefill } from "./prefill";

/**
 * The reusable form panel's configuration (docs/csm-forms/KICKOFF.md 2).
 * Everything form-specific lives here; FormPanel never names a form. The
 * kickoff is the first configuration; the Brand Blueprint (creative
 * director cockpit) and the 1-1 check-in are later objects of the same
 * shape (KICKOFF.md 2.6 and 2.7). Pure: no React, no I/O.
 */

export type FormKey = "kickoff" | "blueprint" | "checkin";

/** One send the cockpit noted (cockpit_csm_form_sends_read). */
export interface FormSend {
  responseId: string;
  formKey: FormKey;
  formId: string;
  taskId: string;
  clientName: string;
  hiddenKeys: string[];
  /** Set by the server: an earlier send, or a response already on record. */
  second: boolean;
  /** The sender's first name, when the seat has one. */
  sentBy: string | null;
  sentByEmail: string;
  sentAt: string;
}

/** Everything the panel reads about one client, already gated. */
export interface FormContext {
  /** The route key: the card ID the gate checked. */
  taskId: string;
  /** cockpit_csm_onboarding_read, this card. */
  row: OnboardingRow;
  /** cockpit_csm_deck_sources: offer, HighLevel, prep. Null when not read. */
  deck: DeckSources | null;
  /** cockpit_csm_client_timeline: calls and form history. Null when not read. */
  timeline: Timeline | null;
  /** cockpit_csm_form_sends_read, newest first. */
  sends: FormSend[];
  me: { email: string; firstName: string | null };
  /** The server's clock at the last read, and this browser's clock then. */
  now: string;
  readAt: number;
  /** A side read that failed, in plain words: only its part says so. */
  failed: { deck?: string; timeline?: string; sends?: string };
}

/** A response already on record for this client. */
export interface Already {
  /** When it went in. */
  at: string | null;
  by: string | null;
  from: "record" | "cockpit" | "history";
  /** Its answers, when the record or the history has them. */
  entry: FormEntry | null;
}

/** One row of the side panel. A row with no value always says why. */
export interface RailRow {
  id: string;
  label: string;
  value: string | null;
  /** A short tag: "Onboarding form, 13 Oct", "ClickUp card", "Fathom, today 13:10". */
  source: string | null;
  /** A copy button for the value. */
  copy?: boolean;
  /** Said when the value is null: "Not on record." */
  missing?: string;
  /** A quiet line under the value (a hint, never a number to type). */
  hint?: string;
  /** The value is a link; `linkLabel` is what the link says. */
  href?: string;
  linkLabel?: string;
  /** The value is a suggestion to pick in the form ("Pick: Interior design"). */
  pick?: boolean;
  /** A "Check again" button that re-reads the call store. */
  recheck?: boolean;
  required?: boolean;
  /** The form's choices, the suggested one ringed, the client's words under each. */
  choices?: {
    options: { label: string; own: string[] }[];
    picked: string | null;
  };
  /** "What the form carries": every hidden value with its source. */
  carries?: {
    key: string;
    label: string;
    value: string | null;
    source: string | null;
  }[];
}

export interface RailPart {
  id: string;
  title: string;
  rows: RailRow[];
  /** Warn dots ("Still missing"). */
  tone?: "warn";
  /** Folded by default ("From the sale"). */
  fold?: boolean;
  /** This part's read failed: said once, the rest still shows. */
  problem?: string;
}

export interface FormConfig {
  key: FormKey;
  formId: string;
  /** "Kickoff". */
  title: string;
  idField: "onboarding_client_id" | "task_id";
  /** Typeform's results, for a response that went astray. */
  resultsUrl: string;
  /** The hidden values, with where each came from. Built once when the form opens. */
  hidden(ctx: FormContext): Prefill;
  /** Side-panel parts, in the form's order. */
  rail(ctx: FormContext, prefill: Prefill): RailPart[];
  /** A response already on record for this client, or null. */
  already(ctx: FormContext): Already | null;
  /** What a second send repeats, for the warning before it. */
  again: string;
  /** What the form's submit sets off, in plain words. */
  makeDoes: string[];
  /** Typeform's ending button: open a cockpit action instead of redirecting. */
  ending: "book-blueprint" | "none";
  /** Partial submit point (the Blueprint only, KICKOFF.md 2.6). */
  partial?: { afterRef: string; say: string };
  after: {
    /** "Kickoff sent. Make is booking the Brand Blueprint." */
    say: string;
    /** The muted line under it. */
    sub: string;
    /** One-card refreshes after a send, in seconds. */
    checksAtSec: number[];
    /** When the trail says Make or Typeform is late. */
    lateAfterMin: number;
    /** Make has done its part on the card since the send. */
    cardDone(row: OnboardingRow, sentAt: string): boolean;
    /** The card stop's line once it is done. */
    cardLine(row: OnboardingRow): string;
    /** The last stop: a link Make writes back, when there is one. */
    linkBack?: { key: "blueprint_form"; label: string; waiting: string };
  };
}

export const KICKOFF: FormConfig = {
  key: "kickoff",
  formId: FORMS.kickoff,
  title: "Kickoff",
  idField: "onboarding_client_id",
  resultsUrl: `https://admin.typeform.com/form/${FORMS.kickoff}/results#responses`,
  hidden: ctx =>
    buildHidden(ctx.row, {
      spec: KICKOFF_HIDDEN,
      formId: FORMS.kickoff,
      idField: "onboarding_client_id",
      linkKey: "kickoff_form",
      title: "Kickoff",
      nameKey: "legal_name",
      onboardingLink: onboardingFormLink(ctx.row.clickup_task_id),
    }),
  rail: kickoffRail,
  already: kickoffAlready,
  again:
    "a second Technical and Creative task, a second WhatsApp to the client's group and a second summary",
  makeDoes: [
    "A comment with every answer on the client's ClickUp card.",
    "The card moves to In Progress.",
    "A Technical Onboarding task and a Creative Onboarding task.",
    "The Brand Blueprint link on the card, and Brand Blueprint Booked.",
    "The phase-4 WhatsApp to the client's group.",
    "Make 06's summary of the call, waiting for approval in Slack.",
  ],
  ending: "book-blueprint",
  after: {
    say: "Kickoff sent. Make is booking the Brand Blueprint.",
    sub: "Make also drafts the client's WhatsApp summary for approval in Slack.",
    checksAtSec: [45, 120, 300],
    lateAfterMin: 5,
    cardDone: kickoffCardDone,
    cardLine: row =>
      `Make updated the card: ${String(row.client_status ?? "")
        .replace(/[^\p{L}\p{N}\s-]/gu, "")
        .trim()}.`,
    linkBack: {
      key: "blueprint_form",
      label: "Blueprint link on the card",
      waiting: "Waiting for the Blueprint link on the card.",
    },
  },
};

/** The forms this cockpit opens. The Blueprint and check-in come later. */
export const FORM_CONFIGS: Partial<Record<FormKey, FormConfig>> = {
  kickoff: KICKOFF,
};

export function formConfig(key: string | undefined): FormConfig | null {
  return key && Object.hasOwn(FORM_CONFIGS, key)
    ? (FORM_CONFIGS[key as FormKey] ?? null)
    : null;
}
