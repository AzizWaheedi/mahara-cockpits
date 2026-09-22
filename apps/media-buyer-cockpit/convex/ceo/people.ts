import { v } from "convex/values";
import { internal } from "../_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { authenticatedAction } from "../functions";
import { googleDirectoryToken } from "../tools";
import {
  COMMISSION_BASES,
  type CommissionBasis,
  commissionRule,
} from "./commission";
import { USD_PER } from "./data/tap";
import { isCeoEmail } from "./gate";
import {
  normaliseSchedule,
  parseSchedule,
  type Schedule,
  scheduleSummary,
} from "./schedule";

declare const process: { env: Record<string, string | undefined> };

/**
 * The people Mahara pays.
 *
 * Nothing in the stack knows who works here. ClickUp time tracking has never
 * recorded an entry, and the bank import's "salaries" category is a bank label
 * whose rows are mostly $6 to $39 card top-ups naming nobody. So this is a
 * roster a person keeps, and it is the single gap that blocks gross margin,
 * real CAC and cost per client.
 *
 * Freelancers and agencies sit beside staff, because to a margin they are the
 * same money. Somebody who leaves is marked inactive rather than deleted: the
 * months they were paid for still happened, and deleting the row would quietly
 * rewrite last quarter's cost.
 *
 * A Google Workspace import is not assumed. The cockpit's service account
 * holds sheets, drive, docs and calendar scopes only, so it cannot list
 * Workspace users; `admin.directory.user.readonly` needs domain-wide
 * delegation configured in the Workspace admin console. The table carries
 * `email` and `source` ready for that, and every row today says `manual`.
 */

const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const TABLE = "cockpit_people";

// biome-ignore lint/suspicious/noExplicitAny: Supabase rows are untyped here
type Row = Record<string, any>;

async function rest(
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {},
): Promise<Row[] | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
      ...(init.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  if (res.status === 404 || text.includes("42P01")) return null;
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 220)}`);
  return text ? JSON.parse(text) : [];
}

export type DirUser = {
  name: string;
  email: string;
  suspended: boolean;
  title: string | null;
};

export type Directory = { ok: boolean; problem?: string; users: DirUser[] };

export type Person = {
  id: number;
  name: string;
  email: string | null;
  role: string | null;
  engagement: "staff" | "freelancer" | "agency" | "intern" | "bot";
  /** False once they have gone. A leaver's paid months still happened. */
  active: boolean;
  /** Set while they are paused: on the team, not being paid this month. */
  pausedOn: string | null;
  pausedWhy: string | null;
  /** On the team and being paid: active, not paused, and a person. */
  working: boolean;
  monthlyCost: number | null;
  currency: string;
  /** monthlyCost in USD at the fixed table, or null when no cost is set. */
  monthlyUsd: number | null;
  /** What the commission is paid on, and the rate: a fraction for the share bases, an amount in `currency` per unit otherwise. */
  commission: { basis: CommissionBasis; rate: number | null };
  /** The share for the share bases, kept for older readers; null for the rest. */
  commissionPct: number | null;
  commissionNote: string | null;
  isSales: boolean;
  startedOn: string | null;
  endedOn: string | null;
  note: string | null;
  /** Working hours, or null when none are set (convex/ceo/schedule.ts). */
  schedule: Schedule | null;
  source: string;
};

export type Roster = {
  people: Person[];
  /** False until the migration has been run. */
  ready: boolean;
  /** Monthly cost of everyone working, in USD. Paused people and bots are out. */
  activeMonthlyUsd: number;
  activeCount: number;
  /** On the team but not being paid this month, so the total is not hiding them. */
  pausedCount: number;
  pausedMonthlyUsd: number;
  /** Shared mailboxes and automations. Never a headcount and never a cost. */
  botCount: number;
  /** Of that, the part belonging to people whose job is selling. */
  salesMonthlyUsd: number;
  /** Active people nobody has costed yet: the total is a floor until they are. */
  missingCost: string[];
};

/**
 * What somebody does. Aziz, 2026-09-22: "what they do should be based on the
 * open roles we even have in the company", and then the list, "and then we can
 * add as well". So this is the offered list, not a closed one: the screen
 * suggests these and still takes anything typed, because a role nobody has
 * named yet is a real role the day it is filled.
 */
export const TEAM_ROLES = [
  "CEO",
  "Systems manager",
  "General VA",
  "Creative strategist",
  "Media buyer",
  "Call centre agent",
  "B2B setter",
  "Closer",
  "Client success manager",
  "Video editor",
  "Bot",
] as const;

const round2 = (x: number) => Math.round(x * 100) / 100;

function shape(r: Row): Person {
  const cost = r.monthly_cost === null ? null : Number(r.monthly_cost);
  const currency = String(r.currency ?? "USD").toUpperCase();
  const rate = USD_PER[currency];
  return {
    id: Number(r.id),
    name: String(r.name),
    email: r.email ? String(r.email) : null,
    role: r.role ? String(r.role) : null,
    engagement: String(r.engagement ?? "staff") as Person["engagement"],
    active: Boolean(r.active),
    pausedOn: r.paused_on ? String(r.paused_on) : null,
    pausedWhy: r.paused_why ? String(r.paused_why) : null,
    working:
      Boolean(r.active) &&
      !r.paused_on &&
      String(r.engagement ?? "staff") !== "bot",
    monthlyCost: cost,
    currency,
    monthlyUsd:
      cost === null || rate === undefined ? null : round2(cost * rate),
    commission: {
      basis: (COMMISSION_BASES as readonly string[]).includes(
        String(r.commission_basis ?? ""),
      )
        ? (String(r.commission_basis) as CommissionBasis)
        : "none",
      rate:
        r.commission_rate === null || r.commission_rate === undefined
          ? null
          : Number(r.commission_rate),
    },
    commissionPct:
      r.commission_pct === null || r.commission_pct === undefined
        ? null
        : Number(r.commission_pct),
    commissionNote: r.commission_note ? String(r.commission_note) : null,
    isSales: Boolean(r.is_sales),
    startedOn: r.started_on ? String(r.started_on) : null,
    endedOn: r.ended_on ? String(r.ended_on) : null,
    note: r.note ? String(r.note) : null,
    schedule: parseSchedule(r.schedule),
    source: String(r.source ?? "manual"),
  };
}

/** The CEO check, for actions, which have no database of their own. */
export const gate = internalQuery({
  args: { userId: v.id("users") },
  returns: v.string(),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    const email = String(user?.email ?? "").toLowerCase();
    if (!isCeoEmail(email)) throw new Error("The CEO cockpit is Aziz's only.");
    return email;
  },
});

/** Everyone, active first, then by name. */
export const list = authenticatedAction({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<Roster> => {
    await ctx.runQuery(internal.ceo.people.gate, { userId: ctx.userId });
    const rows = await rest(`${TABLE}?select=*&order=active.desc,name.asc`);
    if (rows === null)
      return {
        people: [],
        ready: false,
        activeMonthlyUsd: 0,
        activeCount: 0,
        pausedCount: 0,
        pausedMonthlyUsd: 0,
        botCount: 0,
        salesMonthlyUsd: 0,
        missingCost: [],
      };
    const people = rows.map(shape);
    // Three different things, kept apart on purpose: people being paid,
    // people on the team who are paused, and accounts that are not people.
    const working = people.filter(p => p.working);
    const paused = people.filter(
      p => p.active && p.pausedOn && p.engagement !== "bot",
    );
    const cost = (list: Person[]) =>
      round2(list.reduce((n, p) => n + (p.monthlyUsd ?? 0), 0));
    return {
      people,
      ready: true,
      activeCount: working.length,
      activeMonthlyUsd: cost(working),
      pausedCount: paused.length,
      pausedMonthlyUsd: cost(paused),
      botCount: people.filter(p => p.engagement === "bot").length,
      salesMonthlyUsd: cost(working.filter(p => p.isSales)),
      missingCost: working.filter(p => p.monthlyUsd === null).map(p => p.name),
    };
  },
});

const NO_TABLE =
  "The people table does not exist yet. Run supabase/migrations/20260919b_people.sql first.";

/** The word an audit sentence uses for each column save() writes. */
const FIELD_WORD: Record<string, string> = {
  name: "name",
  email: "email",
  role: "role",
  engagement: "engagement",
  paused_on: "pause",
  paused_why: "the reason for the pause",
  monthly_cost: "pay",
  currency: "pay",
  commission_basis: "commission",
  commission_rate: "commission",
  commission_pct: "commission",
  commission_note: "commission note",
  is_sales: "sales flag",
  started_on: "start date",
  note: "note",
  schedule: "hours",
};

/** JSON with keys sorted at every level, so jsonb's key order does not read as a change. */
function stable(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(stable).join(",")}]`;
  if (x && typeof x === "object")
    return `{${Object.keys(x as Row)
      .sort()
      .map(k => `${JSON.stringify(k)}:${stable((x as Row)[k])}`)
      .join(",")}}`;
  return JSON.stringify(x);
}

/** Two cells as the trail compares them: "500.00" from Postgres is 500, and null, "" and absent are one thing. */
function sameCell(a: unknown, b: unknown): boolean {
  const norm = (x: unknown): string => {
    if (x === undefined || x === null || x === "") return "";
    if (typeof x === "object") return stable(x);
    if (typeof x === "boolean") return String(x);
    const n = Number(x);
    return String(x).trim() !== "" && Number.isFinite(n)
      ? String(n)
      : String(x);
  };
  return norm(a) === norm(b);
}

/** The columns save() controls, plus the id, from a row. */
function pick(row: Row, keys: string[]): Row {
  const out: Row = { id: row.id };
  for (const k of keys) if (k in row) out[k] = row[k];
  return out;
}

/**
 * The sentence in the trail: "Added Nada to the roster as staff", "Changed
 * Nada's pay and hours (hours now Sat to Thu 10:00 to 18:00, 48 h a week)".
 */
function saveSentence(
  name: string,
  before: Row | null,
  body: Row,
  hours: Schedule | null | undefined,
): string {
  if (!before)
    return `Added ${name} to the roster as ${body.engagement}${hours ? ` with hours ${scheduleSummary(hours)}` : ""}`;
  const words: string[] = [];
  for (const k of Object.keys(body)) {
    const w = FIELD_WORD[k];
    if (w && !sameCell(before[k], body[k]) && !words.includes(w)) words.push(w);
  }
  if (!words.length) return `Saved ${name} with nothing changed`;
  const list =
    words.length === 1
      ? words[0]
      : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
  const hoursNow = !words.includes("hours")
    ? ""
    : hours
      ? ` (hours now ${scheduleSummary(hours)})`
      : " (hours cleared)";
  return `Changed ${name}'s ${list}${hoursNow}`;
}

/**
 * Add somebody, or change what is recorded about them.
 *
 * Passing an id edits that row. Leaving it out adds a person. Nothing is ever
 * deleted here: see `setActive`. Every save leaves a row in ceoAudit through
 * `record`, with the columns before and after, beside every other CEO write.
 */
export const save = authenticatedAction({
  args: {
    id: v.optional(v.number()),
    name: v.string(),
    email: v.optional(v.string()),
    role: v.optional(v.string()),
    engagement: v.union(
      v.literal("staff"),
      v.literal("freelancer"),
      v.literal("agency"),
      v.literal("intern"),
      // A shared mailbox or an automation. Never a headcount, never a cost.
      v.literal("bot"),
    ),
    /** A day to pause from, or null to put them back on. */
    pausedOn: v.optional(v.union(v.string(), v.null())),
    pausedWhy: v.optional(v.union(v.string(), v.null())),
    monthlyCost: v.optional(v.number()),
    currency: v.optional(v.string()),
    /** The old form: a share of what they close. Ignored when commissionBasis is given. */
    commissionPct: v.optional(v.number()),
    commissionBasis: v.optional(
      v.union(...COMMISSION_BASES.map(b => v.literal(b))),
    ),
    /** A fraction for the share bases, an amount in the person's currency otherwise. */
    commissionRate: v.optional(v.number()),
    commissionNote: v.optional(v.string()),
    isSales: v.optional(v.boolean()),
    startedOn: v.optional(v.string()),
    note: v.optional(v.string()),
    /**
     * Working hours (convex/ceo/schedule.ts). Left out, the column stays as it
     * is; null clears it; anything else is checked by normaliseSchedule first.
     */
    schedule: v.optional(v.any()),
  },
  returns: v.any(),
  handler: async (ctx, a): Promise<{ ok: true; id: number }> => {
    const email: string = await ctx.runQuery(internal.ceo.people.gate, {
      userId: ctx.userId,
    });
    const name = a.name.trim();
    if (!name) throw new Error("A person needs a name.");
    if (a.monthlyCost !== undefined && a.monthlyCost < 0)
      throw new Error("A monthly cost cannot be below zero.");
    if (
      a.commissionPct !== undefined &&
      (a.commissionPct < 0 || a.commissionPct > 1)
    )
      throw new Error("Commission is a share between 0 and 1, so 0.1 is 10%.");
    // The rule: what it is paid on, then the rate in the unit that basis takes.
    const rule = commissionRule({
      basis: a.commissionBasis,
      rate: a.commissionRate,
      pct: a.commissionPct,
    });
    if (a.startedOn && !/^\d{4}-\d{2}-\d{2}$/.test(a.startedOn))
      throw new Error("A start date looks like 2026-09-19.");
    const hours: Schedule | null | undefined =
      a.schedule === undefined
        ? undefined
        : a.schedule === null
          ? null
          : normaliseSchedule(a.schedule);

    const body: Row = {
      name,
      email: a.email?.trim() || null,
      role: a.role?.trim() || null,
      engagement: a.engagement,
      monthly_cost: a.monthlyCost ?? null,
      currency: (a.currency ?? "USD").toUpperCase(),
      commission_basis: rule.basis,
      commission_rate: rule.rate,
      // Mirrored for anything that still reads the percent.
      commission_pct: rule.pct,
      commission_note: a.commissionNote?.trim().slice(0, 500) || null,
      is_sales: a.isSales ?? false,
      started_on: a.startedOn || null,
      note: a.note?.trim().slice(0, 500) || null,
      // Left out, a pause stays as it is; null puts them back on.
      ...(a.pausedOn === undefined ? {} : { paused_on: a.pausedOn || null }),
      ...(a.pausedWhy === undefined
        ? {}
        : { paused_why: a.pausedWhy?.trim().slice(0, 300) || null }),
      // A bot is never paid, whatever was typed in the cost box.
      ...(a.engagement === "bot"
        ? { monthly_cost: null, is_sales: false, paused_on: null }
        : {}),
      source: "manual",
      added_by: email,
      ...(hours === undefined ? {} : { schedule: hours }),
    };

    // The row as it was, for the trail. An id nobody has is refused here
    // rather than patched into nothing.
    let before: Row | null = null;
    if (a.id !== undefined) {
      const found = await rest(`${TABLE}?id=eq.${a.id}&select=*`);
      if (found === null) throw new Error(NO_TABLE);
      if (!found.length) throw new Error("Nobody on the roster has that id.");
      before = found[0];
    }

    const done =
      a.id === undefined
        ? await rest(TABLE, {
            method: "POST",
            prefer: "return=representation",
            body: [body],
          })
        : await rest(`${TABLE}?id=eq.${a.id}`, {
            method: "PATCH",
            prefer: "return=representation",
            body,
          });
    if (done === null) throw new Error(NO_TABLE);
    const id = Number(done[0]?.id ?? a.id ?? 0);
    const after = done[0] ?? null;
    const keys = Object.keys(body).filter(
      k => k !== "added_by" && k !== "source",
    );
    await ctx.runMutation(internal.ceo.people.record, {
      action: before ? "people.edit" : "people.add",
      rowId: String(id),
      what: saveSentence(name, before, body, hours),
      ...(before ? { before: pick(before, keys) } : {}),
      ...(after ? { after: pick(after, keys) } : {}),
      by: email,
    });
    return { ok: true, id };
  },
});

/**
 * One trail row per save, in ceoAudit beside every other CEO write, so a
 * change to somebody's pay, commission or hours can be traced to a person and
 * a moment. The Supabase row itself only says who saved it last.
 */
export const record = internalMutation({
  args: {
    action: v.string(),
    rowId: v.string(),
    what: v.string(),
    before: v.optional(v.any()),
    after: v.optional(v.any()),
    by: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, a) => {
    await ctx.db.insert("ceoAudit", {
      action: a.action,
      table: TABLE,
      rowId: a.rowId,
      what: a.what.slice(0, 400),
      before: a.before,
      after: a.after,
      by: a.by,
      at: Date.now(),
    });
    return null;
  },
});

/**
 * Remove a row entirely. Only for a mistake.
 *
 * Somebody who actually worked here is marked inactive, never deleted, because
 * the months they were paid for still happened. This exists for the other
 * case: a name typed wrong, or a person added twice. It refuses once any
 * payroll month references the row, which is the line between a typo and a
 * record of money.
 */
export const remove = authenticatedAction({
  args: { id: v.number() },
  returns: v.any(),
  handler: async (ctx, { id }): Promise<{ ok: true }> => {
    await ctx.runQuery(internal.ceo.people.gate, { userId: ctx.userId });
    const history = await rest(
      `cockpit_payroll_months?person_id=eq.${id}&select=id&limit=1`,
    );
    if (history === null)
      throw new Error(
        "The people table does not exist yet. Run supabase/migrations/20260919b_people.sql first.",
      );
    if (history.length)
      throw new Error(
        "This person already has payroll months recorded against them, so deleting the row would rewrite a past cost. Mark them as gone instead.",
      );
    const gone = await rest(`${TABLE}?id=eq.${id}`, { method: "DELETE" });
    if (gone === null) throw new Error("Could not reach the people table.");
    return { ok: true };
  },
});

/**
 * Mark somebody as gone, or bring them back.
 *
 * Never a delete. The months they were paid for still happened, and removing
 * the row would rewrite a past cost that was real at the time.
 */
export const setActive = authenticatedAction({
  args: {
    id: v.number(),
    active: v.boolean(),
    /** The day they left, when marking somebody gone. */
    endedOn: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, { id, active, endedOn }): Promise<{ ok: true }> => {
    await ctx.runQuery(internal.ceo.people.gate, { userId: ctx.userId });
    if (endedOn && !/^\d{4}-\d{2}-\d{2}$/.test(endedOn))
      throw new Error("A leaving date looks like 2026-09-19.");
    const done = await rest(`${TABLE}?id=eq.${id}`, {
      method: "PATCH",
      prefer: "return=representation",
      body: active
        ? { active: true, ended_on: null }
        : { active: false, ended_on: endedOn || null },
    });
    if (done === null)
      throw new Error(
        "The people table does not exist yet. Run supabase/migrations/20260919b_people.sql first.",
      );
    return { ok: true };
  },
});

/**
 * The Workspace directory, when domain-wide delegation allows it.
 *
 * Returns everyone the directory lists with their name, address and whether
 * the account is suspended, so the roster can be seeded and so somebody who
 * has left Workspace but is still on payroll stands out.
 */
export const directory = internalAction({
  args: {},
  returns: v.any(),
  handler: async (): Promise<{
    ok: boolean;
    problem?: string;
    users: {
      name: string;
      email: string;
      suspended: boolean;
      title: string | null;
    }[];
  }> => {
    try {
      const token = await googleDirectoryToken();
      const out: {
        name: string;
        email: string;
        suspended: boolean;
        title: string | null;
      }[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < 10; page++) {
        const url = new URL(
          "https://admin.googleapis.com/admin/directory/v1/users",
        );
        url.searchParams.set("customer", "my_customer");
        url.searchParams.set("maxResults", "200");
        url.searchParams.set("orderBy", "email");
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${token}` },
        });
        const text = await res.text();
        if (!res.ok)
          return {
            ok: false,
            problem: `Workspace refused the directory read (${res.status}): ${text.slice(0, 200)}`,
            users: [],
          };
        const json = JSON.parse(text) as Row;
        for (const u of (json.users ?? []) as Row[])
          out.push({
            name: String(u.name?.fullName ?? u.primaryEmail ?? ""),
            email: String(u.primaryEmail ?? ""),
            suspended: Boolean(u.suspended),
            title: u.organizations?.[0]?.title
              ? String(u.organizations[0].title)
              : null,
          });
        pageToken = json.nextPageToken ? String(json.nextPageToken) : undefined;
        if (!pageToken) break;
      }
      return { ok: true, users: out };
    } catch (e) {
      return {
        ok: false,
        problem: String(e instanceof Error ? e.message : e).slice(0, 220),
        users: [],
      };
    }
  },
});

/**
 * Add Workspace people who are not on the roster yet.
 *
 * Seeding only. It never edits somebody already there, never sets a cost, and
 * never removes anybody: an account existing in Workspace says a person has a
 * login, not what they are paid or whether they are still engaged. Everyone
 * arrives as staff with no cost, which is what makes them show up under
 * "nobody has costed yet" until a figure is typed.
 *
 * Matching is by email first, then by folded name, so somebody added by hand
 * before the import existed is recognised rather than duplicated.
 */
export const importWorkspace = authenticatedAction({
  args: { emails: v.optional(v.array(v.string())) },
  returns: v.any(),
  handler: async (
    ctx,
    { emails },
  ): Promise<{ added: string[]; alreadyThere: number; problem?: string }> => {
    const by: string = await ctx.runQuery(internal.ceo.people.gate, {
      userId: ctx.userId,
    });
    const dir: Directory = await ctx.runAction(
      internal.ceo.people.directory,
      {},
    );
    if (!dir.ok) return { added: [], alreadyThere: 0, problem: dir.problem };

    const existing = await rest(`${TABLE}?select=name,email`);
    if (existing === null)
      throw new Error(
        "The people table does not exist yet. Run supabase/migrations/20260919b_people.sql first.",
      );
    const fold = (s: unknown) =>
      String(s ?? "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]/gu, "");
    const haveEmail = new Set(
      existing.map(r => String(r.email ?? "").toLowerCase()).filter(Boolean),
    );
    const haveName = new Set(existing.map(r => fold(r.name)));

    const pick = emails?.length
      ? new Set(emails.map(e => e.toLowerCase()))
      : null;
    const wanted = dir.users.filter(
      u =>
        !u.suspended &&
        (!pick || pick.has(u.email.toLowerCase())) &&
        !haveEmail.has(u.email.toLowerCase()) &&
        !haveName.has(fold(u.name)),
    );
    if (!wanted.length)
      return { added: [], alreadyThere: dir.users.length - wanted.length };

    const done = await rest(TABLE, {
      method: "POST",
      prefer: "return=representation",
      body: wanted.map(u => ({
        name: u.name || u.email,
        email: u.email,
        role: u.title,
        engagement: "staff",
        monthly_cost: null,
        currency: "USD",
        is_sales: false,
        source: "workspace",
        added_by: by,
      })),
    });
    if (done === null) throw new Error("Could not reach the people table.");
    return {
      added: wanted.map(u => u.name || u.email),
      alreadyThere: dir.users.length - wanted.length,
    };
  },
});

/** The Workspace directory, for the screen. */
export const workspace = authenticatedAction({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<Directory> => {
    await ctx.runQuery(internal.ceo.people.gate, { userId: ctx.userId });
    return await ctx.runAction(internal.ceo.people.directory, {});
  },
});

/** The roles the screen offers, in hiring order. Anything typed is still kept. */
export const roles = authenticatedAction({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    await ctx.runQuery(internal.ceo.people.gate, { userId: ctx.userId });
    const rows = await rest(`${TABLE}?select=role`);
    const used = new Set(
      (rows ?? [])
        .map(r => String(r.role ?? "").trim())
        .filter(Boolean)
        .filter(
          r => !TEAM_ROLES.some(t => t.toLowerCase() === r.toLowerCase()),
        ),
    );
    // Whatever Aziz has already typed sits after the offered list, so the
    // roster never loses a role by not having been asked for.
    return [...TEAM_ROLES, ...[...used].sort()];
  },
});
