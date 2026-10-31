import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProviderError, Transport } from "../ad-billing-guard/transport.ts";
import { CARD_GROUP_FIELD, sha256, type Verdict } from "./core.ts";
import type { Db, Health } from "./db.ts";
import type { OldSenders } from "./oldSenders.ts";
import { readMessage, type SendOutcome, type WaMessage } from "./whapi.ts";
import {
  BAD_GROUP,
  CARD_BAD_ID,
  CARD_CACHE_MS,
  CARD_LATER,
  CARD_NO_FIELDS,
  CARD_NO_GROUP_FIELD,
  CARD_NOT_SERVED,
  type CardCache,
  CLAIM_BY_MS,
  CLICKUP_UNREAD,
  COLUMN_MOVED,
  cardKey,
  cardRefusal,
  DRY_NOTHING,
  doctor,
  fileCardCache,
  GROUP_DIFFERS,
  NO_GROUP,
  NOT_A_CARD,
  NOTHING,
  type Providers,
  RECEIPTS_LOST,
  RUN_SECONDS,
  type RunDeps,
  readEnv,
  readSwitches,
  runOnce,
  SEND_BY_MS,
  SEND_MARGIN_MS,
  STOPPED,
  SWITCH_TWICE,
  SWITCH_UNKNOWN,
  SWITCHED_OFF,
  type Switches,
  TOO_LATE,
  WAIT_SLACK_MS,
  wire,
} from "./worker.ts";

// A fake database, WhatsApp, Client Data and ClickUp; nothing touches a network. Every card, group and text is invented.
const A = "86abc0001";
const G1 = "120363000000000001@g.us";
const G2 = "120363000000000002@g.us";
const BODY = "مرحبا، هذا ملخص تجريبي للمكالمة.\n\nInvented booking block.";
const M1 = "00000000-0000-4000-8000-0000000000m1".replace("m1", "a1");
const T1 = "00000000-0000-4000-8000-0000000000t1".replace("t1", "b1");
const SHEET = [
  ["Client", "", "", "", "ClickUp ID", "WA Group ID"],
  ["Acme Interiors", "", "", "", A, G1],
];
const OFF: OldSenders = {
  at: "2026-10-29T10:00:00Z",
  typeform: "off",
  scenarios: { "9209179": "off", "9523861": "off" },
  held: false,
  sentence: null,
};
const APPLY: Switches = {
  apply: true,
  kinds: ["recap_checkin"],
  onlyCards: [],
  from: "/home/hermes/.client-messages/switches.env",
  error: null,
};
const DRY: Switches = { ...APPLY, apply: false };
const approvedRow = {
  id: M1,
  taskId: A,
  clientName: "Acme Interiors",
  kind: "recap_checkin",
  approvedAt: "2026-10-29T09:50:00Z",
  expiresAt: "2026-10-30T09:50:00Z",
};
const claimRow = {
  id: M1,
  claimToken: T1,
  taskId: A,
  clientName: "Acme Interiors",
  kind: "recap_checkin",
  body: BODY,
  bodySha256: sha256(BODY),
  approvedAt: "2026-10-29T09:50:00Z",
  claimedAt: "2026-10-29T10:00:00Z",
};

type World = {
  work?: { unknowns: any[]; unread: any[]; approved: any[] };
  claim?: { busy: boolean; rows: any[] };
  intent?: { ok: boolean; reason?: string; refused?: boolean } | "crash";
  sheet?: unknown[][] | "fail";
  card?: string | null | "fail";
  /** What ClickUp's read throws, a card's own answer or a passing one. */
  cardError?: unknown;
  /** ClickUp's raw 200 answer, instead of a card with its fields. */
  taskAnswer?: unknown;
  send?: SendOutcome | "crash";
  messages?: WaMessage[];
  old?: OldSenders;
  /** The run's clock at the start, in ms; every wait and card read moves it on. */
  elapsed?: number;
  /** How long a card read takes (ClickUp's own tries), in ms. */
  taskMs?: number;
  /** How far past its time a wait ends (a paused host), in ms. */
  sleepOverrunMs?: number;
  /** How long the intent, the POST and the result each take, in ms. */
  intentMs?: number;
  sendMs?: number;
  resultMs?: number;
  random?: number;
  now?: Date;
  cardCache?: CardCache;
  switches?: Switches;
  /** The switches read again after the wait; the run's own unless given. */
  reread?: () => Switches;
  /** What happens during a wait, a person editing a file for one. */
  onSleep?: () => void;
  /** The send's response receipt is lost after the POST left, as the real ledger counts it. */
  loseSendReceipt?: boolean;
};

function world(w: World = {}) {
  const rpcs: { name: string; args: Record<string, unknown> }[] = [];
  const healths: Health[] = [];
  const sleeps: number[] = [];
  const keys: string[] = [];
  const sends: { group: string; body: string }[] = [];
  let clock = w.elapsed ?? 5_000;
  const at: Record<string, number> = {};
  const ledger = { failures: 0 };
  const db: Db = {
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      rpcs.push({ name, args });
      at[name.replace("cockpit_client_message_", "")] = clock;
      if (name === "cockpit_client_message_sweep")
        return { unknown: 0, released: 0, expired: 0 };
      if (name === "cockpit_client_message_work")
        return w.work ?? { unknowns: [], unread: [], approved: [approvedRow] };
      if (name === "cockpit_client_message_claim")
        return w.claim ?? { busy: false, rows: [claimRow] };
      if (name === "cockpit_client_message_intent") {
        clock += w.intentMs ?? 0;
        if (w.intent === "crash")
          throw new Error("The database did not answer");
        return w.intent ?? { ok: true };
      }
      if (name === "cockpit_client_message_result") {
        clock += w.resultMs ?? 0;
        // The send's own result; the read-back's later write decides nothing about the send.
        at.resultEnd ??= clock;
        return { id: args.p_id, state: args.p_outcome };
      }
      throw new Error(`No fake for ${name}`);
    },
    receipt: async () => {},
    health: async h => void healths.push(h),
  } as Db;
  const providers: Providers = runKey => ({
    sheet: async () => {
      keys.push(`${runKey} sheet`);
      if (w.sheet === "fail") throw new Error("Client Data is unavailable");
      return w.sheet ?? SHEET;
    },
    task: async (id: string) => {
      keys.push(`${runKey} task ${id}`);
      clock += w.taskMs ?? 0;
      if (w.card === "fail") throw new Error("ClickUp request failed (500).");
      if (w.cardError !== undefined) throw w.cardError;
      if ("taskAnswer" in w) return w.taskAnswer as any;
      return {
        id,
        custom_fields: [
          { id: CARD_GROUP_FIELD, value: w.card === undefined ? G1 : w.card },
        ],
      } as any;
    },
    sendText: async (group: string, body: string) => {
      keys.push(`${runKey} send`);
      at.send = clock;
      clock += w.sendMs ?? 0;
      sends.push({ group, body });
      if (w.send === "crash") throw new Error("The process stopped here.");
      if (w.loseSendReceipt) ledger.failures += 1;
      return (
        w.send ?? { state: "sent", providerId: "wamid-test-1", status: 200 }
      );
    },
    listMessages: async () => {
      keys.push(`${runKey} list`);
      return (
        w.messages ?? [
          {
            id: "wamid-test-1",
            fromMe: true,
            from: null,
            body: BODY,
            at: null,
          },
        ]
      );
    },
  });
  const deps: RunDeps = {
    db,
    providers,
    oldSenders: async () => w.old ?? OFF,
    switches: w.switches ?? APPLY,
    rereadSwitches: w.reread ?? (() => w.switches ?? APPLY),
    envFrom: {
      SUPABASE_URL: "/home/hermes/.cockpit-native-state/runtime-x.json",
    },
    now: () => w.now ?? new Date("2026-10-29T10:01:00Z"),
    sleep: async ms => {
      sleeps.push(ms);
      clock += ms + (w.sleepOverrunMs ?? 0);
      w.onSleep?.();
    },
    elapsedMs: () => clock,
    random: () => w.random ?? 0.5,
    cardCache: w.cardCache,
    ledger,
  };
  return {
    deps,
    rpcs,
    healths,
    sleeps,
    keys,
    sends,
    at,
    names: () => rpcs.map(r => r.name.replace("cockpit_client_message_", "")),
  };
}

/** An in-memory stand-in for dry mode's card cache. */
function memoryCache(): CardCache & { map: Map<string, Verdict> } {
  const map = new Map<string, Verdict>();
  return {
    map,
    get: k => map.get(k) ?? null,
    put: (k, v) => void map.set(k, v),
  };
}

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "client-messages-worker-"));
});
afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("a run in apply mode", () => {
  test("the order: sweep, read, claim one, check the group twice, wait, intent, one POST, the result, a read-back, the health row", async () => {
    const w = world();
    const r = await runOnce(w.deps);
    expect(w.names()).toEqual([
      "sweep",
      "work",
      "claim",
      "intent",
      "result",
      "result",
    ]);
    expect(w.rpcs.find(c => c.name.endsWith("_claim"))?.args).toEqual({
      p_kinds: ["recap_checkin"],
      p_only_cards: null,
      p_limit: 1,
    });
    expect(
      w.rpcs.filter(c => c.name.endsWith("_result")).map(c => c.args),
    ).toEqual([
      {
        p_id: M1,
        p_claim: T1,
        p_outcome: "sent",
        p_provider_id: "wamid-test-1",
        p_reason: null,
        p_read_back: null,
      },
      {
        p_id: M1,
        p_claim: T1,
        p_outcome: "read_back",
        p_provider_id: null,
        p_reason: null,
        p_read_back: { by: "message_id", providerId: "wamid-test-1" },
      },
    ]);
    expect(w.sends).toEqual([{ group: G1, body: BODY }]);
    expect(w.sleeps).toEqual([75_000, 10_000]);
    expect(w.keys).toEqual([
      "client-messages:run sheet",
      `client-messages:${M1} task ${A}`,
      `client-messages:${M1} send`,
      `client-messages:${M1} list`,
    ]);
    expect(r.ok).toBe(true);
    expect(w.healths).toHaveLength(1);
    expect(w.healths[0]).toMatchObject({
      key: "client-messages",
      ok: true,
      note: "Sent one recap to the client's group (WhatsApp group ending 0001).",
    });
    expect(Object.keys(w.healths[0].detail).sort()).toEqual([
      "approved",
      "envFrom",
      "failed",
      "held",
      "kinds",
      "mode",
      "onlyCards",
      "receiptsMissing",
      "refused",
      "sent",
      "unknown",
      "unread",
    ]);
    expect(w.healths[0].detail).toMatchObject({
      mode: "apply",
      approved: 1,
      sent: 1,
      refused: 0,
      failed: 0,
      unknown: 0,
      unread: 0,
      held: null,
      receiptsMissing: 0,
    });
    expect(JSON.stringify(w.healths)).not.toContain(G1);
  });

  test("a crash after intent leaves the row sending: no result is written, nothing is posted again, and the health row says the run stopped", async () => {
    const w = world({ send: "crash" });
    const r = await runOnce(w.deps);
    expect(w.names()).toEqual(["sweep", "work", "claim", "intent"]);
    expect(w.sends).toHaveLength(1);
    expect(r).toMatchObject({
      ok: false,
      note: STOPPED("The process stopped here."),
    });
    expect(w.healths).toHaveLength(1);
    expect(w.healths[0]).toMatchObject({
      key: "client-messages",
      ok: false,
      note: STOPPED("The process stopped here."),
    });
    expect(w.healths[0].detail).toMatchObject({
      mode: "apply",
      approved: 1,
      sent: 0,
      held: null,
    });
  });

  test("every run writes its health row: a database call that throws after the claim still refreshes it", async () => {
    const w = world({ intent: "crash" });
    const r = await runOnce(w.deps);
    expect(w.sends).toEqual([]);
    expect(w.names()).toEqual(["sweep", "work", "claim", "intent"]);
    expect(r.ok).toBe(false);
    expect(r.note).toBe(STOPPED("The database did not answer."));
    expect(r.note).toEndWith("none is sent twice.");
    expect(w.healths).toHaveLength(1);
    expect(w.healths[0]).toMatchObject({ key: "client-messages", ok: false });
    expect(Array.isArray(w.healths[0].detail.onlyCards)).toBe(true);
    expect(Number.isInteger(w.healths[0].detail.approved)).toBe(true);
    expect(w.healths[0].detail.held).toBeNull();
  });

  test("a receipt lost after the POST left is counted in the health row and said in its note; nothing is sent again", async () => {
    const w = world({ loseSendReceipt: true });
    const r = await runOnce(w.deps);
    expect(w.sends).toHaveLength(1);
    const note = `Sent one recap to the client's group (WhatsApp group ending 0001). ${RECEIPTS_LOST(1)}`;
    expect(r).toMatchObject({ ok: true, note });
    expect(w.healths).toHaveLength(1);
    expect(w.healths[0]).toMatchObject({ ok: true, note });
    expect(w.healths[0].detail.receiptsMissing).toBe(1);
    expect(RECEIPTS_LOST(1)).toBe(
      "The health ledger is missing the answer to 1 provider call that had already left. Check that the database takes provider receipts (RUNBOOK, Client messages).",
    );
    expect(RECEIPTS_LOST(3)).toContain("3 provider calls that had");
  });

  test("a ClickUp read that fails releases the claim; nothing is sent unchecked", async () => {
    const w = world({ card: "fail" });
    const r = await runOnce(w.deps);
    expect(w.names()).toEqual(["sweep", "work", "claim", "result"]);
    expect(w.rpcs.at(-1)?.args).toMatchObject({ p_outcome: "release" });
    expect(w.sends).toEqual([]);
    expect(r).toMatchObject({ ok: false, note: CLICKUP_UNREAD });
  });

  test("a card ClickUp will not serve is refused, so the next approval goes on the next run", async () => {
    // Two approved recaps and the claim's own rule: the oldest approval still approved, one a run.
    const B = "86abc0002";
    const M2 = "00000000-0000-4000-8000-0000000000a2";
    const queue = [
      { ...claimRow, state: "approved" },
      {
        ...claimRow,
        id: M2,
        taskId: B,
        approvedAt: "2026-10-29T09:55:00Z",
        state: "approved",
      },
    ];
    const sheet = [...SHEET, ["Beta Build", "", "", "", B, G2]];
    // ClickUp itself, through the real Transport: a 404 for the deleted card, a card for the healthy one.
    const clickup = new Transport({ CLICKUP_API_TOKEN: "invented" }, (async (
      input: RequestInfo | URL,
    ) =>
      String(input).endsWith(`/${A}`)
        ? new Response("{}", { status: 404 })
        : Response.json({
            custom_fields: [{ id: CARD_GROUP_FIELD, value: G2 }],
          })) as typeof fetch);
    const run = async () => {
      const w = world({ sheet });
      const rpc = w.deps.db.rpc;
      w.deps.db.rpc = (async (name: string, args: any = {}) => {
        if (name === "cockpit_client_message_claim") {
          const next = queue.find(q => q.state === "approved");
          if (next) next.state = "claimed";
          await rpc(name, args);
          return { busy: false, rows: next ? [next] : [] };
        }
        if (name === "cockpit_client_message_result") {
          const held = queue.find(q => q.id === args.p_id);
          if (held && args.p_outcome === "refused") held.state = "refused";
          if (held && args.p_outcome === "release") held.state = "approved";
          if (held && args.p_outcome === "sent") held.state = "sent";
        }
        return rpc(name, args);
      }) as Db["rpc"];
      const providers = w.deps.providers;
      w.deps.providers = key => ({
        ...providers(key),
        task: (id: string) => clickup.task(id),
      });
      return { w, r: await runOnce(w.deps) };
    };

    const first = await run();
    const reason = CARD_NOT_SERVED(A, 404);
    expect(first.r).toMatchObject({ ok: true, note: reason });
    expect(first.r.detail.refused).toBe(1);
    expect(first.w.rpcs.at(-1)?.args).toMatchObject({
      p_id: M1,
      p_outcome: "refused",
      p_reason: reason,
    });
    expect(reason.length).toBeLessThanOrEqual(240);
    expect(first.w.sends).toEqual([]);
    expect(queue.map(q => q.state)).toEqual(["refused", "approved"]);

    const second = await run();
    expect(second.w.sends).toEqual([{ group: G2, body: BODY }]);
    expect(queue.map(q => q.state)).toEqual(["refused", "sent"]);
  });

  test("a card's own 4xx is refused; 401, 408, 429, 5xx and a timeout keep the release and post nothing", async () => {
    for (const status of [400, 403, 404, 410]) {
      const w = world({ cardError: new ProviderError("ClickUp", status) });
      const r = await runOnce(w.deps);
      expect(r).toMatchObject({ ok: true, note: CARD_NOT_SERVED(A, status) });
      expect(r.detail.refused).toBe(1);
      expect(w.rpcs.at(-1)?.args).toMatchObject({
        p_outcome: "refused",
        p_reason: CARD_NOT_SERVED(A, status),
      });
      expect(w.sends).toEqual([]);
    }
    for (const status of [401, 408, 429, 500, 503, 0]) {
      const w = world({
        cardError: new ProviderError("ClickUp", status, status !== 401),
      });
      const r = await runOnce(w.deps);
      expect(r).toMatchObject({ ok: false, note: CLICKUP_UNREAD });
      expect(r.detail.refused).toBe(0);
      expect(w.rpcs.at(-1)?.args).toMatchObject({ p_outcome: "release" });
      expect(w.sends).toEqual([]);
    }
  });

  test("the real Transport's answers: an id it rejects is the card's fault, a missing key is not", async () => {
    const net = (async () => new Response("{}")) as unknown as typeof fetch;
    const reject = await new Transport({ CLICKUP_API_TOKEN: "invented" }, net)
      .task("not a card")
      .catch(e => e);
    expect(cardRefusal("not a card", reject)).toBe(CARD_BAD_ID("not a card"));
    const noKey = await new Transport({}, net).task(A).catch(e => e);
    expect(noKey).toBeInstanceOf(Error);
    expect(cardRefusal(A, noKey)).toBeNull();

    const w = world({ cardError: reject });
    const r = await runOnce(w.deps);
    expect(r.detail.refused).toBe(1);
    expect(w.rpcs.at(-1)?.args).toMatchObject({
      p_outcome: "refused",
      p_reason: CARD_BAD_ID(A),
    });
  });

  test("refusals: no group on Client Data, two rows, a bad id, or a card that differs; none is sent", async () => {
    for (const [sheet, card, reason] of [
      [[SHEET[0]], G1, NO_GROUP],
      [
        [...SHEET, ["Again", "", "", "", A, G2]],
        G1,
        "Client Data has more than one row for this card. Keep one row with its WhatsApp group, then try again.",
      ],
      [
        [SHEET[0], ["Acme", "", "", "", A, "96550001111@s.whatsapp.net"]],
        G1,
        BAD_GROUP,
      ],
      [SHEET, G2, GROUP_DIFFERS],
    ] as const) {
      const w = world({ sheet: sheet as unknown[][], card });
      const r = await runOnce(w.deps);
      expect(w.rpcs.at(-1)?.args).toMatchObject({
        p_outcome: "refused",
        p_reason: reason,
      });
      expect(w.names()).not.toContain("intent");
      expect(w.sends).toEqual([]);
      expect(r.detail.refused).toBe(1);
    }
    // An empty card field passes.
    const empty = world({ card: null });
    await runOnce(empty.deps);
    expect(empty.sends).toHaveLength(1);
  });

  test("ClickUp's 200 that does not list the card's fields is refused with a sentence and posts nothing: only a person can fix it", async () => {
    for (const taskAnswer of [
      {},
      { err: "Team not authorized" },
      { id: "abc", custom_fields: "x" },
      {
        id: "abc",
        custom_fields: [{ id: CARD_GROUP_FIELD, value: { not: "text" } }],
      },
    ]) {
      const w = world({ taskAnswer });
      const r = await runOnce(w.deps);
      expect(r).toMatchObject({ ok: true, note: CARD_NO_GROUP_FIELD(A) });
      expect(r.detail.refused).toBe(1);
      expect(w.rpcs.at(-1)?.args).toMatchObject({
        p_outcome: "refused",
        p_reason: CARD_NO_GROUP_FIELD(A),
      });
      expect(w.names()).toEqual(["sweep", "work", "claim", "result"]);
      expect(w.sends).toEqual([]);
      expect(w.sleeps).toEqual([]);
    }
    // A card that lists its fields, without this one, is still empty, and goes.
    const empty = world({ taskAnswer: { custom_fields: [] } });
    await runOnce(empty.deps);
    expect(empty.sends).toHaveLength(1);
  });

  test("the kill switch holds during the wait: edited to false in the file, the recap goes back and nothing is posted", async () => {
    const path = join(dir, "switches-during-wait.env");
    const on = "CLIENT_MESSAGES_APPLY=true\n";
    for (const [edit, ok, note] of [
      ["CLIENT_MESSAGES_APPLY=false\n", true, SWITCHED_OFF],
      // The line deleted: a file with no switch reads off.
      ["", true, SWITCHED_OFF],
      // The canary narrowed so this card is no longer on it.
      [`${on}CLIENT_MESSAGES_ONLY_CARDS=86other\n`, true, SWITCHED_OFF],
      // A line appended under the old true: not trusted, so the run stops.
      [
        `${on}CLIENT_MESSAGES_APPLY=false\n`,
        false,
        SWITCH_TWICE(["CLIENT_MESSAGES_APPLY"]),
      ],
      [`${on}CLIENT_MESSAGES_ONLY_CARDS=a;b\n`, false, NOT_A_CARD],
    ] as const) {
      writeFileSync(path, on);
      const w = world({
        switches: readSwitches(path),
        reread: () => readSwitches(path),
        onSleep: () => writeFileSync(path, edit),
      });
      const r = await runOnce(w.deps);
      expect([edit, r.ok, r.note]).toEqual([edit, ok, note]);
      expect(w.names()).toEqual(["sweep", "work", "claim", "result"]);
      expect(w.rpcs.at(-1)?.args).toMatchObject({
        p_id: M1,
        p_claim: T1,
        p_outcome: "release",
      });
      expect(w.sends).toEqual([]);
      expect(w.sleeps).toHaveLength(1);
      expect(w.healths[0]).toMatchObject({ ok, note });
    }
    // The file gone during the wait reads off too.
    writeFileSync(path, on);
    const gone = world({
      switches: readSwitches(path),
      reread: () => readSwitches(path),
      onSleep: () => rmSync(path, { force: true }),
    });
    expect((await runOnce(gone.deps)).note).toBe(SWITCHED_OFF);
    expect(gone.sends).toEqual([]);
    // Unchanged, or edited in a way that still allows the card, it goes once.
    for (const edit of [on, `${on}CLIENT_MESSAGES_ONLY_CARDS=${A}\n`]) {
      writeFileSync(path, on);
      const w = world({
        switches: readSwitches(path),
        reread: () => readSwitches(path),
        onSleep: () => writeFileSync(path, edit),
      });
      await runOnce(w.deps);
      expect(w.sends).toHaveLength(1);
      expect(w.names()).toContain("intent");
    }
  });

  test("the switches are read again after the wait, not before it", async () => {
    const order: string[] = [];
    const w = world({
      reread: () => {
        order.push("reread");
        return APPLY;
      },
      onSleep: () => void order.push("wait"),
    });
    await runOnce(w.deps);
    // The second wait is the read-back's, after the send.
    expect(order).toEqual(["wait", "reread", "wait"]);
  });

  test("an unknown that Whapi returns as link_preview, the shape of every real recap, is reconciled by its fingerprint", async () => {
    const unknown = {
      id: "u1",
      claimToken: "tok-u1",
      taskId: A,
      kind: "recap_checkin",
      body: BODY,
      bodySha256: sha256(BODY),
      claimedAt: "2026-10-29T09:00:00Z",
    };
    const w = world({
      work: { unknowns: [unknown], unread: [], approved: [] },
      messages: [
        readMessage({
          id: "wamid-lp",
          from: "96550000099",
          from_me: true,
          source: "api",
          type: "link_preview",
          timestamp: 1_790_000_000,
          link_preview: { body: BODY, url: "https://example.test/booking" },
        }) as WaMessage,
      ],
    });
    const r = await runOnce(w.deps);
    expect(w.rpcs.at(-1)?.args).toMatchObject({
      p_id: "u1",
      p_outcome: "reconciled",
      p_provider_id: "wamid-lp",
      p_read_back: { by: "body_sha256" },
    });
    expect(r.reconciled).toBe(1);
    expect(w.sends).toEqual([]);
  });

  test("an unknown is never sent again: found in the group by its fingerprint it is reconciled, else it stays", async () => {
    const unknown = {
      id: "u1",
      claimToken: "tok-u1",
      taskId: A,
      kind: "recap_checkin",
      body: BODY,
      bodySha256: sha256(BODY),
      claimedAt: "2026-10-29T09:00:00Z",
    };
    const missing = world({
      work: { unknowns: [unknown], unread: [], approved: [] },
      messages: [{ id: "x", fromMe: false, from: null, body: BODY, at: null }],
    });
    expect((await runOnce(missing.deps)).note).toBe(NOTHING);
    expect(missing.names()).toEqual(["sweep", "work"]);
    expect(missing.sends).toEqual([]);
    expect(missing.healths[0].detail.unknown).toBe(1);
    const found = world({
      work: { unknowns: [unknown], unread: [], approved: [] },
      messages: [
        {
          id: "wamid-9",
          fromMe: true,
          from: null,
          body: `${BODY}  \r\n`,
          at: null,
        },
      ],
    });
    const r = await runOnce(found.deps);
    expect(found.rpcs.at(-1)?.args).toEqual({
      p_id: "u1",
      p_claim: "tok-u1",
      p_outcome: "reconciled",
      p_provider_id: "wamid-9",
      p_reason: null,
      p_read_back: { by: "body_sha256" },
    });
    expect(found.sends).toEqual([]);
    expect(r.reconciled).toBe(1);
    expect(found.healths[0].detail.unknown).toBe(0);
  });

  test("a sent message with no read-back is read back by its id, else by its fingerprint", async () => {
    const sent = {
      id: "s1",
      claimToken: "tok-s1",
      taskId: A,
      kind: "recap_checkin",
      body: BODY,
      bodySha256: sha256(BODY),
      providerId: "wamid-s1",
      sentAt: "2026-10-29T09:30:00Z",
    };
    const byHash = world({
      work: { unknowns: [], unread: [sent], approved: [] },
      messages: [
        { id: "wamid-other", fromMe: true, from: null, body: BODY, at: null },
      ],
    });
    await runOnce(byHash.deps);
    expect(byHash.rpcs.at(-1)?.args).toMatchObject({
      p_outcome: "read_back",
      p_read_back: { by: "body_sha256", providerId: "wamid-other" },
    });
    const none = world({
      work: { unknowns: [], unread: [sent], approved: [] },
      messages: [],
    });
    await runOnce(none.deps);
    expect(none.healths[0].detail.unread).toBe(1);
  });

  test("WhatsApp's unknown or failed answer is recorded once and never retried", async () => {
    for (const send of [
      {
        state: "unknown",
        reason:
          "WhatsApp did not confirm the send. Look in the group before anything else; it is never sent again.",
        status: 502,
      },
      {
        state: "failed",
        reason: "WhatsApp refused the recap (400). Nothing was sent.",
        status: 400,
      },
    ] as SendOutcome[]) {
      const w = world({ send });
      const r = await runOnce(w.deps);
      expect(w.sends).toHaveLength(1);
      expect(w.rpcs.at(-1)?.args).toMatchObject({
        p_outcome: send.state,
        p_reason: (send as { reason: string }).reason,
      });
      expect(r.ok).toBe(false);
      expect(w.sleeps).toEqual([75_000]);
    }
  });

  test("an intent answering ok false posts nothing and says why", async () => {
    const w = world({ intent: { ok: false, reason: "Make owns this again." } });
    const r = await runOnce(w.deps);
    expect(w.sends).toEqual([]);
    expect(w.names()).toEqual(["sweep", "work", "claim", "intent"]);
    expect(r.note).toBe("Make owns this again.");
    // The gate only released it: nothing was refused.
    expect(r.detail.refused).toBe(0);
  });

  test("a fourth try the intent refuses is counted as refused, and nothing is posted", async () => {
    const reason =
      "This recap was tried three times and did not go. Send it by hand in the group if it is still needed, then skip it here.";
    const w = world({ intent: { ok: false, reason, refused: true } });
    const r = await runOnce(w.deps);
    expect(w.sends).toEqual([]);
    expect(r).toMatchObject({ ok: true, note: reason });
    expect(r.detail.refused).toBe(1);
    expect(w.healths[0].detail.refused).toBe(1);
  });

  test("no claim with under 200 seconds of the run left", async () => {
    const w = world({ elapsed: CLAIM_BY_MS + 1 });
    const r = await runOnce(w.deps);
    expect(w.names()).toEqual(["sweep", "work"]);
    expect(r.note).toBe(TOO_LATE);
    expect(w.sends).toEqual([]);
  });

  test("the margin names every limit between the intent and the stored answer", () => {
    // The intent, the POST, the response receipt the ledger awaits after it, the result.
    expect(SEND_MARGIN_MS).toBe(30_000 + 20_000 + 30_000 + 30_000);
    expect(SEND_BY_MS).toBe(190_000);
  });

  test("the wait is cut so the intent and the POST still start before the send limit", async () => {
    // Claimed at 99 s, a slow card read of 20 s, the longest wait drawn.
    const w = world({ elapsed: 99_000, taskMs: 20_000, random: 0.999999 });
    const r = await runOnce(w.deps);
    const waitUpTo = SEND_BY_MS - WAIT_SLACK_MS - 119_000;
    expect(w.sleeps[0]).toBe(waitUpTo);
    expect(w.sleeps[0]).toBeGreaterThanOrEqual(30_000);
    expect(w.at.intent).toBeLessThanOrEqual(SEND_BY_MS);
    expect(w.at.send).toBeLessThanOrEqual(RUN_SECONDS * 1000 - SEND_MARGIN_MS);
    expect(w.sends).toHaveLength(1);
    expect(r.ok).toBe(true);
    // A normal run keeps its drawn wait.
    const usual = world({ random: 0.999999 });
    await runOnce(usual.deps);
    expect(usual.sleeps[0]).toBe(120_000);
  });

  test("the slowest intent, POST, response receipt and result of a run at the send limit still end before the cron's kill", async () => {
    // Each at its own limit: db.ts aborts at 30 s, the POST at 20 s, and the ledger
    // awaits the response receipt (db.ts again, 30 s) before the POST returns.
    const w = world({
      elapsed: 99_000,
      taskMs: 20_000,
      random: 0.999999,
      intentMs: 30_000,
      sendMs: 20_000 + 30_000,
      resultMs: 30_000,
    });
    const r = await runOnce(w.deps);
    expect(w.sends).toHaveLength(1);
    expect(r.detail.sent).toBe(1);
    expect(w.at.resultEnd).toBeLessThanOrEqual(RUN_SECONDS * 1000);
  });

  test("too little left for even a 30 s wait: the claim is released at once and nothing is posted", async () => {
    // A card read of 63 s (three 20 s tries and their pauses) after a claim at 99 s leaves 26 s.
    const w = world({ elapsed: 99_000, taskMs: 63_000 });
    const r = await runOnce(w.deps);
    expect(w.names()).toEqual(["sweep", "work", "claim", "result"]);
    expect(w.rpcs.at(-1)?.args).toMatchObject({ p_outcome: "release" });
    expect(w.sleeps).toEqual([]);
    expect(w.sends).toEqual([]);
    expect(r).toMatchObject({ ok: true, note: TOO_LATE });
    expect(w.healths[0]).toMatchObject({ ok: true, note: TOO_LATE });
  });

  test("a run past the send limit after its wait releases the claim and posts nothing", async () => {
    // The wait itself ran 60 s late (a paused host): the intent would start past 190 s.
    const w = world({
      elapsed: 99_000,
      taskMs: 20_000,
      sleepOverrunMs: 60_000,
    });
    const r = await runOnce(w.deps);
    expect(w.sleeps).toHaveLength(1);
    expect(w.names()).toEqual(["sweep", "work", "claim", "result"]);
    expect(w.names()).not.toContain("intent");
    expect(w.rpcs.at(-1)?.args).toMatchObject({ p_outcome: "release" });
    expect(w.sends).toEqual([]);
    expect(r).toMatchObject({ ok: true, note: TOO_LATE });
  });

  test("one message a run: the claim asks for one, and only the first row is ever sent", async () => {
    const w = world({
      claim: { busy: false, rows: [claimRow, { ...claimRow, id: "second" }] },
    });
    await runOnce(w.deps);
    expect(w.sends).toHaveLength(1);
    expect(w.rpcs.find(c => c.name.endsWith("_claim"))?.args.p_limit).toBe(1);
  });

  test("the old senders on or unread hold every recap; a moved column holds too", async () => {
    const held = world({
      old: {
        ...OFF,
        scenarios: { "9209179": "off", "9523861": "on" },
        held: true,
        sentence:
          "Make's recap sender is still on (scenario 9523861). The cockpit sends 1-1 recaps only after the switch-over.",
      },
    });
    const r = await runOnce(held.deps);
    expect(held.names()).toEqual(["sweep", "work"]);
    expect(r).toMatchObject({
      ok: false,
      note: "Make's recap sender is still on (scenario 9523861). The cockpit sends 1-1 recaps only after the switch-over.",
    });
    expect(held.healths[0].detail.held).toBe(r.note);
    const moved = world({
      sheet: [
        ["Client", "ClickUp ID", "WA Group ID"],
        ["Acme", A, G1],
      ],
    });
    expect((await runOnce(moved.deps)).note).toBe(COLUMN_MOVED);
    expect(moved.names()).toEqual(["sweep", "work"]);
  });

  test("a claimed text that does not match its fingerprint is released, never sent", async () => {
    const w = world({
      claim: {
        busy: false,
        rows: [{ ...claimRow, bodySha256: sha256("another text") }],
      },
    });
    await runOnce(w.deps);
    expect(w.rpcs.at(-1)?.args).toMatchObject({ p_outcome: "release" });
    expect(w.sends).toEqual([]);
  });
});

describe("dry mode, the keys and the switches", () => {
  test("dry mode runs the sweep and posts nothing; its health row says sending is off", async () => {
    const none = world({
      switches: DRY,
      work: { unknowns: [], unread: [], approved: [] },
    });
    expect((await runOnce(none.deps)).note).toBe(DRY_NOTHING);
    expect(none.names()).toEqual(["sweep", "work"]);
    expect(none.healths[0]).toMatchObject({
      ok: true,
      note: "Nothing approved to send. Sending is off until the switch-over.",
      detail: { mode: "dry" },
    });
    const one = world({ switches: DRY });
    const r = await runOnce(one.deps);
    expect(one.names()).toEqual(["sweep", "work"]);
    expect(one.sends).toEqual([]);
    expect(r.note).toBe(
      "1 approved to send. Sending is off until the switch-over.",
    );
    expect(r.plan).toEqual([
      {
        id: M1,
        taskId: A,
        group: "present, 0001",
        card: "same",
        oldSenders: "off",
        wouldSend: true,
        why: "Would send once sending is on.",
      },
    ]);
  });

  test("dry mode's plan holds when Client Data's column moved, as apply mode does, and the guardian reads the hold", async () => {
    const sheet = [
      ["Client", "", "", "", "ClickUp ID", "Phone", "WA Group ID"],
      ["Acme Interiors", "", "", "", A, "", G1],
    ];
    const dry = world({ switches: DRY, sheet });
    const r = await runOnce(dry.deps);
    expect(r.plan).toEqual([
      {
        id: M1,
        taskId: A,
        group: "present, 0001",
        card: "same",
        oldSenders: "off",
        wouldSend: false,
        why: COLUMN_MOVED,
      },
    ]);
    expect(r).toMatchObject({ ok: false, note: COLUMN_MOVED });
    expect(r.detail.held).toBe(COLUMN_MOVED);
    expect(dry.healths[0]).toMatchObject({
      ok: false,
      note: COLUMN_MOVED,
      detail: { mode: "dry", held: COLUMN_MOVED },
    });
    expect(dry.names()).toEqual(["sweep", "work"]);
    expect(dry.sends).toEqual([]);

    // Apply mode says the same on the same sheet.
    const apply = await runOnce(world({ sheet }).deps);
    expect(apply.detail.held).toBe(COLUMN_MOVED);

    // Client Data unread is not a move: no hold, and no row would send.
    const unread = await runOnce(world({ switches: DRY, sheet: "fail" }).deps);
    expect(unread.detail.held).toBeNull();
    expect(unread.plan[0]).toMatchObject({ group: "unread", wouldSend: false });

    // The column where it belongs: no hold.
    const fine = await runOnce(world({ switches: DRY }).deps);
    expect(fine.detail.held).toBeNull();
    expect(fine.plan[0].wouldSend).toBe(true);
  });

  test("dry mode reads ClickUp's 200 without the card's fields as unread: it would not send, and the answer is not cached", async () => {
    const cache = memoryCache();
    const w = world({ switches: DRY, taskAnswer: {}, cardCache: cache });
    const r = await runOnce(w.deps);
    expect(r.plan).toEqual([
      {
        id: M1,
        taskId: A,
        group: "present, 0001",
        card: "unread",
        oldSenders: "off",
        wouldSend: false,
        why: "Client Data or the card could not be read.",
      },
    ]);
    expect(cache.map.size).toBe(0);
    expect(w.sends).toEqual([]);
  });

  test("dry mode reads at most one ClickUp card a run; the cache and the turn cover every row within five runs", async () => {
    const cards = [
      "86abc0001",
      "86abc0002",
      "86abc0003",
      "86abc0004",
      "86abc0005",
    ];
    const sheet = [
      SHEET[0],
      ...cards.map((c, i) => [
        `Client ${i + 1}`,
        "",
        "",
        "",
        c,
        `12036300000000000${i + 1}@g.us`,
      ]),
    ];
    const five = {
      unknowns: [],
      unread: [],
      approved: cards.map((c, i) => ({
        ...approvedRow,
        id: `m${i + 1}`,
        taskId: c,
      })),
    };
    const cache = memoryCache();
    const minute = (n: number) =>
      new Date(Date.parse("2026-10-29T10:01:00Z") + n * 60_000);
    const read: string[] = [];
    for (let n = 0; n < 5; n++) {
      const w = world({
        switches: DRY,
        work: five,
        sheet,
        cardCache: cache,
        now: minute(n),
      });
      const r = await runOnce(w.deps);
      const tasks = w.keys.filter(k => k.includes(" task "));
      expect(tasks).toHaveLength(1);
      read.push(tasks[0].split(" task ")[1]);
      expect(w.sends).toEqual([]);
      expect(r.plan).toHaveLength(5);
      expect(r.plan.filter(p => p.card === CARD_LATER)).toHaveLength(4 - n);
      for (const p of r.plan.filter(p => p.card === CARD_LATER))
        expect(p).toMatchObject({
          wouldSend: false,
          why: "Its card is read on a later run (one ClickUp read a run).",
        });
    }
    expect([...read].sort()).toEqual(cards);
    expect(cache.map.size).toBe(5);
    for (const key of cache.map.keys()) expect(key).not.toContain("@g.us");
    // Every verdict is cached now: the next run reads no card at all.
    const sixth = world({
      switches: DRY,
      work: five,
      sheet,
      cardCache: cache,
      now: minute(5),
    });
    const r6 = await runOnce(sixth.deps);
    expect(sixth.keys.filter(k => k.includes(" task "))).toEqual([]);
    expect(r6.plan.map(p => p.card)).toEqual([
      "same",
      "differs",
      "differs",
      "differs",
      "differs",
    ]);
    // Without a cache it still reads one card a run, a different one each minute.
    const turns = new Set<string>();
    for (let n = 0; n < 5; n++) {
      const w = world({ switches: DRY, work: five, sheet, now: minute(n) });
      await runOnce(w.deps);
      const tasks = w.keys.filter(k => k.includes(" task "));
      expect(tasks).toHaveLength(1);
      turns.add(tasks[0]);
    }
    expect(turns.size).toBe(5);
  });

  test("the card cache keeps a verdict 10 minutes in a private file, with no group id, and an unwritable file never stops a run", () => {
    const path = join(dir, "card-verdicts.json");
    let now = new Date("2026-10-29T10:00:00Z");
    const cache = fileCardCache(path, () => now);
    const key = cardKey(A, G1);
    expect(key).toBe(`${A}:${sha256(G1).slice(0, 16)}`);
    expect(cache.get(key)).toBeNull();
    cache.put(key, "same");
    expect(cache.get(key)).toBe("same");
    expect(cache.get(cardKey(A, G2))).toBeNull();
    const text = readFileSync(path, "utf8");
    expect(text).not.toContain("@g.us");
    expect(text).not.toContain("120363");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    now = new Date(now.getTime() + CARD_CACHE_MS - 1000);
    expect(cache.get(key)).toBe("same");
    now = new Date(now.getTime() + 2000);
    expect(cache.get(key)).toBeNull();
    const nowhere = fileCardCache(
      join(dir, "no-such-folder", "x.json"),
      () => now,
    );
    expect(() => nowhere.put(key, "empty")).not.toThrow();
    expect(nowhere.get(key)).toBeNull();
  });

  test("keys come by name, first file wins; a switch or AD_BILLING_APPLY in a shared file is never read", () => {
    const guard = join(dir, "runtime.json");
    const native = join(dir, "runtime-n4.json");
    const shared = join(dir, "api-keys.env");
    writeFileSync(
      guard,
      JSON.stringify({
        AD_BILLING_APPLY: "true",
        AD_BILLING_WHAPI_TOKEN: "w-guard",
        CLICKUP_API_TOKEN: "c-guard",
        GOOGLE_APPLICATION_CREDENTIALS: "/x/sa.json",
      }),
    );
    writeFileSync(
      native,
      JSON.stringify({
        SUPABASE_URL: "https://bldgtotkfmhoxmlzowdx.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "svc",
        TYPEFORM_TOKEN: "tf",
        CLICKUP_API_TOKEN: "c-native",
      }),
    );
    writeFileSync(
      shared,
      "SUPABASE_URL=https://rzokwiinvented.supabase.co\nMAKE_API_KEY=mk\nMAKE_ZONE=eu2\nCLIENT_MESSAGES_APPLY=true\nCLIENT_MESSAGES_ONLY_CARDS=86abc0001\nAD_BILLING_APPLY=true\n",
    );
    const read = readEnv([guard, native, shared, join(dir, "missing.env")]);
    expect(read.env).toEqual({
      AD_BILLING_WHAPI_TOKEN: "w-guard",
      CLICKUP_API_TOKEN: "c-guard",
      GOOGLE_APPLICATION_CREDENTIALS: "/x/sa.json",
      SUPABASE_URL: "https://bldgtotkfmhoxmlzowdx.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "svc",
      TYPEFORM_TOKEN: "tf",
      MAKE_API_KEY: "mk",
      MAKE_ZONE: "eu2",
    });
    expect(read.from).toMatchObject({
      AD_BILLING_WHAPI_TOKEN: guard,
      CLICKUP_API_TOKEN: guard,
      SUPABASE_URL: native,
      MAKE_API_KEY: shared,
    });
    // The switches come only from their own file: missing reads off.
    expect(readSwitches(join(dir, "no-switches.env"))).toEqual({
      apply: false,
      kinds: ["recap_checkin"],
      onlyCards: [],
      from: null,
      error: null,
    });
  });

  test("switches.env: exactly true turns sending on; another kind is refused at start", async () => {
    const path = join(dir, "switches.env");
    writeFileSync(
      path,
      "# The canary\nCLIENT_MESSAGES_APPLY=true\nCLIENT_MESSAGES_KINDS=recap_checkin\nCLIENT_MESSAGES_ONLY_CARDS=86eywg1cq, 86eywg1cr\n",
    );
    expect(readSwitches(path)).toEqual({
      apply: true,
      kinds: ["recap_checkin"],
      onlyCards: ["86eywg1cq", "86eywg1cr"],
      from: path,
      error: null,
    });
    writeFileSync(path, "CLIENT_MESSAGES_APPLY=TRUE\n");
    expect(readSwitches(path).apply).toBe(false);
    writeFileSync(
      path,
      "CLIENT_MESSAGES_APPLY=true\nCLIENT_MESSAGES_KINDS=recap_checkin,phase5\n",
    );
    const s = readSwitches(path);
    expect(s.error).toBe(
      "CLIENT_MESSAGES_KINDS names a kind 2b does not send (phase5). Set it to recap_checkin.",
    );
    expect(s.apply).toBe(false);
    const w = world({ switches: s });
    const r = await runOnce(w.deps);
    // It stops at start: only the database sweep runs (it sends nothing, Z67); nothing is read, claimed or posted.
    expect(w.names()).toEqual(["sweep"]);
    expect(w.keys).toEqual([]);
    expect(w.sends).toEqual([]);
    expect(r).toMatchObject({ ok: false, note: s.error });
    expect(w.healths[0]).toMatchObject({
      ok: false,
      note: s.error,
      detail: { mode: "dry" },
    });
  });

  test("a card list with anything but card ids stops the run, off; it never widens to every client", async () => {
    const path = join(dir, "switches.env");
    for (const cards of [
      "86eywg1cq # the test card",
      "86eywg1cq;86eywg1cr",
      "86eywg1cq, bad id!",
      // Nothing but separators: a value was written and no card came of it, so it never reads as every card.
      ",",
      " , , ",
    ]) {
      writeFileSync(
        path,
        `CLIENT_MESSAGES_APPLY=true\nCLIENT_MESSAGES_ONLY_CARDS=${cards}\n`,
      );
      const s = readSwitches(path);
      expect([cards, s.error, s.apply]).toEqual([cards, NOT_A_CARD, false]);
      const w = world({ switches: s });
      const r = await runOnce(w.deps);
      expect(w.names()).toEqual(["sweep"]);
      expect(w.sends).toEqual([]);
      expect(r).toMatchObject({ ok: false, note: NOT_A_CARD });
    }
    expect(NOT_A_CARD).toBe(
      "CLIENT_MESSAGES_ONLY_CARDS names something that is not a card id. Write card ids separated by commas, nothing else.",
    );
    // Empty is every card, by design; a trailing comma adds nothing.
    for (const empty of ["", '""', "   "]) {
      writeFileSync(
        path,
        `CLIENT_MESSAGES_APPLY=true\nCLIENT_MESSAGES_ONLY_CARDS=${empty}\n`,
      );
      expect(readSwitches(path)).toMatchObject({
        apply: true,
        onlyCards: [],
        error: null,
      });
    }
    writeFileSync(
      path,
      "CLIENT_MESSAGES_APPLY=true\nCLIENT_MESSAGES_ONLY_CARDS=86eywg1cq,\n",
    );
    expect(readSwitches(path)).toMatchObject({
      apply: true,
      onlyCards: ["86eywg1cq"],
      error: null,
    });
  });

  test("a stray quote never widens a card list or reads as true; only a matched pair of quotes is taken off", async () => {
    const path = join(dir, "switches.env");
    // A quoted space and every half-quoted list: a value was written and no card came of it.
    for (const cards of [
      '" "',
      "' '",
      '"',
      "'",
      "\"'",
      "'\"",
      '"86eywg1cq',
      '86eywg1cq"',
      "'86eywg1cq",
      "\"86eywg1cq'",
      '""86eywg1cq""',
      '"86eywg1cq", "86eywg1cr"',
    ]) {
      writeFileSync(
        path,
        `CLIENT_MESSAGES_APPLY=true\nCLIENT_MESSAGES_ONLY_CARDS=${cards}\n`,
      );
      const s = readSwitches(path);
      expect([cards, s.error, s.apply]).toEqual([cards, NOT_A_CARD, false]);
      const w = world({ switches: s });
      const r = await runOnce(w.deps);
      expect(w.names()).toEqual(["sweep"]);
      expect(w.sends).toEqual([]);
      expect(r).toMatchObject({ ok: false, note: NOT_A_CARD });
    }
    // A matched pair is still read, the empty pair as every card, by design.
    for (const [cards, onlyCards] of [
      ['"86eywg1cq"', ["86eywg1cq"]],
      ["'86eywg1cq, 86eywg1cr'", ["86eywg1cq", "86eywg1cr"]],
      ['""', []],
      ["''", []],
    ] as const) {
      writeFileSync(
        path,
        `CLIENT_MESSAGES_APPLY=true\nCLIENT_MESSAGES_ONLY_CARDS=${cards}\n`,
      );
      expect(readSwitches(path)).toMatchObject({
        apply: true,
        onlyCards,
        error: null,
      });
    }
    // Half-quoted, or quoted around more than the word: off.
    for (const apply of [
      '"true',
      'true"',
      "'true",
      "true'",
      "\"true'",
      "'true\"",
      '""true""',
      '" true "',
    ]) {
      writeFileSync(path, `CLIENT_MESSAGES_APPLY=${apply}\n`);
      const s = readSwitches(path);
      expect([apply, s.apply]).toEqual([apply, false]);
    }
    for (const apply of ['"true"', "'true'"]) {
      writeFileSync(path, `CLIENT_MESSAGES_APPLY=${apply}\n`);
      expect([apply, readSwitches(path).apply]).toEqual([apply, true]);
    }
    // A half-quoted kind is no kind 2b sends, so the run stops, off.
    for (const kinds of ['"recap_checkin', "recap_checkin'", '" "']) {
      writeFileSync(
        path,
        `CLIENT_MESSAGES_APPLY=true\nCLIENT_MESSAGES_KINDS=${kinds}\n`,
      );
      const s = readSwitches(path);
      expect([kinds, s.apply, s.error === null]).toEqual([kinds, false, false]);
    }
    writeFileSync(
      path,
      'CLIENT_MESSAGES_APPLY=true\nCLIENT_MESSAGES_KINDS="recap_checkin"\n',
    );
    expect(readSwitches(path)).toMatchObject({
      apply: true,
      kinds: ["recap_checkin"],
      error: null,
    });
  });

  test("a switch written twice stops the run, off: a kill switch appended below an old true never leaves sending on", async () => {
    const path = join(dir, "switches.env");
    writeFileSync(
      path,
      "CLIENT_MESSAGES_APPLY=true\nCLIENT_MESSAGES_ONLY_CARDS=86eywg1cq\nCLIENT_MESSAGES_APPLY=false\n",
    );
    const s = readSwitches(path);
    expect(s).toMatchObject({
      apply: false,
      error: SWITCH_TWICE(["CLIENT_MESSAGES_APPLY"]),
    });
    expect(s.error).toBe(
      "CLIENT_MESSAGES_APPLY is written more than once in switches.env, so nothing is sent. Keep one line for each switch and edit that line; never add another below it.",
    );
    const w = world({ switches: s });
    const r = await runOnce(w.deps);
    expect(w.names()).toEqual(["sweep"]);
    expect(w.sends).toEqual([]);
    expect(r).toMatchObject({ ok: false, note: s.error });
    // Two lines of the card list or the kinds are as unclear: off, never the first or the last line.
    writeFileSync(
      path,
      "CLIENT_MESSAGES_APPLY=true\nCLIENT_MESSAGES_ONLY_CARDS=86eywg1cq\nexport CLIENT_MESSAGES_ONLY_CARDS=\nCLIENT_MESSAGES_KINDS=recap_checkin\nCLIENT_MESSAGES_KINDS=recap_checkin\n",
    );
    expect(readSwitches(path)).toMatchObject({
      apply: false,
      error:
        "CLIENT_MESSAGES_KINDS and CLIENT_MESSAGES_ONLY_CARDS are written more than once in switches.env, so nothing is sent. Keep one line for each switch and edit that line; never add another below it.",
    });
    // A commented-out line is not a switch.
    writeFileSync(
      path,
      "CLIENT_MESSAGES_APPLY=false\n# CLIENT_MESSAGES_APPLY=true\n",
    );
    expect(readSwitches(path)).toMatchObject({ apply: false, error: null });
  });

  test("a line that is not one of the three switches stops the run, off: a misspelt canary never reads as every card", async () => {
    const path = join(dir, "switches.env");
    for (const line of [
      "CLIENT_MESSAGES_ONLY_CARD=86x",
      "CLIENT_MESSAGE_ONLY_CARDS=86x",
      "client_messages_only_cards=86x",
      "CLIENT_MESSAGES_ONLY-CARDS=86x",
      "CLIENT_MESSAGES_ONLY_CARDS 86x",
      "ONLY_CARDS=86x",
      "86x",
    ]) {
      writeFileSync(path, `CLIENT_MESSAGES_APPLY=true\n${line}\n`);
      const s = readSwitches(path);
      expect([line, s.error, s.apply]).toEqual([
        line,
        SWITCH_UNKNOWN([2]),
        false,
      ]);
      // It names the line, never what is on it: the file may hold a pasted value.
      expect(s.error).not.toContain("86x");
      const w = world({ switches: s });
      const r = await runOnce(w.deps);
      expect(w.names()).toEqual(["sweep"]);
      expect(w.keys).toEqual([]);
      expect(w.sends).toEqual([]);
      expect(r).toMatchObject({ ok: false, note: s.error });
    }
    expect(SWITCH_UNKNOWN([2])).toBe(
      "Line 2 of switches.env is not one of the three switches, so nothing is sent. Correct it or delete it: the file holds only CLIENT_MESSAGES_APPLY, CLIENT_MESSAGES_KINDS and CLIENT_MESSAGES_ONLY_CARDS.",
    );
    // A switch from elsewhere is not read as a switch here either.
    writeFileSync(
      path,
      "CLIENT_MESSAGES_APPLY=true\nAD_BILLING_APPLY=true\nCLIENT_MESSAGES_KINDS=recap_checkin\nSOME_TOKEN=abc123\n",
    );
    const two = readSwitches(path);
    expect(two).toMatchObject({ apply: false, error: SWITCH_UNKNOWN([2, 4]) });
    expect(two.error).toStartWith(
      "Lines 2 and 4 of switches.env are not among the three switches, so nothing is sent.",
    );
    expect(two.error).not.toContain("abc123");
    // Comments and blank lines are not switches and stop nothing.
    writeFileSync(
      path,
      "# The canary\n\n  # CLIENT_MESSAGES_ONLY_CARD=86x\nCLIENT_MESSAGES_APPLY=true\n   \n",
    );
    expect(readSwitches(path)).toMatchObject({ apply: true, error: null });
  });

  test("Windows line ends: a card list is read, never dropped to every card", () => {
    const path = join(dir, "switches.env");
    writeFileSync(
      path,
      "CLIENT_MESSAGES_ONLY_CARDS=86eywg1cq\r\nCLIENT_MESSAGES_APPLY=true",
    );
    expect(readSwitches(path)).toMatchObject({
      apply: true,
      onlyCards: ["86eywg1cq"],
      error: null,
    });
  });
});

describe("one ledger count a process", () => {
  test("wire() gives every ledger one count: response receipts lost under any run key, the old senders' included, reach the run's health row", async () => {
    const home = mkdtempSync(join(tmpdir(), "client-messages-wire-"));
    mkdirSync(join(home, ".client-messages"));
    const real = globalThis.fetch;
    const receipts: string[] = [];
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.host === "bldgtotkfmhoxmlzowdx.supabase.co") {
        const row = JSON.parse(String(init?.body ?? "{}"));
        receipts.push(`${row.provider} ${row.phase}`);
        // Every response receipt is refused after its call left: counted, and the call is never repeated.
        return row.phase === "response"
          ? Response.json({ message: "The ledger is full." }, { status: 503 })
          : new Response("", { status: 201 });
      }
      if (url.host === "gate.whapi.cloud")
        return Response.json({ messages: [] });
      if (url.host === "api.typeform.com") return Response.json({ items: [] });
      if (url.host === "eu2.make.com")
        return Response.json({ scenario: { isActive: false } });
      return new Response("", { status: 404 });
    }) as typeof fetch;
    try {
      const wired = wire(
        {
          env: {
            AD_BILLING_WHAPI_TOKEN: "w-invented",
            SUPABASE_URL: "https://bldgtotkfmhoxmlzowdx.supabase.co",
            SUPABASE_SERVICE_ROLE_KEY: "svc-invented",
            TYPEFORM_TOKEN: "tf-invented",
            MAKE_API_KEY: "mk-invented",
            MAKE_ZONE: "eu2",
          },
          from: {},
        },
        home,
      );
      expect(
        await wired.providers("client-messages:run").listMessages(G1, 0),
      ).toEqual([]);
      expect(
        await wired.providers(`client-messages:${M1}`).listMessages(G1, 0),
      ).toEqual([]);
      const old = await wired.senders("client-messages:run", true);
      expect(old.held).toBe(false);
      // Two WhatsApp reads, the Typeform webhooks and two Make scenarios: five calls, five lost answers, one count.
      expect(receipts.filter(r => r.endsWith(" intent"))).toEqual([
        "whapi intent",
        "whapi intent",
        "typeform intent",
        "make intent",
        "make intent",
      ]);
      expect(wired.ledger.failures).toBe(5);
      const w = world({ work: { unknowns: [], unread: [], approved: [] } });
      const r = await runOnce({ ...w.deps, ledger: wired.ledger });
      expect(r.note).toBe(`${NOTHING} ${RECEIPTS_LOST(5)}`);
      expect(w.healths[0].detail.receiptsMissing).toBe(5);
    } finally {
      globalThis.fetch = real;
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("the doctor", () => {
  const read = (url: string) => ({
    env: {
      AD_BILLING_WHAPI_TOKEN: "w",
      CLICKUP_API_TOKEN: "c",
      GOOGLE_APPLICATION_CREDENTIALS: "/x",
      SUPABASE_URL: url,
      SUPABASE_SERVICE_ROLE_KEY: "s",
      TYPEFORM_TOKEN: "t",
      MAKE_API_KEY: "m",
      MAKE_ZONE: "eu2",
    },
    from: {
      SUPABASE_URL: "/home/hermes/.cockpit-native-state/runtime-x.json",
      AD_BILLING_WHAPI_TOKEN: "/home/hermes/.ad-billing-guard/runtime.json",
    },
  });
  const ok = (over: Partial<Parameters<typeof doctor>[0]> = {}) => {
    const w = world();
    return doctor({
      read: read("https://bldgtotkfmhoxmlzowdx.supabase.co"),
      switches: DRY,
      db: () => w.deps.db,
      providers: w.deps.providers,
      health: async () => ({ status: "AUTH", channelLast4: "1234" }),
      oldSenders: async () => ({
        ...OFF,
        scenarios: { "9209179": "on", "9523861": "on" },
        held: true,
        sentence: "Make's recap sender is still on.",
      }),
      ...over,
    });
  };

  test("it fails on another project's SUPABASE_URL and calls nothing", async () => {
    let called = false;
    const r = await doctor({
      read: read("https://rzokwiinvented.supabase.co"),
      switches: DRY,
      db: () => {
        called = true;
        throw new Error("never");
      },
      providers: () => {
        called = true;
        throw new Error("never");
      },
      health: async () => {
        called = true;
        return { status: null, channelLast4: null };
      },
      oldSenders: async () => {
        called = true;
        return OFF;
      },
    });
    expect(r).toMatchObject({ ok: false, supabaseUrl: "another project" });
    expect(called).toBe(false);
  });

  test("a channel that is not signed in fails the doctor: Whapi answers 200 for it too", async () => {
    const signedIn = await ok();
    expect(signedIn.checks.whatsapp).toBe("ok, channel ending 1234");
    const qr = await ok({
      health: async () => ({ status: "QR", channelLast4: null }),
    });
    expect(qr.ok).toBe(false);
    expect(qr.checks.whatsapp).toBe(
      "failed: the WhatsApp channel reads QR, so it cannot send. Sign the channel in again.",
    );
    const none = await ok({
      health: async () => ({ status: null, channelLast4: "1234" }),
    });
    expect(none.ok).toBe(false);
    expect(none.checks.whatsapp).toBe(
      "failed: the WhatsApp channel reads no status, so it cannot send. Sign the channel in again.",
    );
  });

  test("a misspelt switch fails the doctor with the line to fix", async () => {
    const dir = mkdtempSync(join(tmpdir(), "client-messages-doctor-"));
    const path = join(dir, "switches.env");
    writeFileSync(
      path,
      "CLIENT_MESSAGES_APPLY=true\nCLIENT_MESSAGES_ONLY_CARD=86x\n",
    );
    const r = await ok({ switches: readSwitches(path) });
    expect(r.ok).toBe(false);
    expect(r.mode).toBe("dry");
    expect(r.checks.switches).toBe(SWITCH_UNKNOWN([2]));
    expect(JSON.stringify(r)).not.toContain("86x");
    rmSync(dir, { recursive: true, force: true });
  });

  test("each key and switch with its file, never a value; the checks read only; Make on is read, not a failure", async () => {
    const r = await ok();
    expect(r.ok).toBe(true);
    expect(r.keys.AD_BILLING_WHAPI_TOKEN).toEqual({
      set: true,
      from: "/home/hermes/.ad-billing-guard/runtime.json",
    });
    expect(r.switches.CLIENT_MESSAGES_APPLY).toEqual({
      from: "/home/hermes/.client-messages/switches.env",
    });
    expect(r.checks).toEqual({
      supabase: "ok",
      whatsapp: "ok, channel ending 1234",
      "client data": "ok, WA GROUP ID in column F",
      "old senders":
        "ok: typeform webhook off, scenario 9209179 on, scenario 9523861 on. Recaps wait until all are off.",
    });
    const all = JSON.stringify(r);
    for (const value of ['"w"', '"svc"', '"t"', '"m"'])
      expect(all).not.toContain(value);
    const unread = await ok({
      oldSenders: async () => ({
        ...OFF,
        typeform: "unread",
        held: true,
        sentence: "x",
      }),
    });
    expect(unread.ok).toBe(false);
  });

  test("receipts lost after their calls left fail the doctor and are printed; with no ledger nothing was called and no count is printed", async () => {
    const clean = await ok({ ledger: { failures: 0 } });
    expect(clean).toMatchObject({ ok: true, receiptsMissing: 0 });
    expect(clean.checks.ledger).toBeUndefined();
    const lost = await ok({ ledger: { failures: 2 } });
    expect(lost).toMatchObject({ ok: false, receiptsMissing: 2 });
    expect(lost.checks.ledger).toBe(`failed: ${RECEIPTS_LOST(2)}`);
    expect("receiptsMissing" in (await ok())).toBe(false);
  });

  test("--task prints the card's Client Data group as present and its last four, and the card field's verdict; never the full id", async () => {
    const r = await ok({ task: A });
    expect(r.task).toEqual({
      card: A,
      clientData: "present, 0001",
      cardField: "same",
    });
    expect(JSON.stringify(r)).not.toContain(G1);
    const none = await ok({ task: "86nogroup1" });
    expect(none.task).toEqual({
      card: "86nogroup1",
      clientData: "none",
      cardField: "present, 0001",
    });
    expect(JSON.stringify(none)).not.toContain(G1);
  });

  test("--task says unread for ClickUp's 200 without the card's fields, in both paths, never empty", async () => {
    const providers = world({ taskAnswer: { err: "Team not authorized" } }).deps
      .providers;
    const unread = `unread: ${CARD_NO_FIELDS}`;
    expect((await ok({ providers, task: A })).task).toEqual({
      card: A,
      clientData: "present, 0001",
      cardField: unread,
    });
    expect((await ok({ providers, task: "86nogroup1" })).task).toEqual({
      card: "86nogroup1",
      clientData: "none",
      cardField: unread,
    });
  });
});
