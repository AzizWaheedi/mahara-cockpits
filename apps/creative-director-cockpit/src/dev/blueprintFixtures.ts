import type { BlueprintIO } from "@/components/BlueprintCard";
import type { SettingsIO } from "@/components/BlueprintSettings";
import {
  type Answers,
  type BlueprintCall,
  BlueprintError,
  type BlueprintRow,
  type BlueprintSettings,
  missing,
  missingSentence,
  type Part,
  partAnswers,
} from "@/lib/blueprint";
import type { NoticeRead, NoticeView } from "@/lib/notices";

/**
 * Made-up firms for the Blueprint harness and its shots: no client's data.
 * Every name, link and answer here is invented and labelled as an example.
 */

export const TASK = "86exmpl01";
export const NAME = "Cedar and Stone Interiors (example)";
export const OTHER_TASK = "86exmpl02";
export const OTHER = "Harbour Line Builds (example)";
export const OFFER_SHEET =
  "https://docs.google.com/document/d/example-offer-sheet/edit";

const H = 3_600_000;
export const ago = (hours: number) =>
  new Date(Date.now() - hours * H).toISOString();

export const PART1: Answers = {
  service: "interior",
  capacity: "yes",
  starter: "yes",
  pack_url: "https://drive.google.com/drive/folders/1ExampleInteriorPack01",
  pack_approval: "on_call",
  daily_budget: { usd: 40, said: "$40 a day" },
  destination: "lead_form",
  identity: "their_page",
  red_lines: ["No prices in an ad", "No stock photos of other firms' rooms"],
};
export const PART2: Answers = {
  best_client: "Villa owners redoing a whole floor before they move in",
  method:
    "We measure the site ourselves, show three material boards, then one team builds it",
  pricing: "Per floor, most land between 18 and 30 thousand",
  minimum: { amount: 8000, currency: "KWD" },
  anchor: { amount: 25000, currency: "KWD" },
  competitors: [
    { name: "Example rival studio", lose: true },
    { name: "Another example firm", lose: false },
  ],
  approval: "first_batch",
  dna_status: "small_gaps",
  dna_missing: "Their colour codes and the logo files",
  rules: {
    always: ["Show the finished room in daylight"],
    never: ["Discount talk"],
  },
  camera: "yes_phone",
  shot_list: true,
  shot_list_due: ago(-60),
  readback_yes: true,
};
export const OFFER = {
  name: "The whole-floor refresh",
  what: "Design, materials and fit-out for one floor, in ten weeks",
  firstStep: "A free site visit with our lead designer",
};

function stamp(at: string, sent: Answers) {
  return {
    status: "done",
    firstAt: at,
    firstBy: "Omar",
    lastAt: at,
    lastBy: "Omar",
    presses: 1,
    lastRequestId: crypto.randomUUID(),
    sent,
  };
}
function box(state: string, createdAt: string, extra: object = {}) {
  return {
    id: crypto.randomUUID(),
    state,
    error: null,
    result: null,
    createdAt,
    settledAt: state === "done" ? createdAt : null,
    ...extra,
  };
}

/** The record in each state the card draws (?bp=…). */
export function rowFor(state: string): BlueprintRow | null {
  const base = (answers: Answers): BlueprintRow => ({
    taskId: TASK,
    clientName: NAME,
    answers,
    meta: {},
    parts: {},
    revision: 3,
    launchTaskId: null,
    outbox: { "1": null, "2": null, "3": null },
    can: { write: true },
  });
  const t1 = ago(state === "late" ? 64 : 22);
  const t2 = ago(state === "late" ? 63.4 : 21.4);
  const sent1 = (a: Answers) => ({
    parts: { "1": stamp(t1, partAnswers(1, a)) },
    launchTaskId: "86exlaunch1",
    outbox: {
      "1": box("done", t1, { result: { launchTaskId: "86exlaunch1" } }),
      "2": null,
      "3": null,
    },
  });
  switch (state) {
    case "open":
      return null;
    case "part1":
    case "nudge":
      return base({ ...PART1, best_client: PART2.best_client });
    // The server drain refused the press once and tries again (20261025o).
    case "refused": {
      const r = base({ ...PART1 });
      return {
        ...r,
        parts: { "1": stamp(ago(0.1), partAnswers(1, PART1)) },
        outbox: {
          "1": box("pending", ago(0.1), {
            attempts: 1,
            error:
              "The Marketing/ADs list has two open launch tasks for this client. Close one in ClickUp.",
          }),
          "2": null,
          "3": null,
        },
      };
    }
    // Three refusals: failed, pressed again once fixed.
    case "refused3":
    case "timedout": {
      const r = base({ ...PART1 });
      return {
        ...r,
        parts: { "1": stamp(ago(0.8), partAnswers(1, PART1)) },
        outbox: {
          "1": box("failed", ago(0.8), {
            attempts: state === "refused3" ? 3 : 0,
            error:
              state === "refused3"
                ? "The Marketing/ADs list has two open launch tasks for this client. Close one in ClickUp."
                : "This press did not finish within 30 minutes. Press again.",
            settledAt: ago(0.2),
          }),
          "2": null,
          "3": null,
        },
      };
    }
    case "unconfirmed": {
      const r = base({ ...PART1 });
      return {
        ...r,
        parts: { "1": stamp(ago(0.3), partAnswers(1, PART1)) },
        outbox: { "1": box("pending", ago(0.3)), "2": null, "3": null },
      };
    }
    case "sent":
      return {
        ...base({ ...PART1, ...PART2, readback_yes: undefined }),
        ...sent1(PART1),
      };
    case "changed": {
      const a = { ...PART1, daily_budget: { usd: 50, said: "50 a day" } };
      return { ...base({ ...a, ...PART2 }), ...sent1(PART1) };
    }
    case "closed":
    case "late":
    case "conflict":
    case "posted":
    case "notposted":
    case "needs": {
      const a = {
        ...PART1,
        ...PART2,
        offer:
          state === "needs" ? OFFER : { name: OFFER.name, what: OFFER.what },
      };
      const r = base(a);
      return {
        ...r,
        parts: {
          "1": stamp(t1, partAnswers(1, a)),
          "2": stamp(t2, partAnswers(2, a)),
          ...(state === "needs"
            ? { "3": stamp(ago(0.5), partAnswers(3, a)) }
            : {}),
        },
        launchTaskId: "86exlaunch1",
        outbox: {
          "1": box("done", t1, { result: { launchTaskId: "86exlaunch1" } }),
          "2": box("done", t2),
          "3":
            state === "needs"
              ? box("reconcile", ago(0.5), {
                  error:
                    'ClickUp\'s "Offer Creation" field has no "Done" option. Nothing was sent.',
                })
              : null,
        },
      };
    }
    case "locked": {
      const a = {
        ...PART1,
        ...PART2,
        offer: OFFER,
        scripts_status: "in_progress",
      };
      const t3 = ago(1);
      return {
        ...base(a),
        parts: {
          "1": stamp(t1, partAnswers(1, a)),
          "2": stamp(t2, partAnswers(2, a)),
          "3": stamp(t3, partAnswers(3, a)),
        },
        launchTaskId: "86exlaunch1",
        outbox: {
          "1": box("done", t1, { result: { launchTaskId: "86exlaunch1" } }),
          "2": box("done", t2),
          "3": box("done", t3),
        },
      };
    }
    default:
      return base({});
  }
}

/** The Blueprint call read (cockpit_blueprint_sources.blueprintCall), per ?bp=. */
export function callFor(state: string): BlueprintCall | null {
  if (state !== "nudge") return null;
  return {
    heldAt: ago(24 * 7),
    status: "held",
    stage: "Brand Blueprint Booked♠️",
    mapPhase: 4,
    nudge: true,
  };
}

function notice(over: Partial<NoticeView> & Pick<NoticeView, "kind">) {
  return {
    id: crypto.randomUUID(),
    state: "posted" as const,
    variant: "done",
    responseId: null,
    outboxId: null,
    parentKind: null,
    channel: { id: "C09RZ0GS0V9", name: "csm-general" },
    at: ago(21.3),
    dueAt: null,
    permalink: "https://example-workspace.slack.com/archives/C09RZ0GS0V9/p1",
    reason: null,
    ...over,
  } satisfies NoticeView;
}

/** The card's Slack notices (cockpit_slack_notice_read), per ?bp=. */
export function noticesFor(state: string): NoticeRead {
  const now = new Date().toISOString();
  const media = (over: Partial<NoticeView> = {}) =>
    notice({
      kind: "blueprint.media",
      variant: "new",
      channel: { id: "C0AE8G5MT7Y", name: "media-general" },
      permalink: "https://example-workspace.slack.com/archives/C0AE8G5MT7Y/p1",
      ...over,
    });
  switch (state) {
    case "posted":
    case "closed":
      return {
        taskId: TASK,
        now,
        notices: [media(), notice({ kind: "blueprint.close" })],
      };
    case "notposted":
      return {
        taskId: TASK,
        now,
        notices: [
          media(),
          notice({
            kind: "blueprint.close",
            state: "failed",
            permalink: null,
            reason:
              "Slack refused it: mahara-club-bot is not in #csm-general. Invite it there, then ask the tech lead to requeue this notice.",
          }),
        ],
      };
    case "locked":
      return {
        taskId: TASK,
        now,
        notices: [
          notice({
            kind: "blueprint.offer",
            variant: "thread",
            at: ago(1),
          }),
          media(),
          notice({ kind: "blueprint.close" }),
        ],
      };
    default:
      return { taskId: TASK, now, notices: [] };
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * The record in memory, answering as the real functions do. A press queues,
 * and its run settles 1.5 s later; nothing leaves the page.
 */
export function fakeBlueprintIO(
  start: BlueprintRow | null,
  opts: {
    conflictOnce?: boolean;
    runFails?: string;
    call?: BlueprintCall | null;
    notices?: NoticeRead;
  } = {},
): BlueprintIO {
  let mem = start ? structuredClone(start) : null;
  let conflict = Boolean(opts.conflictOnce);
  const row = (): BlueprintRow =>
    mem ?? {
      taskId: TASK,
      clientName: NAME,
      answers: {},
      meta: {},
      parts: {},
      revision: 0,
      launchTaskId: null,
      outbox: { "1": null, "2": null, "3": null },
      can: { write: true },
    };
  return {
    read: async () => ({
      row: mem ? structuredClone(mem) : null,
      now: new Date().toISOString(),
    }),
    save: async ({ changes }) => {
      await sleep(250);
      const r = row();
      const conflicts = [];
      const applied: string[] = [];
      const answers = { ...r.answers };
      for (const [k, c] of Object.entries(changes)) {
        if (conflict && k === "offer") {
          conflict = false;
          const theirs = {
            ...(r.answers.offer as object),
            firstStep: "A free call with our designer, then a site visit",
          };
          answers.offer = theirs;
          conflicts.push({ key: k, theirs, by: "Sara", at: ago(0.02) });
          continue;
        }
        applied.push(k);
        if (c.value === null) delete answers[k];
        else answers[k] = c.value;
      }
      mem = { ...r, answers, revision: r.revision + 1 };
      return { row: structuredClone(mem), applied, conflicts };
    },
    press: async ({ part }) => {
      await sleep(300);
      const r = row();
      const lacks = missing(part, r.answers);
      if (lacks.length) throw new BlueprintError(missingSentence(lacks), lacks);
      const id = crypto.randomUUID();
      const at = new Date().toISOString();
      const key = String(part) as "1" | "2" | "3";
      const old = r.parts[key];
      mem = {
        ...r,
        parts: {
          ...r.parts,
          [key]: {
            status: "done",
            firstAt: old?.firstAt ?? at,
            firstBy: "Omar",
            lastAt: at,
            lastBy: "Omar",
            presses: (old?.presses ?? 0) + 1,
            lastRequestId: id,
            sent: partAnswers(part as Part, r.answers),
          },
        },
        outbox: {
          ...(r.outbox ?? {}),
          [key]: {
            id,
            state: "pending",
            error: null,
            result: null,
            createdAt: at,
            settledAt: null,
          },
        },
      };
      return {
        id,
        state: "pending",
        part,
        firstAt: old?.firstAt ?? at,
        presses: (old?.presses ?? 0) + 1,
        key: `harness:${id}`,
      };
    },
    run: async id => {
      await sleep(1500);
      const r = row();
      const key = (["1", "2", "3"] as const).find(
        k => r.outbox?.[k]?.id === id,
      );
      if (!key)
        return { ok: false, error: "That request is not in the harness." };
      const failed = opts.runFails;
      mem = {
        ...r,
        outbox: {
          ...(r.outbox ?? {}),
          [key]: {
            ...(r.outbox?.[key] ?? { id, createdAt: new Date().toISOString() }),
            id,
            state: failed ? "reconcile" : "done",
            error: failed ?? null,
            result: key === "1" ? { launchTaskId: "86exlaunch1" } : null,
            createdAt: r.outbox?.[key]?.createdAt ?? new Date().toISOString(),
            settledAt: new Date().toISOString(),
          },
        },
      };
      return failed
        ? { ok: false, error: failed }
        : { ok: true, result: null, note: null };
    },
    forget: () => {},
    rehearse: async ({ part }) => {
      await sleep(800);
      if (part !== 3)
        return { missing: [], lines: ["Would comment on the launch task."] };
      return {
        missing: [],
        lines: [
          "Would set Offer Creation: Done.",
          'Would comment on "3 · Lock The Brand DNA And The Offer": Brand DNA still missing.',
          `Would comment on the launch task "${NAME} - New Client Campaign Launch 🚀": offer locked.`,
        ],
      };
    },
    session: () => "harnesssession0001",
    call: async () => {
      await sleep(200);
      return opts.call ?? null;
    },
    notices: async () => {
      await sleep(200);
      return (
        opts.notices ?? {
          taskId: TASK,
          now: new Date().toISOString(),
          notices: [],
        }
      );
    },
  };
}

export const MEMBERS = [
  { id: "81234567", name: "Example media buyer" },
  { id: "81234568", name: "Example second buyer" },
];

export function settingsFixture(admin: boolean): BlueprintSettings {
  return {
    packs: {
      "design-build":
        "https://drive.google.com/drive/folders/1ExampleDesignBuild01",
      interior: "https://drive.google.com/drive/folders/1ExampleInteriorPack01",
      architecture: null,
      fitout: "https://drive.google.com/drive/folders/1ExampleFitoutPack001",
      construction: null,
    },
    assignee: { id: "81234567", label: "Example media buyer" },
    closeRoute: "card_only",
    changes: {
      "pack.design-build": { at: ago(30), by: "Omar" },
      "pack.interior": { at: ago(30), by: "Omar" },
      "pack.fitout": { at: ago(5), by: "Omar" },
      launch_assignee: { at: ago(29), by: "Omar" },
      close_route: { at: ago(200), by: null },
    },
    can: { packs: true, closeRoute: admin },
  };
}

export function fakeSettingsIO(start: BlueprintSettings): SettingsIO {
  let mem = structuredClone(start);
  return {
    read: async () => structuredClone(mem),
    set: async (key, value, label) => {
      await sleep(250);
      const next = structuredClone(mem);
      if (key.startsWith("pack.")) {
        const s = key.slice(5);
        next.packs = { ...(next.packs ?? {}), [s]: value };
      } else next.assignee = value ? { id: value, label: label ?? null } : null;
      next.changes = {
        ...(next.changes ?? {}),
        [key]: { at: new Date().toISOString(), by: "Omar" },
      };
      mem = next;
      return structuredClone(mem);
    },
    members: async () => {
      await sleep(400);
      return MEMBERS;
    },
  };
}

/** The dashboard's source tables for the two made-up firms. */
export function dashboardTables(): Record<string, unknown[]> {
  const onboarded = Date.parse(ago(24 * 9));
  const client = (taskId: string, name: string) => ({
    _id: taskId,
    taskId,
    name,
    aliases: [name.toLowerCase().split(" ")[0]],
    clientStatus: "Launch Booked",
    onboardingCallDate: onboarded,
    brandDnaDoc: "https://docs.google.com/document/d/example-brand-dna/edit",
    offerCheatSheet: OFFER_SHEET,
    url: `https://app.clickup.com/t/${taskId}`,
  });
  const task = (id: string, name: string, kind: string, extra = {}) => ({
    _id: id,
    taskId: id,
    kind,
    name,
    status: "to do",
    assignees: [],
    createdAt: onboarded,
    ...extra,
  });
  return {
    clients: [client(TASK, NAME), client(OTHER_TASK, OTHER)],
    creativeTasks: [
      task("s1", "Script: villa walk-through", "script", {
        client: NAME,
        clients: [NAME],
      }),
      task("s2", "Script: harbour site", "script", {
        client: OTHER,
        clients: [OTHER],
      }),
    ],
    videoJobs: [],
    contentPosts: [],
    touchLog: [],
    campaigns: [],
    ads: [],
    metaTree: [],
    funnels: [],
    winnersArchive: [],
    marketPlays: [],
    checks: [],
    planItems: [],
    eodReports: [],
    blueprints: [
      {
        _id: TASK,
        taskId: TASK,
        client: NAME,
        parts: { "1": { at: ago(22) }, "2": { at: ago(21.4) } },
        offerLine: null,
        approval: "first_batch",
        dnaStatus: "small_gaps",
        dnaMissing: "Their colour codes and the logo files",
      },
      {
        _id: OTHER_TASK,
        taskId: OTHER_TASK,
        client: OTHER,
        parts: { "1": { at: ago(64) }, "2": { at: ago(63.4) } },
        offerLine: null,
        approval: "every",
        dnaStatus: "complete",
        dnaMissing: null,
      },
    ],
  };
}
