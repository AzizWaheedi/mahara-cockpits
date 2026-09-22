import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { rest } from "../ceo/sbWrite";
import { ghlOk, hiringConfigured } from "./ghl";
import type { Action, EngineSettings } from "./settings";
import { saveSettings, settings } from "./settings";
import { readValues } from "./setup";
import { ROLES, type Role, roleByKey, type StageKey, stageName } from "./spec";
import { meta } from "./sync";

/**
 * What happens when a card moves.
 *
 * Aziz drags a candidate from Application to Loom request; this sends the
 * Loom request. From Loom to Group interview; this sends the booking link.
 * To One-to-one; this sends the role's test project. To Job offer, to
 * Disqualified, to Bench; each has its message.
 *
 * Three rules keep it from ever going wrong, which is the whole point given
 * his first attempt at this in GoHighLevel workflows "hasn't really worked
 * the best" (Aziz, 2026-09-22):
 *
 * 1. It is disarmed until he arms it. Disarmed, every message is composed and
 *    written down, and nothing is sent. He reads them in the cockpit first.
 * 2. It never acts on a candidate it is seeing for the first time, only on a
 *    real move, so importing a form's history sends nobody anything.
 * 3. It never sends the same message to the same person twice, because every
 *    send is a row in cockpit_hiring_events and it reads them first.
 *
 * The words come from the role's custom values in GoHighLevel, so Aziz edits
 * the test project or the pay line there and the next message uses it.
 */

export type { Action, EngineSettings } from "./settings";
export { DEFAULT_SETTINGS, settings } from "./settings";

export const setSettings = internalAction({
  args: { patch: v.any() },
  returns: v.any(),
  handler: async (_ctx, { patch }) =>
    saveSettings(patch as Partial<EngineSettings>),
});

// --- The words ---------------------------------------------------------------

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
type Template = { subject: string; body: string; sms: string };

/**
 * Plain, short, and in Aziz's register: say the thing, say what happens next,
 * stop. No em-dashes anywhere.
 */
export const TEMPLATES: Record<Action, Template> = {
  loom_request: {
    subject: "{{role}} at {{agency}}, next step",
    body: `Hi {{firstName}},

Thanks for applying for the {{role}} role at {{agency}}. We liked your application.

Next step is a short video, so we can hear you rather than read you.

{{loomPrompt}}

Record it on Loom or your phone, whichever is faster, and reply to this message with the link. Two or three minutes is plenty.

{{positionVideo}}

{{owner}}`,
    sms: "Hi {{firstName}}, {{agency}} here about the {{role}} role. We liked your application. Next step is a short video: {{loomPrompt}} Reply here with the link. {{owner}}",
  },
  group_invite: {
    subject: "{{role}} at {{agency}}, group interview",
    body: `Hi {{firstName}},

Your video was good. The next step is a group interview on Zoom with the other people still in for the {{role}} role.

Book the slot that suits you: {{groupLink}}

Two things worth knowing. It starts on time, and answers are kept to sixty seconds each, so come with the short version of your story.

{{owner}}`,
    sms: "Hi {{firstName}}, your video was good. Next is a group interview for the {{role}} role. Book your slot: {{groupLink}} It starts on time. {{owner}}",
  },
  test_project: {
    subject: "{{role}} at {{agency}}, the last two steps",
    body: `Hi {{firstName}},

You are through to the final round for the {{role}} role. There are two things left.

First, a short piece of real work:

{{testProject}}

Second, a one to one with me. Book it here: {{oneToOneLink}}

Send the work back before the call if you can, and we will go through it together.

{{owner}}`,
    sms: "Hi {{firstName}}, you are in the final round for {{role}}. I have emailed you a short piece of real work. Book our one to one here: {{oneToOneLink}} {{owner}}",
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

/** Every custom value in the hiring account, by name. */
async function valuesByName(location: string): Promise<Map<string, string>> {
  const rows = await readValues(location);
  return new Map(rows.map(r => [r.name.trim().toLowerCase(), r.value]));
}

function varsFor(
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

// --- Doing it ----------------------------------------------------------------

type Pending = {
  candidateId: string;
  contactId: string;
  name: string;
  role: string;
  toStage: StageKey;
  action: Action;
};

/**
 * Moves that have happened but not yet been acted on: a stage event whose
 * action has no matching action event for the same candidate.
 */
async function pending(): Promise<Pending[]> {
  const moves =
    (await rest(
      "cockpit_hiring_events?kind=eq.stage&from_stage=not.is.null&select=candidate_id,role,to_stage,at&order=at.desc&limit=500",
    )) ?? [];
  const acted =
    (await rest(
      "cockpit_hiring_events?kind=eq.action&ok=eq.true&select=candidate_id,action&limit=2000",
    )) ?? [];
  const done = new Set(
    acted.map(r => `${r.candidate_id}:${String(r.action ?? "")}`),
  );
  const seen = new Set<string>();
  const wanted: {
    candidateId: string;
    role: string;
    to: StageKey;
    action: Action;
  }[] = [];
  for (const m of moves) {
    const to = String(m.to_stage) as StageKey;
    const action = ACTION_FOR[to];
    if (!action) continue;
    const id = String(m.candidate_id);
    const key = `${id}:${action}`;
    if (seen.has(key) || done.has(key)) continue;
    seen.add(key);
    wanted.push({ candidateId: id, role: String(m.role), to, action });
  }
  if (!wanted.length) return [];
  const ids = wanted.map(w => `"${w.candidateId}"`).join(",");
  const rows =
    (await rest(
      `cockpit_hiring_candidates?id=in.(${ids})&select=id,contact_id,name,role,stage`,
    )) ?? [];
  const byId = new Map(rows.map(r => [String(r.id), r]));
  const out: Pending[] = [];
  for (const w of wanted) {
    const row = byId.get(w.candidateId);
    if (!row) continue;
    // Only act on where the candidate is now, never on a stage they have left.
    if (String(row.stage) !== w.to) continue;
    out.push({
      candidateId: w.candidateId,
      contactId: String(row.contact_id),
      name: String(row.name ?? ""),
      role: String(row.role),
      toStage: w.to,
      action: w.action,
    });
  }
  return out;
}

async function record(
  p: Pending,
  ok: boolean,
  detail: string,
  by: string,
): Promise<void> {
  await rest("cockpit_hiring_events", {
    method: "POST",
    body: [
      {
        candidate_id: p.candidateId,
        role: p.role,
        kind: "action",
        to_stage: p.toStage,
        action: p.action,
        detail: detail.slice(0, 4000),
        ok,
        by_whom: by,
      },
    ],
    prefer: "return=minimal",
  });
}

export type RunResult = {
  ok: boolean;
  armed: boolean;
  considered: number;
  sent: number;
  drafted: number;
  failed: number;
  lines: string[];
  error?: string;
};

export async function runOnce(): Promise<RunResult> {
  if (!hiringConfigured())
    return {
      ok: false,
      armed: false,
      considered: 0,
      sent: 0,
      drafted: 0,
      failed: 0,
      lines: [],
      error: "The hiring sub-account is not connected.",
    };
  const s = await settings();
  // GoHighLevel owns sending, so the cockpit does not compose, draft or send.
  // One sender, or every candidate hears everything twice.
  if (s.sender === "gohighlevel")
    return {
      ok: true,
      armed: false,
      considered: 0,
      sent: 0,
      drafted: 0,
      failed: 0,
      lines: [
        "GoHighLevel sends the candidate messages, so the cockpit stood down.",
      ],
    };
  const m = await meta();
  const todo = await pending();
  const result: RunResult = {
    ok: true,
    armed: s.armed,
    considered: todo.length,
    sent: 0,
    drafted: 0,
    failed: 0,
    lines: [],
  };
  if (!todo.length) return result;
  const values = await valuesByName(m.location);

  for (const p of todo) {
    const role = roleByKey(p.role);
    if (!role) continue;
    if (!s.actions[p.action]) {
      result.lines.push(`${p.name}: ${p.action} is switched off, left alone.`);
      continue;
    }
    const msg = compose(TEMPLATES[p.action], varsFor(role, p.name, values));
    // A message that needs a link Aziz has not filled in is not sent half made.
    const missing =
      (p.action === "group_invite" &&
        !values.get("hiring - group interview booking link")?.trim()) ||
      (p.action === "test_project" &&
        !values.get("hiring - one-to-one booking link")?.trim());
    if (missing) {
      result.failed += 1;
      result.lines.push(
        `${p.name}: ${p.action} needs a booking link that is not set in GoHighLevel custom values.`,
      );
      continue;
    }
    if (!s.armed) {
      result.drafted += 1;
      await record(
        p,
        false,
        `Drafted, not sent (the engine is disarmed).\n${msg.subject}\n\n${msg.body}\n\nShort form, for SMS and WhatsApp: ${msg.sms}`,
        "the cockpit",
      );
      result.lines.push(`${p.name}: ${p.action} drafted.`);
      continue;
    }
    const sentOn: string[] = [];
    const refused: string[] = [];
    const send = async (type: string, body: Record<string, unknown>) => {
      await ghlOk("POST", "/conversations/messages", {
        body: { type, contactId: p.contactId, ...body },
      });
    };
    try {
      if (s.email)
        await send("Email", {
          subject: msg.subject,
          html: msg.body.replace(/\n/g, "<br>"),
          message: msg.body,
        })
          .then(() => sentOn.push("email"))
          .catch(e => refused.push(`email: ${(e as Error).message}`));
      if (s.sms)
        await send("SMS", { message: msg.sms })
          .then(() => sentOn.push("SMS"))
          .catch(async e => {
            refused.push(`SMS: ${(e as Error).message}`);
            // The phone rail is the one that gets read, so try the other way
            // to a phone before giving up on it.
            if (s.whatsappFallback)
              await send("WhatsApp", { message: msg.sms })
                .then(() => sentOn.push("WhatsApp"))
                .catch(e2 =>
                  refused.push(`WhatsApp: ${(e2 as Error).message}`),
                );
          });
      if (!sentOn.length)
        throw new Error(refused.join("; ") || "no rail is switched on");
      result.sent += 1;
      await record(
        p,
        true,
        `Sent on ${sentOn.join(" and ")}${refused.length ? ` (refused: ${refused.join("; ")})` : ""}.\n${msg.subject}\n\n${msg.body}\n\nShort form: ${msg.sms}`,
        "the cockpit",
      );
      result.lines.push(
        `${p.name}: ${p.action} sent on ${sentOn.join(" and ")}.`,
      );
    } catch (e) {
      result.failed += 1;
      await record(
        p,
        false,
        `Could not send: ${(e as Error).message}`,
        "the cockpit",
      );
      result.lines.push(
        `${p.name}: ${p.action} failed, ${(e as Error).message}`,
      );
    }
  }
  return result;
}

export const run = internalAction({
  args: {},
  returns: v.any(),
  // The recruiting agent and its calibration live on the VPS now
  // (`radar.py hiring`), so this job only sends.
  handler: async (): Promise<RunResult> => runOnce(),
});

/** What the engine would do right now, without doing it. */
export const preview = internalAction({
  args: {},
  returns: v.any(),
  handler: async () => {
    const s = await settings();
    const m = await meta();
    const todo = await pending();
    const values = await valuesByName(m.location);
    return {
      settings: s,
      pending: todo.map(p => {
        const role = roleByKey(p.role);
        const msg = role
          ? compose(TEMPLATES[p.action], varsFor(role, p.name, values))
          : null;
        return {
          name: p.name,
          role: p.role,
          stage: stageName(p.toStage),
          action: p.action,
          enabled: s.actions[p.action],
          subject: msg?.subject ?? "",
          body: msg?.body ?? "",
        };
      }),
    };
  },
});

/** One sample of every message, filled from the custom values, for a read through. */
export const samples = internalAction({
  args: { role: v.optional(v.string()) },
  returns: v.any(),
  handler: async (_ctx, args) => {
    const m = await meta();
    const values = await valuesByName(m.location);
    const roles: Role[] = args.role
      ? ROLES.filter(r => r.key === args.role)
      : ROLES;
    return roles.map(role => ({
      role: role.key,
      messages: (Object.keys(TEMPLATES) as Action[]).map(a => ({
        action: a,
        ...compose(TEMPLATES[a], varsFor(role, "Sara Al Fulan", values)),
      })),
    }));
  },
});
