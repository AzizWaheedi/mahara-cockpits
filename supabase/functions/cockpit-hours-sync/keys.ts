/**
 * Keys for Hubstaff and Timetastic (design.md 2.4). They live in
 * cockpit_hours_keys, reached only through service RPCs; nothing here
 * returns a key to a browser, a receipt, a log or an error.
 *
 * Mode A (expected): a Hubstaff organisation token, "hsoat_...". No exchange.
 * Mode B: a personal refresh token that changes on every use. Each exchange
 * is marked as started, then stored with a compare-and-swap on the key's
 * version. An exchange whose outcome is unknown is never retried: the state
 * becomes needs_new_key ("paste a new personal token").
 */
import { HoursProviderError, type HoursHealth, hubstaffExchange, hubstaffGet, timetasticGet } from "../cockpit-ceo-api/tools.ts";
import type { Rpc } from "./db.ts";

export const DEFAULT_HUBSTAFF_ORG = "705266";
export type KeyRow = {
  provider: "hubstaff" | "timetastic"; kind: "hubstaff_org" | "hubstaff_personal" | "timetastic"; secret: string; version: number;
  accountId: string | null; accessToken: string | null; accessExpiresAt: string | null; exchangeStartedAt: string | null;
  state: string; expiresOn: string | null;
};
export type Access =
  | { ok: true; token: string; accountId: string; kind: KeyRow["kind"]; state: string; version: number }
  | { ok: false; state: "no_key" | "refused" | "plan_blocked" | "needs_new_key" | "firewall_blocked"; note: string };

export async function readKey(rpc: Rpc, provider: "hubstaff" | "timetastic"): Promise<KeyRow | null> {
  const row = await rpc("cockpit_hours_key_get", { p_provider: provider });
  return row && typeof row === "object" ? (row as KeyRow) : null;
}

const BLOCKED: Record<string, Access> = {
  refused: { ok: false, state: "refused", note: "The saved key was refused. Paste a new one in Connections." },
  plan_blocked: { ok: false, state: "plan_blocked", note: "Hubstaff says this plan doesn't include API access." },
  needs_new_key: { ok: false, state: "needs_new_key", note: "Hubstaff's personal key was used up. Paste a new personal token in Connections." },
};

export async function timetasticAccess(rpc: Rpc): Promise<Access> {
  const key = await readKey(rpc, "timetastic");
  if (!key) return { ok: false, state: "no_key", note: "Timetastic isn't connected." };
  if (BLOCKED[key.state]) return BLOCKED[key.state];
  return { ok: true, token: key.secret, accountId: key.accountId ?? "", kind: "timetastic", state: key.state, version: key.version };
}

/** A usable Hubstaff token and organisation, exchanging a personal token when its access token is spent. */
export async function hubstaffAccess(rpc: Rpc, health: HoursHealth, request: typeof fetch, now: () => Date): Promise<Access> {
  for (let round = 0; round < 2; round++) {
    const key = await readKey(rpc, "hubstaff");
    if (!key) return { ok: false, state: "no_key", note: "Hubstaff isn't connected." };
    if (BLOCKED[key.state]) return BLOCKED[key.state];
    const org = key.accountId ?? DEFAULT_HUBSTAFF_ORG;
    if (key.kind === "hubstaff_org") return { ok: true, token: key.secret, accountId: org, kind: key.kind, state: key.state, version: key.version };
    const fresh = key.accessToken && key.accessExpiresAt && Date.parse(key.accessExpiresAt) > now().getTime() + 5 * 60_000;
    if (fresh && key.accessToken) return { ok: true, token: key.accessToken, accountId: org, kind: key.kind, state: key.state, version: key.version };
    if (key.exchangeStartedAt) {
      await rpc("cockpit_hours_key_state", { p: { provider: "hubstaff", state: "needs_new_key", note: "An earlier exchange did not finish" } });
      return BLOCKED.needs_new_key;
    }
    const begin = (await rpc("cockpit_hours_key_exchange_begin", { p: { provider: "hubstaff", version: key.version } })) as Record<string, unknown>;
    if (begin?.ok !== true) {
      if (begin?.reason === "version_changed") continue; // a new key was pasted meanwhile: read it again
      return BLOCKED.needs_new_key;
    }
    let swapped: { accessToken: string; refreshToken: string; expiresIn: number };
    try {
      swapped = await hubstaffExchange(key.secret, health, request);
    } catch (e) {
      if (e instanceof HoursProviderError && e.kind === "refused") {
        await rpc("cockpit_hours_key_state", { p: { provider: "hubstaff", state: "refused", note: e.message } });
        return BLOCKED.refused;
      }
      if (e instanceof HoursProviderError && e.kind === "firewall_blocked") {
        // Stopped by Cloudflare before Hubstaff saw it: the token is unused, so the exchange may run again.
        await rpc("cockpit_hours_key_state", { p: { provider: "hubstaff", state: "firewall_blocked", note: e.message, exchangeAborted: true, version: key.version } });
        return { ok: false, state: "firewall_blocked", note: e.message };
      }
      // Unknown outcome: the refresh token may already be spent. exchange_started_at stays set.
      await rpc("cockpit_hours_key_state", { p: { provider: "hubstaff", state: "needs_new_key", note: "The exchange's outcome is unknown" } });
      return BLOCKED.needs_new_key;
    }
    const accessExpiresAt = new Date(now().getTime() + Math.min(swapped.expiresIn, 23 * 3600) * 1000).toISOString();
    let version = key.version + 1;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = (await rpc("cockpit_hours_key_rotate", { p: { provider: "hubstaff", version: key.version, secret: swapped.refreshToken, accessToken: swapped.accessToken, accessExpiresAt } })) as Record<string, unknown> | null;
        if (r && Number.isSafeInteger(Number(r.version))) version = Number(r.version);
        break;
      } catch (e) {
        if (attempt === 2) throw e;
      }
    }
    return { ok: true, token: swapped.accessToken, accountId: org, kind: key.kind, state: "connected", version };
  }
  return BLOCKED.needs_new_key;
}

export type SaveKeyResult =
  | { ok: true; state: "connected" | "unchecked" | "firewall_blocked"; text: string; last4: string; people: number | null }
  | { ok: false; state: "refused" | "plan_blocked" | "missing_key"; text: string };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Test before replacing (design.md 2.4): one GET with the pasted key (the
 * exchange itself for a personal token). A 401 or 403 stores nothing and
 * the old key keeps working; an unreachable provider stores the key as
 * unchecked, and Hubstaff's firewall (Cloudflare, 403 error 1010) stores it
 * as firewall_blocked, never refused. The first good read marks either one
 * connected. The audit row (hours.keySaved) is written by cockpit_hours_key_put.
 */
export async function testAndSaveKey(
  deps: { rpc: Rpc; health: HoursHealth; request: typeof fetch; now: () => Date },
  input: { provider: "hubstaff" | "timetastic"; key: string; savedBy: string },
): Promise<SaveKeyResult> {
  const key = input.key.trim();
  const label = input.provider === "hubstaff" ? "Hubstaff" : "Timetastic";
  if (key.length < 10 || key.length > 400 || /\s/.test(key))
    return { ok: false, state: "missing_key", text: "That doesn't look like a key: it should be one line, 10 to 400 characters, with no spaces. Nothing was changed." };
  const current = await readKey(deps.rpc, input.provider);
  const expectVersion = current?.version ?? null;
  const refusedText = `${label} refused this key. Nothing was changed.`;
  const put = (p: Record<string, unknown>) => deps.rpc("cockpit_hours_key_put", { p: { provider: input.provider, savedBy: input.savedBy, expectVersion, ...p } });
  const fail = (e: unknown): SaveKeyResult | null => {
    if (e instanceof HoursProviderError && e.kind === "refused") return { ok: false, state: "refused", text: refusedText };
    if (e instanceof HoursProviderError && e.kind === "plan_blocked")
      return { ok: false, state: "plan_blocked", text: "Hubstaff says this plan doesn't include API access. Check the plan in Hubstaff under Settings, Billing. Nothing was changed." };
    return null;
  };
  const unchecked = async (p: Record<string, unknown>): Promise<SaveKeyResult> => {
    await put({ ...p, state: "unchecked" });
    return { ok: true, state: "unchecked", text: `The key is saved, but ${label} couldn't be reached to check it. The next hourly read tries again.`, last4: key.slice(-4), people: null };
  };
  // Cloudflare in front of Hubstaff stopped the check (403, 1010): not the key's fault (CEO decision).
  const firewallText = "The key is saved, but Hubstaff's firewall blocked the cockpit's check (error 1010), so it isn't checked yet. This isn't a problem with the key. The next hourly read tries again.";
  const firewalled = async (p: Record<string, unknown>): Promise<SaveKeyResult> => {
    await put({ ...p, state: "firewall_blocked" });
    return { ok: true, state: "firewall_blocked", text: firewallText, last4: String(p.secret ?? key).slice(-4), people: null };
  };
  const isFirewall = (e: unknown) => e instanceof HoursProviderError && e.kind === "firewall_blocked";

  if (input.provider === "timetastic") {
    let users: unknown;
    try {
      users = await timetasticGet(key, deps.health, deps.request, "users", {});
    } catch (e) {
      return fail(e) ?? unchecked({ kind: "timetastic", secret: key });
    }
    const list = Array.isArray(users) ? users.filter(isObj) : [];
    const org = list.find(u => u.organisationId !== undefined)?.organisationId;
    const people = list.filter(u => u.isArchived !== true).length;
    await put({ kind: "timetastic", secret: key, accountId: org === undefined ? null : String(org), state: "connected" });
    return { ok: true, state: "connected", text: `Connected. Timetastic shows ${people} ${people === 1 ? "person" : "people"}. The first read is running.`, last4: key.slice(-4), people };
  }

  let token = key;
  let stored: Record<string, unknown>;
  // An organisation token doesn't expire unless the CEO gave it a date in
  // Hubstaff (CEO decision, 2026-10-09: the hsoat_ token never expires); the
  // card's "Add an expiry date" records one. A personal token rotates.
  if (key.startsWith("hsoat_")) stored = { kind: "hubstaff_org", secret: key, expiresOn: null };
  else {
    // Mode B: the exchange is the test, and its new refresh token is stored at once.
    let swapped: { accessToken: string; refreshToken: string; expiresIn: number };
    try {
      swapped = await hubstaffExchange(key, deps.health, deps.request);
    } catch (e) {
      // Blocked by the firewall, the personal token was never used: keep it as pasted.
      if (isFirewall(e)) return firewalled({ kind: "hubstaff_personal", secret: key });
      return fail(e) ?? unchecked({ kind: "hubstaff_personal", secret: key });
    }
    token = swapped.accessToken;
    stored = { kind: "hubstaff_personal", secret: swapped.refreshToken, accessToken: swapped.accessToken,
      accessExpiresAt: new Date(deps.now().getTime() + Math.min(swapped.expiresIn, 23 * 3600) * 1000).toISOString() };
    await put({ ...stored, state: "unchecked" });
  }
  let orgId = DEFAULT_HUBSTAFF_ORG;
  let people: number | null = null;
  try {
    const orgs = await hubstaffGet(token, deps.health, deps.request, "organizations", {});
    const ids = (Array.isArray(orgs.organizations) ? orgs.organizations : []).filter(isObj).map(o => String(o.id));
    if (ids.length && !ids.includes(DEFAULT_HUBSTAFF_ORG)) orgId = ids[0];
    const members = await hubstaffGet(token, deps.health, deps.request, `organizations/${orgId}/members`, { page_limit: 500 });
    people = (Array.isArray(members.members) ? members.members : []).filter(isObj).filter(m => m.membership_status !== "removed").length;
  } catch (e) {
    const f = fail(e);
    if (f) {
      if (stored.kind === "hubstaff_personal") await deps.rpc("cockpit_hours_key_state", { p: { provider: "hubstaff", state: f.state === "plan_blocked" ? "plan_blocked" : "refused" } });
      return f;
    }
    if (isFirewall(e)) {
      if (stored.kind === "hubstaff_org") return firewalled(stored);
      await deps.rpc("cockpit_hours_key_state", { p: { provider: "hubstaff", state: "firewall_blocked", note: (e as Error).message } });
      return { ok: true, state: "firewall_blocked", text: firewallText, last4: String(stored.secret).slice(-4), people: null };
    }
    if (stored.kind === "hubstaff_org") return unchecked(stored);
    return { ok: true, state: "unchecked", text: "The key is saved, but Hubstaff couldn't be reached to check it. The next hourly read tries again.", last4: String(stored.secret).slice(-4), people: null };
  }
  if (stored.kind === "hubstaff_org") await put({ ...stored, accountId: orgId, state: "connected" });
  else await deps.rpc("cockpit_hours_key_state", { p: { provider: "hubstaff", state: "connected", accountId: orgId } });
  // A personal token is stored as its rotated refresh token: the card shows that one's last 4.
  const last4 = String(stored.secret).slice(-4);
  return { ok: true, state: "connected", text: `Connected. Hubstaff shows ${people} ${people === 1 ? "person" : "people"}. The first read is running.`, last4, people };
}
