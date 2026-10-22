import type { FormContext, FormSend } from "@/forms/formConfig";
import { ONB } from "@/forms/prefill";
import type { Timeline, TimelineCall } from "@/lib/csmCalls";
import type { FormEntry, OnboardingRow } from "@/lib/onboardingCore";
import { type DeckSources, sourcesSchema } from "@/present/sources";

/**
 * Invented clients for the form panel's tests and its harness
 * (scripts/form-preview.html). No real client, answer or ID appears here.
 */

/** 13:30 in Kuwait. */
export const NOW = "2026-10-22T10:30:00.000Z";
export const TASK = "86fixture1";
export const NAME = "Cedar & Stone Interiors";

export type Answers = Partial<Record<keyof typeof ONB, string>>;

export const FULL_ANSWERS: Answers = {
  businessName: "Cedar & Stone Interiors",
  email: "studio@cedar-stone.example",
  phone: "+965 5555 0101",
  address: "Block 3, Street 12, Salmiya\nKuwait",
  maps: "https://maps.example/cedar",
  instagram: "https://instagram.com/cedar.stone.example",
  website: "https://cedar-stone.example",
  facebook: "https://facebook.com/cedarstone.example",
  booking: "Calendly",
  hours: "Sun to Thu, 9:00 to 17:00",
  consultants: "Eng. Rana (interiors), Eng. Fahad (fit-out)",
  serviceFocus: "تصميم داخلي للفلل",
  consultationTypes: "In-office, Online",
  paymentOptions: "50% upfront, the rest in two payments",
  lastRevenue: "0",
  goal90: "40,000 KWD",
  goal12: "250,000 KWD",
  marketing: "Instagram posts, referrals, one paid campaign in 2025",
  challenges: "Leads that never answer\nToo many small jobs",
  why: "To get bigger villa projects",
  notes: "Ramadan is their slow month",
  drive: "https://drive.example/cedar-content",
  services:
    "Villa interiors\nKitchens\nMajlis design\nFit-out for offices (from 8,000 KWD)",
  areas: "Kuwait City, Salmiya, Hawalli",
  facebookAccess: "Yes, we ran ads before",
  appointmentLength: "45 minutes, 15 minute buffer",
};

export function onboardingEntry(
  answers: Answers = FULL_ANSWERS,
  submittedAt = "2026-10-13T08:00:00Z",
): FormEntry {
  return {
    form_id: "KFRCXPFx",
    response_id: "onbresponse000001",
    submitted_at: submittedAt,
    answers: Object.entries(answers).map(([k, value]) => ({
      ref: ONB[k as keyof typeof ONB],
      title: k,
      value: String(value),
    })),
  };
}

export function fixtureRow(over: Partial<OnboardingRow> = {}): OnboardingRow {
  return {
    clickup_task_id: TASK,
    client_name: NAME,
    clickup_status: "on boarding",
    client_status: "Onboarding Booked",
    in_onboarding: true,
    csm: "lina",
    signup_on: "2026-10-08",
    onboarding_call_on: "2026-10-22",
    launch_on: null,
    links: {
      clickup: `https://app.clickup.com/t/${TASK}`,
      offer_sheet: "https://docs.example/cedar-offer",
    },
    handover: {
      closer: "Omar",
      closer_notes: "Wants villa work only. Slow to reply on WhatsApp.",
      handoff_risks: "Budget is tight for the first month.",
      billing_notes: "-Cash collected: 500\n-Next: 1,000 on launch",
      payment_plan: "Split Pay (2x payments)",
      contract_signed: "Signed",
      daily_budget: 40,
      next_payment_amount: 1000,
    },
    sales_transcript: null,
    forms: { onboarding: onboardingEntry() },
    card_updated_at: "2026-10-22T09:00:00Z",
    seen_at: NOW,
    synced_at: NOW,
    ...over,
  };
}

export function fixtureDeck(
  prep: Record<string, unknown> = {
    service_focus: "Interior design",
    service_chosen_at: "2026-10-22T10:05:00Z",
  },
): DeckSources {
  return sourcesSchema.parse({
    taskId: TASK,
    clientName: NAME,
    ghl: { country: "KW", city: "Salmiya" },
    editor: {
      offer: "A full villa interior, designed and handed over in 12 weeks",
      offerUrl: "https://docs.example/cedar-offer",
    },
    prep: {
      onboarding: { deck: "onboarding", overrides: prep, revision: 3 },
    },
  });
}

export function fixtureCall(over: Partial<TimelineCall> = {}): TimelineCall {
  return {
    id: 1,
    source: "fathom",
    kind: "onboarding",
    startsAt: "2026-10-22T10:10:00Z",
    status: "held",
    upcoming: false,
    recordingUrl: "https://fathom.example/share/cedar-onboarding",
    ...over,
  };
}

export function fixtureTimeline(
  calls: TimelineCall[] = [fixtureCall()],
  forms: Timeline["forms"] = [],
): Timeline {
  return {
    taskId: TASK,
    clientName: NAME,
    calls,
    forms,
    changes: [],
    health: [],
    unmatchedCount: 0,
  };
}

export function fixtureSend(over: Partial<FormSend> = {}): FormSend {
  return {
    responseId: "fixtureresp0001",
    formKey: "kickoff",
    formId: "tG7dnxBn",
    taskId: TASK,
    clientName: NAME,
    hiddenKeys: ["onboarding_client_id", "legal_name"],
    second: false,
    sentBy: "Lina",
    sentAt: "2026-10-22T11:02:00Z",
    ...over,
  };
}

export function fixtureContext(over: Partial<FormContext> = {}): FormContext {
  return {
    taskId: TASK,
    row: fixtureRow(),
    deck: fixtureDeck(),
    timeline: fixtureTimeline(),
    sends: [],
    me: { email: "lina@example.invalid", firstName: "Lina" },
    now: NOW,
    readAt: Date.now(),
    failed: {},
    ...over,
  };
}
