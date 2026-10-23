import type { Already, RailPart } from "@/forms/formConfig";
import type { Trail } from "@/forms/formStatus";
import type { FormPhase, SentState } from "@/forms/useFormPanel";
import { formAnswer, NAME_OPEN } from "@/lib/clientBrief";
import type { FormEntry, OnboardingRow } from "@/lib/onboardingCore";
import { type L, type Lang, O, SERVICES, t } from "./content";
import { KICK } from "./deckData";
import { serviceOfText } from "./services";

/**
 * The onboarding deck's last slide, the kickoff form (CEO, 2026-10-22:
 * "embed the kick off form at the end of the onboarding presentation"),
 * in plain data: what crosses from the deck window to the notes window,
 * the presses that cross back, and the few answers the canvas reads back
 * from a kickoff on record. No React, no I/O.
 *
 * The form is the cockpit's own FormPanel state with the KICKOFF config
 * (src/forms): the same hidden object built from the record, the same
 * guard, the same one note per response and the same trail. The deck
 * draws the form on its canvas; everything the kickoff window keeps in its
 * side panel (the call sheet's facts, the trail, the booking) goes to the
 * notes window as a KickoffView.
 */

export const KICKOFF_SLIDE = "kickoff";

/** A press in the notes window's kickoff part, run by the deck window. */
export type KickoffAct =
  | { act: "check" }
  | { act: "retry" }
  | { act: "recheck" }
  | { act: "reload"; confirmed: boolean }
  | { act: "load" }
  | { act: "refresh" }
  | { act: "booked-open" }
  /** Lay a paper card over the form on the canvas (the internal answers). */
  | { act: "cover"; on: boolean };

/** The kickoff as the deck window has it, for the notes window to draw. */
export interface KickoffView {
  taskId: string;
  clientName: string;
  /** The card's stage, without its emoji. */
  stage: string | null;
  rehearse: boolean;
  /** The read of the client for the form (KICKOFF.md 2.5). */
  status: "loading" | "blocked" | "unread" | "ready";
  blocked: { text: string; retry: boolean; plain: string | null } | null;
  refreshing: boolean;
  /** From here on, only once the read is ready. */
  phase: FormPhase | null;
  /** A kickoff already on record, decided once when the slide first opened. */
  already: Already | null;
  parts: RailPart[];
  notes: string[];
  /** The cockpit's own sends could not be read, so the guard may miss one. */
  failedSends: string | null;
  /** Their onboarding answers changed under the open form. */
  changed: boolean;
  formReady: boolean;
  slow: boolean;
  started: boolean;
  rehearsed: boolean;
  /** The same form and values, in Typeform (not in rehearsal). */
  fallback: string | null;
  sent: SentState | null;
  trail: Trail | null;
  checking: boolean;
  checkedAt: string | null;
  checkError: string | null;
  /** The form's ending button was pressed: the booking opens on its own. */
  autoBook: boolean;
  links: OnboardingRow["links"] | null;
  /** The canvas covers the form while the CSM fills its internal answers. */
  covered?: boolean;
}

/** What the live layer tells the slide: the frame is its, and whether it holds a kickoff on record. */
export interface KickoffShown {
  live: boolean;
  /** A kickoff on record (the guard): the slide says there is nothing to fill. */
  held: boolean;
}

/** How a booking button opens (the form's ending asks for the Blueprint's). */
export interface BookOpts {
  variant?: "default" | "outline";
  autoOpen?: boolean;
  onAutoOpenConsumed?: () => void;
}

/** The view before the read has said anything. */
export function emptyView(
  base: Pick<KickoffView, "taskId" | "clientName" | "stage" | "rehearse">,
): KickoffView {
  return {
    ...base,
    status: "loading",
    blocked: null,
    refreshing: false,
    phase: null,
    already: null,
    parts: [],
    notes: [],
    failedSends: null,
    changed: false,
    formReady: false,
    slow: false,
    started: false,
    rehearsed: false,
    fallback: null,
    sent: null,
    trail: null,
    checking: false,
    checkedAt: null,
    checkError: null,
    autoBook: false,
    links: null,
    covered: false,
  };
}

/** The card's stage as words: "Brand Blueprint Booked♠️" reads "Brand Blueprint Booked". */
export const stageWords = (s: string | null | undefined) =>
  s?.replace(/[^\p{L}\p{N}\s-]/gu, "").trim() || null;

export interface RecordRow {
  key: "service" | "page" | "starter";
  label: L;
  value: string;
  /** The client's own words, as typed: isolated, in their own direction. */
  own: boolean;
}

/**
 * What the canvas reads back from a kickoff on record: the client's own
 * answers about their ads, and nothing else. Never the money (the daily
 * spend, the payment), the card's contract, the recording, the close rate
 * or the earlier enquiries: those stay in the notes window's "Read what was
 * filled" (CONTENT copy rule 3; DESIGN 12.2).
 */
export function recordRows(entry: FormEntry | null): RecordRow[] {
  if (!entry) return [];
  const rows: RecordRow[] = [];
  const service = formAnswer(entry, KICK.advertised);
  if (service) {
    const key = serviceOfText(service);
    rows.push(
      key
        ? {
            key: "service",
            label: O.kickoff.rows.service,
            value: key,
            own: false,
          }
        : {
            key: "service",
            label: O.kickoff.rows.service,
            value: service,
            own: true,
          },
    );
  }
  const page = formAnswer(entry, KICK.pageName);
  if (page && !NAME_OPEN.test(page))
    rows.push({
      key: "page",
      label: O.kickoff.rows.page,
      value: page,
      own: true,
    });
  const starter = formAnswer(entry, KICK.templated);
  if (starter)
    rows.push({
      key: "starter",
      label: O.kickoff.rows.starter,
      value: /declin/i.test(starter)
        ? "declined"
        : /^approved\b/i.test(starter.trim())
          ? "approved"
          : "pending",
      own: false,
    });
  return rows;
}

/** A record row's value in the deck's language. */
export function rowValue(row: RecordRow, lang: Lang): string {
  if (row.own) return row.value;
  if (row.key === "service")
    return t(SERVICES[row.value as keyof typeof SERVICES].name, lang);
  if (row.key === "starter")
    return t(
      O.kickoff.starter[row.value as keyof typeof O.kickoff.starter],
      lang,
    );
  return row.value;
}
