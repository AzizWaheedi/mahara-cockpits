/**
 * After a send (src/forms/formStatus.ts, docs/csm-forms/KICKOFF.md 4): the
 * four stops, worked out from the reads and the server's clock, the two
 * late sentences at five minutes, and the duplicate guard's three sources.
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
import { KICKOFF } from "../src/forms/formConfig";
import {
  kickoffAlready,
  kickoffCardDone,
  sendLine,
  trailFor,
} from "../src/forms/formStatus";
import { kuwaitTime, whenSaid } from "../src/forms/formTime";

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
    expect(t.current).toBe("typeform");
    expect(t.late).toBeNull();
    expect(t.lateLine).toBeNull();
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
    expect(t.stops[1]).toMatchObject({ done: true, line: "Typeform has it." });
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
      line: "Make updated the card: Brand Blueprint Booked.",
    });
    expect(t.current).toBe("link");
    expect(t.stops[3].line).toBe("Waiting for the Blueprint link on the card.");
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
    expect(t.late).toBeNull();
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
  });

  test("at five minutes, Typeform does not list it either: Typeform is late", () => {
    const ctx = fixtureContext({ timeline: fixtureTimeline([]) });
    const t = trailFor(KICKOFF, ctx, send, at("2026-10-22T11:09:00Z"));
    expect(t.late).toBe("typeform");
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
  test("sent, then Make's update", () => {
    const s = fixtureSend({ sentAt: SENT_AT });
    expect(sendLine(KICKOFF, s, fixtureRow())).toBe(
      "Sent from the cockpit at 14:02 by Lina.",
    );
    expect(
      sendLine(
        KICKOFF,
        s,
        fixtureRow({
          client_status: "Brand Blueprint Booked♠️",
          card_updated_at: "2026-10-22T11:03:40Z",
        }),
      ),
    ).toBe(
      "Sent from the cockpit at 14:02 by Lina. Make updated the card at 14:03.",
    );
    expect(sendLine(KICKOFF, { ...s, sentBy: null }, null)).toBe(
      "Sent from the cockpit at 14:02.",
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
  });
});
