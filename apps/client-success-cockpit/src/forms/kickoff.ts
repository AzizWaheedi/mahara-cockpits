import { blueprintPrepUrl } from "@/lib/blueprintStatus";
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
    "a second Kickoff Handoff comment, a second Technical and Creative task and a second WhatsApp to the client's group",
  // What Make 8925654 writes, as the card shows it (docs/forms/PLAN.md S10).
  // Make books nothing: the CSM books the Brand Blueprint call.
  makeDoes: [
    "The Kickoff Handoff comment, with every answer, on the client's ClickUp card.",
    "A Technical Onboarding task and a Creative Onboarding task.",
    "The Brand Blueprint link on the card, and the card at Brand Blueprint Booked.",
    "The Onboarding Map at phase 4.",
    "The phase 4 WhatsApp to the client's group.",
  ],
  // Typeform's ending says "Book the Brand Blueprint call"; so does the cockpit.
  ending: { book: "blueprint", label: "Book the Brand Blueprint call" },
  after: {
    say: "Kickoff sent. Make is updating the card. Book the Brand Blueprint call below.",
    doneSay:
      "Kickoff sent. The card is updated. Book the Brand Blueprint call below.",
    // Where it posts comes from the notice (Settings, Notices and routing),
    // never from code (D17).
    sub: where => `The team hears in ${where} once the card is updated.`,
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
    // The stop reads the card's Brand Blueprint link; the button opens the
    // cockpit's own Blueprint, never the retired Typeform (PLAN.md S9).
    linkBack: {
      key: "blueprint_form",
      label: "The card has the Brand Blueprint link",
      pending: "Make adds the Brand Blueprint link to the card",
      short: "the Blueprint link",
      open: "Open the Brand Blueprint",
      href: taskId => blueprintPrepUrl(taskId),
    },
    // The cockpit's own Slack notice (cockpit-notices), once Make has
    // updated the card or 20 minutes have passed.
    notice: {
      kind: "kickoff",
      pending: where => `The team hears in ${where}`,
      line: "Once Make has updated the card, usually within a few minutes.",
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
