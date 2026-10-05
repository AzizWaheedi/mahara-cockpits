import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalQuery } from "./_generated/server";
import { sb } from "./billingCore";
import { authenticatedAction } from "./functions";
import {
  cardRow,
  FORMS,
  type FormData,
  type FormKey,
  formsFor,
  type KitsPage,
  LIST_ID,
  missingFields,
  type OnboardingRow,
  optionsOf,
  type Run,
} from "./onboardingCore";
import { hasAccess, seatOf } from "./roles";
import { callTool } from "./tools";

declare const process: { env: Record<string, string | undefined> };

// biome-ignore lint/suspicious/noExplicitAny: ClickUp, Typeform and PostgREST bodies
type Any = any;

/**
 * The CSM's onboarding links and forms per client (Aziz, 2026-10-05), kept in
 * Supabase (cockpit_client_onboarding, migration 20261005a) and rebuilt from
 * the ClickUp card and the Typeforms (onboardingCore.ts) every ten minutes,
 * or for one client when the CSM presses Refresh. Every external call goes
 * through tools.ts; every sync leaves a row in cockpit_client_onboarding_runs
 * and a refresh someone pressed leaves an audit row.
 *
 * Who may see it: anyone with a seat in this cockpit, limited to the clients
 * the portal gave them.
 */

function plain(e: unknown): ConvexError<{ message: string }> {
  if (e instanceof ConvexError) return e as ConvexError<{ message: string }>;
  const raw = e instanceof Error ? e.message : String(e);
  const message =
    raw
      .replace(/^[\s\S]*?Uncaught Error: /, "")
      .split("\n")[0]
      .trim()
      .slice(0, 300) || "That did not work. Try again in a minute.";
  return new ConvexError({ message });
}

async function plainly<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw plain(e);
  }
}

function env(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key)
    throw new Error(
      "The onboarding links cannot be read: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set on the client success deployment. Ask Aziz.",
    );
  return { url, key };
}

type Seat = { email: string; scope: string[] | null };

export const seat = internalQuery({
  args: { userId: v.id("users") },
  returns: v.any(),
  handler: async (ctx, { userId }): Promise<Seat> => {
    const user = await ctx.db.get(userId);
    if (!(await hasAccess(ctx, user?.email)))
      throw new Error(
        "The onboarding links are for client success. Ask Aziz to add you in the portal.",
      );
    const s = await seatOf({ ...ctx, userId });
    return { email: s.email, scope: s.scope ? [...s.scope] : null };
  },
});

// --- reading ClickUp and Typeform -------------------------------------------------

const ID = /^[A-Za-z0-9_-]{1,40}$/;

/** A GET through tools.ts, tried again on a rate limit or a server blip. */
async function get(tool: string, url: string): Promise<Any> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await callTool(tool, { url });
    } catch (e) {
      const m = String((e as Error)?.message ?? e);
      if (attempt < 2 && /HTTP (429|5\d\d)\b/.test(m)) {
        await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
}

const clickup = (path: string) =>
  get("pd_clickup_proxy_get", `https://api.clickup.com/api/v2/${path}`);
const typeform = (path: string) =>
  get("pd_typeform_proxy_get", `https://api.typeform.com/${path}`);

/** Every card on Clients - Mahara, closed ones too. */
async function allCards(): Promise<Any[]> {
  const out: Any[] = [];
  for (let page = 0; page < 20; page++) {
    const r = await clickup(
      `list/${LIST_ID}/task?page=${page}&include_closed=true&subtasks=false&archived=false`,
    );
    const tasks = (r?.tasks ?? []) as Any[];
    out.push(...tasks);
    if (r?.last_page !== false || tasks.length === 0) break;
  }
  return out;
}

/** A form's submitted responses, newest first; `query` narrows them to one card. */
async function responsesOf(formId: string, query?: string): Promise<Any[]> {
  const out: Any[] = [];
  let before = "";
  for (let i = 0; i < 20; i++) {
    const q = new URLSearchParams({ page_size: "1000", completed: "true" });
    if (query) q.set("query", query);
    if (before) q.set("before", before);
    const r = await typeform(`forms/${formId}/responses?${q}`);
    const items = (r?.items ?? []) as Any[];
    out.push(...items);
    if (items.length < 1000) break;
    before = String(items[items.length - 1]?.token ?? "");
    if (!before) break;
  }
  return out;
}

/** Plain words for what went wrong with Typeform, so the screen can say it. */
function typeformProblem(e: unknown): string {
  const m = String((e as Error)?.message ?? e);
  if (/TYPEFORM_TOKEN is not set/.test(m))
    return "The forms cannot be read: TYPEFORM_TOKEN is not set on the client success deployment. Ask Aziz.";
  if (/HTTP (401|403)\b/.test(m))
    return "Typeform refused the key, so the forms' status is from the last good read. Ask Aziz to renew TYPEFORM_TOKEN.";
  return `Typeform did not answer (${m.slice(0, 120)}), so the forms' status is from the last good read.`;
}

async function formData(
  query?: string,
): Promise<{ data: FormData | null; problem: string | null }> {
  try {
    const keys = Object.keys(FORMS) as FormKey[];
    const defs = await Promise.all(
      keys.map(k => typeform(`forms/${FORMS[k]}`)),
    );
    const resp = await Promise.all(keys.map(k => responsesOf(FORMS[k], query)));
    const data: FormData = { definitions: {}, responses: {} };
    keys.forEach((k, i) => {
      data.definitions[k] = defs[i];
      data.responses[k] = resp[i];
    });
    return { data, problem: null };
  } catch (e) {
    return { data: null, problem: typeformProblem(e) };
  }
}

// --- writing Supabase ----------------------------------------------------------------

async function upsert(rows: OnboardingRow[]): Promise<void> {
  const e = env();
  for (let i = 0; i < rows.length; i += 20)
    await sb(
      e.url,
      e.key,
      "cockpit_client_onboarding?on_conflict=clickup_task_id",
      {
        method: "POST",
        body: rows.slice(i, i + 20),
        prefer: "resolution=merge-duplicates,return=minimal",
      },
    );
}

async function startRun(
  trigger: string,
  actor: string | null,
): Promise<number | null> {
  try {
    const e = env();
    const [row] = await sb(e.url, e.key, "cockpit_client_onboarding_runs", {
      method: "POST",
      body: { trigger, actor_email: actor },
      prefer: "return=representation",
    });
    return row?.id ?? null;
  } catch {
    return null;
  }
}

async function finishRun(
  id: number | null,
  ok: boolean,
  counts: Record<string, number>,
  problem: string | null,
): Promise<void> {
  if (id === null) return;
  try {
    const e = env();
    await sb(e.url, e.key, `cockpit_client_onboarding_runs?id=eq.${id}`, {
      method: "PATCH",
      body: {
        finished_at: new Date().toISOString(),
        ok,
        counts,
        problem: problem ? problem.slice(0, 500) : null,
      },
      prefer: "return=minimal",
    });
  } catch {
    // The rows were written or not; a missing run row is the lesser loss.
  }
}

/**
 * Rebuild the rows: every card on the list, or one card (`taskId`). When
 * Typeform cannot be read, the rows keep their last forms rather than lose
 * them, and the run says why.
 */
async function sync(
  trigger: "cron" | "refresh" | "one",
  actor: string | null,
  taskId?: string,
): Promise<{
  ok: boolean;
  problem: string | null;
  counts: Record<string, number>;
}> {
  const run = await startRun(trigger, actor);
  const counts: Record<string, number> = {};
  try {
    if (taskId !== undefined && !ID.test(taskId))
      throw new Error("That is not a ClickUp card id.");
    const now = new Date().toISOString();
    const fieldsBody = await clickup(`list/${LIST_ID}/field`);
    const options = optionsOf(fieldsBody);
    const missing = missingFields(fieldsBody);
    let cards: Any[];
    if (taskId) {
      const t = await clickup(`task/${taskId}`);
      if (String(t?.list?.id ?? "") !== LIST_ID)
        throw new Error("That card is not on the Clients - Mahara list.");
      cards = [t];
    } else cards = await allCards();
    const forms = await formData(taskId);
    const rows = cards
      .filter(t => t?.id && String(t.name ?? "").trim())
      .map(t => {
        const row = cardRow(t, options, now);
        if (forms.data) row.forms = formsFor(row.clickup_task_id, forms.data);
        return row;
      });
    await upsert(rows);
    counts.cards = rows.length;
    counts.in_onboarding = rows.filter(r => r.in_onboarding).length;
    if (forms.data) {
      counts.onboarding_forms = rows.filter(r => r.forms?.onboarding).length;
      counts.kickoff_forms = rows.filter(r => r.forms?.kickoff).length;
      counts.blueprint_forms = rows.filter(r => r.forms?.blueprint).length;
    }
    const problem =
      [
        missing.length
          ? `The card field${missing.length > 1 ? "s" : ""} ${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} not on the Clients - Mahara list any more, so ${missing.length > 1 ? "those links are" : "that link is"} empty. Ask Aziz.`
          : null,
        forms.problem,
      ]
        .filter(Boolean)
        .join(" ") || null;
    await finishRun(run, true, counts, problem);
    return { ok: true, problem, counts };
  } catch (e) {
    const m = String((e as Error)?.message ?? e).slice(0, 400);
    const problem = /CLICKUP_API_TOKEN is not set/.test(m)
      ? "ClickUp cannot be read: CLICKUP_API_TOKEN is not set on the client success deployment. Ask Aziz."
      : /HTTP (401|403)\b.*clickup/i.test(m)
        ? "ClickUp refused the key. Ask Aziz to renew CLICKUP_API_TOKEN."
        : `The update did not finish: ${m}`;
    await finishRun(run, false, counts, problem);
    return { ok: false, problem, counts };
  }
}

/** The cron's job: every card, every ten minutes (crons.ts). */
export const syncAll = internalAction({
  args: {},
  returns: v.any(),
  handler: async () => await sync("cron", null),
});

// --- what the screen reads ------------------------------------------------------------

async function readKits(s: Seat, taskIds: string[]): Promise<KitsPage> {
  const e = env();
  const ids = [...new Set(taskIds.filter(id => ID.test(id)))].slice(0, 200);
  const [rows, last, lastOk] = await Promise.all([
    ids.length
      ? sb(
          e.url,
          e.key,
          `cockpit_client_onboarding?clickup_task_id=in.(${ids.map(encodeURIComponent).join(",")})&select=*`,
        )
      : Promise.resolve([]),
    sb(
      e.url,
      e.key,
      "cockpit_client_onboarding_runs?finished_at=not.is.null&select=started_at,finished_at,ok,problem,trigger&order=started_at.desc&limit=1",
    ),
    sb(
      e.url,
      e.key,
      "cockpit_client_onboarding_runs?ok=is.true&select=started_at,finished_at,ok,problem,trigger&order=started_at.desc&limit=1",
    ),
  ]);
  const scope = s.scope ? new Set(s.scope) : null;
  return {
    rows: (rows as OnboardingRow[]).filter(
      r => !scope || scope.has(String(r.client_name).trim().toLowerCase()),
    ),
    last: (last[0] as Run) ?? null,
    lastOk: (lastOk[0] as Run) ?? null,
    now: new Date().toISOString(),
  };
}

/** The links and forms for these clients, as the last sync saw them. */
export const kits = authenticatedAction({
  args: { taskIds: v.array(v.string()) },
  returns: v.any(),
  handler: (ctx, { taskIds }): Promise<KitsPage> =>
    plainly(async () => {
      const s: Seat = await ctx.runQuery(internal.onboarding.seat, {
        userId: ctx.userId,
      });
      return readKits(s, taskIds);
    }),
});

/**
 * Read one client again now (`taskId`), or every card. Pressed by a CSM after
 * a form went in; leaves an audit row. A second press inside 15 seconds reads
 * what the first one wrote.
 */
export const refresh = authenticatedAction({
  args: { taskId: v.optional(v.string()), taskIds: v.array(v.string()) },
  returns: v.any(),
  handler: (ctx, a): Promise<KitsPage> =>
    plainly(async () => {
      const s: Seat = await ctx.runQuery(internal.onboarding.seat, {
        userId: ctx.userId,
      });
      const e = env();
      if (a.taskId !== undefined && !ID.test(a.taskId))
        throw new Error("That is not a ClickUp card id.");
      const [recent] = await sb(
        e.url,
        e.key,
        `cockpit_client_onboarding_runs?started_at=gte.${encodeURIComponent(new Date(Date.now() - 15_000).toISOString())}&trigger=in.(refresh,one)&select=id&limit=1`,
      );
      let problem: string | null = null;
      if (!recent) {
        const result = a.taskId
          ? await sync("one", s.email, a.taskId)
          : await sync("refresh", s.email);
        problem = result.problem;
        try {
          await sb(e.url, e.key, "cockpit_audit_log", {
            method: "POST",
            body: {
              action: "client_onboarding.refresh",
              entity_type: "cockpit_client_onboarding",
              entity_id: a.taskId ?? "all",
              actor_email: s.email,
              source_app: "client-success",
              source_system: "convex",
              after: { ok: result.ok, counts: result.counts },
              metadata: { problem: result.problem },
            },
            prefer: "return=minimal",
          });
        } catch (err) {
          console.error("audit failed", String(err).slice(0, 200));
        }
      }
      const page = await readKits(s, a.taskIds);
      return { ...page, problem };
    }),
});
