import { afterEach, beforeEach, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { actor, cockpitTestDb, member, migration, owner } from "./lib/cockpitTestDb";

// The live invoice functions as of 20261029m_sales_invoices.sql, on top of
// 20261011v (the desk), 20261015a (Whop links), 20261022a (tax number),
// 20261022b (Ecom payments) and 20261022d (the Ecom desk), against canonical
// SQL: the client success cockpit's "Whop link (USD)" (provider 'whop'),
// "Use a Whop link instead" (change 'whop') and the Ecom payment chips
// (cockpit_invoice_payments), from a CSM seat that sends no app.

const CEO = "00000000-0000-4000-8000-000000000001";
const CSM = "00000000-0000-4000-8000-000000000002";
const OTHER_CSM = "00000000-0000-4000-8000-000000000003";
const BUYER = "00000000-0000-4000-8000-000000000004";

function extract(file: string, pattern: RegExp): string {
  const hit = migration(file).match(pattern);
  if (!hit) throw new Error(`Canonical definition missing in ${file}: ${pattern}`);
  return hit[0];
}

let db: PGlite;

beforeEach(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  await db.exec(migration("20260923a_client_billing.sql"));
  await db.exec(extract("20260926m_cockpit_csm_state.sql", /CREATE OR REPLACE FUNCTION public\.cockpit_client_allowed\([\s\S]*?END \$\$;/));
  await db.exec("GRANT EXECUTE ON FUNCTION public.cockpit_client_allowed(text) TO authenticated, service_role;");
  for (const file of [
    "20261011v_cockpit_invoices.sql",
    "20261015a_cockpit_invoice_whop_links.sql",
    "20261022a_cockpit_invoice_tax_id.sql",
    "20261022b_ecom_payments.sql",
    "20261022d_invoice_desk_ecom.sql",
    "20261029m_sales_invoices.sql",
  ]) await db.exec(migration(file));
  await member(db, CEO, "aziz@maharamedia.com", []);
  await member(db, CSM, "csm@maharamedia.com", ["csm"]);
  await member(db, OTHER_CSM, "other@maharamedia.com", ["csm"]);
  await member(db, BUYER, "buyer@maharamedia.com", ["media_buyer"]);
  await owner(db);
  await db.exec(`UPDATE public.cockpit_members SET clients='{"Example Clinic"}' WHERE email='csm@maharamedia.com';
    UPDATE public.cockpit_members SET clients='{"Example Interior Design"}' WHERE email='other@maharamedia.com';
    INSERT INTO public.cockpit_billing_accounts(clickup_task_id,client_name,country) VALUES
      ('ex2','Example Clinic','Kuwait'),
      ('ex1','Example Interior Design','Saudi Arabia');`);
});

afterEach(async () => { await db.close(); });

const checkout = { taskId: "ex2", kind: "checkout", amount: "1500", description: "Month 2", dueDate: "2026-11-20" };

async function as<T>(who: string | null, sql: string, params: unknown[] = []) {
  await actor(db, who);
  try { return (await db.query<{ v: T }>(sql, params)).rows[0]?.v as T; } finally { await owner(db); }
}
const request = (who: string, args: unknown) =>
  as<Record<string, unknown>>(who, "SELECT public.cockpit_invoice_request($1::jsonb) AS v", [JSON.stringify(args)]);
const change = (who: string, id: unknown, action: string) =>
  as<Record<string, unknown>>(who, "SELECT public.cockpit_invoice_change($1,$2) AS v", [id, action]);
const payments = (who: string, ids: unknown[]) =>
  as<{ id: string; status: string; paid_at: string | null; method: string | null }[]>(
    who, "SELECT public.cockpit_invoice_payments($1::uuid[]) AS v", [ids]);

async function audit(id: unknown) {
  return (await db.query<{ action: string; source_app: string; actor_email: string }>(
    "SELECT action, source_app, actor_email FROM public.cockpit_audit_log WHERE entity_id=$1 ORDER BY created_at, action", [id])).rows;
}

async function failed(id: unknown, patch = "") {
  await db.query(`UPDATE public.cockpit_invoices SET status='failed', error='Ecom refused the link. Tell Muhammed.', attempts=2${patch} WHERE id=$1`, [id]);
}

test("a CSM's Whop link (USD) queues a Whop invoice with no link yet, audited as the client success cockpit", async () => {
  const row = await request(CSM, { ...checkout, createLink: true, provider: "whop" });
  expect(row.status).toBe("queued");
  expect(row.checkout_source).toBe("whop");
  expect(row.checkout_url).toBeNull();
  expect(row.requested_by).toBe("csm@maharamedia.com");
  expect(await audit(row.id)).toEqual([
    { action: "invoice.request", source_app: "client-success", actor_email: "csm@maharamedia.com" },
  ]);
});

test("Ecom stays the default: provider 'ecom' or none makes an Ecom invoice; a pasted link is pasted", async () => {
  const ecom = await request(CSM, { ...checkout, createLink: true, provider: "ecom" });
  expect(ecom.checkout_source).toBe("ecom");
  const bare = await request(CSM, { ...checkout, amount: "1600", createLink: true });
  expect(bare.checkout_source).toBe("ecom");
  // The form sends no provider with a pasted link; a stray one changes nothing.
  const pasted = await request(CSM, { ...checkout, amount: "1700", checkoutUrl: "https://pay.example.test/abc" });
  expect(pasted.checkout_source).toBe("pasted");
  expect(pasted.checkout_url).toBe("https://pay.example.test/abc");
  const card = await request(CSM, { ...checkout, kind: "autocharge", amount: "1800", createLink: true, provider: "whop" });
  expect(card.checkout_source).toBe("pasted");
  expect(card.checkout_url).toBeNull();
});

test("any provider but Ecom or Whop is refused in the database's words", async () => {
  await expect(request(CSM, { ...checkout, createLink: true, provider: "tap" }))
    .rejects.toThrow(/Choose Ecom or Whop for the payment link\./);
  await expect(request(CSM, { ...checkout, createLink: true, provider: "" }))
    .rejects.toThrow(/Choose Ecom or Whop for the payment link\./);
  expect((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM public.cockpit_invoices")).rows[0].n).toBe(0);
});

test("a CSM cannot make a Whop invoice for another CSM's client; a media buyer cannot make one at all", async () => {
  await expect(request(OTHER_CSM, { ...checkout, createLink: true, provider: "whop" })).rejects.toThrow(/not one of your clients/);
  await expect(request(BUYER, { ...checkout, createLink: true, provider: "whop" })).rejects.toThrow(/client success, finance, sales, admin or CEO seat/);
});

test("Use a Whop link instead: a failed Ecom invoice with no link goes back in line as Whop, tries reset", async () => {
  const row = await request(CSM, { ...checkout, createLink: true, provider: "ecom" });
  await failed(row.id);
  const after = await change(CSM, row.id, "whop");
  expect(after.status).toBe("queued");
  expect(after.checkout_source).toBe("whop");
  expect(after.error).toBeNull();
  expect(after.attempts).toBe(0);
  expect(after.amount_kwd).toBeNull();
  expect(after.kwd_rate).toBeNull();
  expect(after.ecom_started_at).toBeNull();
  expect((await audit(row.id)).map((a) => [a.action, a.source_app])).toEqual([
    ["invoice.request", "client-success"],
    ["invoice.whop", "client-success"],
  ]);
});

test("no switch once Ecom made a link, nor on anything but a failed Pay online Ecom invoice", async () => {
  const withId = await request(CSM, { ...checkout, createLink: true, provider: "ecom" });
  await failed(withId.id, ", ecom_invoice_id='INV_Example12345'");
  await expect(change(CSM, withId.id, "whop")).rejects.toThrow(/Ecom already made a link for this invoice, so it cannot switch/);

  const withUrl = await request(CSM, { ...checkout, amount: "1600", createLink: true, provider: "ecom" });
  await failed(withUrl.id, ", checkout_url='https://invoice.ecom.io/example'");
  await expect(change(CSM, withUrl.id, "whop")).rejects.toThrow(/cannot switch/);

  const queued = await request(CSM, { ...checkout, amount: "1700", createLink: true, provider: "ecom" });
  await expect(change(CSM, queued.id, "whop")).rejects.toThrow(/Only a failed pay-online invoice with an Ecom link can switch to Whop/);

  const whop = await request(CSM, { ...checkout, amount: "1800", createLink: true, provider: "whop" });
  await failed(whop.id);
  await expect(change(CSM, whop.id, "whop")).rejects.toThrow(/Only a failed pay-online invoice with an Ecom link/);
  // A failed Whop invoice still has Try again and Cancel.
  expect((await change(CSM, whop.id, "retry")).status).toBe("queued");
});

test("another CSM cannot switch someone else's invoice to Whop", async () => {
  const row = await request(CSM, { ...checkout, createLink: true, provider: "ecom" });
  await failed(row.id);
  await expect(change(OTHER_CSM, row.id, "whop")).rejects.toThrow(/not in your list/);
  expect((await change(CEO, row.id, "whop")).checkout_source).toBe("whop");
});

test("the Ecom payment chips: a CSM reads Ecom's word on its own invoices only", async () => {
  const mine = await request(CSM, { ...checkout, createLink: true, provider: "ecom" });
  const theirs = await request(OTHER_CSM, { ...checkout, taskId: "ex1", createLink: true, provider: "ecom" });
  const quiet = await request(CSM, { ...checkout, amount: "1600", createLink: true, provider: "ecom" });
  await db.query(`INSERT INTO public.cockpit_ecom_invoices(id,status,amount_kwd,paid_at,payment_method,cockpit_invoice_id,synced_at) VALUES
    ('INV_Mine000001','UNPAID',460.5,NULL,NULL,$1,'2026-11-01T08:00:00Z'),
    ('INV_Mine000002','PAID',460.5,'2026-11-02T08:00:00Z','KNET',$1,'2026-11-02T08:00:00Z'),
    ('INV_Theirs0001','PAID',460.5,'2026-11-02T08:00:00Z','KNET',$2,'2026-11-02T08:00:00Z')`, [mine.id, theirs.id]);
  const seen = await payments(CSM, [mine.id, theirs.id, quiet.id]);
  // The newest sync wins; another CSM's invoice and one Ecom never saw are left out.
  expect(seen.map((p) => [p.id, p.status, p.method])).toEqual([[mine.id, "PAID", "KNET"]]);
  expect((await payments(CEO, [mine.id, theirs.id])).length).toBe(2);
  expect(await payments(BUYER, [mine.id])).toEqual([]);
  // The ledger itself stays finance-only.
  await actor(db, CSM);
  expect((await db.query("SELECT * FROM public.cockpit_ecom_invoices")).rows).toEqual([]);
  await owner(db);
  await expect(payments(null as unknown as string, [mine.id])).rejects.toThrow(/permission denied/);
});
