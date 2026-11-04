import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  callOf,
  checkValue,
  DEFCON_OPTIONS,
  FROKTITH,
  KEYS,
  legacyAnswers,
  missing,
  SCHEMA,
  sameValue,
  sendBlock,
} from "../src/forms/checkinForm";
import { buildBrief, formAnswer } from "../src/lib/clientBrief";
import type { Timeline } from "../src/lib/csmCalls";

/**
 * The 1-1 notes form (src/forms/checkinForm.ts; docs/forms/STAGE2-CONTRACT.md
 * 2.1, 3.1, 3.2 and 7.2): the browser's schema is the registry seed itself
 * (the text between the two $checkin_v1$ tokens of the forms core
 * migration), every fRokTITH question has a place, DEFCON's labels are the
 * Typeform's choices and the card's Client Happiness options, the write
 * through reads in the client brief exactly as a Typeform response does
 * (through buildBrief and formAnswer, never a copy of the brief's rules),
 * and the browser refuses what the server would.
 *
 * Run: bun test scripts/checkin-form.test.ts
 */

const app = resolve(import.meta.dir, "..");
const MIGRATION = resolve(
  app,
  "../../supabase/migrations/20261027f_forms_core.sql",
);

/** The JSON between the two $checkin_v1$ tokens inside the markers. */
function seededSchema(): unknown {
  const sql = readFileSync(MIGRATION, "utf8");
  const begin = sql.indexOf("-- checkin schema v1 begin");
  const end = sql.indexOf("-- checkin schema v1 end");
  if (begin < 0 || end < begin)
    throw Error("The checkin schema v1 markers are not in the migration.");
  const block = sql.slice(begin, end);
  const parts = block.split("$checkin_v1$");
  if (parts.length !== 3)
    throw Error(
      "Expected exactly one $checkin_v1$ literal between the markers.",
    );
  expect(sql.split("$checkin_v1$").length).toBe(3);
  return JSON.parse(parts[1] as string);
}

describe("the schema is the registry's seed", () => {
  test("the mirror equals the JSON between the two $checkin_v1$ tokens", () => {
    expect(seededSchema()).toEqual(SCHEMA);
  });

  test("six answers, three of them required, DEFCON's choices locked", () => {
    expect(KEYS).toEqual([
      "call",
      "defcon",
      "priority",
      "we_owe",
      "they_owe",
      "client_notes",
    ]);
    expect(SCHEMA.fields.filter(f => f.required).map(f => f.key)).toEqual([
      "call",
      "defcon",
      "priority",
    ]);
    expect(SCHEMA.fields.find(f => f.key === "defcon")?.locked).toBe("choices");
  });
});

describe("every fRokTITH question has a place (GET /forms/fRokTITH, 2026-10-26)", () => {
  // The six questions of the live form, as the form-and-screens map read them.
  const LIVE = [
    ["c484f390-9695-4ffa-9693-9cc219592713", "Client ID"],
    ["0773087f-beda-4e2c-bf50-acdac0dcbe05", "Clients Call Transcript"],
    ["82a6b434-15d9-4a14-8496-c20c94628536", "Additional Notes"],
    ["5d071906-da6a-4413-a729-0c76d0188d91", "Client Notes"],
    ["ff7970f7-9fad-4fa5-b12b-4d719dfb7587", "Defcon Status"],
    ["c9f99fb1-fec9-47e7-9baa-c5554733723d", "Task Priority"],
  ] as const;

  test("each ref maps to a native answer or the route's card ID", () => {
    for (const [ref, title] of LIVE) {
      const m = FROKTITH[ref];
      expect(m?.title).toBe(title);
      for (const k of m?.native ?? [])
        expect(k === "task_id" || (KEYS as string[]).includes(k)).toBe(true);
    }
    expect(Object.keys(FROKTITH).sort()).toEqual(LIVE.map(l => l[0]).sort());
  });

  test("the write-through keeps the Typeform's exact titles and refs", () => {
    const legacy = SCHEMA.fields.flatMap(f => (f.legacy ? [f.legacy] : []));
    for (const l of [...legacy, SCHEMA.legacy.clientId]) {
      expect(FROKTITH[l.ref]?.title).toBe(l.title);
    }
    expect(SCHEMA.legacy.recording).toEqual({
      ref: "cockpit:call",
      title: "Call recording",
      type: "url",
    });
  });
});

describe("DEFCON is the Typeform's choices and the card's options", () => {
  // Typeform's Defcon Status choices, in order (form-and-screens 2.4).
  const TYPEFORM = [
    "Paused",
    "At Risk",
    "Neutral",
    "Happy",
    "Very Happy (testimonial)",
    "Churned",
  ];
  // The card's Client Happiness options (live field, Make [21]'s switch, 7.1).
  const CLICKUP: Record<string, string> = {
    Paused: "67c08bcd-e629-47ab-85ba-3ac4b3796734",
    "At Risk": "f0623c2a-161d-4aa2-8833-d1337c69e1c2",
    Neutral: "46e595a3-17d7-4835-80f9-8a4c578b72a3",
    Happy: "c5d6b01f-5f2b-40c1-afac-5b9f1efab213",
    "Very Happy (testimonial)": "d403adf4-24aa-40f0-a960-05e6a4621ee9",
    Churned: "1c055070-45d6-4a19-ade3-958851313d7c",
  };

  test("the labels, in the Typeform's order, and one option id each", () => {
    expect(SCHEMA.fields.find(f => f.key === "defcon")?.choices).toEqual(
      TYPEFORM,
    );
    expect(Object.keys(DEFCON_OPTIONS)).toEqual(TYPEFORM);
    expect(DEFCON_OPTIONS).toEqual(CLICKUP);
    expect(SCHEMA.fields.find(f => f.key === "priority")?.choices).toEqual([
      "911",
      "High",
      "Medium",
      "Low",
    ]);
  });
});

describe("the write-through reads in the client brief as a Typeform response does", () => {
  const TASK = "86exfix01";
  const SHARE = "https://fathom.video/share/EXAMPLEaaaa1111";
  const answers = {
    call: {
      kind: "fathom",
      recordingId: "190000101",
      why: "same_room",
      confirmed: true,
      shareUrl: SHARE,
      startsAt: "2026-10-11T07:34:00Z",
      endsAt: "2026-10-11T08:08:00Z",
    },
    defcon: "At Risk",
    priority: "High",
    we_owe: [
      { text: "Send the revised offer with the new packages" },
      { text: "Pause the villa campaign until the photos are in" },
    ],
    they_owe: [{ text: "Share photos of the two finished projects" }],
    client_notes: "Worried about the December budget.",
  };

  test("legacyAnswers gives the six rows in the Typeform's order", () => {
    const rows = legacyAnswers(answers, TASK);
    expect(rows.map(r => r.title)).toEqual([
      "Client ID",
      "Call recording",
      "Additional Notes",
      "Client Notes",
      "Defcon Status",
      "Task Priority",
    ]);
    expect(rows[0]).toEqual({
      ref: "c484f390-9695-4ffa-9693-9cc219592713",
      type: "short_text",
      title: "Client ID",
      value: TASK,
    });
    expect(rows[2]?.value).toBe(
      [
        "Mahara: Send the revised offer with the new packages",
        "Mahara: Pause the villa campaign until the photos are in",
        "Client: Share photos of the two finished projects",
      ].join("\n"),
    );
    // A call with no recording and no lists leaves those rows out.
    const bare = legacyAnswers(
      { call: { kind: "none", why: "none" }, defcon: "Happy", priority: "Low" },
      TASK,
    );
    expect(bare.map(r => r.title)).toEqual([
      "Client ID",
      "Defcon Status",
      "Task Priority",
    ]);
  });

  test("formAnswer finds DEFCON, priority, the recording and the notes by the brief's own patterns", () => {
    const form = { answers: legacyAnswers(answers, TASK) };
    expect(formAnswer(form, /defcon/i)).toBe("At Risk");
    expect(formAnswer(form, /priority/i)).toBe("High");
    expect(formAnswer(form, /recording/i)).toBe(SHARE);
    expect(formAnswer(form, /^client notes|additional notes/i)).not.toBe("");
  });

  test("buildBrief reads the mood, the priority and both sides' promises from it", () => {
    const now = Date.parse("2026-10-12T13:00:00Z");
    const timeline: Timeline = {
      taskId: TASK,
      clientName: "Cedar & Stone Interiors",
      calls: [
        {
          id: 1,
          source: "fathom",
          kind: "checkin",
          status: "held",
          upcoming: false,
          startsAt: "2026-10-11T07:34:00Z",
          endsAt: "2026-10-11T08:08:00Z",
          recordingUrl: SHARE,
        },
      ],
      forms: [
        {
          token: "cockpit:0b5f7c9e-1d2a-4c3b-9e8f-7a6b5c4d3e2f",
          formId: "cockpit-checkin",
          kind: "checkin",
          submittedAt: "2026-10-11T08:20:00Z",
          linkedCallId: 1,
          recordingUrl: SHARE,
          answers: legacyAnswers(answers, TASK),
        },
      ],
      changes: [],
      health: [
        "csm-ghl-calls",
        "csm-fathom",
        "csm-checkin-form",
        "csm-eod-mentions",
        "csm-meta-activities",
      ].map(key => ({ key, ok: true, lastOkAt: "2026-10-12T12:55:00Z" })),
      unmatchedCount: 0,
    };
    const brief = buildBrief({
      now,
      client: { name: "Cedar & Stone Interiors", stage: "Active" },
      timeline,
      digests: [],
    });
    expect(brief.defcon?.value).toBe("At Risk");
    expect(brief.defcon?.risk).toBe(true);
    expect(brief.priority).toBe("High");
    const ours = brief.promises.ours.map(l => l.text);
    const theirs = brief.promises.theirs.map(l => l.text);
    expect(ours).toContain("Send the revised offer with the new packages");
    expect(ours).toContain("Pause the villa campaign until the photos are in");
    expect(theirs).toContain("Share photos of the two finished projects");
    expect(ours.some(t => /share photos/i.test(t))).toBe(false);
  });
});

describe("the browser refuses what the server would (3.2)", () => {
  test("each sentence, word for word", () => {
    const err = (k: string, v: unknown) => {
      const c = checkValue(k, v);
      return "error" in c ? c.error : null;
    };
    expect(err("call", { kind: "zoom", why: "picked" })).toBe(
      "Pick the call these notes are for, or choose No recording.",
    );
    expect(err("call", "190000101")).toBe(
      "Pick the call these notes are for, or choose No recording.",
    );
    expect(
      err("call", { kind: "fathom", recordingId: "ab12", why: "picked" }),
    ).toBe(
      "That recording is not in the cockpit yet. Check again in a minute.",
    );
    expect(err("defcon", "Calm")).toBe('"Calm" is not one of the answers.');
    expect(
      err(
        "we_owe",
        Array.from({ length: 31 }, (_, i) => ({ text: `Line ${i}` })),
      ),
    ).toBe("Keep it to 30 lines.");
    expect(err("we_owe", [{ text: "x".repeat(301) }])).toBe(
      "Keep each line under 300 characters.",
    );
    expect(err("they_owe", [{ text: "  " }])).toBe(
      "A line is missing its text.",
    );
    expect(err("client_notes", "x".repeat(4001))).toBe(
      "Keep it under 4,000 characters.",
    );
    expect(err("grade", "A")).toBe("That is not a question of this form.");
  });

  test("values are normalised as the server stores them", () => {
    expect(checkValue("client_notes", "  Calm.  ")).toEqual({ value: "Calm." });
    expect(checkValue("client_notes", "   ")).toEqual({ value: null });
    expect(
      checkValue("we_owe", [
        { text: " Send the offer " },
        { text: "send the offer" },
        { text: "Book the shoot", owner: "the media buyer", at: 761 },
      ]),
    ).toEqual({
      value: [
        {
          text: "Send the offer",
          owner: null,
          at: null,
          href: null,
          from: "csm",
          unsure: false,
        },
        {
          text: "Book the shoot",
          owner: "the media buyer",
          at: 761,
          href: null,
          from: "csm",
          unsure: false,
        },
      ],
    });
    expect(checkValue("we_owe", [])).toEqual({ value: null });
    // A guess keeps the browser's confirmed; a sure pick is confirmed.
    expect(
      checkValue("call", {
        kind: "fathom",
        recordingId: "190000101",
        why: "latest_unlinked",
        confirmed: false,
      }),
    ).toEqual({
      value: {
        kind: "fathom",
        recordingId: "190000101",
        why: "latest_unlinked",
        confirmed: false,
      },
    });
    expect(
      checkValue("call", {
        kind: "fathom",
        recordingId: "190000101",
        why: "picked",
      }),
    ).toEqual({
      value: {
        kind: "fathom",
        recordingId: "190000101",
        why: "picked",
        confirmed: true,
      },
    });
    expect(
      checkValue("call", { kind: "booking", callId: 54462, why: "booking" }),
    ).toEqual({
      value: { kind: "booking", callId: 54462, why: "booking" },
    });
    expect(sameValue({ a: 1, b: [2] }, { b: [2], a: 1 })).toBe(true);
  });

  test("an unconfirmed call counts as not answered, and Send says what is missing", () => {
    const guess = {
      kind: "fathom",
      recordingId: "190000101",
      why: "near_booking",
      confirmed: false,
    };
    expect(missing({ call: guess, defcon: "Happy", priority: "Low" })).toEqual([
      "call",
    ]);
    expect(sendBlock({})).toBe(
      "Pick the call these notes are for, or choose No recording.",
    );
    expect(sendBlock({ call: guess })).toBe(
      "Confirm the call: press Yes, this call, or pick another.",
    );
    expect(sendBlock({ call: { ...guess, confirmed: true } })).toBe(
      "Pick DEFCON and priority to send.",
    );
    expect(
      sendBlock({
        call: { kind: "none", why: "none" },
        defcon: "Happy",
        priority: "Low",
      }),
    ).toBeNull();
    expect(callOf({ kind: "booking", callId: "x" })).toBeNull();
  });
});
