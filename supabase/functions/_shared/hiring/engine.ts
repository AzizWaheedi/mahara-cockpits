/**
 * Job "engine": what a card's move asks for, written down as a draft.
 *
 * Ported from apps/media-buyer-cockpit/convex/hiring/engine.ts. The words,
 * the stage-to-message map and the rules are the same:
 * 1. It never acts on a candidate seen for the first time, only on a real
 *    move, so importing a form's history messages nobody.
 * 2. It acts only on where the candidate is now.
 * 3. It never writes the same message for the same person twice.
 * 4. When GoHighLevel is the sender it stands down entirely.
 *
 * One difference: this engine never sends. Armed or not, every message is a
 * draft (an action event with ok false). A draft leaves only through
 * hiring-api sendDraft, pressed by the CEO, with HIRING_SEND_ENABLED "true".
 * Convex re-drafted the same message every ten minutes while disarmed; a
 * draft now counts as done for rule 3.
 */

import type { Ctx } from "./context.ts";
import { loadMeta, requireGhl } from "./meta.ts";
import type { Any } from "./providers.ts";
import { type Action, mergeSettings, SETTINGS_KEY } from "./settings.ts";
import { type Role, roleByKey, type StageKey } from "./spec.ts";
import type { Row } from "./store.ts";

/** The first line of every draft. hiring-api sendDraft reads drafts by it. */
export const DRAFT_PREFIX = "Drafted, not sent";
export const SHORT_PREFIX = "Short form, for SMS and WhatsApp:";

/** Which action a stage asks for. A stage with no action is just a move. */
export const ACTION_FOR: Partial<Record<StageKey, Action>> = {
  loom: "loom_request",
  group: "group_invite",
  "one-to-one": "test_project",
  offer: "offer",
  disqualified: "rejection",
  bench: "bench_note",
};

/**
 * Every message goes out on both rails, so each one has a long form for email
 * and a short form for the phone. The short form says the same thing in one
 * or two lines and never repeats the whole email.
 */
export type Template = { subject: string; body: string; sms: string };

/**
 * Plain, short, and in Aziz's register: say the thing, say what happens next,
 * stop. No em-dashes anywhere.
 */
export const TEMPLATES: Record<Action, Template> = {
  loom_request: {
    subject: "{{role}} at {{agency}}, one thing before we talk",
    body: `Hi {{firstName}},

Thanks for applying for the {{role}} role at {{agency}}. We liked your application.

There is one thing we need before we talk.

{{loomPrompt}}

Reply to this message with it. Take the time it needs, but do not polish it for a week.

{{positionVideo}}

{{owner}}`,
    sms: "Hi {{firstName}}, {{agency}} here about the {{role}} role. We liked your application. One thing before we talk, check your email for what to send. {{owner}}",
  },
  group_invite: {
    subject: "{{role}} at {{agency}}, group interview",
    body: `Hi {{firstName}},

You are through to a group interview for the {{role}} role at {{agency}}. It is on Zoom with the other people still in for this one role.

Book the slot that suits you: {{groupLink}}

Two things worth knowing. It starts on time, and answers are kept to sixty seconds each, so come with the short version of your story.

{{owner}}`,
    sms: "Hi {{firstName}}, you are through to a group interview for the {{role}} role. Book your slot: {{groupLink}} It starts on time. {{owner}}",
  },
  test_project: {
    subject: "{{role}} at {{agency}}, the last two steps",
    body: `Hi {{firstName}},

You are through to the last round for the {{role}} role. There are two things left.

First, a short piece of real work. It is unpaid, it is deliberately small, and we never use it ourselves.

{{testProject}}

Second, a one to one with me. Book it here: {{oneToOneLink}}

Send the work back before the call if you can, and we will go through it together.

{{owner}}`,
    sms: "Hi {{firstName}}, you are in the last round for {{role}}. I have emailed you a short unpaid piece of work. Book our one to one here: {{oneToOneLink}} {{owner}}",
  },
  offer: {
    subject: "An offer from {{agency}}",
    body: `Hi {{firstName}},

We would like you to join {{agency}} as our {{role}}.

What the role is: {{dailyResponsibilities}}

What it pays: {{compensation}}

Reply and tell me yes or no, and the earliest date you could start. If it is a yes I will send the contract and the onboarding call straight after.

{{owner}}`,
    sms: "Hi {{firstName}}, we would like you to join {{agency}} as our {{role}}. The full offer is in your email. Reply yes or no and the earliest you could start. {{owner}}",
  },
  rejection: {
    subject: "{{role}} at {{agency}}",
    body: `Hi {{firstName}},

Thanks for the time you put into applying for the {{role}} role at {{agency}}. We are not taking it further this time.

That is not a judgement on your work, it is who else applied for this one role. We hire for these roles often, so apply again when you see one open: {{careers}}

{{owner}}`,
    sms: "Hi {{firstName}}, thanks for applying for the {{role}} role at {{agency}}. We are not taking it further this time. We hire these roles often: {{careers}} {{owner}}",
  },
  bench_note: {
    subject: "{{role}} at {{agency}}, holding your application",
    body: `Hi {{firstName}},

You did well and I want to be straight with you: we do not have the seat open right now.

I am keeping your application on hand rather than closing it. When the next {{role}} seat opens you are one of the first people I will message, and you will not start from the beginning.

{{owner}}`,
    sms: "Hi {{firstName}}, you did well but the {{role}} seat is not open right now. I am keeping your application on hand and you will hear from me first when it opens. {{owner}}",
  },
};

/** Fill a template from the role, the candidate and the custom values. */
export function compose(t: Template, vars: Record<string, string>): Template {
  const fill = (s: string) =>
    s
      .replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? "")
      // A value Aziz has not filled in yet leaves a blank line, not a gap.
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  return { subject: fill(t.subject), body: fill(t.body), sms: fill(t.sms) };
}

/** The words one candidate's message is filled with. */
export function varsFor(
  role: Role,
  candidateName: string,
  values: Map<string, string>,
): Record<string, string> {
  const val = (name: string, fallback = "") =>
    values.get(name.trim().toLowerCase())?.trim() || fallback;
  const firstName = candidateName.trim().split(/\s+/)[0] ?? "there";
  return {
    name: candidateName || "there",
    firstName: firstName || "there",
    role: role.label,
    agency: val("Hiring - Agency name", "Mahara Media"),
    owner: val("Hiring - Owner name", "Aziz"),
    careers: val("Hiring - Careers page", role.careersUrl),
    groupLink: val("Hiring - Group interview booking link"),
    oneToOneLink: val("Hiring - One-to-one booking link"),
    testProject: val(`${role.label} - Test project`, role.testProject),
    loomPrompt: val(`${role.label} - Loom request`, role.loomPrompt),
    compensation: val(`${role.label} - Compensation`, role.compensation),
    dailyResponsibilities: val(
      `${role.label} - Daily responsibilities`,
      role.dailyResponsibilities,
    ),
    positionVideo: val(`${role.label} - Position breakdown video`),
  };
}


/** Every custom value in the hiring account, by lower-case name. Pure. */
export const valuesByName = (body: Any): Map<string, string> =>
  new Map(
    (body?.customValues ?? []).map((c: Any) => [
      String(c.name ?? "").trim().toLowerCase(),
      String(c.value ?? ""),
    ]),
  );

export type Pending = {
  candidateId: string;
  contactId: string;
  name: string;
  role: string;
  toStage: StageKey;
  action: Action;
};

/**
 * Moves that still need a message: a real stage move whose message has not
 * been sent or drafted for that candidate, for a candidate still in that
 * stage. Pure: the whole dedupe rule is here and in the tests.
 */
export function pendingFrom(moves: Row[], actedOrDrafted: Row[], candidates: Row[]): Pending[] {
  const done = new Set(actedOrDrafted.map(r => `${r.candidate_id}:${String(r.action ?? "")}`));
  const byId = new Map(candidates.map(r => [String(r.id), r]));
  const seen = new Set<string>();
  const out: Pending[] = [];
  for (const m of moves) {
    if (m.from_stage === null || m.from_stage === undefined) continue;
    const to = String(m.to_stage) as StageKey;
    const action = ACTION_FOR[to];
    if (!action) continue;
    const id = String(m.candidate_id);
    const key = `${id}:${action}`;
    if (seen.has(key) || done.has(key)) continue;
    seen.add(key);
    const row = byId.get(id);
    // Only act on where the candidate is now, never on a stage they left.
    if (!row || String(row.stage) !== to) continue;
    out.push({
      candidateId: id,
      contactId: String(row.contact_id),
      name: String(row.name ?? ""),
      role: String(row.role),
      toStage: to,
      action,
    });
  }
  return out;
}

/** The stored draft. hiring-api sendDraft parses exactly this layout. */
export const draftText = (why: string, msg: Template) =>
  `${DRAFT_PREFIX} (${why}).\n${msg.subject}\n\n${msg.body}\n\n${SHORT_PREFIX} ${msg.sms}`;

/** A draft back into its parts: the reverse of draftText. Pure. */
export function parseDraft(
  detail: string,
): { subject: string; body: string; message: string; sms: string } | null {
  const lines = String(detail ?? "").split("\n");
  if (!lines[0]?.startsWith(DRAFT_PREFIX)) return null;
  const shortAt = lines.findIndex(l => l.startsWith("Short form"));
  const body = lines.slice(1, shortAt === -1 ? undefined : shortAt).join("\n").trim();
  const sms = shortAt === -1 ? body : lines[shortAt].replace(/^Short form[^:]*:\s*/, "").trim();
  const [subject, ...rest] = body.split("\n");
  const message = rest.join("\n").trim();
  if (!subject?.trim() || !message) return null;
  return { subject: subject.trim(), body, message, sms };
}

export type EngineResult = {
  ok: boolean;
  armed: false;
  considered: number;
  sent: 0;
  drafted: number;
  failed: number;
  lines: string[];
  error?: string;
};

export async function runEngine(ctx: Ctx): Promise<EngineResult> {
  const ghl = requireGhl(ctx);
  const s = mergeSettings(await ctx.store.getMeta(SETTINGS_KEY));
  const result: EngineResult = {
    ok: true,
    armed: false,
    considered: 0,
    sent: 0,
    drafted: 0,
    failed: 0,
    lines: [],
  };
  // One sender, or every candidate hears everything twice.
  if (s.sender === "gohighlevel") {
    result.lines.push("GoHighLevel sends the candidate messages, so the cockpit stood down.");
    return result;
  }
  if (s.armed)
    result.lines.push(
      "The stored switch says armed, but this engine only writes drafts. Turn the switch off in the cockpit.",
    );
  const moves = await ctx.store.stageMoves(500);
  const ids = [...new Set(moves.map(m => String(m.candidate_id)))];
  const todo = pendingFrom(moves, await ctx.store.actedOrDrafted(), await ctx.store.candidatesByIds(ids));
  result.considered = todo.length;
  if (!todo.length) return result;
  const m = await loadMeta(ctx);
  const values = valuesByName(
    await ghl.readOk(`/locations/${encodeURIComponent(m.location)}/customValues`),
  );
  const why = s.armed
    ? "this engine only writes drafts; send it from the cockpit"
    : "the engine is disarmed";
  const drafts: Row[] = [];
  for (const p of todo) {
    const role = roleByKey(p.role);
    if (!role) continue;
    if (!s.actions[p.action]) {
      result.lines.push(`${p.name}: ${p.action} is switched off, left alone.`);
      continue;
    }
    // A message that needs a link nobody has filled in is not written half made.
    const missing =
      (p.action === "group_invite" && !values.get("hiring - group interview booking link")?.trim()) ||
      (p.action === "test_project" && !values.get("hiring - one-to-one booking link")?.trim());
    if (missing) {
      result.failed += 1;
      result.lines.push(
        `${p.name}: ${p.action} needs a booking link that is not set in GoHighLevel custom values.`,
      );
      continue;
    }
    const msg = compose(TEMPLATES[p.action], varsFor(role, p.name, values));
    drafts.push({
      candidate_id: p.candidateId,
      role: p.role,
      kind: "action",
      to_stage: p.toStage,
      action: p.action,
      detail: draftText(why, msg).slice(0, 4000),
      ok: false,
      by_whom: "the cockpit",
    });
    result.drafted += 1;
    result.lines.push(`${p.name}: ${p.action} drafted.`);
  }
  if (drafts.length) await ctx.store.insertEvents(drafts);
  return result;
}
