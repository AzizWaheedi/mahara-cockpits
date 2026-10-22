// ecom-payments-sync: Ecom Payments into public.cockpit_ecom_invoices (2026-10-22).
//
// Runs on Supabase (Creative Triage bldgtotkfmhoxmlzowdx). Two doors:
//  - POST with x-cron-secret (pg_cron, every 15 minutes): lists every E-Links
//    invoice on the live merchant and upserts the ledger. Ecom has no "list
//    transactions" endpoint, so the invoice list is the ledger of record.
//  - POST with X-Webhook-Signature (Ecom's webhook, set in the Ecom dashboard
//    to this function's URL): the event is stored in cockpit_ecom_events with
//    its signature result; a signed TRANSACTION_STATUS_CHANGED for an E-Links
//    invoice re-reads that invoice from Ecom and upserts it. The ledger only
//    ever takes what Ecom's own API says, never the webhook body.
// Secrets (Edge Function secrets): ECOM_LIVE_API_TOKEN, ECOM_LIVE_MID,
// ECOM_LIVE_SECRET_KEY (webhook HMAC), CRON_SECRET. Nothing here logs a key.

import { type Row, hmacHex, ledgerRow, sameHex, signatureString } from "./ecom.ts";

const API = "https://api-live.ecom.io";
const PAGE = 50;
const MAX_PAGES = 40;

const redact = (s: string) => s.replace(/\bpk_(test|live)_[A-Za-z0-9]+/gi, "[key]").slice(0, 300);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function rest(path: string, init: { method?: string; body?: unknown; prefer?: string } = {}): Promise<string> {
  const base = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const res = await fetch(`${base}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 200)}`);
  return text;
}

async function ecom(path: string): Promise<Row> {
  const token = (Deno.env.get("ECOM_LIVE_API_TOKEN") ?? "").trim();
  const mid = (Deno.env.get("ECOM_LIVE_MID") ?? "").trim();
  if (!token || !mid) throw new Error("ECOM_LIVE_API_TOKEN and ECOM_LIVE_MID must be set as Edge Function secrets.");
  if (/^pk_test/i.test(token)) throw new Error("ECOM_LIVE_API_TOKEN is a test token.");
  const res = await fetch(API + path, {
    headers: { "X-Ecom-Api-Token": token, "X-Ecom-Mid": mid, Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Ecom ${res.status} on ${path.split("?")[0]}: ${redact(text)}`);
  return JSON.parse(text || "{}");
}

/** The rate each cockpit invoice was made with, keyed by its Ecom invoice id. */
async function cockpitRates(): Promise<Map<string, { usdPerKwd: number; cockpitId: string }>> {
  const rows = JSON.parse(await rest("cockpit_invoices?select=id,ecom_invoice_id,kwd_rate&checkout_source=eq.ecom&ecom_invoice_id=not.is.null")) as Row[];
  const out = new Map<string, { usdPerKwd: number; cockpitId: string }>();
  for (const r of rows) {
    const rate = Number(r.kwd_rate);
    if (typeof r.ecom_invoice_id === "string" && rate > 0) out.set(r.ecom_invoice_id, { usdPerKwd: 1 / rate, cockpitId: String(r.id) });
  }
  return out;
}

async function upsert(rows: Row[]) {
  for (let i = 0; i < rows.length; i += 200)
    await rest("cockpit_ecom_invoices?on_conflict=id", {
      method: "POST",
      body: rows.slice(i, i + 200),
      prefer: "resolution=merge-duplicates,return=minimal",
    });
}

async function state(patch: Row) {
  const now = new Date().toISOString();
  await rest("cockpit_sync_state?on_conflict=key", {
    method: "POST",
    body: [{ key: "ecom-payments-sync", last_run_at: now, updated_at: now, ...patch }],
    prefer: "resolution=merge-duplicates,return=minimal",
  });
}

async function reconcile(): Promise<Response> {
  const now = new Date();
  try {
    const rates = await cockpitRates();
    const rows: Row[] = [];
    let pages = 0;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const data = await ecom(`/elinks/v1/api/invoices?page=${page}&take=${PAGE}&order=DESC`);
      pages += 1;
      const list = Array.isArray(data.data) ? (data.data as Row[]) : [];
      for (const inv of list) {
        const row = ledgerRow(inv, rates, now);
        if (row) rows.push(row);
      }
      const meta = (data.meta ?? {}) as Row;
      if (!list.length || meta.hasNextPage !== true) break;
    }
    await upsert(rows);
    const paid = rows.filter(r => r.status === "PAID").length;
    const note = `${rows.length} Ecom invoices (${paid} paid) in ${pages} pages`;
    await state({ ok: true, last_ok_at: now.toISOString(), note, rows_seen: rows.length });
    return json({ ok: true, rows: rows.length, paid, pages });
  } catch (e) {
    const note = redact(e instanceof Error ? e.message : String(e));
    await state({ ok: false, note, rows_seen: 0 });
    return json({ ok: false, note });
  }
}

async function webhook(req: Request, raw: string): Promise<Response> {
  let body: Row;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ ok: false, note: "not JSON" }, 400);
  }
  const data = (body.data ?? {}) as Row;
  const secret = (Deno.env.get("ECOM_LIVE_SECRET_KEY") ?? "").trim();
  const given = req.headers.get("x-webhook-signature") ?? "";
  const signed = !!secret && !!given && sameHex(given, await hmacHex(secret, signatureString(data)));
  await rest("cockpit_ecom_events", {
    method: "POST",
    body: [{
      event_type: String(body.eventType ?? "").slice(0, 60) || null,
      signature_ok: signed,
      ecom_id: String(data.ecomId ?? "").slice(0, 80) || null,
      product_token: String(data.productPaymentToken ?? "").slice(0, 120) || null,
      status: String(data.paymentStatus ?? data.status ?? "").slice(0, 40) || null,
      payload: body,
    }],
    prefer: "return=minimal",
  });
  if (!signed) return json({ ok: false, note: "signature did not match" }, 401);
  // A signed payment event: re-read the ledger from Ecom's own API. The token
  // on an E-Links event is the payment token, not the invoice id, and one
  // page of the invoice list holds months of invoices, so a full pass is exact.
  if (body.eventType === "TRANSACTION_STATUS_CHANGED" || body.eventType === "REFUND_STATUS_CHANGED") return reconcile();
  return json({ ok: true, note: "stored" });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, note: "POST only" }, 405);
  const raw = await req.text();
  const expected = (Deno.env.get("CRON_SECRET") ?? "").trim();
  const cron = (req.headers.get("x-cron-secret") ?? "").trim();
  if (cron) {
    if (!expected || cron !== expected) return json({ ok: false, note: "not allowed" }, 401);
    return reconcile();
  }
  if (req.headers.get("x-webhook-signature") !== null) return webhook(req, raw);
  return json({ ok: false, note: "not allowed" }, 401);
});
