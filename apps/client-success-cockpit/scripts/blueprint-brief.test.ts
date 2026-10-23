import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as B from "../src/present/blueprintBrief";

/**
 * The Brand Blueprint's words for ClickUp, Slack and the WhatsApp group
 * (src/present/blueprintBrief.ts, docs/brand-blueprint/SPEC.md 3.3 to 3.6),
 * on synthetic payloads only. The Edge Function's own tests
 * (supabase/functions/cockpit-creative-api/blueprint.test.ts) run the same
 * file through the executor.
 */

const PART1 = {
  service: "interior",
  capacity: "tight",
  capacity_note: "Two site teams busy until December",
  starter: "yes",
  pack_url: "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUv",
  pack_approval: "on_call",
  daily_budget: { usd: 40, said: "$50 a day" },
  destination: "lead_form",
  identity: "their_page",
  red_lines: ["No before and after photos", "No prices on screen"],
};
const base = (
  part: 1 | 2 | 3,
  answers: Record<string, unknown>,
  extra: Partial<B.BlueprintPayload> = {},
): B.BlueprintPayload => ({
  v: 1,
  part,
  press: 1,
  card: { id: "taskA1", name: "Acme Interiors" },
  answers,
  at: { pack_approval: "2026-10-21T07:11:00Z" },
  previous: null,
  launchTaskId: null,
  sentAt: "2026-10-21T07:12:00Z",
  sentBy: "Dana",
  links: {
    drive: "https://drive.google.com/drive/folders/acmeDrive000001",
    brandDna: "https://docs.google.com/document/d/acmeDna",
  },
  kickoff: {
    budgetSaid: "$50 a day",
    platforms: "Meta (Facebook/Instagram)",
    adAccount: "Acme Ads",
    pageName: "Acme Interiors Page",
    cardFunded: "Yes",
  },
  ...extra,
});

describe("the launch task's due date", () => {
  test("is the second working day after the press, Saturday to Thursday, 09:00 Kuwait", () => {
    // 2026-10-17 is a Saturday. Each press at 10:00 Kuwait.
    const due = (day: string) =>
      B.launchDue(new Date(`${day}T10:00:00+03:00`)).day;
    expect(due("2026-10-17")).toBe("2026-10-19"); // Sat → Mon
    expect(due("2026-10-18")).toBe("2026-10-20"); // Sun → Tue
    expect(due("2026-10-19")).toBe("2026-10-21"); // Mon → Wed
    expect(due("2026-10-20")).toBe("2026-10-22"); // Tue → Thu
    expect(due("2026-10-21")).toBe("2026-10-24"); // Wed → Sat (Friday off)
    expect(due("2026-10-22")).toBe("2026-10-25"); // Thu → Sun
    expect(due("2026-10-23")).toBe("2026-10-25"); // Fri → Sun
    expect(B.launchDue(new Date("2026-10-21T07:00:00Z")).ms).toBe(
      Date.parse("2026-10-24T09:00:00+03:00"),
    );
    // Late at night in Kuwait is already the next Kuwait day.
    expect(B.launchDue(new Date("2026-10-20T22:30:00Z")).day).toBe(
      "2026-10-24",
    );
  });
});

describe("the card mappings", () => {
  test("Templated Ads Status, Ad Approval Needed? and Can Self-Record?", () => {
    expect(
      B.templatedStatus({ starter: "yes", pack_approval: "on_call" }),
    ).toBe("Approved");
    expect(B.templatedStatus({ starter: "yes", pack_approval: "before" })).toBe(
      "Approved",
    );
    expect(
      B.templatedStatus({ starter: "yes", pack_approval: "wants_changes" }),
    ).toBe("Wants To See Them First");
    expect(B.templatedStatus({ starter: "no", pack_approval: "on_call" })).toBe(
      "Declined",
    );
    expect(B.templatedStatus({ starter: "yes" })).toBeNull();
    expect(B.templatedStatus({})).toBeNull();
    expect(
      ["every", "first_batch", "run_then_show", "x"].map(B.adApprovalNeeded),
    ).toEqual(["Yes", "Yes", "No", null]);
    expect(
      ["yes_studio", "yes_phone", "no", "unsure", "x"].map(B.canSelfRecord),
    ).toEqual([
      "Yes - studio/cameraman",
      "Yes - phone only",
      "No",
      "Unsure",
      null,
    ]);
    expect(B.launchName(" Acme Interiors ")).toBe(
      "Acme Interiors - New Client Campaign Launch 🚀",
    );
    expect(B.launchTag(" Acme Interiors ")).toBe("acme interiors");
    expect(B.mapUrl("taskA1")).toBe(
      "https://mahara-onboarding-map.vercel.app/?phase=5&cid=taskA1",
    );
  });
  test("the fields no press writes are named by their known prefixes", () => {
    expect(B.NEVER_WRITTEN.map(f => f.name)).toEqual([
      "Launch Date",
      "Next Payment Date",
      "Daily Budget",
    ]);
    const all = [...Object.values(B.CARD_FIELDS).map(f => f.prefix)];
    for (const f of B.NEVER_WRITTEN) expect(all).not.toContain(f.prefix);
  });
});

describe("the brief", () => {
  test("starter ads: the lines media needs, in order", () => {
    const text = B.launchBrief(base(1, PART1), { assigned: true });
    expect(text.split("\n")).toEqual([
      "Brand Blueprint, starter ads",
      "Client: Acme Interiors, https://app.clickup.com/t/taskA1",
      "Service: Interior design",
      "Starter ads: Yes. Pack: https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUv. Approved on the Blueprint call, 21 Oct 10:11 (Kuwait).",
      "Offer: the starter pack's own. Their custom offer is locked within 1 to 2 days.",
      'Daily budget: 40 USD a day (the kickoff said "$50 a day"; corrected on the call)',
      "Sends people to: Lead form",
      'Publishing: Their Page "Acme Interiors Page" · Ad account "Acme Ads" · Card with funds: Yes',
      "Platforms: Meta (Facebook/Instagram)",
      "Red lines:",
      "- No before and after photos",
      "- No prices on screen",
      "Capacity: Tight. Two site teams busy until December",
      "Links: Drive https://drive.google.com/drive/folders/acmeDrive000001 · Brand DNA https://docs.google.com/document/d/acmeDna",
      "Sent from the Brand Blueprint by Dana.",
    ]);
  });
  test("no starter ads, a budget the kickoff agreed with, our Page and no launch media buyer", () => {
    const text = B.launchBrief(
      base(1, {
        ...PART1,
        starter: "no",
        identity: "our_page",
        daily_budget: { usd: 50 },
        capacity: "yes",
      }),
      { assigned: false },
    );
    const lines = text.split("\n");
    expect(lines[0]).toBe(
      "Unassigned: set the launch media buyer in Settings.",
    );
    expect(lines).toContain(
      "No starter ads: build the account and wait for custom ads.",
    );
    expect(text).not.toContain("Starter ads: Yes");
    expect(text).not.toContain("starter pack's own");
    expect(lines).toContain("Daily budget: 50 USD a day");
    expect(lines.find(l => l.startsWith("Publishing:"))).toBe(
      'Publishing: Our Page · Ad account "Acme Ads" · Card with funds: Yes',
    );
    expect(lines).toContain("Capacity: Yes");
  });
  test("a later press lists only what changed", () => {
    // As the server sends it: with capacity Yes, the note is no longer part of the part's answers.
    const { capacity_note: _note, ...rest } = PART1;
    const next = {
      ...rest,
      daily_budget: { usd: 35 },
      red_lines: ["No prices on screen", "No faces"],
      capacity: "yes",
    };
    const text = B.launchUpdate(base(1, next, { press: 2, previous: PART1 }));
    expect(text.split("\n")).toEqual([
      "Updated from the Blueprint",
      "Client: Acme Interiors, https://app.clickup.com/t/taskA1",
      "Daily budget: 40 → 35 USD a day",
      'Red lines: added "No faces"; removed "No before and after photos"',
      "Capacity: Tight → Yes",
      "Capacity note: removed (was Two site teams busy until December)",
      "Sent from the Brand Blueprint by Dana.",
    ]);
    expect(B.launchUpdate(base(1, PART1, { previous: PART1 }))).toContain(
      "Nothing in the starter ads part changed.",
    );
  });
  test("the capacity comment is for Tight or No only", () => {
    expect(B.capacityComment(base(1, PART1))).toContain(
      "Capacity: Tight. Two site teams busy until December",
    );
    expect(
      B.capacityComment(base(1, { ...PART1, capacity: "yes" })),
    ).toBeNull();
  });
  test("reads the kickoff's first number, Arabic-Indic digits too; a range or another currency still shows what was said", () => {
    expect(
      ["$40 a day", "40 دولار", "٤٠", "40 to 50", "KWD 15", "none"].map(
        B.firstNumber,
      ),
    ).toEqual([40, 40, 40, 40, 15, null]);
    const kwd = B.launchBrief(
      base(1, PART1, { kickoff: { budgetSaid: "15 دينار" } }),
      { assigned: true },
    );
    expect(kwd).toContain(
      'Daily budget: 40 USD a day (the kickoff said "15 دينار"; corrected on the call)',
    );
  });
});

describe("the close and the offer", () => {
  const PART2 = {
    approval: "run_then_show",
    camera: "unsure",
    shot_list: true,
    shot_list_due: "2026-10-24T07:00:00.000Z",
    minimum: { amount: 3000, currency: "KWD" },
    anchor: { amount: 1250000, currency: "SAR" },
    csm_signals: "Asked about a second branch (example)",
  };
  const close = (extra: Partial<B.BlueprintPayload> = {}) =>
    base(2, PART2, {
      launchCall: { startsAt: "2026-10-25T07:00:00Z" },
      mapUrl: B.mapUrl("taskA1"),
      ...extra,
    });
  test("the launch task hears the approval, the camera, the shot list and the project sizes in their currency", () => {
    const t = B.closeLaunchComment(close());
    expect(t).toContain("Custom ads approval: We run, then show them");
    expect(t).toContain("On camera: Not sure yet");
    expect(t).toContain("Shot list: given, due Sat 24 Oct");
    expect(t).toContain(
      "Smallest project: 3,000 KWD · Ads point to: 1,250,000 SAR",
    );
  });
  test("the CSM's comment carries the paste-ready message once Make 14's text is copied in, and the content folder", () => {
    const text = "Phase 5 example text {map}";
    const p = close({
      links: {
        driveFolder: "https://drive.google.com/drive/folders/acmeFolder0001",
      },
    });
    const msg = B.phase5Message(p, text);
    expect(msg).toBe(
      `Phase 5 example text https://mahara-onboarding-map.vercel.app/?phase=5&cid=taskA1\n\n${B.CONTENT_FOLDER_BLOCK.replace("{folder}", "https://drive.google.com/drive/folders/acmeFolder0001")}`,
    );
    const c = B.closeCsmComment(p, {
      whatsapp: true,
      launchFound: true,
      makeFallback: false,
      phase5: msg,
    });
    expect(c).toContain("Launch call booked for Sun 25 Oct 10:00 (Kuwait).");
    expect(c).toContain(`Paste this in the client's WhatsApp group:\n${msg}`);
    const later = B.closeCsmComment(close({ previous: PART2 }), {
      whatsapp: false,
      launchFound: true,
      makeFallback: false,
    });
    expect(later).not.toContain("WhatsApp");
    expect(
      B.closeCsmComment(close({ launchCall: null }), {
        whatsapp: false,
        launchFound: false,
        makeFallback: false,
      }),
    ).toContain("Launch call not booked yet.");
  });
  test("without Make 14's text, the CSM is told to send the usual phase 5 message with the map link", () => {
    expect(B.phase5Message(close(), null)).toBeNull();
    expect(
      B.closeCsmComment(close(), {
        whatsapp: true,
        launchFound: true,
        makeFallback: false,
        phase5: null,
      }),
    ).toContain(
      "Send the usual phase 5 message with this map link: https://mahara-onboarding-map.vercel.app/?phase=5&cid=taskA1",
    );
  });
  // The ship gate (SPEC 3.6, 7.3 step 2): this fails until Make 14 module
  // [7]'s phase 5 text is copied into blueprintBrief.ts by a read-only GET
  // of the scenario's blueprint, so the build cannot ship without it.
  test("PHASE5_WHATSAPP holds Make 14 module [7]'s text (ship step 2)", () => {
    expect(B.PHASE5_WHATSAPP).not.toBeNull();
    expect(B.PHASE5_WHATSAPP).toContain("{map}");
  });
  test("the Make body has six keys here; the provider adds the key when it sends, so seven go to Make", () => {
    const body = B.makeClose(close(), B.slackCloseText(close(), "lt12345"));
    expect(Object.keys(body)).toEqual([
      "source",
      "event",
      "task_id",
      "card_name",
      "can_self_record",
      "slack_text",
    ]);
    expect(body).toEqual({
      source: "mahara-cockpit",
      event: "blueprint.call_closed",
      task_id: "taskA1",
      card_name: "Acme Interiors",
      can_self_record: "Unsure",
      slack_text:
        "Brand Blueprint completed: Acme Interiors. Scripts and custom creative can start. https://app.clickup.com/t/lt12345",
    });
  });
  test("the offer comment, first and later", () => {
    const offer = {
      offer: {
        name: "The Site Visit (example)",
        what: "A measured plan",
        firstStep: "A free visit",
      },
    };
    expect(
      B.offerLaunchComment(
        base(3, offer, {
          offerSheet: "https://docs.google.com/document/d/acmeOffer",
        }),
      ),
    ).toBe(
      "Offer locked: The Site Visit (example): A measured plan. First step: A free visit. Offer sheet: https://docs.google.com/document/d/acmeOffer. Custom ads in production.\nSent from the Brand Blueprint by Dana.",
    );
    expect(B.offerLaunchComment(base(3, offer, { previous: offer }))).toMatch(
      /^Offer updated: /,
    );
    expect(
      B.dnaMissingComment(base(3, offer, { dna_missing: "Tone of voice" })),
    ).toContain("Brand DNA still missing: Tone of voice");
  });
});

describe("copy rules", () => {
  test("no em dash, no exclamation mark, and nothing that promises results, in the file or anything it writes", () => {
    const src = readFileSync(
      new URL("../src/present/blueprintBrief.ts", import.meta.url),
      "utf8",
    );
    expect(src).not.toContain("—");
    const texts = [
      B.launchBrief(base(1, PART1), { assigned: false }),
      B.launchUpdate(
        base(1, { ...PART1, daily_budget: { usd: 30 } }, { previous: PART1 }),
      ),
      B.capacityComment(base(1, PART1)) ?? "",
      B.closeLaunchComment(base(2, { approval: "every", camera: "no" })),
      B.closeCsmComment(base(2, {}), {
        whatsapp: true,
        launchFound: false,
        makeFallback: true,
      }),
      B.slackCloseText(base(2, {}), null),
      B.offerLaunchComment(base(3, {})),
    ];
    for (const t of texts) {
      expect(t).not.toContain("—");
      expect(t).not.toContain("!");
      expect(t).not.toMatch(/guarantee|leads|cost per lead|CPL|ROI/i);
    }
  });
  test("is import-free, so the Edge Function bundles it", () => {
    const src = readFileSync(
      new URL("../src/present/blueprintBrief.ts", import.meta.url),
      "utf8",
    );
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toMatch(/^\s*export .* from /m);
  });
});

test("the brief and the notes name the five services as the slides do", async () => {
  const { SERVICES } = await import("../src/present/content");
  for (const k of [
    "design-build",
    "interior",
    "architecture",
    "fitout",
    "construction",
  ] as const)
    expect(B.SERVICE_LABEL[k]).toBe(SERVICES[k].name.en);
});
