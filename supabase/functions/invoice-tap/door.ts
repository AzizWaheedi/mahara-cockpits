// invoice-tap's doors and operations (2026-11-05). index.ts serves them.
//
// Two doors, nothing else (deploy with --verify-jwt off; the doors check):
//  - a service key of this project (the invoice worker on the VPS), proven by
//    equality with the function's own or by reading a service-only table: op doctor | find |
//    create | get. The worker has no Tap key; this function holds the live one
//    (TAP_SECRET_KEY, the secret tap-charges-sync already reads).
//  - x-cron-secret (pg_cron mahara-invoice-tap-sync, four times an hour): op
//    sync, which reads the status of every open cockpit Tap invoice back from
//    Tap into cockpit_tap_invoices through cockpit_tap_invoice_sync. It calls
//    Tap only while such an invoice is open.
// Every Tap call is written to cockpit_invoice_desk_health (provider tap), the
// invoice desk's ledger. Nothing here logs a key or a client's email.

import {
  check,
  createBody,
  isUuid,
  type CreateInput,
  type Row,
  readCreate,
  Refused,
  summarize,
  TAP_API,
  TAP_ID,
  type TapInvoice,
  tapReason,
} from "./tap.ts";

export interface Deps {
  env: (name: string) => string | undefined;
  fetch: typeof fetch;
  now: () => number;
}

/** A Tap invoice is payable until its due day plus 15 days; a year bounds the read. */
const OPEN_DAYS = 365;
const SYNC_MAX = 40;
const LIST_PAGES = 20;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Equal secrets, compared in time that does not depend on where they differ. Empty matches nothing. */
export function sameSecret(given: string, expected: string): boolean {
  if (!given || !expected) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

class TapError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function makeTap(deps: Deps, invoiceId: string | null) {
  const supabaseUrl = (deps.env("SUPABASE_URL") ?? "").replace(/\/$/, "");
  const serviceKey = deps.env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const key = (deps.env("TAP_SECRET_KEY") ?? "").trim();
  const live = /^sk_live_[A-Za-z0-9]{6,}/.test(key);
  const ledger: Row[] = [];

  async function rest(path: string, init: { method?: string; body?: unknown; prefer?: string } = {}): Promise<string> {
    const res = await deps.fetch(`${supabaseUrl}/rest/v1/${path}`, {
      method: init.method ?? "GET",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        ...(init.prefer ? { Prefer: init.prefer } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 200)}`);
    return text;
  }

  async function tap(method: "GET" | "POST", path: string, body?: unknown, forInvoice = invoiceId): Promise<Row> {
    let status = 0;
    let detail = "";
    try {
      const res = await deps.fetch(TAP_API + path, {
        method,
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      status = res.status;
      const text = await res.text();
      if (!res.ok) {
        detail = tapReason(res.status, text);
        throw new TapError(res.status, detail);
      }
      try {
        return JSON.parse(text || "{}") as Row;
      } catch {
        detail = "Tap answered with something that is not JSON";
        throw new TapError(502, detail);
      }
    } catch (e) {
      if (!(e instanceof TapError)) {
        detail = e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200);
        throw new TapError(0, `Tap did not answer (${detail})`);
      }
      throw e;
    } finally {
      ledger.push({
        invoice_id: forInvoice && isUuid(forInvoice) ? forInvoice : null,
        provider: "tap",
        method,
        resource: path.split("/").filter(Boolean).slice(0, 2).join("/"),
        http_status: status || null,
        ok: status >= 200 && status < 300,
        detail: detail || null,
      });
    }
  }

  async function flush() {
    if (!ledger.length) return;
    try {
      await rest("cockpit_invoice_desk_health", { method: "POST", body: ledger.splice(0), prefer: "return=minimal" });
    } catch {
      // The ledger never fails the call it records.
    }
  }

  function keyProblem(): string | null {
    if (!key) return "TAP_SECRET_KEY is not set on the Edge Functions, so Tap links cannot be made.";
    if (!live) return "TAP_SECRET_KEY is not a live Tap key, so Tap links cannot be made.";
    return null;
  }

  /** The cockpit invoice's Tap invoice, by the metadata the create put on it. */
  async function find(cockpitInvoice: string): Promise<TapInvoice | null> {
    let after: string | null = null;
    const found: Row[] = [];
    for (let page = 0; page < LIST_PAGES; page++) {
      const body: Row = { limit: 50 };
      if (after) body.starting_after = after;
      const data = await tap("POST", "/invoices/list", body, cockpitInvoice);
      const rows = Array.isArray(data.invoices) ? (data.invoices as Row[]) : [];
      for (const r of rows) {
        if ((r.metadata as Row | undefined)?.cockpit_invoice === cockpitInvoice) found.push(r);
      }
      const last = rows.length ? String(rows[rows.length - 1].id ?? "") : "";
      if (!rows.length || data.has_more !== true || !last || last === after) break;
      after = last;
      if (page === LIST_PAGES - 1) throw new Refused("Tap's invoice list ran past 1,000 invoices; the cockpit will not risk a second link.");
    }
    // A cancelled or expired copy can no longer be paid, so it is neither the
    // link to reuse nor a reason to refuse: only payable copies count.
    const payable = found.map(summarize).filter(f => f.status === "UNPAID" || f.status === "PAID");
    if (payable.length > 1) {
      throw new Refused(`Tap holds ${payable.length} open invoices for this cockpit invoice. Cancel the extra one in Tap first.`);
    }
    return payable[0] ?? null;
  }

  async function create(input: CreateInput): Promise<TapInvoice> {
    const made = summarize(await tap("POST", "/invoices/", createBody(input, deps.now()), input.invoiceId));
    return check(made, { invoiceId: input.invoiceId, amountKwd: input.amountKwd, live: true });
  }

  async function get(tapId: string, cockpitInvoice: string | null): Promise<TapInvoice> {
    return summarize(await tap("GET", `/invoices/${tapId}`, undefined, cockpitInvoice));
  }

  return { live, rest, tap, flush, keyProblem, find, create, get };
}

/** The status of every open cockpit Tap invoice, read back from Tap. */
async function sync(deps: Deps): Promise<Row> {
  const t = makeTap(deps, null);
  const now = new Date(deps.now());
  const state = async (patch: Row) => {
    await t.rest("cockpit_sync_state?on_conflict=key", {
      method: "POST",
      body: [{ key: "invoice-tap-sync", last_run_at: now.toISOString(), updated_at: now.toISOString(), ...patch }],
      prefer: "resolution=merge-duplicates,return=minimal",
    });
  };
  try {
    const since = new Date(deps.now() - OPEN_DAYS * 86_400_000).toISOString();
    const invoices = JSON.parse(
      await t.rest(
        `cockpit_invoices?select=id,tap_invoice_id&checkout_source=eq.tap&tap_invoice_id=not.is.null&requested_at=gte.${encodeURIComponent(since)}&order=requested_at.desc`,
      ),
    ) as Array<{ id: string; tap_invoice_id: string }>;
    if (!invoices.length) {
      await state({ ok: true, last_ok_at: now.toISOString(), note: "no open Tap invoices", rows_seen: 0 });
      return { ok: true, read: 0 };
    }
    const ids = invoices.map(i => i.tap_invoice_id).filter(id => TAP_ID.test(id));
    const known = ids.length
      ? (JSON.parse(await t.rest(`cockpit_tap_invoices?select=id,status,synced_at&id=in.(${ids.join(",")})`)) as Array<{
          id: string;
          status: string;
          synced_at: string | null;
        }>)
      : [];
    // Paid, cancelled and expired invoices are final at Tap and are not read again.
    const closed = new Set(known.filter(k => k.status === "PAID" || k.status === "CANCELLED" || k.status === "EXPIRED").map(k => k.id));
    // The ones never read first, then the longest since their last read, so a
    // long list is read in turn instead of the oldest never being reached.
    const lastRead = new Map(known.map(k => [k.id, k.synced_at ? Date.parse(k.synced_at) : 0]));
    const open = invoices
      .filter(i => TAP_ID.test(i.tap_invoice_id) && !closed.has(i.tap_invoice_id))
      .sort((a, b) => (lastRead.get(a.tap_invoice_id) ?? -1) - (lastRead.get(b.tap_invoice_id) ?? -1))
      .slice(0, SYNC_MAX);
    if (!open.length) {
      await state({ ok: true, last_ok_at: now.toISOString(), note: "every cockpit Tap invoice is paid or cancelled", rows_seen: 0 });
      return { ok: true, read: 0 };
    }
    const problem = t.keyProblem();
    if (problem) {
      await state({ ok: false, note: problem, rows_seen: 0 });
      return { ok: false, note: problem };
    }
    const rows: Row[] = [];
    let failed = 0;
    for (const inv of open) {
      try {
        const s = await t.get(inv.tap_invoice_id, inv.id);
        rows.push({
          id: s.id,
          cockpitInvoiceId: inv.id,
          status: s.status,
          tapStatus: s.tapStatus,
          amount: Number.isFinite(s.amount) ? s.amount : null,
          currency: s.currency || null,
          paidAt: s.paidAt,
          url: s.url,
        });
      } catch {
        failed += 1;
      }
    }
    if (rows.length) await t.rest("rpc/cockpit_tap_invoice_sync", { method: "POST", body: { p_rows: rows } });
    const paid = rows.filter(r => r.status === "PAID").length;
    const note = `${rows.length} open Tap invoices read (${paid} paid)${failed ? `, ${failed} not answered` : ""}`;
    await state({ ok: failed === 0, ...(failed === 0 ? { last_ok_at: now.toISOString() } : {}), note, rows_seen: rows.length });
    return { ok: failed === 0, read: rows.length, paid, failed };
  } catch (e) {
    const note = (e instanceof Error ? e.message : String(e)).slice(0, 200);
    await state({ ok: false, note, rows_seen: 0 }).catch(() => undefined);
    return { ok: false, note };
  } finally {
    await t.flush();
  }
}

/** The worker's operations. Answers carry no key and no email. */
async function work(deps: Deps, body: Row): Promise<Response> {
  const op = typeof body.op === "string" ? body.op : "";
  const invoiceId = isUuid(body.invoiceId) ? body.invoiceId : null;
  const t = makeTap(deps, invoiceId);
  try {
    if (op === "doctor") {
      const problem = t.keyProblem();
      if (problem) return json({ ok: false, note: problem });
      // Read-only, then a create Tap must refuse for its empty body: a refusal
      // for the body (400) means the key may create; 401/403 means it may not.
      await t.tap("POST", "/invoices/list", { limit: 1 });
      let create = "unknown";
      try {
        await t.tap("POST", "/invoices/", {});
        create = "ACCEPTED an empty invoice; look for it in Tap";
      } catch (e) {
        const status = e instanceof TapError ? e.status : 0;
        create = status === 401 || status === 403 ? "refused: the key may not create invoices" : status === 400 ? "allowed" : `unclear (HTTP ${status})`;
      }
      return json({ ok: create === "allowed", live: t.live, read: "allowed", create });
    }
    if (op !== "find" && op !== "create" && op !== "get") return json({ error: "Unknown op." }, 400);
    const problem = t.keyProblem();
    if (problem) return json({ error: problem, refused: true }, 409);
    if (op === "find") {
      if (!invoiceId) return json({ error: "invoiceId must be the cockpit invoice id.", refused: true }, 400);
      return json({ invoice: await t.find(invoiceId) });
    }
    if (op === "get") {
      const tapId = typeof body.tapInvoiceId === "string" ? body.tapInvoiceId : "";
      if (!TAP_ID.test(tapId)) return json({ error: "tapInvoiceId must be a Tap invoice id.", refused: true }, 400);
      return json({ invoice: await t.get(tapId, invoiceId) });
    }
    const input = readCreate(body);
    return json({ invoice: await t.create(input) });
  } catch (e) {
    if (e instanceof Refused) return json({ error: e.message, refused: true }, 409);
    if (e instanceof TapError) {
      // 4xx other than rate limits: Tap refused this request; anything else may pass.
      const refused = e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429;
      return json({ error: `Tap ${e.message}`, refused, tapStatus: e.status }, refused ? 409 : 502);
    }
    return json({ error: (e instanceof Error ? e.message : String(e)).slice(0, 200) }, 500);
  } finally {
    await t.flush();
  }
}

export function makeHandler(deps: Deps) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return json({ error: "POST only." }, 405);
    let body: Row = {};
    try {
      const parsed: unknown = await req.json();
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Row;
    } catch {
      body = {};
    }
    const cron = req.headers.get("x-cron-secret");
    if (cron !== null) {
      if (!sameSecret(cron.trim(), (deps.env("CRON_SECRET") ?? "").trim())) return json({ error: "Not allowed." }, 401);
      if (body.op !== "sync") return json({ error: "The cron secret runs the sync only." }, 403);
      return json(await sync(deps));
    }
    const auth = req.headers.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    const serviceKey = deps.env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    // verify_jwt is off (pg_cron sends no JWT), so a token's claims are never
    // trusted unverified: the function's own service key opens this door, or a
    // key that proves itself to the database (serviceKeyProves).
    if (!token || !(sameSecret(token, serviceKey) || (await serviceKeyProves(deps, token)))) {
      return json({ error: "Only the invoice worker may call this." }, 403);
    }
    return work(deps, body);
  };
}

/**
 * Whether a presented key is a service key of this project: it may read
 * cockpit_invoice_desk_health, which only the service role may read. The
 * database checks the key's signature, so a forged or copied anon or user
 * token fails. (The worker's key and the function's own service key are both
 * service keys of this project but need not be the same string.)
 */
export async function serviceKeyProves(deps: Deps, token: string): Promise<boolean> {
  if (!/^(eyJ[\w-]+\.[\w-]+\.[\w-]+|sb_secret_[\w-]+)$/.test(token) || token.length > 2048) return false;
  const base = (deps.env("SUPABASE_URL") ?? "").replace(/\/$/, "");
  if (!base) return false;
  try {
    const res = await deps.fetch(`${base}/rest/v1/cockpit_invoice_desk_health?select=id&limit=1`, {
      headers: { apikey: token, Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    await res.text();
    return res.status === 200;
  } catch {
    return false;
  }
}
