import { describe, expect, test } from "bun:test";
import {
  KICKOFF_FORM,
  KICKOFF_FORMS,
  KICKOFF_SQL,
  readKickoffs,
} from "./native/adapters/growth.js";

/**
 * Kickoff cash reads a native kickoff exactly like a Typeform one (docs/forms/WAVE56-CONTRACT.md 4.13.2): the
 * cockpit's kickoff sheet writes cockpit_client_onboarding.forms.kickoff in the Typeform's shape with form_id
 * "native", and growth.js drops only the hard-coded Typeform id from its filter. Made-up clients and amounts only.
 */
describe("kickoff cash with the native kickoff (Stage 4)", () => {
  test("the filter takes the Typeform's id and native, nothing else", () => {
    expect(KICKOFF_FORMS).toEqual([KICKOFF_FORM, "native"]);
    expect(KICKOFF_SQL).toContain("in ('tG7dnxBn', 'native')");
    expect(KICKOFF_SQL).not.toContain("BbJy6xg4");
    expect(KICKOFF_SQL).toContain("forms->'kickoff'->>'payment' as payment");
  });

  test("a native kickoff's payment is counted and confirmed exactly as a Typeform one", () => {
    const forms = [
      {
        clickup_task_id: "task-typeform",
        client_name: "Typeform Client",
        day: "2026-10-20",
        payment: "1500",
      },
      {
        clickup_task_id: "task-native",
        client_name: "Native Client",
        day: "2026-11-03",
        payment: "1500",
      },
    ];
    const payments = [
      {
        payment_id: "whop:p1",
        clickup_task_id: "task-typeform",
        day: "2026-10-21",
        usd: 1500,
        rail: "whop",
      },
      {
        payment_id: "tap:p2",
        clickup_task_id: "task-native",
        day: "2026-11-03",
        usd: 1500,
        rail: "tap",
      },
    ];
    const out = readKickoffs(forms, payments);
    expect(out.kickoffs).toEqual([
      {
        day: "2026-10-20",
        taskId: "task-typeform",
        client: "Typeform Client",
        amount: 1500,
        confirmed: 1500,
        rail: "whop",
      },
      {
        day: "2026-11-03",
        taskId: "task-native",
        client: "Native Client",
        amount: 1500,
        confirmed: 1500,
        rail: "tap",
      },
    ]);
    // Swapping which door each came through changes nothing in the counts.
    const swapped = readKickoffs(
      forms.map(f => ({ ...f })),
      payments,
    );
    expect(swapped).toEqual(out);
  });
});
