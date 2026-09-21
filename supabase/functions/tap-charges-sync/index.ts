// tap-charges-sync: pull captured Tap charges into public.cockpit_tap_charges.
//
// Runs on Supabase (Creative Triage bldgtotkfmhoxmlzowdx), scheduled by
// pg_cron every 15 minutes. The Tap key is the Edge Function secret
// TAP_SECRET_KEY; the service role key is the one Supabase gives every
// function. Nothing here logs a key or a customer's details.
//
// Rules, the same as the cockpit's old direct read:
// - POST /v2/charges/list takes at most 30 days per call and pages with
//   starting_after; the sync reads the last LOOKBACK_DAYS days in windows.
// - A charge counts on the Kuwait day of transaction.created.
// - Amounts are kept in their currency and converted at the cockpit's fixed
//   rates; an unknown currency keeps usd null.
// - Test charges (live_mode false) are never cash and are skipped.
// - Refunds are a separate endpoint and are not read yet.

const TAP_URL = "https://api.tap.company/v2/charges/list";
const LOOKBACK_DAYS = 45;
const WINDOW_DAYS = 30;
const PAGE_LIMIT = "50";
const MAX_PAGES = 40;
const KUWAIT_OFFSET_MS = 3 * 3600 * 1000;
const USD_PER: Record<string, number> = {
  USD: 1,
  KWD: 3.26,
  AED: 0.2723,
  SAR: 0.2666,
  QAR: 0.2747,
};

const num = (x: unknown): number => {
  const n = typeof x === "number" ? x : Number(String(x ?? "").trim());
  return Number.isFinite(n) ? n : 0;
};
const round2 = (x: number) => Math.round(x * 100) / 100;
const kuwaitDay = (ms: number) =>
  new Date(ms + KUWAIT_OFFSET_MS).toISOString().slice(0, 10);
const dayStartMs = (day: string) =>
  new Date(`${day}T00:00:00Z`).getTime() - KUWAIT_OFFSET_MS;
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000)
    .toISOString()
    .slice(0, 10);
const redact = (s: string) =>
  s.replace(/\b[sp]k_(test|live)_[A-Za-z0-9]+/gi, "[key]").slice(0, 200);

type Row = Record<string, unknown>;

async function rest(
  base: string,
  key: string,
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {},
): Promise<string> {
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

async function listPage(
  tapKey: string,
  body: Record<string, unknown>,
): Promise<{ charges: Row[]; hasMore: boolean }> {
  const res = await fetch(TAP_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tapKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Tap returned HTTP ${res.status}: ${redact(text)}`);
  const json = JSON.parse(text);
  const charges: Row[] = Array.isArray(json?.charges) ? json.charges : [];
  return { charges, hasMore: json?.has_more === true };
}

Deno.serve(async (req: Request) => {
  // Only the pg_cron job, which sends the shared secret from the vault, may run it.
  const expected = (Deno.env.get("CRON_SECRET") ?? "").trim();
  const given = (req.headers.get("x-cron-secret") ?? "").trim();
  if (!expected || !given || given !== expected)
    return new Response(JSON.stringify({ ok: false, note: "not allowed" }), { status: 401 });
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const tapKey = (Deno.env.get("TAP_SECRET_KEY") ?? "").trim();
  const now = new Date();
  const state = async (patch: Row) => {
    await rest(supabaseUrl, serviceKey, "cockpit_sync_state?on_conflict=key", {
      method: "POST",
      body: [{ key: "tap-charges-sync", last_run_at: now.toISOString(), updated_at: now.toISOString(), ...patch }],
      prefer: "resolution=merge-duplicates,return=minimal",
    });
  };
  if (!tapKey || /^sk_test/i.test(tapKey) || /^sk_live_\.{2,}$/.test(tapKey)) {
    const note = !tapKey
      ? "TAP_SECRET_KEY is not set on this Edge Function. Add it under Edge Functions, Secrets, in the Supabase dashboard."
      : /^sk_test/i.test(tapKey)
        ? "TAP_SECRET_KEY is a test key, so Tap charges are test money and are not read."
        : "TAP_SECRET_KEY is the placeholder text from the docs, not a key.";
    await state({ ok: false, note, rows_seen: 0 });
    return new Response(JSON.stringify({ ok: false, note }), { status: 200 });
  }

  const today = kuwaitDay(now.getTime());
  const from = addDays(today, -(LOOKBACK_DAYS - 1));
  const rows: Row[] = [];
  const seen = new Set<string>();
  let requests = 0;
  let testRows = 0;
  try {
    for (let wFrom = from; wFrom <= today; wFrom = addDays(wFrom, WINDOW_DAYS)) {
      const wToRaw = addDays(wFrom, WINDOW_DAYS - 1);
      const wTo = wToRaw > today ? today : wToRaw;
      let startingAfter: string | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const body: Record<string, unknown> = {
          period: {
            date: { from: String(dayStartMs(wFrom)), to: String(dayStartMs(wTo) + 86_400_000 - 1) },
            type: "CHARGE",
          },
          status: "CAPTURED",
          limit: PAGE_LIMIT,
          order: "chronological",
          order_by: "date",
        };
        if (startingAfter) body.starting_after = startingAfter;
        const { charges, hasMore } = await listPage(tapKey, body);
        requests += 1;
        if (!charges.length) break;
        const before = seen.size;
        for (const c of charges) {
          const id = String(c?.id ?? "");
          if (!id || seen.has(id)) continue;
          seen.add(id);
          if (String(c?.status ?? "").toUpperCase() !== "CAPTURED") continue;
          if (c?.live_mode === false) {
            testRows += 1;
            continue;
          }
          const tx = (c as Row).transaction as Row | undefined;
          let at = num(tx?.created);
          if (at > 0 && at < 1e11) at *= 1000;
          if (!at) continue;
          const currency = String(c?.currency ?? "").toUpperCase() || "(none)";
          const amount = round2(num(c?.amount));
          const rate = USD_PER[currency];
          const customer = ((c as Row).customer ?? {}) as Row;
          const name = [customer.first_name, customer.middle_name, customer.last_name]
            .map(x => String(x ?? "").trim())
            .filter(Boolean)
            .join(" ");
          rows.push({
            id,
            day: kuwaitDay(at),
            at: new Date(at).toISOString(),
            status: "CAPTURED",
            live: true,
            currency,
            amount,
            usd: rate === undefined ? null : round2(amount * rate),
            email: String(customer.email ?? "").trim().toLowerCase() || null,
            name: name || null,
            description: String(c?.description ?? "").slice(0, 200) || null,
            reference: String(((c as Row).reference as Row | undefined)?.order ?? ((c as Row).reference as Row | undefined)?.transaction ?? "").slice(0, 120) || null,
            raw: { source: (c as Row).source, metadata: (c as Row).metadata },
            captured_at: now.toISOString(),
          });
        }
        if (seen.size === before) break;
        startingAfter = String(charges[charges.length - 1]?.id ?? "") || null;
        if (!hasMore || !startingAfter) break;
      }
    }
    for (let i = 0; i < rows.length; i += 200)
      await rest(supabaseUrl, serviceKey, "cockpit_tap_charges?on_conflict=id", {
        method: "POST",
        body: rows.slice(i, i + 200),
        prefer: "resolution=merge-duplicates,return=minimal",
      });
    const note = `${rows.length} captured charges over ${LOOKBACK_DAYS} days in ${requests} calls${testRows ? `, ${testRows} test charges skipped` : ""}`;
    await state({ ok: true, last_ok_at: now.toISOString(), note, rows_seen: rows.length });
    return new Response(JSON.stringify({ ok: true, rows: rows.length, requests, testRows }), { status: 200 });
  } catch (e) {
    const note = redact(e instanceof Error ? e.message : String(e));
    await state({ ok: false, note, rows_seen: rows.length });
    return new Response(JSON.stringify({ ok: false, note }), { status: 200 });
  }
});
