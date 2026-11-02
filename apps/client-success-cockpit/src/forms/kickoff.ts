import { blueprintPrepUrl } from "@/lib/blueprintStatus";
import { FORMS, onboardingFormLink } from "@/lib/onboardingCore";
import type { FormConfig, FormKey } from "./formConfig";
import { kickoffRail } from "./formRail";
import { kickoffAlready, kickoffCardDone } from "./formStatus";
import { buildHidden, KICKOFF_HIDDEN } from "./prefill";
import type { Answers, FieldDef, FormDef } from "./staff/formSheetCore";
import { kuwaitDay, shown } from "./staff/formSheetCore";

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

// --- Stage 4: the kickoff, native (docs/forms/WAVE56-CONTRACT.md 4.13, 5.13) --

const YES_NO = [
  { value: "Yes", label: "Yes" },
  { value: "No", label: "No" },
];
const opts = (list: string[]) => list.map(v => ({ value: v, label: v }));

type KickoffField = FieldDef & {
  /** The Typeform question this answer stands for (tG7dnxBn), so the read model keeps its shape. */
  ref: string | null;
  /**
   * cockpit_kickoff_answers_check takes this answer as a list (its field type
   * multi), sent in the order the CSM ticked it: Typeform handed Make a list in
   * that order, and Make 12 [21] writes the first one to the card.
   */
  list?: true;
  /** How a refusal names this answer when its words are not its own (four boxes say "Anything to add?"). */
  named?: string;
  /** A text's most characters, as cockpit_kickoff_answers_check counts them. */
  max?: number;
};

/**
 * The questions tG7dnxBn requires (each one's validations.required). The
 * CSM may skip every other one, as Typeform lets them; Make 12 then writes
 * "Not provided" on its handoff line and leaves the card's field alone.
 */
const TYPEFORM_REQUIRED = new Set([
  "c0000001-0000-4000-8000-000000000001",
  "c0000001-0000-4000-8000-000000000012",
  "c0000001-0000-4000-8000-000000000003",
  "c0000001-0000-4000-8000-000000000013",
  "c0000001-0000-4000-8000-000000000005",
  "c0000001-0000-4000-8000-000000000014",
  "c0000001-0000-4000-8000-000000000007",
  "c0000001-0000-4000-8000-000000000008",
  "c0000001-0000-4000-8000-000000000009",
  "c0000001-0000-4000-8000-000000000015",
  "c0000001-0000-4000-8000-00000000000a",
  "dff79b66-89dd-43ef-9664-3fa4e6a61d69",
  "b5578678-d0c2-475b-b66f-7ea54d55fe31",
]);

/**
 * A long text as Typeform hands it to Make, and as cockpit_form_typeform_text
 * keeps it (20261102o): each line break a line feed, no white space at either
 * end (JavaScript's trim takes the same characters as its btrim), everything
 * between as typed.
 */
export const typeformText = (v: string) => v.replace(/\r\n?/g, "\n").trim();

/**
 * cockpit_kickoff_answers_check's longest answer: 4,000 characters for a
 * long text, 500 for any other text with its spaces folded, counted as the
 * database counts them, so the sheet says it before the send.
 */
const tooLong = (long: boolean, max: number) => (v: unknown) => {
  const s = long
    ? typeformText(String(v))
    : String(v).replace(/\s+/g, " ").trim();
  return [...s].length > max
    ? `Shorten it to ${max.toLocaleString("en-US")} characters or fewer.`
    : null;
};

const yesNo = (key: string, ref: string, label: string): KickoffField => ({
  key,
  ref,
  label,
  type: "choice",
  options: YES_NO,
});
const pick = (
  key: string,
  ref: string,
  label: string,
  list: string[],
): KickoffField => ({
  key,
  ref,
  label,
  type: "choice",
  options: opts(list),
});
const words = (
  key: string,
  ref: string,
  label: string,
  long = false,
  max = long ? 4000 : 500,
): KickoffField => ({
  key,
  ref,
  label,
  type: long ? "longtext" : "text",
  max,
  check: tooLong(long, max),
});
/** A group's own "Anything to add?" box; a refusal names it with its group. */
const addTo = (key: string, ref: string, group: string): KickoffField => ({
  ...words(key, ref, "Anything to add?", true),
  named: `Anything to add? (${group})`,
});
/** A long text tG7dnxBn asks only when its logic jumps to it. */
const followUp = (
  key: string,
  ref: string,
  label: string,
  when: (a: Answers) => boolean,
): KickoffField => ({ ...words(key, ref, label, true), showIf: when });
const saidNo = (key: string) => (a: Answers) => a[key] === "No";
const heading = (key: string, label: string): KickoffField => ({
  key,
  ref: null,
  label,
  type: "heading",
});
/** Each answer required exactly where tG7dnxBn requires it; New MRR keeps its own rule. */
const asTypeform = (fields: KickoffField[]): KickoffField[] =>
  fields.map(f =>
    f.ref === null || f.type === "heading"
      ? f
      : { ...f, required: TYPEFORM_REQUIRED.has(f.ref) },
  );

/**
 * The kickoff's 46 answers in the Typeform's order, each under the key and
 * with the options cockpit_form_stage4_fields('kickoff') holds (the database
 * checks the send against them), with the cockpit's own words and each one's
 * ref (11.2-o), in three groups, then New MRR (Q21). The groups are headings,
 * never answers. Each answer is required where tG7dnxBn requires it, and
 * tG7dnxBn's logic decides what is asked: its five follow-ups (c0000001-...-0012
 * to -0015 and -000b) only after a No or an adjustment, and the leads
 * questions only after a Yes. A question the sheet does not show sends no
 * answer, as Typeform hands Make none from a branch it skipped.
 */
export const KICKOFF_FIELDS: KickoffField[] = asTypeform([
  heading("groupBusiness", "The client's business"),
  yesNo(
    "detailsCorrect",
    "c0000001-0000-4000-8000-000000000001",
    "Are the business details still correct?",
  ),
  addTo(
    "detailsFix",
    "c0000001-0000-4000-8000-000000000002",
    "business details",
  ),
  followUp(
    "detailsCorrection",
    "c0000001-0000-4000-8000-000000000012",
    "What is wrong? Give the correct details.",
    saidNo("detailsCorrect"),
  ),
  yesNo(
    "linksCorrect",
    "c0000001-0000-4000-8000-000000000003",
    "Are the online links still correct?",
  ),
  addTo("linksFix", "c0000001-0000-4000-8000-000000000004", "online links"),
  followUp(
    "linksCorrection",
    "c0000001-0000-4000-8000-000000000013",
    "Which link is wrong, and what is the correct one?",
    saidNo("linksCorrect"),
  ),
  yesNo(
    "operationsCorrect",
    "c0000001-0000-4000-8000-000000000005",
    "Is how they operate still correct?",
  ),
  addTo(
    "operationsFix",
    "c0000001-0000-4000-8000-000000000006",
    "how they operate",
  ),
  followUp(
    "operationsCorrection",
    "c0000001-0000-4000-8000-000000000014",
    "What has changed? Give the correct details.",
    saidNo("operationsCorrect"),
  ),
  {
    key: "serviceAdvertised",
    ref: "c0000001-0000-4000-8000-000000000007",
    label: "Which service are we advertising?",
    type: "multi",
    list: true,
    options: opts([
      "Design and build",
      "Interior design",
      "Architectural design",
      "Fit out and renovation",
      "Construction only",
      "Other",
    ]),
    hint: "Tick the main service first: the card's Service Advertised takes the first one you tick.",
  },
  {
    key: "consultationTypes",
    ref: "c0000001-0000-4000-8000-000000000008",
    label: "Which consultation types do they offer?",
    type: "multi",
    list: true,
    options: opts(["In-office", "In-home or onsite", "Online"]),
  },
  yesNo(
    "profileComplete",
    "c0000001-0000-4000-8000-000000000009",
    "Is the profile complete?",
  ),
  addTo("profileFix", "c0000001-0000-4000-8000-000000000011", "client profile"),
  followUp(
    "profileMissing",
    "c0000001-0000-4000-8000-000000000015",
    "What is missing?",
    saidNo("profileComplete"),
  ),
  pick(
    "contractStatus",
    "c0000001-0000-4000-8000-00000000000a",
    "Contract status",
    [
      "Signed",
      "Sent and waiting on client",
      "Adjustments requested by client",
      "Not sent yet",
      "NA - already signed",
    ],
  ),
  followUp(
    "contractChanges",
    "c0000001-0000-4000-8000-00000000000b",
    "What needs changing in the contract?",
    a => a.contractStatus === "Adjustments requested by client",
  ),
  heading("groupSetup", "Set-up and access"),
  yesNo(
    "inWhatsappGroup",
    "3db082bb-1939-444b-8b32-d0067fc9878c",
    "Have you been added to the WhatsApp group?",
  ),
  // A long text in tG7dnxBn and in cockpit_form_stage4_fields: a list of
  // people keeps its line breaks, as Make hands them on.
  words(
    "whatsappAdd",
    "071c480f-17f9-48db-8155-56030f952e85",
    "Who else should we add to the WhatsApp group?",
    true,
  ),
  yesNo(
    "driveDiscussed",
    "87c68a44-b19b-4a86-a286-0a2c8c32134e",
    "Have drive folders and filling out spreadsheets been discussed? (Intro message Whatsapp group)",
  ),
  pick(
    "whatsappStatus",
    "92fab954-d771-431c-9fc4-b9f15c53cbb8",
    "WhatsApp Status",
    ["Access confirmed.", "Pending.", "Invited.", "Waiting on client."],
  ),
  // One text in the database: the ticks are joined in the order they were made.
  {
    key: "adPlatforms",
    ref: "7d16afbb-b99a-4ee9-8718-4418cbeba534",
    label: "Which platforms will we advertise on?",
    type: "multi",
    options: opts(["Tiktok", "Meta (Facebook/Instagram)", "Snapchat"]),
  },
  words(
    "dailyBudget",
    "cf53482c-3d7d-45ab-b294-0230e917ea5f",
    "What is your daily budget for the ads?",
  ),
  words(
    "adAccountName",
    "e4b9dbd3-c12c-4d6f-a0e3-c3ba17c97728",
    "What is the name of the ad account? (has to be exact)",
  ),
  words(
    "facebookPageName",
    "940f494c-f99b-4920-b203-200576ddd780",
    "What is the name of the Facebook page? (has to be exact)",
  ),
  yesNo(
    "cardLinked",
    "8bee68fc-0764-41a8-b90a-db2a3f401e9d",
    "Correct Card Linked To The Account With Funds?",
  ),
  pick(
    "facebookAccess",
    "6fcbd33c-60e9-4df7-bfaa-e76b588dd887",
    "Facebook Access Status?",
    [
      "Requested",
      "Waiting on Client",
      "Access Confirmed",
      "Pending",
      "Using Ours",
      "Need Tech Help",
      "Their Page Our Ad Acc",
    ],
  ),
  pick(
    "whatsappSynced",
    "a813378f-06ce-499e-8f0e-14761b89b474",
    "Whatsapp synced to Mahara OS?",
    [
      "Requested",
      "Waiting on Client",
      "Integrated",
      "Needs Integrating",
      "Pending",
      "Not Integrating",
    ],
  ),
  yesNo(
    "bookingConnects",
    "03b0600d-04d2-40a0-a7de-75a488888eb7",
    "Does the booking platform connect to ours?",
  ),
  yesNo(
    "calendarComplete",
    "3bebf47d-c00b-4f26-8624-933b84e42ebc",
    "Google Calendar Integration Complete?",
  ),
  pick(
    "calendarStatus",
    "b657c5a5-d199-42b5-8437-c8d04f78e376",
    "Booking platform & Google Calendar Integration Status",
    [
      "Requested",
      "Waiting on Client",
      "Integrated",
      "Needs Integrating",
      "Pending",
      "Not Integrating",
      "Google Synched - Not Integrated",
    ],
  ),
  pick(
    "maharaOsAccess",
    "ad562fc2-6858-4e37-81c5-c4cc2375a330",
    "Mahara OS Access Status",
    ["Logged In", "Tech Issue", "Didn't Receive Access", "Doesn't Want To"],
  ),
  heading("groupContent", "Content, leads and training"),
  words(
    "contentLinks",
    "3418ef58-72df-49aa-aac3-1e095e155d45",
    "Provide any marketing content links or notes.",
    true,
  ),
  yesNo(
    "contentDiscussed",
    "753c4cde-4d28-4719-8459-06e4db640180",
    "Content Discussed",
  ),
  yesNo(
    "templatedAdsDiscussed",
    "f54986bc-e120-4345-afee-31c1000a5a9a",
    "Templated Ads Discussed",
  ),
  pick(
    "templatedAdsStatus",
    "eb7ed18c-8388-4d84-9b5c-2e3d4a030287",
    "Templated Ads Status",
    ["Approved", "Declined", "Waiting On Client", "Wants To See Them First"],
  ),
  yesNo(
    "hasLeads",
    "dff79b66-89dd-43ef-9664-3fa4e6a61d69",
    "Do you have pre-existing leads?",
  ),
  // tG7dnxBn skips both after a No to leads, and the links after a No to reaching out.
  {
    ...yesNo(
      "reachLeads",
      "85d7ebb5-ce36-4ac3-aff8-3ce464737abd",
      "Do you want us to reach out to those leads?",
    ),
    showIf: a => a.hasLeads === "Yes",
  },
  followUp(
    "leadsLinks",
    "86a6cce0-9111-4d98-97e7-7af5b6d518c8",
    "Provide link or notes for those leads.",
    a => a.hasLeads === "Yes" && a.reachLeads !== "No",
  ),
  yesNo(
    "coldLeadsExperience",
    "0cb88b75-f193-43a1-b802-d382178a0946",
    "Do you have experience selling to cold leads (leads from ads)?",
  ),
  words(
    "coldCloseRate",
    "079812c4-bb7e-4cc3-8e57-24c3b9e886d9",
    "What is your current close rate on cold leads?",
  ),
  yesNo(
    "academyConfirmed",
    "4379c2f7-c5cf-4104-92c5-9b2294d65b59",
    "Premium Projects Academy Confirmed?",
  ),
  yesNo(
    "firstStepsDiscussed",
    "dc6eafd2-516e-4ca9-9d9c-89dee060e224",
    "Discussed First Steps and Important Videos?",
  ),
  pick(
    "trainingAccess",
    "c56a7e2d-6f18-4bf9-a9f6-11367eab4c11",
    "Training Course Access",
    ["Confirmed", "Requested", "Need Tech Help", "Waiting On Client"],
  ),
  {
    ...words(
      "callRecording",
      "b5578678-d0c2-475b-b66f-7ea54d55fe31",
      "Call Recording Link",
    ),
    placeholder: "https://",
    check: v =>
      tooLong(false, 500)(v) ??
      (/^https:\/\/\S+$/i.test(String(v).trim())
        ? null
        : "A link starts with https://."),
  },
  {
    key: "paymentAmount",
    ref: "75e97e7d-4c19-437a-b4b8-67570c29344f",
    label: "Payment Amount",
    type: "number",
  },
  yesNo(
    "postCallFormFilled",
    "34310b2e-4df4-4ed5-b67e-9aefa9087d6e",
    "Post call form filled?",
  ),
  {
    key: "newMrrUsd",
    ref: null,
    label: "New MRR (USD a month)",
    type: "number",
    required: true,
    min: 0,
    hint: "What this client pays us each month from now. 0 if they paid in full with no monthly fee.",
    message: "Write the new MRR in dollars a month, 0 or more.",
  },
]);

/** The 46 Typeform answers (headings and New MRR aside). */
export const KICKOFF_ANSWER_FIELDS = KICKOFF_FIELDS.filter(
  f => f.ref !== null && f.type !== "heading",
);

/** Sending a second kickoff needs its reason (4.13): asked first, with the day of the first. */
export const kickoffAgainLine = (answeredAt: string | null) =>
  `A kickoff was sent on ${kuwaitDay(answeredAt) || "an earlier day"}. Say why you are sending it again.`;

/**
 * The kickoff sheet (5.13): FormSheet def `kickoff`. A card that already
 * has a kickoff asks why it is sent again; that send re-runs only the
 * handoff comment (the database decides).
 */
export function kickoffDef(
  client: string,
  answeredAt: string | null = null,
): FormDef {
  const again: FieldDef[] = answeredAt
    ? [
        {
          key: "replaceReason",
          label: "Why are you sending it again?",
          type: "longtext",
          required: true,
          min: 3,
          message: kickoffAgainLine(answeredAt),
          check: v =>
            String(v).trim().length > 300 ? kickoffAgainLine(answeredAt) : null,
        },
      ]
    : [];
  return {
    key: "kickoff",
    version: 2,
    title: `Kickoff for ${client}`,
    lede: answeredAt
      ? kickoffAgainLine(answeredAt)
      : "Fill it on the call. The card, the tasks and the phase 4 message follow.",
    cardWords: "kickoffs",
    ticket: null,
    ticketNone: "No ticket: the tech and creative tasks are made for you",
    notice: true,
    doneLabel: "Sent",
    submitLabel: () => "Send the kickoff",
    words: {
      stored: "Kickoff stored",
      storing: "Storing the kickoff",
      cardQueued: "Card queued",
      cardDone: "Card confirmed",
      held: "Waits for the switch-on",
      extras: [
        {
          key: "tasks",
          done: "Tech and creative tasks made",
          waiting: "Making the tech and creative tasks",
        },
        {
          key: "message",
          done: "Phase 4 message waits for your approval",
          waiting: "Drafting the phase 4 message",
        },
      ],
    },
    fields: [
      ...again,
      ...KICKOFF_FIELDS.map(
        ({ ref: _ref, list: _list, named: _named, max: _max, ...f }) => f,
      ),
    ],
  };
}

/**
 * The answers cockpit_kickoff_submit takes: every field by its key; a pick
 * the database takes as a list (`list`) sent as a list, any other multi pick
 * joined the way the Typeform stores it ("Snapchat, Meta (Facebook/Instagram)"),
 * both in the order the CSM ticked them and never sorted (Make 12 writes the
 * first ticked service to the card); numbers as numbers, empty answers and
 * the answers to questions the sheet does not show left out (Typeform hands
 * Make nothing from a branch its logic skipped), and the replace reason when
 * asked. A text loses only its outer white space, as Typeform's answers
 * reach Make with none: a long text goes as Typeform hands it on
 * (typeformText), its line breaks and repeated spaces as typed (Make writes
 * them into the handoff unchanged).
 */
export function kickoffAnswers(a: Answers): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of KICKOFF_FIELDS) {
    if (f.type === "heading" || !shown(f, a)) continue;
    const v = a[f.key];
    if (v === null || v === undefined || v === "") continue;
    if (f.list || Array.isArray(v)) {
      // Only a list counts: anything else (an old draft's text) shows nothing ticked, so nothing goes.
      const ticked = Array.isArray(v) ? [...new Set(v.map(String))] : [];
      if (ticked.length) out[f.key] = f.list ? ticked : ticked.join(", ");
      continue;
    }
    if (f.type === "number") {
      const n = Number(v);
      if (Number.isFinite(n)) out[f.key] = n;
      continue;
    }
    out[f.key] =
      typeof v !== "string"
        ? v
        : f.type === "longtext"
          ? typeformText(v)
          : v.trim();
  }
  const reason =
    typeof a.replaceReason === "string" ? a.replaceReason.trim() : "";
  if (reason) out.replaceReason = reason;
  return out;
}

/** Each answer's Typeform ref, for the read model and the parity check. */
export const KICKOFF_REFS: Record<string, string> = Object.fromEntries(
  KICKOFF_ANSWER_FIELDS.map(f => [f.key, f.ref as string]),
);

/** Each answer by key, for naming what cockpit_kickoff_answers_check refused. */
const KICKOFF_BY_KEY: Record<string, KickoffField> = Object.fromEntries(
  KICKOFF_FIELDS.filter(f => f.type !== "heading").map(f => [f.key, f]),
);

/** What to do about each code cockpit_kickoff_answers_check gives, or null for one the CSM cannot fix. */
function refusedFix(f: KickoffField, code: string): string | null {
  switch (code) {
    case "required":
      return "answer it";
    case "option":
      return "pick one of its choices";
    case "length":
      return `shorten it to ${(f.max ?? 500).toLocaleString("en-US")} characters or fewer`;
    case "format":
      return "paste the whole link, starting with https://";
    case "range":
      return f.key === "newMrrUsd"
        ? "write a number from 0 to 100,000"
        : "write a number from 0 to 10,000,000, with 2 decimals at most";
    default:
      return null;
  }
}

/**
 * The sentence for a kickoff the database did not store (cockpit_kickoff_submit
 * answered reason invalid): each question to fix, by its words (a shared
 * "Anything to add?" with its group), and what to do about it; answers that
 * each passed but together do not fit the room a kickoff has
 * ({_answers: too_large}, which cockpit_kickoff_answers_check gives alone)
 * to be shortened; or the tech lead when it named an answer the sheet does
 * not ask or a code the CSM cannot fix.
 */
export function kickoffRefused(errors: Record<string, string>): string {
  const keys = Object.keys(errors);
  if (keys.length === 1 && errors._answers === "too_large")
    return "The kickoff was not stored: its answers together are too long. Shorten the longest answers, then send it again. Your answers are still here.";
  const lines = keys.map(k => {
    const f = KICKOFF_BY_KEY[k];
    const fix = f ? refusedFix(f, errors[k]) : null;
    return f && fix
      ? `${(f.named ?? f.label).replace(/[?.]$/, "")}: ${fix}.`
      : null;
  });
  if (!keys.length || lines.some(l => !l))
    return "The kickoff was not stored: the database did not take the sheet's answers. Your answers are still here. Tell the tech lead.";
  return `The kickoff was not stored. ${lines.join(" ")} Then send it again.`;
}
