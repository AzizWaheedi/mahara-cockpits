/**
 * Job "intake": the careers forms (Typeform) into the hiring board
 * (GoHighLevel), every 30 minutes.
 *
 * Ported from apps/media-buyer-cockpit/convex/hiring/intake.ts. Each new
 * completed response becomes a contact, a note with the whole questionnaire,
 * and an opportunity at the Application stage of that role's pipeline.
 *
 * Dry run unless HIRING_APPLY is exactly "true". A dry run reads Typeform
 * and GoHighLevel, lists what it would write, and writes nothing: no
 * contact, no note, no card, no application row, and the form's cursor does
 * not move, so the live run that follows files the same applications.
 */

import type { Ctx } from "./context.ts";
import { loadMeta, type Meta, requireGhl } from "./meta.ts";
import { type Any, GateError } from "./providers.ts";
import { FORMS, ROLES, type Role } from "./spec.ts";

/** How many responses one page asks for. */
const PAGE = 50;
/** How far back one run walks looking for something it has not seen. */
const MAX_PAGES = 12;
/** Response tokens remembered per form. */
const SEEN_CAP = 5000;

/**
 * One answer. `type` is the question's type (short_text, file_upload);
 * `shape` is how Typeform returned the value (text, file_url). They are
 * different vocabularies, and mixing them blanked the first import.
 */
export type Answer = { ref: string; title: string; type: string; shape: string; text: string };

/** Whatever the applicant put, as one readable string. */
export function answerText(a: Any): string {
  if (a == null) return "";
  const t = String(a.type ?? "");
  switch (t) {
    case "choice":
      return String(a.choice?.label ?? a.choice?.other ?? "");
    case "choices":
      return [...(a.choices?.labels ?? []), a.choices?.other].filter(Boolean).join(", ");
    case "boolean":
      return a.boolean ? "Yes" : "No";
    case "file_url":
      return String(a.file_url ?? "");
    case "date":
      return String(a.date ?? "");
    case "number":
      return String(a.number ?? "");
    case "payment":
      return String(a.payment?.amount ?? "");
    default:
      return String(a[t] ?? a.text ?? "");
  }
}

/** A response's answers, with the question titles the answers do not carry. */
export const answersOf = (item: Any, titleOf: Map<string, string>): Answer[] =>
  (item?.answers ?? []).map((a: Any) => ({
    ref: String(a.field?.ref ?? ""),
    title: titleOf.get(String(a.field?.ref ?? "")) ?? "",
    type: String(a.field?.type ?? a.type ?? ""),
    shape: String(a.type ?? ""),
    text: answerText(a),
  }));

/** Question titles by ref, nested groups included. */
export function titlesOf(def: Any): Map<string, string> {
  const titleOf = new Map<string, string>();
  const walk = (fields: Any[]) => {
    for (const f of fields ?? []) {
      titleOf.set(String(f.ref), String(f.title ?? ""));
      if (f.properties?.fields) walk(f.properties.fields);
    }
  };
  walk(def?.fields ?? []);
  return titleOf;
}

const has = (title: string, ...words: string[]) => {
  const t = title.toLowerCase();
  return words.some(w => t.includes(w));
};

/**
 * The fields a candidate record needs, picked out of any form by what the
 * question is rather than by its reference, so a rebuilt form keeps feeding.
 */
export function mapAnswers(answers: Answer[]) {
  const first = (test: (a: Answer) => boolean) =>
    answers.find(a => test(a) && a.text.trim())?.text.trim() ?? "";
  const country = [
    first(a => has(a.title, "nationality")),
    first(a => has(a.title, "city", "located in")),
  ].filter(Boolean).join(", ");
  const portfolio = [
    first(a => a.shape === "file_url" || a.type === "file_upload"),
    first(a => has(a.title, "portfolio", "recording", "drop a link")),
  ].filter(Boolean).join("\n");
  return {
    name: first(a => has(a.title, "name") && a.shape === "text"),
    email: first(a => a.shape === "email" || a.type === "email"),
    phone: first(a => a.shape === "phone_number" || a.type === "phone_number"),
    country,
    years: first(a => a.shape === "number" && has(a.title, "years")),
    arabic: first(a => has(a.title, "arabic")),
    portfolio,
    source: first(a => has(a.title, "hear about us")),
    startsIn: first(a => has(a.title, "how soon", "when can you start")),
  };
}

/** The whole questionnaire, as the note that hangs on the contact. */
export function transcript(answers: Answer[], form: string): string {
  const lines = answers.filter(a => a.text.trim()).map(a => `${a.title}\n${a.text.trim()}`);
  return [`Application, ${form}`, "", ...lines].join("\n\n");
}

export const splitName = (full: string) => {
  const parts = full.trim().split(/\s+/);
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
};

/** The contact upsert body for one application. Pure. */
export function contactBody(
  m: Meta,
  role: Role,
  f: ReturnType<typeof mapAnswers>,
): Record<string, unknown> {
  const { firstName, lastName } = splitName(f.name || f.email);
  return {
    locationId: m.location,
    firstName,
    lastName,
    name: f.name || undefined,
    email: f.email || undefined,
    phone: f.phone || undefined,
    source: f.source || "Careers page",
    tags: ["applicant", role.key],
    customFields: [
      { id: m.fields.role, value: role.label },
      { id: m.fields.source, value: f.source || "Careers page" },
      { id: m.fields.yearsExperience, value: f.years },
      { id: m.fields.arabic, value: f.arabic },
      { id: m.fields.portfolio, value: f.portfolio },
    ].filter(x => x.id && x.value),
  };
}

export type Planned = {
  token: string;
  name: string;
  hasEmail: boolean;
  hasPhone: boolean;
  would: string;
};

export type RoleResult = {
  role: string;
  form: string;
  read: number;
  added: number;
  skipped: number;
  planned: Planned[];
  errors: string[];
};

async function intakeRole(ctx: Ctx, role: Role, m: Meta): Promise<RoleResult> {
  const ghl = requireGhl(ctx);
  const tf = ctx.typeform!;
  const form = FORMS[role.key];
  const out: RoleResult = {
    role: role.key,
    form: form?.id ?? "",
    read: 0,
    added: 0,
    skipped: 0,
    planned: [],
    errors: [],
  };
  // The setter track has no form; everyone answers the closer's form.
  if (!form) return out;
  const pipelineId = m.pipelines[role.key];
  const stageId = m.stageIdByKey[role.key]?.application;
  if (!pipelineId || !stageId) {
    out.errors.push(`The ${role.label} pipeline is not built yet; run the hiring setup.`);
    return out;
  }

  // Typeform lists newest first, and `after` reads in that direction, so a
  // cursor of "newest processed" skips everything (196 lost, 2026-09-22).
  // The honest way is to page backwards with `before` and remember tokens.
  const cursorKey = `intake:${form.id}`;
  const held = ((await ctx.store.getMeta(cursorKey)) ?? {}) as Any;
  const seen = new Set<string>(Array.isArray(held.seen) ? held.seen.map(String) : []);
  const titleOf = titlesOf(await tf.get(`/forms/${form.id}`));

  const items: Any[] = [];
  let before = "";
  for (let page = 0; page < MAX_PAGES && items.length === 0; page++) {
    const q = new URLSearchParams({ page_size: String(PAGE), completed: "true" });
    if (before) q.set("before", before);
    const body = await tf.get(`/forms/${form.id}/responses?${q}`);
    const batch: Any[] = body?.items ?? [];
    if (!batch.length) break;
    before = String(batch[batch.length - 1]?.token ?? "");
    items.push(...batch.filter(i => !seen.has(String(i.token ?? ""))));
    if (!before) break;
  }
  out.read = items.length;
  if (!items.length) return out;

  const loc = encodeURIComponent(m.location);
  for (const item of items) {
    const token = String(item.token ?? "");
    const answers = answersOf(item, titleOf);
    const f = mapAnswers(answers);
    if (!f.email && !f.phone) {
      out.skipped += 1;
      if (ctx.apply) seen.add(token);
      else
        out.planned.push({
          token: token.slice(0, 8),
          name: f.name,
          hasEmail: false,
          hasPhone: false,
          would: "skip: no email and no phone",
        });
      continue;
    }
    if (!ctx.apply) {
      out.planned.push({
        token: token.slice(0, 8),
        name: f.name || "(no name given)",
        hasEmail: Boolean(f.email),
        hasPhone: Boolean(f.phone),
        would:
          `upsert the contact, attach the application note, and add a card at Application on ${role.pipeline} unless they already have one there`,
      });
      continue;
    }
    try {
      const contact = await ghl.write("POST", "/contacts/upsert", contactBody(m, role, f));
      const contactId = String(contact?.contact?.id ?? contact?.id ?? contact?.contactId ?? "");
      if (!contactId) throw new Error("GoHighLevel returned no contact id");
      // The whole questionnaire twice: on the contact as a note, and in
      // Supabase for the recruiting agent, which has no GoHighLevel token.
      const whole = transcript(answers, form.title).slice(0, 20_000);
      await ghl.write("POST", `/contacts/${encodeURIComponent(contactId)}/notes`, { body: whole })
        .catch(e => out.errors.push(`${token.slice(0, 8)} note: ${(e as Error).message}`));
      await ctx.store.upsertApplication({
        contact_id: contactId,
        role: role.key,
        form: form.title,
        text: whole,
        at: ctx.now().toISOString(),
      });
      // A contact with a card on this board keeps it, so a cursor reset
      // re-reads the form without doubling anyone.
      const existing = await ghl.read(
        `/opportunities/search?location_id=${loc}&pipeline_id=${encodeURIComponent(pipelineId)}&contact_id=${encodeURIComponent(contactId)}&limit=1`,
      );
      if (existing.status === 200 && (existing.body?.opportunities ?? []).length) {
        out.skipped += 1;
        seen.add(token);
        continue;
      }
      let opp: Any;
      try {
        opp = await ghl.write("POST", "/opportunities/", {
          pipelineId,
          locationId: m.location,
          pipelineStageId: stageId,
          name: f.name || f.email || "Applicant",
          status: "open",
          contactId,
        });
      } catch (e) {
        // GoHighLevel refuses a second card for the same person on the same
        // board with a 400. That person is already on the board.
        if (/duplicate opportunit/i.test(String((e as Error).message))) {
          out.skipped += 1;
          seen.add(token);
          continue;
        }
        throw e;
      }
      const oppId = String(opp?.opportunity?.id ?? opp?.id ?? "");
      out.added += 1;
      seen.add(token);
      if (oppId) {
        // The mirror adds the candidate row on its next pass; the note waits
        // in the result until then, because the event needs that row.
        out.planned.push({
          token: token.slice(0, 8),
          name: f.name,
          hasEmail: Boolean(f.email),
          hasPhone: Boolean(f.phone),
          would: `added as ${oppId}${f.startsIn ? `, can start ${f.startsIn}` : ""}`,
        });
      }
    } catch (e) {
      if (e instanceof GateError) throw e;
      out.errors.push(`${token.slice(0, 8)}: ${(e as Error).message}`);
      // Stop at the first real failure. The token stays unseen, so the next
      // run picks this application up again.
      break;
    }
  }
  if (ctx.apply)
    await ctx.store.putMeta(cursorKey, {
      seen: [...seen].slice(-SEEN_CAP),
      at: ctx.now().getTime(),
      form: form.id,
    });
  return out;
}

export type IntakeResult = {
  ok: boolean;
  dryRun: boolean;
  read: number;
  added: number;
  skipped: number;
  results: RoleResult[];
  error?: string;
};

export async function runIntake(ctx: Ctx, only?: string[]): Promise<IntakeResult> {
  requireGhl(ctx);
  if (!ctx.typeform)
    throw new GateError(
      "TYPEFORM_TOKEN is not set as an Edge Function secret, so the careers forms cannot be read.",
    );
  const m = await loadMeta(ctx);
  const results: RoleResult[] = [];
  for (const role of ROLES.filter(r => !only?.length || only.includes(r.key))) {
    try {
      results.push(await intakeRole(ctx, role, m));
    } catch (e) {
      results.push({
        role: role.key,
        form: FORMS[role.key]?.id ?? "",
        read: 0,
        added: 0,
        skipped: 0,
        planned: [],
        errors: [(e as Error).message],
      });
    }
  }
  const errors = results.flatMap(r => r.errors.map(x => `${r.role}: ${x}`));
  return {
    ok: errors.length === 0,
    dryRun: !ctx.apply,
    read: results.reduce((t, r) => t + r.read, 0),
    added: results.reduce((t, r) => t + r.added, 0),
    skipped: results.reduce((t, r) => t + r.skipped, 0),
    results,
    ...(errors.length ? { error: errors.join("; ").slice(0, 600) } : {}),
  };
}
