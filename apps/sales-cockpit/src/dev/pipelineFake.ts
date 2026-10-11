// The harness's pipeline.board and pipeline.move, in sales-api's shapes
// (board.ts, index.ts pipelineBoard): the 2-Call pipeline with open leads,
// and its Closed column holding a tagged client, two clients signed on the
// New Client Form without the tag (lead-13 and lead-14, fixtures DEALS),
// and a legacy lead HighLevel has in Closed with neither. A second pipeline
// with no won stage shows the cockpit's own Signed column. A move of a
// client is refused as the server refuses it.

import * as F from "./fixtures";
import { Refused } from "./liveHarness";

type Row = Record<string, unknown>;

const H = 3_600_000;
const D = 24 * H;

const TWO_CALL = {
  id: "pipe-2call",
  name: "Sales Pipeline (2-Call)",
  stages: [
    { id: "st-new", name: "🚨New Lead", position: 0, role: "new" },
    {
      id: "st-intro",
      name: "👀Intro Call REQUESTED",
      position: 1,
      role: "intro_booked",
    },
    {
      id: "st-confirmed",
      name: "📞Intro Call CONFIRMED",
      position: 2,
      role: "intro_confirmed",
    },
    {
      id: "st-demo",
      name: "📅Demo Booked (Qualified)",
      position: 3,
      role: "demo_booked",
    },
    { id: "st-hot", name: "🔥Hot Leads", position: 4, role: "hot" },
    { id: "st-closed", name: "🎉Closed", position: 5, role: "won" },
    {
      id: "st-short",
      name: "⏳Short Term Nurture",
      position: 6,
      role: "nurture_short",
    },
  ],
};

const LS = {
  id: "pipe-ls",
  name: "Sales Pipeline (L&S)",
  stages: [
    { id: "ls-demo", name: "Demo Booked🚀", position: 0, role: "demo_booked" },
    {
      id: "ls-nurture",
      name: "Short Term Nurture💬",
      position: 1,
      role: "nurture_short",
    },
  ],
};

const PIPES = [TWO_CALL, LS];

/** Stage per open lead (by fixture index), its heat and its next step. */
const OPEN: {
  i: number;
  stage: string;
  heat: number;
  reasons: string[];
  next?: [number, string];
  wrote?: number;
  hot?: boolean;
  quiet?: boolean;
}[] = [
  {
    i: 0,
    stage: "st-new",
    heat: 7,
    reasons: ["Qualified", "Came in this hour"],
  },
  { i: 1, stage: "st-new", heat: 3, reasons: ["Wrote to us"], wrote: 2 * H },
  {
    i: 2,
    stage: "st-intro",
    heat: 5,
    reasons: ["Qualified"],
    next: [3 * H, "Intro"],
  },
  {
    i: 3,
    stage: "st-confirmed",
    heat: 6,
    reasons: ["Qualified", "$250k+ a year"],
    next: [20 * H, "Intro"],
  },
  {
    i: 4,
    stage: "st-demo",
    heat: 8,
    reasons: ["Qualified", "Ready to invest"],
    next: [26 * H, "Demo"],
  },
  {
    i: 6,
    stage: "st-hot",
    heat: 9,
    reasons: ["On the hot list", "Qualified"],
    next: [5 * H, "Hot follow-up"],
    hot: true,
  },
  { i: 8, stage: "st-short", heat: 2, reasons: [], next: [3 * D, "Next try"] },
  { i: 10, stage: "st-short", heat: 1, reasons: [], quiet: true },
];

/** The Closed column, as the server sends it: newest signing first. */
function closedCards(now: number): Row[] {
  const L = (i: number) => F.LEADS[i] as Row;
  const deal = (i: number) =>
    F.DEALS.find(d => d.contact_id === L(i).contact_id) as Row | undefined;
  const signed = (i: number, crm: string) => {
    const d = deal(i);
    return {
      client: true,
      closed: true,
      signed_at: (d?.submitted_at as string) ?? null,
      value: (d?.contracted_revenue as number) ?? null,
      closer: (d?.closer as string) ?? null,
      setter: (d?.setter as string) ?? null,
      crm_stage: crm,
    };
  };
  const base = (i: number, touch: number) => ({
    contact_id: L(i).contact_id,
    name: L(i).name,
    lead_class: L(i).lead_class,
    stage_id: "st-closed",
    heat: 0,
    reasons: [],
    hot: false,
    last_objection: null,
    last_touch_at: new Date(now - touch).toISOString(),
    wrote_at: null,
    next_at: null,
    next_what: null,
    owner: L(i).assigned_to === "u-sara" ? "Sara Khalil" : "Omar Haddad",
    dnd: false,
    quiet: false,
  });
  return [
    // Signed 3 days ago on the form, still in Demo Booked in HighLevel.
    { ...base(12, 3 * D), ...signed(12, "📅Demo Booked (Qualified)") },
    // Signed 6 days ago, sitting in Short Term Nurture in HighLevel.
    { ...base(13, 6 * D), ...signed(13, "⏳Short Term Nurture") },
    // Tagged client, no deal the cockpit can see.
    {
      ...base(23, 9 * D),
      client: true,
      closed: true,
      signed_at: null,
      value: null,
      closer: null,
      setter: null,
      crm_stage: "🔥Hot Leads",
    },
    // In HighLevel's Closed stage, with neither the tag nor a deal.
    {
      ...base(19, 120 * D),
      client: false,
      closed: true,
      signed_at: null,
      value: null,
      closer: null,
      setter: null,
      crm_stage: "🎉Closed",
    },
  ];
}

const moved = new Map<string, string>();
const CLIENTS = new Set(["lead-13", "lead-14", "lead-24"]);

export function pipelineBoardFake(b: Row): Row {
  const now = Date.now();
  const pipe = PIPES.find(p => p.id === b.pipeline_id) ?? TWO_CALL;
  const all = Boolean(b.all);
  const quiet: Record<string, number> = {};
  const cards: Row[] = [];
  if (pipe === TWO_CALL) {
    for (const o of OPEN) {
      const l = F.LEADS[o.i] as Row;
      const id = String(l.contact_id);
      if (o.quiet && !all) {
        quiet[o.stage] = (quiet[o.stage] ?? 0) + 1;
        continue;
      }
      cards.push({
        contact_id: id,
        name: l.name,
        lead_class: l.lead_class,
        stage_id: moved.get(id) ?? o.stage,
        heat: o.heat,
        reasons: o.reasons,
        hot: Boolean(o.hot),
        last_objection: o.hot ? "Wants to talk to his partner first" : null,
        last_touch_at: new Date(now - (o.quiet ? 80 * D : 5 * H)).toISOString(),
        wrote_at: o.wrote ? new Date(now - o.wrote).toISOString() : null,
        next_at: o.next ? new Date(now + o.next[0]).toISOString() : null,
        next_what: o.next?.[1] ?? null,
        owner: l.assigned_to === "u-sara" ? "Sara Khalil" : "Omar Haddad",
        dnd: Boolean(l.dnd),
        quiet: Boolean(o.quiet),
        client: false,
        closed: false,
        signed_at: null,
        value: null,
        closer: null,
        setter: null,
        crm_stage: null,
      });
    }
  }
  let closed = closedCards(now);
  if (pipe !== TWO_CALL)
    closed = closed
      .filter(c => c.client)
      .slice(0, 1)
      .map(c => ({ ...c, stage_id: "signed" }));
  if (b.scope === "mine") closed = [];
  const counts = {
    open: closed.filter(c => !c.client).length,
    signed: closed.filter(c => c.client).length,
  };
  return {
    pipeline: pipe,
    pipelines: PIPES.map(p => ({ id: p.id, name: p.name })),
    cards: [...cards, ...closed],
    quiet,
    loose: 0,
    closed_stage:
      pipe === TWO_CALL
        ? { id: "st-closed", name: "🎉Closed", synthetic: false }
        : { id: "signed", name: "Signed", synthetic: true },
    counts,
  };
}

export function pipelineMoveFake(b: Row): Row {
  const id = String(b.contact_id ?? "");
  const stageId = String(b.stage_id ?? "");
  if (!id || !stageId) throw new Refused("Which lead, and which stage?", 400);
  if (CLIENTS.has(id))
    throw new Refused(
      "This client is signed, so they stay in Closed. Client success looks after them.",
      409,
      "client",
    );
  moved.set(id, stageId);
  const stage = PIPES.flatMap(p => p.stages).find(s => s.id === stageId);
  return { move: { state: "done", to_stage_name: stage?.name ?? null } };
}
