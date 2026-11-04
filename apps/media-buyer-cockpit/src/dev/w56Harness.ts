/**
 * The waves 5-6 CEO screens in the layout harness (docs/forms/WAVE56-CONTRACT.md
 * 5.4, 5.5, 5.7): the Lifetime value card and the Billing agent login card on the
 * Billing tab, Upsell payments to confirm on the Money tab, and Proposed from wins
 * on Team & payroll's pay month. Made-up answers only; nothing reaches a server.
 *
 * Active only with `?w56=`: open
 *   /harness.html?tab=billing&w56=on        (or off, empty, held, revoked, split)
 *   /harness.html?tab=money&w56=on
 *   /harness.html?path=/team&w56=on#team/pay
 * on   every door open, a written, a held and a missing card, a key in use, two
 *      upsell payments to confirm and a proposal in each state;
 * off  the doors exist but are not switched on ("Not switched on yet.");
 * empty every door open and nothing to show;
 * held  the morning writer is held for the CEO on a big jump (no daily limit read);
 * revoked the agent's key was revoked (the card says so and why);
 * split the agent still shares the old access ("not separated").
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Answer = { data: unknown; error: { message: string } | null };
const ok = (data: unknown): Answer => ({ data, error: null });
const refuse = (message: string): Answer => ({
  data: null,
  error: { message },
});

export type W56Scenario = "on" | "off" | "empty" | "held" | "revoked" | "split";
const SCENARIOS: W56Scenario[] = [
  "on",
  "off",
  "empty",
  "held",
  "revoked",
  "split",
];

export function w56Scenario(): W56Scenario | null {
  if (typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get("w56");
  if (v === null) return null;
  return (SCENARIOS as string[]).includes(v) ? (v as W56Scenario) : "on";
}

const DAY = "2026-11-02";
const AR_CLIENT = "شركة العلا للتصميم";

export function ltvReadOf(s: W56Scenario): Record<string, unknown> {
  if (s === "empty")
    return {
      on: true,
      maxDeltaUsd: 5000,
      lastRun: null,
      rows: [],
      held: [],
      loggedWaiting: 0,
      secondSource: { differ: 0 },
    };
  const rows = [
    {
      taskId: "86eyardon1",
      client: "Ardon Interiors",
      card: 2000,
      target: 4000,
      delta: 2000,
      state: "write",
      why: null,
    },
    {
      taskId: "86eyalula1",
      client: AR_CLIENT,
      card: 1500,
      target: 1500,
      delta: 0,
      state: "same",
      why: null,
    },
    {
      taskId: "86eybig001",
      client: "Imperium Studio",
      card: 1000,
      target: 7000,
      delta: 6000,
      state: "held",
      why: "Over the $5,000 cap: waits for the CEO.",
    },
    {
      taskId: "86eynobase",
      client: "Dusk Arch",
      card: null,
      target: null,
      delta: null,
      state: "missing",
      why: "No starting value on record for this card.",
    },
  ];
  return {
    on: s !== "off",
    maxDeltaUsd: s === "held" ? null : 5000,
    lastRun: {
      at: `${DAY}T05:10:00Z`,
      note: "LTV: 1 written, 1 held for the CEO, 1 missing a baseline.",
    },
    rows,
    held: [
      {
        taskId: "86eybig001",
        client: "Imperium Studio",
        target: 7000,
        card: 1000,
        delta: 6000,
        heldOn: DAY,
      },
    ],
    loggedWaiting: s === "on" ? 1 : 2,
    secondSource: s === "on" ? { differ: 1 } : null,
  };
}

export function agentReadOf(s: W56Scenario): Record<string, unknown> {
  const live = {
    id: 2,
    agent: "billing_agent",
    note: "D-AG",
    addedAt: "2026-11-05T08:00:00Z",
    revokedAt: null,
    revokedReason: null,
    lastCallAt: "2026-11-06T07:42:00Z",
    callsToday: 1,
  };
  if (s === "empty") return { separated: true, keys: [] };
  if (s === "revoked")
    return {
      separated: true,
      keys: [
        {
          ...live,
          revokedAt: "2026-11-06T09:00:00Z",
          revokedReason: "The VPS was rebuilt",
          callsToday: 0,
        },
      ],
    };
  return { separated: s !== "split", keys: [live] };
}

export function tiesOf(s: W56Scenario): Record<string, unknown>[] {
  if (s === "empty") return [];
  return [
    {
      kind: "tie_waiting",
      taskId: "86eyardon1",
      client: "Ardon Interiors",
      winId: "w1",
      proposalId: 41,
      usd: 1200,
      paidOn: "2026-11-01",
      rail: "whop",
      offer: "Website",
      checked: true,
      inDealLedger: false,
    },
    {
      kind: "tie_waiting",
      taskId: "86eyalula1",
      client: AR_CLIENT,
      winId: "w2",
      proposalId: 42,
      usd: 4890,
      paidOn: "2026-10-30",
      rail: "transfer",
      offer: "Social media management",
      checked: false,
      inDealLedger: true,
    },
  ];
}

export function proposalsOf(
  s: W56Scenario,
  month: string,
): Record<string, unknown> {
  const ym = month.slice(0, 7);
  if (s === "empty") return { month: ym, on: true, approved: false, rows: [] };
  const row = (n: number, over: Record<string, unknown>) => ({
    key: `win:00000000-0000-4000-8000-00000000000${n}:google_reviews:${ym}`,
    winId: `00000000-0000-4000-8000-00000000000${n}`,
    personId: 7,
    person: "Noura",
    partKey: "google_reviews",
    partLabel: "Google reviews",
    client: "Ardon Interiors",
    amountUsd: 75,
    state: "proposed",
    why: null,
    proofUrl: "https://g.page/r/review-fixture",
    entryId: null,
    ...over,
  });
  return {
    month: ym,
    on: true,
    approved: false,
    rows: [
      row(1, {}),
      row(2, {
        partKey: "upsells",
        partLabel: "Upsells",
        client: AR_CLIENT,
        amountUsd: 489,
        key: `win:00000000-0000-4000-8000-000000000002:upsells:${ym}`,
      }),
      row(3, {
        partKey: "referrals",
        partLabel: "Referrals",
        state: "waiting",
        amountUsd: null,
        why: "The referred client has not paid yet.",
      }),
      row(4, {
        partKey: "upsells",
        partLabel: "Upsells",
        state: "waiting",
        amountUsd: null,
        why: `This payment was paid to the closer in October 2026.`,
      }),
      row(5, {
        partKey: "renewals",
        partLabel: "Renewals",
        state: "confirmed",
        amountUsd: 300,
        entryId: 88,
      }),
      row(6, {
        partKey: "video_testimonials",
        partLabel: "Video testimonials",
        state: "declined",
        amountUsd: null,
        why: "Not a real testimonial",
      }),
    ],
  };
}

export function installW56Harness(client: SupabaseClient): void {
  const s = w56Scenario();
  if (!s) return;
  const c = client as unknown as {
    rpc: (name: string, args?: Record<string, unknown>) => Promise<Answer>;
  };
  const before = c.rpc.bind(c);
  c.rpc = async (name, args = {}) => {
    switch (name) {
      case "cockpit_form_doors": {
        const prev = await before(name, args).catch(() => ok({}));
        const base =
          prev.data && typeof prev.data === "object"
            ? (prev.data as Record<string, unknown>)
            : {};
        const open = s !== "off";
        return ok({
          ...base,
          wins: open,
          receipts: open,
          reactivate: open,
          kickoff: false,
          agent: open,
          ltv: open,
          why: open
            ? {}
            : {
                wins: "off",
                receipts: "off",
                reactivate: "off",
                agent: "off",
                ltv: "off",
              },
        });
      }
      case "cockpit_ltv_read":
        return ok(ltvReadOf(s));
      case "cockpit_ltv_release":
        return ok({
          ok: true,
          sentence: "Written. It reaches the card within a few minutes.",
        });
      case "cockpit_agent_keys_read":
        return ok(agentReadOf(s));
      case "cockpit_agent_key_revoke":
        return ok({
          ok: true,
          sentence:
            "Revoked. The agent cannot write until a new key is set on the server.",
        });
      case "cockpit_csm_wins_today":
        return ok({ rows: tiesOf(s) });
      case "cockpit_csm_wins_list":
        return ok({ wins: [], totals: {} });
      case "cockpit_ceo_win_tie_decide":
        return ok({
          ok: true,
          sentence: "Confirmed. It counts as the manager's upsell cash.",
        });
      case "cockpit_ceo_win_tie_clear":
        return ok({ ok: true, entries: [], sentence: "Tie cleared." });
      case "cockpit_ceo_pay_proposals":
        if (s === "off")
          return refuse("Pay proposals open after their switch-on.");
        return ok(
          proposalsOf(s, String(args.p_month ?? `${DAY.slice(0, 7)}-01`)),
        );
      case "cockpit_ceo_pay_proposal_decide":
        return ok({
          ok: true,
          state: "confirmed",
          sentence: "Added to November 2026.",
          month: DAY.slice(0, 7),
        });
      default:
        return before(name, args);
    }
  };
}
