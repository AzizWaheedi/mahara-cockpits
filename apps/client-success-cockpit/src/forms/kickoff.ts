import { FORMS, onboardingFormLink } from "@/lib/onboardingCore";
import type { FormConfig, FormKey } from "./formConfig";
import { kickoffRail } from "./formRail";
import { kickoffAlready, kickoffCardDone } from "./formStatus";
import { buildHidden, KICKOFF_HIDDEN } from "./prefill";

/**
 * The kickoff's configuration (docs/csm-forms/KICKOFF.md 2 to 4), and the
 * registry of the forms this cockpit opens. Everything form-specific lives
 * here; FormPanel never names a form. The contract it fills is
 * ./formConfig.ts (types only). Pure: no React, no I/O.
 */

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
  // Typeform's ending says "Book the Brand Blueprint call"; so does the cockpit.
  ending: { book: "blueprint", label: "Book the Brand Blueprint call" },
  after: {
    say: "Kickoff sent. Make is booking the Brand Blueprint.",
    sub: "Make also drafts the client's WhatsApp summary for approval in Slack.",
    lateSay: {
      make: "Kickoff sent. Make has not updated the card yet.",
      typeform: "Kickoff sent. Typeform has not listed it yet.",
    },
    // Make 12 posts the answers as the card's "Kickoff Handoff" comment.
    lateMake:
      "Make has not updated the card in 5 minutes. The kickoff is safe in Typeform. Open the card and look for the Kickoff Handoff comment; if it is not there, tell the tech lead. Do not send the kickoff again.",
    checksAtSec: [45, 120, 300],
    lateAfterMin: 5,
    cardDone: kickoffCardDone,
    cardLine: row =>
      `The card is at ${String(row.client_status ?? "")
        .replace(/[^\p{L}\p{N}\s-]/gu, "")
        .trim()}.`,
    linkBack: {
      key: "blueprint_form",
      label: "Blueprint link on the card",
      pending: "Make adds the Blueprint link",
      short: "the Blueprint link",
      open: "Open the Brand Blueprint form",
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
