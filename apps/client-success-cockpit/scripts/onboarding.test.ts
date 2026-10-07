/**
 * The onboarding links and forms (convex/onboardingCore.ts): a card's fields
 * become links only when they are links, the forms join by the card id, the
 * newest kickoff wins across the two kickoff forms, and titles read cleanly.
 *
 * Run: bun test scripts/onboarding.test.ts
 */

import { describe, expect, test } from "bun:test";
import {
  answerValue,
  cardRow,
  F,
  FORMS,
  formsFor,
  inOnboarding,
  kuwaitDay,
  missingFields,
  newestByCard,
  onboardingFormLink,
  optionsOf,
  questionTitle,
  stepOf,
} from "../src/lib/onboardingCore";

const fieldsBody = {
  fields: [
    {
      id: F.clientStatus,
      type_config: {
        options: [
          { id: "o-active", orderindex: 0, name: "Active" },
          { id: "o-nc", orderindex: 6, name: "Needs Contacting" },
          { id: "o-bb", orderindex: 4, name: "Brand Blueprint Booked♠️" },
          { id: "o-gh", orderindex: 11, name: "GHOSTED" },
        ],
      },
    },
    { id: F.kickoffForm, type_config: {} },
    { id: F.salesCall, type_config: {} },
    { id: F.onboardingMap, type_config: {} },
    {
      id: F.paymentPlan,
      type_config: {
        options: [
          { id: "p-split", orderindex: 1, name: "Split Pay (2x payments)" },
        ],
      },
    },
  ],
};
const options = optionsOf(fieldsBody);
const NOW = "2026-10-05T08:00:00.000Z";

function card(
  fields: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  return {
    id: "z8xmdvffcd",
    name: " Test Interiors ",
    url: "https://app.clickup.com/t/z8xmdvffcd",
    status: { status: "in progress" },
    date_updated: "1759600000000",
    custom_fields: Object.entries(fields).map(([id, value]) => ({ id, value })),
    ...extra,
  };
}

describe("a card as a row", () => {
  test("keeps links that are links, and only the fields it reads", () => {
    const row = cardRow(
      card({
        [F.clientStatus]: 4,
        [F.kickoffForm]:
          "https://maharamedia.typeform.com/to/tG7dnxBn#onboarding_client_id=z8xmdvffcd&legal_name=Test",
        [F.salesCall]: " https://fathom.video/share/abc ",
        [F.contract]: "not a link",
        [F.ghlId]: "AbCdEfGhIj1234567890",
        [F.salesTranscript]: "  Closer: hello  ",
        [F.paymentPlan]: 1,
        [F.dailyBudget]: "40",
        // A field this does not read stays out of the row (the GHL API key lives on the card).
        "09984789-dbf4-4d91-bfc8-327d233ee053": "pit-secret",
      }),
      options,
      NOW,
    );
    expect(row.client_name).toBe("Test Interiors");
    expect(row.client_status).toBe("Brand Blueprint Booked♠️");
    expect(row.in_onboarding).toBe(true);
    expect(row.links.kickoff_form).toContain("tG7dnxBn");
    expect(row.links.sales_call).toBe("https://fathom.video/share/abc");
    expect(row.links.contract).toBeUndefined();
    expect(row.links.ghl).toBe(
      "https://app.maharamedia.com/v2/location/AbCdEfGhIj1234567890/dashboard",
    );
    expect(row.links.clickup).toBe("https://app.clickup.com/t/z8xmdvffcd");
    expect(row.sales_transcript).toBe("Closer: hello");
    expect(row.handover.payment_plan).toBe("Split Pay (2x payments)");
    expect(row.handover.daily_budget).toBe(40);
    expect(JSON.stringify(row)).not.toContain("pit-secret");
    expect(row.forms).toBeUndefined();
  });

  test("onboarding is the roster's set, and ghosted only before launch", () => {
    expect(inOnboarding("Needs Contacting", null)).toBe(true);
    expect(inOnboarding("Active", null)).toBe(false);
    expect(inOnboarding("GHOSTED", null)).toBe(true);
    expect(inOnboarding("GHOSTED", "2026-09-01")).toBe(false);
    expect(inOnboarding(null, null)).toBe(false);
  });

  test("dates are Kuwait days", () => {
    // 2026-10-04 22:30 UTC is already the 5th in Kuwait.
    expect(kuwaitDay(Date.UTC(2026, 9, 4, 22, 30))).toBe("2026-10-05");
    expect(kuwaitDay(null)).toBeNull();
    expect(kuwaitDay("")).toBeNull();
  });

  test("says which needed field is gone from the list", () => {
    expect(missingFields(fieldsBody)).toEqual([]);
    expect(
      missingFields({
        fields: fieldsBody.fields.filter(f => f.id !== F.kickoffForm),
      }),
    ).toEqual(["Kickoff Form Link"]);
  });
});

const onboardingDef = {
  fields: [
    {
      ref: "name",
      type: "short_text",
      title: "Full Name | الاسم الكامل",
    },
    {
      ref: "addr-group",
      type: "inline_group",
      title: "Current Business Address | عنوان الشركه",
      properties: {
        fields: [
          {
            ref: "addr",
            type: "long_text",
            title:
              "Please enter your business address. | الرجاء كتابة عنوان الشركة",
          },
        ],
      },
    },
    { ref: "intro", type: "statement", title: "Thanks" },
    {
      ref: "goal",
      type: "number",
      title:
        "What is your realistic goal revenue in 90 Days?This question is required. | ما هو هدفك",
    },
    {
      ref: "types",
      type: "multiple_choice",
      title:
        "ما أنواع المواعيد التي تقدمونها؟\n| What types of appointments do you offer?",
    },
  ],
};

const kickoffDef = {
  fields: [
    {
      ref: "b5578678-d0c2-475b-b66f-7ea54d55fe31",
      type: "website",
      title: "Call Recording Link",
    },
    {
      ref: "75e97e7d-4c19-437a-b4b8-67570c29344f",
      type: "number",
      title: "Payment Amount",
    },
  ],
};

const resp = (
  id: string,
  at: string,
  answers: unknown[],
  hidden: Record<string, string>,
) => ({ response_id: id, submitted_at: at, answers, hidden });

describe("the forms", () => {
  const data = {
    definitions: {
      onboarding: onboardingDef,
      kickoff: kickoffDef,
      kickoffOld: kickoffDef,
      blueprint: { fields: [] },
    },
    responses: {
      onboarding: [
        resp(
          "r1",
          "2026-10-02T13:24:34Z",
          [
            { field: { ref: "name" }, type: "text", text: "Sara" },
            { field: { ref: "addr" }, type: "text", text: "Kuwait City" },
            { field: { ref: "goal" }, type: "number", number: 50000 },
            {
              field: { ref: "types" },
              type: "choices",
              choices: { labels: ["Online", "In your office"] },
            },
          ],
          { onboarding_client_id: "z8xmdvffcd" },
        ),
        resp(
          "r0",
          "2026-09-01T10:00:00Z",
          [{ field: { ref: "name" }, type: "text", text: "Old answer" }],
          { onboarding_client_id: "z8xmdvffcd" },
        ),
        resp("other", "2026-10-03T00:00:00Z", [], {
          onboarding_client_id: "86eyew6mt",
        }),
      ],
      kickoff: [
        resp(
          "k-new",
          "2026-10-04T09:39:59Z",
          [
            {
              field: { ref: "b5578678-d0c2-475b-b66f-7ea54d55fe31" },
              type: "url",
              url: "https://fathom.video/share/onboarding",
            },
            {
              field: { ref: "75e97e7d-4c19-437a-b4b8-67570c29344f" },
              type: "number",
              number: 2500,
            },
          ],
          { onboarding_client_id: "z8xmdvffcd" },
        ),
      ],
      kickoffOld: [
        resp("k-old", "2026-08-01T00:00:00Z", [], {
          onboarding_client_id: "z8xmdvffcd",
        }),
        resp("k-old2", "2026-08-02T00:00:00Z", [], {
          onboarding_client_id: "86eyew6mt",
        }),
      ],
      blueprint: [],
    },
  };

  test("the newest response per card", () => {
    const m = newestByCard(data.responses.onboarding);
    expect(m.get("z8xmdvffcd")?.response_id).toBe("r1");
    expect(m.get("86eyew6mt")?.response_id).toBe("other");
  });

  test("answers in the form's order, English titles, groups opened", () => {
    const f = formsFor("z8xmdvffcd", data);
    expect(f.onboarding?.response_id).toBe("r1");
    expect(f.onboarding?.answers.map(a => [a.title, a.value])).toEqual([
      ["Full Name", "Sara"],
      ["Please enter your business address.", "Kuwait City"],
      ["What is your realistic goal revenue in 90 Days?", "50000"],
      ["What types of appointments do you offer?", "Online, In your office"],
    ]);
  });

  test("the newer kickoff wins, with its recording and payment", () => {
    const f = formsFor("z8xmdvffcd", data);
    expect(f.kickoff?.form_id).toBe(FORMS.kickoff);
    expect(f.kickoff?.recording).toBe("https://fathom.video/share/onboarding");
    expect(f.kickoff?.payment).toBe("2500");
    // A client whose only kickoff is on the old form still has one.
    expect(formsFor("86eyew6mt", data).kickoff?.form_id).toBe(FORMS.kickoffOld);
    expect(formsFor("nobody", data)).toEqual({});
  });

  test("the step follows the forms", () => {
    expect(stepOf({ forms: {} })).toBe("before");
    expect(stepOf({ forms: formsFor("86eyew6mt", data) })).toBe("after");
    expect(
      stepOf({
        forms: { onboarding: formsFor("z8xmdvffcd", data).onboarding },
      }),
    ).toBe("call");
  });
});

describe("titles and values", () => {
  test("recalled values and markdown", () => {
    expect(
      questionTitle(
        "Service focus from kickoff is {{hidden:service_focus}}. Still the *service*?",
        { service_focus: "Interior design" },
      ),
    ).toBe("Service focus from kickoff is Interior design. Still the service?");
    expect(questionTitle("x".repeat(200)).length).toBe(158);
  });

  test("every answer kind reads as text", () => {
    expect(answerValue({ type: "boolean", boolean: false })).toBe("No");
    expect(
      answerValue({ type: "choice", choice: { other: "Something" } }),
    ).toBe("Something");
    expect(answerValue({ type: "date", date: "2026-10-05T00:00:00Z" })).toBe(
      "2026-10-05",
    );
    expect(answerValue({ type: "number", number: 0 })).toBe("0");
    expect(answerValue({ type: "unknown" })).toBe("");
  });

  test("the client's own onboarding form link", () => {
    expect(onboardingFormLink("z8xmdvffcd")).toBe(
      "https://maharamedia.typeform.com/to/KFRCXPFx#onboarding_client_id=z8xmdvffcd",
    );
  });
});
