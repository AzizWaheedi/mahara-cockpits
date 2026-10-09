/**
 * cockpit-hours-api (JWT check ON): the CEO's three actions that touch a
 * provider or store an approval. The caller's user id comes from the
 * verified JWT; cockpit_hours_actor (the verified-CEO check, service only)
 * turns it into the CEO's email or refuses with 403.
 *
 *   saveKey     {provider, key}             test, then store; start the first reads
 *   syncNow     {mode, month?, dryRun?}     claim the lease and read in the background
 *   approveMany {month, items}              recompute each person on the server and store
 *
 * Approval lives here, not in cockpit-ceo-api, so a redeploy of that
 * function by anyone else can never remove it. Errors are one sentence.
 */
import type { ApproveItem, ApproveResult, HoursInputs, PersonMonth } from "../../../apps/media-buyer-cockpit/src/types/ceo/hoursContract.ts";
import { HOURS_RULE_VERSION } from "../../../apps/media-buyer-cockpit/src/types/ceo/hoursContract.ts";
import {
  approvalSnapshot, computedCarries, computePersonMonth, contextOf, hashPerson,
} from "../../../apps/media-buyer-cockpit/src/types/ceo/hoursModel.ts";
import { type InsertReceipt, type Rpc, runHealth } from "../cockpit-hours-sync/db.ts";
import { testAndSaveKey } from "../cockpit-hours-sync/keys.ts";
import { claimLease, type Mode } from "../cockpit-hours-sync/lease.ts";
import { runSync } from "../cockpit-hours-sync/sync.ts";

export type ApiDeps = {
  /** The user id in a verified JWT, or null. */
  verifyUser: (jwt: string) => Promise<string | null>;
  rpc: Rpc;
  insertReceipt: InsertReceipt;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  waitUntil: (work: Promise<unknown>) => void;
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const kuwaitToday = (now: Date) => new Date(now.getTime() + 3 * 3600_000).toISOString().slice(0, 10);

/** YYYY-MM, not in the future, at most 6 months back. */
export function checkMonth(month: unknown, now: Date): string {
  if (typeof month !== "string" || !YM.test(month)) throw new Error("Choose a month, as YYYY-MM.");
  const current = kuwaitToday(now).slice(0, 7);
  const [y, m] = current.split("-").map(Number);
  const earliest = new Date(Date.UTC(y, m - 1 - 6, 1)).toISOString().slice(0, 7);
  if (month > current) throw new Error("That month hasn't started yet.");
  if (month < earliest) throw new Error("Hubstaff keeps 10-minute records for 6 months: choose a month from the last 6.");
  return month;
}

export function makeHoursApi(deps: ApiDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("", { headers: cors });
    if (req.method !== "POST") return json({ error: "POST required" }, 405);
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Only the CEO can do this. Sign in again as the CEO." }, 403);
    let actorId: string | null = null;
    try { actorId = await deps.verifyUser(auth.slice(7)); } catch { actorId = null; }
    if (!actorId) return json({ error: "Only the CEO can do this. Sign in again as the CEO." }, 403);
    const email = await deps.rpc("cockpit_hours_actor", { p_actor_id: actorId }).catch(() => null);
    if (typeof email !== "string" || !email) return json({ error: "Only the CEO can do this. Sign in again as the CEO." }, 403);
    try {
      const body: unknown = await req.json().catch(() => null);
      if (!isObj(body)) throw new Error("Send an action.");
      if (body.op === "saveKey") return json(await saveKey(deps, email, body));
      if (body.op === "syncNow") return json(await syncNow(deps, email, body));
      if (body.op === "approveMany") return json(await approveMany(deps, actorId, body));
      throw new Error("Unknown action.");
    } catch (e) {
      return json({ error: e instanceof Error ? e.message.slice(0, 240) : "The action failed." }, 400);
    }
  };
}

async function saveKey(deps: ApiDeps, email: string, body: Record<string, unknown>) {
  const provider = body.provider;
  if (provider !== "hubstaff" && provider !== "timetastic") throw new Error("Choose Hubstaff or Timetastic.");
  if (typeof body.key !== "string") throw new Error("Paste the key.");
  const { health } = runHealth(deps.insertReceipt, null);
  const result = await testAndSaveKey({ rpc: deps.rpc, health, request: deps.fetch, now: deps.now }, { provider, key: body.key, savedBy: email });
  if (result.ok) {
    // Doctor, then this month's read, in the background, each under the lease.
    const month = kuwaitToday(deps.now()).slice(0, 7);
    deps.waitUntil((async () => {
      for (const mode of ["doctor", "month"] as Mode[]) {
        const claim = await claimLease(deps.rpc, { mode, requestedBy: email, windowFrom: mode === "month" ? `${month}-01` : null, dryRun: false });
        if (!claim.ok) return;
        await runSync(deps, { runId: claim.runId, leaseToken: claim.leaseToken, mode, month: mode === "month" ? month : null });
      }
    })().catch(() => undefined));
    return { ok: true, state: result.state, text: result.text, last4: result.last4 };
  }
  return { ok: false, state: result.state, text: result.text };
}

async function syncNow(deps: ApiDeps, email: string, body: Record<string, unknown>) {
  const mode = body.mode;
  if (mode !== "recent" && mode !== "deep" && mode !== "doctor" && mode !== "month") throw new Error("Choose what to read.");
  const month = mode === "month" ? checkMonth(body.month, deps.now()) : null;
  const dryRun = body.dryRun === true;
  const claim = await claimLease(deps.rpc, { mode, requestedBy: email, windowFrom: month ? `${month}-01` : null, dryRun });
  if (!claim.ok) return { ok: false, busy: true, since: claim.since };
  deps.waitUntil(runSync(deps, { runId: claim.runId, leaseToken: claim.leaseToken, mode, month, dryRun }).catch(() => undefined));
  return { ok: true, runId: claim.runId };
}

function sameMoney(a: number, b: number, currency: string): boolean {
  const digits = currency.toUpperCase() === "KWD" ? 3 : 2;
  return Math.abs(a - b) < 10 ** -digits / 2;
}

async function approveMany(deps: ApiDeps, actorId: string, body: Record<string, unknown>): Promise<{ results: ApproveResult[] }> {
  const month = checkMonth(body.month, deps.now());
  if (!Array.isArray(body.items) || body.items.length === 0) throw new Error("Choose at least one person to approve.");
  if (body.items.length > 50) throw new Error("Approve at most 50 people at a time.");
  const results: ApproveResult[] = [];
  for (const raw of body.items) {
    const item = raw as ApproveItem;
    const personId = Number(item?.personId);
    if (!Number.isSafeInteger(personId) || personId <= 0) throw new Error("Choose a person first.");
    const changed = (text = "Figures changed since you opened this. Review and approve again."): ApproveResult => ({ personId, ok: false, code: "changed", text });
    if (item.ruleVersion !== HOURS_RULE_VERSION) {
      results.push({ personId, ok: false, code: "rule_mismatch", text: "The pay rule changed since this page loaded. Reload, then approve again." });
      continue;
    }
    const inputs = (await deps.rpc("cockpit_hours_inputs", { p_month: `${month}-01`, p_person: personId })) as HoursInputs;
    const p = inputs?.people?.find(x => x.personId === personId);
    if (!p) { results.push(changed("This person isn't on the roster for that month.")); continue; }
    const ctx = contextOf(inputs);
    const hash = await hashPerson(p, ctx);
    if (p.approval) {
      if (p.approval.inputsHash === item.inputsHash)
        results.push({ personId, ok: true, approvedAt: p.approval.approvedAt, amount: Number(p.approval.amount), currency: p.approval.currency, existing: true });
      else results.push(changed("This month is already approved with other figures."));
      continue;
    }
    const pm: PersonMonth = computePersonMonth(p, ctx);
    if (pm.status.kind !== "ready") {
      results.push({ personId, ok: false, code: "not_ready", text: pm.status.reasons[0]?.text ?? "Not ready to approve yet." });
      continue;
    }
    if (hash !== item.inputsHash || pm.pay.total === null || !sameMoney(pm.pay.total, Number(item.amount), pm.currency) || pm.hours.payable !== Number(item.payableS)) {
      results.push(changed());
      continue;
    }
    const carries = computedCarries(p, ctx);
    const rate = ctx.usdPer[pm.currency.toUpperCase()];
    const saved = (await deps.rpc("cockpit_hours_pay_month_approve", { p_actor_id: actorId, p: {
      personId, month, inputsHash: hash, ruleVersion: HOURS_RULE_VERSION,
      inputs: approvalSnapshot(p, ctx, carries.map(c => ({ ...c, stored: false }))), result: pm,
      amount: pm.pay.total, currency: pm.currency, amountUsd: rate === undefined ? null : Math.round(pm.pay.total * rate * 100) / 100,
      usdRate: rate ?? null, payableS: pm.hours.payable, shadow: pm.shadow, carries,
      remainder: pm.pay.corrections.carriedOut < 0 ? pm.pay.corrections.carriedOut : null,
    } })) as Record<string, unknown>;
    if (saved?.ok !== true) { results.push(changed()); continue; }
    results.push({ personId, ok: true, approvedAt: String(saved.approvedAt), amount: pm.pay.total, currency: pm.currency, existing: saved.existing === true });
  }
  return { results };
}
