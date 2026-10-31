// op effects.sweep (effects.ts; docs/forms/STAGE2B-CONTRACT.md build 0): the cron
// secret's one op, and the drafts it begins as the response's own seat with no
// seat token. Every person, client and recording here is invented (the testkit's).
import { beforeEach, describe, expect, test } from "bun:test";
import { RpcError } from "../cockpit-hours-sync/db.ts";
import { makeDoor } from "./door.ts";
import { type DraftView, draftsForResponse, OFF } from "./drafts.ts";
import {
  SWEEP_BUDGET_MS,
  SWEEP_MAX,
  serviceDrafts,
  sweepEffects,
  type WaitingEffect,
} from "./effects.ts";
import { clearTranscriptCache } from "./fathom.ts";
import { CRITERIA } from "./prompts/grade.ts";
import {
  answer,
  CSM_EMAIL,
  csmActor,
  fakeDeps,
  fathomApi,
  jwt,
  keyRow,
  matchInputs,
  meeting,
  NOW,
  SERVICE_KEY,
  STAFF,
  storeItem,
  tiedRpc,
} from "./testkit.ts";

const RID = "44444444-4444-4444-8444-444444444444";
const REC = "194756343";
const SECRET = "invented-cron-secret-0123456789";
const ANON = jwt({ role: "anon" });
const TRANSCRIPT =
  "[00:00:05] Csm Seat: Hello, thanks for joining.\n[00:00:12] Omar Testcontact: We are happy with the designs.";
const SUMMARY =
  "## Key Takeaways\n- Client happy with the designs\n## Next Steps\n- Send the logo files";
const GRADE_TEXT = {
  criteria: CRITERIA.map((name, i) => ({
    name,
    score: (i % 3) + 6,
    note: `Note on ${name}.`,
  })),
  overall: "A clear call.",
  color: "Green",
};

/** The service read of a live, sent check-in (cockpit_form_response_view). */
const responseView = (over: Record<string, unknown> = {}) => ({
  id: RID,
  formKey: "checkin",
  mode: "live",
  state: "submitted",
  taskId: "86exCITYW",
  clientName: "City Wood",
  answers: {
    call: {
      kind: "fathom",
      recordingId: REC,
      why: "same_room",
      confirmed: true,
    },
    they_owe: [{ text: "Send the logo files" }],
  },
  ...over,
});
const waiting = (
  kind: "grade" | "recap",
  over: Partial<WaitingEffect> = {},
): WaitingEffect => ({
  effectId: `eeeeeeee-0000-4000-8000-00000000000${kind === "grade" ? 1 : 2}`,
  responseId: RID,
  kind,
  taskId: "86exCITYW",
  recordingId: REC,
  since: "2026-10-28T08:55:00Z",
  draftState: null,
  actorId: csmActor.actorId,
  response: responseView(),
  ...over,
});

type Attempt = {
  id: string;
  kind: string;
  state: string;
  attempt: number;
  responseId: string | null;
  reason: string | null;
};

/** The sweep's world: the service RPCs a cron request may call; any seat RPC throws. */
function world(
  o: {
    rows?: WaitingEffect[];
    keys?: string[];
    actor?: unknown;
    secret?: string | null;
  } = {},
) {
  const attempts: Attempt[] = [];
  const keys = new Set(o.keys ?? ["fathom", "deepseek", "anthropic"]);
  const stored = storeItem({ startsAt: "2026-10-28T07:00:00.000Z" });
  const matched = matchInputs({ store: [stored] });
  const view = (a: Attempt): DraftView => ({
    kind: a.kind as DraftView["kind"],
    state: a.state as DraftView["state"],
    attempt: a.attempt,
    provider: "anthropic",
    model: null,
    promptVersion: "x",
    at: "2026-10-28T09:00:00Z",
    reason: a.reason,
    output: null,
  });
  const f = fakeDeps({
    env: o.secret === null ? {} : { NOTICES_CRON_SECRET: o.secret ?? SECRET },
    // The seat's token does not exist on a cron request: every seat RPC throws.
    seat: {},
    rpc: {
      cockpit_form_effects_waiting: o.rows ?? [waiting("grade")],
      cockpit_forms_actor: o.actor === undefined ? csmActor : o.actor,
      cockpit_form_drafts_service: () => ({
        recordingId: REC,
        drafts: attempts.map(view),
        now: "x",
      }),
      cockpit_form_draft_inputs: {
        recordingId: REC,
        class: "candidate",
        gone: false,
        startsAt: "2026-10-28T07:00:00Z",
        endsAt: "2026-10-28T07:30:00Z",
        summary: SUMMARY,
        actionItems: [],
        transcriptPath: "fathom/194756343.txt",
        shareUrl: "https://fathom.video/share/TESTshareAAA1",
        recorderEmail: CSM_EMAIL,
        recorderName: "Csm Seat",
        staff: STAFF,
        client: {
          taskId: "86exCITYW",
          name: "City Wood",
          stage: "Live",
          happiness: "Happy",
        },
        lastForm: null,
      },
      cockpit_forms_key_get: (a: Record<string, any>) =>
        keys.has(a.p_provider) ? keyRow(a.p_provider) : null,
      cockpit_form_draft_begin: (a: Record<string, any>) => {
        const p = a.p;
        const row: Attempt = {
          id: `draft-${attempts.length + 1}`,
          kind: p.kind,
          state: "drafting",
          attempt: 1,
          responseId: p.responseId ?? null,
          reason: null,
        };
        attempts.push(row);
        return { id: row.id, existing: false, state: "drafting", attempt: 1 };
      },
      cockpit_form_draft_finish: (a: Record<string, any>) => {
        const row = attempts.find(x => x.id === a.p_id);
        if (row && row.state === "drafting")
          Object.assign(row, { state: a.p.state, reason: a.p.reason ?? null });
        return row ? view(row) : null;
      },
      cockpit_fathom_match_inputs: matched,
      cockpit_form_recordings_tied: tiedRpc({
        store: [stored],
        bookings: matched.bookings,
        formLinks: matched.formLinks,
        responses: { [RID]: csmActor },
      }),
      cockpit_csm_client_gate_for_actor: { taskId: "86exCITYW" },
    },
    storage: { "fathom/194756343.txt": TRANSCRIPT },
    routes: [
      url =>
        url.host === "api.anthropic.com"
          ? answer({
              model: "claude-opus-5-5",
              stop_reason: "end_turn",
              content: [{ type: "text", text: JSON.stringify(GRADE_TEXT) }],
            })
          : null,
      fathomApi({ pages: [[meeting()]] }),
    ],
  });
  return {
    f,
    attempts,
    run: async () => {
      const out = await sweepEffects(f.deps);
      await f.drain();
      return out;
    },
  };
}

const cronPost = (
  body: unknown,
  secret: string | null,
  auth = `Bearer ${ANON}`,
) =>
  new Request("https://example.test/functions/v1/cockpit-forms-api", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: auth,
      ...(secret === null ? {} : { "x-cron-secret": secret }),
    },
    body: JSON.stringify(body),
  });

beforeEach(() => clearTranscriptCache());

describe("the door: the cron secret runs the 1-1 notes sweep only", () => {
  test("the right secret runs effects.sweep and answers {ok, begun, skipped}, no drafts view", async () => {
    const w = world();
    const res = await makeDoor(w.f.deps)(
      cronPost({ op: "effects.sweep" }, SECRET),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, begun: 1, skipped: 0 });
    expect(w.f.seat.calls).toEqual([]);
  });

  test("any other op with the secret is 403; a wrong or empty secret is 401 Not allowed.", async () => {
    const w = world();
    const door = makeDoor(w.f.deps);
    for (const op of [
      "doctor",
      "checkin.calls",
      "recap.approve",
      "keys.save",
      "",
    ]) {
      const res = await door(cronPost({ op }, SECRET));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: "The cron secret runs the 1-1 notes sweep only.",
      });
    }
    for (const wrong of ["nope", `${SECRET}x`, SECRET.slice(0, -1), ""]) {
      const res = await door(cronPost({ op: "effects.sweep" }, wrong));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Not allowed." });
    }
    expect(w.f.service.calls).toEqual([]);
  });

  test("a secret saved with a trailing newline, or sent with spaces, still runs the sweep, as cockpit-notices trims it", async () => {
    // Review round 3: the notices kick worked while every effects.sweep post answered 401, and nothing read that 401.
    const w = world({ secret: `${SECRET}\n` });
    const door = makeDoor(w.f.deps);
    const res = await door(cronPost({ op: "effects.sweep" }, SECRET));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, begun: 1, skipped: 0 });
    const spaced = world();
    expect(
      (
        await makeDoor(spaced.f.deps)(
          cronPost({ op: "effects.sweep" }, ` ${SECRET} `),
        )
      ).status,
    ).toBe(200);
    // Trimming opens nothing new: a value of only whitespace matches nothing, and a wrong secret is still 401.
    const blank = world({ secret: " \n" });
    for (const given of ["", " ", "\n"])
      expect(
        (await makeDoor(blank.f.deps)(cronPost({ op: "effects.sweep" }, given)))
          .status,
      ).toBe(401);
    expect(
      (await door(cronPost({ op: "effects.sweep" }, `${SECRET}x\n`))).status,
    ).toBe(401);
    expect(blank.f.service.calls).toEqual([]);
  });

  test("with no NOTICES_CRON_SECRET set, no secret is right", async () => {
    const w = world({ secret: null });
    const res = await makeDoor(w.f.deps)(cronPost({ op: "effects.sweep" }, ""));
    expect(res.status).toBe(401);
    expect(w.f.service.calls).toEqual([]);
  });

  test("the service key still runs the doctor only; effects.sweep needs the cron secret", async () => {
    const w = world();
    const door = makeDoor(w.f.deps);
    const res = await door(
      cronPost({ op: "effects.sweep" }, null, `Bearer ${SERVICE_KEY}`),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "The service key runs the doctor only.",
    });
    // Without the header, a seat is asked for, as for any op.
    const seatless = await door(cronPost({ op: "effects.sweep" }, null));
    expect(seatless.status).toBe(401);
  });
});

describe("sweepEffects", () => {
  test("begins the grade as the response's own seat, from the service read of the response", async () => {
    const w = world();
    expect(await w.run()).toEqual({ ok: true, begun: 1, skipped: 0 });
    expect(w.f.service.named("cockpit_forms_actor").map(c => c.args)).toEqual([
      { p_actor: csmActor.actorId },
    ]);
    expect(
      w.f.service.named("cockpit_form_draft_inputs").map(c => c.args),
    ).toEqual([{ p_task_id: "86exCITYW", p_recording_id: REC }]);
    const begun = w.f.service
      .named("cockpit_form_draft_begin")
      .map(c => c.args.p);
    expect(
      begun.map(p => [p.kind, p.taskId, p.recordingId, p.actorEmail]),
    ).toEqual([["grade", "86exCITYW", REC, CSM_EMAIL]]);
    expect(w.attempts.map(a => [a.kind, a.state])).toEqual([
      ["grade", "ready"],
    ]);
  });

  test("the recap is begun for its response", async () => {
    const w = world({ rows: [waiting("recap")] });
    await w.run();
    const begun = w.f.service
      .named("cockpit_form_draft_begin")
      .map(c => c.args.p);
    expect(begun.map(p => [p.kind, p.responseId])).toEqual([["recap", RID]]);
  });

  test("on the cron path no seat RPC is ever called", async () => {
    const w = world({
      rows: [waiting("grade"), waiting("recap")],
      keys: ["fathom"],
    });
    await w.run();
    await w.run();
    expect(w.f.seat.calls).toEqual([]);
    expect(
      w.f.service.named("cockpit_form_drafts_service").length,
    ).toBeGreaterThan(0);
  });

  test(`at most ${SWEEP_MAX} rows begin drafts in a run`, async () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      waiting("grade", {
        effectId: `eeeeeeee-0000-4000-8000-0000000000${10 + i}`,
      }),
    );
    const w = world({ rows });
    expect(await w.run()).toEqual({ ok: true, begun: 4, skipped: 0 });
    expect(w.f.service.named("cockpit_forms_actor")).toHaveLength(4);
    expect(w.f.service.named("cockpit_form_draft_begin")).toHaveLength(4);
  });

  test("rows waiting on a summary do not block a later row that can draft (finish review)", async () => {
    const OLDER = ["194756301", "194756302", "194756303", "194756304"];
    const rows = OLDER.map((rec, i) =>
      waiting("grade", {
        effectId: `eeeeeeee-0000-4000-8000-0000000000${10 + i}`,
        recordingId: rec,
        response: responseView({
          answers: {
            call: {
              kind: "fathom",
              recordingId: rec,
              why: "same_room",
              confirmed: true,
            },
          },
        }),
      }),
    );
    const w = world({
      rows: [
        ...rows,
        waiting("grade", { effectId: "eeeeeeee-0000-4000-8000-000000000020" }),
      ],
    });
    // The older recordings have no Fathom summary yet (SUMMARY_WAIT); only the newest has one.
    const service = w.f.deps.rpc as (
      n: string,
      a?: Record<string, any>,
    ) => Promise<any>;
    w.f.deps.rpc = (async (name: string, args: Record<string, any> = {}) => {
      const out = await service(name, args);
      return name === "cockpit_form_draft_inputs" &&
        OLDER.includes(args.p_recording_id)
        ? { ...out, recordingId: args.p_recording_id, summary: null }
        : out;
    }) as typeof w.f.deps.rpc;
    expect(await w.run()).toEqual({ ok: true, begun: 1, skipped: 4 });
    expect(w.attempts.map(a => [a.kind, a.state])).toEqual([
      ["grade", "ready"],
    ]);
    expect(
      w.f.service
        .named("cockpit_form_draft_begin")
        .map(c => c.args.p.recordingId),
    ).toEqual([REC]);
  });

  test("a dark database answers D11's read-back: 200, nothing begun, and no read of any kind", async () => {
    const w = world({ rows: [] });
    const res = await makeDoor(w.f.deps)(
      cronPost({ op: "effects.sweep" }, SECRET),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, begun: 0, skipped: 0 });
    expect(w.f.service.calls.map(c => c.name)).toEqual([
      "cockpit_form_effects_waiting",
    ]);
  });

  test("a refused seat begins nothing and is counted skipped", async () => {
    const refused = () => {
      throw new RpcError("That seat is switched off.", "42501");
    };
    const w = world({ actor: refused });
    expect(await w.run()).toEqual({ ok: true, begun: 0, skipped: 1 });
    expect(w.f.service.named("cockpit_form_draft_begin")).toEqual([]);
    const nobody = world({ actor: null });
    expect(await nobody.run()).toEqual({ ok: true, begun: 0, skipped: 1 });
    expect(nobody.f.service.named("cockpit_form_draft_begin")).toEqual([]);
  });

  test("a missing key: one off row through the service read, and none more on a second run", async () => {
    const w = world({ keys: ["fathom", "deepseek"] });
    expect(await w.run()).toEqual({ ok: true, begun: 0, skipped: 1 });
    expect(w.attempts.map(a => [a.kind, a.state, a.reason])).toEqual([
      ["grade", "off", OFF.anthropic],
    ]);
    expect(await w.run()).toEqual({ ok: true, begun: 0, skipped: 1 });
    expect(w.attempts).toHaveLength(1);
    expect(
      w.f.service.named("cockpit_form_drafts_service").map(c => c.args),
    ).toContainEqual({ p_response_id: RID });
    expect(w.f.seat.calls).toEqual([]);
  });

  test("a row with no seat or response, or another kind, begins nothing", async () => {
    const w = world({
      rows: [
        waiting("grade", { actorId: null }),
        waiting("grade", { response: null }),
        { ...waiting("grade"), kind: "todos" as "grade" },
      ],
    });
    expect(await w.run()).toEqual({ ok: true, begun: 0, skipped: 3 });
    expect(w.f.service.named("cockpit_forms_actor")).toEqual([]);
  });

  test(`no row starts after ${SWEEP_BUDGET_MS / 1000} seconds`, async () => {
    const w = world({ rows: [waiting("grade"), waiting("recap")] });
    let t = NOW.getTime();
    w.f.deps.now = () => {
      t += 60_000;
      return new Date(t);
    };
    await w.run();
    expect(w.f.service.named("cockpit_forms_actor")).toHaveLength(1);
  });

  test("the reader is the service read, shaped as the seat's", async () => {
    const w = world();
    expect(await serviceDrafts(w.f.deps)(RID)).toEqual({
      recordingId: REC,
      drafts: [],
    });
    const reads: string[] = [];
    const out = await draftsForResponse(
      { deps: w.f.deps, actor: csmActor },
      responseView({ answers: { call: { kind: "none" } } }),
      ["grade"],
      async id => {
        reads.push(id);
        return { recordingId: null, drafts: [] };
      },
    );
    expect(out.recordingId).toBeNull();
    expect(reads).toEqual([]);
  });
});
