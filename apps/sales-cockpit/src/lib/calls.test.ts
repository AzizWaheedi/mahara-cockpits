import { describe, expect, test } from "bun:test";
import {
  type CallRow,
  callGaps,
  lineAddress,
  minutesWords,
  salesLineCall,
  speedToLead,
  workingMinutes,
} from "./calls";

const call = (over: Partial<CallRow>): CallRow => ({
  occurred_at: null,
  agent_email: "tahreer@maharamedia.com",
  direction: "outbound",
  state: "no_answer",
  duration_s: 0,
  ringing_s: 30,
  lead_phone8: null,
  sales_rep_id: "rep-1",
  ...over,
});

describe("speed to lead", () => {
  // Saturday 26 September; 10:00 Kuwait is 07:00Z.
  const leads = [
    {
      contact_id: "a",
      phone8: "11111111",
      lead_created_at: "2026-09-26T07:00:00Z",
    },
    {
      contact_id: "b",
      phone8: "22222222",
      lead_created_at: "2026-09-26T07:00:00Z",
    },
    {
      contact_id: "c",
      phone8: "33333333",
      lead_created_at: "2026-09-26T07:00:00Z",
    },
    {
      contact_id: "d",
      phone8: "44444444",
      lead_created_at: "2026-09-26T07:00:00Z",
    },
  ];
  const calls = [
    call({ lead_phone8: "11111111", occurred_at: "2026-09-26T07:03:00Z" }),
    call({ lead_phone8: "11111111", occurred_at: "2026-09-26T07:30:00Z" }),
    call({
      lead_phone8: "22222222",
      occurred_at: "2026-09-26T08:00:00Z",
      agent_email: "aziz@maharamedia.com",
    }),
    // An inbound call counts: it is the first call with them.
    call({
      lead_phone8: "44444444",
      occurred_at: "2026-09-26T07:10:00Z",
      direction: "inbound",
    }),
    // A call before the lead came in, and a call-centre agent's call, do not count.
    call({ lead_phone8: "33333333", occurred_at: "2026-09-25T07:00:00Z" }),
    call({
      lead_phone8: "33333333",
      occurred_at: "2026-09-26T07:01:00Z",
      sales_rep_id: null,
    }),
  ];
  test("the median over the leads called, the never-called beside it", () => {
    expect(speedToLead(leads, calls)).toEqual({
      leads: 4,
      called: 3,
      never: 1,
      medianMin: 10,
      medianWorkingMin: 10,
      within5: 1,
      within5Working: 1,
    });
  });
  test("a call linked to one lead never counts for another with the same eight digits", () => {
    const twins = [
      {
        contact_id: "e",
        phone8: "55555555",
        lead_created_at: "2026-09-26T07:00:00Z",
      },
      {
        contact_id: "f",
        phone8: "55555555",
        lead_created_at: "2026-09-26T07:00:00Z",
      },
    ];
    const out = speedToLead(twins, [
      call({
        lead_phone8: "55555555",
        contact_id: "e",
        occurred_at: "2026-09-26T07:02:00Z",
      }),
    ]);
    expect(out).toMatchObject({ leads: 2, called: 1, never: 1, medianMin: 2 });
  });
  test("a call not linked yet counts for the lead with its eight digits", () => {
    const out = speedToLead(
      [
        {
          contact_id: "g",
          phone8: "66666666",
          lead_created_at: "2026-09-26T07:00:00Z",
        },
      ],
      [call({ lead_phone8: "66666666", occurred_at: "2026-09-26T07:04:00Z" })],
    );
    expect(out).toMatchObject({ called: 1, medianMin: 4, within5: 1 });
  });
  test("a lead in at night counts its five working minutes from 10:00", () => {
    // In at 02:00 Kuwait (23:00Z the night before), called at 10:03.
    const out = speedToLead(
      [
        {
          contact_id: "h",
          phone8: "77777777",
          lead_created_at: "2026-09-25T23:00:00Z",
        },
      ],
      [call({ lead_phone8: "77777777", occurred_at: "2026-09-26T07:03:00Z" })],
    );
    expect(out).toMatchObject({ within5: 0, within5Working: 1 });
  });
  test("a rep's own first calls only", () => {
    expect(speedToLead(leads, calls, "Tahreer@maharamedia.com")).toMatchObject({
      leads: 2,
      called: 2,
      never: 0,
    });
  });
  describe("a seat with no row on B2B's roster counts by its Maqsam address (2026-11-05)", () => {
    const SETTER = "setter@seat.test";
    const CLOSER = "closer@seat.test";
    const one = [
      {
        contact_id: "s1",
        phone8: "88888888",
        lead_created_at: "2026-09-26T07:00:00Z",
      },
    ];
    // The setter's call: the desk copies it with no rep id.
    const setterCall = call({
      contact_id: "s1",
      occurred_at: "2026-09-26T07:02:00Z",
      agent_email: " Setter@Seat.test ",
      sales_rep_id: null,
    });
    // The closer, on the roster, calls later.
    const closerCall = call({
      contact_id: "s1",
      occurred_at: "2026-09-26T07:40:00Z",
      agent_email: CLOSER,
      sales_rep_id: "rep-closer",
    });
    const line = new Set([SETTER, CLOSER]);

    test("the setter's call counts once his address is a seat's", () => {
      expect(speedToLead(one, [setterCall], null, line)).toMatchObject({
        called: 1,
        never: 0,
        medianMin: 2,
        within5: 1,
      });
    });
    test("without the seats' addresses, only rep ids count, as before", () => {
      expect(speedToLead(one, [setterCall])).toMatchObject({
        called: 0,
        never: 1,
      });
    });
    test("the first caller's cohort: the lead is the setter's, not the closer's who called later", () => {
      const calls2 = [setterCall, closerCall];
      expect(speedToLead(one, calls2, SETTER, line)).toMatchObject({
        leads: 1,
        called: 1,
        medianMin: 2,
      });
      expect(speedToLead(one, calls2, CLOSER, line)).toMatchObject({
        leads: 0,
        called: 0,
      });
      // The old rule gave the closer a lead the setter had called 38 minutes before.
      expect(speedToLead(one, calls2, CLOSER)).toMatchObject({
        leads: 1,
        medianMin: 40,
      });
    });
    test("a call-centre agent's call, with no rep id and no seat's address, never counts", () => {
      const agent = call({
        contact_id: "s1",
        occurred_at: "2026-09-26T07:01:00Z",
        agent_email: "agent@callcentre.test",
        sales_rep_id: null,
      });
      expect(speedToLead(one, [agent], null, line)).toMatchObject({
        called: 0,
        never: 1,
      });
    });
    test("the rule itself: a rep id, or a seat's address compared trimmed and in lower case", () => {
      expect(
        salesLineCall({ sales_rep_id: "r", agent_email: null }, line),
      ).toBe(true);
      expect(
        salesLineCall(
          { sales_rep_id: null, agent_email: "SETTER@seat.test" },
          line,
        ),
      ).toBe(true);
      expect(
        salesLineCall({ sales_rep_id: null, agent_email: null }, line),
      ).toBe(false);
      // An empty address in the list never matches a call with none.
      expect(
        salesLineCall({ sales_rep_id: null, agent_email: "" }, new Set([""])),
      ).toBe(false);
      expect(lineAddress("  A@B.test ")).toBe("a@b.test");
    });
  });
  test("working minutes skip the night and Friday", () => {
    // Thursday 17:30 Kuwait to Saturday 10:30: 30 minutes Thursday, none Friday, 30 Saturday.
    expect(
      workingMinutes(
        Date.parse("2026-09-24T14:30:00Z"),
        Date.parse("2026-09-26T07:30:00Z"),
      ),
    ).toBe(60);
  });
});

describe("the gap between calls", () => {
  test("from the end of one call to the start of the next, in working hours, broken by any other call", () => {
    const g = callGaps([
      call({
        occurred_at: "2026-09-26T07:00:00Z",
        ringing_s: 30,
        duration_s: 90,
        state: "completed",
      }), // 10:00-10:02
      call({ occurred_at: "2026-09-26T07:05:00Z" }), // 3 min after
      call({ occurred_at: "2026-09-26T07:10:30Z" }), // 5 min after 10:05:30
      call({ occurred_at: "2026-09-26T07:20:00Z", direction: "inbound" }), // breaks the chain
      call({ occurred_at: "2026-09-26T07:25:00Z" }), // not counted: the call before it was inbound
      call({ occurred_at: "2026-09-26T16:30:00Z" }), // 19:30, after hours
      call({
        occurred_at: "2026-09-26T07:07:00Z",
        agent_email: "aziz@maharamedia.com",
      }), // alone
    ]);
    expect(g).toEqual({ samples: 2, averageMin: 4, medianMin: 4 });
  });
  test("minutes said plainly", () => {
    expect(minutesWords(0.5)).toBe("30 s");
    expect(minutesWords(3.46)).toBe("3.5 min");
    expect(minutesWords(130)).toBe("2 h 10 min");
    expect(minutesWords(null)).toBeNull();
  });
});
