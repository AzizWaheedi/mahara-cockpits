import { beforeEach, describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { bookingUrl, makeScriptNotes, SCRIPT_NOTE_LIMITS } from "./scriptnotes.ts";

type Row = Record<string, unknown>;

const SETTER: Who = { signed_in: true, seat: true, email: "tahreer@maharamedia.com", name: "Tahreer" };
const CLOSER: Who = { signed_in: true, seat: true, email: "ahmed@maharamedia.com", name: "Ahmed" };
const MANAGER: Who = { signed_in: true, seat: true, manager: true, email: "aziz@maharamedia.com", name: "Aziz" };
const CALL = "3f0c9a52-6a1b-4c1e-9d55-0d6a2f1b7c11";

/**
 * The notes table as PostgREST answers it: the partial unique index on
 * (contact_id, call_id) for script notes (20261010t), filters by eq, and a
 * hook that runs before an insert so a test can land a rival save first.
 */
function fakeDb() {
  const notes: Row[] = [];
  const audits: Row[] = [];
  const calls: { path: string; method: string }[] = [];
  let seq = 0;
  let beforeInsert: (() => void) | null = null;
  const leads = new Set(["lead-1"]);
  const filter = (path: string) => {
    const q = new URLSearchParams(path.split("?")[1] ?? "");
    return (r: Row) =>
      [...q.entries()]
        .filter(([k]) => !["select", "limit", "order"].includes(k))
        .every(([k, v]) => String(r[k]) === v.replace(/^eq\./, ""));
  };
  const svc = async (path: string, init: { method?: string; body?: unknown; prefer?: string } = {}) => {
    const method = init.method ?? "GET";
    calls.push({ path, method });
    if (!path.startsWith("cockpit_sales_notes")) throw new Error(`unexpected ${path}`);
    if (method === "GET") return notes.filter(filter(path)).map(r => ({ ...r }));
    if (method === "POST") {
      if (beforeInsert) {
        const f = beforeInsert;
        beforeInsert = null;
        f();
      }
      const b = init.body as Row;
      if (notes.some(n => n.kind === "script" && n.contact_id === b.contact_id && n.call_id === b.call_id))
        throw Object.assign(new Error('database 409: {"code":"23505","message":"duplicate key value violates unique constraint \\"cockpit_sales_notes_script_call\\""}'), { status: 409 });
      const row = { id: `n${++seq}`, created_at: "2026-10-10T10:00:00Z", updated_at: "2026-10-10T10:00:00Z", deleted_at: null, ...b };
      notes.push(row);
      return [{ ...row }];
    }
    if (method === "PATCH") {
      const hit = notes.filter(filter(path));
      for (const r of hit) Object.assign(r, init.body as Row);
      return hit.map(r => ({ ...r }));
    }
    throw new Error(`unexpected ${method}`);
  };
  const audit = async (
    who: Who,
    action: string,
    entityType: string,
    entityId: string | null,
    before: unknown,
    after: unknown,
    metadata: Row = {},
  ) => {
    audits.push({ actor: who.email, action, entityType, entityId, before, after, metadata });
  };
  const cockpitLead = async (id: string) => {
    if (!leads.has(id)) throw new ApiRefusal("That lead is not in the cockpit.", 404);
    return { contact_id: id, name: "Sara" };
  };
  return {
    notes,
    audits,
    calls,
    deps: { svc, audit, cockpitLead },
    raceNext(f: () => void) {
      beforeInsert = f;
    },
  };
}

const body = (over: Row = {}): Row => ({
  contact_id: "lead-1",
  call_id: CALL,
  script: "intro",
  lang: "en",
  version: 4,
  body: "Intro call notes\nFor the closer: villas only",
  fields: {
    values: { project_value: "85k", pain: "Not enough leads", empty: " " },
    notes: { "3": "Wants villas only", "6": "villas only", "2": "" },
    checklist: { "3.0": true },
    stage_reached: 3,
  },
  ...over,
});

async function refusal(p: Promise<unknown>): Promise<ApiRefusal> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiRefusal) return e;
    throw e;
  }
  throw new Error("expected a refusal");
}

let db: ReturnType<typeof fakeDb>;
let save: (who: Who, b: Row) => Promise<Row>;
beforeEach(() => {
  db = fakeDb();
  save = makeScriptNotes(db.deps).actions["script.save"];
});

describe("script.save: one row per call", () => {
  test("the first save makes the row as the rep's, with the call's id", async () => {
    const out = await save(SETTER, body());
    expect(db.notes).toHaveLength(1);
    const row = db.notes[0];
    expect(row).toMatchObject({ contact_id: "lead-1", kind: "script", call_id: CALL, author: SETTER.email });
    expect((row.fields as Row).script).toBe("intro");
    expect((row.fields as Row).lang).toBe("en");
    expect((row.fields as Row).final).toBe(false);
    expect(out).toEqual({ note: { id: "n1", updated_at: "2026-10-10T10:00:00Z" } });
  });

  test("a save sent again updates the same row, never a second", async () => {
    await save(SETTER, body());
    await save(SETTER, body({ body: "Intro call notes\nNotes by part\n3. Understand current state: two villas", appointment_id: "appt-9" }));
    expect(db.notes).toHaveLength(1);
    expect(db.notes[0].body).toContain("two villas");
    expect(db.notes[0].appointment_id).toBe("appt-9");
    expect(typeof db.notes[0].updated_at).toBe("string");
  });

  test("an appointment left out on a later save keeps the one already on the row", async () => {
    await save(SETTER, body({ appointment_id: "appt-1" }));
    await save(SETTER, body());
    expect(db.notes[0].appointment_id).toBe("appt-1");
  });

  test("two saves at once: the one that loses the insert updates the winner's row", async () => {
    db.raceNext(() => {
      db.notes.push({ id: "rival", contact_id: "lead-1", call_id: CALL, kind: "script", author: SETTER.email, body: "first", fields: {}, deleted_at: null });
    });
    const out = await save(SETTER, body());
    expect(db.notes).toHaveLength(1);
    expect(out.note).toMatchObject({ id: "rival" });
    expect(db.notes[0].body).toContain("villas only");
  });

  test("a final save is marked final, and another call of the same lead is a new row", async () => {
    await save(SETTER, body({ final: true }));
    expect((db.notes[0].fields as Row).final).toBe(true);
    await save(SETTER, body({ call_id: "9a1d7a1e-0000-4000-8000-000000000001" }));
    expect(db.notes).toHaveLength(2);
  });
});

describe("script.save: who may write", () => {
  test("another rep cannot write over the setter's call", async () => {
    await save(SETTER, body());
    const e = await refusal(save(CLOSER, body({ body: "Intro call notes\nmine now" })));
    expect(e.status).toBe(403);
    expect(e.message).toBe("These are another rep's call notes. Start your own call to write yours.");
    expect(db.notes[0].body).toContain("villas only");
  });

  test("a manager may", async () => {
    await save(SETTER, body());
    await save(MANAGER, body({ body: "Intro call notes\nfixed a typo" }));
    expect(db.notes[0].body).toContain("fixed a typo");
    expect(db.notes[0].author).toBe(SETTER.email);
  });

  test("a deleted call's notes are not written into: a 409 with its code", async () => {
    await save(SETTER, body());
    db.notes[0].deleted_at = "2026-10-10T11:00:00Z";
    const e = await refusal(save(SETTER, body()));
    expect(e.status).toBe(409);
    expect(e.extra.code).toBe("deleted");
  });

  test("a lead not in the cockpit", async () => {
    const e = await refusal(save(SETTER, body({ contact_id: "lead-x" })));
    expect(e.status).toBe(404);
    expect(db.notes).toHaveLength(0);
  });
});

describe("script.save: what it refuses before writing", () => {
  test("a call id that is not a uuid", async () => {
    for (const id of ["", "call-1", "3f0c9a52-6a1b-4c1e-9d55-0d6a2f1b7c1", `${CALL}x`, null]) {
      const e = await refusal(save(SETTER, body({ call_id: id })));
      expect(e.status).toBe(400);
    }
    expect(db.calls).toHaveLength(0);
  });

  test("an unknown script, an empty body, fields that are not an object", async () => {
    expect((await refusal(save(SETTER, body({ script: "pitch" })))).status).toBe(400);
    expect((await refusal(save(SETTER, body({ body: "   " })))).status).toBe(400);
    expect((await refusal(save(SETTER, body({ fields: [1, 2] })))).status).toBe(400);
    expect((await refusal(save(SETTER, body({ fields: { notes: "x" } })))).status).toBe(400);
    expect(db.notes).toHaveLength(0);
  });

  test("the size caps: body, one part's notes, all the fields", async () => {
    const words = "These notes are too long to save. Shorten the longest part's notes.";
    const long = (n: number) => "x".repeat(n);
    const e1 = await refusal(save(SETTER, body({ body: long(SCRIPT_NOTE_LIMITS.body + 1) })));
    expect(e1.message).toBe(words);
    const e2 = await refusal(save(SETTER, body({ fields: { notes: { "3": long(SCRIPT_NOTE_LIMITS.part + 1) } } })));
    expect(e2.message).toBe(words);
    const e3 = await refusal(
      save(SETTER, body({ fields: { notes: { "1": long(3_900), "2": long(3_900), "3": long(3_900), "4": long(3_900), "5": long(3_900), "6": long(3_900), "7": long(3_900), "8": long(3_900) } } })),
    );
    expect(e3.message).toBe(words);
    expect(db.notes).toHaveLength(0);
    // Right at the caps is fine.
    await save(SETTER, body({ body: long(SCRIPT_NOTE_LIMITS.body), fields: { notes: { "3": long(SCRIPT_NOTE_LIMITS.part) } } }));
    expect(db.notes).toHaveLength(1);
  });
});

describe("script.save: the audit row", () => {
  test("every save writes one, compact: counts, never the notes themselves", async () => {
    await save(SETTER, body());
    await save(SETTER, body({ final: true }));
    expect(db.audits).toHaveLength(2);
    const [first, second] = db.audits;
    expect(first).toMatchObject({ actor: SETTER.email, action: "script.save", entityType: "cockpit_sales_notes", entityId: "n1" });
    expect(first.after).toEqual({ id: "n1", stage_reached: 3, filled: 2, notes_parts: 2, body_chars: body().body.length });
    expect(first.metadata).toEqual({ call_id: CALL, final: false, made: true });
    expect(second.metadata).toEqual({ call_id: CALL, final: true, made: false });
    expect(JSON.stringify(db.audits)).not.toContain("villas");
  });
});

describe("bookingUrl", () => {
  test("the calendar's slug when HighLevel gives one", () => {
    expect(bookingUrl("jQqXS1YuFnmGZKLkrE62", { widgetSlug: "mahara-demo" })).toBe(
      "https://api.leadconnectorhq.com/widget/bookings/mahara-demo",
    );
  });
  test("else the calendar's id", () => {
    expect(bookingUrl("jQqXS1YuFnmGZKLkrE62", {})).toBe("https://api.leadconnectorhq.com/widget/booking/jQqXS1YuFnmGZKLkrE62");
    expect(bookingUrl("jQqXS1YuFnmGZKLkrE62", { widgetSlug: "  " })).toBe(
      "https://api.leadconnectorhq.com/widget/booking/jQqXS1YuFnmGZKLkrE62",
    );
  });
  test("none for a calendar switched off, or a slug or id that is not one", () => {
    expect(bookingUrl("jQqXS1YuFnmGZKLkrE62", { isActive: false, widgetSlug: "mahara-demo" })).toBeNull();
    expect(bookingUrl("../x", { widgetSlug: "a/b" })).toBeNull();
    expect(bookingUrl("abc", { widgetSlug: "a b" })).toBe("https://api.leadconnectorhq.com/widget/booking/abc");
  });
});
