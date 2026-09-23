import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { authenticatedAction } from "../functions";
import { rest } from "./sbWrite";

declare const process: { env: Record<string, string | undefined> };

/**
 * The file on a person: who they are, how to work with them, and the
 * scorecard the one-to-one is run from.
 *
 * Aziz, 2026-09-22: "I need to expand the management section so I could have
 * a profile on each team member... their personal goals, professional goals,
 * their red flags and green flags, things to do, things to not do based on
 * their personality, extra notes, a place to save their CV and contract...
 * grade them from 1 to 10 on skill, will and culture fit... based on the role
 * that they have, their own specific scorecard that we go over each month in
 * their one-to-one."
 *
 * Two decisions worth writing down.
 *
 * A scorecard carries its own copy of the accountabilities it was graded on.
 * Editing a role's template must never rewrite a month that has already been
 * reviewed and signed, so the template is the starting point and the
 * scorecard is the record.
 *
 * A new month starts as a copy of the last one, grades cleared and comments
 * kept. The conversation continues instead of restarting, and last month's
 * comment sits next to this month's grade where it belongs.
 *
 * CVs and contracts live in a private Supabase Storage bucket. The cockpit
 * hands out signed links that expire in ten minutes and never a public URL,
 * and the file itself never passes through a payload.
 */

// biome-ignore lint/suspicious/noExplicitAny: Supabase rows and jsonb
type Any = Record<string, any>;

const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const BUCKET = "cockpit-people";
const MAX_BYTES = 8 * 1024 * 1024;
const MONTH = /^\d{4}-\d{2}$/;

/** "Client success manager" → "client-success-manager". */
export function roleKeyOf(role: string | null | undefined): string {
  return String(role ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function storage(
  path: string,
  init: {
    method?: string;
    body?: BodyInit;
    contentType?: string;
    json?: unknown;
  } = {},
): Promise<Response> {
  if (!SUPABASE_URL || !SUPABASE_KEY)
    throw new Error("Supabase is not configured on this deployment.");
  return fetch(`${SUPABASE_URL}/storage/v1/${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      ...(init.json !== undefined
        ? { "Content-Type": "application/json" }
        : init.contentType
          ? { "Content-Type": init.contentType }
          : {}),
    },
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
}

/** Make the private bucket the first time a file is saved, not by hand. */
async function ensureBucket(): Promise<void> {
  const res = await storage(`bucket/${BUCKET}`);
  if (res.ok) return;
  const made = await storage("bucket", {
    method: "POST",
    json: { id: BUCKET, name: BUCKET, public: false },
  });
  if (!made.ok) {
    const text = await made.text();
    // A race between two uploads is fine; anything else is not.
    if (!text.includes("already exists"))
      throw new Error(`Could not create the file store: ${text.slice(0, 160)}`);
  }
}

export const record = internalMutation({
  args: {
    action: v.string(),
    rowId: v.string(),
    what: v.string(),
    after: v.any(),
    by: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, a) => {
    await ctx.db.insert("ceoAudit", {
      action: a.action,
      table: "cockpit_people",
      rowId: a.rowId,
      what: a.what,
      before: {},
      after: a.after,
      by: a.by,
      at: Date.now(),
    });
    return null;
  },
});

export type Profile = {
  personId: number;
  personalGoals: string;
  professionalGoals: string;
  greenFlags: string;
  redFlags: string;
  doThis: string;
  dontDoThis: string;
  notes: string;
  skill: number | null;
  will: number | null;
  culture: number | null;
  gradesNote: string;
  updatedBy: string | null;
  updatedAt: string | null;
};

export type PersonFile = {
  id: number;
  kind: "cv" | "contract" | "other";
  name: string;
  sizeBytes: number | null;
  mime: string | null;
  uploadedBy: string;
  uploadedAt: string;
};

export type ScorecardItem = {
  key: string;
  accountability: string;
  lookingAt: string[];
  scale: { a: string; b: string; c: string; d: string };
  prompts: string[];
  grade: "A" | "B" | "C" | "D" | null;
  comment: string;
};

export type Scorecard = {
  id: number | null;
  personId: number;
  month: string;
  roleKey: string;
  title: string;
  mission: string;
  items: ScorecardItem[];
  overall: "A" | "B" | "C" | "D" | null;
  summary: string;
  reviewedOn: string | null;
  reviewedBy: string | null;
  status: "draft" | "final";
  competencies: string[];
  bonus: string | null;
  /** True when this is a new card the screen has not saved yet. */
  fresh: boolean;
  /** The month it was started from, when it was. */
  startedFrom: string | null;
};

const emptyProfile = (personId: number): Profile => ({
  personId,
  personalGoals: "",
  professionalGoals: "",
  greenFlags: "",
  redFlags: "",
  doThis: "",
  dontDoThis: "",
  notes: "",
  skill: null,
  will: null,
  culture: null,
  gradesNote: "",
  updatedBy: null,
  updatedAt: null,
});

function toProfile(r: Any): Profile {
  return {
    personId: Number(r.person_id),
    personalGoals: String(r.personal_goals ?? ""),
    professionalGoals: String(r.professional_goals ?? ""),
    greenFlags: String(r.green_flags ?? ""),
    redFlags: String(r.red_flags ?? ""),
    doThis: String(r.do_this ?? ""),
    dontDoThis: String(r.dont_do_this ?? ""),
    notes: String(r.notes ?? ""),
    skill: r.skill === null ? null : Number(r.skill),
    will: r.will === null ? null : Number(r.will),
    culture: r.culture === null ? null : Number(r.culture),
    gradesNote: String(r.grades_note ?? ""),
    updatedBy: r.updated_by ? String(r.updated_by) : null,
    updatedAt: r.updated_at ? String(r.updated_at) : null,
  };
}

function itemsFromTemplate(t: Any): ScorecardItem[] {
  return ((t?.items ?? []) as Any[]).map(i => ({
    key: String(i.key),
    accountability: String(i.accountability ?? ""),
    lookingAt: Array.isArray(i.lookingAt) ? i.lookingAt.map(String) : [],
    scale: {
      a: String(i.scale?.a ?? ""),
      b: String(i.scale?.b ?? ""),
      c: String(i.scale?.c ?? ""),
      d: String(i.scale?.d ?? ""),
    },
    prompts: Array.isArray(i.prompts) ? i.prompts.map(String) : [],
    grade: null,
    comment: "",
  }));
}

export type PersonPage = {
  person: Any | null;
  profile: Profile;
  files: PersonFile[];
  scorecard: Scorecard | null;
  months: { month: string; overall: string | null; status: string }[];
  templateRoles: { roleKey: string; title: string }[];
};

/**
 * Everything the person's page shows, in one read. Kept out of the action so
 * the harness can build the same page without a signed-in user.
 */
export async function personPage(
  personId: number,
  month?: string,
): Promise<PersonPage> {
  const [people, profiles, files, cards, templates] = await Promise.all([
    rest(`cockpit_people?id=eq.${personId}&select=*`),
    rest(`cockpit_person_profiles?person_id=eq.${personId}&select=*`),
    rest(
      `cockpit_person_files?person_id=eq.${personId}&select=*&order=uploaded_at.desc`,
    ),
    rest(
      `cockpit_scorecards?person_id=eq.${personId}&select=*&order=month.desc`,
    ),
    rest("cockpit_scorecard_templates?select=role_key,title&order=title"),
  ]);
  {
    const person = people?.[0] ?? null;
    const profile = profiles?.[0]
      ? toProfile(profiles[0])
      : emptyProfile(personId);
    const askedFor = month && MONTH.test(month) ? month : thisMonth();
    const scorecard = await buildScorecard(personId, askedFor, person, cards);
    return {
      person,
      profile,
      files: (files ?? []).map(f => ({
        id: Number(f.id),
        kind: f.kind,
        name: String(f.name),
        sizeBytes: f.size_bytes === null ? null : Number(f.size_bytes),
        mime: f.mime ? String(f.mime) : null,
        uploadedBy: String(f.uploaded_by),
        uploadedAt: String(f.uploaded_at),
      })),
      scorecard,
      months: (cards ?? []).map(c => ({
        month: String(c.month),
        overall: c.overall ? String(c.overall) : null,
        status: String(c.status),
      })),
      templateRoles: (templates ?? []).map(t => ({
        roleKey: String(t.role_key),
        title: String(t.title),
      })),
    };
  }
}

/** Everything the person's page shows, in one read. */
export const page = authenticatedAction({
  args: { personId: v.number(), month: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, a): Promise<PersonPage> => {
    await ctx.runQuery(internal.ceo.windows.gate, { userId: ctx.userId });
    return personPage(a.personId, a.month);
  },
});

function thisMonth(): string {
  return new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 7);
}

/**
 * The scorecard for a month: the saved one, or a fresh one built from last
 * month's card, or from the role's template when there is no last month.
 */
async function buildScorecard(
  personId: number,
  month: string,
  person: Any | null,
  cards: Any[] | null,
): Promise<Scorecard | null> {
  const saved = (cards ?? []).find(c => String(c.month) === month);
  const roleKey = saved
    ? String(saved.role_key)
    : roleKeyOf(person?.role ?? "");
  const template: Any | undefined = (
    await rest(
      `cockpit_scorecard_templates?role_key=eq.${encodeURIComponent(roleKey)}&select=*`,
    )
  )?.[0];

  if (saved)
    return {
      id: Number(saved.id),
      personId,
      month,
      roleKey,
      title: String(saved.title ?? template?.title ?? roleKey),
      mission: String(saved.mission ?? ""),
      items: (saved.items ?? []) as ScorecardItem[],
      overall: saved.overall ?? null,
      summary: String(saved.summary ?? ""),
      reviewedOn: saved.reviewed_on ? String(saved.reviewed_on) : null,
      reviewedBy: saved.reviewed_by ? String(saved.reviewed_by) : null,
      status: saved.status,
      competencies: (template?.competencies ?? []) as string[],
      bonus: template?.bonus ? String(template.bonus) : null,
      fresh: false,
      startedFrom: null,
    };

  // No card for this month yet. Last month's is the better starting point,
  // because the comments on it are what the conversation continues from.
  const previous: Any | undefined = (cards ?? [])
    .filter(c => String(c.month) < month)
    .sort((x, y) => String(y.month).localeCompare(String(x.month)))[0];
  if (!previous && !template) return null;

  const items: ScorecardItem[] = previous
    ? ((previous.items ?? []) as ScorecardItem[]).map(i => ({
        ...i,
        grade: null,
        comment: "",
      }))
    : itemsFromTemplate(template ?? {});

  return {
    id: null,
    personId,
    month,
    roleKey: previous ? String(previous.role_key) : roleKey,
    title: String(previous?.title ?? template?.title ?? roleKey),
    mission: String(previous?.mission ?? template?.mission ?? ""),
    items,
    overall: null,
    summary: "",
    reviewedOn: null,
    reviewedBy: null,
    status: "draft",
    competencies: (template?.competencies ?? []) as string[],
    bonus: template?.bonus ? String(template.bonus) : null,
    fresh: true,
    startedFrom: previous ? String(previous.month) : null,
  };
}

export const saveProfile = authenticatedAction({
  args: {
    personId: v.number(),
    personalGoals: v.string(),
    professionalGoals: v.string(),
    greenFlags: v.string(),
    redFlags: v.string(),
    doThis: v.string(),
    dontDoThis: v.string(),
    notes: v.string(),
    skill: v.optional(v.number()),
    will: v.optional(v.number()),
    culture: v.optional(v.number()),
    gradesNote: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, a): Promise<{ ok: true }> => {
    const by: string = await ctx.runQuery(internal.ceo.windows.gate, {
      userId: ctx.userId,
    });
    const grade = (x: number | undefined) =>
      x === undefined || x === null
        ? null
        : Math.max(1, Math.min(10, Math.round(x)));
    const body = {
      person_id: a.personId,
      personal_goals: a.personalGoals.trim() || null,
      professional_goals: a.professionalGoals.trim() || null,
      green_flags: a.greenFlags.trim() || null,
      red_flags: a.redFlags.trim() || null,
      do_this: a.doThis.trim() || null,
      dont_do_this: a.dontDoThis.trim() || null,
      notes: a.notes.trim() || null,
      skill: grade(a.skill),
      will: grade(a.will),
      culture: grade(a.culture),
      grades_note: a.gradesNote.trim() || null,
      updated_by: by,
      updated_at: new Date().toISOString(),
    };
    await rest("cockpit_person_profiles?on_conflict=person_id", {
      method: "POST",
      body,
      prefer: "resolution=merge-duplicates,return=minimal",
    });
    await ctx.runMutation(internal.ceo.profiles.record, {
      action: "people.profile",
      rowId: String(a.personId),
      what: `Wrote the profile on person ${a.personId}`,
      after: { skill: body.skill, will: body.will, culture: body.culture },
      by,
    });
    return { ok: true };
  },
});

export const saveScorecard = authenticatedAction({
  args: {
    personId: v.number(),
    month: v.string(),
    roleKey: v.string(),
    title: v.string(),
    mission: v.string(),
    items: v.array(v.any()),
    overall: v.optional(v.string()),
    summary: v.string(),
    status: v.union(v.literal("draft"), v.literal("final")),
    reviewedOn: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, a): Promise<{ id: number }> => {
    const by: string = await ctx.runQuery(internal.ceo.windows.gate, {
      userId: ctx.userId,
    });
    if (!MONTH.test(a.month)) throw new Error("That is not a month.");
    const overall =
      a.overall && ["A", "B", "C", "D"].includes(a.overall) ? a.overall : null;
    if (a.status === "final" && !overall)
      throw new Error("Give an overall grade before marking it final.");
    const body = {
      person_id: a.personId,
      month: a.month,
      role_key: a.roleKey,
      title: a.title.trim() || a.roleKey,
      mission: a.mission.trim() || null,
      items: a.items,
      overall,
      summary: a.summary.trim() || null,
      reviewed_on:
        a.reviewedOn ||
        (a.status === "final"
          ? new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10)
          : null),
      reviewed_by: a.status === "final" ? by : null,
      status: a.status,
      created_by: by,
      updated_at: new Date().toISOString(),
    };
    const rows = await rest("cockpit_scorecards?on_conflict=person_id,month", {
      method: "POST",
      body,
      prefer: "resolution=merge-duplicates,return=representation",
    });
    const id = Number(rows?.[0]?.id);
    await ctx.runMutation(internal.ceo.profiles.record, {
      action: "people.scorecard",
      rowId: String(a.personId),
      what: `${a.status === "final" ? "Signed off" : "Saved"} the ${a.month} scorecard for person ${a.personId}${overall ? `, overall ${overall}` : ""}`,
      after: { month: a.month, overall, status: a.status },
      by,
    });
    return { id };
  },
});

// --- the role templates ----------------------------------------------------

export const templates = authenticatedAction({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<Any[]> => {
    await ctx.runQuery(internal.ceo.windows.gate, { userId: ctx.userId });
    const rows =
      (await rest("cockpit_scorecard_templates?select=*&order=title")) ?? [];
    return rows.map(t => ({
      roleKey: String(t.role_key),
      title: String(t.title),
      mission: String(t.mission ?? ""),
      items: t.items ?? [],
      competencies: t.competencies ?? [],
      bonus: t.bonus ? String(t.bonus) : null,
      updatedBy: t.updated_by ? String(t.updated_by) : null,
      updatedAt: t.updated_at ? String(t.updated_at) : null,
    }));
  },
});

export const saveTemplate = authenticatedAction({
  args: {
    roleKey: v.string(),
    title: v.string(),
    mission: v.string(),
    items: v.array(v.any()),
    competencies: v.array(v.string()),
    bonus: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, a): Promise<{ ok: true }> => {
    const by: string = await ctx.runQuery(internal.ceo.windows.gate, {
      userId: ctx.userId,
    });
    const roleKey = roleKeyOf(a.roleKey);
    if (!roleKey) throw new Error("A scorecard needs a role.");
    await rest("cockpit_scorecard_templates?on_conflict=role_key", {
      method: "POST",
      body: {
        role_key: roleKey,
        title: a.title.trim() || roleKey,
        mission: a.mission.trim() || null,
        items: a.items,
        competencies: a.competencies,
        bonus: a.bonus?.trim() || null,
        updated_by: by,
        updated_at: new Date().toISOString(),
      },
      prefer: "resolution=merge-duplicates,return=minimal",
    });
    await ctx.runMutation(internal.ceo.profiles.record, {
      action: "people.template",
      rowId: roleKey,
      what: `Changed the ${a.title} scorecard`,
      after: { items: a.items.length },
      by,
    });
    return { ok: true };
  },
});

// --- files -----------------------------------------------------------------

export const uploadFile = authenticatedAction({
  args: {
    personId: v.number(),
    kind: v.union(v.literal("cv"), v.literal("contract"), v.literal("other")),
    name: v.string(),
    mime: v.string(),
    base64: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, a): Promise<{ id: number; name: string }> => {
    const by: string = await ctx.runQuery(internal.ceo.windows.gate, {
      userId: ctx.userId,
    });
    const name = a.name.trim().slice(0, 160) || "file";
    const bytes = Uint8Array.from(atob(a.base64), c => c.charCodeAt(0));
    if (bytes.length > MAX_BYTES)
      throw new Error(
        `That file is ${(bytes.length / 1024 / 1024).toFixed(1)} MB. Keep it under 8 MB.`,
      );
    await ensureBucket();
    const safe = name.replace(/[^\w.-]+/g, "_");
    const path = `${a.personId}/${Date.now()}-${safe}`;
    const put = await storage(`object/${BUCKET}/${path}`, {
      method: "POST",
      body: bytes as unknown as BodyInit,
      contentType: a.mime || "application/octet-stream",
    });
    if (!put.ok)
      throw new Error(
        `The file did not save: ${(await put.text()).slice(0, 160)}`,
      );
    const rows = await rest("cockpit_person_files", {
      method: "POST",
      body: {
        person_id: a.personId,
        kind: a.kind,
        name,
        path,
        size_bytes: bytes.length,
        mime: a.mime || null,
        uploaded_by: by,
      },
      prefer: "return=representation",
    });
    const id = Number(rows?.[0]?.id);
    await ctx.runMutation(internal.ceo.profiles.record, {
      action: "people.file",
      rowId: String(a.personId),
      what: `Saved a ${a.kind === "cv" ? "CV" : a.kind === "contract" ? "contract" : "file"} on person ${a.personId}: ${name}`,
      after: { id, bytes: bytes.length },
      by,
    });
    return { id, name };
  },
});

/** A link that opens the file and stops working ten minutes later. */
export const fileUrl = authenticatedAction({
  args: { id: v.number() },
  returns: v.any(),
  handler: async (ctx, a): Promise<{ url: string }> => {
    await ctx.runQuery(internal.ceo.windows.gate, { userId: ctx.userId });
    const row = (
      await rest(`cockpit_person_files?id=eq.${a.id}&select=path`)
    )?.[0];
    if (!row) throw new Error("No such file.");
    const res = await storage(`object/sign/${BUCKET}/${row.path}`, {
      method: "POST",
      json: { expiresIn: 600 },
    });
    if (!res.ok)
      throw new Error(`Could not open it: ${(await res.text()).slice(0, 160)}`);
    const json = (await res.json()) as { signedURL?: string };
    if (!json.signedURL) throw new Error("Supabase returned no link.");
    return { url: `${SUPABASE_URL}/storage/v1${json.signedURL}` };
  },
});

export const removeFile = authenticatedAction({
  args: { id: v.number() },
  returns: v.any(),
  handler: async (ctx, a): Promise<{ ok: true }> => {
    const by: string = await ctx.runQuery(internal.ceo.windows.gate, {
      userId: ctx.userId,
    });
    const row = (
      await rest(
        `cockpit_person_files?id=eq.${a.id}&select=path,name,person_id`,
      )
    )?.[0];
    if (!row) throw new Error("No such file.");
    await storage(`object/${BUCKET}/${row.path}`, { method: "DELETE" });
    await rest(`cockpit_person_files?id=eq.${a.id}`, { method: "DELETE" });
    await ctx.runMutation(internal.ceo.profiles.record, {
      action: "people.file",
      rowId: String(row.person_id),
      what: `Deleted the file "${row.name}" from person ${row.person_id}`,
      after: { id: a.id },
      by,
    });
    return { ok: true };
  },
});
