import { v } from "convex/values";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { internal } from "./_generated/api";
import { internalAction, internalQuery } from "./_generated/server";
import { staticPeople } from "./roles";

/**
 * The door into the video editor cockpit.
 *
 * The other three cockpits are Convex apps, so the portal's two-minute RS256
 * pass is swapped for a Convex session by a credentials provider inside each
 * of them. The editor cockpit has no backend of its own: it reads Supabase
 * straight from the browser. So the swap happens here instead, on the one
 * deployment that already holds the Supabase service key.
 *
 * The exchange verifies the pass exactly as a child cockpit would — the
 * portal's published JWKS, the issuer, the audience, the two-minute life and
 * the cockpit name — and only then asks Supabase for a sign-in token for that
 * address. The browser never sees a service key and never chooses an email:
 * the address comes out of a signature the portal made.
 */

declare const process: { env: Record<string, string | undefined> };
// biome-ignore lint/suspicious/noExplicitAny: rows
type Any = any;

const AUDIENCE = "mahara-portal";
const COCKPIT = "editor";

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
 * The editor cockpit's own allowlist, kept level with the portal's seats.
 *
 * A null name leaves whatever is stored alone. PostgREST only writes the
 * columns present in the payload, and the portal's directory often has no
 * name at all, so passing one through unconditionally replaced
 * "Karim Abdelrahman" with "karim" the first time this ran.
 */
async function putPerson(
  email: string,
  name: string | null,
  role: "admin" | "editor",
  active: boolean,
): Promise<void> {
  const row: Record<string, unknown> = { email, role, active };
  if (name?.trim()) row.name = name.trim();
  await sb("/rest/v1/editor_people?on_conflict=email", {
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
    const isAdmin = roles.includes("admin");
    const may = isAdmin || roles.includes(COCKPIT);
    try {
      await putPerson(
        key,
        String(m?.name ?? ""),
        isAdmin ? "admin" : "editor",
        may,
      );
      return { email: key, active: may };
    } catch (e) {
      return { email: key, error: String(e).slice(0, 120) };
    }
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
    }));
  },
});

/**
 * Push every seat into `editor_people`. Anyone with the editor cockpit on
 * their access is active there; anyone else is switched off rather than
 * deleted, so a seat taken away leaves a record and can be given back.
 */
export const syncPeople = internalAction({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<Any> => {
    const rows: Any[] = await ctx.runQuery(
      internal.editorPortal.peopleFromMembers,
      {},
    );
    const statics: Any[] = staticPeople();
    const seen = new Map<string, { name: string; roles: string[] }>();
    for (const r of [...statics, ...rows]) {
      const email = String(r.email ?? "")
        .trim()
        .toLowerCase();
      if (!email) continue;
      seen.set(email, { name: String(r.name ?? ""), roles: r.roles ?? [] });
    }
    let on = 0;
    let off = 0;
    for (const [email, who] of seen) {
      const isAdmin = who.roles.includes("admin");
      const may = isAdmin || who.roles.includes(COCKPIT);
      await putPerson(
        email,
        who.name || null,
        isAdmin ? "admin" : "editor",
        may,
      );
      if (may) on++;
      else off++;
    }
    return { active: on, inactive: off };
  },
});

/**
 * Swap a portal pass for a Supabase sign-in token.
 *
 * Called by the editor cockpit in the browser, so it answers CORS. It returns
 * a token hash the browser finishes with `verifyOtp`; the session Supabase
 * then issues is the ordinary one, and row security decides the rest.
 */
export const exchangeToken = internalAction({
  args: { token: v.string() },
  returns: v.any(),
  handler: async (_ctx, { token }): Promise<Any> => {
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
      throw new Error("The editor cockpit is not on your access. Ask Aziz.");
    // The portal's own name if it has one. A name derived from the address is
    // good enough for a brand new Supabase user and not good enough to write
    // over a real one on the seat list.
    const given = String(payload.name ?? "").trim();
    const name = given || email.split("@")[0];

    const cockpits: string[] = Array.isArray(payload.cockpits)
      ? (payload.cockpits as string[])
      : isAdmin
        ? ["media_buyer", "csm", "creative", "editor"]
        : roles.filter(r => r !== "admin");
    // The seat is written before the session exists, so row security sees it.
    await putPerson(email, given || null, isAdmin ? "admin" : "editor", true);
    const hashed = await signInTokenFor(email, name, roles, cockpits);
    return { email, name, roles, cockpits, token_hash: hashed };
  },
});
