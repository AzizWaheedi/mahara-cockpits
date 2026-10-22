import type { FormSend } from "@/forms/formConfig";
import { ONB } from "@/forms/prefill";
import type { FormReads } from "@/forms/useLiveForm";
import type { Timeline } from "@/lib/csmCalls";
import type { FormEntry, OnboardingRow } from "@/lib/onboardingCore";
import type { KickoffPort } from "@/present/KickoffSlide";
import type { Loaded } from "@/present/useDeckModel";
import { standIn } from "../typeformStandIn";

/**
 * The kickoff on the deck harness's last slide (DESIGN 23), with Typeform's
 * stand-in: nothing loads and nothing is submitted anywhere. Every read
 * comes from the deck fixture, and the note and the checks stay in memory.
 *
 *   ?kickoff=open     the form opens prefilled (any kickoff on record is
 *                     taken off the fixture first)
 *   ?kickoff=sent     the stand-in submits as soon as it is ready: the
 *                     trail starts and the checklist ticks the Blueprint call
 *   ?kickoff=done     sent, and the first check reads Make's change to the card
 *   ?kickoff=record   the fixture as it is (full and dwy have a kickoff)
 *   ?kickoff=cockpit  a kickoff sent from the cockpit earlier today, not on
 *                     the record yet
 *   ?kickoff=blocked  the record could not be read
 *   ?kickoff=slow     the form does not load
 *
 * Without the parameter, the fixture decides: open without a kickoff on
 * record, Kickoff on record with one.
 */

export type KickoffScenario =
  | "open"
  | "sent"
  | "done"
  | "record"
  | "cockpit"
  | "blocked"
  | "slow";

const RESPONSE = "harnessdeck0001";

/** The deck fixtures' onboarding answers carry their titles as refs: give them Make 13's refs. */
const REFS: [RegExp, keyof typeof ONB][] = [
  [/business name/i, "businessName"],
  [/next 90 days/i, "goal90"],
  [/12-24 months/i, "goal12"],
  [/top 3 challenges/i, "challenges"],
  [/motivated you to join/i, "why"],
  [/types of appointments/i, "consultationTypes"],
  [/instagram url/i, "instagram"],
  [/business hours/i, "hours"],
  [/what services do you offer/i, "serviceFocus"],
];

function withRefs(entry: FormEntry | undefined): FormEntry | undefined {
  if (!entry) return entry;
  return {
    ...entry,
    answers: entry.answers.map(a => {
      const hit = REFS.find(([re]) => re.test(String(a.title ?? "")));
      return hit ? { ...a, ref: ONB[hit[1]] } : a;
    }),
  };
}

const minutes = (iso: string, m: number) =>
  new Date(Date.parse(iso) + m * 60_000).toISOString();

export function kickoffScenario(
  param: string | null,
  loaded: Loaded,
): KickoffScenario {
  const known: KickoffScenario[] = [
    "open",
    "sent",
    "done",
    "record",
    "cockpit",
    "blocked",
    "slow",
  ];
  if (param && (known as string[]).includes(param))
    return param as KickoffScenario;
  return loaded.kit?.forms?.kickoff ? "record" : "open";
}

export function fakeKickoff({
  loaded,
  taskId,
  scenario,
  rehearse,
  now,
}: {
  loaded: Loaded;
  taskId: string;
  scenario: KickoffScenario;
  rehearse: boolean;
  /** The harness's clock, as an ISO instant. */
  now: () => string;
}): KickoffPort {
  const base = loaded.kit;
  const keepKickoff = scenario === "record";
  let row: OnboardingRow | null = base
    ? {
        ...base,
        clickup_task_id: taskId,
        links: {
          ...base.links,
          clickup: `https://app.clickup.com/t/${taskId}`,
        },
        forms: {
          ...(base.forms ?? {}),
          onboarding: withRefs(base.forms?.onboarding),
          kickoff: keepKickoff ? base.forms?.kickoff : undefined,
        },
      }
    : null;
  let sends: FormSend[] =
    scenario === "cockpit"
      ? [
          {
            responseId: "harnessdeck0000",
            formKey: "kickoff",
            formId: "tG7dnxBn",
            taskId,
            clientName: row?.client_name ?? taskId,
            hiddenKeys: ["onboarding_client_id", "legal_name"],
            second: false,
            sentBy: "Sara",
            sentAt: minutes(now(), -40),
          },
        ]
      : [];
  let forms: Timeline["forms"] = [];
  const timeline = (): Timeline => ({
    taskId,
    clientName: row?.client_name ?? taskId,
    calls: [
      {
        id: 1,
        source: "fathom",
        kind: "onboarding",
        startsAt: minutes(now(), -50),
        status: "held",
        upcoming: false,
        recordingUrl: "https://fathom.example/share/harness-onboarding",
      },
    ],
    forms,
    changes: [],
    health: [],
    unmatchedCount: 0,
  });
  const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
  const reads: FormReads = {
    kits: async () => {
      await wait(150);
      if (scenario === "blocked") throw Error("Failed to fetch");
      return { rows: row ? [row] : [], now: now() };
    },
    deck: async () => {
      if (!loaded.sources) throw Error("The deck's sources were not read.");
      return loaded.sources;
    },
    timeline: async () => timeline(),
    sends: async () => ({ sends }),
    record: async input => {
      await wait(200);
      const send: FormSend = {
        responseId: input.responseId,
        formKey: "kickoff",
        formId: "tG7dnxBn",
        taskId,
        clientName: row?.client_name ?? taskId,
        hiddenKeys: input.hiddenKeys,
        second: false,
        sentBy: "Sara",
        sentAt: now(),
      };
      sends = [send, ...sends];
      // Typeform lists it at once in the harness.
      forms = [
        {
          token: input.responseId,
          formId: "tG7dnxBn",
          kind: "kickoff",
          submittedAt: send.sentAt,
          answers: [],
        },
      ];
      return { send };
    },
    refresh: async () => {
      await wait(300);
      if (scenario === "done" && row)
        row = {
          ...row,
          client_status: "Brand Blueprint Booked♠️",
          card_updated_at: minutes(now(), 1),
          links: {
            ...row.links,
            blueprint_form: `https://maharamedia.typeform.com/to/oYZKtogO#onboarding_client_id=${taskId}`,
          },
        };
      return { rows: row ? [row] : [], now: now(), problem: null };
    },
    announce: () => {},
  };
  return {
    reads,
    me: { email: "sara@example.invalid", firstName: "Sara" },
    rehearse,
    embed: standIn({
      autoSubmit: scenario === "sent" || scenario === "done",
      fail: scenario === "slow",
      response: RESPONSE,
      readyMs: scenario === "sent" || scenario === "done" ? 900 : 250,
    }),
  };
}
