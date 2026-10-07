// bun test apps/sales-cockpit/src/lib/stress_desk_r4.test.ts
//
// Stress round 4, the follow-up agent's WhatsApp gate on the Follow-ups page
// (2026-10-03). The gate is open only once the WA Connector is off and a
// single-copy test passed after it went off (sales-api sendrules.ts gateOpen,
// desk followups.py wa_gate: a test from before connector_off_at proves
// nothing). The page's own reading (videoLink.ts guardOpen) leaves
// connector_off_at out: it says "WhatsApp from the desk is on" and shows
// "One copy arrived" with no button to record a new test, while both doors
// hold every WhatsApp send. A manager's save can leave the setting that way
// (connector off and an old test time in one save). Every lead and line is
// invented.

import { describe, expect, mock, test } from "bun:test";
import {
  gateOpen,
  whatsappGuardValue,
} from "../../../../supabase/functions/sales-api/sendrules";

mock.module("./api", () => ({
  api: async () => ({ ok: true }),
}));

const V = await import("./videoLink");

const NOW = Date.parse("2026-10-04T08:00:00.000Z");

describe("the WhatsApp gate as the Follow-ups page reads it", () => {
  test("a single-copy test from before the connector last went off is not an open gate", () => {
    const g = {
      connector_off: true,
      connector_off_at: "2026-10-03T09:00:00.000Z",
      single_copy_ok_at: "2026-10-01T09:00:00.000Z",
    };
    expect(gateOpen(g)).toBe(false);
    expect(V.guardOpen(g)).toBe(gateOpen(g));
  });

  test("a save that turns the connector off with an old test time leaves the page and the doors agreeing", () => {
    const saved = whatsappGuardValue(
      {
        connector_off: false,
        templates_per_day: 250,
        pause_fail_share: 0.3,
        pause_min_sends: 5,
      },
      { connector_off: true, single_copy_ok_at: "2026-09-01T09:00:00.000Z" },
      NOW,
    );
    expect(saved.ok).toBe(true);
    const value = (saved as { ok: true; value: Record<string, unknown> }).value;
    expect(V.guardOpen(value)).toBe(gateOpen(value));
  });
});
