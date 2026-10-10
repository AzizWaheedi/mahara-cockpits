/**
 * Real backend output for the layout harness: `bun scripts/hours-harness-data.ts`
 * builds the hours migration in PGlite, reads the fake Hubstaff and Timetastic
 * (hoursProviders.ts) through the real sync, makes a few CEO decisions through
 * the real RPCs and approves part of September through the real
 * cockpit-hours-api handler. It writes what the CEO's RPCs return to
 * tmp/hours-e2e/data.json (ignored by git; kept apart from tmp/harness, which
 * holds real exports), which the harness serves with
 * `?hours=e2e` to the real client and the real rule (hoursModel.ts), so the
 * screens render end to end. Made-up people, figures and keys only; the CEO's
 * address is replaced before the file is written.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { makeHoursApi } from "../../../supabase/functions/cockpit-hours-api/handler";
import { claimLease } from "../../../supabase/functions/cockpit-hours-sync/lease";
import { runSync } from "../../../supabase/functions/cockpit-hours-sync/sync";
import { approveItems } from "../src/pages/ceo/hours/hoursCopy";
import type { HoursInputs } from "../src/types/ceo/hoursContract";
import { computeMonth, hashMonth } from "../src/types/ceo/hoursModel";
import { WEEK } from "./lib/hoursFixtures";
import { fakeClock, fakeProviders } from "./lib/hoursProviders";
import { actor, call, CEO, hoursTestDb, owner, pgReceipts, pgRpc } from "./lib/hoursTestDb";

const db = await hoursTestDb();
const rpc = pgRpc(db);
await actor(db, CEO);
const person = async (extra: Record<string, unknown>) =>
  Number((await call(db, "cockpit_ceo_people_save", { startedOn: "2026-01-01", schedule: WEEK, currency: "USD", ...extra })).id);
const agentOne = await person({ name: "Agent One", role: "Call centre agent", email: "person1@example.test", monthlyCost: 910 });
const editor = await person({ name: "Editor Two", role: "Video editor", monthlyCost: 600 });
const agentTwo = await person({ name: "Agent Three", role: "Call centre agent", email: "person2@example.test", monthlyCost: 880 });
await person({ name: "Buyer Four", role: "Media buyer", email: "person4@example.test", monthlyCost: 1200 });
await person({ name: "Closer Five", role: "Closer", email: "person5@example.test", monthlyCost: 1500 });
await person({ name: "Success Six", role: "Client success manager", email: "person6@example.test", monthlyCost: 300, currency: "KWD" });
await person({ name: "Strategist Seven", role: "Creative strategist", email: "person7@example.test", monthlyCost: 1100 });
await person({ name: "New Hire Eight", role: null, email: "person8@example.test", monthlyCost: null });
await person({ name: "The CEO", role: "CEO", email: "ceo@example.test", monthlyCost: null });

await rpc("cockpit_hours_key_put", { p: { provider: "hubstaff", kind: "hubstaff_org", secret: "hsoat_fixtureTokenNotReal0001", savedBy: "ceo@example.test", accountId: "900001", state: "connected" } });
await rpc("cockpit_hours_key_put", { p: { provider: "timetastic", kind: "timetastic", secret: "ttFixtureTokenNotReal0002", savedBy: "ceo@example.test", accountId: "4242", state: "connected" } });

// The nightly read, then the hourly one (online status and last activity).
const clock = fakeClock("2026-10-08T20:00:00Z");
const providers = fakeProviders({ now: clock.nowMs, payrollIds: { "7002": String(agentOne), "7003": String(editor) } });
for (const mode of ["deep", "recent"] as const) {
  const claim = await claimLease(rpc, { mode, requestedBy: "cron" });
  if (!claim.ok) throw new Error("lease busy");
  const out = await runSync({ rpc, insertReceipt: pgReceipts(db) as never, fetch: providers.request, sleep: clock.sleep, now: clock.now },
    { runId: claim.runId, leaseToken: claim.leaseToken, mode });
  if (out.state !== "ok") throw new Error(`${mode} read failed: ${JSON.stringify(out)}`);
}

// The CEO's decisions, through the CEO RPCs.
await actor(db, CEO);
await call(db, "cockpit_ceo_hours_leave_type_save", { externalId: "801", payRule: "paid" });
await call(db, "cockpit_ceo_hours_leave_type_save", { externalId: "804", payRule: "not_leave" });
// One agent's pay follows hours from September (a signed contract, outside Kuwait).
await call(db, "cockpit_ceo_hours_terms_save", { personId: agentTwo, hoursPayFrom: "2026-09", termsConfirmed: true, contractCountry: "EG", worksIn: "EG" });
await call(db, "cockpit_ceo_hours_holiday_override", { day: "2026-10-25", action: "add", name: "Made-up company day", scope: "all", reason: "Added by the CEO" });

// Approve September for whoever is ready, as the approve dialog does.
await actor(db, CEO);
const sepRaw = (await db.query<{ r: HoursInputs }>("select public.cockpit_ceo_hours_inputs('2026-09-01') r")).rows[0].r;
const sep = await hashMonth(computeMonth(sepRaw));
const ready = sep.people.filter(p => p.status.kind === "ready").slice(0, 2);
const api = makeHoursApi({ verifyUser: async () => CEO, rpc, insertReceipt: pgReceipts(db) as never, fetch: providers.request,
  sleep: async () => {}, now: () => new Date(), waitUntil: () => {} });
if (ready.length) {
  const res = await api(new Request("https://edge.test/", { method: "POST", headers: { Authorization: "Bearer jwt" },
    body: JSON.stringify({ op: "approveMany", month: "2026-09", items: approveItems(ready, sep.ruleVersion) }) }));
  console.log("approved September:", JSON.stringify((await res.json()).results.map((r: { ok: boolean }) => r.ok)));
}

const months = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
await actor(db, CEO);
const out: Record<string, unknown> = { made: new Date().toISOString(), inputs: {} };
for (const m of months)
  (out.inputs as Record<string, unknown>)[m] = (await db.query<{ r: unknown }>("select public.cockpit_ceo_hours_inputs($1::date) r", [`${m}-01`])).rows[0].r;
out.status = (await db.query<{ r: unknown }>("select public.cockpit_ceo_hours_status() r")).rows[0].r;
out.costs = (await db.query<{ r: unknown }>("select public.cockpit_ceo_hours_costs() r")).rows[0].r;
out.people = (await db.query<{ r: unknown }>("select public.cockpit_ceo_people_list() r")).rows[0].r;
await owner(db);
await db.close();

const dir = new URL("../tmp/hours-e2e/", import.meta.url);
mkdirSync(dir, { recursive: true });
const text = JSON.stringify(out, null, 1).replaceAll("aziz@maharamedia.com", "ceo@example.test");
writeFileSync(new URL("data.json", dir), text);
console.log(`wrote ${new URL("data.json", dir).pathname} (${text.length} bytes)`);
