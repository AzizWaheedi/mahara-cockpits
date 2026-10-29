import { describe, expect, it } from "bun:test";
import {
  NOTE_REF,
  STORE_SQL,
  cadenceInputs,
  checkinTaskId,
  commitmentsOf,
  noteOf,
  notesParity,
  stampMs,
  storedAnswers,
  typeformAnswers,
  type NoteMark,
  type StoredNote,
  type TypeformNote,
} from "./csmProviders";
import { withNativeContext, type Reads, type Row } from "./runtime";

const TYPED = "c484f390-9695-4ffa-9693-9cc219592713";
const form = (hidden: Record<string, string> | undefined, typed?: string) => ({
  submitted_at: "2026-10-12T09:00:00Z",
  ...(hidden ? { hidden } : {}),
  answers: typed === undefined ? [] : [{ type: "text", text: typed, field: { ref: TYPED } }],
});

describe("the 1-1 form's client", () => {
  it("the link's hidden task_id comes before the typed Client ID", () => {
    expect(checkinTaskId(form({ task_id: "86eyt1d33" }, "86ewvnqh5"))).toBe("86eyt1d33");
    expect(checkinTaskId(form({ task_id: " 86eyt1d33 " }))).toBe("86eyt1d33");
  });

  it("a blank or missing hidden task_id falls back to the typed Client ID", () => {
    for (const hidden of [undefined, {}, { task_id: "" }, { task_id: "  " }] as (Record<string, string> | undefined)[])
      expect(checkinTaskId(form(hidden, " 86ewvnqh5 "))).toBe("86ewvnqh5");
  });

  it("neither gives an empty id", () => {
    expect(checkinTaskId(form(undefined))).toBe("");
    expect(checkinTaskId({})).toBe("");
  });

  it("given the client cards, a hidden id that is not a card gives way to the typed one, as in csm-calls", () => {
    const cards = new Set(["86eyt1d33", "86ewvnqh5"]);
    expect(checkinTaskId(form({ task_id: "xxxxx" }, "86ewvnqh5"), cards)).toBe("86ewvnqh5");
    expect(checkinTaskId(form({ task_id: "86eyt1d33" }, "86ewvnqh5"), cards)).toBe("86eyt1d33");
    expect(checkinTaskId(form({ task_id: "xxxxx" }, ""), cards)).toBe("xxxxx");
    expect(checkinTaskId(form({ task_id: "" }, "86ewvnqh5"), cards)).toBe("86ewvnqh5");
  });

  it("without the client cards there is no roster check, so any non-blank hidden id wins", () => {
    expect(checkinTaskId(form({ task_id: "xxxxx" }, "86ewvnqh5"))).toBe("xxxxx");
  });
});

// ---- release N4: the 1-1 notes from the store (docs/forms/STAGE2B-CONTRACT.md 4.4) -------------------------

const NOW = Date.parse("2026-10-29T12:00:00Z");
const ADDITIONAL = NOTE_REF.additional;
const CLIENT_NOTES = NOTE_REF.clientNotes;
const DEFCON = NOTE_REF.defcon;
const PRIORITY = NOTE_REF.priority;

type Note = { additional?: string; clientNotes?: string; defcon?: string; priority?: string };

/** A Typeform API item, as Typeform answers it. */
function typeformItem(token: string, taskId: string, at: string, n: Note = {}): Row {
  const answers: Row[] = [{ type: "text", text: taskId, field: { ref: TYPED, type: "short_text" } }];
  if (n.additional !== undefined) answers.push({ type: "text", text: n.additional, field: { ref: ADDITIONAL, type: "long_text" } });
  if (n.clientNotes !== undefined) answers.push({ type: "text", text: n.clientNotes, field: { ref: CLIENT_NOTES, type: "long_text" } });
  if (n.defcon !== undefined) answers.push({ type: "choice", choice: { label: n.defcon }, field: { ref: DEFCON, type: "multiple_choice" } });
  if (n.priority !== undefined) answers.push({ type: "choice", choice: { label: n.priority }, field: { ref: PRIORITY, type: "multiple_choice" } });
  return { token, submitted_at: at, answers };
}

/** The stored row hermes/csm-calls writes for that item (formAnswers: ref, field type, title, one value). */
function storedRow(item: Row, extra: Row = {}): Row {
  const answers = (item.answers as Row[]).map(a => ({
    ref: a.field.ref,
    type: a.field.type,
    title: null,
    value: a.type === "choice" ? a.choice.label : a.text,
  }));
  const taskId = String((item.answers as Row[]).find(a => a.field.ref === TYPED)?.text ?? "");
  // The read-only SQL door answers a timestamptz in Postgres's own text form.
  const pg = new Date(Date.parse(item.submitted_at) + 3 * 3600000).toISOString().replace("T", " ").replace(/\.\d+Z$/, "+03");
  return { task_id: taskId, token: item.token, form_id: "fRokTITH", matched_by: "typed_task_id", submitted_at: pg, answers, ...extra };
}

/** A native write-through row (20261027h cockpit_form_checkin_legacy), form_id cockpit-checkin. */
function nativeRow(token: string, taskId: string, at: string, lines: string, defcon = "Happy", priority = "High"): Row {
  return {
    task_id: taskId,
    token,
    form_id: "cockpit-checkin",
    matched_by: "cockpit_form",
    submitted_at: at,
    answers: [
      { ref: TYPED, type: "short_text", title: "Client ID", value: taskId },
      { ref: ADDITIONAL, type: "long_text", title: "Additional Notes", value: lines },
      { ref: DEFCON, type: "multiple_choice", title: "Defcon Status", value: defcon },
      { ref: PRIORITY, type: "multiple_choice", title: "Task Priority", value: priority },
    ],
  };
}

type Fixture = {
  provider?: string;
  stored?: Row[];
  marks?: Row[];
  checkins?: Row[];
  extensions?: Row[];
  fail?: "registry" | "newest" | "marks" | "typeform";
};

function reads(f: Fixture) {
  const sql: string[] = [];
  const forms: string[] = [];
  const r: Reads = {
    tool: async (name, args) => {
      if (name === "mcp_supabase_execute_sql") {
        const query = String(args.query);
        sql.push(query);
        if (query === STORE_SQL.registry) {
          if (f.fail === "registry") throw new Error("SQL source missing or reached its coverage limit");
          return { result: JSON.stringify(f.provider === undefined ? [{ provider: "typeform" }] : f.provider === "" ? [] : [{ provider: f.provider }]) };
        }
        if (query === STORE_SQL.newest) {
          if (f.fail === "newest") throw new Error("SQL source missing or reached its coverage limit");
          return { result: JSON.stringify(f.stored ?? []) };
        }
        if (query === STORE_SQL.marks) {
          if (f.fail === "marks") throw new Error("SQL source missing or reached its coverage limit");
          return { result: JSON.stringify(f.marks ?? []) };
        }
        throw new Error(`Unexpected SQL ${query}`);
      }
      if (name === "pd_typeform_proxy_get") {
        const id = /forms\/([^/]+)\/responses/.exec(String(args.url))?.[1] ?? "";
        forms.push(id);
        if (id === "fRokTITH") {
          if (f.fail === "typeform") throw new Error("Typeform read failed");
          return { items: f.checkins ?? [], total_items: (f.checkins ?? []).length };
        }
        if (id === "gqBcyK6g") return { items: f.extensions ?? [], total_items: (f.extensions ?? []).length };
      }
      throw new Error(`Unexpected tool ${name}`);
    },
    graph: async () => ({ data: [] }),
    fetch: async () => new Response("{}"),
    log: () => {},
  };
  return { r, sql, forms };
}

const run = (f: Fixture, cards?: ReadonlySet<string>) => {
  const fx = reads(f);
  return withNativeContext(fx.r, { receipts: [] }, () => cadenceInputs(cards, NOW)).then(out => ({ ...out, ...fx }));
};

const A = "86eyt1d33";
const B = "86ewvnqh5";
const EARLIER = "2026-10-28T09:00:00Z";

describe("release N4: the 1-1 notes come from the store", () => {
  it("the notes are the store's newest per card, and Typeform's items are not notes", async () => {
    const item = typeformItem("tok-a", A, EARLIER, { defcon: "Happy", priority: "High", additional: "Send the new creative by Thursday afternoon" });
    const onlyInTypeform = typeformItem("tok-b", B, EARLIER, { defcon: "At Risk", priority: "911" });
    const { notes, parity } = await run({ stored: [storedRow(item)], checkins: [item, onlyInTypeform] });
    expect(notes).toEqual([
      { taskId: A, submitted: "2026-10-28", notes: ["Send the new creative by Thursday afternoon"], defcon: "Happy", priority: "High" },
    ]);
    expect(parity.native).toBe(false);
    expect(parity.byTask[A]).toEqual({ state: "same" });
    expect(parity.byTask[B]).toEqual({ state: "differs", fields: ["lastNoteOn", "defcon", "priority"] });
  });

  it("every query starts select and carries no limit, so the transport's coverage cap never trims a client", async () => {
    const { sql } = await run({});
    expect(sql.sort()).toEqual(Object.values(STORE_SQL).sort());
    for (const q of sql) {
      expect(q).toMatch(/^select\b/);
      expect(q).not.toMatch(/\blimit\s+\d+/i);
    }
  });

  it("a failing store select throws, so the cycle publishes nothing rather than notes from nowhere", async () => {
    for (const fail of ["registry", "newest", "marks", "typeform"] as const)
      await expect(run({ fail })).rejects.toThrow();
    await expect(run({ provider: "" })).rejects.toThrow(/registry row/);
    await expect(run({ stored: [{ task_id: A, token: "x", form_id: "fRokTITH", submitted_at: "not a time", answers: [] }] })).rejects.toThrow(
      /lacks its card, token, time or answers/,
    );
  });

  it("the extensions still come from gqBcyK6g, as before", async () => {
    const ext = {
      token: "e1",
      submitted_at: "2026-10-20T09:00:00Z",
      answers: [
        { type: "text", text: "City Wood", field: { ref: "5145ff0c-009b-4f51-b3a9-4651efc908be" } },
        { type: "choice", choice: { label: "2 Weeks" }, field: { ref: "278c2f80-88bd-428e-b330-8c6b3175d63f" } },
      ],
    };
    const { exts } = await run({ extensions: [ext] });
    expect(exts).toEqual([{ client: "City Wood", until: "2026-11-03" }]);
  });

  it("when the registry says native, fRokTITH is not read and every reading is off", async () => {
    const native = nativeRow("cockpit-1", A, "2026-10-29 14:00:00+03", "Mahara: Book the shoot - Friday");
    const { forms, parity, notes } = await run({ provider: "native", stored: [native], checkins: [typeformItem("t", A, EARLIER)] });
    expect(forms).toEqual(["gqBcyK6g"]);
    expect(parity).toEqual({ native: true, byTask: {} });
    expect(notes[0].notes).toEqual(["Book the shoot - Friday"]);
  });
});

describe("one commitments rule for Typeform and the store", () => {
  it("a Typeform item and its stored row give identical notes, Arabic included", () => {
    const additional = "1. بنرسل التصاميم اليديدة حق العميل يوم الخميس\n- Update the landing page headline - and the form\n• done\n• العميل بيراجع الإعلانات ويرسل لنا ملاحظاته";
    const item = typeformItem("tok-ar", A, EARLIER, {
      additional,
      clientNotes: "العميل مرتاح بس خايف من ميزانية الشهر الياي",
      defcon: "Neutral",
      priority: "Medium",
    });
    const fromTypeform = noteOf(A, Date.parse(EARLIER), typeformAnswers(item));
    const row = storedRow(item);
    const fromStore = noteOf(A, stampMs(row.submitted_at), storedAnswers(row.answers));
    expect(fromStore).toEqual(fromTypeform);
    expect(fromTypeform.notes).toEqual([
      "بنرسل التصاميم اليديدة حق العميل يوم الخميس",
      "Update the landing page headline",
      "العميل بيراجع الإعلانات ويرسل لنا ملاحظاته",
      "العميل مرتاح بس خايف من ميزانية الشهر الياي",
    ]);
  });

  it("a native row's We owe items stay whole, without their label, at most four, and its They owe lines are not ours", () => {
    const lines = [
      "Mahara: Send the revised offer - with the new price, before Sunday",
      "Mahara: Fix it",
      "Mahara: Call the client's designer about the logo files",
      "Mahara: بنرسل التقرير الأسبوعي باجر",
      "Mahara: Fifth item stays out",
      "Client: Approve the script by Tuesday",
    ].join("\n");
    expect(commitmentsOf(storedAnswers(nativeRow("n", A, EARLIER, lines).answers), true)).toEqual([
      "Send the revised offer - with the new price, before Sunday",
      "Fix it",
      "Call the client's designer about the logo files",
      "بنرسل التقرير الأسبوعي باجر",
    ]);
  });

  it("reads Postgres and ISO times alike", () => {
    expect(stampMs("2026-10-27 15:40:20+03")).toBe(Date.parse("2026-10-27T12:40:20Z"));
    expect(stampMs("2026-10-27 12:40:20.123456+00")).toBe(Date.parse("2026-10-27T12:40:20.123Z"));
    expect(stampMs("2026-10-27T12:40:20+05:30")).toBe(Date.parse("2026-10-27T07:10:20Z"));
    expect(stampMs("2026-10-27T12:40:20Z")).toBe(Date.parse("2026-10-27T12:40:20Z"));
    expect(Number.isNaN(stampMs("yesterday"))).toBe(true);
    expect(Number.isNaN(stampMs(null))).toBe(true);
  });
});

describe("store against Typeform, per card", () => {
  const at = (iso: string) => Date.parse(iso);
  const stored = (taskId: string, token: string, iso: string, more: Partial<StoredNote> = {}): StoredNote => ({
    taskId,
    token,
    submitted: iso.slice(0, 10),
    notes: [],
    defcon: "Happy",
    priority: "High",
    formId: "fRokTITH",
    matchedBy: "typed_task_id",
    submittedAt: at(iso),
    ...more,
  });
  const typed = (taskId: string, token: string, iso: string, more: Partial<TypeformNote> = {}): TypeformNote => ({
    taskId,
    token,
    submitted: iso.slice(0, 10),
    notes: [],
    defcon: "Happy",
    priority: "High",
    submittedAt: at(iso),
    ...more,
  });

  it("equal tokens and fields read same; equal tokens with other fields differ, naming them", () => {
    expect(notesParity([stored(A, "t1", EARLIER)], [typed(A, "t1", EARLIER)], [], NOW)[A]).toEqual({ state: "same" });
    expect(notesParity([stored(A, "t1", EARLIER)], [typed(A, "t1", EARLIER, { defcon: "At Risk", notes: ["x"] })], [], NOW)[A]).toEqual({
      state: "differs",
      fields: ["defcon", "notes"],
    });
  });

  it("a Typeform note under 30 minutes old that the store does not hold yet is explained by timing", () => {
    const fresh = new Date(NOW - 29 * 60000).toISOString();
    const old = new Date(NOW - 31 * 60000).toISOString();
    expect(notesParity([stored(A, "t1", EARLIER)], [typed(A, "t2", fresh)], [], NOW)[A]).toEqual({ state: "explained", why: "fresh" });
    expect(notesParity([], [typed(A, "t2", fresh)], [], NOW)[A]).toEqual({ state: "explained", why: "fresh" });
    expect(notesParity([stored(A, "t1", EARLIER)], [typed(A, "t2", old)], [], NOW)[A]).toEqual({
      state: "differs",
      fields: ["lastNoteOn"],
    });
  });

  it("a hand match explains it either way round", () => {
    // The store's newest is a form a person placed on this card.
    expect(notesParity([stored(A, "t1", "2026-10-28T10:00:00Z", { matchedBy: "manual" })], [typed(A, "t0", EARLIER)], [], NOW)[A]).toEqual({
      state: "explained",
      why: "manual",
    });
    // Typeform's newest for this card was placed by a person on another card.
    const marks: NoteMark[] = [{ token: "t2", taskId: B, formKind: "checkin", matchedBy: "manual" }];
    expect(notesParity([stored(A, "t1", EARLIER)], [typed(A, "t2", "2026-10-28T10:00:00Z")], marks, NOW)[A]).toEqual({
      state: "explained",
      why: "manual",
    });
  });

  it("a native store row and a form the cut-over made late are explained", () => {
    expect(notesParity([stored(A, "c1", "2026-10-28T10:00:00Z", { formId: "cockpit-checkin" })], [typed(A, "t0", EARLIER)], [], NOW)[A]).toEqual({
      state: "explained",
      why: "native",
    });
    const marks: NoteMark[] = [{ token: "late", taskId: A, formKind: "checkin_late", matchedBy: "typed_task_id" }];
    expect(notesParity([stored(A, "t1", EARLIER)], [typed(A, "late", "2026-10-28T10:00:00Z")], marks, NOW)[A]).toEqual({
      state: "explained",
      why: "late",
    });
  });

  it("a store row newer than Typeform's with no reason differs; a card on neither side has no reading", () => {
    expect(notesParity([stored(A, "t9", "2026-10-28T10:00:00Z")], [typed(A, "t0", EARLIER)], [], NOW)[A]).toEqual({
      state: "differs",
      fields: [],
    });
    expect(notesParity([stored(A, "t9", EARLIER)], [], [], NOW)[A]).toEqual({
      state: "differs",
      fields: ["lastNoteOn", "defcon", "priority"],
    });
    expect(notesParity([], [], [], NOW)[A]).toBeUndefined();
  });

  it("Typeform's newest per card is compared, whatever the order of the items", () => {
    const items = [typed(A, "t0", EARLIER), typed(A, "t1", "2026-10-28T10:00:00Z")];
    expect(notesParity([stored(A, "t1", "2026-10-28T10:00:00Z")], items, [], NOW)[A]).toEqual({ state: "same" });
    expect(notesParity([stored(A, "t1", "2026-10-28T10:00:00Z")], items.reverse(), [], NOW)[A]).toEqual({ state: "same" });
  });

  it("a form opened from the client page with no typed id is compared on the link's card", async () => {
    const item = { ...typeformItem("tok-h", "", EARLIER), hidden: { task_id: A } };
    const { parity } = await run({ checkins: [item, typeformItem("tok-none", "", EARLIER)] });
    expect(Object.keys(parity.byTask)).toEqual([A]);
  });

  it("given the client cards, a stale link's form is compared on the typed client", async () => {
    const item = { ...typeformItem("tok-s", B, EARLIER), hidden: { task_id: "xxxxx" } };
    const { parity } = await run({ checkins: [item] }, new Set([B]));
    expect(Object.keys(parity.byTask)).toEqual([B]);
  });
});
