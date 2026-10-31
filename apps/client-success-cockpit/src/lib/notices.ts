import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { NoticeRead, NoticeView } from "@/forms/formConfig";

/**
 * The cockpit's own Slack notices, as a browser reads and edits them
 * (docs/forms/STAGE1-CONTRACT.md 2.1, supabase/migrations/
 * 20261025n_slack_notices.sql): one card's notices for the trails, and the
 * Notices and routing settings (D17). Seven gated RPCs through the
 * signed-in seat's own client; the database checks every gate and writes
 * every audit row. Nothing here talks to Slack: a test and a new channel
 * are rows the sender picks up within a minute.
 */

export type { NoticeRead, NoticeView } from "@/forms/formConfig";

type Rpc = Pick<SupabaseClient, "rpc">;

/** A refusal from the server, in its own words, with its Postgres code. */
export class NoticeError extends Error {
  code: string | null;
  constructor(message: string, code: string | null = null) {
    super(message);
    this.code = code;
  }
}

/** The seat has no right to see notices at all (the viewer gate). */
export const noAccess = (e: unknown) =>
  e instanceof NoticeError &&
  (e.code === "42501" ||
    /access is required|not on your access list/i.test(e.message));

function plain(error: { message?: string; code?: string } | null): never {
  const m = String(error?.message ?? "").trim();
  const code = error?.code ?? null;
  if (/could not find the function|PGRST202|schema cache/i.test(m))
    throw new NoticeError(
      "The Slack notices are not live in the cockpit yet. Tell the tech lead.",
      code,
    );
  if (/JWT|not authenticated/i.test(m))
    throw new NoticeError("Sign in again, then try once more.", code);
  if (/Failed to fetch|NetworkError|network/i.test(m))
    throw new NoticeError(
      "No connection. Nothing was changed; try again when you are back online.",
      code,
    );
  throw new NoticeError(m || "The server gave no reason.", code);
}

/**
 * Why a read failed, as a short cause with no advice of its own: the screen
 * that shows it gives the one thing to do (read again, then the tech lead).
 */
export function readProblem(e: unknown): string {
  const m = (e instanceof Error ? e.message : String(e ?? "")).trim();
  if (/No connection|Failed to fetch|NetworkError|network/i.test(m))
    return "the cockpit could not reach the server";
  if (
    /not live in the cockpit yet|could not find the function|PGRST202|schema cache/i.test(
      m,
    )
  )
    return "the Slack notices are not live in the cockpit yet";
  if (/Sign in again|JWT|not authenticated/i.test(m))
    return "your sign-in has ended, so sign in again first";
  if (/shape this page does not read/i.test(m))
    return "the server answered in a shape this page does not read";
  // The server's own words, first sentence only, without a full stop.
  const first = m
    .split(/(?<=[.!?])\s/)[0]
    ?.replace(/[.!?]+$/, "")
    .trim();
  return first
    ? first.charAt(0).toLowerCase() + first.slice(1)
    : "the server gave no reason";
}

const nul = <T extends z.ZodType>(s: T) =>
  s.nullish().transform(v => (v ?? null) as z.output<T> | null);

const STATES = [
  "queued",
  "sending",
  "posted",
  "failed",
  "unknown",
  "skipped",
  "muted",
] as const;

export const noticeView: z.ZodType<NoticeView> = z.object({
  id: z.string(),
  kind: z.string(),
  state: z.enum(STATES),
  variant: nul(z.string()),
  responseId: nul(z.string()),
  outboxId: nul(z.string()),
  parentKind: nul(z.string()),
  channel: nul(z.object({ id: z.string(), name: nul(z.string()) })),
  at: z.string(),
  dueAt: nul(z.string()),
  permalink: nul(z.string()),
  reason: nul(z.string()),
});

const noticeRead: z.ZodType<NoticeRead> = z.object({
  taskId: z.string(),
  now: z.string(),
  notices: z.array(noticeView),
});

/**
 * The ten notice kinds, in the settings' order: Stage 1's eight (contract
 * 2.1), then the 1-1 notes' two (docs/forms/STAGE2B-CONTRACT.md 4.2, 5.4).
 */
export const NOTICE_KINDS = [
  "kickoff",
  "kickoff.late",
  "kickoff.second",
  "kickoff.updated",
  "blueprint.close",
  "blueprint.media",
  "blueprint.updated",
  "blueprint.offer",
  "checkin.grade",
  "checkin.recap_late",
] as const;

/**
 * The Call grade posts only in a private channel and tags nobody: the
 * server refuses anything else (STAGE2B-CONTRACT.md 4.2, settings_set), and
 * the card offers nothing else.
 */
export const PRIVATE_ONLY_KINDS: ReadonlySet<string> = new Set([
  "checkin.grade",
]);
export type NoticeKind = (typeof NOTICE_KINDS)[number];

/** The three seats a notice may tag. */
export const SEAT_RULES = [
  "seat:creative",
  "seat:csm",
  "seat:systems_manager",
] as const;
export type SeatRule = (typeof SEAT_RULES)[number];

export const SEAT_LABEL: Record<SeatRule, string> = {
  "seat:creative": "the creative director",
  "seat:csm": "the CSM",
  "seat:systems_manager": "the systems manager",
};

const setting = z.object({
  kind: z.string(),
  shape: z.enum(["post", "reply", "variant"]),
  on: z.boolean(),
  fixedOn: z.boolean().optional().default(false),
  channel: nul(z.object({ id: z.string(), name: nul(z.string()) })),
  mentionRule: z.array(z.string()),
  // `label` is the first name and role for an editor's picker, the role for
  // everyone else; `role` is what the team's sentence says ("the project
  // manager"); `slack` is what the next notice does with them (contract X4).
  mentionPeople: z.array(
    z
      .object({
        id: z.number(),
        label: z.string(),
        role: z.string().optional(),
        slack: z
          .enum(["ok", "checking", "not_found", "refused", "unchecked"])
          .optional()
          .default("unchecked"),
        slackKnown: z.boolean().optional().default(false),
      })
      .transform(p => ({ ...p, role: p.role ?? p.label })),
  ),
  tags: z
    .array(
      z.object({
        rule: z.string(),
        found: z.boolean(),
        slackKnown: z.boolean(),
        checking: z.boolean().optional().default(false),
      }),
    )
    .optional()
    .default([]),
  updatedBy: nul(z.string()),
  updatedAt: nul(z.string()),
  last: nul(noticeView),
});

const channel = z.object({
  id: z.string(),
  name: nul(z.string()),
  private: nul(z.boolean()),
  state: z.enum(["checking", "ok", "refused", "removed"]),
  note: nul(z.string()),
  checkedAt: nul(z.string()),
  inUse: z.boolean().optional().default(false),
});

const settingsRead = z.object({
  can: z.object({ edit: z.boolean(), editors: z.boolean() }),
  notices: z.array(setting),
  channels: z.array(channel),
  people: z.array(z.object({ id: z.number(), label: z.string() })),
  editors: z.array(z.object({ memberId: z.string(), label: z.string() })),
  members: z.array(z.object({ memberId: z.string(), label: z.string() })),
  test: nul(
    z.object({
      id: z.string(),
      kind: z.string(),
      state: z.enum(STATES),
      at: z.string(),
      reason: nul(z.string()),
    }),
  ),
  now: z.string(),
});

export type NoticeSetting = z.infer<typeof setting>;
export type SlackChannel = z.infer<typeof channel>;
export type SettingsRead = z.infer<typeof settingsRead>;

/** What a settings row's save may change (cockpit_slack_notice_settings_set). */
export type SettingsPatch = Partial<{
  on: boolean;
  channel: string;
  mentionRule: SeatRule[];
  mentionPeople: number[];
}>;

function parse<T>(schema: z.ZodType<T>, data: unknown, what: string): T {
  const out = schema.safeParse(data);
  if (!out.success)
    throw new NoticeError(
      `The ${what} came back in a shape this page does not read. Refresh the page; if it stays, tell the tech lead.`,
    );
  return out.data;
}

async function call<T>(
  client: Rpc,
  fn: string,
  args: Record<string, unknown> | undefined,
  schema: z.ZodType<T>,
  what: string,
): Promise<T> {
  const { data, error } = await (args === undefined
    ? client.rpc(fn)
    : client.rpc(fn, args));
  if (error) plain(error);
  return parse(schema, data, what);
}

/** 1. One card's notices, newest first, without their text. */
export function readNotices(client: Rpc, taskId: string): Promise<NoticeRead> {
  return call(
    client,
    "cockpit_slack_notice_read",
    { p_task_id: taskId },
    noticeRead,
    "Slack notice",
  );
}

/** 2. Notices and routing: every kind, the channels, who may change them. */
export function readNoticeSettings(client: Rpc): Promise<SettingsRead> {
  return call(
    client,
    "cockpit_slack_notice_settings_read",
    undefined,
    settingsRead,
    "notice settings",
  );
}

/** 3. One kind's change; the server refuses anything out of place. */
export function setNoticeSetting(
  client: Rpc,
  kind: string,
  patch: SettingsPatch,
): Promise<SettingsRead> {
  return call(
    client,
    "cockpit_slack_notice_settings_set",
    { p_kind: kind, p_patch: patch },
    settingsRead,
    "notice settings",
  );
}

/** 4. A channel to check: the sender confirms the bot is in it within a minute. */
export function addSlackChannel(
  client: Rpc,
  id: string,
  name: string | null,
): Promise<SettingsRead> {
  return call(
    client,
    "cockpit_slack_channel_add",
    { p_channel: id, p_name: name },
    settingsRead,
    "notice settings",
  );
}

/** 5. A channel off the list (refused while a notice posts there). */
export function removeSlackChannel(
  client: Rpc,
  id: string,
): Promise<SettingsRead> {
  return call(
    client,
    "cockpit_slack_channel_remove",
    { p_channel: id },
    settingsRead,
    "notice settings",
  );
}

const rehearsal = z.object({
  id: z.string(),
  state: z.string(),
  note: nul(z.string()),
});

/** 6. "Send a test to me": a rehearsal row for the caller's own DM. */
export function rehearseNotice(
  client: Rpc,
  kind: string,
): Promise<z.infer<typeof rehearsal>> {
  return call(
    client,
    "cockpit_slack_notice_rehearse",
    { p_kind: kind },
    rehearsal,
    "test",
  );
}

/** 7. Who may change these, beyond the CEO and admins. */
export function setFormsEditor(
  client: Rpc,
  memberId: string,
  on: boolean,
): Promise<SettingsRead> {
  return call(
    client,
    "cockpit_forms_editor_set",
    { p_member_id: memberId, p_on: on },
    settingsRead,
    "notice settings",
  );
}

// ------------------------------------------------------------ the words

const KUWAIT_MS = 3 * 3_600_000;
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function kuwait(iso: string | null | undefined) {
  const ms = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms + KUWAIT_MS);
  return {
    day: d.toISOString().slice(0, 10),
    label: `${WEEKDAY[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}`,
    time: d.toISOString().slice(11, 16),
  };
}

/** "14:03" on the same Kuwait day as `now`, else "Sun 25 Oct, 14:03". */
export function noticeWhen(
  iso: string | null | undefined,
  now: string,
): string {
  const k = kuwait(iso);
  if (!k) return "";
  return k.day === kuwait(now)?.day ? k.time : `${k.label}, ${k.time}`;
}

/** "at 14:03", or "on Sun 25 Oct, 14:03". */
export function atNoticeWhen(
  iso: string | null | undefined,
  now: string,
): string {
  const k = kuwait(iso);
  if (!k) return "";
  return k.day === kuwait(now)?.day
    ? `at ${k.time}`
    : `on ${k.label}, ${k.time}`;
}

const clause = (s: string | null | undefined) =>
  String(s ?? "")
    .trim()
    .replace(/\.\s*$/, "");

/** A notice's place, "#csm-general", or "Slack" when the name is unknown. */
export const placeOf = (n: Pick<NoticeView, "channel">) =>
  n.channel?.name
    ? `#${n.channel.name}`
    : n.channel?.id
      ? n.channel.id
      : "Slack";

export type NoticeTone = "good" | "warn" | "neutral" | "accent";

/** "Tell the tech lead.", unless the reason already says who to tell. */
const tell = (reason: string) =>
  /tech lead/i.test(reason) ? "" : " Tell the tech lead.";

/** A reason as a sentence of its own, after the stop's own lead. */
export const asSentence = (reason: string) =>
  `${reason.charAt(0).toUpperCase()}${reason.slice(1)}.`;

/**
 * One notice as a stop on a trail (STAGE1-CONTRACT.md 6.1): "Posted in
 * #csm-general at 14:03", "Not posted in #media-general. {Reason}. Tell the
 * tech lead.", or what it waits for. "Reply posted" only for a post that
 * went in a thread (variant `thread`): a reply whose first notice did not
 * post goes top level (variant `top`) and says "Posted". A stop that needs a
 * person has a `lead` ("Not posted in #media-general."): the screens draw it
 * in the warning tone and the reason after it as a plain sentence, the
 * kickoff trail's treatment.
 */
export function noticeStop(
  n: NoticeView,
  now: string,
  opts: { offLine?: string } = {},
): { text: string; tone: NoticeTone; href: string | null; lead?: string } {
  const where = placeOf(n);
  const reason = clause(n.reason) || "no reason was given";
  switch (n.state) {
    case "posted":
      return {
        text: `${n.variant === "thread" ? "Reply posted" : "Posted"} in ${where} ${atNoticeWhen(n.at, now)}`,
        tone: "good",
        href: n.permalink,
      };
    case "queued": {
      // The server's own words for what it waits for ("Waiting for its
      // first notice."), or plainly queued.
      const why = clause(n.reason);
      return {
        text:
          !why || /^queued$/i.test(why)
            ? `Queued to post in ${where}.`
            : `${why}.`,
        tone: "accent",
        href: null,
      };
    }
    case "sending":
      return { text: `Posting in ${where} now.`, tone: "accent", href: null };
    case "failed": {
      const lead = `Not posted in ${where}.`;
      return {
        text: `${lead} ${asSentence(reason)}${tell(reason)}`,
        tone: "warn",
        href: null,
        lead,
      };
    }
    // It may have reached Slack (X17): the sender never posts it twice.
    case "unknown": {
      const lead = `Not confirmed in ${where}.`;
      return {
        text: `${lead} ${asSentence(reason)}${tell(reason)}`,
        tone: "warn",
        href: null,
        lead,
      };
    }
    case "muted":
      return {
        text: opts.offLine ?? "Not posted: this notice is off in Settings.",
        tone: "neutral",
        href: null,
      };
    case "skipped":
      return {
        text: `Not posted. ${asSentence(reason)}`,
        tone: "neutral",
        href: null,
      };
  }
}
