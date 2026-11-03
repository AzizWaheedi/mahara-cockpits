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
  BUDGET_MAX,
  BUDGET_MIN,
  budgetAmount,
  CARD_FACTS,
  CLIENT_PROFILE_FIELD,
  cardRefused,
  FACTS_ALLOWED,
  FORMS_FORM_KEYS,
  formLane,
  PROFILE_BACKFILL,
  PROFILE_LABELS,
  SALE_FACTS,
  STAGE4_KEYS,
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
  formsKeysGate,
  HAPPINESS_OPTIONS,
  MAP_FIELD,
  mapPhaseOf,
  planForm,
  STAGE4_FIELDS,
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

// --- Stage 4: the native kickoff and onboarding keys (docs/forms/WAVE56-CONTRACT.md 4.13.4) -----------------

const STATUS = "9368ca9e-3549-4320-84ff-9abd0a2901cb";
const CONTRACT = "ac976d4a-409b-441c-8c13-4b0e73a0c12f";
const BLUEPRINT = "1b7a4a74-d0e7-4a7f-9218-59c80a738186";
const PROFILE = "7755485f-74a8-496c-85d8-562588e77944";
const KICKOFF_LINK = "87d7d889-afea-42f8-9485-6f3ead5b857f";
const mapUrl = (phase: number) =>
  `https://mahara-onboarding-map.vercel.app/?phase=${phase}&cid=${CARD}`;
/**
 * An invented handoff and raw answers comment in Make's shapes (Make 12 [11], Make 13 [47]): bold marks, a rule
 * line, a line break and a doubled space inside an answer, underscores, Arabic and an emoji.
 */
const HANDOFF4 = [
  "*KICKOFF HANDOFF*",
  "*Client:* Acme Interiors",
  "",
  "____________________________________",
  "",
  "*Business Name:* Acme  Interiors 🛋️",
  "*Address:* Block 1,\nStreet 2",
  "*Notes:* snake_case_words",
  "*المنطقة:* حولي",
].join("\n");
const RAW4 =
  "Raw Onboarding Form Answers\n\nWhat is your business name?\nAcme  Interiors 🛋️\n\nWhere are you?\nBlock 1,\nStreet 2";
/** As ClickUp may hand a comment back (requests.ts commentKey): no `*` or rule line, `\_`, spaces and new lines changed. */
const asClickUpReturns = (text: string) =>
  `${text
    .split("\n")
    .filter(l => !/^_{3,}$/.test(l))
    .join("\n")
    .replace(/\*/g, "")
    .replace(/_/g, "\\_")
    .replace(/ {2,}/g, " ")
    .replace(/\n/g, "  \r\n")}\n`;
/** A comment step an earlier run started `minutes` ago, with the id ClickUp answered its post with when it did. */
const startedAt = (key: string, minutes: number, commentId?: string) => {
  const at = new Date(NOW - minutes * 60_000).toISOString();
  return {
    steps: {
      [key]: {
        state: "started",
        at,
        startedAt: at,
        ...(commentId ? { commentId } : {}),
      },
    },
  };
};

/** One client card with the Stage 4 fields, a status and comments; it keeps what it is sent. */
class Stage4Card {
  calls: Call[] = [];
  status = "to do";
  comments: Row[] = [];
  /** A write ClickUp answers and never keeps. */
  drop = false;
  values = new Map<string, unknown>([[MAP_FIELD, mapUrl(2)]]);
  fields: Row[] = [
    {
      id: STATUS,
      name: "Client Status",
      type: "drop_down",
      type_config: {
        options: [
          {
            id: "61635c5b-d38e-4b92-ac9f-7233290c1d04",
            name: "Active",
            orderindex: 0,
          },
          {
            id: "dbd21650-59ce-429c-882d-5afd7d8aaa8a",
            name: "Brand Blueprint Booked♠️",
            orderindex: 4,
          },
        ],
      },
    },
    {
      id: CONTRACT,
      name: "Contract Status",
      type: "drop_down",
      type_config: {
        options: [
          {
            id: "ac8a68fa-ba2e-41da-9fcc-2e9b7d03d2e2",
            name: "Signed",
            orderindex: 0,
          },
          {
            id: "0667c501-3955-4443-829a-a4eb9a1d7176",
            name: "Not sent yet",
            orderindex: 3,
          },
        ],
      },
    },
    {
      id: BLUEPRINT,
      name: "🧬 Brand Blueprint Form Link",
      type: "url",
      type_config: {},
    },
    { id: PROFILE, name: "Client Profile", type: "text", type_config: {} },
    {
      id: KICKOFF_LINK,
      name: "Kickoff Form Link",
      type: "url",
      type_config: {},
    },
    { id: MAP_FIELD, name: "Onboarding Map", type: "url", type_config: {} },
  ];
  provider(): Provider {
    return {
      call: async (_p, method, path, body) =>
        this.handle({ method, path, body }),
    };
  }
  writes() {
    return this.calls.filter(c => c.method !== "GET");
  }
  private handle(c: Call): Row {
    this.calls.push(c);
    const m =
      /^task\/([^/]+)(?:\/(field|comment)(?:\/([^/?]+))?)?(\?.*)?$/.exec(
        c.path,
      );
    if (!m || m[1] !== CARD) throw rejected(404);
    if (c.method === "GET" && !m[2])
      return {
        id: CARD,
        list: { id: CARDS_LIST },
        status: { status: this.status },
        custom_fields: this.fields.map(f => ({
          ...f,
          value: this.values.get(f.id),
        })),
      };
    if (c.method === "PUT" && !m[2]) {
      if (!this.drop) this.status = String(c.body?.status ?? "").toLowerCase();
      return {};
    }
    if (c.method === "POST" && m[2] === "field") {
      if (!this.drop) {
        const f = this.fields.find(x => x.id === m[3]);
        // A dropdown reads back as its orderindex, as ClickUp answers it.
        const opt = f?.type_config?.options?.find(
          (o: Row) => o.id === c.body?.value,
        );
        this.values.set(String(m[3]), opt ? opt.orderindex : c.body?.value);
      }
      return {};
    }
    if (c.method === "POST" && m[2] === "comment") {
      const id = `c${this.comments.length + 1}`;
      this.comments.unshift({
        id,
        comment_text: c.body?.comment_text,
        date: String(NOW),
      });
      return { id };
    }
    if (c.method === "GET" && m[2] === "comment")
      return { comments: structuredClone(this.comments) };
    throw rejected(404);
  }
}

async function stage4Item(
  key: string,
  plan: Row,
  over: { payload?: Row; progress?: Row } = {},
): Promise<FormItem> {
  const formKey = [
    "profile_fields",
    "raw_answers_comment",
    "map_phase3",
  ].includes(key)
    ? "onboarding"
    : "kickoff";
  const full = { taskId: CARD, ...plan };
  const { comment_text, lines: _lines, ...rest } = full;
  return {
    id: `q-${key}`,
    kind: "form",
    attempts: 1,
    created_at: new Date(NOW - 60_000).toISOString(),
    task_id: CARD,
    steps: null,
    progress: over.progress ?? {},
    payload: {
      formKey,
      responseId: RESPONSE,
      effectId: `e-${key}`,
      effectKey: key,
      taskId: CARD,
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
    effect: { id: `e-${key}`, state: "queued", plan: full },
  };
}

async function run4(card: Stage4Card, it: FormItem) {
  const checked = await formStep(it);
  if ("fail" in checked) throw new Error(checked.fail);
  const step = frozenStep(it, checked.step);
  if (!step) throw new Error("frozen step mismatch");
  const saves: Row[] = [];
  const out = await executeForm(
    it,
    step,
    card.provider(),
    async patch => {
      saves.push(structuredClone(patch));
    },
    () => NOW,
  );
  return { out, saves, step };
}

describe("Stage 4 keys (4.13.4)", () => {
  it("CLICKUP_WRITEBACK_FORMS_KEYS: checkin when unset; a bad list keeps checkin alone and says so", () => {
    expect([...formsKeysGate(() => undefined).keys]).toEqual(["checkin"]);
    expect([...formsKeysGate(() => "").keys]).toEqual(["checkin"]);
    const both = formsKeysGate(n =>
      n === "CLICKUP_WRITEBACK_FORMS_KEYS" ? "checkin, kickoff" : undefined,
    );
    expect(both.has("kickoff")).toBe(true);
    expect(both.has("onboarding")).toBe(false);
    expect(both.error).toBeNull();
    const bad = formsKeysGate(n =>
      n === "CLICKUP_WRITEBACK_FORMS_KEYS" ? "checkin,pools" : undefined,
    );
    expect([...bad.keys]).toEqual(["checkin"]);
    expect(bad.error).toBe(
      "CLICKUP_WRITEBACK_FORMS_KEYS names something that is not checkin, kickoff, onboarding, new_client or profile_backfill, so only checkin is written.",
    );
    expect(SAY_FORMS.heldForm("kickoff")).toBe(
      "Held: kickoff card writes are not switched on.",
    );
  });

  it("formStep: the form, the card, the comment's sha256 and only the key's own fields", async () => {
    const ok = await stage4Item("native_status", { status: "IN PROGRESS" });
    expect(await formStep(ok)).toEqual({
      step: {
        key: "native_status",
        type: "status",
        taskId: CARD,
        status: "IN PROGRESS",
      },
    });
    expect(
      await formStep(
        await stage4Item(
          "native_status",
          { status: "IN PROGRESS" },
          { payload: { formKey: "onboarding" } },
        ),
      ),
    ).toEqual({ fail: SAY_FORMS.mismatch });
    expect(
      await formStep(await stage4Item("native_status", { status: "CLOSED" })),
    ).toEqual({ fail: SAY_FORMS.mismatch });
    // A field the key does not own (Client Happiness on card_fields) never passes.
    expect(
      await formStep(
        await stage4Item("card_fields", {
          fields: [
            {
              fieldId: FORM_FIELDS.happiness,
              kind: "drop_down",
              optionName: "Happy",
              label: "Client Happiness",
            },
          ],
        }),
      ),
    ).toEqual({ fail: SAY_FORMS.mismatch });
    expect(
      await formStep(
        await stage4Item("profile_fields", {
          fields: [
            {
              fieldId: KICKOFF_LINK,
              kind: "url",
              value: "javascript:alert(1)",
              label: "Kickoff Form Link",
            },
          ],
        }),
      ),
    ).toEqual({ fail: SAY_FORMS.mismatch });
    const tampered = await stage4Item("handoff_comment", {
      comment_text: "KICKOFF HANDOFF for Acme",
    });
    tampered.effect = {
      ...tampered.effect!,
      plan: {
        ...tampered.effect!.plan,
        comment_text: "KICKOFF HANDOFF for someone else",
      },
    };
    expect(await formStep(tampered)).toEqual({ fail: SAY_FORMS.mismatch });
    expect(
      await formStep(
        await stage4Item("map_phase4", {
          fieldId: MAP_FIELD,
          phase: 4,
          value: mapUrl(3),
        }),
      ),
    ).toEqual({ fail: SAY_FORMS.mismatch });
    expect(Object.keys(STAGE4_FIELDS.card_fields)).toHaveLength(11);
    expect(mapPhaseOf(mapUrl(5))).toBe(5);
    expect(mapPhaseOf("https://example.invalid/")).toBeNull();
  });

  it("the task status: written once, read back; already IN PROGRESS writes nothing", async () => {
    const card = new Stage4Card();
    const { out, saves } = await run4(
      card,
      await stage4Item("native_status", { status: "IN PROGRESS" }),
    );
    expect(out.state).toBe("delivered");
    expect(card.writes()).toEqual([
      { method: "PUT", path: `task/${CARD}`, body: { status: "IN PROGRESS" } },
    ]);
    expect(saves.at(-1)?.progress.steps.native_status.state).toBe("done");
    const again = await run4(
      card,
      await stage4Item("native_status", { status: "IN PROGRESS" }),
    );
    expect(again.out.state).toBe("delivered");
    expect(card.writes()).toHaveLength(1);
    const lost = new Stage4Card();
    lost.drop = true;
    const r = await run4(
      lost,
      await stage4Item("native_status", { status: "IN PROGRESS" }),
    );
    expect(r.out).toMatchObject({
      state: "unknown",
      error: SAY_FORMS.statusNotBack,
    });
  });

  it("card fields: options by name or id, only what differs is written, all read back", async () => {
    const card = new Stage4Card();
    card.values.set(CONTRACT, 0); // already Signed (orderindex 0)
    const fields = [
      {
        fieldId: STATUS,
        kind: "drop_down",
        optionId: "dbd21650-59ce-429c-882d-5afd7d8aaa8a",
        optionName: "Brand Blueprint Booked♠️",
        label: "Client Status",
      },
      {
        fieldId: CONTRACT,
        kind: "drop_down",
        optionName: "Signed",
        label: "Contract Status",
      },
      {
        fieldId: BLUEPRINT,
        kind: "url",
        value: `https://cockpit.maharamedia.com/client-success/clients/${CARD}/present/blueprint?view=prep`,
        label: "🧬 Brand Blueprint Form Link",
      },
    ];
    const { out } = await run4(
      card,
      await stage4Item("card_fields", { fields }),
    );
    expect(out.state).toBe("delivered");
    expect(card.writes().map(c => c.path)).toEqual([
      `task/${CARD}/field/${STATUS}`,
      `task/${CARD}/field/${BLUEPRINT}`,
    ]);
    expect(card.writes()[0].body).toEqual({
      value: "dbd21650-59ce-429c-882d-5afd7d8aaa8a",
    });
    const missing = await run4(
      new Stage4Card(),
      await stage4Item("card_fields", {
        fields: [
          {
            fieldId: CONTRACT,
            kind: "drop_down",
            optionName: "Maybe",
            label: "Contract Status",
          },
        ],
      }),
    );
    expect(missing.out).toMatchObject({
      state: "failed",
      error: SAY_FORMS.noFieldOption("Contract Status", "Maybe"),
    });
    const lost = new Stage4Card();
    lost.drop = true;
    const r = await run4(
      lost,
      await stage4Item("profile_fields", {
        fields: [
          {
            fieldId: PROFILE,
            kind: "text",
            value: "Revenue last year: 120000",
            label: "Client Profile",
          },
        ],
      }),
    );
    expect(r.out).toMatchObject({
      state: "unknown",
      error: SAY_FORMS.notBack("Client Profile", "written"),
    });
  });

  it("the map never moves back: a card at phase 5 is kept, one at phase 2 moves to 3", async () => {
    const far = new Stage4Card();
    far.values.set(MAP_FIELD, mapUrl(5));
    const kept = await run4(
      far,
      await stage4Item("map_phase3", {
        fieldId: MAP_FIELD,
        phase: 3,
        value: mapUrl(3),
      }),
    );
    expect(kept.out).toMatchObject({
      state: "skipped",
      error: "kept: the map is already at phase 5",
    });
    expect(far.writes()).toEqual([]);
    // A retry of the kept row reads as kept again, with no call.
    const again = await run4(
      far,
      await stage4Item(
        "map_phase3",
        { fieldId: MAP_FIELD, phase: 3, value: mapUrl(3) },
        { progress: kept.out.progress as Row },
      ),
    );
    expect(again.out).toMatchObject({
      state: "skipped",
      error: "kept: the map is already at phase 5",
    });
    const at4 = new Stage4Card();
    at4.values.set(MAP_FIELD, mapUrl(4));
    expect(
      (
        await run4(
          at4,
          await stage4Item("map_phase4", {
            fieldId: MAP_FIELD,
            phase: 4,
            value: mapUrl(4),
          }),
        )
      ).out.state,
    ).toBe("delivered");
    expect(at4.writes()).toEqual([]);
    const near = new Stage4Card();
    const moved = await run4(
      near,
      await stage4Item("map_phase3", {
        fieldId: MAP_FIELD,
        phase: 3,
        value: mapUrl(3),
      }),
    );
    expect(moved.out.state).toBe("delivered");
    expect(near.writes()).toEqual([
      {
        method: "POST",
        path: `task/${CARD}/field/${MAP_FIELD}`,
        body: { value: mapUrl(3) },
      },
    ]);
  });

  it("the handoff and raw answers comments post Make's text alone, with no Cockpit ref, once, read back by id", async () => {
    for (const [key, text] of [
      ["handoff_comment", HANDOFF4],
      ["raw_answers_comment", RAW4],
    ] as const) {
      const card = new Stage4Card();
      const { out, step } = await run4(
        card,
        await stage4Item(key, { comment_text: text }),
      );
      expect(step).toEqual({
        key,
        type: "comment",
        taskId: CARD,
        text,
        marker: MARKER,
      });
      expect(out.state).toBe("delivered");
      expect(card.writes()).toEqual([
        {
          method: "POST",
          path: `task/${CARD}/comment`,
          body: { comment_text: text, notify_all: false },
        },
      ]);
      expect(card.comments.map(c => c.comment_text)).toEqual([text]);
      expect(out.progress.steps[key]).toMatchObject({
        state: "done",
        commentId: card.comments[0].id,
      });
      expect(JSON.stringify(out.progress)).not.toContain("Block 1");
    }
  });

  it("resume after a POST ClickUp did not answer: found by its text as ClickUp hands it back, behind 27 newer notes, never posted twice", async () => {
    const cards = new FakeCards();
    cards.comments.push({
      id: "90cm-landed",
      comment_text: asClickUpReturns(HANDOFF4),
      date: String(NOW - 3 * 60_000),
    });
    cards.addComments(27, NOW - 60_000);
    const { out } = await run(
      cards,
      await stage4Item(
        "handoff_comment",
        { comment_text: HANDOFF4 },
        { progress: startedAt("handoff_comment", 4) },
      ),
    );
    expect(out.state).toBe("delivered");
    expect(out.progress.steps.handoff_comment).toMatchObject({
      state: "done",
      commentId: "90cm-landed",
    });
    expect(cards.writes()).toEqual([]);
  });

  it("resume after a POST ClickUp answered: found by its id alone; gone, it is never posted again", async () => {
    const cards = new FakeCards();
    cards.comments.push({
      id: "90cm-landed",
      comment_text: "Edited in ClickUp by a person",
      date: String(NOW - 3 * 60_000),
    });
    const withId = startedAt("raw_answers_comment", 4, "90cm-landed");
    const { out } = await run(
      cards,
      await stage4Item(
        "raw_answers_comment",
        { comment_text: RAW4 },
        { progress: withId },
      ),
    );
    expect(out.progress.steps.raw_answers_comment).toMatchObject({
      state: "done",
      commentId: "90cm-landed",
    });
    expect(cards.writes()).toEqual([]);
    // The same text on the card under another id is not it: ClickUp gave this one its own id.
    const again = new FakeCards();
    again.comments.push({
      id: "90cm-other",
      comment_text: RAW4,
      date: String(NOW - 3 * 60_000),
    });
    const lost = await run(
      again,
      await stage4Item(
        "raw_answers_comment",
        { comment_text: RAW4 },
        { progress: withId },
      ),
    );
    expect(lost.out).toMatchObject({
      state: "unknown",
      error: SAY_FORMS.textLost("raw onboarding answers comment"),
    });
    expect(again.writes()).toEqual([]);
  });

  it("a different comment with similar text, or the same text from before the step, is never taken for it", async () => {
    const cards = new FakeCards();
    const lines = HANDOFF4.split("\n");
    cards.comments.push(
      {
        id: "c-early",
        comment_text: HANDOFF4,
        date: String(NOW - 6 * 60_000),
      },
      {
        id: "c-short",
        comment_text: lines.slice(0, -1).join("\n"),
        date: String(NOW - 3 * 60_000),
      },
      {
        id: "c-long",
        comment_text: `${HANDOFF4}\n*Extra:* one more line`,
        date: String(NOW - 2 * 60_000),
      },
      {
        id: "c-word",
        comment_text: HANDOFF4.replace("Block 1", "Block 7"),
        date: String(NOW - 2 * 60_000 + 1),
      },
      {
        id: "c-other-ref",
        comment_text: `${HANDOFF4}\n\nCockpit ref F-0000000000`,
        date: String(NOW - 2 * 60_000 + 2),
      },
    );
    const { out } = await run(
      cards,
      await stage4Item(
        "handoff_comment",
        { comment_text: HANDOFF4 },
        { progress: startedAt("handoff_comment", 4) },
      ),
    );
    expect(out.state).toBe("delivered");
    expect(cards.writes()).toEqual([
      {
        method: "POST",
        path: `task/${CARD}/comment`,
        body: { comment_text: HANDOFF4, notify_all: false },
      },
    ]);
    expect(out.progress.steps.handoff_comment.commentId).toMatch(/^90cm/);
  });

  it("a comment the writer before this one started is found by its marker; one it froze is posted without it", async () => {
    // Its post landed with the ref line, then its answer was lost.
    const cards = new FakeCards();
    cards.comments.push({
      id: "90cm-old",
      comment_text: `${HANDOFF4}\n\n${MARKER}`,
      date: String(NOW - 10 * 60_000),
    });
    const old: FormStep = {
      key: "handoff_comment",
      type: "comment",
      taskId: CARD,
      text: `${HANDOFF4}\n\n${MARKER}`,
      marker: MARKER,
    };
    const resumed = await stage4Item(
      "handoff_comment",
      { comment_text: HANDOFF4 },
      { progress: startedAt("handoff_comment", 4) },
    );
    resumed.steps = [old];
    const found = await run(cards, resumed);
    expect(found.out.progress.steps.handoff_comment).toMatchObject({
      state: "done",
      commentId: "90cm-old",
    });
    expect(cards.writes()).toEqual([]);
    // Frozen by it, its post never landed: what goes now is Make's text alone.
    for (const progress of [{}, startedAt("handoff_comment", 4)]) {
      const fresh = new FakeCards();
      const it4 = await stage4Item(
        "handoff_comment",
        { comment_text: HANDOFF4 },
        { progress },
      );
      it4.steps = [old];
      const { out, step } = await run(fresh, it4);
      expect(step).toBe(old);
      expect(out.state).toBe("delivered");
      expect(fresh.writes().map(c => c.body?.comment_text)).toEqual([HANDOFF4]);
    }
  });

  it("the read-back after a post ClickUp answered goes by that id, however ClickUp rewrote the text", async () => {
    const cards = new FakeCards();
    const orig = cards.handle.bind(cards);
    cards.handle = async (c: Call) => {
      const r = await orig(c);
      // ClickUp keeps the comment in its own words: nothing a text match could find.
      if (c.method === "POST")
        for (const cm of cards.comments)
          cm.comment_text = "Rendered by ClickUp";
      return r;
    };
    const { out } = await run(
      cards,
      await stage4Item("raw_answers_comment", { comment_text: RAW4 }),
    );
    expect(out.state).toBe("delivered");
    expect(out.progress.steps.raw_answers_comment).toMatchObject({
      state: "done",
      commentId: cards.comments[0].id,
    });
  });

  it("a comment that does not read back after the post is unknown, and says the next run looks for it", async () => {
    const cards = new FakeCards();
    const orig = cards.handle.bind(cards);
    cards.handle = async (c: Call) => {
      const r = await orig(c);
      return c.method === "GET" && c.path.includes("/comment")
        ? { comments: [] }
        : r;
    };
    const { out } = await run(
      cards,
      await stage4Item("handoff_comment", { comment_text: HANDOFF4 }),
    );
    expect(out).toMatchObject({
      state: "unknown",
      error:
        "The kickoff handoff comment did not read back on the card. The next run looks for it.",
    });
    expect(out.progress.steps.handoff_comment).toMatchObject({
      state: "started",
      commentId: expect.any(String),
    });
  });

  it("the Client Profile is written whole: 6,000 characters with emoji pass to the write unchanged, and a long kickoff link too", async () => {
    const unit = "Revenue: 1,500 KWD 🚀 حولي  two spaces\nnext line\n";
    const body = unit.repeat(Math.floor(5990 / unit.length));
    const profile = `${body}${"x".repeat(6000 - body.length)}`;
    expect(profile.length).toBe(6000);
    const link = `https://example.com/kickoff#client=${"%D8%AD".repeat(1000)}`;
    expect(link.length).toBeGreaterThan(5000);
    const fields = [
      {
        fieldId: PROFILE,
        kind: "text",
        value: profile,
        label: "Client Profile",
      },
      {
        fieldId: KICKOFF_LINK,
        kind: "url",
        value: link,
        label: "Kickoff Form Link",
      },
    ];
    const card = new Stage4Card();
    const { out, step } = await run4(
      card,
      await stage4Item("profile_fields", { fields }),
    );
    expect(step).toMatchObject({ key: "profile_fields", fields });
    expect(out.state).toBe("delivered");
    expect(card.writes()).toEqual([
      {
        method: "POST",
        path: `task/${CARD}/field/${PROFILE}`,
        body: { value: profile },
      },
      {
        method: "POST",
        path: `task/${CARD}/field/${KICKOFF_LINK}`,
        body: { value: link },
      },
    ]);
    // The kind and https checks stay.
    for (const bad of [
      { ...fields[0], value: 6000 },
      { ...fields[1], value: `http://example.com/${"a".repeat(6000)}` },
      { ...fields[0], kind: "url" },
    ])
      expect(
        await formStep(await stage4Item("profile_fields", { fields: [bad] })),
      ).toEqual({ fail: SAY_FORMS.mismatch });
  });

  it("a held row shows words, never the text or a value", async () => {
    const it4 = await stage4Item("handoff_comment", {
      comment_text: "secret words",
    });
    expect(planForm(it4)).toEqual([
      {
        queueId: "q-handoff_comment",
        kind: "form",
        taskId: CARD,
        field: "Kickoff handoff comment",
        old: null,
        new: "12 characters",
      },
    ]);
    const map = await stage4Item("map_phase4", {
      fieldId: MAP_FIELD,
      phase: 4,
      value: mapUrl(4),
    });
    expect(planForm(map)[0]).toMatchObject({
      field: "Onboarding Map",
      new: "phase 4",
    });
  });
});

// --- card_facts (better-data plan B8): fill a card field only while the card leaves it empty ------------------

const CONSULT = "45fdd2ea-f83c-4721-bce7-2e6187a43541";
const ADS = "2de15aa5-7fe9-48bf-86a1-e4cfee1306c9";
const FATHOM = "abaa31ee-28ff-46f6-83bf-6c6d357a26d5";
const CALL_DATE = "ee9bf855-e05b-4afc-addf-1063cb54d3f0";
const WEBSITE = "5d57fdde-eb70-4610-a23b-88f718b4451d";
const BUDGET = "539743c2-b6cd-4eeb-bf2f-abaf64769a5e";
const GO_LIVE = "d4483463-840f-4730-ae7f-bfa77c5bb22a";
const HANDOFF = "e17a1c27-ec34-4f87-8796-3cf1f8fa80f9";
const SALES_LINK = "1f2e9ad1-98d8-410d-9994-ac6da91ff91d";
const optionOfName = (fieldId: string, name: string) =>
  Object.entries(CARD_FACTS[fieldId].options ?? {}).find(
    ([, n]) => n === name,
  )?.[0] as string;
const IN_OFFICE = optionOfName(CONSULT, "In Office");
const ONLINE = optionOfName(CONSULT, "Online");
const META = optionOfName(ADS, "Facebook/Meta");
const TIKTOK = optionOfName(ADS, "Tiktok");
const CALL_LINK = "https://fathom.video/share/invented-call-0001";
const SITE = "https://acme-interiors.example";

/** The five facts as the planner writes them: one of each kind, onlyIfEmpty, a source. Every value is invented. */
const facts = (): Row[] => [
  {
    fieldId: CONSULT,
    kind: "labels",
    label: "Consultation Types",
    optionIds: [IN_OFFICE, ONLINE],
    onlyIfEmpty: true,
    source: "kickoff: consultation types",
  },
  {
    fieldId: ADS,
    kind: "drop_down",
    label: "ADs Platform",
    optionId: META,
    onlyIfEmpty: true,
    source: "kickoff: ad platforms",
  },
  {
    fieldId: FATHOM,
    kind: "url",
    label: "Fathom",
    value: CALL_LINK,
    onlyIfEmpty: true,
    source: "kickoff: call recording",
  },
  {
    fieldId: CALL_DATE,
    kind: "date",
    label: "Onboarding Call Date",
    value: "2026-10-27",
    onlyIfEmpty: true,
    source: "kickoff: submitted day",
  },
  {
    fieldId: WEBSITE,
    kind: "url",
    label: "Company Website",
    value: SITE,
    onlyIfEmpty: true,
    source: "onboarding: website",
  },
];
const only = (...ids: string[]) => facts().filter(f => ids.includes(f.fieldId));

/**
 * One client card with the five fields, as ClickUp keeps them: labels as a list of option ids, a dropdown read back as
 * its orderindex, a link as sent, a date-only value at 03:00Z of its day. Last write wins, as on ClickUp.
 */
class FactsCard {
  calls: Call[] = [];
  values = new Map<string, unknown>();
  /** The list the card sits on: Clients - Mahara unless a test moves it. */
  list = CARDS_LIST;
  /** Answer this call with an error before ClickUp does anything. */
  fail?: (c: Call) => Error | undefined;
  /** A field whose writes ClickUp answers and never keeps. */
  dropField?: string;
  /** Another writer's value that lands right after our write to its field (theirs is last, so it stays). */
  raceAfterWrite?: { fieldId: string; value: unknown };
  fields: Row[] = [
    {
      id: CONSULT,
      name: "Consultation Types",
      type: "labels",
      type_config: {
        options: Object.entries(CARD_FACTS[CONSULT].options ?? {}).map(
          ([id, label]) => ({ id, label, color: null }),
        ),
      },
    },
    {
      id: ADS,
      name: "ADs Platform",
      type: "drop_down",
      type_config: {
        options: Object.entries(CARD_FACTS[ADS].options ?? {}).map(
          ([id, name], orderindex) => ({ id, name, orderindex }),
        ),
      },
    },
    { id: FATHOM, name: "Fathom", type: "url", type_config: {} },
    {
      id: CALL_DATE,
      name: "Onboarding Call Date",
      type: "date",
      type_config: {},
    },
    { id: WEBSITE, name: "Company Website", type: "url", type_config: {} },
    // Daily Budget (item 5, build B1): a ClickUp currency field kept in USD.
    {
      id: BUDGET,
      name: "Daily Budget",
      type: "currency",
      type_config: { currency_type: "USD", precision: 2 },
    },
    // The Client Profile (item 2) and the sale's three fields (item 6), each on Clients - Mahara.
    { id: PROFILE, name: "Client Profile", type: "text", type_config: {} },
    {
      id: GO_LIVE,
      name: "How soon do they want to go live?",
      type: "text",
      type_config: {},
    },
    {
      id: HANDOFF,
      name: "Is there any potential Client Success handoff problems that may occur?",
      type: "text",
      type_config: {},
    },
    {
      id: SALES_LINK,
      name: "Sales Meeting Link",
      type: "url",
      type_config: {},
    },
  ];
  provider(): Provider {
    return {
      call: async (_p, method, path, body) =>
        this.handle({ method, path, body }),
    };
  }
  writes() {
    return this.calls.filter(c => c.method !== "GET");
  }
  setDay(fieldId: string, day: string, hour = 3) {
    this.values.set(fieldId, String(Date.parse(`${day}T0${hour}:00:00Z`)));
  }
  private handle(c: Call): Row {
    this.calls.push(structuredClone(c));
    const failure = this.fail?.(c);
    if (failure) throw failure;
    if (c.method === "GET" && /^list\/\d+\/field$/.test(c.path))
      return { fields: structuredClone(this.fields) };
    const m = /^task\/([^/]+)(?:\/field\/([^/]+))?$/.exec(c.path);
    if (!m || (m[1] !== CARD && m[1] !== FORMS_TEST_CARD_ID))
      throw rejected(404);
    if (c.method === "GET" && !m[2])
      return {
        id: CARD,
        list: { id: this.list },
        custom_fields: this.fields.map(f => ({
          ...structuredClone(f),
          value: structuredClone(this.values.get(f.id)),
        })),
      };
    if (c.method === "POST" && m[2]) {
      const f = this.fields.find(x => x.id === m[2]);
      if (!f) throw rejected(400);
      const opts: Row[] = f.type_config?.options ?? [];
      const v = c.body?.value;
      let kept: unknown = v;
      if (f.type === "labels") {
        if (!Array.isArray(v) || v.some(id => !opts.some(o => o.id === id)))
          throw rejected(400);
      } else if (f.type === "drop_down") {
        const opt = opts.find(o => o.id === v);
        if (!opt) throw rejected(400);
        kept = opt.orderindex;
      } else if (f.type === "date") {
        if (c.body?.value_options?.time !== false) throw rejected(400);
        kept = String(
          Date.parse(
            `${new Date(Number(v)).toISOString().slice(0, 10)}T03:00:00Z`,
          ),
        );
      } else if (f.type === "currency") {
        // A money field takes a number and hands it back as a text, as ClickUp does.
        if (typeof v !== "number" || !Number.isFinite(v)) throw rejected(400);
        kept = String(v);
      } else if (f.type === "text") {
        if (typeof v !== "string") throw rejected(400);
      }
      if (this.dropField !== f.id) this.values.set(f.id, kept);
      if (this.raceAfterWrite?.fieldId === f.id) {
        this.values.set(f.id, this.raceAfterWrite.value);
        this.raceAfterWrite = undefined;
      }
      return {};
    }
    throw rejected(404);
  }
}
const FORMS_TEST_CARD_ID = "86eywg1cq";

async function factsItem(
  fields: Row[],
  over: { formKey?: string; progress?: Row; plan?: Row } = {},
): Promise<FormItem> {
  return stage4Item(
    "card_facts",
    { fields, lines: ["Card facts"], ...(over.plan ?? {}) },
    {
      payload: { formKey: over.formKey ?? "kickoff" },
      progress: over.progress,
    },
  );
}

/** Check, freeze and execute one card_facts row against the fake card; every progress save kept. */
async function runFacts(card: FactsCard, it: FormItem) {
  const checked = await formStep(it);
  if ("fail" in checked) throw new Error(checked.fail);
  const step = frozenStep(it, checked.step);
  if (!step) throw new Error("frozen step mismatch");
  const saves: Row[] = [];
  const out = await executeForm(
    it,
    step,
    card.provider(),
    async patch => {
      saves.push(structuredClone(patch));
    },
    () => NOW,
  );
  return { out, saves, step };
}
const receiptOf = (out: { progress: unknown }) =>
  (out.progress as Row).steps?.card_facts?.fields as Row;

describe("card_facts (plan B8): only empty fields, never over a card value", () => {
  it("formStep: the five fields on either form, each of its kind with onlyIfEmpty; the trail's names are the writer's", async () => {
    const ok = await formStep(await factsItem(facts()));
    expect(ok).toEqual({
      step: {
        key: "card_facts",
        type: "facts",
        taskId: CARD,
        fields: [
          {
            fieldId: CONSULT,
            kind: "labels",
            label: "Consultation Types",
            optionIds: [IN_OFFICE, ONLINE],
          },
          {
            fieldId: ADS,
            kind: "drop_down",
            label: "ADs Platform",
            optionId: META,
          },
          { fieldId: FATHOM, kind: "url", label: "Fathom", value: CALL_LINK },
          {
            fieldId: CALL_DATE,
            kind: "date",
            label: "Onboarding Call Date",
            day: "2026-10-27",
          },
          {
            fieldId: WEBSITE,
            kind: "url",
            label: "Company Website",
            value: SITE,
          },
        ],
      },
    });
    expect(
      "step" in
        (await formStep(
          await factsItem(only(WEBSITE), { formKey: "onboarding" }),
        )),
    ).toBe(true);
    expect(
      await formStep(await factsItem(facts(), { formKey: "checkin" })),
    ).toEqual({ fail: SAY_FORMS.mismatch });
    // A date as the planner may name it: a day, noon Kuwait in ms, or a call's starts_at with its zone.
    const dayOf = async (value: unknown, day?: string) => {
      const r = await formStep(
        await factsItem([
          { ...only(CALL_DATE)[0], value, ...(day ? { day } : {}) },
        ]),
      );
      return "step" in r && r.step.type === "facts"
        ? r.step.fields[0].day
        : null;
    };
    expect(await dayOf(noonKuwait("2026-10-27"))).toBe("2026-10-27");
    expect(await dayOf(String(noonKuwait("2026-10-27")), "2026-10-27")).toBe(
      "2026-10-27",
    );
    expect(await dayOf("2026-10-27T22:30:00Z")).toBe("2026-10-28"); // 01:30 Kuwait the next day
    expect(await dayOf("2026-10-27T10:00:00+03:00")).toBe("2026-10-27");
    for (const [value, day] of [
      ["2026-02-30", undefined],
      ["2026-10-27T10:00:00", undefined], // no zone: any day
      [1761552000, undefined], // seconds read as ms: 1970
      [noonKuwait("2026-10-27"), "2026-10-28"],
      ["27/10/2026", undefined],
      [null, undefined],
    ] as const)
      expect(await dayOf(value, day)).toBeNull();
  });

  it("an unknown field id, kind or option, or a field without onlyIfEmpty, fails the row with no call", async () => {
    const one = (patch: Row, base = facts()[0]) => [{ ...base, ...patch }];
    const bad: Row[][] = [
      // Fields outside the five: Client Happiness, a Make card field, an invented Country-like id.
      one({ fieldId: FORM_FIELDS.happiness }),
      one({ fieldId: STATUS, kind: "drop_down", optionId: META }),
      one({
        fieldId: "e0ca65e7-0000-4000-8000-000000000000",
        kind: "drop_down",
      }),
      // The wrong kind, or a value of another kind.
      one({ kind: "drop_down", optionId: IN_OFFICE }),
      one({ kind: "url", value: SITE }),
      // Options: unknown, empty, twice, by name only, another field's.
      one({ optionIds: ["00000000-0000-4000-8000-000000000000"] }),
      one({ optionIds: [] }),
      one({ optionIds: [IN_OFFICE, IN_OFFICE] }),
      one({ optionId: undefined, optionName: "Facebook/Meta" }, facts()[1]),
      one({ optionId: IN_OFFICE }, facts()[1]),
      one({ optionId: [META] }, facts()[1]),
      // onlyIfEmpty must be true itself.
      one({ onlyIfEmpty: undefined }),
      one({ onlyIfEmpty: false }),
      one({ onlyIfEmpty: "true" }),
      // A link not on https, or not a text.
      one({ value: "http://acme-interiors.example" }, facts()[4]),
      one({ value: "javascript:alert(1)" }, facts()[2]),
      one({ value: ["https://a.example"] }, facts()[4]),
      // No label; a field twice; nothing at all; more than five.
      one({ label: undefined }),
      [...only(FATHOM), ...only(FATHOM)],
      [],
      [...facts(), only(FATHOM)[0]],
    ];
    for (const fields of bad)
      expect(await formStep(await factsItem(fields))).toEqual({
        fail: SAY_FORMS.mismatch,
      });
    // No plan list at all.
    const none = await factsItem([]);
    none.effect!.plan = { taskId: CARD };
    expect(await formStep(none)).toEqual({ fail: SAY_FORMS.mismatch });
    // The fake card was never called: formStep makes no call, and run.ts fails a row it refuses before any.
    expect(new FactsCard().calls).toEqual([]);
  });

  it("empty fields are written once each and read back; the receipt says each was empty before", async () => {
    const card = new FactsCard();
    const { out, saves } = await runFacts(card, await factsItem(facts()));
    expect(out.state).toBe("delivered");
    expect(card.calls.map(c => `${c.method} ${c.path}`)).toEqual([
      `GET task/${CARD}`,
      `POST task/${CARD}/field/${CONSULT}`,
      `POST task/${CARD}/field/${ADS}`,
      `POST task/${CARD}/field/${FATHOM}`,
      `POST task/${CARD}/field/${CALL_DATE}`,
      `POST task/${CARD}/field/${WEBSITE}`,
      `GET task/${CARD}`,
    ]);
    expect(card.writes().map(c => c.body)).toEqual([
      { value: [IN_OFFICE, ONLINE] },
      { value: META },
      { value: CALL_LINK },
      // Noon Kuwait as a date-only value, as the check-in dates are; ClickUp keeps it at 03:00Z of the day.
      {
        value: Date.parse("2026-10-27T09:00:00Z"),
        value_options: { time: false },
      },
      { value: SITE },
    ]);
    expect(kuwaitDay(card.values.get(CALL_DATE))).toBe("2026-10-27");
    expect(card.values.get(ADS)).toBe(0); // the dropdown reads back as its orderindex
    const written = { before: "empty", state: "written" };
    expect(out.progress.steps.card_facts.state).toBe("done");
    // Nothing kept: no note on the row or the step.
    expect(out.note).toBeUndefined();
    expect(out.progress.steps.card_facts.note).toBeUndefined();
    expect(receiptOf(out)).toEqual({
      [CONSULT]: written,
      [ADS]: written,
      [FATHOM]: written,
      [CALL_DATE]: written,
      [WEBSITE]: written,
    });
    // The receipt was saved before the first write, every field due.
    const due = { before: "empty", state: "due" };
    const first = saves.find(
      s => s.progress?.steps?.card_facts?.state === "started",
    );
    expect(first?.progress.steps.card_facts.fields).toEqual({
      [CONSULT]: due,
      [ADS]: due,
      [FATHOM]: due,
      [CALL_DATE]: due,
      [WEBSITE]: due,
    });
    // No value, only states, in the progress the audit trigger copies.
    expect(JSON.stringify(out.progress)).not.toContain(SITE);
    expect(JSON.stringify(out.progress)).not.toContain(CALL_LINK);
    // A settled row is never written again.
    const again = await runFacts(
      card,
      await factsItem(facts(), { progress: out.progress as Row }),
    );
    expect(again.out.state).toBe("delivered");
    expect(again.out.note).toBeUndefined();
    expect(card.writes()).toHaveLength(5);
    expect(card.calls).toHaveLength(7);
  });

  it("a row that writes one field and keeps another is delivered with the kept sentence as its note, differs said; a rerun says it again", async () => {
    // Review (writer): the card already has Consultation Types = Online, the form says In Office, ADs Platform is empty.
    const card = new FactsCard();
    card.values.set(CONSULT, [ONLINE]);
    const plan = [
      { ...only(CONSULT)[0], optionIds: [IN_OFFICE] },
      ...only(ADS),
    ];
    const said =
      "kept: the card already has a value for Consultation Types; Consultation Types differs from the form, so check it on the card";
    const { out, saves } = await runFacts(card, await factsItem(plan));
    expect(out).toMatchObject({ state: "delivered", note: said });
    expect(card.writes()).toEqual([
      {
        method: "POST",
        path: `task/${CARD}/field/${ADS}`,
        body: { value: META },
      },
    ]);
    expect(card.values.get(CONSULT)).toEqual([ONLINE]);
    expect(out.progress.steps.card_facts).toMatchObject({
      state: "done",
      note: said,
      fields: {
        [CONSULT]: {
          before: "set",
          state: "kept",
          differs: true,
          note: SAY_FORMS.factDiffers,
        },
        [ADS]: { before: "empty", state: "written" },
      },
    });
    // The note is saved with the settled step, the progress the queue trigger copies into the effect's receipt.step.
    expect(saves.at(-1)?.progress.steps.card_facts.note).toBe(said);
    // A settled row read again says it again, with no call.
    const calls = card.calls.length;
    const again = await runFacts(
      card,
      await factsItem(plan, { progress: out.progress as Row }),
    );
    expect(again.out).toMatchObject({ state: "delivered", note: said });
    expect(card.calls).toHaveLength(calls);
    // The same value kept beside a write: the kept sentence alone, no "differs".
    const same = new FactsCard();
    same.values.set(FATHOM, CALL_LINK);
    expect(
      (await runFacts(same, await factsItem(only(FATHOM, WEBSITE)))).out,
    ).toMatchObject({
      state: "delivered",
      note: "kept: the card already has a value for Fathom",
    });
  });

  it("a set field is kept: the same value with no note, another value with one; only the empty ones are written", async () => {
    const card = new FactsCard();
    card.values.set(CONSULT, [ONLINE, IN_OFFICE]); // the same two, in another order
    card.values.set(ADS, 1); // Tiktok, by orderindex: the form says Facebook/Meta
    card.setDay(CALL_DATE, "2026-10-27", 4); // the same Kuwait day at another hour
    card.values.set(WEBSITE, "https://another-site.example");
    const { out } = await runFacts(card, await factsItem(facts()));
    expect(out).toMatchObject({
      state: "delivered",
      note: "kept: the card already has a value for Consultation Types, ADs Platform, Onboarding Call Date and Company Website; ADs Platform and Company Website differ from the form, so check them on the card",
    });
    expect(card.writes()).toEqual([
      {
        method: "POST",
        path: `task/${CARD}/field/${FATHOM}`,
        body: { value: CALL_LINK },
      },
    ]);
    expect(receiptOf(out)).toEqual({
      [CONSULT]: { before: "set", state: "kept" },
      [ADS]: {
        before: "set",
        state: "kept",
        differs: true,
        note: SAY_FORMS.factDiffers,
      },
      [FATHOM]: { before: "empty", state: "written" },
      [CALL_DATE]: { before: "set", state: "kept" },
      [WEBSITE]: {
        before: "set",
        state: "kept",
        differs: true,
        note: SAY_FORMS.factDiffers,
      },
    });
    expect(card.values.get(ADS)).toBe(1);
    expect(card.values.get(WEBSITE)).toBe("https://another-site.example");
    // A labels field that holds fewer labels is set: never added to.
    const fewer = new FactsCard();
    fewer.values.set(CONSULT, [IN_OFFICE]);
    const r = await runFacts(fewer, await factsItem(only(CONSULT)));
    expect(fewer.writes()).toEqual([]);
    expect(receiptOf(r.out)[CONSULT]).toMatchObject({
      before: "set",
      state: "kept",
      differs: true,
    });
  });

  it("nothing to write reads skipped with the trail's kept sentence; a retry reads it again with no call", async () => {
    const card = new FactsCard();
    card.values.set(CONSULT, [IN_OFFICE, ONLINE]);
    card.values.set(ADS, 1);
    const said =
      "kept: the card already has a value for Consultation Types and ADs Platform; ADs Platform differs from the form, so check it on the card";
    const { out } = await runFacts(card, await factsItem(only(CONSULT, ADS)));
    expect(out).toMatchObject({ state: "skipped", error: said });
    expect(card.writes()).toEqual([]);
    expect(out.progress.steps.card_facts).toMatchObject({
      state: "skipped",
      fields: {
        [CONSULT]: { before: "set", state: "kept" },
        [ADS]: { before: "set", state: "kept", differs: true },
      },
    });
    const calls = card.calls.length;
    const again = await runFacts(
      card,
      await factsItem(only(CONSULT, ADS), { progress: out.progress as Row }),
    );
    expect(again.out).toMatchObject({ state: "skipped", error: said });
    expect(card.calls).toHaveLength(calls);
    // The same value alone: no "differs".
    const same = new FactsCard();
    same.values.set(FATHOM, CALL_LINK);
    expect(
      (await runFacts(same, await factsItem(only(FATHOM)))).out,
    ).toMatchObject({
      state: "skipped",
      error: "kept: the card already has a value for Fathom",
    });
    expect(SAY_FORMS.factsKept(["A", "B", "C"], ["B", "C"])).toBe(
      "kept: the card already has a value for A, B and C; B and C differ from the form, so check them on the card",
    );
  });

  it("a race: another value fills the field between the read and the read-back; it is kept with a note, never written twice", async () => {
    const card = new FactsCard();
    card.raceAfterWrite = {
      fieldId: FATHOM,
      value: "https://fathom.video/share/another-call",
    };
    const { out } = await runFacts(
      card,
      await factsItem(only(FATHOM, WEBSITE)),
    );
    expect(out).toMatchObject({
      state: "delivered",
      note: "kept: the card already has a value for Fathom; Fathom differs from the form, so check it on the card",
    });
    expect(receiptOf(out)).toEqual({
      [FATHOM]: {
        before: "empty",
        state: "kept",
        differs: true,
        note: SAY_FORMS.factRaced,
      },
      [WEBSITE]: { before: "empty", state: "written" },
    });
    expect(card.writes()).toHaveLength(2);
    expect(card.values.get(FATHOM)).toBe(
      "https://fathom.video/share/another-call",
    );
    // The raced field alone: nothing of ours stayed, so skipped with the sentence, not unknown.
    const alone = new FactsCard();
    alone.raceAfterWrite = {
      fieldId: FATHOM,
      value: "https://fathom.video/share/another-call",
    };
    expect(
      (await runFacts(alone, await factsItem(only(FATHOM)))).out,
    ).toMatchObject({
      state: "skipped",
      error:
        "kept: the card already has a value for Fathom; Fathom differs from the form, so check it on the card",
    });
    expect(alone.writes()).toHaveLength(1);
    // An earlier run's write went unanswered and another value is there now: kept, no second write.
    const resumed = new FactsCard();
    resumed.values.set(FATHOM, "https://fathom.video/share/another-call");
    const progress = {
      steps: {
        card_facts: {
          state: "started",
          at: new Date(NOW - 60_000).toISOString(),
          startedAt: new Date(NOW - 60_000).toISOString(),
          fields: { [FATHOM]: { before: "empty", state: "due" } },
        },
      },
    };
    const r = await runFacts(
      resumed,
      await factsItem(only(FATHOM), { progress }),
    );
    expect(r.out.state).toBe("skipped");
    expect(receiptOf(r.out)[FATHOM]).toEqual({
      before: "empty",
      state: "kept",
      differs: true,
      note: SAY_FORMS.factRaced,
    });
    expect(resumed.writes()).toEqual([]);
  });

  it("a write that does not read back is unknown; the next run reads first, never takes its own value for the card's, and writes only what is still empty", async () => {
    const card = new FactsCard();
    card.dropField = WEBSITE;
    const first = await runFacts(card, await factsItem(only(FATHOM, WEBSITE)));
    expect(first.out).toMatchObject({
      state: "unknown",
      error: SAY_FORMS.notBack("Company Website", "written"),
    });
    expect(first.out.progress.steps.card_facts).toMatchObject({
      state: "started",
      fields: {
        [FATHOM]: { before: "empty", state: "written" },
        [WEBSITE]: { before: "empty", state: "due" },
      },
    });
    card.dropField = undefined;
    card.calls = [];
    const next = await runFacts(
      card,
      await factsItem(only(FATHOM, WEBSITE), {
        progress: first.out.progress as Row,
      }),
    );
    expect(next.out.state).toBe("delivered");
    // Fathom now holds this writer's own value: still "empty before", and not written again.
    expect(card.writes()).toEqual([
      {
        method: "POST",
        path: `task/${CARD}/field/${WEBSITE}`,
        body: { value: SITE },
      },
    ]);
    expect(receiptOf(next.out)).toEqual({
      [FATHOM]: { before: "empty", state: "written" },
      [WEBSITE]: { before: "empty", state: "written" },
    });
    // ClickUp kept the late write after all: read back, nothing written.
    const late = new FactsCard();
    late.values.set(WEBSITE, SITE);
    const r = await runFacts(
      late,
      await factsItem(only(WEBSITE), {
        progress: {
          steps: {
            card_facts: {
              state: "started",
              at: new Date(NOW).toISOString(),
              fields: { [WEBSITE]: { before: "empty", state: "due" } },
            },
          },
        },
      }),
    );
    expect(r.out.state).toBe("delivered");
    expect(late.writes()).toEqual([]);
    expect(receiptOf(r.out)[WEBSITE]).toEqual({
      before: "empty",
      state: "written",
    });
  });

  it("a 429 on a later write keeps the receipt and reads unknown; on the first write of a fresh step it starts clean", async () => {
    const card = new FactsCard();
    card.fail = c =>
      c.method === "POST" && c.path.endsWith(WEBSITE)
        ? rejected(429)
        : undefined;
    const first = await runFacts(card, await factsItem(only(FATHOM, WEBSITE)));
    expect(first.out.state).toBe("unknown");
    expect(first.out.progress.steps.card_facts).toMatchObject({
      state: "started",
      fields: {
        [FATHOM]: { before: "empty", state: "due" },
        [WEBSITE]: { before: "empty", state: "due" },
      },
    });
    card.fail = undefined;
    const next = await runFacts(
      card,
      await factsItem(only(FATHOM, WEBSITE), {
        progress: first.out.progress as Row,
      }),
    );
    expect(next.out.state).toBe("delivered");
    expect(receiptOf(next.out)).toEqual({
      [FATHOM]: { before: "empty", state: "written" },
      [WEBSITE]: { before: "empty", state: "written" },
    });
    expect(card.writes().map(c => c.path)).toEqual([
      `task/${CARD}/field/${FATHOM}`,
      `task/${CARD}/field/${WEBSITE}`, // refused (429): never landed
      `task/${CARD}/field/${WEBSITE}`,
    ]);
    // The first write of a fresh step refused with a 429: nothing landed, so the step starts clean.
    const fresh = new FactsCard();
    fresh.fail = c => (c.method === "POST" ? rejected(429) : undefined);
    const r = await runFacts(fresh, await factsItem(only(FATHOM, WEBSITE)));
    expect(r.out.state).toBe("retry");
    expect(r.out.progress.steps.card_facts).toBeUndefined();
    // A resumed step keeps its receipt even on its first write.
    const resumed = new FactsCard();
    resumed.values.set(FATHOM, CALL_LINK);
    resumed.fail = c => (c.method === "POST" ? rejected(429) : undefined);
    const again = await runFacts(
      resumed,
      await factsItem(only(FATHOM, WEBSITE), {
        progress: first.out.progress as Row,
      }),
    );
    expect(again.out.state).toBe("unknown");
    expect(again.out.progress.steps.card_facts.fields[FATHOM]).toEqual({
      before: "empty",
      state: "written",
    });
  });

  it("an option ClickUp no longer has, or a field gone from the card, fails before any write", async () => {
    const card = new FactsCard();
    card.fields[1].type_config.options =
      card.fields[1].type_config.options.filter((o: Row) => o.id !== TIKTOK);
    const tiktok = [{ ...only(ADS)[0], optionId: TIKTOK }, ...only(FATHOM)];
    expect((await runFacts(card, await factsItem(tiktok))).out).toMatchObject({
      state: "failed",
      error: SAY_FORMS.noFieldOption("ADs Platform", "Tiktok"),
    });
    expect(card.writes()).toEqual([]);
    // Set already, the field is kept whatever its options: Fathom is written.
    card.values.set(ADS, 0);
    expect((await runFacts(card, await factsItem(tiktok))).out.state).toBe(
      "delivered",
    );
    expect(card.writes().map(c => c.path)).toEqual([
      `task/${CARD}/field/${FATHOM}`,
    ]);
    const gone = new FactsCard();
    gone.fields = gone.fields.filter(f => f.id !== WEBSITE);
    expect(
      (await runFacts(gone, await factsItem(only(FATHOM, WEBSITE)))).out,
    ).toMatchObject({
      state: "failed",
      error: SAY_FORMS.noField("Company Website"),
    });
    expect(gone.writes()).toEqual([]);
    // Off the Clients - Mahara list: failed, nothing written (readCard).
  });

  it("a held row shows words; the doctor names a missing field, a field of another kind and a missing option", async () => {
    expect(planForm(await factsItem(only(FATHOM, WEBSITE)))).toEqual([
      {
        queueId: "q-card_facts",
        kind: "form",
        taskId: CARD,
        field: "Empty card fields filled from the answers",
        old: null,
        new: "up to 2, each only where the card is empty",
      },
    ]);
    const mine = (problems: string[]) =>
      problems.filter(p =>
        /Consultation Types|ADs Platform|Fathom|Onboarding Call Date|Company Website|Card facts/.test(
          p,
        ),
      );
    const card = new FactsCard();
    const inputs = {};
    expect(
      mine(
        (await formsDoctorChecks(inputs, card.provider(), [], ["kickoff"]))
          .problems,
      ),
    ).toEqual([]);
    // Off for check-in alone.
    const off = new FactsCard();
    off.fields = [];
    expect(
      mine(
        (await formsDoctorChecks(inputs, off.provider(), [], ["checkin"]))
          .problems,
      ),
    ).toEqual([]);
    const broken = new FactsCard();
    broken.fields = broken.fields.filter(f => f.id !== WEBSITE);
    broken.fields[1] = { ...broken.fields[1], type: "labels" };
    broken.fields[0].type_config.options =
      broken.fields[0].type_config.options.filter((o: Row) => o.id !== ONLINE);
    expect(
      mine(
        (await formsDoctorChecks(inputs, broken.provider(), [], ["onboarding"]))
          .problems,
      ),
    ).toEqual([
      'Consultation Types has no "Online" option in ClickUp any more, so a card facts write with it would fail.',
      "ADs Platform is a labels field in ClickUp, not drop_down, so card facts would not write it.",
      "Card facts write Company Website (5d57fdde), which is not on the Clients - Mahara list.",
    ]);
  });
});

// --- Build B1 (next-design plan items 2, 5 and 6): profile_backfill, the Daily Budget and sale_facts -------------
// Every client, text and link here is invented. The field ids are ClickUp's own (Clients - Mahara), no secret.

/** Make 13 [29]'s Client Profile in its seven labels, with invented answers: a line break, an emoji, Arabic and the
 * trailing space Make leaves after an empty last answer. */
const PROFILE_TEXT = [
  "Last Year's Total Revenue: 120000",
  "",
  "90-Day Goal Revenue: 45000",
  "",
  "12-24 Month Revenue Goal: 300000",
  "",
  "Marketing they've tried A-Z: Flyers,\nan invented radio spot",
  "",
  "Top 3 challenges: Leads 🛋️, staff, السعر",
  "",
  "Why they joined: An invented referral",
  "",
  "Additional notes: ",
].join("\n");
const OTHER_PROFILE = PROFILE_TEXT.replace("120000", "99000");

/** A profile_backfill row as the claim returns it: the text only in the effect's plan, its sha256 in the payload. */
async function backfillItem(
  over: {
    value?: string;
    fields?: Row[];
    payload?: Row;
    progress?: Row;
  } = {},
): Promise<FormItem> {
  const value = over.value ?? PROFILE_TEXT;
  const fields = over.fields ?? [
    {
      fieldId: PROFILE,
      kind: "text",
      label: "Client Profile",
      value,
      onlyIfEmpty: true,
    },
  ];
  const plan = { taskId: CARD, fields };
  return {
    id: "q-profile_backfill",
    kind: "form",
    attempts: 1,
    created_at: new Date(NOW - 60_000).toISOString(),
    task_id: CARD,
    steps: null,
    progress: over.progress ?? {},
    payload: {
      formKey: "onboarding",
      effectKey: "profile_backfill",
      effectId: "e-profile_backfill",
      responseId: RESPONSE,
      taskId: CARD,
      valueChars: value.length,
      valueSha256: await sha256(value),
      ...(over.payload ?? {}),
    },
    effect: { id: "e-profile_backfill", state: "queued", plan },
  };
}

/** A sale_facts row as the claim returns it: the values only in the effect's plan, never in the payload. */
function saleItem(
  fields: Row[],
  over: { formKey?: string; progress?: Row } = {},
): FormItem {
  return {
    id: "q-sale_facts",
    kind: "form",
    attempts: 1,
    created_at: new Date(NOW - 60_000).toISOString(),
    task_id: CARD,
    steps: null,
    progress: over.progress ?? {},
    payload: {
      formKey: over.formKey ?? "new_client",
      effectKey: "sale_facts",
      effectId: "e-sale_facts",
      responseId: RESPONSE,
      taskId: CARD,
    },
    effect: {
      id: "e-sale_facts",
      state: "queued",
      plan: { taskId: CARD, fields },
    },
  };
}
const GO_LIVE_TEXT = "In two weeks,\nafter the invented shop opening";
const sale = (): Row[] => [
  {
    fieldId: GO_LIVE,
    kind: "text",
    label: "Go live",
    value: GO_LIVE_TEXT,
    onlyIfEmpty: true,
    source: "new_client: e30bc458",
  },
  {
    fieldId: HANDOFF,
    kind: "text",
    label: "Handoff problems",
    value: "No",
    onlyIfEmpty: true,
    source: "new_client: 3cf4bfdf",
  },
  {
    fieldId: SALES_LINK,
    kind: "url",
    label: "Sales Meeting Link",
    value: "https://fathom.video/share/invented-sale-call",
    onlyIfEmpty: true,
    source: "new_client: 52ca9be9",
  },
];
const budget = (value: unknown): Row => ({
  fieldId: BUDGET,
  kind: "currency",
  label: "Daily Budget",
  value,
  onlyIfEmpty: true,
  source: "kickoff",
});
const steps = (out: { progress: unknown }, key: string) =>
  (out.progress as Row).steps?.[key] as Row;
const MISMATCH = { fail: SAY_FORMS.mismatch };

describe("build B1: the lanes (CLICKUP_WRITEBACK_FORMS_KEYS)", () => {
  it("lists new_client and profile_backfill; a row's lane is profile_backfill for a backfill row, else its form", () => {
    expect([...FORMS_FORM_KEYS]).toEqual([
      "checkin",
      "kickoff",
      "onboarding",
      "new_client",
      "profile_backfill",
    ]);
    const keys = formsKeysGate(n =>
      n === "CLICKUP_WRITEBACK_FORMS_KEYS"
        ? "checkin,new_client,profile_backfill"
        : undefined,
    );
    expect(keys.error).toBeNull();
    expect(keys.has("profile_backfill")).toBe(true);
    expect(keys.has("new_client")).toBe(true);
    expect(keys.has("onboarding")).toBe(false);
    expect(
      formLane({ formKey: "onboarding", effectKey: "profile_backfill" }),
    ).toBe("profile_backfill");
    expect(formLane({ formKey: "onboarding", effectKey: "card_facts" })).toBe(
      "onboarding",
    );
    expect(formLane({ formKey: "new_client", effectKey: "sale_facts" })).toBe(
      "new_client",
    );
    expect(formLane({ effectKey: "happiness" })).toBe("checkin");
    expect(formLane(undefined)).toBe("checkin");
    expect(SAY_FORMS.heldForm("profile_backfill")).toBe(
      "Held: profile_backfill card writes are not switched on.",
    );
    expect(STAGE4_KEYS).toContain("profile_backfill");
    expect(STAGE4_KEYS).toContain("sale_facts");
  });
});

describe("build B1: the allowlists, each key only its own", () => {
  it("SALE_FACTS holds exactly its three ids; PROFILE_BACKFILL the Client Profile alone; CARD_FACTS gains Daily Budget alone", () => {
    expect(SALE_FACTS).toEqual({
      "d4483463-840f-4730-ae7f-bfa77c5bb22a": {
        kind: "text",
        label: "Go-live expectation",
      },
      "e17a1c27-ec34-4f87-8796-3cf1f8fa80f9": {
        kind: "text",
        label: "Handoff problems",
      },
      "1f2e9ad1-98d8-410d-9994-ac6da91ff91d": {
        kind: "url",
        label: "Sales Meeting Link",
      },
    });
    expect(PROFILE_BACKFILL).toEqual({
      [CLIENT_PROFILE_FIELD]: { kind: "text", label: "Client Profile" },
    });
    expect(CLIENT_PROFILE_FIELD).toBe(PROFILE);
    expect(Object.keys(CARD_FACTS).map(id => id.slice(0, 8))).toEqual([
      "45fdd2ea",
      "2de15aa5",
      "abaa31ee",
      "ee9bf855",
      "5d57fdde",
      "539743c2",
    ]);
    expect(CARD_FACTS[BUDGET]).toEqual({
      kind: "currency",
      label: "Daily Budget",
    });
    // Never written by the sale's facts or the backfill: the Closer, Closer Notes, Daily Budget, Country, Email, Phone
    // Number, Payment Plan, Next Payment, Billing and the transcript (sale-tie.md 2.8); never by card_facts: Country.
    const never = [
      "63af118b",
      "890d4ab8",
      "539743c2",
      "e0ca65e7",
      "a90c8230",
      "085d5e18",
      "17d17129",
      "f071ee8f",
      "f9bdf6b8",
      "68f71f79",
    ];
    for (const list of [SALE_FACTS, PROFILE_BACKFILL])
      expect(
        Object.keys(list).filter(id => never.includes(id.slice(0, 8))),
      ).toEqual([]);
    expect(
      Object.keys(CARD_FACTS).filter(id =>
        ["e0ca65e7", "63af118b", "890d4ab8"].includes(id.slice(0, 8)),
      ),
    ).toEqual([]);
    // No id is on two lists.
    const all = Object.values(FACTS_ALLOWED).flatMap(l => Object.keys(l));
    expect(new Set(all).size).toBe(all.length);
  });

  it("a key never takes another key's field, or another form's row; each refusal makes no call", async () => {
    const card = new FactsCard();
    const kickoffFacts = (fields: Row[]) => factsItem(fields);
    const cases: [string, FormItem][] = [
      // sale_facts from a kickoff or an onboarding row.
      ["sale_facts from a kickoff", saleItem(sale(), { formKey: "kickoff" })],
      [
        "sale_facts from an onboarding",
        saleItem(sale(), { formKey: "onboarding" }),
      ],
      // card_facts from the sale.
      [
        "card_facts from new_client",
        await factsItem(only(FATHOM), { formKey: "new_client" }),
      ],
      // A card_facts field on sale_facts, the Closer, the Client Profile or Daily Budget.
      ["a card_facts link on sale_facts", saleItem(only(FATHOM))],
      [
        "the Closer on sale_facts",
        saleItem([
          {
            ...sale()[0],
            fieldId: "63af118b-bb16-48ba-9ddb-d0185b32fb23",
          },
        ]),
      ],
      [
        "the Client Profile on sale_facts",
        saleItem([{ ...sale()[0], fieldId: PROFILE }]),
      ],
      ["Daily Budget on sale_facts", saleItem([budget(40)])],
      // A sale field, or the Client Profile, on card_facts.
      ["a sale text on card_facts", await kickoffFacts([sale()[0]])],
      ["the sales link on card_facts", await kickoffFacts([sale()[2]])],
      [
        "the Client Profile on card_facts",
        await kickoffFacts([
          {
            fieldId: PROFILE,
            kind: "text",
            label: "Client Profile",
            value: PROFILE_TEXT,
            onlyIfEmpty: true,
          },
        ]),
      ],
      // A sale field on profile_backfill, even in the profile's shape.
      [
        "a sale field on profile_backfill",
        await backfillItem({
          fields: [
            {
              fieldId: GO_LIVE,
              kind: "text",
              label: "Client Profile",
              value: PROFILE_TEXT,
              onlyIfEmpty: true,
            },
          ],
        }),
      ],
      // sale_facts' own checks: a link not on https, a blank text, a text sent as a link, no onlyIfEmpty, twice.
      [
        "an http sales link",
        saleItem([{ ...sale()[2], value: "http://fathom.video/share/x" }]),
      ],
      ["a blank text", saleItem([{ ...sale()[0], value: "  \n " }])],
      ["a text as a link", saleItem([{ ...sale()[0], kind: "url" }])],
      ["no onlyIfEmpty", saleItem([{ ...sale()[1], onlyIfEmpty: undefined }])],
      ["a field twice", saleItem([sale()[0], sale()[0]])],
      ["no field", saleItem([])],
      ["four fields", saleItem([...sale(), sale()[0]])],
    ];
    for (const [name, it] of cases)
      expect([name, await formStep(it)]).toEqual([name, MISMATCH]);
    expect(card.calls).toEqual([]);
  });
});

describe("build B1: profile_backfill (item 2), Make's Client Profile only into an empty one", () => {
  it("formStep: one field, the Client Profile, a text with Make's seven labels whose sha256 is the payload's", async () => {
    expect(PROFILE_LABELS.test(PROFILE_TEXT)).toBe(true);
    expect(await formStep(await backfillItem())).toEqual({
      step: {
        key: "profile_backfill",
        type: "facts",
        taskId: CARD,
        fields: [
          {
            fieldId: PROFILE,
            kind: "text",
            label: "Client Profile",
            value: PROFILE_TEXT,
          },
        ],
      },
    });
    const card = new FactsCard();
    const field = {
      fieldId: PROFILE,
      kind: "text",
      label: "Client Profile",
      value: PROFILE_TEXT,
      onlyIfEmpty: true,
    };
    const swapped = PROFILE_TEXT.replace(
      "Top 3 challenges: Leads 🛋️, staff, السعر\n\nWhy they joined: An invented referral",
      "Why they joined: An invented referral\n\nTop 3 challenges: Leads 🛋️, staff, السعر",
    );
    const bad: [string, FormItem][] = [
      [
        "the sha256 of another text",
        await backfillItem({
          payload: { valueSha256: await sha256(OTHER_PROFILE) },
        }),
      ],
      [
        "no sha256",
        await backfillItem({ payload: { valueSha256: undefined } }),
      ],
      [
        "a text without Make's labels",
        await backfillItem({ value: "An invented free-text profile" }),
      ],
      ["the labels out of order", await backfillItem({ value: swapped })],
      [
        "a label missing",
        await backfillItem({
          value: PROFILE_TEXT.replace("\n\nAdditional notes: ", ""),
        }),
      ],
      [
        "a revenue over two lines",
        await backfillItem({
          value: PROFILE_TEXT.replace("120000", "120000\nand more"),
        }),
      ],
      [
        "two fields",
        await backfillItem({
          fields: [field, { ...field, fieldId: KICKOFF_LINK, kind: "url" }],
        }),
      ],
      ["the field twice", await backfillItem({ fields: [field, field] })],
      [
        "the Kickoff Form Link",
        await backfillItem({
          fields: [
            {
              ...field,
              fieldId: KICKOFF_LINK,
              kind: "url",
              value: "https://x.example",
            },
          ],
        }),
      ],
      [
        "no onlyIfEmpty",
        await backfillItem({ fields: [{ ...field, onlyIfEmpty: undefined }] }),
      ],
      [
        "onlyIfEmpty false",
        await backfillItem({ fields: [{ ...field, onlyIfEmpty: false }] }),
      ],
      ["kind url", await backfillItem({ fields: [{ ...field, kind: "url" }] })],
      [
        "a kickoff row",
        await backfillItem({ payload: { formKey: "kickoff" } }),
      ],
      [
        "a new_client row",
        await backfillItem({ payload: { formKey: "new_client" } }),
      ],
      ["no field", await backfillItem({ fields: [] })],
    ];
    for (const [name, it] of bad)
      expect([name, await formStep(it)]).toEqual([name, MISMATCH]);
    expect(card.calls).toEqual([]);
  });

  it("an empty Client Profile is written once and read back: three calls, the receipt saved before the write, no text in progress", async () => {
    const card = new FactsCard();
    const { out, saves } = await runFacts(card, await backfillItem());
    expect(out.state).toBe("delivered");
    expect(out.note).toBeUndefined();
    expect(card.calls.map(c => `${c.method} ${c.path}`)).toEqual([
      `GET task/${CARD}`,
      `POST task/${CARD}/field/${PROFILE}`,
      `GET task/${CARD}`,
    ]);
    // The text whole, line breaks, emoji, Arabic and the trailing space included.
    expect(card.writes()[0].body).toEqual({ value: PROFILE_TEXT });
    expect(steps(out, "profile_backfill")).toMatchObject({
      state: "done",
      fields: { [PROFILE]: { before: "empty", state: "written" } },
    });
    const first = saves.find(
      s => s.progress?.steps?.profile_backfill?.state === "started",
    );
    expect(first?.progress.steps.profile_backfill.fields).toEqual({
      [PROFILE]: { before: "empty", state: "due" },
    });
    for (const s of saves)
      expect(JSON.stringify(s)).not.toContain("invented radio spot");
    // Settled: read again, no call.
    const again = await runFacts(
      card,
      await backfillItem({ progress: out.progress as Row }),
    );
    expect(again.out.state).toBe("delivered");
    expect(card.calls).toHaveLength(3);
    // A blank Client Profile (white space alone) is empty too.
    const blank = new FactsCard();
    blank.values.set(PROFILE, "  \n ");
    expect((await runFacts(blank, await backfillItem())).out.state).toBe(
      "delivered",
    );
    expect(blank.values.get(PROFILE)).toBe(PROFILE_TEXT);
  });

  it("a Client Profile already there is kept, never written over: the same text says so alone, another says it differs", async () => {
    const same = new FactsCard();
    same.values.set(PROFILE, `${PROFILE_TEXT.trimEnd()}`);
    const kept = await runFacts(same, await backfillItem());
    expect(kept.out).toMatchObject({
      state: "skipped",
      error: "kept: the card already has a value for Client Profile",
    });
    expect(same.writes()).toEqual([]);
    const other = new FactsCard();
    other.values.set(PROFILE, OTHER_PROFILE);
    const r = await runFacts(other, await backfillItem());
    expect(r.out).toMatchObject({
      state: "skipped",
      error:
        "kept: the card already has a value for Client Profile; Client Profile differs from the form, so check it on the card",
    });
    expect(steps(r.out, "profile_backfill").fields[PROFILE]).toEqual({
      before: "set",
      state: "kept",
      differs: true,
      note: SAY_FORMS.factDiffers,
    });
    expect(other.writes()).toEqual([]);
    expect(other.values.get(PROFILE)).toBe(OTHER_PROFILE);
  });

  it("a race: a person's profile lands between the read and the read-back; it stays, kept with the raced note", async () => {
    const card = new FactsCard();
    card.raceAfterWrite = { fieldId: PROFILE, value: OTHER_PROFILE };
    const { out } = await runFacts(card, await backfillItem());
    expect(out).toMatchObject({
      state: "skipped",
      error:
        "kept: the card already has a value for Client Profile; Client Profile differs from the form, so check it on the card",
    });
    expect(steps(out, "profile_backfill").fields[PROFILE]).toEqual({
      before: "empty",
      state: "kept",
      differs: true,
      note: SAY_FORMS.factRaced,
    });
    expect(card.writes()).toHaveLength(1);
    expect(card.values.get(PROFILE)).toBe(OTHER_PROFILE);
    // ClickUp handing the text back with \r\n line ends is still this writer's own text.
    const crlf = new FactsCard();
    crlf.raceAfterWrite = {
      fieldId: PROFILE,
      value: PROFILE_TEXT.replace(/\n/g, "\r\n"),
    };
    expect((await runFacts(crlf, await backfillItem())).out.state).toBe(
      "delivered",
    );
  });

  it("a resume after a write ClickUp did not answer reads first: its own text is written, still empty is written once, another is kept", async () => {
    const started = {
      steps: {
        profile_backfill: {
          state: "started",
          at: new Date(NOW - 60_000).toISOString(),
          startedAt: new Date(NOW - 60_000).toISOString(),
          fields: { [PROFILE]: { before: "empty", state: "due" } },
        },
      },
    };
    const landed = new FactsCard();
    landed.values.set(PROFILE, PROFILE_TEXT);
    const a = await runFacts(
      landed,
      await backfillItem({ progress: structuredClone(started) }),
    );
    expect(a.out.state).toBe("delivered");
    expect(landed.writes()).toEqual([]);
    expect(steps(a.out, "profile_backfill").fields[PROFILE]).toEqual({
      before: "empty",
      state: "written",
    });
    const still = new FactsCard();
    const b = await runFacts(
      still,
      await backfillItem({ progress: structuredClone(started) }),
    );
    expect(b.out.state).toBe("delivered");
    expect(still.writes()).toHaveLength(1);
    const other = new FactsCard();
    other.values.set(PROFILE, OTHER_PROFILE);
    const c = await runFacts(
      other,
      await backfillItem({ progress: structuredClone(started) }),
    );
    expect(c.out.state).toBe("skipped");
    expect(other.writes()).toEqual([]);
    expect(steps(c.out, "profile_backfill").fields[PROFILE].note).toBe(
      SAY_FORMS.factRaced,
    );
  });

  it("a 429 on the write is a plain retry that starts clean; a card off the list or gone fails with no write", async () => {
    const card = new FactsCard();
    card.fail = c => (c.method === "POST" ? rejected(429) : undefined);
    const r = await runFacts(card, await backfillItem());
    expect(r.out.state).toBe("retry");
    expect(steps(r.out, "profile_backfill")).toBeUndefined();
    card.fail = undefined;
    const next = await runFacts(
      card,
      await backfillItem({ progress: r.out.progress as Row }),
    );
    expect(next.out.state).toBe("delivered");
    expect(card.values.get(PROFILE)).toBe(PROFILE_TEXT);
    const off = new FactsCard();
    off.list = "901800000099";
    expect((await runFacts(off, await backfillItem())).out).toMatchObject({
      state: "failed",
      error: SAY_FORMS.offList,
    });
    expect(off.writes()).toEqual([]);
    const gone = new FactsCard();
    gone.fail = c => (c.method === "GET" ? rejected(404) : undefined);
    expect((await runFacts(gone, await backfillItem())).out).toMatchObject({
      state: "failed",
      error: SAY_FORMS.offList,
    });
    expect(gone.writes()).toEqual([]);
    // The Client Profile missing on the card: failed, nothing written.
    const nofield = new FactsCard();
    nofield.fields = nofield.fields.filter(f => f.id !== PROFILE);
    expect((await runFacts(nofield, await backfillItem())).out).toMatchObject({
      state: "failed",
      error: SAY_FORMS.noField("Client Profile"),
    });
  });

  it("a held row shows its words and the text's length, never the text", async () => {
    const planned = planForm(await backfillItem());
    expect(planned).toEqual([
      {
        queueId: "q-profile_backfill",
        kind: "form",
        taskId: CARD,
        field: "Client Profile from the stored answer, only if empty",
        old: null,
        new: `${PROFILE_TEXT.length} characters, only if the card's Client Profile is empty`,
      },
    ]);
    expect(JSON.stringify(planned)).not.toContain("invented");
  });
});

describe("build B1: sale_facts (item 6), the sale's notes only where the card is empty", () => {
  it("formStep: the two texts and the link from a new_client row, by the writer's own names", async () => {
    expect(await formStep(saleItem(sale()))).toEqual({
      step: {
        key: "sale_facts",
        type: "facts",
        taskId: CARD,
        fields: [
          {
            fieldId: GO_LIVE,
            kind: "text",
            label: "Go-live expectation",
            value: GO_LIVE_TEXT,
          },
          {
            fieldId: HANDOFF,
            kind: "text",
            label: "Handoff problems",
            value: "No",
          },
          {
            fieldId: SALES_LINK,
            kind: "url",
            label: "Sales Meeting Link",
            value: "https://fathom.video/share/invented-sale-call",
          },
        ],
      },
    });
    // The two texts alone, as the planner sends them while the Sales Meeting Link is off.
    expect("step" in (await formStep(saleItem(sale().slice(0, 2))))).toBe(true);
  });

  it("empty fields are written as typed ('No' too) and read back; a set one is kept and said", async () => {
    const card = new FactsCard();
    const { out } = await runFacts(card, saleItem(sale()));
    expect(out.state).toBe("delivered");
    expect(card.writes().map(c => [c.path, c.body])).toEqual([
      [`task/${CARD}/field/${GO_LIVE}`, { value: GO_LIVE_TEXT }],
      [`task/${CARD}/field/${HANDOFF}`, { value: "No" }],
      [
        `task/${CARD}/field/${SALES_LINK}`,
        { value: "https://fathom.video/share/invented-sale-call" },
      ],
    ]);
    const written = { before: "empty", state: "written" };
    expect(steps(out, "sale_facts").fields).toEqual({
      [GO_LIVE]: written,
      [HANDOFF]: written,
      [SALES_LINK]: written,
    });
    expect(JSON.stringify(out.progress)).not.toContain("invented shop");
    // A person wrote the go-live expectation first: kept, the other two written, the row says it.
    const set = new FactsCard();
    set.values.set(GO_LIVE, "An invented answer a person typed");
    const r = await runFacts(set, saleItem(sale()));
    expect(r.out).toMatchObject({
      state: "delivered",
      note: "kept: the card already has a value for Go-live expectation; Go-live expectation differs from the form, so check it on the card",
    });
    expect(set.values.get(GO_LIVE)).toBe("An invented answer a person typed");
    expect(set.writes().map(c => c.path)).toEqual([
      `task/${CARD}/field/${HANDOFF}`,
      `task/${CARD}/field/${SALES_LINK}`,
    ]);
  });

  it("a held row shows its words and how many fields, never a value", async () => {
    const planned = planForm(saleItem(sale()));
    expect(planned).toEqual([
      {
        queueId: "q-sale_facts",
        kind: "form",
        taskId: CARD,
        field: "Go-live and handoff problems from the sale, only where empty",
        old: null,
        new: "up to 3, each only where the card is empty",
      },
    ]);
    expect(JSON.stringify(planned)).not.toContain("invented");
  });
});

describe("build B1: Daily Budget (item 5), USD only into an empty field", () => {
  it("takes a finite USD amount from 1 to 100,000 with 2 decimals at most, as a number", async () => {
    expect([BUDGET_MIN, BUDGET_MAX]).toEqual([1, 100_000]);
    for (const v of [1, 40, 39.99, 37.5, 100_000])
      expect([v, budgetAmount(v)]).toEqual([v, v]);
    // A float's noise is sent as the cents it means.
    expect(budgetAmount(0.1 + 0.2 + 39.7)).toBe(40);
    for (const v of [
      0,
      0.99,
      -5,
      100_000.01,
      100_001,
      12.345,
      "40",
      Number.NaN,
      Number.POSITIVE_INFINITY,
      null,
      undefined,
      { usd: 40 },
    ])
      expect([v, budgetAmount(v)]).toEqual([v, null]);
    const step = await formStep(await factsItem([budget(39.99)]));
    expect(step).toEqual({
      step: {
        key: "card_facts",
        type: "facts",
        taskId: CARD,
        fields: [
          {
            fieldId: BUDGET,
            kind: "currency",
            label: "Daily Budget",
            amount: 39.99,
          },
        ],
      },
    });
    for (const bad of [
      budget(0),
      budget(100_001),
      budget(12.345),
      budget("40"),
      budget(null),
      { ...budget(40), kind: "number" },
      { ...budget(40), onlyIfEmpty: undefined },
    ])
      expect(await formStep(await factsItem([bad]))).toEqual(MISMATCH);
    // On an onboarding row too: the allowlist is card_facts', whichever of its two forms plans it.
    expect(
      "step" in
        (await formStep(
          await factsItem([budget(40)], { formKey: "onboarding" }),
        )),
    ).toBe(true);
  });

  it("an empty Daily Budget gets the number and reads back to the cent as ClickUp's text; set (0 included) it is kept", async () => {
    for (const empty of [undefined, null, ""]) {
      const card = new FactsCard();
      if (empty !== undefined) card.values.set(BUDGET, empty);
      const { out } = await runFacts(card, await factsItem([budget(39.99)]));
      expect(out.state).toBe("delivered");
      expect(card.writes()).toEqual([
        {
          method: "POST",
          path: `task/${CARD}/field/${BUDGET}`,
          body: { value: 39.99 },
        },
      ]);
      expect(card.values.get(BUDGET)).toBe("39.99");
      expect(steps(out, "card_facts").fields[BUDGET]).toEqual({
        before: "empty",
        state: "written",
      });
      expect(JSON.stringify(out.progress)).not.toContain("39.99");
    }
    // The sale's figure, the same to the cent: kept with no note of a difference.
    const same = new FactsCard();
    same.values.set(BUDGET, "40.00");
    expect(
      (await runFacts(same, await factsItem([budget(40)]))).out,
    ).toMatchObject({
      state: "skipped",
      error: "kept: the card already has a value for Daily Budget",
    });
    // Another figure, or 0: kept, said to differ, never written over.
    for (const set of ["30", 0, "0"]) {
      const card = new FactsCard();
      card.values.set(BUDGET, set);
      const r = await runFacts(card, await factsItem([budget(60)]));
      expect(r.out).toMatchObject({
        state: "skipped",
        error:
          "kept: the card already has a value for Daily Budget; Daily Budget differs from the form, so check it on the card",
      });
      expect(card.writes()).toEqual([]);
      expect(card.values.get(BUDGET)).toBe(set);
    }
    // ClickUp keeping another figure than the one sent (to the cent) is not this writer's: kept, raced.
    const off = new FactsCard();
    off.raceAfterWrite = { fieldId: BUDGET, value: "39.98" };
    const raced = await runFacts(off, await factsItem([budget(39.99)]));
    expect(steps(raced.out, "card_facts").fields[BUDGET]).toEqual({
      before: "empty",
      state: "kept",
      differs: true,
      note: SAY_FORMS.factRaced,
    });
  });

  it("a Daily Budget ClickUp keeps in another currency, or none named, fails before any write; a set one is just kept", async () => {
    for (const [currency, said] of [
      ["SAR", "in SAR"],
      [undefined, "in no named currency"],
    ] as const) {
      const card = new FactsCard();
      const field = card.fields.find(f => f.id === BUDGET) as Row;
      field.type_config = currency ? { currency_type: currency } : {};
      const r = await runFacts(
        card,
        await factsItem([budget(40), ...only(FATHOM)]),
      );
      expect(r.out).toMatchObject({
        state: "failed",
        error: SAY_FORMS.notUsd("Daily Budget", currency ?? ""),
      });
      expect(SAY_FORMS.notUsd("Daily Budget", currency ?? "")).toBe(
        `ClickUp's Daily Budget is ${said}, not USD, so nothing was written. The tech lead runs the forms doctor.`,
      );
      expect(card.writes()).toEqual([]);
    }
    const kept = new FactsCard();
    (kept.fields.find(f => f.id === BUDGET) as Row).type_config = {
      currency_type: "SAR",
    };
    kept.values.set(BUDGET, "30");
    expect(
      (await runFacts(kept, await factsItem([budget(40), ...only(FATHOM)]))).out
        .state,
    ).toBe("delivered");
    expect(kept.writes().map(c => c.path)).toEqual([
      `task/${CARD}/field/${FATHOM}`,
    ]);
  });
});

describe("build B1: the forms doctor reads each listed lane's fields", () => {
  const ours = (problems: string[]) =>
    problems.filter(p =>
      /Daily Budget|Client Profile|Go-live expectation|Handoff problems|Sales Meeting Link|backfill|sale's/.test(
        p,
      ),
    );
  it("nothing to say while every field is there with its kind and Daily Budget is in USD", async () => {
    const card = new FactsCard();
    expect(
      ours(
        (
          await formsDoctorChecks(
            {},
            card.provider(),
            [],
            ["checkin", "kickoff", "new_client", "profile_backfill"],
          )
        ).problems,
      ),
    ).toEqual([]);
  });

  it("names a missing field, a field of another kind and a Daily Budget not in USD, each only while its lane is listed", async () => {
    const broken = new FactsCard();
    broken.fields = broken.fields
      .filter(f => f.id !== PROFILE && f.id !== GO_LIVE)
      .map(f =>
        f.id === HANDOFF
          ? { ...f, type: "short_text" }
          : f.id === SALES_LINK
            ? { ...f, type: "text" }
            : f.id === BUDGET
              ? { ...f, type_config: { currency_type: "KWD" } }
              : f,
      );
    const said = async (forms: string[]) =>
      ours(
        (await formsDoctorChecks({}, broken.provider(), [], forms)).problems,
      );
    expect(await said(["checkin"])).toEqual([]);
    expect(await said(["checkin", "profile_backfill"])).toEqual([
      "The Client Profile backfill writes Client Profile (7755485f), which is not on the Clients - Mahara list.",
    ]);
    expect(await said(["new_client"])).toEqual([
      "The sale's card facts write Go-live expectation (d4483463), which is not on the Clients - Mahara list.",
      "Handoff problems is a short_text field in ClickUp, not text, so the sale's card facts would not write it.",
      "Sales Meeting Link is a text field in ClickUp, not url, so the sale's card facts would not write it.",
    ]);
    expect(await said(["kickoff"])).toEqual([
      "Daily Budget is in KWD in ClickUp, not USD, so card facts would not write it.",
    ]);
    // The Client Profile of another kind: the backfill's own sentence.
    const short = new FactsCard();
    (short.fields.find(f => f.id === PROFILE) as Row).type = "short_text";
    expect(
      ours(
        (
          await formsDoctorChecks(
            {},
            short.provider(),
            [],
            ["profile_backfill"],
          )
        ).problems,
      ),
    ).toEqual([
      "Client Profile is a short_text field in ClickUp, not text, so the backfill would not write it.",
    ]);
    // Daily Budget gone, or of another kind.
    const gone = new FactsCard();
    gone.fields = gone.fields.filter(f => f.id !== BUDGET);
    expect(
      ours(
        (await formsDoctorChecks({}, gone.provider(), [], ["onboarding"]))
          .problems,
      ),
    ).toEqual([
      "Card facts write Daily Budget (539743c2), which is not on the Clients - Mahara list.",
    ]);
    const number = new FactsCard();
    (number.fields.find(f => f.id === BUDGET) as Row).type = "number";
    expect(
      ours(
        (await formsDoctorChecks({}, number.provider(), [], ["kickoff"]))
          .problems,
      ),
    ).toEqual([
      "Daily Budget is a number field in ClickUp, not currency, so card facts would not write it.",
    ]);
  });
});
