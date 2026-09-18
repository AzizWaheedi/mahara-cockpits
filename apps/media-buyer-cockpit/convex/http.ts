// PHI console redaction (active only on PHI deployments).
import "./phiLogging";
import { httpRouter } from "convex/server";
import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import { httpAction, internalQuery } from "./_generated/server";
import { auth } from "./auth";
import { RUNBOOK } from "./health";
import { isMetaId, type PreviewResult } from "./metaMedia";
import { previewFor } from "./previews";

declare const process: { env: Record<string, string | undefined> };

const http = httpRouter();
// Registers Convex Auth's routes, including the OAuth endpoints used by
// "Sign in with Viktor": /api/auth/signin/viktor and /api/auth/callback/viktor.
auth.addHttpRoutes(http);

/**
 * The "Ask AI" door for the outside worker (Hermes). See askAi.ts.
 *
 * Guarded by a bearer token (ASKAI_TOKEN on the deployment). The token grants
 * exactly two things: read the open questions, and hand back answers.
 */
function authorized(request: Request): boolean {
  const expected = process.env.ASKAI_TOKEN;
  return (
    Boolean(expected) &&
    request.headers.get("authorization") === `Bearer ${expected}`
  );
}

/**
 * The editor cockpit's door. It is a browser app with no backend of its own,
 * so it swaps the portal's pass here for a Supabase sign-in token. Only the
 * cockpit's own origins may ask, and the pass itself is what proves who the
 * caller is: nothing in the request body chooses an address.
 */
const EDITOR_ORIGINS = [
  "https://cockpit.maharamedia.com",
  "https://mahara-media-buyer.vercel.app",
  "https://mahara-video-editor.vercel.app",
  "http://localhost:5178",
  "http://localhost:5173",
];

function editorCors(request: Request): Record<string, string> {
  const origin = request.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": EDITOR_ORIGINS.includes(origin)
      ? origin
      : "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

http.route({
  path: "/portal/editor-session",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, request) => {
    return new Response(null, { status: 204, headers: editorCors(request) });
  }),
});

http.route({
  path: "/portal/editor-session",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const headers = editorCors(request);
    if (headers["Access-Control-Allow-Origin"] === "null")
      return Response.json(
        { ok: false, error: "not an allowed origin" },
        { status: 403, headers },
      );
    let token = "";
    try {
      const body = (await request.json()) as { token?: string };
      token = String(body?.token ?? "");
    } catch {
      return Response.json(
        { ok: false, error: "send a JSON body" },
        { status: 400, headers },
      );
    }
    if (!token)
      return Response.json(
        { ok: false, error: "no pass in the request" },
        { status: 400, headers },
      );
    try {
      const out = await ctx.runAction(internal.editorPortal.exchangeToken, {
        token,
      });
      return Response.json({ ok: true, ...out }, { headers });
    } catch (e) {
      // Say what a person can act on. The raw error is a jose stack trace or
      // a Convex "Uncaught Error at handler(...)", which helps nobody.
      const raw = String((e as Error).message ?? e);
      const plain = /different cockpit/.test(raw)
        ? "That pass is for a different cockpit."
        : /not on your access/.test(raw)
          ? "The editor desk is not on your access. Ask Aziz."
          : /"exp"|expired/i.test(raw)
            ? "That pass has expired. Open the editor desk from the portal again."
            : /JWS|JWT|signature|Compact/i.test(raw)
              ? "That pass was not signed by the portal."
              : /no address/.test(raw)
                ? "That pass carries no address."
                : "That pass was not accepted. Open the editor desk from the portal again.";
      return Response.json(
        { ok: false, error: plain },
        { status: 401, headers },
      );
    }
  }),
});

http.route({
  path: "/askai/pending",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    if (!authorized(request)) return new Response("no", { status: 401 });
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 10);
    const jobs = await ctx.runMutation(internal.askAi.pending, { limit });
    await ctx.runMutation(internal.askAi.heartbeat, {});
    return Response.json({ ok: true, jobs });
  }),
});

http.route({
  path: "/askai/result",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!authorized(request)) return new Response("no", { status: 401 });
    const body = (await request.json()) as {
      id: string;
      result?: unknown;
      error?: string;
    };
    if (!body?.id)
      return Response.json(
        { ok: false, error: "id required" },
        { status: 400 },
      );
    try {
      const out = await ctx.runMutation(internal.askAi.complete, {
        id: body.id as never,
        result: body.result,
        error: body.error,
      });
      return Response.json(out);
    } catch (e) {
      return Response.json(
        { ok: false, error: String(e).slice(0, 300) },
        { status: 400 },
      );
    }
  }),
});

http.route({
  path: "/askai/health",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    if (!authorized(request)) return new Response("no", { status: 401 });
    return Response.json({
      ok: true,
      ...(await ctx.runQuery(internal.askAi.health, {})),
    });
  }),
});

/**
 * Hermes acts on the ad accounts through here. Any Graph call, the cockpit's
 * own token, everything logged (agentActions.ts). Body:
 * { method: "GET"|"POST"|"DELETE", path: "act_123/campaigns", params: {...},
 *   jobId?: "<the chat job this belongs to>", note?: "<what this is for>",
 *   campaignName?: "<to log into that campaign's thread>" }
 */
http.route({
  path: "/askai/meta",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!authorized(request)) return new Response("no", { status: 401 });
    const body = (await request.json()) as {
      method?: string;
      path?: string;
      params?: Record<string, unknown>;
      jobId?: string;
      note?: string;
      campaignName?: string;
    };
    if (!body?.path || !body?.method)
      return Response.json(
        { ok: false, error: "method and path required" },
        { status: 400 },
      );
    const out = await ctx.runAction(internal.agentActions.meta, {
      method: body.method,
      path: body.path,
      params: body.params,
      jobId: body.jobId,
      note: body.note,
      campaignName: body.campaignName,
    });
    return Response.json(out, { status: out.ok ? 200 : 400 });
  }),
});

/** The ad accounts Hermes may act on, with status. */
http.route({
  path: "/askai/accounts",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    if (!authorized(request)) return new Response("no", { status: 401 });
    return Response.json({
      ok: true,
      accounts: await ctx.runAction(internal.agentActions.accounts, {}),
    });
  }),
});

// --- Outside watchdog ----------------------------------------------------------------------

/**
 * The door for the outside watchdog (api/watchdog.ts, a Vercel cron). Convex
 * runs the crons, the health ledger and the Slack alerts, so nothing inside
 * Convex notices when Convex itself stalls or its crons stop. Vercel calls
 * GET /watchdog every 15 minutes and DMs Aziz when this route does not
 * answer, or answers with stale or failing numbers. See RUNBOOK.md, Watchdog.
 *
 * Guarded by a bearer token (WATCHDOG_TOKEN, the same value on this
 * deployment and on Vercel). The answer is deliberately small: ages, pass or
 * fail, and the names of what is failing with a short, scrubbed error. No
 * client data, no money figures, no personal data.
 */
const WATCHDOG_STALE_MIN = 45;

/** Constant-time check of `Authorization: Bearer <secret>`. */
function sameBearer(header: string | null, secret: string | undefined) {
  if (!secret || !header) return false;
  const want = `Bearer ${secret}`;
  let diff = header.length ^ want.length;
  for (let i = 0; i < Math.max(header.length, want.length); i++)
    diff |= (header.charCodeAt(i) || 0) ^ (want.charCodeAt(i) || 0);
  return diff === 0;
}

/**
 * Capitalised words that belong to error text, not to a client or a person.
 * A run of two or more capitalised words with any other word in it is
 * treated as a name ("Acme Dental", "Mohammed Al Sabah") and hidden.
 */
const PLAIN_WORDS = new Set(
  (
    "error errors uncaught server internal request requests bad not found " +
    "gateway timeout timed out service unavailable too many unauthorized " +
    "forbidden invalid command network connection failed fetch cannot could " +
    "no the this that google sheets sheet docs doc drive calendar meta ads " +
    "graph api convex supabase slack whop tap payments creative triage pulse " +
    "client clients success data hermes mahara media buyer director portal " +
    "management money growth delivery calls call centre center machine team " +
    "expenses cockpit refresh job section smoke check unknown unexpected " +
    "token access rate limit exceeded response body query row rows missing " +
    "empty key secret live test read write budget bridge resend whapi fathom " +
    "sync marketing sales trust and or of in on for to at is was"
  ).split(" "),
);

/**
 * A short error line with anything that could be client, money or personal
 * data taken out. A reply body (JSON or HTML) is cut off, since it can carry
 * rows; links keep their host; emails, secrets, long ids, amounts, long
 * numbers, phone-like numbers, Arabic text, quoted free text and runs of
 * capitalised names are replaced.
 */
function scrub(text: string | undefined | null): string {
  return (
    String(text ?? "")
      .replace(/\s*(?:\{|<[!a-z/]|\[\s*[{["'\d-])[\s\S]*$/i, " [body]")
      .replace(/https?:\/\/([^/\s?#"'()]+)[^\s"'()]*/gi, "$1")
      .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
      .replace(/\bBearer\s+\S+/gi, "Bearer [hidden]")
      .replace(
        /\b(access_token|token|key|secret|password)=\S+/gi,
        "$1=[hidden]",
      )
      .replace(/\b(?:sk|pk|xox[a-z])[-_][\w-]+/gi, "[hidden]")
      // Long ids, but not a host name such as a Convex deployment's.
      .replace(
        /\b(?=[A-Za-z_-]*\d)[A-Za-z0-9_-]{20,}(?![\w-])(?!\.[a-z])/g,
        "[id]",
      )
      // Ids glued to a prefix, such as an ad account "act_1234567890".
      .replace(/(?<=[A-Za-z]_)\d{4,}\b/g, "[id]")
      .replace(
        /(?:[$\u20ac\u00a3]|\b(?:USD|KWD|KD|SAR|AED)\b)\s?-?\d[\d,.]*/gi,
        "[amount]",
      )
      .replace(/\d[\d,.]*\s?(?:USD|KWD|KD|SAR|AED)\b/gi, "[amount]")
      .replace(
        /\+?\d[\d\s().,-]{4,}\d(?!\d*\s?(?:ms|s|secs?|seconds?|min|minutes?|h|hours?)\b)/g,
        "[number]",
      )
      // Four or more digits are a figure, unless they are a duration.
      .replace(
        /\b\d[\d,.]{2,}\d\b(?!\s?(?:ms|s|secs?|seconds?|min|minutes?|h|hours?)\b)/g,
        "[number]",
      )
      .replace(/\p{Script=Arabic}+(?:\s+\p{Script=Arabic}+)*/gu, "[text]")
      .replace(/"([^"]*)"|'([^']*)'/g, (m, a, b) =>
        /^[a-z0-9 _.:/-]{1,40}$/.test(a ?? b ?? "") ? m : '"[text]"',
      )
      .replace(/\b[A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+)+\b/g, m =>
        m.split(/\s+/).every(w => PLAIN_WORDS.has(w.toLowerCase()))
          ? m
          : "[name]",
      )
      .replace(/\s*[\u2013\u2014]\s*/g, ", ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120)
  );
}

const vWatchdogItem = v.object({
  key: v.string(),
  name: v.string(),
  error: v.string(),
});
const vWatchdogFacts = v.object({
  ceo: v.object({
    sections: v.number(),
    newestAt: v.union(v.number(), v.null()),
    jobAt: v.union(v.number(), v.null()),
    failing: v.array(vWatchdogItem),
  }),
  smoke: v.object({
    at: v.union(v.number(), v.null()),
    ok: v.union(v.boolean(), v.null()),
    failing: v.array(vWatchdogItem),
  }),
  sources: v.array(vWatchdogItem),
});
type WatchdogFacts = Infer<typeof vWatchdogFacts>;
type WatchdogItem = Infer<typeof vWatchdogItem>;

const byKey = (a: WatchdogItem, b: WatchdogItem) => a.key.localeCompare(b.key);

/**
 * Raw timestamps only. The ages are worked out in the HTTP action: a query's
 * result can be served from cache while nothing it read has changed, which is
 * exactly the case when the crons have stopped, so `Date.now()` here would
 * freeze.
 */
export const watchdogFacts = internalQuery({
  args: {},
  returns: vWatchdogFacts,
  handler: async (ctx): Promise<WatchdogFacts> => {
    const job = (name: string) =>
      ctx.db
        .query("cronRuns")
        .withIndex("by_job", q => q.eq("job", name))
        .unique();

    const sections = await ctx.db.query("ceoSections").collect();
    const ceoJob = await job("ceo refresh");
    const ceoFailing: WatchdogItem[] = sections
      .filter(s => !s.ok)
      .map(s => ({
        key: s.key,
        name: s.label || s.key,
        error: scrub(s.error) || "failed",
      }));
    if (ceoJob && !ceoJob.ok)
      ceoFailing.push({
        key: "refresh-job",
        name: "CEO refresh job",
        error: scrub(ceoJob.error) || "failed",
      });

    // The smoke check writes one row per cockpit on every run, seconds apart.
    const health = await ctx.db.query("cockpitHealth").collect();
    const smokeAt = health.length ? Math.max(...health.map(h => h.at)) : null;
    const lastRun =
      smokeAt === null ? [] : health.filter(h => h.at >= smokeAt - 600_000);
    const smokeFailing: WatchdogItem[] = lastRun.flatMap(h => {
      const bad = (
        h.checks as { name?: unknown; ok?: unknown; error?: unknown }[]
      )
        .filter(c => !c?.ok)
        .map(c => {
          const check = scrub(String(c?.name ?? "check"));
          return {
            key: `${h.app}.${check}`,
            name: `${h.app} ${check}`,
            error: scrub(String(c?.error ?? "")) || "failed",
          };
        });
      return !h.ok && !bad.length
        ? [{ key: h.app, name: h.app, error: "failed" }]
        : bad;
    });
    const smokeJob = await job("smoke check");
    if (smokeJob && !smokeJob.ok)
      smokeFailing.push({
        key: "smoke-job",
        name: "smoke check job",
        error: scrub(smokeJob.error) || "failed",
      });

    const sources = (await ctx.db.query("sourceHealth").collect())
      .filter(r => !r.ok)
      .map(r => ({
        key: r.source,
        name: RUNBOOK[r.source]?.label ?? r.source,
        error: `${r.streak} in a row: ${scrub(r.lastError) || "no error text"}`,
      }));

    return {
      ceo: {
        sections: sections.length,
        newestAt: sections.length
          ? Math.max(...sections.map(s => s.computedAt))
          : null,
        jobAt: ceoJob?.at ?? null,
        failing: ceoFailing.sort(byKey),
      },
      smoke: {
        at: smokeAt,
        ok:
          smokeAt === null
            ? null
            : lastRun.every(h => h.ok) && smokeJob?.ok !== false,
        failing: smokeFailing.sort(byKey),
      },
      sources: sources.sort(byKey),
    };
  },
});

http.route({
  path: "/watchdog",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    if (
      !sameBearer(
        request.headers.get("authorization"),
        process.env.WATCHDOG_TOKEN,
      )
    )
      return new Response("no", { status: 401 });
    const headers = { "Cache-Control": "no-store" };
    let facts: WatchdogFacts;
    try {
      facts = await ctx.runQuery(internal.http.watchdogFacts, {});
    } catch (e) {
      return Response.json(
        { ok: false, error: scrub(String(e)) || "summary failed" },
        { status: 500, headers },
      );
    }
    const now = Date.now();
    const age = (at: number | null) =>
      at === null ? null : Math.max(0, Math.floor((now - at) / 60_000));
    const fresh = (min: number | null) =>
      min !== null && min <= WATCHDOG_STALE_MIN;
    const refreshAgeMin = age(facts.ceo.newestAt);
    const jobAgeMin = age(facts.ceo.jobAt);
    const smokeAgeMin = age(facts.smoke.at);
    const ok =
      fresh(refreshAgeMin) &&
      (jobAgeMin === null || fresh(jobAgeMin)) &&
      facts.ceo.failing.length === 0 &&
      facts.smoke.ok === true &&
      fresh(smokeAgeMin);
    return Response.json(
      {
        ok,
        staleAfterMin: WATCHDOG_STALE_MIN,
        ceo: {
          refreshAgeMin,
          jobAgeMin,
          sections: facts.ceo.sections,
          failingCount: facts.ceo.failing.length,
          failing: facts.ceo.failing,
        },
        smoke: {
          ok: facts.smoke.ok,
          ageMin: smokeAgeMin,
          failingCount: facts.smoke.failing.length,
          failing: facts.smoke.failing,
        },
        sources: {
          failingCount: facts.sources.length,
          failing: facts.sources,
        },
      },
      { headers },
    );
  }),
});

// --- Live ad previews for the other two cockpits ---------------------------------------------

/**
 * The creative and client success cockpits hold no Meta token, so they ask
 * here when someone opens an ad (their `previews.fresh`). The bearer token is
 * the bridge token that cockpit already uses (CREATIVE_BRIDGE_TOKEN or
 * CSM_BRIDGE_TOKEN here, BRIDGE_TOKEN there), so no new secret is needed.
 * The caller says who is looking; the same role and client access as the
 * portal apply. This door only answers for one ad id: it never passes an
 * arbitrary Graph path through, and it logs no links.
 *
 * Body: { adId: "<digits>", email: "<who is looking>",
 *         cockpit: "creative" | "csm", format?: "<Meta ad_format>" }
 * Answer: a PreviewResult (previews.ts), never cached by the browser.
 */
http.route({
  path: "/bridge/preview",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const header = request.headers.get("authorization");
    const tokenFor = {
      creative: sameBearer(header, process.env.CREATIVE_BRIDGE_TOKEN),
      csm: sameBearer(header, process.env.CSM_BRIDGE_TOKEN),
    };
    if (!tokenFor.creative && !tokenFor.csm)
      return new Response("no", { status: 401 });
    const headers = { "Cache-Control": "no-store" };
    let body: {
      adId?: unknown;
      email?: unknown;
      cockpit?: unknown;
      format?: unknown;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      body = {};
    }
    const adId = typeof body?.adId === "string" ? body.adId : "";
    const email =
      typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const refuse = (message: string, status = 400) =>
      Response.json(
        {
          ok: false,
          adId: adId.slice(0, 30),
          reason: "error",
          message,
        } satisfies PreviewResult,
        { status, headers },
      );
    // The cockpit named in the body must hold that cockpit's token. Checked
    // this way round, so it still works if both cockpits share one token.
    const app =
      body?.cockpit === "creative" && tokenFor.creative
        ? "creative"
        : body?.cockpit === "csm" && tokenFor.csm
          ? "csm"
          : null;
    if (!app) return refuse("The cockpit does not match its token.", 403);
    if (!isMetaId(adId)) return refuse("That is not a Meta ad id.");
    if (!email || email.length > 200 || !email.includes("@"))
      return refuse("Say who is looking (email).");
    const format =
      typeof body?.format === "string" ? body.format.slice(0, 40) : undefined;
    try {
      const out = await previewFor(ctx, {
        adId,
        format,
        caller: app,
        access: { role: app, email },
      });
      return Response.json(out, { headers });
    } catch (e) {
      console.error(`bridge preview (${app}): ${scrub(String(e))}`);
      return Response.json(
        {
          ok: false,
          adId,
          reason: "error",
          message: "The live preview failed on the media buyer side.",
        } satisfies PreviewResult,
        { status: 500, headers },
      );
    }
  }),
});

export default http;
