import { describe, expect, test } from "bun:test";
import { slackReceiptConfirmed } from "../_shared/slackReceipt";

// The channel rule (contract 4.5, plan S1): C and G must come back as themselves, U and W must come back as a
// direct message (D), and anything else is not confirmed. The ids are invented.
const TS = "1792872070.187739";

describe("slackReceiptConfirmed", () => {
  test("a channel (C) or a private channel (G) must come back as itself", () => {
    expect(slackReceiptConfirmed("C09RZ0GS0V9", { ok: true, ts: TS, channel: "C09RZ0GS0V9" })).toEqual({ ok: true, ts: TS, channel: "C09RZ0GS0V9" });
    expect(slackReceiptConfirmed("G0PRIVATE01", { ok: true, ts: TS, channel: "G0PRIVATE01" })).toEqual({ ok: true, ts: TS, channel: "G0PRIVATE01" });
    expect(slackReceiptConfirmed("C09RZ0GS0V9", { ok: true, ts: TS, channel: "C0AE8G5MT7Y" }).ok).toBe(false);
    expect(slackReceiptConfirmed("C09RZ0GS0V9", { ok: true, ts: TS, channel: "D0SOMEDM001" }).ok).toBe(false);
    expect(slackReceiptConfirmed("G0PRIVATE01", { ok: true, ts: TS, channel: "C0PRIVATE01" }).ok).toBe(false);
  });
  test("a direct message (D) must come back as itself", () => {
    expect(slackReceiptConfirmed("D0SOMEDM001", { ok: true, ts: TS, channel: "D0SOMEDM001" }).ok).toBe(true);
    expect(slackReceiptConfirmed("D0SOMEDM001", { ok: true, ts: TS, channel: "D0OTHERDM01" }).ok).toBe(false);
  });
  test("a person (U or W) must come back as a direct message", () => {
    expect(slackReceiptConfirmed("U09305KE2KS", { ok: true, ts: TS, channel: "D0ALERTDM01" })).toEqual({ ok: true, ts: TS, channel: "D0ALERTDM01" });
    expect(slackReceiptConfirmed("W0ENTERPRS1", { ok: true, ts: TS, channel: "D0ALERTDM01" }).ok).toBe(true);
    expect(slackReceiptConfirmed("U09305KE2KS", { ok: true, ts: TS, channel: "C09RZ0GS0V9" }).ok).toBe(false);
    expect(slackReceiptConfirmed("U09305KE2KS", { ok: true, ts: TS, channel: "G0PRIVATE01" }).ok).toBe(false);
  });
  test("anything else is not confirmed", () => {
    const good = { ok: true, ts: TS, channel: "C09RZ0GS0V9" };
    const no = (requested: string, receipt: Record<string, unknown> | null) => expect(slackReceiptConfirmed(requested, receipt as never).ok).toBe(false);
    no("C09RZ0GS0V9", { ...good, ok: false });
    no("C09RZ0GS0V9", { ...good, ok: "true" });
    no("C09RZ0GS0V9", { ...good, ts: undefined });
    no("C09RZ0GS0V9", { ...good, ts: 1792872070.187739 });
    no("C09RZ0GS0V9", { ...good, ts: "1792872070" });
    no("C09RZ0GS0V9", { ...good, ts: "abc.def" });
    no("C09RZ0GS0V9", { ...good, channel: undefined });
    no("C09RZ0GS0V9", { ...good, channel: "c09rz0gs0v9" });
    no("C09RZ0GS0V9", { ...good, channel: "U09305KE2KS" });
    no("#csm-general", good);
    no("", good);
    no("csm-general", good);
    no("C09RZ0GS0V9", null);
    expect(slackReceiptConfirmed("C09RZ0GS0V9", { ...good, channel: "C0AE8G5MT7Y" })).toEqual({ ok: false, why: "Slack answered for another channel (C0AE8G5MT7Y)." });
  });
});
