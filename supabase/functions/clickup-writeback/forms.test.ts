// The 1-1 notes writer (forms.ts; docs/forms/STAGE2B-CONTRACT.md build 1). A fake
// Clients - Mahara list answers the ClickUp v2 paths the writer uses, the way
// ClickUp does where it matters: a dropdown reads back as its orderindex, a
// date-only value is kept at ClickUp's own hour (03:00Z or 04:00Z on the
// day), comments page 25 at a time, newest first. Every client, card and
// comment here is invented; the field and option ids are ClickUp's own
// (20261027h_checkin_plans.sql), no secret.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  cardRefused,
  checkToken,
  executeForm,
  FORM_FIELDS,
  FORM_KEYS,
  FORMS_LIST,
  FORMS_NOT_A_CARD,
  type FormItem,
  type FormStep,
  formMarker,
  formStep,
  formsDb,
  formsDoctorChecks,
  formsGate,
  formsWords,
  frozenStep,
  HAPPINESS_OPTIONS,
  planForm,
  SAY_FORMS,
  sha256,
  shortDay,
} from "./forms.ts";
import type { Provider } from "./queue.ts";
import { kuwaitDay, noonKuwait } from "./requests.ts";
import type { Row } from "./rules.ts";

const NOW = Date.parse("2026-10-29T09:00:00Z"); // Thursday 29 Oct 2026, 12:00 Kuwait
const CARDS_LIST = "901816559981";
const CARD = "86card0001";
const OFF_LIST = "86other001";
const RESPONSE = "5b1e2c3d-4f50-4a61-8b72-9c83d4e5f601";
const MARKER = "Cockpit ref F-5b1e2c3d4f";
const COMMENT =
  "*1-1 notes, 25 Oct*\nMahara: Send the invented plan\nClient: Share the invented files\nسنرسل الخطة";
const HAPPY = HAPPINESS_OPTIONS.Happy;

type Call = { method: string; path: string; body?: Row };
const rejected = (status: number) =>
  new Error(
    `clickup rejected the request (${status}). Inspect the provider receipt.`,
  );

/** A fake Clients - Mahara list: one client card, one card on another list, the three fields. */
class FakeCards {
  calls: Call[] = [];
  comments: Row[] = [];
  /** ClickUp's hour for a date-only value it keeps (03:00Z or 04:00Z). */
  storeHour = 3;
  /** Answer this call with an error before ClickUp does anything. */
  fail?: (c: Call) => Error | undefined;
  /** A field POST ClickUp answers 200 for and never keeps. */
  drop = false;
  /** Another writer's day lands between our read and our write (the Next POC sync). */
  raceDay?: string;
  private seq = 0;
  fields: Row[] = [
    {
      id: FORM_FIELDS.happiness,
      name: "Client Happiness",
      type: "drop_down",
      type_config: {
        options: Object.entries(HAPPINESS_OPTIONS).map(
          ([name, id], orderindex) => ({ id, name, orderindex }),
        ),
      },
    },
    {
      id: FORM_FIELDS.last_poc,
      name: "Last POC",
      type: "date",
      type_config: {},
    },
    {
      id: FORM_FIELDS.last_checkin_call,
      name: "Last Check-in Call",
      type: "date",
      type_config: {},
    },
  ];
  values = new Map<string, unknown>();
  cardList = CARDS_LIST;

  provider(): Provider {
    return {
      call: async (_p, method, path, body) =>
        this.handle({ method, path, body }),
    };
  }
  writes() {
    return this.calls.filter(c => c.method !== "GET");
  }
  /** Seed `n` older comments, oldest first, the newest at `endMs`. */
  addComments(n: number, endMs: number) {
    for (let i = n - 1; i >= 0; i--)
      this.comments.push({
        id: `old${++this.seq}`,
        comment_text: `Older note ${i}`,
        date: String(endMs - i * 1000),
      });
  }
  setDay(fieldId: string, day: string, hour = this.storeHour) {
    this.values.set(fieldId, String(Date.parse(`${day}T0${hour}:00:00Z`)));
  }
  private task(id: string): Row {
    if (id !== CARD && id !== OFF_LIST) throw rejected(404);
    return {
      id,
      name: id === CARD ? "Acme Interiors" : "Another card",
      list: { id: id === CARD ? this.cardList : "901800000099" },
      custom_fields: this.fields.map(f => ({
        ...structuredClone(f),
        value: this.values.get(f.id),
      })),
    };
  }
  async handle(c: Call): Promise<Row> {
    this.calls.push(structuredClone(c));
    const failure = this.fail?.(c);
    if (failure) throw failure;
    const [base, qs = ""] = c.path.split("?");
    const parts = base.split("/");
    if (c.method === "GET" && /^list\/\d+\/field$/.test(base))
      return { fields: structuredClone(this.fields) };
    if (c.method === "GET" && /^task\/[^/]+$/.test(base)) {
      const t = this.task(parts[1]);
      if (this.raceDay) {
        // The race: after our read, another writer sets a newer day.
        const day = this.raceDay;
        this.raceDay = undefined;
        queueMicrotask(() => this.setDay(FORM_FIELDS.last_poc, day));
      }
      return t;
    }
    if (c.method === "POST" && /^task\/[^/]+\/field\/[^/]+$/.test(base)) {
      this.task(parts[1]);
      const f = this.fields.find(x => x.id === parts[3]);
      if (!f) throw rejected(400);
      if (this.drop) return {};
      if (f.type === "drop_down") {
        const opt = f.type_config.options.find(
          (o: Row) => o.id === c.body?.value,
        );
        if (!opt) throw rejected(400);
        this.values.set(f.id, opt.orderindex);
      } else {
        // ClickUp keeps a date-only value at its own hour on the London date of the value.
        const day = new Date(Number(c.body?.value)).toISOString().slice(0, 10);
        this.setDay(f.id, day);
      }
      return {};
    }
    if (c.method === "POST" && /^task\/[^/]+\/comment$/.test(base)) {
      this.task(parts[1]);
      const at = Math.max(NOW, ...this.comments.map(x => Number(x.date) + 1));
      const cm = {
        id: `90cm${++this.seq}`,
        comment_text: String(c.body?.comment_text),
        date: String(at),
      };
      this.comments.push(cm);
      return { id: cm.id, hist_id: `h-${cm.id}`, date: at };
    }
    if (c.method === "GET" && /^task\/[^/]+\/comment$/.test(base)) {
      this.task(parts[1]);
      const newestFirst = [...this.comments].sort(
        (a, b) => Number(b.date) - Number(a.date),
      );
      const startId = new URLSearchParams(qs).get("start_id");
      const from = startId
        ? newestFirst.findIndex(x => x.id === startId) + 1
        : 0;
      return { comments: structuredClone(newestFirst.slice(from, from + 25)) };
    }
    throw rejected(404);
  }
}

/** A queue row as cockpit_clickup_writeback_claim_forms returns it (3.3), with its effect. */
async function item(
  key: (typeof FORM_KEYS)[number],
  over: {
    plan?: Row;
    payload?: Row;
    task?: string;
    progress?: Row;
    steps?: FormStep[];
  } = {},
): Promise<FormItem> {
  const task = over.task ?? CARD;
  const base: Record<string, Row> = {
    todo_comment: {
      taskId: task,
      comment_text: COMMENT,
      notify_all: false,
      items: 2,
      sides: { ours: 1, theirs: 1 },
    },
    happiness: {
      taskId: task,
      field: FORM_FIELDS.happiness,
      label: "Happy",
      value: HAPPY,
    },
    last_poc: {
      taskId: task,
      field: FORM_FIELDS.last_poc,
      day: "2026-10-25",
      value: noonKuwait("2026-10-25"),
      value_options: { time: false },
      rule: "forward_only",
    },
    last_checkin_call: {
      taskId: task,
      field: FORM_FIELDS.last_checkin_call,
      day: "2026-10-24",
      value: noonKuwait("2026-10-24"),
      value_options: { time: false },
      rule: "forward_only",
    },
  };
  const plan = { ...base[key], ...(over.plan ?? {}) };
  const { comment_text, ...rest } = plan;
  return {
    id: `q-${key}`,
    kind: "form",
    attempts: 1,
    created_at: new Date(NOW - 5 * 60_000).toISOString(),
    task_id: task,
    steps: over.steps ?? null,
    progress: over.progress ?? {},
    payload: {
      formKey: "checkin",
      responseId: RESPONSE,
      effectId: `e-${key}`,
      effectKey: key,
      taskId: task,
      clientName: "Acme Interiors",
      ...rest,
      ...(typeof comment_text === "string"
        ? {
            commentChars: comment_text.length,
            commentSha256: await sha256(comment_text),
          }
        : {}),
      ...(over.payload ?? {}),
    },
    effect: { id: `e-${key}`, state: "queued", plan },
  };
}

/** Run one row end to end: check, freeze, execute; every progress save kept. */
async function run(cards: FakeCards, it: FormItem, now = () => NOW) {
  const checked = await formStep(it);
  if ("fail" in checked) throw new Error(checked.fail);
  const step = frozenStep(it, checked.step);
  if (!step) throw new Error("frozen step mismatch");
  const saves: Row[] = [];
  const out = await executeForm(
    it,
    step,
    cards.provider(),
    async patch => {
      saves.push(structuredClone(patch));
    },
    now,
  );
  return { out, saves, step };
}

describe("the forms switch", () => {
  it("opens only on CLICKUP_WRITEBACK_APPLY_FORMS exactly 'true'; no other switch opens it", () => {
    for (const v of [
      undefined,
      "",
      "TRUE",
      "True",
      " true",
      "true ",
      "1",
      "yes",
    ])
      expect(
        formsGate(k => (k === "CLICKUP_WRITEBACK_APPLY_FORMS" ? v : undefined))
          .apply,
      ).toBe(false);
    const others = {
      CLICKUP_WRITEBACK_APPLY: "true",
      CLICKUP_WRITEBACK_APPLY_REQUESTS: "true",
      CLICKUP_WRITEBACK_APPLY_CSM_TICKETS: "true",
      CLICKUP_WRITEBACK_APPLY_KPI: "true",
    };
    expect(formsGate(k => (others as Row)[k])).toMatchObject({
      apply: false,
      mode: "dry_run",
    });
    expect(
      formsGate(k =>
        k === "CLICKUP_WRITEBACK_APPLY_FORMS" ? "true" : undefined,
      ),
    ).toMatchObject({ apply: true, mode: "apply" });
  });

  it("the canary narrows a live run to its cards, and ONLY_TASKS does not narrow it", () => {
    const limited = formsGate(
      k =>
        ({
          CLICKUP_WRITEBACK_APPLY_FORMS: "true",
          CLICKUP_WRITEBACK_FORMS_ONLY_CARDS: "86eywg1cq, ",
        })[k],
    );
    expect(limited.mode).toBe("apply_limited");
    expect([
      limited.live("86eywg1cq"),
      limited.live(CARD),
      limited.live(null),
    ]).toEqual([true, false, false]);
    const open = formsGate(
      k =>
        ({
          CLICKUP_WRITEBACK_APPLY_FORMS: "true",
          CLICKUP_WRITEBACK_ONLY_TASKS: "86eywg1cq",
        })[k],
    );
    expect(open.mode).toBe("apply");
    expect(
      formsWords(
        k =>
          ({
            CLICKUP_WRITEBACK_APPLY_FORMS: "true",
            CLICKUP_WRITEBACK_FORMS_ONLY_CARDS: "86eywg1cq",
          })[k],
      ).text,
    ).toBe(
      "apply_limited to the cards 86eywg1cq (CLICKUP_WRITEBACK_FORMS_ONLY_CARDS)",
    );
    expect(formsWords(() => undefined).text).toBe(
      "dry run (they are written only when CLICKUP_WRITEBACK_APPLY_FORMS is true)",
    );
  });

  it("a card list that cannot be read keeps the writer off and never opens every card", () => {
    const secret =
      (cards: string, apply = "true") =>
      (k: string) =>
        (
          ({
            CLICKUP_WRITEBACK_APPLY_FORMS: apply,
            CLICKUP_WRITEBACK_FORMS_ONLY_CARDS: cards,
          }) as Row
        )[k];
    // The separators alone read as no list before the fix, so as every card; the others read as apply_limited.
    for (const cards of [
      ",",
      " , ,",
      " ",
      "\t",
      "taskA1;taskB1",
      "86eywg1cq,bad id",
      "86eywg1cq, ../task",
      `86eywg1cq,${"a".repeat(41)}`,
    ]) {
      const g = formsGate(secret(cards));
      expect([cards, g.apply, g.mode, g.error, [...g.onlyCards]]).toEqual([
        cards,
        false,
        "dry_run",
        FORMS_NOT_A_CARD,
        [],
      ]);
      expect([
        g.live("86eywg1cq"),
        g.live(CARD),
        g.live("taskB1"),
        g.live(null),
      ]).toEqual([false, false, false, false]);
      const words = formsWords(secret(cards));
      expect(words).toMatchObject({
        mode: "dry_run",
        cards: [],
        error: FORMS_NOT_A_CARD,
      });
      expect(words.text).toBe(
        "off, because CLICKUP_WRITEBACK_FORMS_ONLY_CARDS is not a list of card ids",
      );
      if (cards.trim().length > 1)
        expect(`${words.text} ${FORMS_NOT_A_CARD}`).not.toContain(cards);
    }
    // With the writer off the sentence still warns, before anyone turns it on.
    expect(formsGate(secret(",", "false"))).toMatchObject({
      apply: false,
      mode: "dry_run",
      error: FORMS_NOT_A_CARD,
    });
    // What stays as it was: a removed or empty secret is every card, good ids narrow, a trailing comma adds nothing.
    for (const open of [undefined, ""])
      expect(formsGate(secret(open as unknown as string))).toMatchObject({
        apply: true,
        mode: "apply",
        error: null,
      });
    expect(formsGate(secret("86eywg1cq,"))).toMatchObject({
      mode: "apply_limited",
      error: null,
    });
    const two = formsGate(secret(" 86eywg1cq , 86_card-2 "));
    expect([two.mode, two.error, [...two.onlyCards]]).toEqual([
      "apply_limited",
      null,
      ["86eywg1cq", "86_card-2"],
    ]);
    expect(formsGate(secret("a".repeat(40)))).toMatchObject({
      mode: "apply_limited",
      error: null,
    });
  });
});

describe("formStep: one check per effect key before any call", () => {
  it("passes each of the four keys; a happiness row and a comment have no day", async () => {
    for (const key of FORM_KEYS)
      expect("step" in (await formStep(await item(key)))).toBe(true);
    const h = await formStep(await item("happiness"));
    expect(h).toEqual({
      step: {
        key: "happiness",
        type: "select",
        taskId: CARD,
        fieldId: FORM_FIELDS.happiness,
        optionId: HAPPY,
        label: "Happy",
      },
    });
    const c = await formStep(await item("todo_comment"));
    expect(c).toEqual({
      step: {
        key: "todo_comment",
        type: "comment",
        taskId: CARD,
        text: `${COMMENT}\n\n${MARKER}`,
        marker: MARKER,
      },
    });
  });

  it("the payload's card, the row's card and the plan's card must be one card", async () => {
    for (const key of FORM_KEYS) {
      const a = await item(key);
      a.task_id = "86elsewhere";
      expect(await formStep(a)).toEqual({ fail: SAY_FORMS.mismatch });
      expect(
        await formStep(await item(key, { payload: { taskId: "86elsewhere" } })),
      ).toEqual({ fail: SAY_FORMS.mismatch });
      expect(
        await formStep(
          await item(key, {
            plan: { taskId: "86elsewhere" },
            payload: { taskId: CARD },
          }),
        ),
      ).toEqual({ fail: SAY_FORMS.mismatch });
    }
  });

  it("the comment text must match the payload's sha256", async () => {
    expect(
      await formStep(
        await item("todo_comment", {
          payload: { commentSha256: await sha256("another text") },
        }),
      ),
    ).toEqual({ fail: SAY_FORMS.mismatch });
    expect(
      await formStep(
        await item("todo_comment", { plan: { comment_text: "   " } }),
      ),
    ).toEqual({ fail: SAY_FORMS.mismatch });
  });

  it("a date must be noon Kuwait of its own day; a field must be its key's field; Happiness one of the six", async () => {
    expect(
      await formStep(
        await item("last_poc", {
          plan: { value: Date.parse("2026-10-25T06:00:00Z") },
        }),
      ),
    ).toEqual({ fail: SAY_FORMS.mismatch });
    expect(
      await formStep(await item("last_poc", { plan: { day: "25 Oct" } })),
    ).toEqual({ fail: SAY_FORMS.mismatch });
    expect(
      await formStep(
        await item("last_checkin_call", {
          plan: { field: FORM_FIELDS.last_poc },
        }),
      ),
    ).toEqual({ fail: SAY_FORMS.mismatch });
    expect(
      await formStep(
        await item("happiness", { plan: { value: "00000000-not-an-option" } }),
      ),
    ).toEqual({ fail: SAY_FORMS.mismatch });
    expect(
      await formStep(await item("happiness", { plan: { label: "Neutral" } })),
    ).toEqual({ fail: SAY_FORMS.mismatch });
  });

  it("no effect from the claim, or an unknown key, is never written", async () => {
    const a = await item("happiness");
    a.effect = null;
    expect(await formStep(a)).toEqual({ fail: SAY_FORMS.noPlan });
    expect(
      await formStep(
        await item("happiness", { payload: { effectKey: "grade_notice" } }),
      ),
    ).toEqual({ fail: SAY_FORMS.mismatch });
  });

  it("a frozen step is used as saved; one for another card or field is a mismatch", async () => {
    const it = await item("todo_comment");
    const fresh = ((await formStep(it)) as { step: FormStep }).step;
    const saved = {
      ...fresh,
      text: `An older frozen text\n\n${MARKER}`,
    } as FormStep;
    expect(frozenStep({ ...it, steps: [saved] }, fresh)).toBe(saved);
    expect(
      frozenStep(
        { ...it, steps: [{ ...fresh, taskId: "86elsewhere" } as FormStep] },
        fresh,
      ),
    ).toBeNull();
    expect(frozenStep(it, fresh)).toBe(fresh);
  });

  it("the marker is Cockpit ref F- and the first 10 hex of the response id", () => {
    expect(formMarker(RESPONSE)).toBe(MARKER);
    expect(formMarker("5B1E2C3D-4F50-4A61-8B72-9C83D4E5F601")).toBe(MARKER);
  });
});

describe("the to-do comment", () => {
  it("posts the plan's text, a blank line and the marker, notify_all false; reads it back by id and marker", async () => {
    const cards = new FakeCards();
    const { out, saves } = await run(cards, await item("todo_comment"));
    expect(out.state).toBe("delivered");
    expect(cards.writes()).toEqual([
      {
        method: "POST",
        path: `task/${CARD}/comment`,
        body: { comment_text: `${COMMENT}\n\n${MARKER}`, notify_all: false },
      },
    ]);
    // Read back on the first page by the comment's id and marker.
    expect(
      cards.calls.filter(c => c.method === "GET").map(c => c.path),
    ).toEqual([`task/${CARD}/comment`]);
    // Booked under payload.effectKey, with the comment's id and no text.
    expect(out.progress.steps.todo_comment).toMatchObject({
      state: "done",
      commentId: cards.comments[0].id,
    });
    for (const s of saves)
      expect(JSON.stringify(s)).not.toContain("invented plan");
    expect(JSON.stringify(out.progress)).not.toContain("invented plan");
  });

  it("resumes a started comment found on page 2 behind 27 newer ones: no second post", async () => {
    const cards = new FakeCards();
    // The first run's post landed, then its answer was lost: the comment is on the card, 27 notes after it.
    cards.comments.push({
      id: "90cm-landed",
      comment_text: `${COMMENT}\n\n${MARKER}`,
      date: String(NOW - 4 * 60_000),
    });
    cards.addComments(27, NOW - 60_000);
    const started = {
      steps: {
        todo_comment: {
          state: "started",
          at: new Date(NOW - 4 * 60_000).toISOString(),
          startedAt: new Date(NOW - 4 * 60_000).toISOString(),
        },
      },
    };
    const { out } = await run(
      cards,
      await item("todo_comment", { progress: started }),
    );
    expect(out.state).toBe("delivered");
    expect(out.progress.steps.todo_comment).toMatchObject({
      state: "done",
      commentId: "90cm-landed",
    });
    expect(cards.writes()).toEqual([]);
    expect(cards.calls.map(c => c.path)).toEqual([
      `task/${CARD}/comment`,
      expect.stringMatching(
        new RegExp(`^task/${CARD}/comment\\?start=\\d+&start_id=old\\d+$`),
      ),
    ]);
  });

  it("a started comment not on the card is posted once; one ClickUp gave an id to is never posted again", async () => {
    const cards = new FakeCards();
    const started = {
      state: "started",
      at: new Date(NOW - 60_000).toISOString(),
      startedAt: new Date(NOW - 60_000).toISOString(),
    };
    const first = await run(
      cards,
      await item("todo_comment", {
        progress: { steps: { todo_comment: started } },
      }),
    );
    expect(first.out.state).toBe("delivered");
    expect(cards.writes().length).toBe(1);
    const again = new FakeCards();
    const withId = {
      steps: { todo_comment: { ...started, commentId: "90cm-gone" } },
    };
    const second = await run(
      again,
      await item("todo_comment", { progress: withId }),
    );
    expect(second.out).toMatchObject({
      state: "unknown",
      error: SAY_FORMS.commentLost,
    });
    expect(again.writes()).toEqual([]);
  });

  it("a comment that does not read back is unknown, read again next time", async () => {
    const cards = new FakeCards();
    const orig = cards.handle.bind(cards);
    cards.handle = async (c: Call) => {
      const r = await orig(c);
      // ClickUp answers the post, then lists nothing yet.
      return c.method === "GET" && c.path.includes("/comment")
        ? { comments: [] }
        : r;
    };
    const { out } = await run(cards, await item("todo_comment"));
    expect(out).toMatchObject({
      state: "unknown",
      error: SAY_FORMS.commentMissing,
    });
    expect(out.progress.steps.todo_comment).toMatchObject({
      state: "started",
      commentId: expect.any(String),
    });
  });

  it("a 429 on the post is retried by the ladder and the started step starts clean", async () => {
    const cards = new FakeCards();
    cards.fail = c => (c.method === "POST" ? rejected(429) : undefined);
    const { out } = await run(cards, await item("todo_comment"));
    expect(out.state).toBe("retry");
    expect(out.progress.steps.todo_comment).toBeUndefined();
  });

  it("a 429 on the read-back after a post that went through is unknown, as a 503 is: the comment is on the card", async () => {
    // Review round 3: a plain retry here kept the effect queued, so a rollback skipped the row as "Make owns this
    // again." with no word to check the card, and Make posted its own comment beside the cockpit's.
    for (const status of [429, 503]) {
      const cards = new FakeCards();
      cards.fail = c =>
        c.method === "GET" && c.path.includes("/comment")
          ? rejected(status)
          : undefined;
      const { out } = await run(cards, await item("todo_comment"));
      expect(cards.comments).toHaveLength(1);
      expect(out).toMatchObject({
        state: "unknown",
        error: `clickup rejected the request (${status}). Inspect the provider receipt.`,
      });
      expect(out.progress.steps.todo_comment).toMatchObject({
        state: "started",
        commentId: cards.comments[0].id,
      });
    }
  });
});

describe("what the CSM's trail reads, and the token (finish review)", () => {
  const said = (status: number, detail = "") =>
    new Error(
      `clickup rejected the request (${status})${detail ? `: ${detail}` : ". Inspect the provider receipt."}`,
    );

  it("a comment POST ClickUp answers 404 reads as the field steps read: not on the list, nothing written", async () => {
    const cards = new FakeCards();
    cards.fail = c => (c.method === "POST" ? said(404) : undefined);
    const { out } = await run(cards, await item("todo_comment"));
    expect(out).toMatchObject({
      state: "failed",
      plain: SAY_FORMS.offList,
      error:
        "clickup rejected the request (404). Inspect the provider receipt.",
    });
    expect(cards.comments).toHaveLength(0);
  });

  it("a write ClickUp refuses reads as refused; a read refused after the write says to check the card", async () => {
    const write = new FakeCards();
    write.fail = c => (c.method === "POST" ? said(403) : undefined);
    expect((await run(write, await item("todo_comment"))).out).toMatchObject({
      state: "failed",
      plain: SAY_FORMS.refused,
    });
    let posted = false;
    const back = new FakeCards();
    back.fail = c => {
      if (c.method === "POST") posted = true;
      else if (posted) return said(403);
      return undefined;
    };
    const { out } = await run(back, await item("todo_comment"));
    expect(back.comments).toHaveLength(1);
    expect(out).toMatchObject({
      state: "failed",
      plain: SAY_FORMS.readRefused,
    });
  });

  it("an unconfirmed write reads as not confirmed, never ClickUp's wording; a step's own sentence has no plain to replace it", async () => {
    const cards = new FakeCards();
    cards.fail = c => (c.method === "POST" ? said(500) : undefined);
    expect((await run(cards, await item("todo_comment"))).out).toMatchObject({
      state: "unknown",
      plain: SAY_FORMS.notConfirmed,
    });
    const lost = new FakeCards();
    lost.fail = c =>
      c.method === "POST"
        ? new Error("Provider response is unknown. Reconcile before retrying.")
        : undefined;
    expect((await run(lost, await item("todo_comment"))).out).toMatchObject({
      state: "unknown",
      plain: SAY_FORMS.notConfirmed,
    });
    const off = new FakeCards();
    off.cardList = "901800000099";
    const refused = (await run(off, await item("happiness"))).out;
    expect(refused).toMatchObject({
      state: "failed",
      error: SAY_FORMS.offList,
    });
    expect(refused.plain).toBeUndefined();
  });

  it("every sentence the trail can print from these outcomes is free of ClickUp's wording", () => {
    for (const sentence of [
      SAY_FORMS.notConfirmed,
      SAY_FORMS.refused,
      SAY_FORMS.readRefused,
      SAY_FORMS.offList,
      SAY_FORMS.offListStarted,
      SAY_FORMS.cardRefused,
    ])
      expect(sentence).not.toMatch(
        /rejected the request|provider receipt|Reconcile/i,
      );
  });

  it("a 401 is the token, not the write: on the POST the step starts clean, on a read-back it stays started", async () => {
    const write = new FakeCards();
    write.fail = c =>
      c.method === "POST" ? said(401, "Token invalid") : undefined;
    const first = await run(write, await item("todo_comment"));
    expect(first.out).toEqual({
      state: "retry",
      progress: { steps: {} },
      error: "clickup rejected the request (401): Token invalid",
      tokenRefused: true,
    });
    expect(write.comments).toHaveLength(0);
    let posted = false;
    const back = new FakeCards();
    back.fail = c => {
      if (c.method === "POST") posted = true;
      else if (posted) return said(401, "Token invalid");
      return undefined;
    };
    const { out } = await run(back, await item("todo_comment"));
    expect(back.comments).toHaveLength(1);
    expect(out).toMatchObject({ state: "retry", tokenRefused: true });
    expect(out.progress.steps.todo_comment).toMatchObject({
      state: "started",
      commentId: back.comments[0].id,
    });
    const read = new FakeCards();
    read.fail = () => said(401, "Token invalid");
    expect((await run(read, await item("happiness"))).out).toMatchObject({
      state: "retry",
      tokenRefused: true,
      progress: { steps: {} },
    });
  });

  it("checkToken reads the list, not the card: only the field list is an answer, only a 401 blames the token", async () => {
    const asked: string[] = [];
    const answering = (answer: () => any): Provider => ({
      call: async (_p, method, path) => {
        asked.push(`${method} ${path}`);
        return answer();
      },
    });
    expect(await checkToken(answering(() => ({ fields: [] })))).toBe("good");
    expect(asked).toEqual([`GET list/${FORMS_LIST}/field`]);
    expect(await checkToken(answering(() => ({})))).toBe("unsure");
    expect(await checkToken(answering(() => null))).toBe("unsure");
    const throwing = (e: Error) =>
      answering(() => {
        throw e;
      });
    expect(await checkToken(throwing(said(401, "Token invalid")))).toBe(
      "refused",
    );
    expect(await checkToken(throwing(said(429)))).toBe("slow");
    for (const status of [403, 404, 500, 503])
      expect(await checkToken(throwing(said(status)))).toBe("unsure");
    expect(
      await checkToken(throwing(new Error("network connection lost"))),
    ).toBe("unsure");
  });

  it("cardRefused: nothing started is a plain retry that ends on the sentence; a started step is unknown", () => {
    const error = "clickup rejected the request (401): Team not authorized";
    expect(
      cardRefused(
        { state: "retry", progress: { steps: {} }, error, tokenRefused: true },
        "happiness",
      ),
    ).toEqual({
      state: "retry",
      progress: { steps: {} },
      error,
      plain: SAY_FORMS.cardRefused,
      endsAs: SAY_FORMS.cardRefused,
    });
    const started = {
      steps: {
        happiness: { state: "started", at: "2026-10-30T00:00:00.000Z" },
      },
    } as any;
    expect(
      cardRefused(
        { state: "retry", progress: started, error, tokenRefused: true },
        "happiness",
      ),
    ).toEqual({
      state: "unknown",
      progress: started,
      error,
      plain: SAY_FORMS.readRefused,
    });
  });

  it("the provider's last sentence from an earlier try does not outlive it", async () => {
    const cards = new FakeCards();
    const it0 = await item("happiness");
    const { out } = await run(cards, {
      ...it0,
      progress: { lastDetail: "clickup rejected the request (500)." },
    });
    expect(out.state).toBe("delivered");
    expect(JSON.stringify(out.progress)).not.toContain("lastDetail");
  });
});

describe("Client Happiness", () => {
  it("shows the option already (by id or by orderindex): delivered unchanged, no write", async () => {
    for (const shown of [HAPPY, 3]) {
      const cards = new FakeCards();
      cards.values.set(FORM_FIELDS.happiness, shown);
      const { out } = await run(cards, await item("happiness"));
      expect(out.state).toBe("delivered");
      expect(out.progress.steps.happiness.state).toBe("unchanged");
      expect(cards.writes()).toEqual([]);
    }
  });

  it("reads the card, posts the option id and reads it back as a select", async () => {
    const cards = new FakeCards();
    cards.values.set(FORM_FIELDS.happiness, 2); // Neutral
    const { out } = await run(cards, await item("happiness"));
    expect(out.state).toBe("delivered");
    expect(cards.writes()).toEqual([
      {
        method: "POST",
        path: `task/${CARD}/field/${FORM_FIELDS.happiness}`,
        body: { value: HAPPY },
      },
    ]);
    expect(cards.calls.map(c => `${c.method} ${c.path}`)).toEqual([
      `GET task/${CARD}`,
      `POST task/${CARD}/field/${FORM_FIELDS.happiness}`,
      `GET task/${CARD}`,
    ]);
    expect(out.progress.steps.happiness.state).toBe("done");
  });

  it("an option missing on the field is failed with no write", async () => {
    const cards = new FakeCards();
    cards.fields[0].type_config.options =
      cards.fields[0].type_config.options.filter((o: Row) => o.id !== HAPPY);
    const { out } = await run(cards, await item("happiness"));
    expect(out).toMatchObject({
      state: "failed",
      error:
        'ClickUp\'s Client Happiness has no "Happy" option, so nothing was written. The tech lead runs the forms doctor.',
    });
    expect(cards.writes()).toEqual([]);
  });

  it("a write ClickUp does not keep is unknown", async () => {
    const cards = new FakeCards();
    cards.drop = true;
    const { out } = await run(cards, await item("happiness"));
    expect(out).toMatchObject({
      state: "unknown",
      error:
        "Client Happiness did not read back as Happy. The next run reads it again.",
    });
  });
});

describe("the two dates, forward only by the Kuwait day", () => {
  for (const hour of [3, 4])
    it(`posts noon Kuwait with value_options time false; ClickUp keeps it at 0${hour}:00Z and it reads back by day`, async () => {
      const cards = new FakeCards();
      cards.storeHour = hour;
      cards.setDay(FORM_FIELDS.last_poc, "2026-10-20");
      const { out } = await run(cards, await item("last_poc"));
      expect(out.state).toBe("delivered");
      expect(cards.writes()).toEqual([
        {
          method: "POST",
          path: `task/${CARD}/field/${FORM_FIELDS.last_poc}`,
          body: {
            value: Date.parse("2026-10-25T09:00:00Z"),
            value_options: { time: false },
          },
        },
      ]);
      expect(Number(cards.values.get(FORM_FIELDS.last_poc))).toBe(
        Date.parse(`2026-10-25T0${hour}:00:00Z`),
      );
      expect(kuwaitDay(cards.values.get(FORM_FIELDS.last_poc))).toBe(
        "2026-10-25",
      );
      expect(out.progress.steps.last_poc.state).toBe("done");
    });

  it("an empty date is written; Last Check-in Call too", async () => {
    const cards = new FakeCards();
    const { out } = await run(cards, await item("last_checkin_call"));
    expect(out.state).toBe("delivered");
    expect(cards.writes()[0]).toEqual({
      method: "POST",
      path: `task/${CARD}/field/${FORM_FIELDS.last_checkin_call}`,
      body: {
        value: Date.parse("2026-10-24T09:00:00Z"),
        value_options: { time: false },
      },
    });
  });

  it("the card newer: kept, skipped with the trail's sentence, no write", async () => {
    const cards = new FakeCards();
    cards.setDay(FORM_FIELDS.last_poc, "2026-10-26");
    cards.setDay(FORM_FIELDS.last_checkin_call, "2026-10-27", 4);
    const poc = await run(cards, await item("last_poc"));
    expect(poc.out).toMatchObject({
      state: "skipped",
      error: "Last POC stays 26 Oct: it is newer than this call.",
    });
    const call = await run(cards, await item("last_checkin_call"));
    expect(call.out).toMatchObject({
      state: "skipped",
      error: "Last check-in call stays 27 Oct: it is newer than this call.",
    });
    expect(cards.writes()).toEqual([]);
    expect(poc.out.progress.steps.last_poc).toMatchObject({
      state: "skipped",
      cardDay: "2026-10-26",
    });
  });

  it("the same Kuwait day, at another hour: delivered unchanged with no write", async () => {
    const cards = new FakeCards();
    cards.values.set(
      FORM_FIELDS.last_poc,
      String(Date.parse("2026-10-24T21:30:00Z")),
    ); // 00:30 Kuwait on 25 Oct
    const { out } = await run(cards, await item("last_poc"));
    expect(out.state).toBe("delivered");
    expect(out.progress.steps.last_poc.state).toBe("unchanged");
    expect(cards.writes()).toEqual([]);
  });

  it("read back older or empty is unknown; a newer day that landed meanwhile is kept", async () => {
    const dropped = new FakeCards();
    dropped.drop = true;
    expect((await run(dropped, await item("last_poc"))).out).toMatchObject({
      state: "unknown",
      error:
        "Last POC did not read back as 25 Oct. The next run reads it again.",
    });
    const raced = new FakeCards();
    raced.drop = true;
    raced.raceDay = "2026-10-28";
    expect((await run(raced, await item("last_poc"))).out).toMatchObject({
      state: "skipped",
      error: "Last POC stays 28 Oct: it is newer than this call.",
    });
  });

  it("a settled step is never written again", async () => {
    const cards = new FakeCards();
    const done = {
      steps: {
        last_poc: {
          state: "skipped",
          cardDay: "2026-10-26",
          at: new Date(NOW).toISOString(),
        },
      },
    };
    const { out } = await run(
      cards,
      await item("last_poc", { progress: done }),
    );
    expect(out).toMatchObject({
      state: "skipped",
      error: "Last POC stays 26 Oct: it is newer than this call.",
    });
    expect(cards.calls).toEqual([]);
  });

  it("shortDay names the day as the trail does", () => {
    expect(shortDay("2026-10-05")).toBe("5 Oct");
    expect(shortDay("2026-01-31")).toBe("31 Jan");
  });
});

describe("the card", () => {
  it("off the Clients - Mahara list, or gone: failed with no write, every field step", async () => {
    for (const key of ["happiness", "last_poc", "last_checkin_call"] as const) {
      const moved = new FakeCards();
      moved.cardList = "901800000099";
      expect((await run(moved, await item(key))).out).toMatchObject({
        state: "failed",
        error: SAY_FORMS.offList,
      });
      expect(moved.writes()).toEqual([]);
      const gone = new FakeCards();
      gone.fail = c => (c.method === "GET" ? rejected(404) : undefined);
      expect((await run(gone, await item(key))).out).toMatchObject({
        state: "failed",
        error: SAY_FORMS.offList,
      });
      expect(gone.writes()).toEqual([]);
    }
  });

  // Break-it review: "nothing was written" is only true of a step that has sent nothing. A resume after an unanswered
  // POST, or the read-back after a POST ClickUp answered, may already have left the value on the card.
  const startedOn = (key: string) => ({
    steps: {
      [key]: { state: "started", at: new Date(NOW - 60_000).toISOString() },
    },
  });

  it("a resumed step on a card that left the list says a write may be on it, never that nothing was written", async () => {
    for (const key of ["happiness", "last_poc", "last_checkin_call"] as const) {
      const cards = new FakeCards();
      cards.cardList = "901800000099";
      const { out } = await run(
        cards,
        await item(key, { progress: startedOn(key) }),
      );
      expect(out).toMatchObject({
        state: "failed",
        error: SAY_FORMS.offListStarted,
      });
      expect(out.progress.steps[key].state).toBe("started");
      expect(cards.writes()).toEqual([]);
    }
  });

  it("a resumed step on a card that is gone (404) says the same", async () => {
    for (const key of ["happiness", "last_poc", "last_checkin_call"] as const) {
      const cards = new FakeCards();
      cards.fail = c => (c.method === "GET" ? rejected(404) : undefined);
      const { out } = await run(
        cards,
        await item(key, { progress: startedOn(key) }),
      );
      expect(out).toMatchObject({
        state: "failed",
        error: SAY_FORMS.offListStarted,
      });
      expect(out.progress.steps[key].state).toBe("started");
      expect(cards.writes()).toEqual([]);
    }
  });

  it("the read-back after a POST ClickUp answered, off the list or 404, says a write may be on the card", async () => {
    for (const key of ["happiness", "last_poc", "last_checkin_call"] as const) {
      const moved = new FakeCards();
      moved.fail = c => {
        if (c.method === "POST") moved.cardList = "901800000099";
        return undefined;
      };
      const off = (await run(moved, await item(key))).out;
      expect(off).toMatchObject({
        state: "failed",
        error: SAY_FORMS.offListStarted,
      });
      expect(off.progress.steps[key].state).toBe("started");
      expect(moved.writes()).toHaveLength(1);
      let posted = false;
      const gone = new FakeCards();
      gone.fail = c => {
        if (c.method === "POST") posted = true;
        else if (posted) return rejected(404);
        return undefined;
      };
      const lost = (await run(gone, await item(key))).out;
      expect(lost).toMatchObject({
        state: "failed",
        error: SAY_FORMS.offListStarted,
      });
      expect(gone.writes()).toHaveLength(1);
    }
  });

  it("a resumed step whose field or option has gone says a write may be on the card; a fresh one still says nothing was written", async () => {
    for (const key of ["happiness", "last_poc", "last_checkin_call"] as const) {
      const label = {
        happiness: "Client Happiness",
        last_poc: "Last POC",
        last_checkin_call: "Last Check-in Call",
      }[key];
      const resumed = new FakeCards();
      resumed.fields = resumed.fields.filter(f => f.id !== FORM_FIELDS[key]);
      const out = (
        await run(resumed, await item(key, { progress: startedOn(key) }))
      ).out;
      expect(out).toMatchObject({
        state: "failed",
        error: SAY_FORMS.noFieldStarted(label),
      });
      expect(out.error).not.toContain("nothing was written");
      const fresh = new FakeCards();
      fresh.fields = fresh.fields.filter(f => f.id !== FORM_FIELDS[key]);
      expect((await run(fresh, await item(key))).out).toMatchObject({
        state: "failed",
        error: SAY_FORMS.noField(label),
      });
    }
    const withoutHappy = () => {
      const cards = new FakeCards();
      const field = cards.fields.find(f => f.id === FORM_FIELDS.happiness)!;
      field.type_config.options = field.type_config.options.filter(
        (o: Row) => o.id !== HAPPY,
      );
      return cards;
    };
    const out = (
      await run(
        withoutHappy(),
        await item("happiness", { progress: startedOn("happiness") }),
      )
    ).out;
    expect(out).toMatchObject({
      state: "failed",
      error: SAY_FORMS.noOptionStarted("Happy"),
    });
    expect(out.error).not.toContain("nothing was written");
    expect(
      (await run(withoutHappy(), await item("happiness"))).out,
    ).toMatchObject({ state: "failed", error: SAY_FORMS.noOption("Happy") });
  });

  it("a 5xx, a timeout or an unreadable answer on the first read, before any write, is a plain retry with nothing booked", async () => {
    // Review round 2: nothing was sent to the card, so the row is not unknown and the trail shows no problem.
    const unanswered = [
      rejected(502),
      new Error("Provider response is unknown. Reconcile before retrying."),
      new Error(
        "Provider returned an unreadable response. Reconcile before retrying.",
      ),
    ];
    for (const key of ["happiness", "last_poc", "last_checkin_call"] as const)
      for (const failure of unanswered) {
        const cards = new FakeCards();
        cards.fail = c => (c.method === "GET" ? failure : undefined);
        const { out, saves } = await run(cards, await item(key));
        expect(out).toEqual({
          state: "retry",
          progress: { steps: {} },
          error: failure.message,
          plain: SAY_FORMS.notConfirmed,
        });
        expect(saves).toEqual([]);
        expect(cards.writes()).toEqual([]);
      }
  });

  it("the same read failing once the step has started, in this run or an earlier one, stays unknown", async () => {
    // The read-back after the write: the write may have landed.
    const after = new FakeCards();
    after.values.set(FORM_FIELDS.happiness, 2); // Neutral, so Happy is written
    let posted = false;
    after.fail = c => {
      if (c.method === "POST") posted = true;
      return c.method === "GET" && posted ? rejected(502) : undefined;
    };
    const back = await run(after, await item("happiness"));
    expect(after.writes()).toHaveLength(1);
    expect(back.out).toMatchObject({
      state: "unknown",
      error:
        "clickup rejected the request (502). Inspect the provider receipt.",
    });
    expect(back.out.progress.steps.happiness.state).toBe("started");
    // The first read of a step an earlier run started: that run's write may have landed.
    const resumed = new FakeCards();
    resumed.fail = c => (c.method === "GET" ? rejected(502) : undefined);
    const earlier = {
      steps: {
        last_poc: {
          state: "started",
          startedAt: new Date(NOW - 60_000).toISOString(),
          at: new Date(NOW - 60_000).toISOString(),
        },
      },
    };
    expect(
      (await run(resumed, await item("last_poc", { progress: earlier }))).out
        .state,
    ).toBe("unknown");
    expect(resumed.writes()).toEqual([]);
    // A started comment whose search ClickUp does not answer: it may be on the card.
    const comment = new FakeCards();
    comment.fail = c => (c.method === "GET" ? rejected(503) : undefined);
    const startedComment = {
      steps: {
        todo_comment: {
          state: "started",
          startedAt: new Date(NOW - 60_000).toISOString(),
          at: new Date(NOW - 60_000).toISOString(),
        },
      },
    };
    expect(
      (
        await run(
          comment,
          await item("todo_comment", { progress: startedComment }),
        )
      ).out.state,
    ).toBe("unknown");
    expect(comment.writes()).toEqual([]);
  });

  it("a 429 on a field's read-back after its write, or on the first read of a step an earlier run started, is unknown", async () => {
    // Review round 3: the write may be on the card, so the row is not a plain retry.
    const after = new FakeCards();
    after.values.set(FORM_FIELDS.happiness, 2); // Neutral, so Happy is written
    let posted = false;
    after.fail = c => {
      if (c.method === "POST") posted = true;
      return c.method === "GET" && posted ? rejected(429) : undefined;
    };
    const back = await run(after, await item("happiness"));
    expect(after.writes()).toHaveLength(1);
    expect(back.out).toMatchObject({
      state: "unknown",
      error:
        "clickup rejected the request (429). Inspect the provider receipt.",
    });
    expect(back.out.progress.steps.happiness.state).toBe("started");
    const resumed = new FakeCards();
    resumed.fail = c => (c.method === "GET" ? rejected(429) : undefined);
    const earlier = {
      steps: {
        last_poc: {
          state: "started",
          startedAt: new Date(NOW - 60_000).toISOString(),
          at: new Date(NOW - 60_000).toISOString(),
        },
      },
    };
    expect(
      (await run(resumed, await item("last_poc", { progress: earlier }))).out
        .state,
    ).toBe("unknown");
    expect(resumed.writes()).toEqual([]);
    // A 429 on the date write itself never landed: a plain retry, the step starts clean.
    const write = new FakeCards();
    write.fail = c => (c.method === "POST" ? rejected(429) : undefined);
    const plain = await run(write, await item("last_poc"));
    expect(plain.out.state).toBe("retry");
    expect(plain.out.progress.steps.last_poc).toBeUndefined();
  });

  it("a 429 or ClickUp's own refusal on the first read keeps its ladder class; a halt keeps its own state", async () => {
    const slow = new FakeCards();
    slow.fail = c => (c.method === "GET" ? rejected(429) : undefined);
    expect((await run(slow, await item("happiness"))).out.state).toBe("retry");
    const refused = new FakeCards();
    refused.fail = c => (c.method === "GET" ? rejected(403) : undefined);
    expect((await run(refused, await item("happiness"))).out.state).toBe(
      "failed",
    );
    const dropped = new FakeCards();
    dropped.drop = true;
    expect((await run(dropped, await item("happiness"))).out.state).toBe(
      "unknown",
    );
  });
});

describe("the plan a held row shows", () => {
  it("names the field and the value, never the comment text", async () => {
    const plan = planForm(await item("todo_comment"));
    expect(plan).toEqual([
      {
        queueId: "q-todo_comment",
        kind: "form",
        taskId: CARD,
        field: "1-1 notes comment",
        old: null,
        new: `${COMMENT.length} characters`,
      },
    ]);
    expect(JSON.stringify(plan)).not.toContain("invented");
    expect(planForm(await item("last_poc"))[0]).toMatchObject({
      field: "Last POC",
      new: "2026-10-25",
    });
    expect(planForm(await item("happiness"))[0]).toMatchObject({
      field: "Client Happiness",
      new: "Happy",
    });
  });
});

describe("the doctor's checks", () => {
  const inputs = {
    happinessOptions: Object.entries(HAPPINESS_OPTIONS).map(
      ([label, optionId]) => ({ label, optionId }),
    ),
    fields: {
      happiness: FORM_FIELDS.happiness,
      lastPoc: FORM_FIELDS.last_poc,
      lastCheckinCall: FORM_FIELDS.last_checkin_call,
    },
  };
  it("passes with the six options, two date fields and the test card on the list", async () => {
    const cards = new FakeCards();
    const testCard = new FakeCards();
    const provider: Provider = {
      call: (p, m, path, body) =>
        path === "task/86eywg1cq"
          ? testCard.provider().call(p, m, `task/${CARD}`, body)
          : cards.provider().call(p, m, path, body),
    };
    expect(await formsDoctorChecks(inputs, provider, [])).toEqual({
      problems: [],
      counts: { options: 6, fields: 3, cards: ["86eywg1cq"] },
    });
    expect(cards.writes()).toEqual([]);
  });

  it("names a missing option, a date field of another type and a card off the list", async () => {
    const cards = new FakeCards();
    cards.fields[0].type_config.options =
      cards.fields[0].type_config.options.filter(
        (o: Row) => o.name !== "Churned",
      );
    cards.fields[1].type = "short_text";
    const out = await formsDoctorChecks(inputs, cards.provider(), [OFF_LIST]);
    expect(out.problems).toEqual([
      'Client Happiness has no "Churned" option in ClickUp any more, so a 1-1 notes write with it would fail.',
      "Last POC is a short_text field in ClickUp, not a date.",
      `The test card ${OFF_LIST} is not on the Clients - Mahara list.`,
    ]);
  });

  it("names a database that plans other options or fields", async () => {
    const cards = new FakeCards();
    const out = await formsDoctorChecks(
      {
        happinessOptions: [{ label: "Happy", optionId: "x" }],
        fields: { ...inputs.fields, lastPoc: "x" },
      },
      {
        call: (p, m, path, body) =>
          cards
            .provider()
            .call(
              p,
              m,
              path === "task/86eywg1cq" ? `task/${CARD}` : path,
              body,
            ),
      },
      [],
    );
    expect(out.problems.slice(0, 2)).toEqual([
      "The database and the writer name different Client Happiness options. Re-read 20261027h before any 1-1 notes write.",
      "The database and the writer name different ClickUp fields for the 1-1 notes.",
    ]);
  });
});

describe("the database calls", () => {
  const sql = readFileSync(
    new URL(
      "../../migrations/20261029t_forms_clickup_writeback.sql",
      import.meta.url,
    ),
    "utf8",
  );
  it("every RPC forms.ts names is defined in 20261029t and granted to the service role only", async () => {
    const names: string[] = [];
    const db = formsDb(async name => {
      names.push(name);
      return null;
    });
    await db.claim("t", 8);
    await db.release("i", "t", [], "n", "x");
    await db.state(true, "n", "dry_run", []);
    await db.doctorInputs();
    expect(names).toEqual([
      "cockpit_clickup_writeback_claim_forms",
      "cockpit_clickup_writeback_release",
      "cockpit_clickup_forms_state",
      "cockpit_clickup_forms_doctor_inputs",
    ]);
    const grants = sql.slice(
      sql.indexOf(
        "The writer's RPCs and the four replaced ones: the service key only.",
      ),
    );
    for (const name of names) {
      expect(sql).toContain(`CREATE OR REPLACE FUNCTION public.${name}(`);
      expect(grants).toContain(`'${name}(`);
    }
    expect(grants).toContain(
      "EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);",
    );
    expect(grants).toContain(
      "EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);",
    );
    expect(sql).not.toMatch(/TO (anon|authenticated|PUBLIC)\b/);
  });

  it("the sentences the claim writes are the contract's, word for word", () => {
    expect(sql).toContain(
      "'Make owns this again. An earlier try may have reached the card, so check it in ClickUp.'",
    );
    expect(sql).toContain("'Make owns this again.'");
  });
});
