import type { Timeline } from "@/lib/csmCalls";
import type { FormEntry, LinkKey, OnboardingRow } from "@/lib/onboardingCore";
import type { DeckSources } from "@/present/sources";
import type { Prefill } from "./prefill";

/**
 * The reusable form panel's contract (docs/csm-forms/KICKOFF.md 2): the
 * shapes a form's configuration fills and FormPanel reads. Types only: no
 * value, no React, no I/O, so another cockpit can copy this file and the
 * panel byte for byte and bring its own configuration (KICKOFF.md 2.6).
 * The kickoff's configuration and the registry of forms this cockpit opens
 * are in ./kickoff.ts; the Brand Blueprint and the 1-1 check-in are later
 * objects of the same shape (KICKOFF.md 2.6 and 2.7).
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
  /** The sender's first name, when the seat has one. Never their address. */
  sentBy: string | null;
  sentAt: string;
}

/** One response to note (cockpit_csm_form_sent); the server re-checks every argument. */
export interface SendInput {
  taskId: string;
  formKey: FormKey;
  responseId: string;
  hiddenKeys: string[];
  hiddenSha256: string;
  /** The ID the form carried in its hidden field. */
  carriedId: string;
}

/** What a form window tells the cockpit's own tab. */
export type FormNews =
  | {
      type: "sent";
      taskId: string;
      form: FormKey;
      clientName: string;
      say: string;
    }
  | { type: "checked" | "noted"; taskId: string; form: FormKey };

/**
 * One Slack notice as a browser sees it (cockpit_slack_notice_read,
 * docs/forms/STAGE1-CONTRACT.md 2.1): its state, where and when, and the
 * plain reason when it did not post. Never its text or facts. Parsed by
 * src/lib/notices.ts; declared here so the panel imports nothing new.
 */
export interface NoticeView {
  id: string;
  kind: string;
  state:
    | "queued"
    | "sending"
    | "posted"
    | "failed"
    | "unknown"
    | "skipped"
    | "muted";
  variant: string | null;
  /** The kickoff's Typeform response ID (kickoff notices only). */
  responseId: string | null;
  outboxId: string | null;
  parentKind: string | null;
  /** Where it posted, or where it is aimed; null when neither is known yet. */
  channel: { id: string; name: string | null } | null;
  at: string;
  dueAt: string | null;
  permalink: string | null;
  /** Null once posted; else what it waits for, or why it did not post. */
  reason: string | null;
}

/** cockpit_slack_notice_read: one card's notices, newest first. */
export interface NoticeRead {
  taskId: string;
  now: string;
  notices: NoticeView[];
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
  /**
   * cockpit_slack_notice_read, this card. Undefined or null when this
   * screen does not read it (the onboarding deck, on the client's screen):
   * the trail then has no Slack stop.
   */
  notices?: NoticeRead | null;
  me: { email: string; firstName: string | null };
  /** The server's clock at the last read, and this browser's clock then. */
  now: string;
  readAt: number;
  /** A side read that failed, in plain words: only its part says so. */
  failed: {
    deck?: string;
    timeline?: string;
    sends?: string;
    notices?: string;
  };
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
  /** What the copy button copies, when the shown value is dressed ("$40 a day" copies "40"). */
  copyValue?: string;
  /** Said when the value is null: "Not on record." */
  missing?: string;
  /** A quiet line under the value (a hint, never a number to type). */
  hint?: string;
  /** The value is a link; `linkLabel` is what the link says. */
  href?: string;
  linkLabel?: string;
  /** The value is the cockpit's suggestion, from the client's words or the deck; the CSM picks in the form. */
  suggest?: boolean;
  /** A "Check again" button that re-reads the call store, while the value is missing. */
  recheck?: boolean;
  /** "Still missing" rows: the row in the panel this one points to. */
  anchor?: string;
  /** "Still missing" rows: a copy action in the row itself ("Copy their onboarding link"). */
  action?: { label: string; value: string; done: string };
  /** Several empty rows said in one line: "Not on record: Daily budget, Calendar." */
  empties?: string[];
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
  /** The source most carried values share, said once in the title; only the others are tagged. */
  carriesFrom?: string | null;
  /** How the carried keys with no value are said, in one line: "Left blank", "Not on record". */
  blank?: string;
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
  /**
   * Typeform's ending button opens the cockpit's own booking for this client
   * instead of redirecting; `label` is the ending's own words, so the
   * booking keeps one name. Null: the ending is Typeform's.
   */
  ending: { book: "blueprint"; label: string } | null;
  /** Partial submit point (the Blueprint only, KICKOFF.md 2.6). */
  partial?: { afterRef: string; say: string };
  after: {
    /** "Kickoff sent. Make is updating the card. Book the Brand Blueprint call below." */
    say: string;
    /** The muted line under it. */
    sub: string;
    /** The headline instead, once a step is late. */
    lateSay: { make: string; typeform: string };
    /** Make is late: what to look for on the card, in full (it names the comment Make writes). */
    lateMake: string;
    /** One-card refreshes after a send, in seconds. */
    checksAtSec: number[];
    /** When the trail says Make or Typeform is late. */
    lateAfterMin: number;
    /** Make has done its part on the card since the send. */
    cardDone(row: OnboardingRow, sentAt: string): boolean;
    /** The card stop's line once it is done: "The card is at Brand Blueprint Booked." */
    cardLine(row: OnboardingRow): string;
    /** A link Make writes back, when there is one. */
    linkBack?: {
      key: LinkKey;
      /** The stop once done: "The card has the Brand Blueprint link". */
      label: string;
      /** The stop while it waits: "Make adds the Brand Blueprint link to the card". */
      pending: string;
      /** In the short summary: "waiting for the Blueprint link". */
      short: string;
      /** The button's own words once the stop is done: "Open the Brand Blueprint". */
      open: string;
      /**
       * Where the button goes. The stop still reads `links[key]`; without
       * this, the button opens that card link.
       */
      href?: (taskId: string) => string;
    };
    /**
     * The last stop: the cockpit's own Slack notice for this response
     * (cockpit_slack_notice_read), when the screen reads it.
     */
    notice?: {
      kind: "kickoff";
      /** The stop while it waits: "The team hears in #csm-general". */
      pending: string;
      /** The line under it while it waits. */
      line: string;
    };
  };
}
