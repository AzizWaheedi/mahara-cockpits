/**
 * After a send (src/forms/formStatus.ts, docs/csm-forms/KICKOFF.md 4): the
 * stops, worked out from the reads and the server's clock, the two late
 * sentences at five minutes, the duplicate guard's three sources, and the
 * cockpit's own Slack notice as the last stop in every state it can be in
 * (docs/forms/STAGE1-CONTRACT.md 6.1).
 *
 * Run: bun test scripts/form-status.test.ts
 */

import { describe, expect, test } from "bun:test";
import {
  fixtureContext,
  fixtureRow,
  fixtureSend,
  fixtureTimeline,
} from "../src/dev/formFixtures";
import { kickoffNotice, noticeRead } from "../src/dev/noticesFixtures";
import type { NoticeView } from "../src/forms/formConfig";
import {
  afterLines,
  kickoffAlready,
  kickoffCardDone,
  noticeWhere,
  sendLine,
  sendNotice,
  trailAllDone,
  trailFor,
  trailSummary,
} from "../src/forms/formStatus";
import { atWhen, kuwaitTime, whenSaid } from "../src/forms/formTime";
import { KICKOFF } from "../src/forms/kickoff";

const SENT_AT = "2026-10-22T11:02:00.000Z"; // 14:02 Kuwait
const send = { responseId: "fixtureresp0001", sentAt: SENT_AT };
const at = (iso: string) => Date.parse(iso);
const kickoff = {
  form_id: "tG7dnxBn",
  response_id: "fixtureresp0001",
  submitted_at: SENT_AT,
  answers: [],
};

describe("the trail", () => {
  test("just sent: Sent is done and Typeform is the current stop", () => {
    const ctx = fixtureContext({ timeline: fixtureTimeline([]) });
    const t = trailFor(KICKOFF, ctx, send, at("2026-10-22T11:02:30Z"));
    expect(t.stops.map(s => s.key)).toEqual([
      "sent",
      "typeform",
      "card",
      "link",
    ]);
    expect(t.stops[0]).toMatchObject({
      done: true,
      line: "Sent from the cockpit at 14:02.",
    });
    // A pending stop is said in the tense of its state, with context, not
    // "Waiting for…".
    expect(t.stops.map(s => s.label)).toEqual([
      "Sent",
      "Typeform lists it",
      "Make updates the card",
      "Make adds the Brand Blueprint link to the card",
    ]);
    expect(t.stops[1].line).toBe("Usually within a minute.");
    expect(t.stops.some(s => /waiting/i.test(s.line ?? ""))).toBe(false);
    expect(t.current).toBe("typeform");
    expect(t.late).toBeNull();
    expect(t.lateLine).toBeNull();
    expect(trailSummary(KICKOFF, t)).toBe(
      "Kickoff sent · waiting for Typeform",
    );
  });

  test("a send the cockpit could not note says so on its first stop", () => {
    const ctx = fixtureContext({ timeline: fixtureTimeline([]) });
    const t = trailFor(
      KICKOFF,
      ctx,
      { ...send, noted: false },
      at("2026-10-22T11:02:30Z"),
    );
    expect(t.stops[0].line).toBe(
      "Sent at 14:02. Not noted in the cockpit yet.",
    );
  });

  test("Typeform has it: by the record's response ID, or by the form history's token", () => {
    const byRecord = fixtureContext({
      row: fixtureRow({ forms: { kickoff } }),
    });
    expect(trailFor(KICKOFF, byRecord, send, at(SENT_AT)).current).toBe("card");
    const byHistory = fixtureContext({
      timeline: fixtureTimeline(
        [],
        [
          {
            token: "fixtureresp0001",
            formId: "tG7dnxBn",
            kind: "kickoff",
            submittedAt: SENT_AT,
            answers: [],
          },
        ],
      ),
    });
    const t = trailFor(KICKOFF, byHistory, send, at(SENT_AT));
    expect(t.stops[1]).toMatchObject({
      done: true,
      label: "Typeform has it",
      line: "Submitted at 14:02.",
    });
    // Another response's token is not this send.
    const other = fixtureContext({
      timeline: fixtureTimeline(
        [],
        [
          {
            token: "anotherresp01",
            formId: "tG7dnxBn",
            kind: "kickoff",
            submittedAt: SENT_AT,
            answers: [],
          },
        ],
      ),
    });
    expect(trailFor(KICKOFF, other, send, at(SENT_AT)).current).toBe(
      "typeform",
    );
  });

  test("Make updated the card: Brand Blueprint Booked (or later) and a card change at or after the send", () => {
    const row = fixtureRow({
      client_status: "Brand Blueprint Booked♠️",
      card_updated_at: "2026-10-22T11:03:10Z",
      forms: { kickoff },
    });
    const t = trailFor(
      KICKOFF,
      fixtureContext({ row }),
      send,
      at("2026-10-22T11:04:00Z"),
    );
    expect(t.stops[2]).toMatchObject({
      done: true,
      label: "Make updated the card at 14:03",
      line: "The card is at Brand Blueprint Booked.",
    });
    expect(t.current).toBe("link");
    expect(t.stops[3]).toMatchObject({
      label: "Make adds the Brand Blueprint link to the card",
      line: null,
    });
    expect(trailSummary(KICKOFF, t)).toBe(
      "Kickoff sent · waiting for the Blueprint link",
    );
    for (const later of ["LAUNCH BOOKED", "Ready For Launch🚀", "Active"])
      expect(
        kickoffCardDone(
          { client_status: later, card_updated_at: "2026-10-22T11:03:10Z" },
          SENT_AT,
        ),
      ).toBe(true);
    expect(
      kickoffCardDone(
        {
          client_status: "Onboarding Booked",
          card_updated_at: "2026-10-22T11:03:10Z",
        },
        SENT_AT,
      ),
    ).toBe(false);
    expect(
      kickoffCardDone(
        { client_status: "GHOSTED", card_updated_at: "2026-10-22T11:03:10Z" },
        SENT_AT,
      ),
    ).toBe(false);
  });

  test("a card already at Brand Blueprint Booked counts only with a newer change", () => {
    const stale = {
      client_status: "Brand Blueprint Booked♠️",
      card_updated_at: "2026-10-22T10:00:00Z",
    };
    expect(kickoffCardDone(stale, SENT_AT)).toBe(false);
    expect(kickoffCardDone({ ...stale, card_updated_at: null }, SENT_AT)).toBe(
      false,
    );
    expect(
      kickoffCardDone({ ...stale, card_updated_at: SENT_AT }, SENT_AT),
    ).toBe(true);
  });

  test("the Blueprint link closes the trail", () => {
    const row = fixtureRow({
      client_status: "Brand Blueprint Booked♠️",
      card_updated_at: "2026-10-22T11:03:10Z",
      forms: { kickoff },
      links: {
        blueprint_form:
          "https://maharamedia.typeform.com/to/oYZKtogO#onboarding_client_id=86fixture1",
      },
    });
    const t = trailFor(
      KICKOFF,
      fixtureContext({ row }),
      send,
      at("2026-10-22T11:30:00Z"),
    );
    expect(t.current).toBeNull();
    expect(t.stops.every(s => s.done)).toBe(true);
    expect(t.stops[3].label).toBe("The card has the Brand Blueprint link");
    expect(t.late).toBeNull();
    expect(trailSummary(KICKOFF, t)).toBe("Kickoff sent · every step done");
    // A Blueprint link from before Make's update does not count on its own.
    const early = fixtureRow({
      links: { blueprint_form: "https://maharamedia.typeform.com/to/oYZKtogO" },
    });
    expect(
      trailFor(KICKOFF, fixtureContext({ row: early }), send, at(SENT_AT))
        .stops[3].done,
    ).toBe(false);
  });

  test("at five minutes, Typeform has it and the card has not changed: Make is late", () => {
    const ctx = fixtureContext({ row: fixtureRow({ forms: { kickoff } }) });
    expect(
      trailFor(KICKOFF, ctx, send, at("2026-10-22T11:06:59Z")).late,
    ).toBeNull();
    const t = trailFor(KICKOFF, ctx, send, at("2026-10-22T11:07:00Z"));
    expect(t.late).toBe("make");
    expect(t.lateLine).toBe(
      "Make has not updated the card in 5 minutes. The kickoff is safe in Typeform. Open the card and look for the Kickoff Handoff comment; if it is not there, tell the tech lead. Do not send the kickoff again.",
    );
    // The sentence is the config's: another form names its own comment.
    expect(t.lateLine).toBe(KICKOFF.after.lateMake);
    expect(trailSummary(KICKOFF, t)).toBe("Kickoff sent · Make is late");
  });

  test("at five minutes, Typeform does not list it either: Typeform is late", () => {
    const ctx = fixtureContext({ timeline: fixtureTimeline([]) });
    const t = trailFor(KICKOFF, ctx, send, at("2026-10-22T11:09:00Z"));
    expect(t.late).toBe("typeform");
    expect(trailSummary(KICKOFF, t)).toBe("Kickoff sent · Typeform is late");
    expect(t.lateLine).toBe(
      "Typeform has not listed this kickoff after 5 minutes. Look for it in Typeform's results before anything else, and do not send it again.",
    );
  });

  test("the clock is the server's: a send in the future of this browser is not late", () => {
    const ctx = fixtureContext({ timeline: fixtureTimeline([]) });
    expect(
      trailFor(KICKOFF, ctx, send, at("2026-10-22T10:00:00Z")).late,
    ).toBeNull();
  });
});

describe("the Slack stop", () => {
  const done = fixtureRow({
    client_status: "Brand Blueprint Booked♠️",
    card_updated_at: "2026-10-22T11:03:10Z",
    forms: { kickoff },
    links: {
      blueprint_form:
        "https://cockpit.maharamedia.com/client-success/clients/86fixture1/present/blueprint?view=prep",
    },
  });
  const notices = (n: NoticeView | null) => ({
    notices: noticeRead("86fixture1", [n]),
  });
  const trail = (
    ctxOver: Parameters<typeof fixtureContext>[0],
    nowIso = "2026-10-22T11:30:00Z",
  ) => {
    const ctx = fixtureContext({ row: done, ...ctxOver });
    return trailFor(
      KICKOFF,
      ctx,
      send,
      at(nowIso),
      sendNotice(KICKOFF, ctx, send.responseId),
    );
  };
  const slack = (t: ReturnType<typeof trail>) =>
    t.stops.find(s => s.key === "slack");

  test("a screen that does not read the notices (the deck) has no Slack stop", () => {
    const ctx = fixtureContext({ row: done });
    expect(sendNotice(KICKOFF, ctx, send.responseId)).toBeUndefined();
    expect(sendNotice(KICKOFF, { ...ctx, notices: null }, "x")).toBeUndefined();
    const t = trailFor(KICKOFF, ctx, send, at("2026-10-22T11:30:00Z"));
    expect(t.stops.map(s => s.key)).toEqual([
      "sent",
      "typeform",
      "card",
      "link",
    ]);
    expect(trailSummary(KICKOFF, t)).toBe("Kickoff sent · every step done");
  });

  test("no row yet, queued or sending: the config's pending words, and the trail waits on it", () => {
    // No row yet: no channel is known, so it says Slack, never a channel in code.
    const none = trail(notices(null));
    expect(slack(none)).toMatchObject({
      label: "The team hears in Slack",
      where: "Slack",
      done: false,
    });
    for (const n of [
      kickoffNotice("queued", send.responseId, SENT_AT),
      {
        ...(kickoffNotice("queued", send.responseId, SENT_AT) as NoticeView),
        state: "sending" as const,
      },
    ]) {
      const t = trail(notices(n));
      expect(t.stops.map(s => s.key)).toEqual([
        "sent",
        "typeform",
        "card",
        "link",
        "slack",
      ]);
      expect(slack(t)).toMatchObject({
        label: "The team hears in #csm-general",
        done: false,
        line: "Once Make has updated the card, usually within a few minutes.",
      });
      expect(t.current).toBe("slack");
      expect(trailSummary(KICKOFF, t)).toBe(
        "Kickoff sent · waiting for the Slack notice",
      );
    }
  });

  test("an editor moved the notice in Settings: every word follows the channel the server names (D17)", () => {
    const moved = {
      ...(kickoffNotice("queued", send.responseId, SENT_AT) as NoticeView),
      channel: { id: "C0ONBOARD01", name: "onboarding" },
    };
    const t = trail(notices(moved));
    expect(slack(t)?.label).toBe("The team hears in #onboarding");
    expect(afterLines(KICKOFF, t).sub).toBe(
      "The team hears in #onboarding once the card is updated.",
    );
    expect(JSON.stringify(t)).not.toContain("csm-general");
    expect(noticeWhere(null)).toBe("Slack");
    expect(noticeWhere({ channel: { id: "C0ONBOARD01", name: null } })).toBe(
      "Slack",
    );
  });

  test("the after panel's headline and line follow the trail, not a fixed sentence", () => {
    // Make has done its part and the notice waits: the done sentence, and where it posts.
    const waiting = trail(
      notices(kickoffNotice("queued", send.responseId, SENT_AT)),
    );
    expect(afterLines(KICKOFF, waiting)).toEqual({
      say: "Kickoff sent. The card is updated. Book the Brand Blueprint call below.",
      sub: "The team hears in #csm-general once the card is updated.",
    });
    // Posted, off, skipped, failed: the stop says it, so the line goes.
    for (const state of ["posted", "muted", "skipped", "failed", "late"])
      expect(
        afterLines(
          KICKOFF,
          trail(notices(kickoffNotice(state, send.responseId, SENT_AT))),
        ).sub,
      ).toBeNull();
    // Before Make: the working sentence; when late: the late one, without the line.
    const ctx = fixtureContext({
      row: fixtureRow({ forms: { kickoff } }),
      ...notices(null),
    });
    const early = trailFor(
      KICKOFF,
      ctx,
      send,
      at("2026-10-22T11:03:00Z"),
      sendNotice(KICKOFF, ctx, send.responseId),
    );
    expect(afterLines(KICKOFF, early)).toEqual({
      say: "Kickoff sent. Make is updating the card. Book the Brand Blueprint call below.",
      sub: "The team hears in Slack once the card is updated.",
    });
    const late = trailFor(
      KICKOFF,
      ctx,
      send,
      at("2026-10-22T11:20:00Z"),
      sendNotice(KICKOFF, ctx, send.responseId),
    );
    expect(afterLines(KICKOFF, late)).toEqual({
      say: "Kickoff sent. Make has not updated the card yet.",
      sub: null,
    });
    // A notice that was off is done, but never counts as a success.
    const muted = trail(
      notices(kickoffNotice("muted", send.responseId, SENT_AT)),
    );
    expect(muted.stops.every(s => s.done)).toBe(true);
    expect(trailAllDone(muted)).toBe(false);
    expect(
      trailAllDone(
        trail(notices(kickoffNotice("posted", send.responseId, SENT_AT))),
      ),
    ).toBe(true);
  });

  test("on a phone the fold names a notice that needs a person, ahead of any wait", () => {
    // The card is done but the Blueprint link is not: the failure still leads.
    const ctx = fixtureContext({
      row: fixtureRow({
        client_status: "Brand Blueprint Booked♠️",
        card_updated_at: "2026-10-22T11:03:10Z",
        forms: { kickoff },
        links: {},
      }),
      ...notices(kickoffNotice("failed", send.responseId, SENT_AT)),
    });
    const t = trailFor(
      KICKOFF,
      ctx,
      send,
      at("2026-10-22T11:04:00Z"),
      sendNotice(KICKOFF, ctx, send.responseId),
    );
    expect(t.current).toBe("link");
    expect(trailSummary(KICKOFF, t)).toBe(
      "Not posted in Slack · tell the tech lead",
    );
    const unknown = trail(
      notices(kickoffNotice("unknown", send.responseId, SENT_AT)),
    );
    expect(trailSummary(KICKOFF, unknown)).toBe(
      "Not confirmed in Slack · tell the tech lead",
    );
  });

  test("another response's notice is not this send's", () => {
    const t = trail(notices(kickoffNotice("posted", "anotherresp01", SENT_AT)));
    expect(slack(t)?.done).toBe(false);
  });

  test("posted: the channel and Kuwait's clock, with Open in Slack, and the trail is done", () => {
    const t = trail(notices(kickoffNotice("posted", send.responseId, SENT_AT)));
    expect(slack(t)).toMatchObject({
      label: "Posted in #csm-general at 14:03",
      done: true,
      line: null,
      link: {
        href: "https://example-workspace.slack.com/archives/C09RZ0GS0V9/p1792872070187739",
        label: "Open in Slack",
      },
    });
    expect(slack(t)?.problem).toBeFalsy();
    expect(t.current).toBeNull();
    expect(trailSummary(KICKOFF, t)).toBe("Kickoff sent · posted in Slack");
    // The late variant says what it said.
    const late = trail(
      notices(kickoffNotice("late", send.responseId, SENT_AT)),
    );
    expect(slack(late)).toMatchObject({
      label: "Posted in #csm-general at 14:23",
      line: "It says the card was not updated, so the team checks it.",
    });
  });

  test("failed: not posted, the reason, tell the tech lead; it needs a person", () => {
    const t = trail(notices(kickoffNotice("failed", send.responseId, SENT_AT)));
    // One label, the stop's own; the reason reads as its own sentence.
    expect(slack(t)).toMatchObject({
      label:
        "Not posted. Slack says mahara-club-bot is not in that channel. Ask the tech lead to add it there and send the notice again.",
      lead: "Not posted.",
      done: false,
      problem: true,
    });
    expect(slack(t)?.label).not.toMatch(/^[^.]*: /);
    expect(t.current).toBe("slack");
    expect(trailSummary(KICKOFF, t)).toBe(
      "Not posted in Slack · tell the tech lead",
    );
    // A reason that does not say who to tell gets the tech lead added.
    const plain = trail(
      notices({
        ...(kickoffNotice("failed", send.responseId, SENT_AT) as NoticeView),
        reason: "Slack refused it (msg_blocked).",
      }),
    );
    expect(slack(plain)?.label).toBe(
      "Not posted. Slack refused it (msg_blocked). Tell the tech lead.",
    );
  });

  test("unknown: not confirmed, never called posted or failed", () => {
    const t = trail(
      notices(kickoffNotice("unknown", send.responseId, SENT_AT)),
    );
    expect(slack(t)).toMatchObject({
      label:
        "Not confirmed. Slack did not confirm the post; it is not sent again in case it arrived. Tell the tech lead.",
      lead: "Not confirmed.",
      done: false,
      problem: true,
    });
    expect(trailSummary(KICKOFF, t)).toBe(
      "Not confirmed in Slack · tell the tech lead",
    );
  });

  test("muted and skipped: not posted, said why, and done (quietly)", () => {
    const muted = trail(
      notices(kickoffNotice("muted", send.responseId, SENT_AT)),
    );
    expect(slack(muted)).toMatchObject({
      label: "Not posted: the kickoff notice is off in Settings.",
      done: true,
      quiet: true,
    });
    expect(muted.current).toBeNull();
    expect(trailSummary(KICKOFF, muted)).toBe(
      "Kickoff sent · not posted in Slack",
    );
    const skipped = trail(
      notices(kickoffNotice("skipped", send.responseId, SENT_AT)),
    );
    expect(slack(skipped)).toMatchObject({
      label:
        "Not posted. This kickoff was more than 48 hours old when the mirror listed it, so it was not posted.",
      done: true,
      quiet: true,
    });
  });

  test("the read failed: said so, neither done nor the stop the trail stands at", () => {
    const t = trail({ notices: null, failed: { notices: "Failed to fetch" } });
    // It says what to do next, and the window keeps reading (useFormPanel).
    expect(slack(t)).toMatchObject({
      label:
        "The cockpit could not read the Slack notice just now. Check now reads it again.",
      done: false,
      unread: true,
    });
    expect(t.current).toBeNull();
    expect(trailSummary(KICKOFF, t)).toBe(
      "Kickoff sent · Slack notice not read",
    );
    // A notice read earlier still says what it said.
    const kept = trail({
      ...notices(kickoffNotice("posted", send.responseId, SENT_AT)),
      failed: { notices: "Failed to fetch" },
    });
    expect(slack(kept)?.done).toBe(true);
  });

  test("before the card is updated, the Slack stop waits behind Make", () => {
    const ctx = fixtureContext({
      row: fixtureRow({ forms: { kickoff } }),
      ...notices(null),
    });
    const t = trailFor(
      KICKOFF,
      ctx,
      send,
      at("2026-10-22T11:03:00Z"),
      sendNotice(KICKOFF, ctx, send.responseId),
    );
    expect(t.current).toBe("card");
    expect(slack(t)?.done).toBe(false);
  });
});

describe("a kickoff already on record", () => {
  test("from the record (either form version)", () => {
    const a = kickoffAlready(
      fixtureContext({
        row: fixtureRow({
          forms: { kickoff: { ...kickoff, form_id: "BbJy6xg4" } },
        }),
      }),
    );
    expect(a).toMatchObject({ from: "record", at: SENT_AT });
    expect(a?.entry?.form_id).toBe("BbJy6xg4");
  });

  test("from the cockpit's own sends", () => {
    const a = kickoffAlready(fixtureContext({ sends: [fixtureSend()] }));
    expect(a).toMatchObject({ from: "cockpit", by: "Lina", entry: null });
  });

  test("from the form history (kickoff or the old kickoff)", () => {
    for (const kind of ["kickoff", "kickoff_old"]) {
      const a = kickoffAlready(
        fixtureContext({
          timeline: fixtureTimeline(
            [],
            [
              {
                token: "histresp0001",
                formId: "tG7dnxBn",
                kind,
                submittedAt: "2026-10-15T09:00:00Z",
                answers: [
                  { ref: "q1", title: "Contract status", value: "Signed" },
                  { ref: "q2", title: "Empty", value: null },
                ],
              },
            ],
          ),
        }),
      );
      expect(a?.from).toBe("history");
      expect(a?.entry?.answers).toEqual([
        { ref: "q1", title: "Contract status", value: "Signed" },
      ]);
    }
  });

  test("none of the three: null, and the 1-1 check-in history does not count", () => {
    expect(kickoffAlready(fixtureContext())).toBeNull();
    expect(
      kickoffAlready(
        fixtureContext({
          timeline: fixtureTimeline(
            [],
            [
              {
                token: "checkin00001",
                formId: "fRokTITH",
                kind: "checkin",
                submittedAt: SENT_AT,
                answers: [],
              },
            ],
          ),
        }),
      ),
    ).toBeNull();
  });
});

describe("the Onboarding panel's one line", () => {
  test("sent, then Make's update, with the day", () => {
    const s = fixtureSend({ sentAt: SENT_AT });
    const today = "2026-10-22T12:00:00Z";
    expect(sendLine(KICKOFF, s, fixtureRow(), today)).toBe(
      "Sent from the cockpit today at 14:02 by Lina.",
    );
    expect(
      sendLine(
        KICKOFF,
        s,
        fixtureRow({
          client_status: "Brand Blueprint Booked♠️",
          card_updated_at: "2026-10-22T11:03:40Z",
        }),
        today,
      ),
    ).toBe(
      "Sent from the cockpit today at 14:02 by Lina. Make updated the card at 14:03.",
    );
    expect(sendLine(KICKOFF, { ...s, sentBy: null }, null, today)).toBe(
      "Sent from the cockpit today at 14:02.",
    );
    // The next day the line still reads right.
    expect(
      sendLine(
        KICKOFF,
        s,
        fixtureRow({
          client_status: "Brand Blueprint Booked♠️",
          card_updated_at: "2026-10-22T21:10:00Z",
        }),
        "2026-10-23T09:00:00Z",
      ),
    ).toBe(
      "Sent from the cockpit on 22 Oct at 14:02 by Lina. Make updated the card today at 00:10.",
    );
  });

  test("Kuwait's clock whatever the browser's", () => {
    expect(kuwaitTime("2026-10-22T21:30:00Z")).toBe("00:30");
    expect(whenSaid("2026-10-22T10:10:00Z", "2026-10-22T20:59:00Z")).toBe(
      "today 13:10",
    );
    expect(whenSaid("2026-10-21T10:10:00Z", "2026-10-22T10:59:00Z")).toBe(
      "21 Oct 13:10",
    );
    expect(atWhen("2026-10-22T10:10:00Z", "2026-10-22T20:59:00Z")).toBe(
      "today at 13:10",
    );
    expect(atWhen("2026-10-21T10:10:00Z", "2026-10-22T10:59:00Z")).toBe(
      "on 21 Oct at 13:10",
    );
  });
});
