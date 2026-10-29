import { describe, expect, test } from "bun:test";
import { FILLED, shadowEffects } from "../src/dev/checkinFixtures";
import {
  EFFECT_STATES,
  type EffectView,
  OWNERS,
} from "../src/forms/checkinClient";
import {
  cardLine,
  MAKE_DOES,
  stopFor,
  type TrailContext,
  trailDone,
  trailNote,
  trailSettled,
  trailStops,
} from "../src/forms/checkinTrail";

/**
 * The trail after a send (src/forms/checkinTrail.ts;
 * docs/forms/STAGE2-CONTRACT.md 8.5, The trail): every owner and state has
 * its sentence, although 2a only meets `shadow` and `skipped`; a quiet stop
 * and a plan never count as done; a shadow run shows all eight plans; once
 * the cockpit delivers, the card's three fields read as one line.
 *
 * Run: bun test scripts/checkin-trail.test.ts
 */

const CTX: TrailContext = {
  taskId: "86exfix01",
  clientName: "Cedar & Stone Interiors",
  answers: FILLED,
  submittedAt: "2026-10-25T08:10:00Z",
};

const effect = (over: Partial<EffectView>): EffectView => ({
  key: "todo_comment",
  label: "To-do comment on the card",
  owner: "cockpit",
  delivery: "clickup_queue",
  state: "planned",
  at: "2026-10-25T08:11:00Z",
  reason: null,
  lines: [
    "Would post the to-do comment on the card: 3 lines, recording link first.",
  ],
  ...over,
});

describe("every owner and state has a sentence", () => {
  test("shadow, dry_run: the label, then the plan's first line, a neutral dot", () => {
    const s = stopFor(
      effect({
        key: "happiness",
        label: "Client Happiness",
        owner: "shadow",
        state: "dry_run",
        lines: ["Would set Client Happiness to At risk."],
      }),
      CTX,
    );
    expect(s.label).toBe("Client Happiness");
    expect(s.line).toBe("Would set Client Happiness to At risk.");
    expect(s.tone).toBe("plan");
    expect(s.done).toBe(false);
  });

  test("any owner, skipped: the label and the reason, quiet, never done", () => {
    for (const owner of ["shadow", "cockpit"] as const) {
      const s = stopFor(
        effect({
          owner,
          state: "skipped",
          reason: "No comment: We owe and They owe are empty.",
          lines: [],
        }),
        CTX,
      );
      expect(s.line).toBe("No comment: We owe and They owe are empty.");
      expect(s.quiet).toBe(true);
      expect(s.done).toBe(false);
    }
  });

  test("make, skipped: what Make still does, per effect", () => {
    const s = stopFor(
      effect({
        owner: "make",
        state: "skipped",
        reason: "Make does this until the switch-over.",
      }),
      CTX,
    );
    expect(s.line).toBe("Make posts the to-do comment until the switch-over.");
    expect(s.quiet).toBe(true);
    for (const key of Object.keys(MAKE_DOES))
      expect(
        stopFor(effect({ key, owner: "make", state: "skipped" }), CTX).line,
      ).toBe(MAKE_DOES[key] as string);
  });

  test("cockpit, planned or queued: what is happening now", () => {
    const working = (key: string, state: "planned" | "queued") =>
      stopFor(effect({ key, state }), CTX).line;
    expect(working("todo_comment", "planned")).toBe(
      "Posting the to-do comment on the card…",
    );
    for (const key of ["happiness", "last_poc", "last_checkin_call"])
      expect(working(key, "queued")).toBe("Updating the card…");
    expect(working("grade_notice", "planned")).toBe("Grading the call…");
    expect(working("grade_notice", "queued")).toBe(
      "Waiting to post in #client-call-feedback.",
    );
    expect(working("recap", "planned")).toBe("Drafting the client's recap…");
    expect(working("call_form", "planned")).toBe("Saving the notes…");
    expect(stopFor(effect({ state: "queued" }), CTX).tone).toBe("wait");
  });

  test("cockpit, delivered: where it landed and when, with a way to it", () => {
    const comment = stopFor(effect({ state: "delivered" }), CTX);
    expect(comment.line).toBe("On the card at 11:11.");
    expect(comment.link).toEqual({
      href: "https://app.clickup.com/t/86exfix01",
      label: "Open the card",
    });
    expect(comment.done).toBe(true);
    const grade = stopFor(
      effect({
        key: "grade_notice",
        state: "delivered",
        at: "2026-10-25T09:12:00Z",
      }),
      CTX,
    );
    expect(grade.line).toBe("Grade posted in #client-call-feedback at 12:12.");
    expect(grade.link?.label).toBe("Open in Slack");
    expect(
      stopFor(effect({ key: "call_form", state: "delivered" }), CTX).line,
    ).toBe("Notes saved.");
  });

  test("cockpit, failed and unknown: the reason and who to tell", () => {
    const failed = stopFor(
      effect({ state: "failed", reason: "ClickUp refused the comment (400)." }),
      CTX,
    );
    expect(failed.line).toBe(
      "Not done: ClickUp refused the comment (400). Tell the tech lead.",
    );
    expect(failed.problem).toBe(true);
    const unknown = stopFor(
      effect({ state: "unknown", reason: "Slack did not answer in time." }),
      CTX,
    );
    expect(unknown.line).toBe(
      "Not confirmed: Slack did not answer in time. The cockpit checks before it tries again.",
    );
    expect(unknown.done).toBe(false);
  });

  test("all 21 pairs read as a sentence; only a delivery is done", () => {
    for (const owner of OWNERS)
      for (const state of EFFECT_STATES) {
        const s = stopFor(effect({ owner, state, reason: "A reason." }), CTX);
        expect(s.line.length).toBeGreaterThan(5);
        expect(s.line).not.toMatch(/[!—]/);
        expect(s.done).toBe(owner === "cockpit" && state === "delivered");
        if (state === "skipped") expect(s.quiet).toBe(true);
      }
  });
});

describe("the trail as a whole", () => {
  test("a shadow run shows eight plans and the line under it", () => {
    const effects = shadowEffects(FILLED, CTX.submittedAt as string);
    const stops = trailStops(effects, CTX);
    expect(stops.length).toBe(8);
    expect(stops.every(s => s.tone === "plan")).toBe(true);
    expect(trailDone(stops)).toBe(false);
    expect(trailNote(effects)).toBe(
      "Make still does all of this from the Typeform until the switch-over.",
    );
    expect(trailSettled(effects)).toBe(true);
  });

  test("a call with no recording: no grade and no recap, quiet", () => {
    const answers = { ...FILLED, call: { kind: "none", why: "none" } };
    const stops = trailStops(
      shadowEffects(answers, CTX.submittedAt as string),
      { ...CTX, answers },
    );
    const by = Object.fromEntries(stops.map(s => [s.key, s]));
    expect(by.grade_notice?.line).toBe("No grade: no recording for this call.");
    expect(by.recap?.line).toBe("No recap: no recording for this call.");
    expect(by.recap?.quiet).toBe(true);
  });

  test("delivered by the cockpit, the card's fields are one line; a field the card kept says so", () => {
    const effects: EffectView[] = [
      effect({
        key: "happiness",
        label: "Client Happiness",
        state: "delivered",
      }),
      effect({
        key: "last_poc",
        label: "Last POC",
        state: "skipped",
        reason: "Last POC stays 26 Oct: it is newer than this call.",
      }),
      effect({
        key: "last_checkin_call",
        label: "Last Check-in Call",
        state: "delivered",
      }),
    ];
    const [card] = trailStops(effects, CTX);
    expect(card?.label).toBe("Card fields");
    expect(card?.line).toBe(
      "Client Happiness: At risk · Last check-in call 25 Oct.",
    );
    expect(card?.sub).toBe(
      "Last POC stays 26 Oct: it is newer than this call.",
    );
    expect(card?.done).toBe(true);
    expect(cardLine(FILLED, CTX.submittedAt)).toBe(
      "Client Happiness: At risk · Last POC 25 Oct · Last check-in call 25 Oct.",
    );
  });

  test("one field still on its way holds the card's stop", () => {
    const effects = [
      effect({ key: "happiness", state: "delivered" }),
      effect({ key: "last_poc", state: "queued" }),
      effect({ key: "last_checkin_call", state: "delivered" }),
    ];
    const [card] = trailStops(effects, CTX);
    expect(card?.line).toBe("Updating the card…");
    expect(card?.done).toBe(false);
    expect(trailSettled(effects)).toBe(false);
  });

  test("a quiet stop never counts as done", () => {
    const stops = trailStops(
      [
        effect({ state: "delivered" }),
        effect({
          key: "recap",
          state: "skipped",
          reason: "Nothing worth sending.",
        }),
      ],
      CTX,
    );
    expect(trailDone(stops)).toBe(false);
  });
});
