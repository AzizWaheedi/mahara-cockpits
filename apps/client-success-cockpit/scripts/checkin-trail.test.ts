import { describe, expect, test } from "bun:test";
import { FILLED, shadowEffects } from "../src/dev/checkinFixtures";
import {
  EFFECT_STATES,
  type EffectView,
  OWNERS,
} from "../src/forms/checkinClient";
import {
  CARD_WRITER_LATE,
  cardLine,
  MAKE_DOES,
  RECAP_QUEUED,
  RECAP_TOO_LATE,
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
  // A minute after the effects' time: nothing is late yet.
  now: Date.parse("2026-10-25T08:12:00Z"),
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

describe("the card writer's 15-minute line (STAGE2B-CONTRACT.md 4.15 item 4)", () => {
  const at = "2026-10-25T08:11:00Z";
  const later = (min: number) => ({
    ...CTX,
    now: Date.parse(at) + min * 60_000,
  });

  test("a ClickUp write still queued 15 minutes after its time says so; before, it is working", () => {
    expect(CARD_WRITER_LATE).toBe(
      "Still waiting for the card writer. The tech lead is told after 15 minutes.",
    );
    const queued = effect({ state: "queued", at });
    expect(stopFor(queued, later(14)).line).toBe(
      "Posting the to-do comment on the card…",
    );
    const late = stopFor(queued, later(15));
    expect(late.line).toBe(CARD_WRITER_LATE);
    expect(late.tone).toBe("wait");
    expect(late.done).toBe(false);
    expect(late.problem).toBe(false);
  });

  test("only a queued clickup_queue effect: planned, a notice and the recap keep their own words", () => {
    expect(stopFor(effect({ state: "planned", at }), later(40)).line).toBe(
      "Posting the to-do comment on the card…",
    );
    expect(
      stopFor(
        effect({
          key: "grade_notice",
          label: "Call grade",
          delivery: "slack_notice",
          state: "queued",
          at,
        }),
        later(40),
      ).line,
    ).toBe("Waiting to post in #client-call-feedback.");
    expect(
      stopFor(
        effect({
          key: "recap",
          label: "Recap",
          delivery: "client_message",
          state: "queued",
          at,
        }),
        later(40),
      ).line,
    ).toBe(RECAP_QUEUED);
    // An unreadable time is never late.
    expect(
      stopFor(effect({ state: "queued", at: "not a time" }), later(40)).line,
    ).toBe("Posting the to-do comment on the card…");
  });

  test("the card's stop carries it while one of its fields is late", () => {
    const effects = [
      effect({ key: "happiness", state: "delivered", at }),
      effect({ key: "last_poc", state: "queued", at }),
      effect({ key: "last_checkin_call", state: "queued", at }),
    ];
    const [card] = trailStops(effects, later(20));
    expect(card?.line).toBe(CARD_WRITER_LATE);
    expect(card?.done).toBe(false);
  });
});

describe("the recap's stops once the cockpit sends it (STAGE2B-CONTRACT.md 3.6, 4.3, 5.1)", () => {
  const recap = (over: Partial<EffectView>): EffectView =>
    effect({
      key: "recap",
      label: "Recap to the client",
      delivery: "client_message",
      lines: [],
      ...over,
    });

  test("queued: one line true whether the message waits, is approved, sending or refused", () => {
    // 3.6: the effect stays queued through approved, claimed, sending and
    // refused, so the line never says it waits for approval after a press.
    expect(RECAP_QUEUED).toBe(
      "On the client's Messages card until WhatsApp takes it.",
    );
    const s = stopFor(recap({ state: "queued" }), CTX);
    expect(s.line).toBe(RECAP_QUEUED);
    expect(s.line).not.toContain("Waiting for approval");
    expect(s.tone).toBe("wait");
    expect(s.problem).toBe(false);
    expect(stopFor(recap({ state: "planned" }), CTX).line).toBe(
      "Drafting the client's recap…",
    );
  });

  test("unknown: never sent twice, so no retry is promised; look in the group", () => {
    const said = stopFor(
      recap({
        state: "unknown",
        reason:
          "The sender stopped while sending. Look in the group before anything else.",
      }),
      CTX,
    );
    expect(said.line).toBe(
      "Not confirmed: The sender stopped while sending. Look in the group before anything else. The cockpit never sends it twice.",
    );
    expect(said.line).not.toContain("tries again");
    expect(said.tone).toBe("warn");
    expect(said.problem).toBe(true);
    // No reason: 5.1's own line, word for word.
    expect(stopFor(recap({ state: "unknown", reason: null }), CTX).line).toBe(
      "Not confirmed: WhatsApp did not answer. The cockpit never sends it twice. Look in the group; the tech lead settles it.",
    );
    // Every other effect keeps the generic line: those writers check first.
    expect(
      stopFor(effect({ state: "unknown", reason: "ClickUp timed out." }), CTX)
        .line,
    ).toBe(
      "Not confirmed: ClickUp timed out. The cockpit checks before it tries again.",
    );
  });

  test("failed with Draft again as its next step: the step offers it, so no tech lead", () => {
    const s = stopFor(
      recap({
        state: "failed",
        reason:
          "The recap draft is empty or over 4,096 characters. Draft it again.",
      }),
      CTX,
    );
    expect(s.line).toBe(
      "Not done: The recap draft is empty or over 4,096 characters. Draft it again.",
    );
    expect(s.problem).toBe(true);
    expect(
      stopFor(
        recap({
          state: "failed",
          reason: "No recap: the drafter did not answer.",
        }),
        CTX,
      ).line,
    ).toBe("Not done: The drafter did not answer. Tell the tech lead.");
  });

  test("past 24 hours the rail stops saying Draft again, as the step does", () => {
    const failed = recap({
      state: "failed",
      reason:
        "The recap draft is empty or over 4,096 characters. Draft it again.",
    });
    const sent = Date.parse("2026-10-25T08:10:00Z");
    const after = (ms: number) => ({ ...CTX, now: sent + ms });
    const DAY = 24 * 60 * 60_000;
    // One minute short of the mark: the step still offers it.
    expect(stopFor(failed, after(DAY - 60_000)).line).toBe(
      "Not done: The recap draft is empty or over 4,096 characters. Draft it again.",
    );
    // At the mark, and after it: what is left, and still a problem.
    for (const ms of [DAY, 2 * DAY]) {
      const s = stopFor(failed, after(ms));
      expect(s.line).toBe(
        `Not done: The recap draft is empty or over 4,096 characters. ${RECAP_TOO_LATE}`,
      );
      expect(s.problem).toBe(true);
      expect(s.line).not.toMatch(/Draft (it )?again/);
    }
    // A sent time it cannot read says nothing about the 24 hours.
    expect(
      stopFor(failed, { ...CTX, submittedAt: null, now: sent + 2 * DAY }).line,
    ).toContain("Draft it again.");
    // A reason that was never the step's to offer still goes to the tech lead.
    expect(
      stopFor(
        recap({
          state: "failed",
          reason: "No recap: the drafter did not answer.",
        }),
        after(2 * DAY),
      ).line,
    ).toBe("Not done: The drafter did not answer. Tell the tech lead.");
  });

  test("delivered: sent, done, and a way to the Messages card marked as inside the cockpit", () => {
    const s = stopFor(
      recap({ state: "delivered", at: "2026-10-25T09:14:00Z" }),
      CTX,
    );
    expect(s.line).toBe("Sent to the client's WhatsApp group at 12:14.");
    expect(s.done).toBe(true);
    expect(s.tone).toBe("good");
    // The same href the recap step's link takes (messagesHref), so the
    // rail draws the in-app mark for it, never the outbound one.
    expect(s.link).toEqual({
      href: "/client-success/clients/86exfix01?tab=overview#messages",
      label: "Open the Messages card",
      internal: true,
    });
    // The card and Slack leave the cockpit: no flag.
    expect(
      stopFor(effect({ state: "delivered" }), CTX).link?.internal,
    ).toBeUndefined();
    expect(
      stopFor(effect({ key: "grade_notice", state: "delivered" }), CTX).link
        ?.internal,
    ).toBeUndefined();
  });
});

describe("the recap's stop reads as one sentence, and as she left it", () => {
  const recap = (over: Partial<EffectView>) =>
    effect({
      key: "recap",
      label: "Recap to the client",
      delivery: "client_message",
      ...over,
    });

  test("a reason's own label does not sit behind the rail's: one label, then the point", () => {
    expect(
      stopFor(
        recap({
          state: "failed",
          reason:
            "No recap: The recap mentioned leads or cost per lead, which client messages never do. Draft again.",
        }),
        CTX,
      ).line,
    ).toBe(
      "Not done: The recap mentioned leads or cost per lead, which client messages never do. Draft again.",
    );
    expect(
      stopFor(
        effect({
          key: "grade_notice",
          label: "Call grade",
          state: "failed",
          reason: "No grade: no transcript for this call.",
        }),
        CTX,
      ).line,
    ).toBe("Not done: No transcript for this call. Tell the tech lead.");
  });

  test("a failed recap she skipped: the words of the step, quiet, and no one to tell", () => {
    const failed = recap({
      state: "failed",
      reason: "WhatsApp refused the recap (400). Nothing was sent.",
    });
    expect(stopFor(failed, CTX).problem).toBe(true);
    expect(stopFor(failed, { ...CTX, recapMessage: "failed" }).problem).toBe(
      true,
    );
    const s = stopFor(failed, { ...CTX, recapMessage: "skipped" });
    expect(s.line).toBe("Skipped. Nothing was sent.");
    expect(s.tone).toBe("quiet");
    expect(s.problem).toBe(false);
    expect(s.done).toBe(false);
    // Another effect's failure is still the tech lead's.
    expect(
      stopFor(
        effect({
          key: "todo_comment",
          state: "failed",
          reason: "ClickUp 500.",
        }),
        { ...CTX, recapMessage: "skipped" },
      ).problem,
    ).toBe(true);
  });
});
