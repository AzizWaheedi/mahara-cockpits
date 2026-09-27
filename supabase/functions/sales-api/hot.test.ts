// bun test supabase/functions/sales-api
import { describe, expect, test } from "bun:test";
import { hotFresh, hotPatch, stillHot } from "./hot.ts";

const NOW = Date.parse("2026-09-27T09:00:00Z");
const DAY = 86_400_000;
const rep = { email: "sara@x.com", manager: false };
const boss = { email: "aziz@x.com", manager: true };

const patchOf = (b: Record<string, unknown>, who = rep) => {
  const p = hotPatch(b, NOW, who);
  if (!p.ok) throw new Error(`refused: ${p.error}`);
  return p.patch;
};
const errorOf = (b: Record<string, unknown>, who = rep) => {
  const p = hotPatch(b, NOW, who);
  return p.ok ? null : p.error;
};

describe("a save changes only what it names", () => {
  test("a cell edit sends one field and changes only that one", () => {
    expect(patchOf({ contact_id: "c1", note: "Call after Friday prayers" })).toEqual({
      note: "Call after Friday prayers",
    });
    expect(patchOf({ contact_id: "c1", heat: "warm" })).toEqual({ heat: "warm" });
  });
  test("an empty body changes nothing (putting a lead on the list)", () => {
    expect(patchOf({ contact_id: "c1" })).toEqual({});
  });
  test("fields sent as undefined are not sent", () => {
    expect(patchOf({ note: undefined, amount: undefined, status: "closed" })).toEqual({ status: "closed" });
  });
  test("null or blank clears a field that may be blank", () => {
    expect(patchOf({ note: "  ", last_objection: null, amount: "", next_at: null, last_fu_at: "" })).toEqual({
      note: null,
      last_objection: null,
      amount: null,
      next_at: null,
      last_fu_at: null,
    });
    expect(patchOf({ heat: null })).toEqual({ heat: null });
  });
  test("fields the row does not have are ignored", () => {
    expect(patchOf({ added_by: "someone@x.com", removed_at: "2026-09-01", updated_at: "x" })).toEqual({});
  });
  test("the old lead-page form (every field at once) still saves", () => {
    const p = patchOf({
      next_at: new Date(NOW + DAY).toISOString(),
      next_how: "whatsapp",
      last_objection: "Wants to ask his partner",
      note: "",
    });
    expect(p).toEqual({
      next_at: new Date(NOW + DAY).toISOString(),
      next_how: "whatsapp",
      last_objection: "Wants to ask his partner",
      note: null,
    });
  });
});

describe("what each field takes", () => {
  test("type: red hot, hot or warm", () => {
    expect(patchOf({ heat: "red_hot" })).toEqual({ heat: "red_hot" });
    expect(errorOf({ heat: "boiling" })).toContain("red hot, hot or warm");
    expect(errorOf({ heat: "Hot" })).toContain("red hot, hot or warm");
  });
  test("status: nurturing, closed or lost, never blank", () => {
    for (const s of ["nurturing", "closed", "lost"]) expect(patchOf({ status: s })).toEqual({ status: s });
    expect(errorOf({ status: "won" })).toContain("nurturing, closed or lost");
    expect(errorOf({ status: null })).toContain("nurturing, closed or lost");
    expect(errorOf({ status: "" })).toContain("nurturing, closed or lost");
  });
  test("amount: a number of 0 or more, commas allowed, cents kept", () => {
    expect(patchOf({ amount: 5000 })).toEqual({ amount: 5000 });
    expect(patchOf({ amount: "12,500" })).toEqual({ amount: 12500 });
    expect(patchOf({ amount: "1500.456" })).toEqual({ amount: 1500.46 });
    expect(patchOf({ amount: 0 })).toEqual({ amount: 0 });
    expect(errorOf({ amount: -1 })).toContain("from 0 to 10,000,000");
    expect(errorOf({ amount: "five thousand" })).toContain("from 0 to 10,000,000");
    expect(errorOf({ amount: 20_000_000 })).toContain("from 0 to 10,000,000");
  });
  test("currency: the seven the cockpit pays in, any case", () => {
    expect(patchOf({ amount_currency: "kwd" })).toEqual({ amount_currency: "KWD" });
    expect(patchOf({ amount: "900", amount_currency: "SAR" })).toEqual({ amount: 900, amount_currency: "SAR" });
    expect(errorOf({ amount_currency: "EUR" })).toContain("USD, KWD");
    expect(errorOf({ amount_currency: null })).toContain("USD, KWD");
  });
  test("text is trimmed and capped", () => {
    expect(patchOf({ last_objection: `  ${"x".repeat(600)}  ` }).last_objection).toHaveLength(500);
    expect(patchOf({ note: "y".repeat(5000) }).note).toHaveLength(4000);
    expect(patchOf({ note: "بعد رمضان\nيكلمنا" })).toEqual({ note: "بعد رمضان\nيكلمنا" });
  });
  test("next follow-up: from yesterday up to a year ahead", () => {
    const inFiveMonths = new Date(NOW + 150 * DAY).toISOString();
    expect(patchOf({ next_at: inFiveMonths })).toEqual({ next_at: inFiveMonths });
    expect(patchOf({ next_at: "2026-09-27T08:00:00+03:00" })).toEqual({ next_at: "2026-09-27T05:00:00.000Z" });
    expect(errorOf({ next_at: new Date(NOW - 3 * DAY).toISOString() })).toContain("yesterday up to a year ahead");
    expect(errorOf({ next_at: new Date(NOW + 400 * DAY).toISOString() })).toContain("a year ahead");
    expect(errorOf({ next_at: "next week" })).toContain("a year ahead");
  });
  test("how to follow up: call, WhatsApp, email or a meeting", () => {
    expect(patchOf({ next_how: "meeting" })).toEqual({ next_how: "meeting" });
    expect(patchOf({ next_how: "" })).toEqual({ next_how: null });
    expect(errorOf({ next_how: "pigeon" })).toContain("call, WhatsApp");
  });
  test("last follow-up: not in the future, within the past year", () => {
    expect(patchOf({ last_fu_at: new Date(NOW).toISOString() })).toEqual({ last_fu_at: new Date(NOW).toISOString() });
    // A phone clock a minute ahead is not refused.
    expect(patchOf({ last_fu_at: new Date(NOW + 60_000).toISOString() }).last_fu_at).toBeTruthy();
    expect(errorOf({ last_fu_at: new Date(NOW + DAY).toISOString() })).toContain("cannot be in the future");
    expect(errorOf({ last_fu_at: new Date(NOW - 400 * DAY).toISOString() })).toContain("past year");
    expect(errorOf({ last_fu_at: "yesterday" })).toContain("Pick when you last followed up");
  });
  test("the first field that is wrong is the one said", () => {
    expect(errorOf({ heat: "warm", status: "won", amount: -5 })).toContain("nurturing, closed or lost");
  });
});

describe("who a hot lead belongs to", () => {
  test("a manager may give it to any seat", () => {
    expect(patchOf({ owner_email: " Omar@X.com " }, boss)).toEqual({ owner_email: "omar@x.com" });
  });
  test("a rep may not give it to someone else", () => {
    expect(errorOf({ owner_email: "omar@x.com" })).toContain("Only a manager");
  });
  test("a rep naming themselves is not a change of hands", () => {
    expect(patchOf({ owner_email: "SARA@x.com" })).toEqual({ owner_email: "sara@x.com" });
  });
  test("an owner must be an email address", () => {
    expect(errorOf({ owner_email: "omar" }, boss)).toContain("email address");
    expect(errorOf({ owner_email: null }, boss)).toContain("email address");
  });
});

describe("a lead put on the list", () => {
  test("starts blank, nurturing and hot, owned by whoever put it there", () => {
    const at = "2026-09-27T09:00:00.000Z";
    const row = hotFresh("c9", "sara@x.com", at);
    expect(row).toMatchObject({
      contact_id: "c9",
      owner_email: "sara@x.com",
      added_by: "sara@x.com",
      added_at: at,
      updated_at: at,
      status: "nurturing",
      heat: "hot",
      amount: null,
      amount_currency: "USD",
      next_at: null,
      last_fu_at: null,
      last_objection: null,
      note: null,
      removed_at: null,
      removed_why: null,
    });
  });
  test("a save's own fields go on top of the blank row", () => {
    const row = { ...hotFresh("c9", "aziz@x.com", "t"), ...patchOf({ owner_email: "omar@x.com", heat: "red_hot" }, boss) };
    expect(row.owner_email).toBe("omar@x.com");
    expect(row.added_by).toBe("aziz@x.com");
    expect(row.heat).toBe("red_hot");
  });
});

describe("what still counts as hot for the dialer and the board", () => {
  test("a nurturing row on the list", () => {
    expect(stillHot({ status: "nurturing", removed_at: null })).toBe(true);
  });
  test("a row from before the status column", () => {
    expect(stillHot({ removed_at: null })).toBe(true);
    expect(stillHot({ status: null, removed_at: null })).toBe(true);
  });
  test("not a closed or lost row, which stays on the list for the record", () => {
    expect(stillHot({ status: "closed", removed_at: null })).toBe(false);
    expect(stillHot({ status: "lost", removed_at: null })).toBe(false);
  });
  test("not a row taken off the list", () => {
    expect(stillHot({ status: "nurturing", removed_at: "2026-09-26T10:00:00Z" })).toBe(false);
  });
});
