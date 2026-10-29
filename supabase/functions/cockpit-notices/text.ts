/**
 * The words of every Slack notice (docs/forms/STAGE1-CONTRACT.md 4.5, plan
 * 1.3). Pure and import-free: the sender, the dry run and the rehearsal all
 * build their text here, so a preview is the post.
 *
 * Copy rules: plain lines, sentence case, no exclamation marks, no em dashes,
 * Kuwait time, staff by role. Every line says what the card shows, never what
 * Make is assumed to have done. Only the keys named below are ever read from
 * the facts, so answers, prices, budgets, phone numbers, emails, WhatsApp text
 * and summaries can never reach Slack, whatever a caller passes. Every dynamic
 * string is escaped (& < >), a mention is <@id> only for a real U or W id, and
 * there is never an @channel or @here. `text` (the notification, and what the
 * reconcile searches) always ends with `Ref CN-xxxxxxxx`.
 *
 * One exception, named (docs/forms/STAGE2B-CONTRACT.md 4.2): the call grade's
 * words (its twelve notes and its overall feedback) are read from
 * `cockpit_form_drafts` by the claim, through `live.grade`, never from the
 * outbox's facts, and only for a private channel; the grade tags nobody,
 * whatever mentions are passed, because it is about a person's call.
 */

export type NoticeKind =
  | "kickoff"
  | "kickoff.updated"
  | "blueprint.close"
  | "blueprint.updated"
  | "blueprint.media"
  | "blueprint.offer"
  | "checkin.grade"
  | "checkin.recap_late";
export type Variant = "complete" | "late" | "done" | "reconcile" | "typeform" | "new" | "live" | "thread" | "top" | "grade";
export type TextMention = { label: string; slackId: string | null };
export type NoticeFacts = Record<string, unknown> & {
  ref: string;
  taskId: string;
  client: string;
  mentions?: TextMention[];
  rehearsal?: boolean;
};
export type SlackBlock = Record<string, unknown>;

export const NOTICE_KINDS: readonly NoticeKind[] = [
  "kickoff",
  "kickoff.updated",
  "blueprint.close",
  "blueprint.updated",
  "blueprint.media",
  "blueprint.offer",
  "checkin.grade",
  "checkin.recap_late",
];

/** The variants each kind has wording for. */
export const VARIANTS: Record<NoticeKind, readonly Variant[]> = {
  kickoff: ["complete", "late"],
  "kickoff.updated": ["thread", "top"],
  "blueprint.close": ["done", "reconcile", "typeform"],
  "blueprint.updated": ["thread", "top"],
  "blueprint.media": ["new", "live"],
  "blueprint.offer": ["thread", "top"],
  "checkin.grade": ["grade"],
  "checkin.recap_late": ["late"],
};

/** The five main services, as client-success-cockpit/src/present/blueprintBrief.ts SERVICE_LABEL (a test pins them equal). */
export const SERVICE_LABEL: Record<string, string> = {
  "design-build": "Design and build",
  interior: "Interior design",
  architecture: "Architectural design",
  fitout: "Fit-out and renovation",
  construction: "Construction",
};

export const isNoticeKind = (v: unknown): v is NoticeKind => typeof v === "string" && (NOTICE_KINDS as readonly string[]).includes(v);
export const isVariantOf = (kind: NoticeKind, v: unknown): v is Variant => typeof v === "string" && (VARIANTS[kind] as readonly string[]).includes(v);

// ------------------------------------------------------------------ small helpers

const SLACK_ID = /^[UW][A-Z0-9]{8,12}$/;
/** The card stages with or after Brand Blueprint Booked (formStatus.ts BLUEPRINT_ON, flag i). */
const BLUEPRINT_ON = /brand blueprint booked|launch booked|ready for launch|^\s*active\s*$/i;
const ACTIVE = /^\s*active\s*$/i;
const TASK_ID = /^[A-Za-z0-9_-]{1,40}$/;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const KUWAIT_MS = 3 * 3600_000;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const capital = (s: string): string => (/^[a-z]/.test(s) ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function escapeSlack(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function kuwait(iso: string): Date | null {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms + KUWAIT_MS) : null;
}
const pad = (n: number) => String(n).padStart(2, "0");

/** "Sun 25 Oct, 14:02" in Kuwait time (UTC+3, no daylight saving). */
export function kuwaitWhen(iso: string): string {
  const d = kuwait(iso);
  return d ? `${kuwaitDay(iso)}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : "an unknown time";
}
/** "14:02" in Kuwait time. */
export function kuwaitClock(iso: string): string {
  const d = kuwait(iso);
  return d ? `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : "an unknown time";
}
/** "Sun 1 Nov" in Kuwait time. */
export function kuwaitDay(iso: string): string {
  const d = kuwait(iso);
  return d ? `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` : "an unknown day";
}

/** Letters, numbers, spaces and hyphens only, so "Brand Blueprint Booked♠️" reads "Brand Blueprint Booked". */
export function cleanStatus(s: string): string {
  return String(s).replace(/[^\p{L}\p{N} -]/gu, " ").replace(/\s+/g, " ").trim();
}

export function noticeLinks(taskId: string): { cockpit: string; card: string; blueprint: string; messages: string } {
  const id = encodeURIComponent(taskId);
  return {
    cockpit: `https://cockpit.maharamedia.com/client-success/clients/${id}?tab=onboarding`,
    card: `https://app.clickup.com/t/${id}`,
    blueprint: `https://cockpit.maharamedia.com/client-success/clients/${id}/present/blueprint?view=prep`,
    /** The Messages card on the client's overview (Z45). */
    messages: `https://cockpit.maharamedia.com/client-success/clients/${id}?tab=overview#messages`,
  };
}

const cleanRef = (ref: unknown): string => {
  const r = str(ref).trim();
  return /^CN-[A-Za-z0-9]{8}$/.test(r) ? r : `CN-${r.replace(/^CN-/, "").replace(/[^A-Za-z0-9]/g, "").slice(0, 8) || "unknown0"}`;
};

/** A list in plain words: "a", "a and b", "a, b and c". */
const natural = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/**
 * Who a notice tags, in order: <@id> for a real Slack id, else the role label
 * in plain text (several plain labels in a row read "the CSM and the systems
 * manager").
 */
function whoWords(mentions: TextMention[]): string {
  const parts: (string | string[])[] = [];
  for (const m of mentions) {
    const id = str(m?.slackId);
    if (SLACK_ID.test(id)) {
      parts.push(`<@${id}>`);
      continue;
    }
    const label = escapeSlack(str(m?.label).trim() || "a team member");
    const last = parts[parts.length - 1];
    if (Array.isArray(last)) last.push(label);
    else parts.push([label]);
  }
  return parts.map(p => (Array.isArray(p) ? natural(p) : p)).join(" ");
}

type Who = { mentions: TextMention[]; rehearsal: boolean };

/** A sentence followed by the tags ("Next is the Brand Blueprint call. <@U...>"). A test names who it would tag instead. */
function tail(line: string, who: Who): string {
  if (!who.mentions.length) return line;
  if (who.rehearsal) return `${line} This would tag ${natural(who.mentions.map(m => escapeSlack(str(m.label).trim() || "a team member")))}.`;
  return `${line} ${capital(whoWords(who.mentions))}`;
}

/** Tags leading a line ("<@U...> next: ..."); with nobody to tag the line starts with the next word capitalised. */
function lead(rest: string, who: Who): string {
  if (!who.mentions.length) return capital(rest);
  if (who.rehearsal) return tail(capital(rest), who);
  return `${capital(whoWords(who.mentions))} ${rest}`;
}

const role = (v: unknown, fallback: string) => escapeSlack(str(v).trim() || fallback);

// ------------------------------------------------------------------ the wording

type Link = { url: string; words: string };
type Built = {
  /** The fallback text, without the Ref. */
  text: string;
  lines: string[];
  links: Link[];
  /** Links written inside the section (the media post); left out of a test like the link block. */
  inline: boolean;
  footer: "Client success" | "Media" | null;
  /** Whether a {mentions} slot was used; if not, tags go at the end of the last line. */
  placed: boolean;
};

function filledLine(f: NoticeFacts): string {
  const by = str(f.filledByRole).trim();
  return `Filled ${by ? `by ${escapeSlack(by)}` : "in Typeform"} on ${kuwaitWhen(str(f.submittedAt))}.`;
}

function kickoff(variant: Variant, f: NoticeFacts, who: Who): Built {
  const client = escapeSlack(f.client);
  const l = noticeLinks(f.taskId);
  const links = [{ url: l.cockpit, words: "Open in the cockpit" }, { url: l.card, words: "Open the ClickUp card" }];
  if (variant === "complete") {
    const status = cleanStatus(str(f.clientStatus));
    const lines = [
      `*Kickoff complete: ${client}*`,
      filledLine(f),
      `The card shows ${status ? escapeSlack(status) : "no client status"}${f.blueprintLink === true ? ", and the Brand Blueprint link" : ""}.`,
      str(f.handoffAt) ? `The Kickoff Handoff comment is on the card (${kuwaitClock(str(f.handoffAt))}).` : "The Kickoff Handoff comment is on the card.",
    ];
    if (f.second === true) {
      lines.push("This is the second kickoff for this client. The card has a new Kickoff Handoff comment, so check it for a second Technical and Creative task, and do not send it a third time.");
    }
    lines.push(tail("Next is the Brand Blueprint call.", who));
    return { text: `Kickoff complete: ${client}. Next is the Brand Blueprint call.`, lines, links, inline: false, footer: "Client success", placed: true };
  }
  const unread = f.commentCheck === "unread";
  // The comment is there but the card is not at the Brand Blueprint stage:
  // Make broke after its first step (the card update, module 21, comes later).
  const commented = f.commentCheck === "found";
  const status = cleanStatus(str(f.clientStatus));
  const lines = [
    `*Kickoff in, card not updated: ${client}*`,
    filledLine(f),
    tail(
      commented
        ? BLUEPRINT_ON.test(status)
          ? "The Kickoff Handoff comment is on the card, but the cockpit has not seen the card change since the kickoff. Open the card and check it. Do not send the kickoff again."
          : `The Kickoff Handoff comment is on the card, but 20 minutes after the kickoff the card shows ${status ? escapeSlack(status) : "no client status"}, not Brand Blueprint Booked. Open the card and check it. Do not send the kickoff again.`
        : unread
          ? "The cockpit could not read the card's comments 20 minutes after the kickoff. Open the card and check it for the Kickoff Handoff comment. Do not send the kickoff again."
          : "The card has no Kickoff Handoff comment 20 minutes after the kickoff. Open the card and check it. Do not send the kickoff again.",
      who,
    ),
  ];
  if (f.second === true) lines.push("This is the second kickoff for this client. Do not send it a third time.");
  return { text: `Kickoff in, card not updated: ${client}. Open the card and check it.`, lines, links, inline: false, footer: "Client success", placed: true };
}

// Posted only once the card has both what the late notice missed: the
// Kickoff Handoff comment (the sender checks it) and the Brand Blueprint stage.
function kickoffUpdated(variant: Variant, f: NoticeFacts): Built {
  const at = str(f.cardUpdatedAt);
  const status = cleanStatus(str(f.clientStatus));
  const caught = `It has the Kickoff Handoff comment${status ? ` and shows ${escapeSlack(status)}` : ""}.`;
  if (variant === "thread") {
    const line = `Card updated at ${kuwaitClock(at)}. ${caught}`;
    return { text: line, lines: [line], links: [], inline: false, footer: null, placed: false };
  }
  const client = escapeSlack(f.client);
  return {
    text: `Kickoff card updated: ${client}, at ${kuwaitWhen(at)}.`,
    lines: [`*Kickoff card updated: ${client}*`, `Card updated at ${kuwaitWhen(at)}. ${caught}`],
    links: [{ url: noticeLinks(f.taskId).cockpit, words: "Open in the cockpit" }],
    inline: false,
    footer: "Client success",
    placed: false,
  };
}

function close(variant: Variant, f: NoticeFacts, who: Who): Built {
  const client = escapeSlack(f.client);
  const l = noticeLinks(f.taskId);
  const links = [
    { url: l.cockpit, words: "Open in the cockpit" },
    { url: l.blueprint, words: "Read the Blueprint" },
    { url: l.card, words: "Open the ClickUp card" },
  ];
  if (variant === "reconcile") {
    return {
      text: `Blueprint closed: ${client}. The card update needs a check.`,
      lines: [`*Blueprint closed: ${client}*`, tail("The card update needs a check. Open the call page.", who)],
      links, inline: false, footer: "Client success", placed: true,
    };
  }
  if (variant === "typeform") {
    return {
      text: `Brand Blueprint complete: ${client}. Next is the launch call.`,
      lines: [`*Brand Blueprint complete: ${client}*`, tail("The Blueprint form is in. Next is the launch call.", who)],
      links, inline: false, footer: "Client success", placed: true,
    };
  }
  const phase = Number(f.mapPhase);
  const past5 = Number.isInteger(phase) && phase >= 5;
  const closedBy = `Closed by ${role(f.closedByRole, "the creative director")} on ${kuwaitWhen(str(f.closedAt))}.`;
  // A client already live (the map past phase 4, or the card Active): the
  // same rule as the media notice's live variant, so the two posts agree.
  if (past5 || ACTIVE.test(str(f.clientStatus))) {
    return {
      text: `Brand Blueprint complete: ${client}. The client is already live.`,
      lines: [
        `*Brand Blueprint complete: ${client}*`,
        `${closedBy} The client is already live, so nothing new starts from this close.`,
        past5
          ? lead(`next: the Onboarding Map is already at phase ${phase}, so there is no phase 5 WhatsApp to send and no launch call to book.`, who)
          : lead("next: there is no launch call to book. Check the card before you send the phase 5 WhatsApp from your comment.", who),
      ],
      links, inline: false, footer: "Client success", placed: true,
    };
  }
  const launchAt = str(f.launchCallAt);
  return {
    text: `Brand Blueprint complete: ${client}. Next is the launch call.`,
    lines: [
      `*Brand Blueprint complete: ${client}*`,
      `${closedBy} Scripts and custom creative can start.`,
      lead("next: send the phase 5 WhatsApp from your comment on the card, then book the launch call.", who),
      launchAt && kuwait(launchAt) ? `Launch call booked for ${kuwaitWhen(launchAt)}.` : "Launch call not booked yet.",
    ],
    links, inline: false, footer: "Client success", placed: true,
  };
}

function media(variant: Variant, f: NoticeFacts, rehearsal: boolean): Built {
  const client = escapeSlack(f.client);
  const service = SERVICE_LABEL[str(f.service)];
  const launch = str(f.launchTaskId);
  const linkLine = `<${noticeLinks(f.taskId).card}|card>${TASK_ID.test(launch) ? ` · <https://app.clickup.com/t/${encodeURIComponent(launch)}|launch task>` : ""}`;
  const live = variant === "live";
  const lines = [`*Brand Blueprint completed*`, `Client: ${client}`, `Service focus: ${service ? escapeSlack(service) : "not chosen"}`];
  if (!rehearsal) lines.push(linkLine);
  lines.push(live ? "The client is already live; nothing new starts from this close." : "Scripts and custom creative can start.");
  return {
    text: live ? `Brand Blueprint completed: ${client}. The client is already live.` : `Brand Blueprint completed: ${client}. Scripts and custom creative can start.`,
    lines, links: [], inline: true, footer: "Media", placed: false,
  };
}

function updated(variant: Variant, f: NoticeFacts): Built {
  if (variant === "thread") return { text: "The card update is confirmed.", lines: ["The card update is confirmed."], links: [], inline: false, footer: null, placed: false };
  const client = escapeSlack(f.client);
  return {
    text: `Blueprint card confirmed: ${client}.`,
    lines: [`*Blueprint card confirmed: ${client}*`, "The card update is confirmed."],
    links: [{ url: noticeLinks(f.taskId).cockpit, words: "Open in the cockpit" }],
    inline: false, footer: "Client success", placed: false,
  };
}

function offer(variant: Variant, f: NoticeFacts): Built {
  const sentence = `Offer locked by ${role(f.offeredByRole, "the creative director")}. Brand DNA is ${f.dnaComplete === true ? "complete" : "still missing"}.`;
  if (variant === "thread") return { text: sentence, lines: [sentence], links: [], inline: false, footer: null, placed: false };
  const client = escapeSlack(f.client);
  return {
    text: `Offer locked: ${client}.`,
    lines: [`*Offer locked: ${client}*`, sentence],
    links: [{ url: noticeLinks(f.taskId).cockpit, words: "Open in the cockpit" }],
    inline: false, footer: "Client success", placed: false,
  };
}

// A 1-1 recap still waiting in the cockpit 24 hours after the call (Z43).
function recapLate(f: NoticeFacts): Built {
  const client = escapeSlack(f.client);
  const day = kuwaitDay(str(f.callAt));
  return {
    text: `Recap not sent: ${client}, call ${day}. Open in the cockpit.`,
    lines: [`*Recap not sent: ${client}*`, `The recap for the call on ${day} is still waiting in the cockpit.`],
    links: [{ url: noticeLinks(f.taskId).messages, words: "Open in the cockpit" }],
    inline: false,
    footer: "Client success",
    placed: false,
  };
}

const context = (text: string): SlackBlock => ({ type: "context", elements: [{ type: "mrkdwn", text }] });

/** The twelve criteria of the call grade, in its order (cockpit-forms-api/prompts/grade.ts CRITERIA; a test pins them equal). */
export const CRITERIA = [
  "Rapport",
  "Knowledge",
  "Intro/Outro Execution",
  "Opportunity",
  "Confidence",
  "Professional",
  "Tonality",
  "Clear Flow",
  "Stats",
  "Problem Solving",
  "Expectations",
  "Creating Urgency",
] as const;
/** A section's limit, under Slack's 3,000, so the grade is always one message. */
export const SECTION_MAX = 2900;
const FATHOM_SHARE = /^https:\/\/fathom\.video\/share\/[A-Za-z0-9_-]{1,200}$/;

/** Cut at a word to `max` characters with an ellipsis; never inside a word or an entity. */
export function cutAtWord(s: string, max = SECTION_MAX): string {
  if (s.length <= max) return s;
  const head = s.slice(0, max - 1);
  const space = head.search(/\s\S*$/);
  return `${(space > max / 2 ? head.slice(0, space) : head).trimEnd()}…`;
}

type GradeOut = { criteria: { name: string; score: number; note: string }[]; overall: string; color: string; score: number | null };

/** The grade as the claim read it from the draft, kept to its known keys. */
function gradeOf(v: unknown): GradeOut {
  const g = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const criteria = (Array.isArray(g.criteria) ? g.criteria : [])
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
    .map(c => ({ name: str(c.name), score: Number(c.score), note: str(c.note) }));
  const score = typeof g.score === "number" && Number.isFinite(g.score) ? g.score : null;
  return { criteria, overall: str(g.overall), color: str(g.color), score };
}

/**
 * The call grade: three sections (who took the call and the recording; the
 * twelve criteria in order; the overall feedback), each escaped and then cut
 * at a word, and the context line. It tags nobody. A test leaves the
 * recording link out.
 */
function gradeBlocks(f: NoticeFacts, ref: string, rehearsal: boolean): { text: string; blocks: SlackBlock[] } {
  const client = escapeSlack(f.client);
  const g = gradeOf(f.grade);
  const score = g.score === null ? "no score" : `${g.score.toFixed(1)}/10`;
  const color = escapeSlack(g.color.trim() || "no colour");
  const share = str(f.shareUrl);
  const link = rehearsal ? null : FATHOM_SHARE.test(share) ? `<${share}|Watch the recording>` : "No recording link was stored.";
  const first = [
    `${rehearsal ? "[Rehearsal] " : ""}*Call grade: ${client}*`,
    `Taken by ${role(f.takenByRole, "a team member")}${kuwait(str(f.callAt)) ? ` on ${kuwaitWhen(str(f.callAt))}` : ""}. Score ${score}, ${color}.`,
    ...(link ? [link] : []),
  ];
  const byName = new Map(g.criteria.map(c => [c.name, c]));
  const second = CRITERIA.flatMap(name => {
    const c = byName.get(name);
    if (!c) return [];
    const note = escapeSlack(c.note.trim());
    return [`*${escapeSlack(name)}* ${Number.isFinite(c.score) ? c.score : "?"}/10.${note ? ` ${note}` : ""}`];
  });
  const third = ["*Overall*", escapeSlack(g.overall.trim() || "No overall feedback was stored.")];
  const section = (lines: string[]): SlackBlock => ({ type: "section", text: { type: "mrkdwn", text: cutAtWord(lines.join("\n")) } });
  const blocks: SlackBlock[] = [section(first)];
  if (second.length) blocks.push(section(second));
  blocks.push(section(third));
  if (rehearsal) blocks.push(context("Links are left out of a test."));
  blocks.push(context(`Client success · Graded once per call · Ref ${ref}`));
  const text = `${rehearsal ? "[Rehearsal] " : ""}Call grade: ${client}, ${score}, ${color}. Ref ${ref}`;
  return { text, blocks };
}

/**
 * The fallback text and the blocks for one notice. A test (`rehearsal`)
 * starts with "[Rehearsal] ", tags nobody (it says who it would tag), and
 * leaves the links out.
 */
export function noticeText(kind: NoticeKind, variant: Variant, facts: NoticeFacts): { text: string; blocks: SlackBlock[] } {
  if (!isNoticeKind(kind)) throw new Error(`There is no notice called ${String(kind).slice(0, 40)}.`);
  if (!isVariantOf(kind, variant)) throw new Error(`There is no ${String(variant).slice(0, 20)} wording for ${kind}.`);
  const rehearsal = facts.rehearsal === true;
  const f: NoticeFacts = { ...facts, client: str(facts.client).trim() || "an unnamed card", taskId: str(facts.taskId) };
  // The call grade tags nobody, whatever mentions are passed.
  if (kind === "checkin.grade") return gradeBlocks(f, cleanRef(facts.ref), rehearsal);
  const who: Who = { mentions: Array.isArray(facts.mentions) ? facts.mentions.filter(m => m && typeof m === "object") : [], rehearsal };
  const built =
    kind === "kickoff" ? kickoff(variant, f, who)
    : kind === "kickoff.updated" ? kickoffUpdated(variant, f)
    : kind === "blueprint.close" ? close(variant, f, who)
    : kind === "blueprint.media" ? media(variant, f, rehearsal)
    : kind === "blueprint.updated" ? updated(variant, f)
    : kind === "checkin.recap_late" ? recapLate(f)
    : offer(variant, f);
  const lines = [...built.lines];
  if (!built.placed && who.mentions.length) lines[lines.length - 1] = tail(lines[lines.length - 1], who);
  const ref = cleanRef(facts.ref);
  let text = `${built.text} Ref ${ref}`;
  if (rehearsal) {
    text = `[Rehearsal] ${text}`;
    lines[0] = `[Rehearsal] ${lines[0]}`;
  }
  const blocks: SlackBlock[] = [{ type: "section", text: { type: "mrkdwn", text: lines.join("\n") } }];
  const hasLinks = built.links.length > 0 || built.inline;
  if (rehearsal && hasLinks) blocks.push(context("Links are left out of a test."));
  else if (built.links.length) blocks.push(context(built.links.map(l => `<${l.url}|${l.words}>`).join(" · ")));
  if (built.footer) blocks.push(context(`${built.footer} · Ref ${ref}`));
  return { text, blocks };
}

/** Facts for a test post: "Sample client" and no real ids. */
export function sampleFacts(kind: NoticeKind, now: Date = new Date()): NoticeFacts {
  const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();
  return {
    ref: "CN-sample00",
    taskId: "sample",
    client: "Sample client",
    of: kind,
    submittedAt: at(-6),
    filledByRole: "the CSM",
    clientStatus: "Brand Blueprint Booked",
    blueprintLink: true,
    handoffAt: at(-4),
    commentCheck: "found",
    second: false,
    cardUpdatedAt: at(-2),
    source: "cockpit",
    settled: "done",
    closedAt: at(0),
    closedByRole: "the creative director",
    mapPhase: 4,
    launchCallAt: at(3 * 24 * 60),
    service: "interior",
    launchTaskId: null,
    confirmedAt: at(0),
    offeredAt: at(0),
    offeredByRole: "the creative director",
    dnaComplete: true,
    // The 1-1 notes notices: an invented grade and an invented recap reminder.
    takenByRole: "the CSM",
    callAt: at(-90),
    shareUrl: "https://fathom.video/share/sample-recording",
    recordingShown: true,
    grade: {
      criteria: CRITERIA.map((name, i) => ({ name, score: 6 + (i % 4), note: `Sample note on ${name.toLowerCase()}.` })),
      overall: "Sample overall feedback: a clear call with one next step agreed.",
      color: "Green",
      score: 7.5,
    },
    dueAt: at(0),
  };
}
