import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { rest, upsertMerge } from "../ceo/sbWrite";
import { callTool, unwrap } from "../tools";
import { FORMS } from "./forms";
import { type Any, ghlOk, hiringConfigured, hiringLocation } from "./ghl";
import { ROLES, type Role, roleByKey } from "./spec";
import { meta } from "./sync";

/**
 * Applications, from the careers page into the hiring board.
 *
 * Each of the five roles has its own Typeform, and none of them had a webhook
 * (checked 2026-09-22), so nothing left Typeform at all. This reads each form
 * on a schedule instead: every new response becomes a contact and an
 * opportunity at the Application stage of that role's pipeline, with the
 * whole questionnaire attached to the contact as a note so nothing an
 * applicant wrote is lost.
 *
 * A poll rather than a webhook, for the same reason the board sync is a poll:
 * it catches up after an outage, and a form Aziz rebuilds does not silently
 * stop feeding the pipeline.
 */

const TYPEFORM = "https://api.typeform.com";
/** How many responses one run will take from one form. */
const PAGE = 50;
/** How far back one run will walk looking for something it has not seen. */
const MAX_PAGES = 12;
/** Response tokens remembered per form. */
const SEEN_CAP = 5000;

const tf = async (path: string): Promise<Any> =>
  unwrap(
    await callTool("pd_typeform_proxy_get", { url: `${TYPEFORM}${path}` }),
  );

// --- Reading one answer at a time --------------------------------------------

/**
 * One answer. `type` is the question's type (short_text, file_upload), which
 * is what a matcher below reads; `shape` is how Typeform returned the value
 * (text, file_url), which is a different vocabulary and the cause of the
 * first import coming back blank (2026-09-22).
 */
type Answer = {
  ref: string;
  title: string;
  type: string;
  shape: string;
  text: string;
};

/** Whatever the applicant put, as one readable string. */
function answerText(a: Any): string {
  if (a == null) return "";
  const t = String(a.type ?? "");
  switch (t) {
    case "choice":
      return String(a.choice?.label ?? a.choice?.other ?? "");
    case "choices":
      return [...(a.choices?.labels ?? []), a.choices?.other]
        .filter(Boolean)
        .join(", ");
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

const has = (title: string, ...words: string[]) => {
  const t = title.toLowerCase();
  return words.some(w => t.includes(w));
};

/**
 * The fields a candidate record needs, picked out of any of the five forms by
 * what the question is rather than by its reference, so a form that gets
 * rebuilt keeps feeding the funnel.
 */
export function mapAnswers(answers: Answer[]): {
  name: string;
  email: string;
  phone: string;
  country: string;
  years: string;
  arabic: string;
  portfolio: string;
  source: string;
  startsIn: string;
} {
  const first = (test: (a: Answer) => boolean) =>
    answers.find(a => test(a) && a.text.trim())?.text.trim() ?? "";
  const country = [
    first(a => has(a.title, "nationality")),
    first(a => has(a.title, "city", "located in")),
  ]
    .filter(Boolean)
    .join(", ");
  const portfolio = [
    first(a => a.shape === "file_url" || a.type === "file_upload"),
    first(a => has(a.title, "portfolio", "recording", "drop a link")),
  ]
    .filter(Boolean)
    .join("\n");
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
  const lines = answers
    .filter(a => a.text.trim())
    .map(a => `${a.title}\n${a.text.trim()}`);
  return [`Application, ${form}`, "", ...lines].join("\n\n");
}

const splitName = (full: string): { firstName: string; lastName: string } => {
  const parts = full.trim().split(/\s+/);
  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" "),
  };
};

/**
 * Make the card, or say "duplicate" when this person already has one.
 *
 * GoHighLevel refuses a second opportunity for the same contact on the same
 * pipeline with a 400, which is the right answer and not a failure: the
 * person is already on the board. Reading it as a refusal once stopped a
 * whole form's import dead (2026-09-22).
 */
async function createOpportunity(body: Any): Promise<Any | "duplicate"> {
  try {
    return await ghlOk("POST", "/opportunities/", { body });
  } catch (e) {
    const msg = String((e as Error).message ?? "");
    if (/duplicate opportunit/i.test(msg)) return "duplicate";
    throw e;
  }
}

// --- One role's form ---------------------------------------------------------

type RoleResult = {
  role: string;
  form: string;
  read: number;
  added: number;
  skipped: number;
  errors: string[];
};

async function intakeRole(role: Role): Promise<RoleResult> {
  const form = FORMS[role.key];
  const out: RoleResult = {
    role: role.key,
    form: form.id,
    read: 0,
    added: 0,
    skipped: 0,
    errors: [],
  };
  const m = await meta();
  const pipelineId = m.pipelines[role.key];
  const stageId = m.stageIdByKey[role.key]?.application;
  if (!pipelineId || !stageId) {
    out.errors.push(
      `The ${role.label} pipeline is not built yet; run the hiring setup.`,
    );
    return out;
  }

  // Which responses this form has already given up.
  //
  // Typeform lists responses newest first and its `after` parameter reads in
  // that same direction, so a cursor set to the newest token processed asks
  // for responses newer than it, of which there are none. That silently
  // skipped 196 applications on the first run (2026-09-22). The honest way is
  // to page backwards with `before` and remember the tokens.
  const cursorKey = `intake:${form.id}`;
  const cursorRows = await rest(
    `cockpit_hiring_meta?key=eq.${cursorKey}&select=value&limit=1`,
  );
  const held = (cursorRows?.[0]?.value ?? {}) as Any;
  const seen = new Set<string>(
    Array.isArray(held.seen) ? held.seen.map(String) : [],
  );

  // The question titles, which the answers do not carry.
  const def = await tf(`/forms/${form.id}`);
  const titleOf = new Map<string, string>();
  const walk = (fields: Any[]) => {
    for (const f of fields ?? []) {
      titleOf.set(String(f.ref), String(f.title ?? ""));
      if (f.properties?.fields) walk(f.properties.fields);
    }
  };
  walk(def?.fields ?? []);

  // One page of the oldest responses this form still owes us. Walking
  // backwards from the newest, a page at a time, until a page holds something
  // unseen or the history runs out.
  const items: Any[] = [];
  let before = "";
  for (let page = 0; page < MAX_PAGES && items.length === 0; page++) {
    const q = new URLSearchParams({
      page_size: String(PAGE),
      completed: "true",
    });
    if (before) q.set("before", before);
    const body = await tf(`/forms/${form.id}/responses?${q}`);
    const batch: Any[] = body?.items ?? [];
    if (!batch.length) break;
    before = String(batch[batch.length - 1]?.token ?? "");
    items.push(...batch.filter(i => !seen.has(String(i.token ?? ""))));
    if (!before) break;
  }
  out.read = items.length;
  if (!items.length) return out;

  for (const item of items) {
    const token = String(item.token ?? "");
    try {
      const answers: Answer[] = (item.answers ?? []).map((a: Any) => ({
        ref: String(a.field?.ref ?? ""),
        title: titleOf.get(String(a.field?.ref ?? "")) ?? "",
        type: String(a.field?.type ?? a.type ?? ""),
        shape: String(a.type ?? ""),
        text: answerText(a),
      }));
      const f = mapAnswers(answers);
      if (!f.email && !f.phone) {
        out.skipped += 1;
        seen.add(token);
        continue;
      }
      const { firstName, lastName } = splitName(f.name || f.email);
      const contact = await ghlOk("POST", "/contacts/upsert", {
        body: {
          locationId: m.location,
          firstName,
          lastName,
          name: f.name || undefined,
          email: f.email || undefined,
          phone: f.phone || undefined,
          country: undefined,
          source: f.source || "Careers page",
          tags: ["applicant", role.key],
          customFields: [
            { id: m.fields.role, value: role.label },
            { id: m.fields.source, value: f.source || "Careers page" },
            { id: m.fields.yearsExperience, value: f.years },
            { id: m.fields.arabic, value: f.arabic },
            { id: m.fields.portfolio, value: f.portfolio },
          ].filter(x => x.id && x.value),
        },
      });
      const contactId = String(
        contact?.contact?.id ?? contact?.id ?? contact?.contactId ?? "",
      );
      if (!contactId) throw new Error("GoHighLevel returned no contact id");

      // The whole questionnaire, so the application can be read in one place.
      await ghlOk("POST", `/contacts/${contactId}/notes`, {
        body: { body: transcript(answers, form.title).slice(0, 20_000) },
      }).catch(() => undefined);

      // A contact who already has a card on this board keeps it, so a cursor
      // reset re-reads the form without doubling anyone.
      const existing = await ghlOk(
        "GET",
        `/opportunities/search?location_id=${m.location}&pipeline_id=${pipelineId}&contact_id=${contactId}&limit=1`,
      ).catch(() => null);
      if ((existing?.opportunities ?? []).length) {
        out.skipped += 1;
        seen.add(token);
        continue;
      }
      const opp = await createOpportunity({
        pipelineId,
        locationId: m.location,
        pipelineStageId: stageId,
        name: f.name || f.email || "Applicant",
        status: "open",
        contactId,
      });
      if (opp === "duplicate") {
        out.skipped += 1;
        seen.add(token);
        continue;
      }
      const oppId = String(opp?.opportunity?.id ?? opp?.id ?? "");
      out.added += 1;
      if (oppId)
        await rest("cockpit_hiring_events", {
          method: "POST",
          body: [
            {
              candidate_id: oppId,
              role: role.key,
              kind: "note",
              detail: `Applied through ${form.title}${f.startsIn ? `, can start ${f.startsIn}` : ""}.`,
              by_whom: "the careers page",
            },
          ],
          prefer: "return=minimal",
        }).catch(() => null);
      seen.add(token);
    } catch (e) {
      out.errors.push(`${token.slice(0, 8)}: ${(e as Error).message}`);
      // Stop at the first real failure. The token stays unseen, so the next
      // run picks this application up again rather than losing it.
      break;
    }
  }
  await upsertMerge(
    "cockpit_hiring_meta",
    [
      {
        key: cursorKey,
        // Newest first, capped, so the list cannot grow without limit.
        value: {
          seen: [...seen].slice(-SEEN_CAP),
          at: Date.now(),
          form: form.id,
        },
        updated_at: new Date().toISOString(),
      },
    ],
    "key",
  );
  return out;
}

/** Read every role's form and file whatever is new. */
export async function intakeOnce(only?: string[]): Promise<Any> {
  if (!hiringConfigured())
    return {
      ok: false,
      error:
        "The hiring sub-account is not connected: set GHL_HIRING_PIT and GHL_HIRING_LOCATION.",
    };
  const roles = ROLES.filter(r => !only?.length || only.includes(r.key));
  const results: RoleResult[] = [];
  for (const role of roles) {
    try {
      results.push(await intakeRole(role));
    } catch (e) {
      results.push({
        role: role.key,
        form: FORMS[role.key]?.id ?? "",
        read: 0,
        added: 0,
        skipped: 0,
        errors: [(e as Error).message],
      });
    }
  }
  return {
    ok: true,
    location: hiringLocation(),
    added: results.reduce((t, r) => t + r.added, 0),
    read: results.reduce((t, r) => t + r.read, 0),
    results,
  };
}

export const run = internalAction({
  args: { only: v.optional(v.array(v.string())) },
  returns: v.any(),
  handler: async (_ctx, { only }) => intakeOnce(only),
});

/**
 * Move a form's cursor by hand. With no token it starts from the beginning,
 * which files every response the form has ever taken; with a token it skips
 * everything up to and including that one.
 */
export const setCursor = internalAction({
  args: { role: v.string() },
  returns: v.any(),
  handler: async (_ctx, { role }) => {
    const r = roleByKey(role);
    if (!r) throw new Error(`No role called ${role}`);
    const form = FORMS[r.key];
    await upsertMerge(
      "cockpit_hiring_meta",
      [
        {
          key: `intake:${form.id}`,
          value: { seen: [], at: Date.now(), form: form.id },
          updated_at: new Date().toISOString(),
        },
      ],
      "key",
    );
    return { role: r.key, form: form.id, forgotten: true };
  },
});

/** How many responses each form holds and where the cursor sits. */
export const status = internalAction({
  args: {},
  returns: v.any(),
  handler: async () => {
    const rows = await rest(
      "cockpit_hiring_meta?key=like.intake:*&select=key,value",
    );
    const cursors = new Map<string, Any>();
    for (const r of rows ?? []) cursors.set(String(r.key), r.value);
    const out: Any[] = [];
    for (const role of ROLES) {
      const form = FORMS[role.key];
      let total: number | string = "?";
      try {
        const body = await tf(`/forms/${form.id}/responses?page_size=1`);
        total = Number(body?.total_items ?? 0);
      } catch (e) {
        total = `could not read: ${(e as Error).message.slice(0, 60)}`;
      }
      out.push({
        role: role.key,
        form: form.id,
        title: form.title,
        responses: total,
        cursor: cursors.get(`intake:${form.id}`)?.after
          ? "set"
          : "from the start",
      });
    }
    return out;
  },
});
