// group.made: the invite link's check, one row per lead, the audit row, the
// HighLevel note (once, without the link) and a HighLevel failure that
// leaves the save standing.

import { beforeEach, describe, expect, test } from "bun:test";
import { ApiRefusal } from "./liveio.ts";
import type { Who } from "./lib.ts";
import { FakeDb } from "./testfakes.ts";
import { BAD_INVITE, cleanInvite, groupNote, makeGroups } from "./groups.ts";

type Row = Record<string, unknown>;

const T0 = Date.parse("2026-10-10T11:10:00Z");
const SETTER: Who = { signed_in: true, seat: true, manager: false, email: "tahreer@maharamedia.com", name: "Tahreer", ghl_user_id: "u-tahreer" };
const INVITE = "https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv";

let db: FakeDb;
let clock: { now: number };
let audits: { action: string; before: unknown; after: unknown }[];
let notes: { path: string; body: Row; version?: string }[];
let ghlFails: boolean;

function build() {
  return makeGroups({
    svc: (path, init) => db.db(path, init),
    audit: async (_who, action, _t, _id, before, after) => {
      audits.push({ action, before, after });
    },
    ghl: async (_method, path, body, version) => {
      if (ghlFails) throw new Error("HighLevel said 502: bad gateway");
      notes.push({ path, body: body as Row, version });
      return {};
    },
    now: () => clock.now,
  });
}

let g: ReturnType<typeof build>;

async function refusal(p: Promise<unknown>): Promise<ApiRefusal> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiRefusal) return e;
    throw e;
  }
  throw new Error("expected a refusal");
}

const rows = () => db.t("cockpit_sales_groups");

beforeEach(() => {
  clock = { now: T0 };
  db = new FakeDb(clock);
  audits = [];
  notes = [];
  ghlFails = false;
  db.tables.cockpit_sales_leads = [
    { contact_id: "c-sara", name: "Sara Al Ali", company: "Al Noor Interiors", phone: "+96550000000", tags: [] },
    { contact_id: "c-client", name: "Client Co", company: "X", phone: "+96550000001", tags: ["Client"] },
  ];
  g = build();
});

describe("the invite link", () => {
  test("WhatsApp's own link, with or without its tracking query, is kept clean", () => {
    expect(cleanInvite(INVITE)).toBe(INVITE);
    expect(cleanInvite(`${INVITE}?mode=ems_copy_t`)).toBe(INVITE);
    expect(cleanInvite(`chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv`)).toBe(INVITE);
    expect(cleanInvite(`  ${INVITE}/  `)).toBe(INVITE);
    expect(cleanInvite("")).toBeNull();
    expect(cleanInvite(null)).toBeNull();
  });
  test("anything else is not an invite", () => {
    for (const bad of [
      "https://wa.me/96550000000",
      "https://chat.whatsapp.com/short",
      "https://evil.example/chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv",
      "https://chat.whatsapp.com.evil.io/AbCdEfGhIjKlMnOpQrStUv",
      "javascript:alert(1)",
      "https://chat.whatsapp.com/AbCd EfGhIjKlMnOp",
    ])
      expect(cleanInvite(bad)).toBeUndefined();
  });
  test("a bad link is refused with the sentence, nothing saved", async () => {
    const r = await refusal(g.actions["group.made"](SETTER, { contact_id: "c-sara", invite_link: "https://wa.me/1" }));
    expect([r.status, r.message]).toEqual([400, BAD_INVITE]);
    expect(rows()).toHaveLength(0);
  });
});

describe("group.made", () => {
  test("saves one row, its audit row and the HighLevel note without the link", async () => {
    const out = await g.actions["group.made"](SETTER, {
      contact_id: "c-sara",
      appointment_id: "appt-1",
      name: "Al Noor Interiors | Mahara Media",
      invite_link: INVITE,
    });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ contact_id: "c-sara", invite_link: INVITE, made_by: "tahreer@maharamedia.com", crm_note: "written", appointment_id: "appt-1" });
    expect((out.group as Row).crm_note).toBe("written");
    expect(audits.map(a => a.action)).toEqual(["group.made"]);
    expect(notes).toHaveLength(1);
    expect(notes[0].path).toBe("/contacts/c-sara/notes");
    expect(notes[0].body.body).toBe("WhatsApp group made by Tahreer on Sat 10 Oct, 14:10 (Kuwait time).");
    expect(notes[0].body.userId).toBe("u-tahreer");
    expect(JSON.stringify(notes)).not.toContain("chat.whatsapp.com");
  });

  test("made again: the same row is updated, no second note, a link is never wiped", async () => {
    await g.actions["group.made"](SETTER, { contact_id: "c-sara", invite_link: INVITE });
    clock.now += 60_000;
    await g.actions["group.made"](SETTER, { contact_id: "c-sara" });
    expect(rows()).toHaveLength(1);
    expect(rows()[0].invite_link).toBe(INVITE);
    expect(rows()[0].updated_at).toBe(new Date(T0 + 60_000).toISOString());
    expect(notes).toHaveLength(1);
    expect(audits).toHaveLength(2);
    expect((audits[1].before as Row).invite_link).toBe(INVITE);
  });

  test("a second press by someone else keeps who made it", async () => {
    await g.actions["group.made"](SETTER, { contact_id: "c-sara", invite_link: INVITE });
    const MANAGER: Who = { signed_in: true, seat: true, manager: true, email: "boss@maharamedia.com", name: "Boss" };
    await g.actions["group.made"](MANAGER, { contact_id: "c-sara" });
    expect(rows()).toHaveLength(1);
    expect(rows()[0].made_by).toBe("tahreer@maharamedia.com");
  });

  test("Group made with no link saves without one", async () => {
    await g.actions["group.made"](SETTER, { contact_id: "c-sara" });
    expect(rows()[0].invite_link ?? null).toBeNull();
  });

  test("HighLevel failing leaves the save standing, with crm_note failed", async () => {
    ghlFails = true;
    const out = await g.actions["group.made"](SETTER, { contact_id: "c-sara", invite_link: INVITE });
    expect(rows()).toHaveLength(1);
    expect(String(rows()[0].crm_note)).toMatch(/^failed: HighLevel said 502/);
    expect(String((out.group as Row).crm_note)).toMatch(/^failed:/);
    // The next press tries the note again.
    ghlFails = false;
    await g.actions["group.made"](SETTER, { contact_id: "c-sara" });
    expect(rows()[0].crm_note).toBe("written");
    expect(notes).toHaveLength(1);
  });

  test("an active client is refused; an unknown lead is 404", async () => {
    let r = await refusal(g.actions["group.made"](SETTER, { contact_id: "c-client", invite_link: INVITE }));
    expect([r.status, r.extra.code]).toEqual([409, "client"]);
    r = await refusal(g.actions["group.made"](SETTER, { contact_id: "c-nobody" }));
    expect(r.status).toBe(404);
    expect(rows()).toHaveLength(0);
  });

  test("the note's words", () => {
    expect(groupNote("Tahreer", T0)).toBe("WhatsApp group made by Tahreer on Sat 10 Oct, 14:10 (Kuwait time).");
  });
});
