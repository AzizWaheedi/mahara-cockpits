import { v } from "convex/values";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalQuery } from "./_generated/server";
import { isCeoEmail } from "./ceo/gate";
import { COCKPITS, staticPeople } from "./roles";

/**
 * The door into the sales cockpit.
 *
 * Built the way the editor's is (editorPortal.ts). The sales cockpit has no
 * Convex of its own: it reads Creative Triage from the browser. So the
 * portal's two-minute RS256 pass is swapped for a Supabase sign-in token
 * here, on the one deployment that already holds the Supabase service key.
 *
 * The exchange verifies the pass exactly as a child cockpit would — the
 * portal's published JWKS, the issuer, the audience, the two-minute life and
 * the cockpit name — and only then asks Supabase for a sign-in token for that
 * address. The browser never sees a service key and never chooses an email:
 * the address comes out of a signature the portal made.
 *
 * The seat list is `cockpit_sales_people`. The portal writes four of its
 * columns and no others: email, name, via_portal and role (setter, closer,
 * both or manager, chosen with the Sales seat on the Admin page; Aziz,
 * 2026-09-24: "Just let me add them like the main cockpit easily"). The
 * GoHighLevel user, the Maqsam and Fathom addresses, the Slack id, goals, pay
 * and `active` belong to the sales cockpit's own server.
 *
 * The small helpers are copies of editorPortal's rather than imports, which
 * is how these apps share code: a change to one door cannot quietly change
 * the other.
 */

declare const process: { env: Record<string, string | undefined> };
type Any = any;

const AUDIENCE = "mahara-portal";
const COCKPIT = "sales";
const TABLE = "cockpit_sales_people";

/** What a member row may say about the sales seat (schema.ts, members). */
type SalesRole = NonNullable<Doc<"members">["salesRole"]>;
const SALES_ROLES: readonly SalesRole[] = [
  "setter",
  "closer",
  "both",
  "manager",
];

/** The member's sales role, or null when none is set. */
function salesRoleOf(m: Any): SalesRole | null {
  const r = m?.salesRole;
  return SALES_ROLES.includes(r) ? (r as SalesRole) : null;
}

function portalSite(): string {
  return (
    process.env.CONVEX_SITE_URL ?? "https://adorable-seahorse-418.convex.site"
  );
}

let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function jwks() {
  if (!cachedJwks)
    cachedJwks = createRemoteJWKSet(
      new URL(`${portalSite()}/.well-known/jwks.json`),
    );
  return cachedJwks;
}

function supabase(): { url: string; key: string } {
  const url = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key)
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set on this deployment.",
    );
  return { url, key };
}

async function sb(path: string, init: RequestInit = {}): Promise<Any> {
  const { url, key } = supabase();
  const res = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    // Never echo the body wholesale: it can carry the address and the token.
    throw new Error(`Supabase said ${res.status} for ${path.split("?")[0]}`);
  }
  return text ? JSON.parse(text) : null;
}

/** Make sure an address can sign in at all, then hand back a one-use token. */
async function signInTokenFor(
  email: string,
  name: string,
  roles: string[],
  cockpits: string[],
): Promise<string> {
  const found = await sb(
    `/auth/v1/admin/users?per_page=200&filter=${encodeURIComponent(email)}`,
  ).catch(() => null);
  const existing = (found?.users ?? []).find(
    (u: Any) => String(u?.email ?? "").toLowerCase() === email,
  );
  // app_metadata, not user_metadata: a signed-in person can write their own
  // user_metadata, and the cockpit switcher should not be drawn from
  // something the viewer can edit.
  const body = {
    email,
    email_confirm: true,
    role: "authenticated",
    user_metadata: { name },
    app_metadata: { roles, cockpits, portal: true },
  };
  if (existing?.id) {
    await sb(`/auth/v1/admin/users/${existing.id}`, {
      method: "PUT",
      body: JSON.stringify({
        user_metadata: { name },
        app_metadata: body.app_metadata,
      }),
    }).catch(() => null);
  } else {
    // Confirmed on creation: the pass already proves the portal knows them,
    // and this project sends on Supabase's shared mail server, which allows
    // two messages an hour.
    await sb("/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify(body),
    }).catch(() => null);
  }
  const link = await sb("/auth/v1/admin/generate_link", {
    method: "POST",
    body: JSON.stringify({ type: "magiclink", email }),
  });
  const hashed = link?.properties?.hashed_token ?? link?.hashed_token;
  if (!hashed) throw new Error("Supabase did not return a sign-in token.");
  return String(hashed);
}

/**
 * The sales cockpit's seat list, kept level with the portal's seats.
 *
 * PostgREST writes only the columns present in the payload, so what is left
 * out keeps its stored value:
 * - a name only when the portal has one. Its directory often has none, and
 *   passing an empty one through replaced "Karim Abdelrahman" with "karim"
 *   the first time the editor's version of this ran;
 * - a role only when the member has one. An admin with no sales role keeps
 *   whatever the row says, and a new row starts as the column's default,
 *   'setter'.
 *
 * A person without the seat is switched off, never added: the table is the
 * sales team, and a seat taken away keeps its row so it can be given back.
 */
async function putPerson(
  email: string,
  name: string | null,
  viaPortal: boolean,
  role: SalesRole | null,
): Promise<void> {
  if (!viaPortal) {
    await sb(`/rest/v1/${TABLE}?email=eq.${encodeURIComponent(email)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ via_portal: false }),
    });
    return;
  }
  const row: Record<string, unknown> = { email, via_portal: true };
  if (name?.trim()) row.name = name.trim();
  if (role) row.role = role;
  await sb(`/rest/v1/${TABLE}?on_conflict=email`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([row]),
  });
}

/** One person's seat, after the portal's directory changed. */
export const pushOne = internalAction({
  args: { email: v.string() },
  returns: v.any(),
  handler: async (ctx, { email }): Promise<Any> => {
    const key = email.trim().toLowerCase();
    const m: Any = await ctx.runQuery(internal.portal.memberByEmail, {
      email: key,
    });
    const roles: string[] =
      m?.roles ?? staticPeople().find(p => p.email === key)?.roles ?? [];
    // The Sales seat, not admin, puts someone on the sales team: an admin
    // opens the cockpit through the CEO gate or the member directory, and a
    // row here would list them as a setter. The founders keep their rows.
    const may = roles.includes(COCKPIT) || isCeoEmail(key);
    try {
      await putPerson(key, String(m?.name ?? ""), may, salesRoleOf(m));
      return { email: key, active: may };
    } catch (e) {
      return { email: key, error: String(e).slice(0, 120) };
    }
  },
});

/**
 * Who is asking, proved by their own Supabase session.
 *
 * Verified against Supabase's published keys, exactly as the editor's
 * preview door does: ES256, no shared secret. Then the seat, because a valid
 * session is not the same as permission: a live row on the seat list, or one
 * of the founders' two addresses.
 */
const SUPABASE_ISSUER = () => `${supabase().url}/auth/v1`;
let sbJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function supabaseJwks() {
  if (!sbJwks)
    sbJwks = createRemoteJWKSet(
      new URL(`${SUPABASE_ISSUER()}/.well-known/jwks.json`),
    );
  return sbJwks;
}

async function sellerFromSession(token: string): Promise<string> {
  const { payload } = await jwtVerify(token, supabaseJwks(), {
    issuer: SUPABASE_ISSUER(),
  });
  const email = String(payload.email ?? "")
    .trim()
    .toLowerCase();
  if (!email) throw new Error("that session carries no address");
  if (isCeoEmail(email)) return email;
  const rows = await sb(
    `/rest/v1/${TABLE}?select=email,via_portal,active&email=eq.${encodeURIComponent(email)}`,
  );
  const me = Array.isArray(rows) ? rows[0] : null;
  if (!me || !(me.via_portal && me.active))
    throw new Error("the sales cockpit is not on your access");
  return email;
}

/** One ad's Facebook preview, for the sales cockpit (the ad a lead came from). */
export const previewForSales = internalAction({
  args: { token: v.string(), adId: v.string(), format: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, { token, adId, format }): Promise<Any> => {
    const who = await sellerFromSession(token);
    const out: Any = await ctx.runAction(internal.previews.freshFor, {
      adId,
      format,
      caller: "sales",
    });
    return { ...out, who };
  },
});

export const peopleFromMembers = internalQuery({
  args: {},
  returns: v.array(v.any()),
  handler: async ctx => {
    const rows = await ctx.db.query("members").collect();
    return rows.map(r => ({
      email: r.email,
      name: r.name ?? "",
      roles: r.roles ?? [],
      salesRole: r.salesRole ?? null,
    }));
  },
});

/**
 * Push every seat into `cockpit_sales_people`. Anyone with the sales cockpit
 * on their access (or a founder) is on there; anyone else who has a row is
 * switched off rather than deleted, so a seat taken away leaves a record and
 * can be given back.
 */
export const syncPeople = internalAction({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<Any> => {
    const rows: Any[] = await ctx.runQuery(
      internal.salesPortal.peopleFromMembers,
      {},
    );
    const statics: Any[] = staticPeople();
    const seen = new Map<
      string,
      { name: string; roles: string[]; role: SalesRole | null }
    >();
    for (const r of [...statics, ...rows]) {
      const email = String(r.email ?? "")
        .trim()
        .toLowerCase();
      if (!email) continue;
      seen.set(email, {
        name: String(r.name ?? ""),
        roles: r.roles ?? [],
        role: salesRoleOf(r),
      });
    }
    let on = 0;
    let off = 0;
    for (const [email, who] of seen) {
      const may = who.roles.includes(COCKPIT) || isCeoEmail(email);
      await putPerson(email, who.name || null, may, who.role);
      if (may) on++;
      else off++;
    }
    return { active: on, inactive: off };
  },
});

/**
 * Swap a portal pass for a Supabase sign-in token.
 *
 * Called by the sales cockpit in the browser, so it answers CORS. It returns
 * a token hash the browser finishes with `verifyOtp`; the session Supabase
 * then issues is the ordinary one, and row security decides the rest.
 */
export const exchangeToken = internalAction({
  args: { token: v.string() },
  returns: v.any(),
  handler: async (ctx, { token }): Promise<Any> => {
    const { payload } = await jwtVerify(token, jwks(), {
      issuer: portalSite(),
      audience: AUDIENCE,
    });
    if (payload.cockpit !== COCKPIT)
      throw new Error("That pass is for a different cockpit.");
    const email = String(payload.email ?? payload.sub ?? "")
      .trim()
      .toLowerCase();
    if (!email) throw new Error("That pass carries no address.");
    const roles: string[] = Array.isArray(payload.roles)
      ? (payload.roles as string[])
      : [];
    const isAdmin = roles.includes("admin");
    if (!isAdmin && !roles.includes(COCKPIT))
      throw new Error("The sales cockpit is not on your access. Ask Aziz.");
    // The portal's own name if it has one. A name derived from the address is
    // good enough for a brand new Supabase user and not good enough to write
    // over a real one on the seat list.
    const given = String(payload.name ?? "").trim();
    const name = given || email.split("@")[0];

    const cockpits: string[] = Array.isArray(payload.cockpits)
      ? (payload.cockpits as string[])
      : isAdmin
        ? [...COCKPITS]
        : roles.filter(r => r !== "admin");
    // The pass carries no sales role, so it is read from the directory.
    const m: Any = await ctx.runQuery(internal.portal.memberByEmail, {
      email,
    });
    // The seat is written before the session exists, so row security sees it.
    // Only for the Sales seat: an admin without it gets in through the CEO
    // gate or the member directory, and is not written onto the team.
    if (roles.includes(COCKPIT) || isCeoEmail(email))
      await putPerson(email, given || null, true, salesRoleOf(m));
    const hashed = await signInTokenFor(email, name, roles, cockpits);
    return { email, name, roles, cockpits, token_hash: hashed };
  },
});
