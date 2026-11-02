import { sql, TRIAGE } from "./sb.js";
import { addDays, monthStart } from "./time.js";
/**
 * The client's voice for the CEO refresh (docs/forms/WAVE34-CONTRACT.md 3.5,
 * 4.6.4, 6.4): every NPS, onboarding survey (CSAT) and portal feedback answer
 * from cockpit_client_voice_v, the answered NPS invites from the invite events
 * (the second source), and the daily invite counts from
 * cockpit_form_invites_daily_v. All three are read through the read-only role;
 * the two views call no function (20261102c), the event read names tables
 * only.
 *
 * The NPS number, per window: each card counts once, with its latest NPS
 * answer in the window; NPS = round(100 x (promoters 9-10 - detractors 0-6) /
 * n). No answers is "No scores yet" and a NULL score, never 0. The second
 * source is the count of distinct cards with an answered NPS invite in the
 * same window (two tables, written by different steps); when it differs from
 * n the note says both. CSAT is the average of onboarding answers (1 to 10),
 * kept apart from NPS; a portal feedback rating (1 to 5) never enters either.
 * Legacy Typeform answers (no card), canary answers (shadow) and canary
 * invites never reach these reads.
 */
export const VOICE_VIEW = "cockpit_client_voice_v";
export const VOICE_DAILY_VIEW = "cockpit_form_invites_daily_v";
/** About 13 months of history: the longest window the tab offers is 12 months. No limit word (the transport reads it as a cap). */
const HISTORY_DAYS = 400;
export const VOICE_SQL = {
  answers: `select v.response_id::text as response_id, v.clickup_task_id, v.form_key, v.submitted_day::text as day,
  floor(extract(epoch from v.submitted_at) * 1000)::bigint as at_ms, v.score, v.band, v.round
  from public.${VOICE_VIEW} v
  where v.submitted_day >= ((now() at time zone 'UTC') + interval '3 hours')::date - ${HISTORY_DAYS}
  order by v.submitted_at, v.response_id`,
  answered: `select i.task_id, ((e.at at time zone 'UTC') + interval '3 hours')::date::text as day
  from public.cockpit_form_invite_events e join public.cockpit_form_invites i on i.id = e.invite_id
  where e.event = 'answered' and i.form_key = 'nps' and i.origin <> 'canary'
    and e.at >= now() - interval '${HISTORY_DAYS + 1} days'
  order by e.at, e.id`,
  daily: `select d.day::text as day, d.form_key, d.issued, d.answered
  from public.${VOICE_DAILY_VIEW} d
  where d.day >= ((now() at time zone 'UTC') + interval '3 hours')::date - ${HISTORY_DAYS}
  order by d.day, d.form_key`,
  /** Old Typeform NPS and CSAT answers with no card: counted live for the note, never scored. */
  legacy: `select count(*)::integer as n from public.cockpit_form_responses r
  where r.form_key in ('nps', 'csat') and r.state = 'legacy' and r.task_id is null`,
};
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const FORMS = new Set(["nps", "csat", "portal_feedback"]);
const intOrNull = x => {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(x);
  return Number.isInteger(n) ? n : null;
};

/** The view's rows to answers. A row with no card, day or known form throws: a broken read is not "none". */
export function answersOf(rows) {
  return (rows ?? []).map(r => {
    const taskId = String(r?.clickup_task_id ?? "");
    const day = String(r?.day ?? "").slice(0, 10);
    const form = String(r?.form_key ?? "");
    if (!taskId || !ISO_DAY.test(day) || !FORMS.has(form)) throw new Error("A client voice row has no card, day or form");
    const band = r?.band === "promoter" || r?.band === "passive" || r?.band === "detractor" ? r.band : null;
    return { taskId, form, day, at: intOrNull(r?.at_ms) ?? 0, score: intOrNull(r?.score), band: form === "nps" ? band : null, round: intOrNull(r?.round) };
  });
}

/** The answered-invite rows to {taskId, day}. */
export function answeredOf(rows) {
  return (rows ?? []).map(r => {
    const taskId = String(r?.task_id ?? "");
    const day = String(r?.day ?? "").slice(0, 10);
    if (!taskId || !ISO_DAY.test(day)) throw new Error("An answered invite row has no card or day");
    return { taskId, day };
  });
}

/** The daily counts to {day, form, issued, answered}. */
export function dailyOf(rows) {
  return (rows ?? []).map(r => {
    const day = String(r?.day ?? "").slice(0, 10);
    if (!ISO_DAY.test(day)) throw new Error("A daily invite row has no day");
    return { day, form: String(r?.form_key ?? ""), issued: intOrNull(r?.issued) ?? 0, answered: intOrNull(r?.answered) ?? 0 };
  });
}

const inWin = (day, from, to) => day >= from && day <= to;

/** NPS over a window of Kuwait days: each card once with its latest answer, checked against the answered invites. */
export function npsOf(answers, answered, from, to) {
  const latest = new Map();
  for (const a of answers)
    if (a.form === "nps" && a.band && a.score !== null && inWin(a.day, from, to)) {
      const had = latest.get(a.taskId);
      if (!had || a.at > had.at || (a.at === had.at && a.day >= had.day)) latest.set(a.taskId, a);
    }
  let promoters = 0;
  let passives = 0;
  let detractors = 0;
  for (const a of latest.values()) {
    if (a.band === "promoter") promoters++;
    else if (a.band === "passive") passives++;
    else detractors++;
  }
  const n = latest.size;
  const cardsAnswered = new Set(answered.filter(x => inWin(x.day, from, to)).map(x => x.taskId)).size;
  const notes = [];
  if (n === 0) notes.push("No scores yet.");
  if (cardsAnswered !== n) notes.push(`Cards with an answered invite ${cardsAnswered}, cards with an answer ${n}.`);
  return {
    score: n > 0 ? Math.round((100 * (promoters - detractors)) / n) : null,
    n,
    promoters,
    passives,
    detractors,
    cardsAnswered,
    note: notes.join(" "),
  };
}

/** The onboarding survey's average over a window (1 to 10, one decimal), apart from NPS. */
export function csatOf(answers, from, to) {
  const scores = answers.filter(a => a.form === "csat" && a.score !== null && inWin(a.day, from, to)).map(a => a.score);
  const n = scores.length;
  return { average: n ? Math.round((scores.reduce((s, x) => s + x, 0) / n) * 10) / 10 : null, n };
}

/** Invites sent and answered over a window, from the daily counts. */
export function invitesOf(daily, cardsAnswered, from, to) {
  const sum = (form, key) => daily.filter(d => d.form === form && inWin(d.day, from, to)).reduce((s, d) => s + d[key], 0);
  return {
    nps: { sent: sum("nps", "issued"), answered: sum("nps", "answered"), cardsAnswered },
    csat: { sent: sum("csat", "issued"), answered: sum("csat", "answered") },
  };
}

/** The fixed windows the metric table keeps: this month, last month, the last 30 and 90 days (to today, Kuwait). */
export function voiceWindows(today) {
  const start = monthStart(today);
  const lastEnd = addDays(start, -1);
  return {
    mtd: [start, today],
    lastMonth: [monthStart(lastEnd), lastEnd],
    last30: [addDays(today, -29), today],
    last90: [addDays(today, -89), today],
  };
}

/** One window's summary, the shape the tab and the metrics read. */
export function voiceSummary(input, from, to) {
  const nps = npsOf(input.answers, input.answered, from, to);
  return { from, to, nps, csat: csatOf(input.answers, from, to), invites: invitesOf(input.daily, nps.cardsAnswered, from, to) };
}

/** The payload: the rows the tab windows itself (cards, days and scores only: no names, no free text) and the fixed windows. */
export function voicePayload(input, today) {
  const windows = {};
  for (const [w, [from, to]] of Object.entries(voiceWindows(today))) windows[w] = voiceSummary(input, from, to);
  const firstDay = input.answers.reduce((min, a) => (min === null || a.day < min ? a.day : min), null);
  return {
    read: true,
    today,
    firstDay,
    answers: input.answers.map(({ taskId, form, day, at, score, band }) => ({ taskId, form, day, at, score, band })),
    answered: input.answered,
    daily: input.daily,
    legacyUnmatched: Number.isInteger(input.legacyUnmatched) ? input.legacyUnmatched : null,
    windows,
  };
}

/** The source sentence beside the NPS number (SOURCES.md, 6.4). */
export function voiceSourceNote(payload) {
  if (!payload?.read) return `Client voice could not be read this run (${payload?.error ?? "no answer"}), so NPS and the onboarding survey are missing, not zero.`;
  const since = payload.firstDay ? ` since ${payload.firstDay}` : "";
  const n = payload.legacyUnmatched;
  const legacy = Number.isInteger(n) && n > 0
    ? `; the ${n} old Typeform ${n === 1 ? "answer" : "answers"} could not be matched to a client and ${n === 1 ? "is" : "are"} left out`
    : "";
  return `NPS is from the client's own answers in the portal or by WhatsApp link${since}; each client counts once per window with their latest answer; promoters 9-10 minus detractors 0-6, over n answers${legacy}; checked against the count of answered invites. The onboarding survey (1 to 10) and portal feedback are counted apart.`;
}

/** Reads the three sources. Missing is never zero: a failed read says so and the payload carries no numbers. */
export async function readVoice(today) {
  try {
    const [a, e, d, l] = await Promise.all([
      sql(TRIAGE, VOICE_SQL.answers), sql(TRIAGE, VOICE_SQL.answered), sql(TRIAGE, VOICE_SQL.daily), sql(TRIAGE, VOICE_SQL.legacy),
    ]);
    const legacy = intOrNull(l?.[0]?.n);
    if (legacy === null) throw new Error("The old Typeform answer count came back empty");
    return { ok: true, payload: voicePayload({ answers: answersOf(a), answered: answeredOf(e), daily: dailyOf(d), legacyUnmatched: legacy }, today) };
  } catch (err) {
    return { ok: false, error: (err instanceof Error ? err.message : String(err)).replace(/https?:\/\/\S+/g, "").trim().slice(0, 160) };
  }
}
