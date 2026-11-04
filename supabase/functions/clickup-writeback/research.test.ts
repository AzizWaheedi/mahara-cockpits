// The market research writer (research.ts, job research; plan build MI-1b, contract 4.23.1). A fake client card
// answers the ClickUp v2 paths the writer uses: the card with its Market Research doc (a url field), the field write,
// and the card's comments newest first. The run, the Doc ids and the links are invented; the card is the internal test
// card; the field id is ClickUp's own, no secret. fixtures/research-outputs.json is what hermes/market-intel's
// mi/render.py outputs() makes for one synthetic published run (tests/test_writer_contract.py checks that side).

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { FORMS_LIST, SAY_FORMS, sha256 } from "./forms";
import type { Provider } from "./queue";
import { SAY } from "./requests";
import {
  COMMENT_MAX,
  docIdOf,
  executeResearch,
  LINK_MAX,
  MARKET_RESEARCH_FIELD,
  notInstalled,
  planResearch,
  REPLACEABLE_MAX,
  RESEARCH_KEYS,
  RESEARCH_KEYS_BAD,
  RESEARCH_LANES,
  RESEARCH_NOT_A_CARD,
  researchDb,
  researchDoctorChecks,
  researchFrozen,
  researchGate,
  type ResearchItem,
  researchLane,
  researchMarker,
  type ResearchStep,
  researchStep,
  SAY_RESEARCH,
} from "./research";
import type { Row } from "./rules";
import { type Deps, HOLD_MS, JOBS, RESEARCH_BUSY_HELD, researchIdle, runDoctor, runResearch, runResearchDoctor } from "./run";

const GOLDEN = JSON.parse(readFileSync(new URL("./fixtures/research-outputs.json", import.meta.url), "utf8"));
const NOW = Date.parse("2026-11-20T09:00:00Z"); // 12:00 Kuwait
const CARD: string = GOLDEN.inputs.taskId;
const RUN: string = GOLDEN.inputs.runId;
const DOC: string = GOLDEN.inputs.docId;
const LINK: string = GOLDEN.outputs.field.value;
const TEXT: string = GOLDEN.outputs.comment.text;
const MARKER: string = GOLDEN.outputs.comment.marker;
/** A Doc an earlier published run of this worker made for the same card. */
const OLD_DOC = "1OlderSynthDocFromAnEarlierRunOfThisWorker00";
const OLD_LINK = `https://docs.google.com/document/d/${OLD_DOC}/edit`;
/** Links this worker did not make: the old job's Google Doc and a ClickUp doc a person linked. */
const OLD_JOB_LINK = "https://docs.google.com/document/d/1OldJobSynthDocNotMadeByThisWorker0000000000/edit?usp=drivesdk";
const PERSON_LINK = "https://app.clickup.com/90150000/v/dc/synthetic-doc-1";
const OTHER_CARD = "86other001";

const rejected = (status: number) => new Error(`clickup rejected the request (${status}). Inspect the provider receipt.`);
const unanswered = () => new Error("The clickup response is unknown: the request timed out.");

type Key = "research_field" | "research_comment";
async function row(key: Key, over: { payload?: Row; plan?: Row; run?: Row; item?: Partial<ResearchItem> } = {}): Promise<ResearchItem> {
  const plan =
    key === "research_field"
      ? { taskId: CARD, fieldId: MARKET_RESEARCH_FIELD, kind: "url", value: LINK, replaceable: [OLD_DOC] }
      : { taskId: CARD, text: TEXT };
  const payload =
    key === "research_field"
      ? { kind: "research", effectKey: key, runId: RUN, taskId: CARD, docId: DOC, valueSha256: await sha256(LINK), valueChars: LINK.length }
      : { kind: "research", effectKey: key, runId: RUN, taskId: CARD, docId: DOC, commentSha256: await sha256(TEXT), commentChars: TEXT.length };
  return {
    id: `q-${key}`,
    kind: "research",
    attempts: 1,
    created_at: new Date(NOW - 60_000).toISOString(),
    task_id: CARD,
    steps: null,
    progress: {},
    payload: { ...payload, ...over.payload },
    run: { id: RUN, state: "done", mode: "live", plan: { ...plan, ...over.plan }, ...over.run } as ResearchItem["run"],
    ...over.item,
  };
}

type Call = { actionId: string; method: string; path: string; body?: any };
/**
 * One client card that keeps what it is sent: the Market Research doc (a url field) and its comments, newest first.
 * `afterWrite` lets another writer change the field right after this one's write lands.
 */
function card(opts: {
  field?: unknown;
  fieldType?: string;
  noField?: boolean;
  list?: string;
  comments?: Row[];
  fail?: (c: Call) => Error | undefined;
  afterWrite?: (sent: unknown) => unknown;
  postAnswer?: (id: string) => Row;
  /** ClickUp took the post but does not show it (yet). */
  hidePosts?: boolean;
} = {}) {
  const calls: Call[] = [];
  let value = opts.field;
  const comments: Row[] = [...(opts.comments ?? [])];
  let next = 1;
  const provider = (actionId = "row"): Provider => ({
    async call(_p, method, path, body) {
      const c = { actionId, method, path, body };
      calls.push(c);
      const failure = opts.fail?.(c);
      if (failure) throw failure;
      if (method === "GET" && path === `task/${CARD}`)
        return { id: CARD, list: { id: opts.list ?? FORMS_LIST }, custom_fields: opts.noField ? [] : [{ id: MARKET_RESEARCH_FIELD, type: opts.fieldType ?? "url", value }] };
      if (method === "POST" && path === `task/${CARD}/field/${MARKET_RESEARCH_FIELD}`) {
        value = opts.afterWrite ? opts.afterWrite(body?.value) : body?.value;
        return {};
      }
      if (method === "GET" && path.startsWith(`task/${CARD}/comment`)) return { comments: [...comments].reverse() };
      if (method === "POST" && path === `task/${CARD}/comment`) {
        const id = `c-${next++}`;
        if (!opts.hidePosts) comments.push({ id, comment_text: body?.comment_text, date: String(NOW) });
        return opts.postAnswer ? opts.postAnswer(id) : { id };
      }
      if (method === "GET" && path === `list/${FORMS_LIST}/field`) return { fields: opts.noField ? [] : [{ id: MARKET_RESEARCH_FIELD, type: opts.fieldType ?? "url" }] };
      if (method === "GET" && path.startsWith("task/")) return { id: path.slice(5), list: { id: FORMS_LIST } };
      return {};
    },
  });
  const writes = () => calls.filter(c => c.method !== "GET");
  return { calls, provider, comments, writes, value: () => value };
}

/** Run one row's write with saves recorded, as runResearch does. */
async function write(item: ResearchItem, c: ReturnType<typeof card>) {
  const checked = await researchStep(item);
  if (!("step" in checked)) throw new Error(`refused: ${"fail" in checked ? checked.fail : checked.wait}`);
  const step = researchFrozen(item, checked.step) as ResearchStep;
  const saves: Row[] = [];
  const o = await executeResearch(item, step, c.provider(), async patch => void saves.push(structuredClone(patch)), () => NOW);
  return { o, saves, step };
}

// --- the shared shape with hermes/market-intel -------------------------------------------------------------------

describe("the worker's outputs, as mi/render.py makes them (fixtures/research-outputs.json)", () => {
  it("the writer takes the field value and the comment exactly as the worker renders them", async () => {
    expect(GOLDEN.outputs.field.id).toBe(MARKET_RESEARCH_FIELD);
    expect(researchMarker(RUN)).toBe(MARKER);
    expect(GOLDEN.outputs.comment.notifyAll).toBe(false);
    const field = await researchStep(await row("research_field"));
    expect(field).toEqual({ step: { key: "research_field", type: "field", taskId: CARD, fieldId: MARKET_RESEARCH_FIELD, value: LINK, docId: DOC, replaceable: [OLD_DOC] } });
    const comment = await researchStep(await row("research_comment"));
    expect(comment).toEqual({ step: { key: "research_comment", type: "comment", taskId: CARD, text: TEXT, marker: MARKER, docId: DOC } });
  });

  it("reads a Doc id from the worker's link and from today's job's (?usp=drivesdk), and nothing from a ClickUp doc", () => {
    expect(docIdOf(LINK)).toBe(DOC);
    expect(docIdOf(` ${LINK} `)).toBe(DOC);
    expect(docIdOf(OLD_JOB_LINK)).toBe("1OldJobSynthDocNotMadeByThisWorker0000000000");
    for (const v of [PERSON_LINK, "", null, undefined, "http://docs.google.com/document/d/1OlderSynthDocFromAnEarlierRunOfThisWorker00/edit", "https://docs.google.com/spreadsheets/d/1OlderSynthDocFromAnEarlierRunOfThisWorker00/edit", "https://docs.google.com/document/d/short/edit"])
      expect(docIdOf(v)).toBeNull();
  });
});

// --- the switch --------------------------------------------------------------------------------------------------

describe("the research switch (researchGate)", () => {
  const gateOf = (vars: Record<string, string>) => researchGate(k => vars[k]);
  it("is off with nothing set, and stays off with the switch on and no output listed", () => {
    for (const vars of [{}, { CLICKUP_WRITEBACK_APPLY_RESEARCH: "true" }, { CLICKUP_WRITEBACK_RESEARCH_KEYS: "field,comment" }, { CLICKUP_WRITEBACK_APPLY_RESEARCH: "TRUE", CLICKUP_WRITEBACK_RESEARCH_KEYS: "field" }]) {
      const g = gateOf(vars);
      expect(g.mode).toBe("dry_run");
      expect(g.open).toEqual([]);
      expect(g.live(CARD)).toBe(false);
    }
    expect(gateOf({ CLICKUP_WRITEBACK_APPLY_RESEARCH: "true" }).text).toBe("dry run (CLICKUP_WRITEBACK_RESEARCH_KEYS lists no output, so none is written)");
  });

  it("opens only the outputs listed, in the claim's order, narrowed by the canary cards", () => {
    const both = gateOf({ CLICKUP_WRITEBACK_APPLY_RESEARCH: "true", CLICKUP_WRITEBACK_RESEARCH_KEYS: " comment , field ," });
    expect([both.mode, both.open, both.live(OTHER_CARD), both.has("field"), both.has("comment")]).toEqual(["apply", ["field", "comment"], true, true, true]);
    expect(both.text).toBe("apply: field, comment");
    const field = gateOf({ CLICKUP_WRITEBACK_APPLY_RESEARCH: "true", CLICKUP_WRITEBACK_RESEARCH_KEYS: "field", CLICKUP_WRITEBACK_RESEARCH_ONLY_CARDS: CARD });
    expect([field.mode, field.open, field.live(CARD), field.live(OTHER_CARD), field.live(null), field.has("comment")]).toEqual(["apply_limited", ["field"], true, false, false, false]);
    expect(field.text).toBe(`apply_limited to the cards ${CARD} (CLICKUP_WRITEBACK_RESEARCH_ONLY_CARDS): field`);
  });

  it("a card list or a key list it cannot read opens nothing, and never names the value", () => {
    const cards = gateOf({ CLICKUP_WRITEBACK_APPLY_RESEARCH: "true", CLICKUP_WRITEBACK_RESEARCH_KEYS: "field", CLICKUP_WRITEBACK_RESEARCH_ONLY_CARDS: "pk_pasted secret" });
    expect([cards.mode, cards.error, cards.live(CARD), [...cards.onlyCards]]).toEqual(["dry_run", RESEARCH_NOT_A_CARD, false, []]);
    expect(JSON.stringify(cards)).not.toContain("pk_pasted");
    expect(gateOf({ CLICKUP_WRITEBACK_APPLY_RESEARCH: "true", CLICKUP_WRITEBACK_RESEARCH_KEYS: "field", CLICKUP_WRITEBACK_RESEARCH_ONLY_CARDS: " , " }).error).toBe(RESEARCH_NOT_A_CARD);
    for (const keys of ["field,doc", "fields", " , ", "onboarding"]) {
      const g = gateOf({ CLICKUP_WRITEBACK_APPLY_RESEARCH: "true", CLICKUP_WRITEBACK_RESEARCH_KEYS: keys });
      expect([g.mode, g.error, g.has("field"), g.live(CARD)]).toEqual(["dry_run", RESEARCH_KEYS_BAD, false, false]);
    }
  });

  it("no other switch opens it", () => {
    const g = gateOf({ CLICKUP_WRITEBACK_APPLY: "true", CLICKUP_WRITEBACK_APPLY_FORMS: "true", CLICKUP_WRITEBACK_FORMS_KEYS: "checkin,onboarding", CLICKUP_WRITEBACK_RESEARCH_KEYS: "field,comment" });
    expect(g.mode).toBe("dry_run");
  });

  it("a row's lane is its output; a key it does not know has none", () => {
    expect(RESEARCH_KEYS.map(k => researchLane({ effectKey: k }))).toEqual([...RESEARCH_LANES]);
    expect(researchLane({ effectKey: "card_facts" })).toBeNull();
    expect(researchLane(null)).toBeNull();
  });
});

// --- the check before any call ------------------------------------------------------------------------------------

describe("researchStep: the check before any call", () => {
  const refused = async (item: ResearchItem, sentence: string = SAY_RESEARCH.mismatch) => expect(await researchStep(item)).toEqual({ fail: sentence });

  it("refuses a row with no run or plan", async () => {
    await refused(await row("research_field", { item: { run: null } }), SAY_RESEARCH.noPlan);
    await refused({ ...(await row("research_comment")), run: { id: RUN, state: "done", mode: "live", plan: null as any } }, SAY_RESEARCH.noPlan);
  });

  it("refuses a shadow run, a cancelled one, or one that ended without this Doc, in plain words", async () => {
    await refused(await row("research_field", { run: { mode: "shadow" } }), SAY_RESEARCH.notPublished);
    await refused(await row("research_field", { run: { mode: "shadow", state: "queued" } }), SAY_RESEARCH.notPublished);
    await refused(await row("research_comment", { run: { state: "cancelled", docId: DOC } }), SAY_RESEARCH.notPublished);
    await refused(await row("research_comment", { run: { state: "something_new", docId: DOC } }), SAY_RESEARCH.notPublished);
    for (const state of ["needs_person", "failed"]) {
      await refused(await row("research_comment", { run: { state } }), SAY_RESEARCH.notPublished);
      await refused(await row("research_field", { run: { state, docId: OLD_DOC } }), SAY_RESEARCH.notPublished);
      // Ended after its Doc was made and still naming it: the report exists, so the card gets it.
      for (const key of RESEARCH_KEYS) expect("step" in (await researchStep(await row(key, { run: { state, docId: DOC } })))).toBe(true);
    }
    expect("step" in (await researchStep(await row("research_comment", { run: { state: "publishing" } })))).toBe(true);
    expect(SAY_RESEARCH.notPublished).not.toContain("MI-3");
  });

  it("a live run back in progress after it published is a wait, never a failure (the next publish dedupes its rows)", async () => {
    for (const state of ["queued", "claimed", "pulling", "picking", "writing", "checking"])
      for (const key of RESEARCH_KEYS) expect(await researchStep(await row(key, { run: { state, docId: DOC } }))).toEqual({ wait: SAY_RESEARCH.heldRun });
    // A row that does not match still fails as one: waiting would hold it for good.
    await refused(await row("research_field", { payload: { taskId: OTHER_CARD }, run: { state: "queued" } }));
    await refused(await row("research_field", { payload: { docId: "../../etc" }, run: { state: "queued" } }));
    expect(SAY_RESEARCH.heldRun.startsWith("Held: ")).toBe(true);
  });

  it("refuses another key, card, run or Doc", async () => {
    await refused(await row("research_field", { payload: { effectKey: "card_facts" } }));
    await refused(await row("research_field", { payload: { kind: "form" } }));
    await refused(await row("research_field", { payload: { taskId: OTHER_CARD } }));
    await refused(await row("research_field", { plan: { taskId: OTHER_CARD } }));
    await refused(await row("research_field", { item: { task_id: null } }));
    await refused(await row("research_comment", { item: { task_id: "not a card" } }));
    await refused(await row("research_comment", { payload: { runId: "5d1c0a7e-3b2f-4c6d-9e8f-0a1b2c3d4e50" } }));
    await refused(await row("research_comment", { payload: { runId: "run-1" }, run: { id: "run-1" } }));
    await refused(await row("research_field", { payload: { docId: OLD_DOC } }));
    await refused(await row("research_field", { payload: { docId: "../../etc" } }));
  });

  it("the field: only the Market Research doc, a url, this run's Doc as hashed in the payload, an earlier report list of ids", async () => {
    await refused(await row("research_field", { plan: { fieldId: "5d57fdde-eb70-4610-a23b-88f718b4451d" } }));
    await refused(await row("research_field", { plan: { kind: "text" } }));
    await refused(await row("research_field", { plan: { value: OLD_LINK } }));
    await refused(await row("research_field", { plan: { value: PERSON_LINK } }));
    await refused(await row("research_field", { plan: { value: ` ${LINK}` } }));
    await refused(await row("research_field", { plan: { value: `${LINK}?x=${"a".repeat(LINK_MAX)}` } }));
    await refused(await row("research_field", { payload: { valueSha256: await sha256(`${LINK}?usp=drivesdk`) } }));
    await refused(await row("research_field", { payload: { valueSha256: undefined } }));
    await refused(await row("research_field", { plan: { replaceable: "1OlderSynthDocFromAnEarlierRunOfThisWorker00" } }));
    await refused(await row("research_field", { plan: { replaceable: [OLD_LINK] } }));
    await refused(await row("research_field", { plan: { replaceable: Array.from({ length: REPLACEABLE_MAX + 1 }, (_, i) => `${OLD_DOC.slice(0, -2)}${String(i).padStart(2, "0")}`) } }));
    // The run's own Doc in the list is dropped (it is "same", never "ours"); a missing list is none.
    const own = await researchStep(await row("research_field", { plan: { replaceable: [DOC, OLD_DOC, OLD_DOC] } }));
    expect("step" in own && own.step.type === "field" && own.step.replaceable).toEqual([OLD_DOC]);
    const none = await researchStep(await row("research_field", { plan: { replaceable: undefined } }));
    expect("step" in none && none.step.type === "field" && none.step.replaceable).toEqual([]);
  });

  it("the comment: hashed in the payload, this run's marker once as its last line, this run's Doc linked", async () => {
    const as = async (text: string) => row("research_comment", { plan: { text }, payload: { commentSha256: await sha256(text) } });
    await refused(await row("research_comment", { plan: { text: `${TEXT} ` } }));
    await refused(await as(TEXT.replace(`\n${MARKER}`, "")));
    await refused(await as(`${TEXT}\n`));
    await refused(await as(`${MARKER}\n${TEXT}`));
    await refused(await as(TEXT.replace(MARKER, researchMarker("0a1b2c3d-3b2f-4c6d-9e8f-0a1b2c3d4e5f"))));
    await refused(await as(TEXT.replace(DOC, OLD_DOC)));
    await refused(await as(`${"x".repeat(COMMENT_MAX)}\n${MARKER}`));
    await refused(await as("   "));
  });

  it("a frozen step for another key, card or Doc is a mismatch; the frozen one is what a retry writes", async () => {
    const item = await row("research_comment");
    const fresh = (await researchStep(item)) as { step: ResearchStep };
    const frozen = { ...fresh.step, text: `${TEXT}` };
    expect(researchFrozen({ ...item, steps: [frozen] }, fresh.step)).toBe(frozen);
    expect(researchFrozen({ ...item, steps: [{ ...fresh.step, docId: OLD_DOC }] }, fresh.step)).toBeNull();
    const field = (await researchStep(await row("research_field"))) as { step: ResearchStep };
    expect(researchFrozen({ ...item, steps: [field.step] }, fresh.step)).toBeNull();
  });
});

// --- the field ----------------------------------------------------------------------------------------------------

describe("the Market Research doc: written only while empty or an earlier report, read back", () => {
  const stepOf = (o: { progress: Row }) => o.progress.steps.research_field;

  it("an empty field is written with the run's link and read back; the receipt never holds the link", async () => {
    const c = card({ field: undefined });
    const { o, saves } = await write(await row("research_field"), c);
    expect(o.state).toBe("delivered");
    expect(c.writes()).toEqual([{ actionId: "row", method: "POST", path: `task/${CARD}/field/${MARKET_RESEARCH_FIELD}`, body: { value: LINK } }]);
    expect(c.calls.map(x => `${x.method} ${x.path}`)).toEqual([`GET task/${CARD}`, `POST task/${CARD}/field/${MARKET_RESEARCH_FIELD}`, `GET task/${CARD}`]);
    expect(stepOf(o)).toMatchObject({ state: "done", before: "empty", result: "written" });
    // Saved before the write (started) and after the read-back (done).
    expect(saves.map(s => s.progress.steps.research_field.state)).toEqual(["started", "done"]);
    expect(JSON.stringify(saves)).not.toContain(DOC);
    expect(c.value()).toBe(LINK);
  });

  it("a blank text counts as empty", async () => {
    const { o } = await write(await row("research_field"), card({ field: "  " }));
    expect([o.state, stepOf(o).before]).toEqual(["delivered", "empty"]);
  });

  it("an earlier report of this worker is replaced", async () => {
    const c = card({ field: OLD_LINK });
    const { o } = await write(await row("research_field"), c);
    expect(o.state).toBe("delivered");
    expect(stepOf(o)).toMatchObject({ before: "ours", result: "written" });
    expect(c.value()).toBe(LINK);
  });

  it("the run's own Doc already there (any suffix) is delivered with no write", async () => {
    for (const v of [LINK, `${LINK}?usp=drivesdk`, `https://docs.google.com/document/d/${DOC}`]) {
      const c = card({ field: v });
      const { o } = await write(await row("research_field"), c);
      expect(o.state).toBe("delivered");
      expect(stepOf(o)).toMatchObject({ state: "unchanged", before: "same", result: "written" });
      expect(c.writes()).toEqual([]);
    }
  });

  it("a link it did not make is kept: a person's ClickUp doc, today's job's Google Doc, an earlier Doc not in the list", async () => {
    for (const v of [PERSON_LINK, OLD_JOB_LINK, "a note, not a link"]) {
      const c = card({ field: v });
      const { o } = await write(await row("research_field"), c);
      expect(o).toMatchObject({ state: "skipped", error: SAY_RESEARCH.kept });
      expect(stepOf(o)).toMatchObject({ state: "skipped", before: "set", result: "kept" });
      expect(c.writes()).toEqual([]);
      expect(c.value()).toBe(v);
    }
    const c = card({ field: OLD_LINK });
    const { o } = await write(await row("research_field", { plan: { replaceable: [] } }), c);
    expect(o.state).toBe("skipped");
    expect(c.writes()).toEqual([]);
  });

  it("another link that reaches the card during the write stays, and the row says so", async () => {
    const c = card({ field: undefined, afterWrite: () => PERSON_LINK });
    const { o } = await write(await row("research_field"), c);
    expect(o).toMatchObject({ state: "skipped", error: SAY_RESEARCH.raced });
    expect(stepOf(o)).toMatchObject({ before: "empty", result: "kept", raced: true });
  });

  it("a write that does not read back is unknown with its receipt kept; the next run writes it again, once", async () => {
    const lost = card({ field: undefined, afterWrite: () => undefined });
    const first = await write(await row("research_field"), lost);
    expect(first.o).toMatchObject({ state: "unknown", error: SAY_RESEARCH.fieldNotBack });
    expect(stepOf(first.o)).toMatchObject({ state: "started", before: "empty" });
    const again = card({ field: undefined });
    const second = await write(await row("research_field", { item: { progress: first.o.progress, steps: [first.step] } }), again);
    expect(second.o.state).toBe("delivered");
    expect(again.writes().length).toBe(1);
  });

  it("a resume finds its own write on the card and writes nothing; another link there now got there meanwhile", async () => {
    const progress = { steps: { research_field: { state: "started", before: "ours", startedAt: new Date(NOW - 120_000).toISOString() } } };
    const landed = card({ field: LINK });
    const a = await write(await row("research_field", { item: { progress } }), landed);
    expect(a.o.state).toBe("delivered");
    expect(stepOf(a.o)).toMatchObject({ state: "done", before: "ours", result: "written" });
    expect(landed.writes()).toEqual([]);
    const raced = card({ field: PERSON_LINK });
    const b = await write(await row("research_field", { item: { progress } }), raced);
    expect(b.o).toMatchObject({ state: "skipped", error: SAY_RESEARCH.raced });
    expect(stepOf(b.o)).toMatchObject({ before: "ours", raced: true });
    expect(raced.writes()).toEqual([]);
  });

  it("a settled step is never written again", async () => {
    for (const [state, want] of [["done", "delivered"], ["unchanged", "delivered"], ["skipped", "skipped"]] as const) {
      const c = card({ field: undefined });
      const progress = { steps: { research_field: { state, result: state === "skipped" ? "kept" : "written" } } };
      const { o } = await write(await row("research_field", { item: { progress } }), c);
      expect(o.state).toBe(want);
      expect(c.calls).toEqual([]);
    }
  });

  it("a card off Clients - Mahara, a missing field or a field that is not a link fails with no write", async () => {
    const off = card({ list: "901800000000" });
    expect((await write(await row("research_field"), off)).o).toMatchObject({ state: "failed", error: SAY_RESEARCH.offList });
    const gone = card({ fail: c => (c.path === `task/${CARD}` ? rejected(404) : undefined) });
    expect((await write(await row("research_field"), gone)).o).toMatchObject({ state: "failed", error: SAY_RESEARCH.offList });
    expect((await write(await row("research_field"), card({ noField: true }))).o).toMatchObject({ state: "failed", error: SAY_RESEARCH.noField });
    const text = card({ fieldType: "text" });
    expect((await write(await row("research_field"), text)).o).toMatchObject({ state: "failed", error: SAY_RESEARCH.notUrl("text") });
    for (const c of [off, gone, text]) expect(c.writes()).toEqual([]);
  });

  it("an unanswered card read before the step starts is a plain retry; a 429 on the write never landed and starts clean", async () => {
    const quiet = card({ fail: c => (c.method === "GET" ? unanswered() : undefined) });
    const a = await write(await row("research_field"), quiet);
    expect(a.o).toMatchObject({ state: "retry", plain: SAY_RESEARCH.notConfirmed });
    expect(a.o.progress.steps?.research_field).toBeUndefined();
    const slow = card({ field: undefined, fail: c => (c.method === "POST" ? rejected(429) : undefined) });
    const b = await write(await row("research_field"), slow);
    expect(b.o.state).toBe("retry");
    expect(b.o.progress.steps?.research_field).toBeUndefined();
  });

  it("a 429 or no answer on the read-back is unknown: the write may be on the card", async () => {
    let reads = 0;
    const slow = card({ field: undefined, fail: c => (c.method === "GET" && ++reads === 2 ? rejected(429) : undefined) });
    expect((await write(await row("research_field"), slow)).o.state).toBe("unknown");
    reads = 0;
    const quiet = card({ field: undefined, fail: c => (c.method === "GET" && ++reads === 2 ? unanswered() : undefined) });
    expect((await write(await row("research_field"), quiet)).o.state).toBe("unknown");
  });

  it("a 401 goes back to the run to tell the token from the card, with nothing booked", async () => {
    const c = card({ field: undefined, fail: x => (x.method === "POST" ? rejected(401) : undefined) });
    const { o } = await write(await row("research_field"), c);
    expect(o).toMatchObject({ state: "retry", tokenRefused: true });
    expect(o.progress.steps?.research_field).toBeUndefined();
  });

  it("a ClickUp refusal of the write fails in plain words", async () => {
    const c = card({ field: undefined, fail: x => (x.method === "POST" ? rejected(400) : undefined) });
    expect((await write(await row("research_field"), c)).o).toMatchObject({ state: "failed", plain: SAY_RESEARCH.refused });
  });
});

// --- the comment --------------------------------------------------------------------------------------------------

describe("the market research comment: once, by its marker, never notifying", () => {
  const stepOf = (o: { progress: Row }) => o.progress.steps.research_comment;

  it("is posted once, not notifying, and found again by its marker and id", async () => {
    const c = card();
    const { o, saves } = await write(await row("research_comment"), c);
    expect(o.state).toBe("delivered");
    expect(c.writes()).toEqual([{ actionId: "row", method: "POST", path: `task/${CARD}/comment`, body: { comment_text: TEXT, notify_all: false } }]);
    expect(stepOf(o)).toMatchObject({ state: "done", commentId: "c-1" });
    // The card is read fresh and searched for the marker before the post.
    expect(c.calls.slice(0, 2).map(x => `${x.method} ${x.path}`)).toEqual([`GET task/${CARD}`, `GET task/${CARD}/comment`]);
    expect(JSON.stringify(saves)).not.toContain("Market research is ready");
  });

  it("a comment already on the card with this run's marker is never posted again", async () => {
    const c = card({ comments: [{ id: "c-old", comment_text: TEXT, date: String(NOW - 30_000) }] });
    const { o } = await write(await row("research_comment"), c);
    expect(o.state).toBe("delivered");
    expect(stepOf(o)).toMatchObject({ state: "unchanged", commentId: "c-old" });
    expect(c.writes()).toEqual([]);
  });

  it("another run's comment on the card does not count: a rerun posts its own", async () => {
    const other = TEXT.replace(MARKER, researchMarker("0a1b2c3d-3b2f-4c6d-9e8f-0a1b2c3d4e5f"));
    const c = card({ comments: [{ id: "c-old", comment_text: other, date: String(NOW - 30_000) }] });
    const { o } = await write(await row("research_comment"), c);
    expect(o.state).toBe("delivered");
    expect(c.writes().length).toBe(1);
  });

  it("a resume with the id ClickUp gave finds it and posts nothing; gone from the card, it is not posted twice", async () => {
    const progress = { steps: { research_comment: { state: "started", commentId: "c-9", startedAt: new Date(NOW - 120_000).toISOString() } } };
    const there = card({ comments: [{ id: "c-9", comment_text: TEXT, date: String(NOW - 100_000) }] });
    const a = await write(await row("research_comment", { item: { progress } }), there);
    expect(a.o.state).toBe("delivered");
    expect(stepOf(a.o)).toMatchObject({ state: "done", commentId: "c-9" });
    expect(there.writes()).toEqual([]);
    const gone = card();
    const b = await write(await row("research_comment", { item: { progress } }), gone);
    expect(b.o).toMatchObject({ state: "unknown", error: SAY_RESEARCH.commentLost });
    expect(gone.writes()).toEqual([]);
  });

  it("a resume with no id and no comment on the card posts it, once", async () => {
    const progress = { steps: { research_comment: { state: "started", startedAt: new Date(NOW - 120_000).toISOString() } } };
    const c = card();
    const { o } = await write(await row("research_comment", { item: { progress } }), c);
    expect(o.state).toBe("delivered");
    expect(c.writes().length).toBe(1);
  });

  it("a post that does not read back is unknown with its id kept, so the next run never posts it again", async () => {
    let posted = false;
    const c = card({
      fail: x => {
        if (x.method === "POST") {
          posted = true;
          return undefined;
        }
        return posted && x.method === "GET" && x.path.startsWith(`task/${CARD}/comment`) ? unanswered() : undefined;
      },
    });
    const { o } = await write(await row("research_comment"), c);
    expect(o.state).toBe("unknown");
    expect(stepOf(o)).toMatchObject({ state: "started", commentId: "c-1" });
    const next = card();
    const again = await write(await row("research_comment", { item: { progress: o.progress } }), next);
    expect(again.o).toMatchObject({ state: "unknown", error: SAY_RESEARCH.commentLost });
    expect(next.writes()).toEqual([]);
  });

  it("an answer with no id is found by the marker alone; with nothing back it is unknown, and the next run looks before it posts", async () => {
    const noId = card({ postAnswer: () => ({}) });
    const a = await write(await row("research_comment"), noId);
    expect(a.o.state).toBe("delivered");
    expect(stepOf(a.o)).toMatchObject({ state: "done", commentId: "c-1" });
    const unseen = card({ postAnswer: () => ({}), hidePosts: true });
    const b = await write(await row("research_comment"), unseen);
    expect(b.o).toMatchObject({ state: "unknown", error: SAY_RESEARCH.commentMissing });
    expect(stepOf(b.o).state).toBe("started");
    expect(stepOf(b.o).commentId).toBeUndefined();
    // It landed after all: the next run finds it by the marker and posts nothing.
    const landed = card({ comments: [{ id: "c-late", comment_text: TEXT, date: String(NOW) }] });
    const c = await write(await row("research_comment", { item: { progress: b.o.progress } }), landed);
    expect(c.o.state).toBe("delivered");
    expect(stepOf(c.o)).toMatchObject({ state: "done", commentId: "c-late" });
    expect(landed.writes()).toEqual([]);
  });

  it("a card off Clients - Mahara gets no comment", async () => {
    const c = card({ list: "901800000000" });
    expect((await write(await row("research_comment"), c)).o).toMatchObject({ state: "failed", error: SAY_RESEARCH.offList });
    expect(c.writes()).toEqual([]);
  });
});

describe("planResearch: what a held row shows", () => {
  it("names the output in words, never the link or the comment's text", async () => {
    const field = planResearch(await row("research_field"));
    const comment = planResearch(await row("research_comment"));
    expect(field).toEqual([{ queueId: "q-research_field", kind: "research", taskId: CARD, field: "Market Research doc", old: null, new: "the report's Doc link, only if the field is empty or holds an earlier report" }]);
    expect(comment[0]).toMatchObject({ field: "Market research comment", new: `${TEXT.length} characters, posted once` });
    expect(JSON.stringify([field, comment])).not.toContain(DOC);
  });
});

// --- the job ------------------------------------------------------------------------------------------------------

const LIVE = { CLICKUP_API_TOKEN: "x", CLICKUP_WRITEBACK_APPLY_RESEARCH: "true", CLICKUP_WRITEBACK_RESEARCH_KEYS: "field,comment" };

/** The research job's harness: its claim, release, save and health row, and one card that keeps what it is sent. */
function jobHarness(env: Record<string, string>, items: ResearchItem[] | Error, opts: { card?: ReturnType<typeof card>; inputs?: () => any; begin?: () => any; release?: () => any } = {}) {
  const c = opts.card ?? card({ field: undefined });
  const rpcs: { name: string; params: any }[] = [];
  let queue = items;
  const deps: Deps = {
    env: k => env[k],
    now: () => NOW,
    uuid: () => "11111111-2222-3333-4444-555555555555",
    rpc: async (name, params = {}) => {
      rpcs.push({ name, params: structuredClone(params) });
      if (name === "cockpit_clickup_writeback_claim_research") {
        if (queue instanceof Error) throw queue;
        const out = queue;
        queue = [];
        return out;
      }
      if (name === "cockpit_clickup_writeback_begin") return opts.begin ? opts.begin() : { id: "run-research" };
      if (name === "cockpit_clickup_writeback_release") return opts.release ? opts.release() : { id: params.p_id, state: "queued" };
      if (name === "cockpit_clickup_research_doctor_inputs") return opts.inputs ? opts.inputs() : { queue: {}, field: MARKET_RESEARCH_FIELD, applyClickup: true };
      return null;
    },
    providerFor: (actionId: string) => c.provider(actionId),
    syncState: async (key, r) => {
      rpcs.push({ name: `syncState:${key}`, params: structuredClone(r) });
    },
  };
  const saves = () => rpcs.filter(r => r.name === "cockpit_clickup_writeback_save").map(r => r.params.p_patch);
  const releases = () => rpcs.filter(r => r.name === "cockpit_clickup_writeback_release").map(r => r.params);
  const health = () => rpcs.filter(r => r.name === "syncState:clickup-writeback:research").at(-1)?.params;
  const finish = () => rpcs.find(r => r.name === "cockpit_clickup_writeback_finish")?.params;
  return { deps, rpcs, saves, releases, health, finish, card: c };
}
const PGRST202 = new Error('Supabase 404: {"code":"PGRST202","message":"Could not find the function public.cockpit_clickup_writeback_claim_research"}');

describe("runResearch: the job", () => {
  it("before the MI-3 migration it says the queue is not there yet, never that it is empty, and calls no provider", async () => {
    const h = jobHarness(LIVE, PGRST202);
    const out = await runResearch(h.deps);
    expect(out).toEqual({ ok: false, job: "research", mode: "apply", note: SAY_RESEARCH.notInstalled });
    expect(h.card.calls).toEqual([]);
    expect(h.health()).toMatchObject({ ok: false, note: SAY_RESEARCH.notInstalled, detail: { mode: "apply", keys: ["field", "comment"], onlyCards: [] } });
    expect(notInstalled(PGRST202)).toBe(true);
    expect(notInstalled(new Error("Supabase 500: boom"))).toBe(false);
    const other = jobHarness(LIVE, new Error("Supabase 500: the database is busy"));
    expect((await runResearch(other.deps)).note).toBe("The market research queue could not be read, so nothing was written: Supabase 500: the database is busy");
  });

  it("with no token it reads nothing and says so", async () => {
    const h = jobHarness({}, [await row("research_field")]);
    const out = await runResearch(h.deps);
    expect(out).toMatchObject({ ok: false, note: SAY.noToken, mode: "dry_run" });
    expect(h.rpcs.some(r => r.name === "cockpit_clickup_writeback_claim_research")).toBe(false);
  });

  it("switched off (no output listed), every row goes back untouched with its try given back, and nothing reaches ClickUp", async () => {
    const h = jobHarness({ CLICKUP_API_TOKEN: "x", CLICKUP_WRITEBACK_APPLY_RESEARCH: "true" }, [await row("research_field"), await row("research_comment")]);
    const out = await runResearch(h.deps);
    expect(h.card.calls).toEqual([]);
    expect(h.releases().map(r => [r.p_id, r.p_note, r.p_next_attempt_at])).toEqual([
      ["q-research_field", SAY_RESEARCH.heldOff, new Date(NOW + HOLD_MS).toISOString()],
      ["q-research_comment", SAY_RESEARCH.heldOff, new Date(NOW + HOLD_MS).toISOString()],
    ]);
    expect(out).toMatchObject({ ok: true, mode: "dry_run", note: "Dry run: 2 market research writes held. Nothing was written to ClickUp: market research writes are switched off." });
    // A pause after MI-3 reads as a switch, never as "until MI-3".
    expect(SAY_RESEARCH.heldOff).toBe(
      "Held: market research writes are switched off. They open when CLICKUP_WRITEBACK_APPLY_RESEARCH is true and CLICKUP_WRITEBACK_RESEARCH_KEYS lists field or comment.",
    );
    expect(h.saves()).toEqual([]);
    expect(JSON.stringify(h.finish()?.p_planned)).not.toContain(DOC);
  });

  it("an output not listed is held in its lane while the listed one is written", async () => {
    const h = jobHarness({ ...LIVE, CLICKUP_WRITEBACK_RESEARCH_KEYS: "field" }, [await row("research_field"), await row("research_comment")]);
    const out = await runResearch(h.deps);
    expect(h.releases().map(r => [r.p_id, r.p_note])).toEqual([["q-research_comment", SAY_RESEARCH.heldLane("comment")]]);
    expect(h.card.writes().map(w => w.path)).toEqual([`task/${CARD}/field/${MARKET_RESEARCH_FIELD}`]);
    expect(out).toMatchObject({ ok: true, counts: { delivered: 1, held: 1, heldOff: 1 } });
    expect(out.note).toBe("1 market research write reached ClickUp, 0 to retry, 0 failed. 1 market research write held by the switch.");
    expect(SAY_RESEARCH.heldLane("field")).toBe("Held: market research card field writes are not switched on (CLICKUP_WRITEBACK_RESEARCH_KEYS).");
  });

  it("live: the field and the comment are written, the steps frozen first, each row settled delivered, the health row live", async () => {
    const h = jobHarness(LIVE, [await row("research_field"), await row("research_comment")]);
    const out = await runResearch(h.deps);
    expect(out).toMatchObject({ ok: true, job: "research", mode: "apply", counts: { claimed: 2, delivered: 2, failed: 0 } });
    expect(out.note).toBe("2 market research writes reached ClickUp, 0 to retry, 0 failed.");
    const saves = h.saves();
    expect(saves[0]).toEqual({ steps: [expect.objectContaining({ key: "research_field", value: LINK })] });
    expect(saves.filter(s => s.state === "delivered").length).toBe(2);
    expect(h.card.value()).toBe(LINK);
    expect(h.card.comments.map(x => x.comment_text)).toEqual([TEXT]);
    expect(h.rpcs.find(r => r.name === "cockpit_clickup_writeback_begin")?.params).toEqual({ p_job: "research", p_mode: "apply", p_exclusive: true });
    expect(h.health()).toMatchObject({ ok: true, detail: { mode: "apply", keys: ["field", "comment"], counts: { delivered: 2 } } });
    // Every ClickUp call lands in the ledger under its row's id.
    expect(new Set(h.card.calls.map(x => x.actionId))).toEqual(new Set(["q-research_field", "q-research_comment"]));
    // The second pass of the same rows writes nothing more.
    const again = jobHarness(LIVE, [
      { ...(await row("research_field")), progress: { steps: { research_field: { state: "done", result: "written" } } } },
      { ...(await row("research_comment")), progress: { steps: { research_comment: { state: "done", commentId: "c-1" } } } },
    ], { card: h.card });
    await runResearch(again.deps);
    expect(h.card.writes().length).toBe(2);
  });

  it("a kept field settles skipped with the kept sentence, and the run says it was kept", async () => {
    const h = jobHarness(LIVE, [await row("research_field")], { card: card({ field: PERSON_LINK }) });
    const out = await runResearch(h.deps);
    expect(h.saves().at(-1)).toMatchObject({ state: "skipped", error: SAY_RESEARCH.kept });
    expect(out.note).toBe("0 market research writes reached ClickUp, 0 to retry, 0 failed. 1 kept as the card has it.");
    expect(out.ok).toBe(true);
  });

  it("the canary: other cards are held, the test card is written", async () => {
    const other = await row("research_field", { payload: { taskId: OTHER_CARD }, plan: { taskId: OTHER_CARD }, item: { task_id: OTHER_CARD, id: "q-other" } });
    const h = jobHarness({ ...LIVE, CLICKUP_WRITEBACK_RESEARCH_ONLY_CARDS: CARD }, [other, await row("research_field")]);
    const out = await runResearch(h.deps);
    expect(h.releases().map(r => [r.p_id, r.p_note])).toEqual([["q-other", SAY_RESEARCH.heldLimited]]);
    expect(out.note).toBe("Testing on the test card: 1 written to ClickUp, 0 to retry, 0 failed. 1 market research write held by the switch.");
  });

  it("a row whose plan does not match fails with no call", async () => {
    const bad = await row("research_comment", { payload: { commentSha256: "0".repeat(64) } });
    const h = jobHarness(LIVE, [bad]);
    const out = await runResearch(h.deps);
    expect(h.saves()).toEqual([{ state: "failed", error: SAY_RESEARCH.mismatch }]);
    expect(h.card.calls).toEqual([]);
    expect(out.ok).toBe(false);
    const shadow = jobHarness(LIVE, [await row("research_field", { run: { mode: "shadow" } })]);
    await runResearch(shadow.deps);
    expect(shadow.saves()).toEqual([{ state: "failed", error: SAY_RESEARCH.notPublished }]);
  });

  it("a release the database refuses still never settles the row: it goes to retry with the note", async () => {
    const h = jobHarness({ CLICKUP_API_TOKEN: "x" }, [await row("research_field")], { release: () => { throw new Error("Only a request or a task change is handed back this way"); } });
    await runResearch(h.deps);
    expect(h.saves()).toEqual([{ state: "retry", error: SAY_RESEARCH.heldOff, next_attempt_at: new Date(NOW + HOLD_MS).toISOString() }]);
  });

  it("another research run still sending: every row is handed back at once and the run reads ok", async () => {
    const h = jobHarness(LIVE, [await row("research_field"), await row("research_comment")], { begin: () => ({ id: null, note: "A research run that started at 11:59 Kuwait is still running." }) });
    const out = await runResearch(h.deps);
    expect(h.releases().map(r => r.p_note)).toEqual([RESEARCH_BUSY_HELD, RESEARCH_BUSY_HELD]);
    expect(out).toMatchObject({ ok: true, counts: { claimed: 2, handedBack: 2 } });
    expect(h.card.calls).toEqual([]);
  });

  it("a 429 stops the run: the rest wait for the next run with no try used", async () => {
    const c = card({ field: undefined, fail: x => (x.method === "POST" ? rejected(429) : undefined) });
    const h = jobHarness(LIVE, [await row("research_field"), await row("research_comment")], { card: c });
    const out = await runResearch(h.deps);
    expect(h.releases().map(r => [r.p_id, r.p_note])).toEqual([["q-research_comment", "ClickUp asked the cockpit to slow down (429), so the rest waits for the next run."]]);
    expect(out.ok).toBe(false);
    expect(out.note).toContain("Stopped: ClickUp asked the cockpit to slow down (429)");
  });

  it("a refused token stops the run with no try used; a card that refuses it alone climbs the ladder", async () => {
    const bad = card({ fail: x => (x.method === "GET" ? rejected(401) : undefined) });
    const h = jobHarness(LIVE, [await row("research_field"), await row("research_comment")], { card: bad });
    const out = await runResearch(h.deps);
    expect(out.note).toContain(`Stopped: ${SAY_FORMS.tokenRefused}`);
    expect(h.releases().map(r => r.p_id)).toEqual(["q-research_field", "q-research_comment"]);
    const one = card({ fail: x => (x.method === "GET" && x.path === `task/${CARD}` ? rejected(401) : undefined) });
    const k = jobHarness(LIVE, [await row("research_field")], { card: one });
    const kOut = await runResearch(k.deps);
    // A retry keeps ClickUp's wording (it reaches no run); the end of the ladder says it plainly.
    expect(k.saves().at(-1)).toMatchObject({ state: "retry", error: rejected(401).message });
    expect(kOut.note).toContain(`ClickUp refused the cockpit's token on card ${CARD}.`);
    expect(kOut.note).not.toContain("Stopped:");
    const last = jobHarness(LIVE, [await row("research_field", { item: { attempts: 6 } })], { card: one });
    await runResearch(last.deps);
    expect(last.saves().at(-1)).toMatchObject({ state: "failed", error: SAY_FORMS.cardRefused });
  });

  it("idle: nothing to write only when the queue reads empty; a count it cannot read is said", async () => {
    const empty = jobHarness(LIVE, []);
    expect((await runResearch(empty.deps)).note).toBe("Nothing to write.");
    const waiting = jobHarness({ CLICKUP_API_TOKEN: "x" }, [], { inputs: () => ({ queue: { queued: 2 } }) });
    expect((await runResearch(waiting.deps)).note).toBe("Nothing written: 2 market research writes wait in the queue while the market research writer is off.");
    const brake = jobHarness(LIVE, [], { inputs: () => ({ queue: { retry: 1 } }) });
    expect((await runResearch(brake.deps)).note).toBe("Nothing to write now: 1 market research write waits behind an older run on their card, for the setting market_intel.apply_clickup, or for the next run.");
    const later = jobHarness(LIVE, [], { inputs: () => ({ queue: { retry: 1 }, oldestDue: new Date(NOW + 5 * 60_000).toISOString() }) });
    expect((await runResearch(later.deps)).note).toBe("Nothing to write now: 1 market research write waits for a later try, the next at 12:05 Kuwait.");
    const unread = jobHarness(LIVE, [], { inputs: () => { throw PGRST202; } });
    expect((await runResearch(unread.deps)).note).toBe("Nothing to write now. The market research queue could not be counted, so it is not reported as empty.");
    expect(await researchIdle(researchDb(async () => ({ queue: [] })), researchGate(() => undefined), NOW)).toMatchObject({ counts: {} });
  });

  it("a switch it cannot read reads not ok with its sentence first", async () => {
    const h = jobHarness({ ...LIVE, CLICKUP_WRITEBACK_RESEARCH_KEYS: "fields" }, []);
    const out = await runResearch(h.deps);
    expect(out).toMatchObject({ ok: false, mode: "dry_run" });
    expect(out.note.startsWith(RESEARCH_KEYS_BAD)).toBe(true);
    expect(h.health()).toMatchObject({ ok: false });
  });

  it("a row claimed while the switch cannot be read goes back with the switch's own sentence, as runForms does", async () => {
    // The database brake still sees the last live report for up to 15 minutes, so its claim can hand rows over.
    for (const [env, sentence] of [
      [{ ...LIVE, CLICKUP_WRITEBACK_RESEARCH_KEYS: "fields" }, RESEARCH_KEYS_BAD],
      [{ ...LIVE, CLICKUP_WRITEBACK_RESEARCH_ONLY_CARDS: "every card please" }, RESEARCH_NOT_A_CARD],
    ] as const) {
      const h = jobHarness(env, [await row("research_field"), await row("research_comment")]);
      const out = await runResearch(h.deps);
      expect(h.releases().map(r => [r.p_id, r.p_note, r.p_next_attempt_at])).toEqual([
        ["q-research_field", sentence, new Date(NOW + HOLD_MS).toISOString()],
        ["q-research_comment", sentence, new Date(NOW + HOLD_MS).toISOString()],
      ]);
      expect(h.card.calls).toEqual([]);
      expect(h.saves()).toEqual([]);
      expect(out.ok).toBe(false);
      expect(out.note.startsWith(sentence)).toBe(true);
    }
    // Switched off on purpose after MI-3 (a pause): the row says the switch is off, never "until MI-3".
    const paused = jobHarness({ ...LIVE, CLICKUP_WRITEBACK_APPLY_RESEARCH: "false" }, [await row("research_field")]);
    await runResearch(paused.deps);
    expect(paused.releases().map(r => r.p_note)).toEqual([SAY_RESEARCH.heldOff]);
    expect(SAY_RESEARCH.heldOff).not.toContain("MI-3");
  });

  it("a row whose run went back in progress after it published waits for it with no try used, then is written once it publishes", async () => {
    // cockpit_market_intel_release sends a published run back to queued (an error, an outage, a pause); it resumes.
    const h = jobHarness(LIVE, [await row("research_field", { run: { state: "queued", docId: DOC } }), await row("research_comment", { run: { state: "writing", docId: DOC } })]);
    const out = await runResearch(h.deps);
    expect(h.releases().map(r => [r.p_id, r.p_note, r.p_next_attempt_at])).toEqual([
      ["q-research_field", SAY_RESEARCH.heldRun, new Date(NOW + HOLD_MS).toISOString()],
      ["q-research_comment", SAY_RESEARCH.heldRun, new Date(NOW + HOLD_MS).toISOString()],
    ]);
    // Never settled failed, nothing frozen, nothing sent.
    expect(h.saves()).toEqual([]);
    expect(h.card.calls).toEqual([]);
    expect(out).toMatchObject({ ok: true, counts: { held: 2, heldRun: 2, failed: 0 } });
    expect(out.note).toBe("0 market research writes reached ClickUp, 0 to retry, 0 failed. 2 market research writes wait for their runs to publish again.");
    expect(JSON.stringify(h.finish()?.p_planned)).not.toContain(DOC);
    // The run publishes again: the same rows (no new enqueue) are written.
    const later = jobHarness(LIVE, [await row("research_field", { run: { state: "done", docId: DOC } }), await row("research_comment", { run: { state: "publishing", docId: DOC } })], { card: h.card });
    const done = await runResearch(later.deps);
    expect(done).toMatchObject({ ok: true, counts: { delivered: 2, heldRun: 0 } });
    expect(h.card.value()).toBe(LINK);
    expect(h.card.comments.map(x => x.comment_text)).toEqual([TEXT]);
  });

  it("a run that ended failed or needs_person after its Doc was made still gets its card written; without this Doc it fails in words", async () => {
    const kept = jobHarness(LIVE, [await row("research_field", { run: { state: "needs_person", docId: DOC } })]);
    expect(await runResearch(kept.deps)).toMatchObject({ counts: { delivered: 1 } });
    const gone = jobHarness(LIVE, [await row("research_field", { run: { state: "failed", docId: null } })]);
    await runResearch(gone.deps);
    expect(gone.saves()).toEqual([{ state: "failed", error: SAY_RESEARCH.notPublished }]);
    expect(gone.card.calls).toEqual([]);
  });
});

describe("the research doctor and the doctor line", () => {
  it("reads Ready when the field is a link, the test card is on the list and the queue is installed", async () => {
    const h = jobHarness({ ...LIVE, CRON_SECRET: "s" }, []);
    const out = await runResearchDoctor(h.deps);
    expect(out.ok).toBe(true);
    expect(out.note).toBe(`Ready. Market research writes: apply: field, comment. Market Research doc is a link field on Clients - Mahara. The test card ${CARD} is on Clients - Mahara.`);
    expect(h.card.writes()).toEqual([]);
    expect(h.rpcs.find(r => r.name === "syncState:clickup-writeback:research-doctor")?.params).toMatchObject({ ok: true });
  });

  it("says the queue is not in the database yet before MI-3, never that it is empty", async () => {
    const h = jobHarness({ CLICKUP_API_TOKEN: "x", CRON_SECRET: "s" }, [], { inputs: () => { throw PGRST202; } });
    const out = await runResearchDoctor(h.deps);
    expect(out.ok).toBe(false);
    expect(out.problems).toEqual(["The market research queue is not in the database yet: it comes with the MI-3 migration (cockpit_clickup_writeback_claim_research and cockpit_clickup_research_doctor_inputs)."]);
  });

  it("names a missing field, a field that is not a link, another field id in the database and the publish brake", async () => {
    const missing = jobHarness({ ...LIVE, CRON_SECRET: "s" }, [], { card: card({ noField: true }) });
    expect((await runResearchDoctor(missing.deps)).problems).toEqual(["Market Research doc (7489dbcc) is not on the Clients - Mahara list in ClickUp, so the research writer would not write it."]);
    const text = jobHarness({ ...LIVE, CRON_SECRET: "s" }, [], { card: card({ fieldType: "text" }), inputs: () => ({ queue: {}, field: "5d57fdde-eb70-4610-a23b-88f718b4451d", applyClickup: false }) });
    const out = await runResearchDoctor(text.deps);
    expect(out.problems).toEqual([
      "The database and the writer name different ClickUp fields for the Market Research doc.",
      "Market Research doc is a text field in ClickUp, not a link, so the research writer would not write it.",
    ]);
    expect(out.note.endsWith("The setting market_intel.apply_clickup is off, so the database hands this writer no rows yet.")).toBe(true);
  });

  it("names secrets by name only and checks the canary cards it is given", async () => {
    const h = jobHarness({ CLICKUP_API_TOKEN: "pk_secret_value", CLICKUP_WRITEBACK_RESEARCH_ONLY_CARDS: CARD }, []);
    const out = await runResearchDoctor(h.deps);
    expect(out.secrets).toEqual({ CLICKUP_API_TOKEN: true, CRON_SECRET: false, CLICKUP_WRITEBACK_APPLY_RESEARCH: false, CLICKUP_WRITEBACK_RESEARCH_KEYS: false, CLICKUP_WRITEBACK_RESEARCH_ONLY_CARDS: true });
    expect(JSON.stringify(out)).not.toContain("pk_secret_value");
    const checked = await researchDoctorChecks(card().provider(), []);
    expect(checked).toEqual({ problems: [], counts: { fieldType: "url", cards: ["86eywg1cq"] } });
  });

  it("the general doctor names the research switch from the environment only", async () => {
    const h = jobHarness({ CLICKUP_API_TOKEN: "x", CRON_SECRET: "s" }, []);
    h.deps.rpc = async () => ({ queue: {} });
    const off = await runDoctor(h.deps);
    expect(off).toMatchObject({ researchMode: "dry_run", researchKeys: [], researchOnlyCards: [] });
    expect(off.note).toContain("Market research writes: dry run (written only when CLICKUP_WRITEBACK_APPLY_RESEARCH is true and CLICKUP_WRITEBACK_RESEARCH_KEYS lists field or comment).");
    expect(h.card.calls).toEqual([]);
    const canary = jobHarness({ ...LIVE, CLICKUP_WRITEBACK_RESEARCH_ONLY_CARDS: CARD }, []);
    canary.deps.rpc = async () => ({ queue: {} });
    expect(await runDoctor(canary.deps)).toMatchObject({ researchMode: "apply_limited", researchKeys: ["field", "comment"], researchOnlyCards: [CARD] });
  });
});

// --- the wiring ---------------------------------------------------------------------------------------------------

describe("the wiring", () => {
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
  it("index.ts runs research and research_doctor at the forms jobs' pace", () => {
    const index = read("./index.ts");
    expect(index).toContain('job === "research" ? await runResearch(deps)');
    expect(index).toContain('job === "research_doctor" ? await runResearchDoctor(deps)');
    expect(index).toContain('const formsJob = job === "forms" || job === "forms_doctor" || job === "research" || job === "research_doctor";');
    expect(JOBS.slice(-2)).toEqual(["research", "research_doctor"]);
  });

  it("run.ts calls only the RPCs 20261009f defines; the research RPCs live in research.ts", () => {
    const run = read("./run.ts");
    expect(run).not.toContain('rpc("cockpit_clickup_writeback_claim_research"');
    expect(read("./research.ts")).toContain('rpc("cockpit_clickup_writeback_claim_research"');
  });

  // The MI-3 migration adds the research queue. Until a migration in the tree defines its claim, this check is
  // reported as skipped, never as passed.
  const MIGRATIONS = new URL("../../migrations/", import.meta.url);
  const files = readdirSync(MIGRATIONS).filter(f => f.endsWith(".sql")).sort();
  const defining = files.filter(f => read(`../../migrations/${f}`).includes("FUNCTION public.cockpit_clickup_writeback_claim_research("));
  it.skipIf(!defining.length)("the MI-3 migration defines every research RPC, service role only, and opens the queue kind, the run job and the release to research", () => {
    const sql = defining.map(f => read(`../../migrations/${f}`)).join("\n");
    const called = [...new Set([...read("./research.ts").matchAll(/rpc\(\s*"(\w+)"/g)].map(m => m[1]))].filter(n => n !== "cockpit_clickup_writeback_release");
    for (const name of called) {
      expect(sql).toContain(`FUNCTION public.${name}(`);
      expect(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\) FROM PUBLIC, ?anon, ?authenticated`).test(sql)).toBe(true);
      expect(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\) TO service_role`).test(sql)).toBe(true);
    }
    expect(sql).toMatch(/'research'/);
    expect(/GRANT [^;]*cockpit_clickup_writeback_claim_research[^;]* TO [^;]*(anon|authenticated)/.test(sql)).toBe(false);
    // The definitions in force after every migration in the tree, in name order (a later file that replaces the
    // generic claim without 'research' counts too).
    expect(mi3Gaps(files.map(f => read(`../../migrations/${f}`)).join("\n"))).toEqual([]);
  });

  // mi3Gaps itself, on the live bodies 20261029t installed (live 2026-11-03) and synthetic MI-3 bodies, so the armed
  // check above is known to catch the gap before any MI-3 file exists.
  describe("mi3Gaps: what the MI-3 SQL must also change (4.23.1 items 1 and 3)", () => {
    const live = read("../../migrations/20261029t_forms_clickup_writeback.sql");
    const fn = (name: string, args: string, body: string) =>
      `CREATE OR REPLACE FUNCTION public.${name}(${args})\n RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''\nAS $function$\nBEGIN\n${body}\nEND $function$;\n`;
    const MI3 = {
      claim: fn("cockpit_clickup_writeback_claim", "p_token uuid, p_limit integer DEFAULT 15", "  SELECT 1 FROM x q WHERE q.kind NOT IN ('request','task_action','form','research');"),
      idle: fn("cockpit_clickup_writeback_idle", "p_job text, p_ok boolean, p_note text", " IF p_job NOT IN('kpi','log','dosdonts','requests','forms','research') THEN RETURN; END IF;"),
      begin: fn("cockpit_clickup_writeback_begin", "p_job text, p_mode text, p_exclusive boolean", " IF p_job NOT IN('kpi','log','dosdonts','requests','forms','research') OR p_mode NOT IN('dry_run') THEN RAISE EXCEPTION 'x'; END IF;"),
      release: fn("cockpit_clickup_writeback_release", "p_id uuid, p_token uuid, p_planned jsonb, p_note text, p_next_attempt_at timestamptz", " IF q.kind NOT IN ('request','task_action','form','research') THEN RAISE EXCEPTION 'x'; END IF;"),
      own: fn(
        "cockpit_clickup_writeback_claim_research",
        "p_token uuid, p_limit integer",
        "  SELECT 1 FROM x q JOIN y r ON r.id = q.source_id WHERE r.state IN ('publishing','done')\n   AND ((q.state IN ('queued','retry','unknown') AND q.next_attempt_at <= now()) OR (q.state = 'sending' AND q.claimed_at < now() - interval '10 minutes'));",
      ),
    };
    const CLAIM_GAP = "the generic claim cockpit_clickup_writeback_claim still takes research rows (the log job settles them skipped)";
    it("finds every gap on today's live bodies with only the research claim added", () => {
      expect(mi3Gaps(live + MI3.own)).toEqual([
        CLAIM_GAP,
        "cockpit_clickup_writeback_idle drops job research (index.ts's crash line)",
        "cockpit_clickup_writeback_begin refuses job research",
        "cockpit_clickup_writeback_release refuses a research row",
      ]);
    });
    it("passes the whole MI-3 change, and fails one that leaves the generic claim alone (the review's case)", () => {
      expect(mi3Gaps(live + MI3.own + MI3.claim + MI3.idle + MI3.begin + MI3.release)).toEqual([]);
      expect(mi3Gaps(live + MI3.own + MI3.idle + MI3.begin + MI3.release)).toEqual([CLAIM_GAP]);
      // A later file that replaces the generic claim again without 'research' reopens the gap.
      expect(mi3Gaps(live + MI3.own + MI3.claim + MI3.idle + MI3.begin + MI3.release + live)).toContain(CLAIM_GAP);
    });
    it("a research claim that never reclaims its stale sending rows, or ignores its run's state, is a gap", () => {
      const all = live + MI3.claim + MI3.idle + MI3.begin + MI3.release;
      expect(mi3Gaps(all + fn("cockpit_clickup_writeback_claim_research", "p_token uuid, p_limit integer", "  SELECT 1 FROM x q JOIN y r ON true WHERE r.state IN ('publishing','done') AND q.state IN ('queued','retry');"))).toEqual([
        "cockpit_clickup_writeback_claim_research never reclaims its own sending rows after 10 minutes",
      ]);
      expect(mi3Gaps(all + fn("cockpit_clickup_writeback_claim_research", "p_token uuid, p_limit integer", "  SELECT 1 FROM x q WHERE q.state = 'sending' AND q.claimed_at < now() - interval '10 minutes';"))).toEqual([
        "cockpit_clickup_writeback_claim_research hands out rows whatever their run's state",
      ]);
      expect(mi3Gaps(all)).toEqual(["cockpit_clickup_writeback_claim_research is not defined"]);
    });
  });
});

/** The body of the last CREATE of public.<name>(...) in sql: the definition in force after every file, or null. */
function lastBody(sql: string, name: string): string | null {
  let at = -1;
  for (const m of sql.matchAll(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\(`, "g"))) at = m.index ?? at;
  if (at < 0) return null;
  const rest = sql.slice(at);
  const tag = /\bAS\s+(\$[A-Za-z_]*\$)/.exec(rest);
  if (!tag) return null;
  const from = tag.index + tag[0].length;
  const to = rest.indexOf(tag[1], from);
  return to < 0 ? null : rest.slice(from, to);
}
/** The quoted words in the first `<lead> NOT IN (...)` of a body. */
const notIn = (body: string | null, lead: string) =>
  [...(new RegExp(`${lead}\\s+NOT\\s+IN\\s*\\(([^)]*)\\)`, "i").exec(body ?? "")?.[1] ?? "").matchAll(/'(\w+)'/g)].map(m => m[1]);

/**
 * What the MI-3 SQL must change besides adding the research RPCs (contract 4.23.1 items 1 and 3), read from the
 * definitions in force: the generic claim and the release keep research rows out of / let them back through their kind
 * list, begin and idle take job research, and the research claim reclaims its own stale sending rows and reads its run's
 * state. One sentence per gap; none means the change is whole.
 */
function mi3Gaps(sql: string): string[] {
  const gaps: string[] = [];
  const claim = notIn(lastBody(sql, "cockpit_clickup_writeback_claim"), "q\\.kind");
  if (!["request", "task_action", "form", "research"].every(k => claim.includes(k)))
    gaps.push("the generic claim cockpit_clickup_writeback_claim still takes research rows (the log job settles them skipped)");
  if (!notIn(lastBody(sql, "cockpit_clickup_writeback_idle"), "p_job").includes("research"))
    gaps.push("cockpit_clickup_writeback_idle drops job research (index.ts's crash line)");
  if (!notIn(lastBody(sql, "cockpit_clickup_writeback_begin"), "p_job").includes("research")) gaps.push("cockpit_clickup_writeback_begin refuses job research");
  if (!notIn(lastBody(sql, "cockpit_clickup_writeback_release"), "q\\.kind").includes("research")) gaps.push("cockpit_clickup_writeback_release refuses a research row");
  const own = lastBody(sql, "cockpit_clickup_writeback_claim_research");
  if (own === null) gaps.push("cockpit_clickup_writeback_claim_research is not defined");
  else {
    if (!/state\s*=\s*'sending'\s+AND\s+(?:\w+\.)?claimed_at\s*<\s*now\(\)\s*-\s*interval\s*'10 minutes'/i.test(own))
      gaps.push("cockpit_clickup_writeback_claim_research never reclaims its own sending rows after 10 minutes");
    if (!/'publishing'/.test(own)) gaps.push("cockpit_clickup_writeback_claim_research hands out rows whatever their run's state");
  }
  return gaps;
}
