import { describe, expect, test } from "bun:test";
import {
  type CallRow,
  callGaps,
  minutesWords,
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
    });
  });
  test("a rep's own first calls only", () => {
    expect(speedToLead(leads, calls, "Tahreer@maharamedia.com")).toMatchObject({
      leads: 2,
      called: 2,
      never: 0,
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
