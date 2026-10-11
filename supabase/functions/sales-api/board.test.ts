// The board's Closed column: where a signed or closed lead goes, what its
// card says, its order, its header counts and the "Mine" scope.

import { describe, expect, test } from "bun:test";
import {
  closedCard,
  closedColumn,
  closedCounts,
  closedIsMine,
  CLIENT_MOVE_REFUSAL,
  leadStageRole,
  myNames,
  OPEN_FIELDS,
  placeLead,
  SIGNED_COLUMN,
  sortClosed,
} from "./board.ts";
import { clientFacts } from "./clients.ts";

type Row = Record<string, unknown>;

// The 2-Call pipeline's stages as HighLevel names them (2026-10-11), each
// with the role the cockpit gives it.
const TWO_CALL = {
  id: "96oywOezX39jQzXP3Mg0",
  name: "Sales Pipeline (2-Call)",
  stages: [
    { id: "s-new", name: "🚨New Lead", position: 0, role: "new" },
    { id: "s-intro", name: "👀Intro Call REQUESTED", position: 1, role: "intro_booked" },
    { id: "s-demo", name: "📅Demo Booked (Qualified)", position: 4, role: "demo_booked" },
    { id: "s-short", name: "⏳Short Term Nurture", position: 9, role: "nurture_short" },
    { id: "s-closed", name: "🎉Closed", position: 12, role: "won" },
  ],
};

const lead = (over: Row = {}): Row => ({
  contact_id: "c-1",
  name: "Huda Ali",
  stage_id: "s-short",
  stage_name: "⏳Short Term Nurture",
  opp_status: "open",
  tags: ["roas-qualified"],
  assigned_to: "u-tahreer",
  ...over,
});

const deal = (over: Row = {}): Row => ({
  contact_id: "c-1",
  submitted_at: "2026-10-09T18:46:19Z",
  closer: "Ahmed Abushaiba",
  setter: "تحرير عبادي",
  contracted_revenue: 6000,
  voided: false,
  ...over,
});

describe("closedColumn", () => {
  test("the won stage named Closed", () => {
    expect(closedColumn(TWO_CALL)).toEqual({ id: "s-closed", name: "🎉Closed", synthetic: false });
  });

  test("several won stages: the one that says closed, wherever it sits", () => {
    const pipe = {
      stages: [
        { id: "s-off", name: "Offboarding", position: 1, role: "won" },
        { id: "s-closed", name: "🎉 Closed", position: 9, role: "won" },
      ],
    };
    expect(closedColumn(pipe).id).toBe("s-closed");
  });

  test("a won stage that says closed lost is not the Closed column", () => {
    const pipe = {
      stages: [
        { id: "s-lost", name: "Closed Lost", position: 1, role: "won" },
        { id: "s-won", name: "Won", position: 2, role: "won" },
      ],
    };
    expect(closedColumn(pipe).id).toBe("s-won");
  });

  test("no stage says closed: the first won stage in the pipeline's order", () => {
    const pipe = {
      stages: [
        { id: "s-b", name: "Signed 🎉", position: 7, role: "won" },
        { id: "s-a", name: "Onboarding", position: 3, role: "won" },
      ],
    };
    expect(closedColumn(pipe).id).toBe("s-a");
  });

  test("no won stage at all (or no pipeline): the cockpit's own Signed column", () => {
    expect(closedColumn({ stages: [{ id: "x", name: "Demo Booked🚀", role: "demo_booked" }] })).toEqual(SIGNED_COLUMN);
    expect(closedColumn(null)).toEqual({ id: "signed", name: "Signed", synthetic: true });
  });
});

describe("placeLead (D48)", () => {
  const none = { client: false };

  test("an open lead stays in its own stage", () => {
    expect(placeLead(lead(), none, TWO_CALL)).toEqual({ closed: false, stage_id: "s-short" });
  });

  test("a lead with no stage yet stays loose", () => {
    expect(placeLead(lead({ stage_id: null, stage_name: null }), none, TWO_CALL)).toEqual({ closed: false, stage_id: null });
  });

  test("a tagged client is placed in Closed, whatever HighLevel's stage", () => {
    const f = clientFacts(lead({ tags: ["client"] }), []);
    expect(placeLead(lead({ tags: ["client"] }), f, TWO_CALL)).toEqual({ closed: true, stage_id: "s-closed" });
  });

  test("a signed deal without the tag is placed in Closed", () => {
    const f = clientFacts(lead({ stage_id: "s-demo" }), [deal()]);
    expect(placeLead(lead({ stage_id: "s-demo" }), f, TWO_CALL).closed).toBe(true);
  });

  test("a voided deal leaves the lead where it is", () => {
    const f = clientFacts(lead(), [deal({ voided: true })]);
    expect(placeLead(lead(), f, TWO_CALL)).toEqual({ closed: false, stage_id: "s-short" });
  });

  test("an opportunity HighLevel marks won is placed in Closed", () => {
    expect(placeLead(lead({ opp_status: "won" }), none, TWO_CALL).closed).toBe(true);
  });

  test("a lead already in a won stage (a legacy Closed lead) stays in Closed", () => {
    expect(placeLead(lead({ stage_id: "s-closed", stage_name: "🎉Closed" }), none, TWO_CALL)).toEqual({
      closed: true,
      stage_id: "s-closed",
    });
  });

  test("a stage the pipeline does not list: the settings' role, else its name", () => {
    expect(placeLead(lead({ stage_id: "s-other", stage_name: "Anything" }), none, TWO_CALL, { "s-other": "won" }).closed).toBe(
      true,
    );
    expect(placeLead(lead({ stage_id: "s-other", stage_name: "🎉Closed" }), none, TWO_CALL).closed).toBe(true);
    expect(leadStageRole(lead({ stage_id: "s-other", stage_name: "Lost" }), TWO_CALL)).toBe("lost");
  });

  test("a pipeline with no won stage: the cockpit's Signed column", () => {
    const pipe = { stages: [{ id: "s-demo", name: "Demo Booked🚀", role: "demo_booked" }] };
    expect(placeLead(lead({ tags: ["client"] }), { client: true }, pipe)).toEqual({ closed: true, stage_id: "signed" });
  });
});

describe("closedCard (D49)", () => {
  test("a deal client: the signed date, the value, who closed it, HighLevel's real stage", () => {
    const l = lead({ stage_id: "s-demo", stage_name: "📅Demo Booked (Qualified)" });
    expect(closedCard(l, clientFacts(l, [deal()]))).toEqual({
      client: true,
      closed: true,
      signed_at: "2026-10-09T18:46:19.000Z",
      value: 6000,
      closer: "Ahmed Abushaiba",
      setter: "تحرير عبادي",
      crm_stage: "📅Demo Booked (Qualified)",
    });
  });

  test("a tag-only client: a client, with no date or value (unknown, not zero)", () => {
    const l = lead({ tags: ["client"] });
    const c = closedCard(l, clientFacts(l, []));
    expect([c.client, c.signed_at, c.value, c.closer]).toEqual([true, null, null, null]);
  });

  test("a legacy Closed lead: closed, not a client", () => {
    const l = lead({ stage_id: "s-closed", stage_name: "🎉Closed" });
    const c = closedCard(l, clientFacts(l, []));
    expect([c.client, c.closed, c.crm_stage]).toEqual([false, true, "🎉Closed"]);
  });

  test("an open card carries none of it", () => {
    expect(OPEN_FIELDS).toEqual({
      client: false,
      closed: false,
      signed_at: null,
      value: null,
      closer: null,
      setter: null,
      crm_stage: null,
    });
  });
});

describe("sortClosed (D50)", () => {
  test("newest signing first, then tag-only clients, then legacy Closed leads, each by last update", () => {
    const cards = [
      { name: "legacy old", client: false, signed_at: null, last_touch_at: "2025-10-20T10:00:00Z" },
      { name: "signed Sep", client: true, signed_at: "2026-09-01T10:00:00Z", last_touch_at: null },
      { name: "tag new", client: true, signed_at: null, last_touch_at: "2026-10-01T10:00:00Z" },
      { name: "legacy new", client: false, signed_at: null, last_touch_at: "2026-01-29T10:00:00Z" },
      { name: "signed Oct", client: true, signed_at: "2026-10-09T10:00:00Z", last_touch_at: null },
      { name: "tag old", client: true, signed_at: null, last_touch_at: null },
    ];
    expect(sortClosed(cards).map(c => c.name)).toEqual([
      "signed Oct",
      "signed Sep",
      "tag new",
      "tag old",
      "legacy new",
      "legacy old",
    ]);
  });

  test("leaves its input alone", () => {
    const cards = [{ name: "b", signed_at: null }, { name: "a", signed_at: "2026-10-01T00:00:00Z" }];
    sortClosed(cards);
    expect(cards[0]?.name).toBe("b");
  });
});

describe("closedCounts (D53)", () => {
  test("signed clients apart from open leads; open cards are not counted", () => {
    const cards = [
      { closed: true, client: true },
      { closed: true, client: true },
      { closed: true, client: false },
      { closed: false, client: false },
    ];
    expect(closedCounts(cards)).toEqual({ open: 1, signed: 2 });
    expect(closedCounts([])).toEqual({ open: 0, signed: 0 });
  });
});

describe("the Mine scope on a Closed card (D53)", () => {
  const me = { ghl_user_id: "u-ahmed", names: myNames("Ahmed Abushaiba", ["Ahmed Abusahiba", " أحمد أبوشيبه "]) };

  test("my names as the deals spell them, lower case and trimmed, no blanks", () => {
    expect([...myNames("Tahrir Abadi", [" تحرير عبادي ", null, ""], undefined)]).toEqual(["tahrir abadi", "تحرير عبادي"]);
  });

  test("a deal I closed", () => {
    expect(closedIsMine(lead({ assigned_to: "u-other" }), [deal({ closer: " ahmed abushaiba " })], me)).toBe(true);
  });

  test("a deal I set (the setter's name, in Arabic as the form has it)", () => {
    const setter = { ghl_user_id: "u-tahreer-x", names: myNames("Tahrir Abadi", ["تحرير عبادي"]) };
    expect(closedIsMine(lead({ assigned_to: "u-other" }), [deal({ closer: "Ahmed Abushaiba" })], setter)).toBe(true);
  });

  test("a lead I own, with no deal of mine", () => {
    expect(closedIsMine(lead({ assigned_to: "u-ahmed" }), [], me)).toBe(true);
  });

  test("someone else's, or a voided deal of mine: not mine", () => {
    expect(closedIsMine(lead({ assigned_to: "u-other" }), [deal({ closer: "Maria", setter: null })], me)).toBe(false);
    expect(closedIsMine(lead({ assigned_to: "u-other" }), [deal({ voided: true })], me)).toBe(false);
  });

  test("a deal with no closer or setter never matches a seat with no names", () => {
    expect(
      closedIsMine(lead({ assigned_to: null }), [deal({ closer: null, setter: null })], { ghl_user_id: null, names: myNames() }),
    ).toBe(false);
  });
});

test("the move refusal's words", () => {
  expect(CLIENT_MOVE_REFUSAL).toBe("This client is signed, so they stay in Closed. Client success looks after them.");
});
