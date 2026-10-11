import { afterEach, beforeEach, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { actor, cockpitTestDb, member, migration, owner } from "./lib/cockpitTestDb";

// supabase/migrations/20261011v_cockpit_invoices.sql against canonical SQL:
// who may ask for an invoice from the client success cockpit, what the form
// must hold, who sees which invoices, and the worker's claim / progress /
// finish cycle. Supabase's default grants are on, so a missing REVOKE fails here.

const CEO = "00000000-0000-4000-8000-000000000001";
const CSM = "00000000-0000-4000-8000-000000000002";
const OTHER_CSM = "00000000-0000-4000-8000-000000000003";
const BUYER = "00000000-0000-4000-8000-000000000004";
const SALES = "00000000-0000-4000-8000-000000000005";
const FINANCE = "00000000-0000-4000-8000-000000000006";
const ADMIN = "00000000-0000-4000-8000-000000000007";

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
  await db.exec(migration("20261011v_cockpit_invoices.sql"));
  await member(db, CEO, "aziz@maharamedia.com", []);
  await member(db, CSM, "csm@maharamedia.com", ["csm"]);
  await member(db, OTHER_CSM, "other@maharamedia.com", ["csm"]);
  await member(db, BUYER, "buyer@maharamedia.com", ["media_buyer"]);
  await member(db, SALES, "sales@maharamedia.com", ["sales"]);
  await member(db, FINANCE, "finance@maharamedia.com", ["finance"]);
  await member(db, ADMIN, "admin@maharamedia.com", ["admin"]);
  await owner(db);
  await db.exec(`UPDATE public.cockpit_members SET clients='{"Shades Interior Design & General Contracting"}' WHERE email='csm@maharamedia.com';
    UPDATE public.cockpit_members SET clients='{"Madana Consulting Engineering"}' WHERE email='other@maharamedia.com';
    INSERT INTO public.cockpit_billing_accounts(clickup_task_id,client_name,country) VALUES
      ('z8xmdvfpyw','Shades Interior Design & General Contracting','Saudi Arabia'),
      ('madana01','Madana Consulting Engineering','Saudi Arabia');`);
});

afterEach(async () => { await db.close(); });

const paid = {
  taskId: "z8xmdvfpyw", kind: "paid", amount: "6000", description: "90-day agreement",
  lineNote: "Paid in full, covering all 90 days of the agreement", period: "Days 1-90", clientDetail: "Jeddah, Saudi Arabia",
  payments: [
    { date: "2026-10-03", method: "Bank transfer", amount: "500", ref: "DEPOSIT" },
    { date: "2026-10-06", method: "Bank transfer", amount: "5500", ref: "FINAL PAYMENT" },
  ],
};

async function request(who: string, args: unknown) {
  await actor(db, who);
  try {
    const r = await db.query<{ v: Record<string, unknown> }>("SELECT public.cockpit_invoice_request($1::jsonb) AS v", [JSON.stringify(args)]);
    return r.rows[0].v;
  } finally { await owner(db); }
}

async function refused(who: string, args: unknown, message: RegExp) {
  await expect(request(who, args)).rejects.toThrow(message);
}

async function asService<T>(sql: string, params: unknown[] = []) {
  await db.exec("RESET ROLE; SET ROLE service_role");
  try { return (await db.query<T>(sql, params)).rows; } finally { await owner(db); }
}

test("a success manager queues a paid invoice for their client, with an audit row", async () => {
  const row = await request(CSM, paid);
  expect(row.status).toBe("queued");
  expect(row.kind).toBe("paid");
  expect(Number(row.amount_usd)).toBe(6000);
  expect(row.requested_by).toBe("csm@maharamedia.com");
  expect(row.client_name).toBe("Shades Interior Design & General Contracting");
  expect((row.payments as unknown[]).length).toBe(2);
  const audit = (await db.query<{ action: string; actor_email: string }>(
    "SELECT action, actor_email FROM public.cockpit_audit_log WHERE entity_id=$1", [row.id])).rows;
  expect(audit).toEqual([{ action: "invoice.request", actor_email: "csm@maharamedia.com" }]);
});

test("sales, finance, admin and the CEO may ask; a media buyer and a stranger may not", async () => {
  for (const who of [SALES, FINANCE, ADMIN, CEO]) {
    const row = await request(who, { ...paid, amount: "6000" });
    expect(row.status).toBe("queued");
    await db.exec("DELETE FROM public.cockpit_invoices");
  }
  await refused(BUYER, paid, /client success, finance, sales, admin or CEO seat/);
  // Signed out is the anon role, which cannot reach the function at all.
  await refused(null as unknown as string, paid, /permission denied/);
});

test("a success manager cannot invoice another manager's client", async () => {
  await refused(OTHER_CSM, paid, /not one of your clients/);
  await refused(CSM, { ...paid, taskId: "missing" }, /Pick a client from the list/);
});

test("the form is checked: amount, description, payments, due date, link", async () => {
  await refused(CSM, { ...paid, amount: "6,000" }, /Type the amount in US dollars/);
  await refused(CSM, { ...paid, amount: "0" }, /more than 0/);
  await refused(CSM, { ...paid, description: "  " }, /Type a description/);
  await refused(CSM, { ...paid, description: "x".repeat(121) }, /too long/);
  await refused(CSM, { ...paid, amount: "6100" }, /add up to 6,000.00, but the invoice total is 6,100.00/);
  await refused(CSM, { ...paid, payments: [] }, /Add each payment received/);
  await refused(CSM, { ...paid, payments: [{ date: "2099-01-01", method: "Bank transfer", amount: "6000" }] }, /today or before/);
  await refused(CSM, { ...paid, payments: [{ date: "2026-10-06", method: " ", amount: "6000" }] }, /needs a method/);
  const checkout = { taskId: "z8xmdvfpyw", kind: "checkout", amount: "1500", description: "90-day agreement", dueDate: "2026-11-01" };
  await refused(CSM, checkout, /Paste the full payment link/);
  await refused(CSM, { ...checkout, checkoutUrl: "javascript:alert(1)" }, /Paste the full payment link/);
  await refused(CSM, { ...checkout, checkoutUrl: "https://whop.com/x\"><script>" }, /Paste the full payment link/);
  await refused(CSM, { ...checkout, checkoutUrl: "https://whop.com/checkout/plan_x", dueDate: "" }, /date the payment is due/);
  await refused(CSM, { ...checkout, kind: "other" }, /Choose the invoice type/);
  const ok = await request(CSM, { ...checkout, checkoutUrl: "https://whop.com/checkout/plan_x?email=a%40b.com" });
  expect(ok.status).toBe("queued");
  expect(ok.due_date).toBe("2026-11-01");
  const card = await request(CSM, { ...checkout, kind: "autocharge", checkoutUrl: "https://ignored.example", amount: "1400" });
  expect(card.checkout_url).toBeNull();
});

test("the same form sent twice makes one invoice", async () => {
  await request(CSM, paid);
  await refused(CSM, paid, /already being made/);
});

test("the browser cannot write the tables or call the worker functions", async () => {
  await actor(db, CSM);
  await expect(db.query("INSERT INTO public.cockpit_invoices(clickup_task_id,client_name,kind,amount_usd,description,issue_date,payments,requested_by) VALUES('z8xmdvfpyw','x','paid',1,'x','2026-10-11','[{}]','x')")).rejects.toThrow(/permission denied/);
  await expect(db.query("SELECT * FROM public.cockpit_invoice_claim(300)")).rejects.toThrow(/permission denied/);
  await expect(db.query("SELECT public.cockpit_invoice_save_folder('z8xmdvfpyw','x','abcdefghijklmnop','x')")).rejects.toThrow(/permission denied/);
  await actor(db, null);
  await expect(db.query("SELECT * FROM public.cockpit_invoices")).rejects.toThrow(/permission denied/);
  await expect(db.query("SELECT public.cockpit_invoice_request('{}'::jsonb)")).rejects.toThrow(/permission denied/);
  await owner(db);
});

test("seats read the worker's check-in but never its ledger; the worker writes both", async () => {
  await asService("INSERT INTO public.cockpit_invoice_desk_status(id,beat_at,ok,detail) VALUES(true,now(),false,'The Google key is missing.')");
  await asService("INSERT INTO public.cockpit_invoice_desk_health(provider,method,resource,http_status,ok) VALUES('google_drive','GET','files',200,true)");
  await actor(db, CSM);
  expect((await db.query<{ detail: string }>("SELECT detail FROM public.cockpit_invoice_desk_status")).rows[0].detail).toBe("The Google key is missing.");
  await expect(db.query("SELECT * FROM public.cockpit_invoice_desk_health")).rejects.toThrow(/permission denied/);
  await expect(db.query("UPDATE public.cockpit_invoice_desk_status SET ok=true")).rejects.toThrow(/permission denied/);
  await actor(db, BUYER);
  expect((await db.query("SELECT * FROM public.cockpit_invoice_desk_status")).rows).toEqual([]);
  await owner(db);
});

test("each seat reads only the invoices of clients it may see", async () => {
  await request(CSM, paid);
  await request(OTHER_CSM, { ...paid, taskId: "madana01", payments: [{ date: "2026-10-06", method: "Card", amount: "6000" }] });
  const seen = async (who: string) => {
    await actor(db, who);
    const rows = (await db.query<{ client_name: string }>("SELECT client_name FROM public.cockpit_invoices ORDER BY client_name")).rows;
    await owner(db);
    return rows.map((r) => r.client_name);
  };
  expect(await seen(CSM)).toEqual(["Shades Interior Design & General Contracting"]);
  expect(await seen(OTHER_CSM)).toEqual(["Madana Consulting Engineering"]);
  expect((await seen(CEO)).length).toBe(2);
  expect((await seen(ADMIN)).length).toBe(2);
  expect(await seen(BUYER)).toEqual([]);
});

test("the worker claims, numbers, files and finishes an invoice, and the audit log follows", async () => {
  const row = await request(CSM, paid);
  const [claimed] = await asService<{ id: string; status: string; attempts: number }>("SELECT * FROM public.cockpit_invoice_claim(300)");
  expect(claimed.id).toBe(row.id as string);
  expect(claimed.status).toBe("rendering");
  expect(claimed.attempts).toBe(1);
  expect(await asService("SELECT * FROM public.cockpit_invoice_claim(300)")).toEqual([]);

  await asService("SELECT public.cockpit_invoice_progress($1,$2::jsonb)", [row.id, JSON.stringify({ invoiceNo: "INV-2026-025" })]);
  await expect(asService("SELECT public.cockpit_invoice_progress($1,$2::jsonb)", [row.id, JSON.stringify({ invoiceNo: "INV-2026-026" })]))
    .rejects.toThrow(/already has number INV-2026-025/);
  await expect(asService("SELECT public.cockpit_invoice_finish($1,true)", [row.id])).rejects.toThrow(/cockpit_invoices_issued_result/);
  await asService("SELECT public.cockpit_invoice_progress($1,$2::jsonb)", [row.id,
    JSON.stringify({ driveFileId: "file123", driveUrl: "https://drive.google.com/file/d/file123/view", registerRow: 26 })]);
  const [done] = await asService<{ status: string; invoice_no: string; register_row: number; issued_at: string | null }>(
    "SELECT * FROM public.cockpit_invoice_finish($1,true)", [row.id]);
  expect(done.status).toBe("issued");
  expect(done.invoice_no).toBe("INV-2026-025");
  expect(done.register_row).toBe(26);
  expect(done.issued_at).not.toBeNull();
  const actions = (await db.query<{ action: string }>(
    "SELECT action FROM public.cockpit_audit_log WHERE entity_id=$1 ORDER BY created_at, action", [row.id])).rows.map((r) => r.action);
  expect(actions).toContain("invoice.issued");
});

test("an invoice number is never used twice", async () => {
  const a = await request(CSM, paid);
  const b = await request(CSM, { ...paid, amount: "500", payments: [{ date: "2026-10-03", method: "Bank transfer", amount: "500" }] });
  await asService("SELECT * FROM public.cockpit_invoice_claim(300)");
  await asService("SELECT * FROM public.cockpit_invoice_claim(300)");
  await asService("SELECT public.cockpit_invoice_progress($1,$2::jsonb)", [a.id, JSON.stringify({ invoiceNo: "INV-2026-030" })]);
  await expect(asService("SELECT public.cockpit_invoice_progress($1,$2::jsonb)", [b.id, JSON.stringify({ invoiceNo: "INV-2026-030" })]))
    .rejects.toThrow(/duplicate key|unique/);
});

test("a failed invoice can be tried again or cancelled; an issued one cannot", async () => {
  const row = await request(CSM, paid);
  await asService("SELECT * FROM public.cockpit_invoice_claim(300)");
  await asService("SELECT public.cockpit_invoice_finish($1,false,$2)", [row.id, "No Drive folder found for this client."]);
  await actor(db, CSM);
  const again = (await db.query<{ v: { status: string; error: string | null; attempts: number } }>(
    "SELECT public.cockpit_invoice_change($1,'retry') AS v", [row.id])).rows[0].v;
  expect(again.status).toBe("queued");
  expect(again.error).toBeNull();
  expect(again.attempts).toBe(0);
  const cancelled = (await db.query<{ v: { status: string } }>("SELECT public.cockpit_invoice_change($1,'cancel') AS v", [row.id])).rows[0].v;
  expect(cancelled.status).toBe("cancelled");
  await expect(db.query("SELECT public.cockpit_invoice_change($1,'retry')", [row.id])).rejects.toThrow(/Only a failed invoice/);
  await actor(db, OTHER_CSM);
  await expect(db.query("SELECT public.cockpit_invoice_change($1,'cancel')", [row.id])).rejects.toThrow(/not in your list/);
  await owner(db);
});

test("a worker that keeps dying on an invoice gives up after five tries", async () => {
  const row = await request(CSM, paid);
  await db.query("UPDATE public.cockpit_invoices SET status='rendering', attempts=5, lease_until=now()-interval '1 minute' WHERE id=$1", [row.id]);
  expect(await asService("SELECT * FROM public.cockpit_invoice_claim(300)")).toEqual([]);
  const [after] = (await db.query<{ status: string; error: string }>("SELECT status, error FROM public.cockpit_invoices WHERE id=$1", [row.id])).rows;
  expect(after.status).toBe("failed");
  expect(after.error).toMatch(/stopped five times/);
});

test("only an admin or the CEO sets a client's Drive folder; the worker never overwrites it", async () => {
  const link = "https://drive.google.com/drive/folders/1reYRzta_TCqicZXFdAhhQU_OBoF3D9U9?usp=sharing";
  await actor(db, CSM);
  await expect(db.query("SELECT public.cockpit_invoice_set_folder('z8xmdvfpyw',$1)", [link])).rejects.toThrow(/Only an admin or the CEO/);
  await actor(db, ADMIN);
  await expect(db.query("SELECT public.cockpit_invoice_set_folder('z8xmdvfpyw','not a link')")).rejects.toThrow(/Paste the Drive folder link/);
  const set = (await db.query<{ v: { folder_id: string; matched_by: string } }>(
    "SELECT public.cockpit_invoice_set_folder('z8xmdvfpyw',$1) AS v", [link])).rows[0].v;
  expect(set.folder_id).toBe("1reYRzta_TCqicZXFdAhhQU_OBoF3D9U9");
  expect(set.matched_by).toBe("admin");
  const [kept] = await asService<{ folder_id: string; matched_by: string }>(
    "SELECT * FROM public.cockpit_invoice_save_folder('z8xmdvfpyw','Shades','otherfolder123456','x')");
  expect(kept.folder_id).toBe("1reYRzta_TCqicZXFdAhhQU_OBoF3D9U9");
  expect(kept.matched_by).toBe("admin");
});
