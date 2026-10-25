/**
 * The doctor (contract 4.6) and the channel check the run shares with it
 * (4.3 step 2). The doctor refuses a token that is not mahara-club-bot's: it
 * then checks no channel and looks nobody up, so a wrong bot's membership is
 * never recorded as ours. Its only writes are receipts and
 * cockpit_slack_channel_checked for each channel it could check.
 */
import type { SlackTools } from "../cockpit-csm-api/tools.ts";
import { cachedLookup, labelOf, type Mention, readMention } from "./mentions.ts";
import { BAD_TOKEN, isTokenCode, NO_TOKEN, type NoticeDeps, slackFor } from "./send.ts";

export type ChannelVerdict = { ok: boolean | null; name: string; private: boolean | null; member: boolean; note: string };

const MEMBER = "mahara-club-bot is in it.";
const hasScope = (scopes: string | null, scope: string) => !!scopes && scopes.split(",").map(s => s.trim()).includes(scope);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Is the bot in this channel, and can its posts be checked? `ok: null` means
 * Slack did not answer, or refused the token: the channel stays as it is.
 */
export async function checkChannel(slack: SlackTools, id: string, knownName: string | null): Promise<ChannelVerdict> {
  const info = await slack.info(id);
  if (info.ok) {
    const name = info.name ?? knownName ?? id;
    if (info.isArchived) return { ok: false, name, private: info.isPrivate, member: info.isMember, note: `#${name} is archived, so nothing can post there. Choose another channel.` };
    if (!info.isMember) return { ok: false, name, private: info.isPrivate, member: false, note: `Invite @mahara-club-bot to #${name}, then add it again.` };
    if (!info.isPrivate && info.scopes && !hasScope(info.scopes, "channels:history")) {
      return { ok: false, name, private: false, member: true, note: `The bot cannot read #${name}, so its posts cannot be checked. Use a private channel, or add channels:history to the Slack app.` };
    }
    return { ok: true, name, private: info.isPrivate, member: true, note: MEMBER };
  }
  const name = knownName ?? id;
  const notFound = `Slack shows no channel ${id} to the bot. If it is private, invite @mahara-club-bot first, then add it again.`;
  if (info.code === "channel_not_found") return { ok: false, name, private: null, member: false, note: notFound };
  if (info.code === "missing_scope") {
    const read = await slack.history(id, { limit: 1 });
    if (read.kind === "ok") return { ok: true, name, private: id.startsWith("G") ? true : null, member: true, note: MEMBER };
    if (read.kind === "refused" && read.code === "not_in_channel") return { ok: false, name, private: null, member: false, note: `Invite @mahara-club-bot to #${name}, then add it again.` };
    if (read.kind === "refused" && read.code === "channel_not_found") return { ok: false, name, private: null, member: false, note: notFound };
    if (read.kind === "refused" && read.code === "missing_scope") {
      return { ok: false, name, private: null, member: false, note: "Slack refused the check: the bot lacks a permission. The tech lead adds it to the Slack app." };
    }
    return { ok: null, name, private: null, member: false, note: "Slack did not answer the check. It is checked again on the next run." };
  }
  if (info.code === "no_answer" || info.code === "ratelimited" || isTokenCode(info.code)) {
    return { ok: null, name, private: null, member: false, note: "Slack did not answer the check. It is checked again on the next run." };
  }
  return { ok: false, name, private: null, member: false, note: `Slack refused the check (${info.code}). Add the channel again once the tech lead has looked.` };
}

/** Record a verdict; `ok: null` records nothing. */
export async function recordChannel(deps: NoticeDeps, id: string, v: ChannelVerdict): Promise<boolean> {
  if (v.ok === null) return false;
  await deps.rpc("cockpit_slack_channel_checked", { p_id: id, p_ok: v.ok, p_name: v.name === id ? null : v.name, p_private: v.private, p_note: v.note.slice(0, 240) });
  return true;
}

export type Doctor = {
  ok: boolean;
  bot: { userId: string | null; ok: boolean };
  missingScopes: string[];
  channels: { id: string; name: string | null; private: boolean | null; member: boolean; ok: boolean; note: string }[];
  mentions: { kind: string; rule: string; people: { label: string; slack: "ok" | "not_found" | "refused" | "unknown" | "none" }[]; ok: boolean }[];
  secrets: { SLACK_BOT_TOKEN: boolean; CLICKUP_API_TOKEN: boolean; NOTICES_CRON_SECRET: boolean };
  note: string;
};

type Inputs = { channels: { id: string; name: string | null; private: boolean | null; state: string }[]; settings: { kind: string; enabled: boolean; channel: string | null; mentions: Mention[] }[] };

function readInputs(v: unknown): Inputs {
  const o = isObj(v) ? v : {};
  return {
    channels: (Array.isArray(o.channels) ? o.channels : []).filter(isObj).filter(c => typeof c.id === "string").map(c => ({
      id: String(c.id), name: typeof c.name === "string" ? c.name : null, private: typeof c.private === "boolean" ? c.private : null, state: typeof c.state === "string" ? c.state : "",
    })),
    settings: (Array.isArray(o.settings) ? o.settings : []).filter(isObj).filter(s => typeof s.kind === "string").map(s => ({
      kind: String(s.kind), enabled: s.enabled !== false, channel: typeof s.channel === "string" ? s.channel : null,
      mentions: Array.isArray(s.mentions) ? s.mentions.map(readMention).filter((m): m is Mention => !!m) : [],
    })),
  };
}

export async function runDoctor(deps: NoticeDeps): Promise<Doctor> {
  const secrets = deps.secrets();
  const token = deps.slackToken().trim();
  let inputs: Inputs;
  try {
    inputs = readInputs(await deps.rpc("cockpit_slack_notice_doctor_inputs", {}));
  } catch (e) {
    return {
      ok: false, bot: { userId: null, ok: false }, missingScopes: [], channels: [], mentions: [], secrets,
      note: `The notice settings could not be read (${e instanceof Error ? e.message.slice(0, 160) : "no answer"}). Check the migration 20261025n is applied.`,
    };
  }
  const listed = (note: string) => inputs.channels.map(c => ({ id: c.id, name: c.name, private: c.private, member: false, ok: false, note }));
  const notChecked = () => inputs.settings.flatMap(s => byRule(s.mentions).map(([rule, ms]) => ({
    kind: s.kind, rule,
    people: ms.filter(m => !m.missing).map(m => ({ label: labelOf(m), slack: m.slackId ? ("ok" as const) : ("none" as const) })),
    ok: !s.enabled || (!ms.some(m => m.missing) && ms.every(m => !!m.slackId)),
  })));

  if (!token) {
    return { ok: false, bot: { userId: null, ok: false }, missingScopes: [], channels: listed("Not checked: SLACK_BOT_TOKEN is not set."), mentions: notChecked(), secrets, note: `${NO_TOKEN} The tech lead sets it.` };
  }
  const slack = slackFor(deps, token, "doctor");
  const auth = await slack.authTest();
  const botOk = auth.ok && auth.userId === deps.botUser().trim();
  if (!botOk) {
    const note = !auth.ok
      ? isTokenCode(auth.code) ? BAD_TOKEN : `Slack did not answer the token check (${auth.code}). Run the doctor again.`
      : `The Slack token is ${auth.userId ?? "an unknown user"}, not mahara-club-bot (${deps.botUser()}), so nothing is posted. The tech lead sets SLACK_BOT_TOKEN again.`;
    return { ok: false, bot: { userId: auth.ok ? auth.userId : null, ok: false }, missingScopes: [], channels: listed("Not checked: the token is not mahara-club-bot."), mentions: notChecked(), secrets, note };
  }

  const scopes = auth.scopes;
  const needed = ["chat:write", "groups:history", "users:read.email", ...(inputs.channels.some(c => c.private === false) ? ["channels:history"] : [])];
  const missingScopes = scopes ? needed.filter(s => !hasScope(scopes, s)) : [];

  const channels: Doctor["channels"] = [];
  for (const c of inputs.channels) {
    const v = await checkChannel(slack, c.id, c.name);
    await recordChannel(deps, c.id, v);
    channels.push({ id: c.id, name: v.name === c.id ? c.name : v.name, private: v.private ?? c.private, member: v.member, ok: v.ok === true, note: v.note });
  }

  const lookup = cachedLookup(email => slack.lookupByEmail(email));
  const mentions: Doctor["mentions"] = [];
  for (const s of inputs.settings) {
    for (const [rule, ms] of byRule(s.mentions)) {
      const people: Doctor["mentions"][number]["people"] = [];
      for (const m of ms) {
        if (m.missing) continue;
        if (m.slackId) people.push({ label: labelOf(m), slack: "ok" });
        else if (m.email) people.push({ label: labelOf(m), slack: (await lookup(m.email)).state });
        else people.push({ label: labelOf(m), slack: "none" });
      }
      mentions.push({ kind: s.kind, rule, people, ok: !s.enabled || (people.length > 0 && people.every(p => p.slack === "ok")) });
    }
  }

  const problems: string[] = [];
  for (const [name, set] of Object.entries(secrets)) if (!set) problems.push(`${name} is not set on cockpit-notices.`);
  if (!scopes) problems.push("Slack did not list the token's scopes, so they could not be checked.");
  if (missingScopes.length) problems.push(`The Slack app lacks ${missingScopes.join(", ")}. The tech lead adds ${missingScopes.length === 1 ? "it" : "them"}.`);
  for (const c of channels) if (!c.ok) problems.push(`#${c.name ?? c.id}: ${c.note}`);
  for (const m of mentions) {
    if (m.ok) continue;
    problems.push(m.people.length ? `The ${m.kind} notice cannot tag ${m.people.find(p => p.slack !== "ok")?.label ?? "everyone"} in Slack.` : `Nobody is in the seat the ${m.kind} notice tags (${m.rule}).`);
  }
  const ok = problems.length === 0;
  return { ok, bot: { userId: auth.userId, ok: true }, missingScopes, channels, mentions, secrets, note: ok ? "Everything the notices need is in place." : problems.join(" ").slice(0, 1000) };
}

/** The mentions of a settings row grouped by rule, in first-seen order. */
function byRule(ms: Mention[]): [string, Mention[]][] {
  const out = new Map<string, Mention[]>();
  for (const m of ms) out.set(m.rule, [...(out.get(m.rule) ?? []), m]);
  return [...out.entries()];
}
