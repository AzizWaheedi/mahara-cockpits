import { afterEach, beforeEach, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { actor, cockpitTestDb, member, migration, owner } from "./lib/cockpitTestDb";

// The live invoice functions as of 20261105t_invoice_tap_links.sql, on top of
// 20261011v (the desk), 20261015a (Whop links), 20261022a (tax number),
// 20261022b (Ecom payments), 20261022d (the Ecom desk) and 20261029m (sales
// invoices), against canonical SQL: Ecom the main link, Whop (provider 'whop')
// and Tap (provider 'tap', with the client's email) the backups, "Use ...
// instead" (change 'ecom' | 'whop' | 'tap'), and the payment chips
// (cockpit_invoice_payments, Ecom and Tap), from a CSM seat that sends no app.

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
    "20261105t_invoice_tap_links.sql",
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
const change = (who: string, id: unknown, action: string, email?: string) =>
  email === undefined
    ? as<Record<string, unknown>>(who, "SELECT public.cockpit_invoice_change($1,$2) AS v", [id, action])
    : as<Record<string, unknown>>(who, "SELECT public.cockpit_invoice_change($1,$2,NULL,$3) AS v", [id, action, email]);
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

test("any provider but Ecom, Whop or Tap is refused in the database's words", async () => {
  await expect(request(CSM, { ...checkout, createLink: true, provider: "paypal" }))
    .rejects.toThrow(/Choose Ecom, Whop or Tap for the payment link\./);
  await expect(request(CSM, { ...checkout, createLink: true, provider: "" }))
    .rejects.toThrow(/Choose Ecom, Whop or Tap for the payment link\./);
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

test("no switch once a link was made, nor on anything but a failed Pay online invoice the cockpit links", async () => {
  const withId = await request(CSM, { ...checkout, createLink: true, provider: "ecom" });
  await failed(withId.id, ", ecom_invoice_id='INV_Example12345'");
  await expect(change(CSM, withId.id, "whop")).rejects.toThrow(/Ecom already made a link for this invoice, so it cannot switch/);

  const withUrl = await request(CSM, { ...checkout, amount: "1600", createLink: true, provider: "ecom" });
  await failed(withUrl.id, ", checkout_url='https://invoice.ecom.io/example'");
  await expect(change(CSM, withUrl.id, "whop")).rejects.toThrow(/cannot switch/);

  const queued = await request(CSM, { ...checkout, amount: "1700", createLink: true, provider: "ecom" });
  await expect(change(CSM, queued.id, "whop")).rejects.toThrow(/Only a failed pay-online invoice whose link the cockpit makes can switch to Whop/);

  const whop = await request(CSM, { ...checkout, amount: "1800", createLink: true, provider: "whop" });
  await failed(whop.id);
  await expect(change(CSM, whop.id, "whop")).rejects.toThrow(/This invoice already uses Whop\. Press Try again instead\./);

  const pasted = await request(CSM, { ...checkout, amount: "1900", checkoutUrl: "https://pay.example.test/abc" });
  await failed(pasted.id);
  await expect(change(CSM, pasted.id, "tap", "owner@example.com")).rejects.toThrow(/whose link the cockpit makes can switch to Tap/);

  const withPlan = await request(CSM, { ...checkout, amount: "2000", createLink: true, provider: "whop" });
  await failed(withPlan.id, ", whop_plan_id='plan_Example12345'");
  await expect(change(CSM, withPlan.id, "ecom")).rejects.toThrow(/Whop already made a link for this invoice, so it cannot switch\. Cancel it and make a new invoice with Ecom\./);
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

// ---- Tap, the second backup (2026-11-05) ---------------------------------------------

test("a Tap link needs the client's email, kept in lower case; a bad email is refused", async () => {
  await expect(request(CSM, { ...checkout, createLink: true, provider: "tap" }))
    .rejects.toThrow(/Tap needs the client's email\. It shows on Tap's payment page; Tap sends nothing\./);
  await expect(request(CSM, { ...checkout, createLink: true, provider: "tap", clientEmail: "owner at clinic" }))
    .rejects.toThrow(/Type the client's email in full/);
  const row = await request(CSM, { ...checkout, createLink: true, provider: "tap", clientEmail: " Owner@Example-Clinic.COM " });
  expect(row.checkout_source).toBe("tap");
  expect(row.client_email).toBe("owner@example-clinic.com");
  expect(row.checkout_url).toBeNull();
  expect(row.status).toBe("queued");
  // A pasted link ignores the provider, as before.
  const pasted = await request(CSM, { ...checkout, amount: "1600", provider: "tap", checkoutUrl: "https://pay.example.test/x" });
  expect(pasted.checkout_source).toBe("pasted");
});

test("Use Tap, Whop or Ecom instead: a failed link switches between the three, the email asked once for Tap", async () => {
  const row = await request(CSM, { ...checkout, createLink: true });
  expect(row.checkout_source).toBe("ecom");
  await failed(row.id, ", ecom_started_at=now()");
  await expect(change(CSM, row.id, "tap")).rejects.toThrow(/Tap needs the client's email/);
  await expect(change(CSM, row.id, "tap", "not-an-email")).rejects.toThrow(/Type the client's email in full/);
  const tap = await change(CSM, row.id, "tap", "Pay@Example-Clinic.com");
  expect([tap.checkout_source, tap.status, tap.client_email, tap.attempts]).toEqual(["tap", "queued", "pay@example-clinic.com", 0]);
  // Ecom's started mark stays: a switch back to Ecom looks for the invoice
  // Ecom may already hold for this one before it makes another (review 2026-11-05).
  expect(tap.ecom_started_at).not.toBeNull();

  await failed(row.id, ", tap_started_at=now()");
  const whop = await change(CSM, row.id, "whop");
  expect([whop.checkout_source, whop.client_email]).toEqual(["whop", "pay@example-clinic.com"]);
  expect([whop.ecom_started_at === null, whop.tap_started_at === null]).toEqual([false, false]);
  await failed(row.id, ", whop_started_at=now()");
  // The email is kept, so going back to Tap does not ask again.
  expect((await change(CSM, row.id, "tap")).checkout_source).toBe("tap");
  await failed(row.id);
  expect((await change(CSM, row.id, "ecom")).checkout_source).toBe("ecom");
  expect((await audit(row.id)).map((a) => a.action).sort()).toEqual(
    ["invoice.ecom", "invoice.request", "invoice.tap", "invoice.tap", "invoice.whop"]);
});

async function rendering(id: unknown) {
  await db.query("UPDATE public.cockpit_invoices SET status='rendering', lease_until=now()+interval '5 minutes' WHERE id=$1", [id]);
}
const progress = (id: unknown, patch: unknown) =>
  asService<{ v: Record<string, unknown> }>("SELECT to_jsonb(public.cockpit_invoice_progress($1,$2::jsonb)) AS v", [id, JSON.stringify(patch)]);
async function asService<T>(sql: string, params: unknown[] = []) {
  await db.exec("RESET ROLE; SET ROLE service_role");
  try { return (await db.query<T>(sql, params)).rows; } finally { await owner(db); }
}
const tapLink = {
  tapInvoiceId: "inv_Example123456",
  checkoutUrl: "https://invoices.tap.company/invoice/inv_Example123456",
  amountKwd: "460.500",
  kwdRate: "0.307000",
  kwdRateAt: "2026-11-05T00:00:00+00:00",
};

test("the worker records one live Tap link, at the rate it used; sandbox pages and other hosts are refused", async () => {
  const row = await request(CSM, { ...checkout, createLink: true, provider: "tap", clientEmail: "owner@example-clinic.com" });
  await rendering(row.id);
  await expect(progress(row.id, { ecomStarted: true })).rejects.toThrow(/does not take an Ecom link/);
  await progress(row.id, { tapStarted: true });
  await expect(progress(row.id, { ...tapLink, checkoutUrl: "https://invoices.sandbox.tap.company/invoice/inv_Example123456" }))
    .rejects.toThrow(/The Tap id or payment URL is invalid/);
  await expect(progress(row.id, { ...tapLink, checkoutUrl: "https://example.test/tap.company/inv_Example123456" }))
    .rejects.toThrow(/The Tap id or payment URL is invalid/);
  await expect(progress(row.id, { ...tapLink, amountKwd: "460.5" })).rejects.toThrow(/KWD amount or exchange rate is invalid/);
  const [{ v }] = await progress(row.id, tapLink);
  expect([v.tap_invoice_id, v.checkout_url, Number(v.amount_kwd), Number(v.kwd_rate)]).toEqual(
    ["inv_Example123456", tapLink.checkoutUrl, 460.5, 0.307]);
  expect(v.tap_started_at).not.toBeNull();
  await progress(row.id, tapLink); // the same answer again is fine
  await expect(progress(row.id, { ...tapLink, tapInvoiceId: "inv_Another12345", checkoutUrl: "https://invoices.tap.company/invoice/inv_Another12345" }))
    .rejects.toThrow(/already has Tap invoice inv_Example123456/);
  // A Tap invoice with a link cannot switch.
  await db.query("UPDATE public.cockpit_invoices SET status='failed' WHERE id=$1", [row.id]);
  await expect(change(CSM, row.id, "ecom")).rejects.toThrow(/Tap already made a link for this invoice/);
});

test("Tap's paid word reaches the invoice list through the service-only sync, with an audit row", async () => {
  const row = await request(CSM, { ...checkout, createLink: true, provider: "tap", clientEmail: "owner@example-clinic.com" });
  await rendering(row.id);
  await progress(row.id, tapLink);
  const sync = (rows: unknown) => asService("SELECT public.cockpit_tap_invoice_sync($1::jsonb) AS n", [JSON.stringify(rows)]);
  const base = { id: "inv_Example123456", cockpitInvoiceId: row.id, amount: 460.5, currency: "KWD", url: tapLink.checkoutUrl };
  await sync([{ ...base, status: "UNPAID", tapStatus: "CREATED" }]);
  expect((await payments(CSM, [row.id])).map((p) => [p.status, p.method])).toEqual([["UNPAID", "Tap"]]);
  await sync([{ ...base, status: "PAID", tapStatus: "PAID", paidAt: "2026-11-06T09:00:00Z" }]);
  await sync([{ ...base, status: "PAID", tapStatus: "PAID", paidAt: "2026-11-07T09:00:00Z" }]);
  const [paid] = await payments(CSM, [row.id]);
  expect([paid.status, paid.method, new Date(String(paid.paid_at)).toISOString()]).toEqual(["PAID", "Tap", "2026-11-06T09:00:00.000Z"]);
  expect((await audit(row.id)).filter((a) => a.action === "invoice.tap_status").length).toBe(2);
  expect(await payments(OTHER_CSM, [row.id])).toEqual([]);
  await expect(sync([{ ...base, id: "inv_NotThisOne123", status: "PAID", tapStatus: "PAID" }])).rejects.toThrow(/is not on cockpit invoice/);
  // Seats cannot write the status or read the table.
  await actor(db, CEO);
  await expect(db.query("SELECT public.cockpit_tap_invoice_sync('[]'::jsonb)")).rejects.toThrow(/permission denied/);
  await expect(db.query("SELECT * FROM public.cockpit_tap_invoices")).rejects.toThrow(/permission denied/);
  await owner(db);
});

test("the table refuses a Tap invoice without an email, and Tap ids or KWD on other sources", async () => {
  const insert = (cols: string) =>
    db.query(`INSERT INTO public.cockpit_invoices(clickup_task_id,client_name,kind,amount_usd,description,issue_date,due_date,requested_by,${cols}`);
  await expect(insert("checkout_source) VALUES('ex2','Example Clinic','checkout',10,'x','2026-11-05','2026-11-06','t','tap')"))
    .rejects.toThrow(/cockpit_invoices_tap_email/);
  await expect(insert("checkout_source,tap_invoice_id) VALUES('ex2','Example Clinic','checkout',10,'x','2026-11-05','2026-11-06','t','whop','inv_Example123456')"))
    .rejects.toThrow(/cockpit_invoices_tap_only/);
  await expect(insert("checkout_source,amount_kwd) VALUES('ex2','Example Clinic','checkout',10,'x','2026-11-05','2026-11-06','t','whop',3.07)"))
    .rejects.toThrow(/cockpit_invoices_kwd_only/);
});

test("the payment chip speaks for the recorded link only, never an unrecorded attempt's", async () => {
  // An Ecom attempt that was never recorded still carries this invoice's id (metadata key1).
  const row = await request(CSM, { ...checkout, createLink: true });
  await failed(row.id, ", ecom_started_at=now()");
  await change(CSM, row.id, "tap", "owner@example-clinic.com");
  await rendering(row.id);
  await progress(row.id, tapLink);
  await db.query(`INSERT INTO public.cockpit_ecom_invoices(id,status,amount_kwd,cockpit_invoice_id,synced_at)
    VALUES('INV_Orphan00001','EXPIRED',460.5,$1,'2026-11-05T08:00:00Z')`, [row.id]);
  // A Tap invoice with no Tap word yet says nothing, not the Ecom orphan's EXPIRED.
  expect(await payments(CSM, [row.id])).toEqual([]);

  // An Ecom invoice with two Ecom rows: the recorded one wins, whatever the sync order.
  const ecom = await request(CSM, { ...checkout, amount: "1600", createLink: true });
  await rendering(ecom.id);
  await progress(ecom.id, { ecomInvoiceId: "INV_Recorded0001", checkoutUrl: "https://invoice.ecom.io/recorded",
    amountKwd: "491.200", kwdRate: "0.307000", kwdRateAt: "2026-11-05T00:00:00+00:00" });
  await db.query(`INSERT INTO public.cockpit_ecom_invoices(id,status,amount_kwd,paid_at,payment_method,cockpit_invoice_id,synced_at) VALUES
    ('INV_Recorded0001','PAID',491.2,'2026-11-05T09:00:00Z','KNET',$1,'2026-11-05T09:30:00Z'),
    ('INV_Orphan00002','UNPAID',491.2,NULL,NULL,$1,'2026-11-05T09:30:00Z')`, [ecom.id]);
  expect((await payments(CSM, [ecom.id])).map((p) => p.status)).toEqual(["PAID"]);
});
