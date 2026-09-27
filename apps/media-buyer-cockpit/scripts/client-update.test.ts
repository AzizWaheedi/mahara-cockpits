// What a client is told, checked without a browser: bun test scripts/client-update.test.ts
import { describe, expect, test } from "bun:test";
import {
  appointments,
  howItIsGoing,
  joinList,
  whatWeDid,
  whatWeDidAll,
} from "../src/lib/clientUpdate";

/** Nothing a client reads talks about leads or what one cost. */
const NO_LEADS = /lead|ليد|عميل محتمل|تكلفة|per lead|\bCPL\b/i;
/** The Kuwaiti voice rules for Arabic copy. */
const ARABIC_RULES = /[—«»$0-9]/;

const VERDICTS = [
  "scale",
  "hold",
  "below KPI",
  "fatiguing",
  "kill",
  "no delivery",
  undefined,
];

const LABELS = [
  "Scale the winner",
  "Raise to $60/day",
  'Raised the campaign budget on "Villa | Leads" from $30.00 to $38.00 a day.',
  "Cut the worst ad",
  'Paused "Hook 2" — $42.00 spent for 1 leads ($42.00 each), the worst in the campaign.',
  "Duplicate the winner",
  "Turn it off",
  "Queue replacement creative",
  "Thank-you video to lift show rate",
  "Switch to a landing page",
  "Add qualification questions to the lead form",
  "Built a new campaign — 3 copy variants, $40/day, fresh targeting. Paused on Meta.",
  'Created ad set "Broad 2" (paused) by copying the targeting from "Broad"',
  'Created 3 new ads (paused) from "Hook 1" with new copy',
  'Added a new video creative (paused) to "Hook 1"\'s ad set',
  'Added a new image creative (paused) to "Hook 1"\'s ad set',
  'Turned on ad "Hook 3" from the cockpit',
  'Turned off ad "Hook 2" from the cockpit',
  'Turned on campaign "Villa | Leads" from the cockpit',
  'Turned off campaign "Villa | Leads" from the cockpit',
];

describe("appointments", () => {
  test("counts in English and with Arabic agreement", () => {
    expect(appointments(1, "en")).toBe("1 appointment");
    expect(appointments(4, "en")).toBe("4 appointments");
    expect(appointments(1, "ar")).toBe("موعد واحد");
    expect(appointments(2, "ar")).toBe("موعدين");
    expect(appointments(3, "ar")).toBe("٣ مواعيد");
    expect(appointments(10, "ar")).toBe("١٠ مواعيد");
    expect(appointments(11, "ar")).toBe("١١ موعد");
  });
});

describe("howItIsGoing", () => {
  test("counts appointments only for clients we book for", () => {
    expect(
      howItIsGoing({ verdict: "scale", bookings: 4, weBook: true }, "en"),
    ).toBe("4 appointments were booked with you this week");
    expect(
      howItIsGoing({ verdict: "scale", bookings: 4, weBook: true }, "ar"),
    ).toBe("انحجز لكم ٤ مواعيد هالأسبوع");
    // Done with you: they book their own, so no count, however many.
    expect(
      howItIsGoing({ verdict: "scale", bookings: 4, weBook: false }, "en"),
    ).toBe("the campaign is performing well");
    expect(
      howItIsGoing({ verdict: "hold", bookings: 1, weBook: true }, "en"),
    ).toBe(
      "1 appointment was booked with you this week, and we're working to get more out of the campaign",
    );
  });

  test("never mentions leads, and keeps the Arabic rules", () => {
    for (const verdict of VERDICTS)
      for (const bookings of [0, 1, 7])
        for (const weBook of [true, false]) {
          const en = howItIsGoing({ verdict, bookings, weBook }, "en");
          const ar = howItIsGoing({ verdict, bookings, weBook }, "ar");
          expect(en).not.toMatch(NO_LEADS);
          expect(ar).not.toMatch(NO_LEADS);
          expect(ar).not.toMatch(ARABIC_RULES);
          expect(en.length).toBeGreaterThan(10);
        }
  });
});

describe("whatWeDid", () => {
  test("says every known change in client words, in both languages", () => {
    for (const label of LABELS) {
      const en = whatWeDid(label, "en");
      const ar = whatWeDid(label, "ar");
      expect(en).not.toBeNull();
      expect(ar).not.toBeNull();
      expect(en).not.toMatch(NO_LEADS);
      expect(ar).not.toMatch(NO_LEADS);
      expect(ar).not.toMatch(ARABIC_RULES);
      // No budget amount: it may be in the account's own currency.
      expect(en).not.toMatch(/\$|\d/);
    }
    expect(whatWeDid("Scale the winner", "en")).toBe(
      "gave more budget to your best-performing ad",
    );
    expect(whatWeDid("Raise to $60/day", "ar")).toBe("رفعنا الميزانية اليومية");
  });

  test("keeps quiet about what is not the client's business", () => {
    for (const label of [
      "Left",
      "Watch for 3 days",
      "Add to Ads Management board",
      "Client card declined, chase the payment",
      "Leads are not being called",
      "Asked Aziz: can we raise the budget?",
      "Changed the headline because the client asked",
      'Turned off adset "Broad" from the cockpit',
    ])
      expect(whatWeDid(label, "en")).toBeNull();
  });

  test("a decision and the log line it wrote are said once", () => {
    expect(
      whatWeDidAll(
        [
          "Cut the worst ad",
          'Paused "Hook 2" — $42.00 spent for 1 leads ($42.00 each), the worst in the campaign.',
          "Scale the winner",
          'Raised the ad set budget on "Broad" from $30.00 to $38.00 a day.',
          "Left",
        ],
        "en",
      ),
    ).toEqual([
      "switched off the weakest ad, so the budget goes to the ads that work",
      "gave more budget to your best-performing ad",
    ]);
  });
});

describe("joinList", () => {
  test("joins the way each language does", () => {
    expect(joinList(["a"], "en")).toBe("a");
    expect(joinList(["a", "b"], "en")).toBe("a and b");
    expect(joinList(["a", "b", "c"], "en")).toBe("a, b and c");
    expect(joinList(["أ", "ب"], "ar")).toBe("أ، وب");
    expect(joinList(["أ", "ب", "ج"], "ar")).toBe("أ، ب، وج");
  });
});
