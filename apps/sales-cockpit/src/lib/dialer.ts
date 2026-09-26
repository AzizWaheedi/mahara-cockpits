/**
 * The dialer's rules that run in the browser: which leads need a call inside
 * two minutes and how long is left (the call centre's urgent strip), the
 * call-back times a rep picks with one click, and the note a rep is writing,
 * kept per lead for the length of the session.
 */

export interface QueueItem {
  contact_id: string;
  name: string | null;
  phone: string | null;
  stage: string | null;
  lead_class: string | null;
  tier: 0 | 1 | 2 | 3;
  why: string;
  created_at: string | null;
  last_dial_at: string | null;
  due_at: string | null;
  inbound_at: string | null;
  callback_at: string | null;
  demo_at: string | null;
  step: number;
  last_outcome: string | null;
  /** lead: a lead to call; intro: the intro call itself; confirm: a confirmation. */
  kind?: "lead" | "intro" | "confirm";
  heat?: number;
  hot_reasons?: string[];
  hot?: boolean;
  misses?: number;
  stage_role?: string | null;
  appointment?: {
    id: string;
    type: "intro" | "demo";
    start_at: string | null;
    booked_at: string | null;
    assigned_user_id: string | null;
    confirmed: boolean;
  } | null;
}

export interface UrgentEvent {
  key: string;
  contact_id: string;
  name: string | null;
  title: string;
  at: number;
  /** When the call should have happened by. */
  deadline: number;
  callback: boolean;
}

/** The call centre's target: a new lead or a reply is called within two minutes. */
export const DIAL_WITHIN_MS = 2 * 60_000;

const t = (iso: string | null) => {
  const v = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(v) ? v : null;
};

/** The "call now" leads, soonest deadline first. */
export function urgentEvents(items: QueueItem[], now: number): UrgentEvent[] {
  const out: UrgentEvent[] = [];
  for (const i of items) {
    if (i.tier !== 0) continue;
    const start = t(i.appointment?.start_at ?? null);
    if ((i.kind === "intro" || i.kind === "confirm") && start !== null) {
      const intro = i.kind === "intro";
      out.push({
        key: `${i.contact_id}:${i.kind}:${start}`,
        contact_id: i.contact_id,
        name: i.name,
        title: intro
          ? "Intro call"
          : `Confirm the ${i.appointment?.type ?? "call"}`,
        at: start,
        // An intro is due at its start; a confirmation half an hour before it.
        deadline: intro ? start : start - 30 * 60_000,
        callback: true,
      });
      continue;
    }
    const callback = t(i.callback_at);
    if (callback !== null && callback <= now + 5 * 60_000) {
      out.push({
        key: `${i.contact_id}:callback:${callback}`,
        contact_id: i.contact_id,
        name: i.name,
        title: "Call back, as agreed",
        at: callback,
        deadline: callback,
        callback: true,
      });
      continue;
    }
    const inbound = t(i.inbound_at);
    const created = t(i.created_at);
    const replied =
      inbound !== null && (created === null || inbound >= created);
    const at = replied ? inbound : created;
    if (at === null) continue;
    out.push({
      key: `${i.contact_id}:${replied ? "reply" : "new"}:${at}`,
      contact_id: i.contact_id,
      name: i.name,
      title: replied ? "Wrote back" : "New lead",
      at,
      deadline: at + DIAL_WITHIN_MS,
      callback: false,
    });
  }
  return out.sort(
    (a, b) => a.deadline - b.deadline || a.key.localeCompare(b.key),
  );
}

export function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "Dial within 1:42", or how late it is once the target has passed. */
export function countdown(e: UrgentEvent, now: number): string {
  const left = e.deadline - now;
  if (e.callback) {
    if (left > 60_000) return `Due in ${Math.ceil(left / 60_000)} min`;
    if (left > 0) return "Due now";
    const late = Math.floor(-left / 60_000);
    return late >= 1 ? `${late} min overdue` : "Due now";
  }
  if (left > 0) return `Dial within ${mmss(left)}`;
  return `Two-minute target passed, waiting ${Math.max(1, Math.floor((now - e.at) / 60_000))} min`;
}

// ---------------------------------------------------------------------------
// Call-back times
// ---------------------------------------------------------------------------

const KUWAIT = 3 * 3_600_000;

/** A Kuwait wall-clock time on the day of `ms` plus `days`, as epoch ms. */
export function kuwaitAt(ms: number, hour: number, minute = 0, days = 0) {
  const d = new Date(ms + KUWAIT);
  return (
    Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate() + days,
      hour,
      minute,
    ) - KUWAIT
  );
}

/** Friday is the team's day off; a call-back lands on the next working day. */
function workday(ms: number): number {
  const d = new Date(ms + KUWAIT);
  return d.getUTCDay() === 5 ? ms + 86_400_000 : ms;
}

export interface Pick {
  label: string;
  at: number;
}

/** One-click call-back times: in an hour, this evening, tomorrow morning and afternoon. */
export function callbackPicks(now: number): Pick[] {
  const picks: Pick[] = [];
  const inHour = Math.ceil((now + 3_600_000) / 900_000) * 900_000;
  picks.push({ label: "In an hour", at: inHour });
  const evening = kuwaitAt(now, 17);
  if (evening - now >= 90 * 60_000 && workday(evening) === evening)
    picks.push({ label: "Today 17:00", at: evening });
  const morning = workday(kuwaitAt(now, 10, 0, 1));
  const afternoon = workday(kuwaitAt(now, 14, 0, 1));
  const tomorrow = morning === kuwaitAt(now, 10, 0, 1);
  picks.push({
    label: tomorrow ? "Tomorrow 10:00" : "Saturday 10:00",
    at: morning,
  });
  picks.push({
    label: tomorrow ? "Tomorrow 14:00" : "Saturday 14:00",
    at: afternoon,
  });
  return picks;
}

/** A moment as the value of a datetime-local input, in the browser's zone. */
export function localInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// The note being written, per lead, for this session
// ---------------------------------------------------------------------------

export interface Draft {
  outcome: string | null;
  note: string;
  callback: string;
}

const draftKey = (contactId: string) => `sales_dial_draft_${contactId}`;

export function readDraft(contactId: string): Draft {
  try {
    const d = JSON.parse(sessionStorage.getItem(draftKey(contactId)) ?? "null");
    if (d && typeof d === "object")
      return {
        outcome: typeof d.outcome === "string" ? d.outcome : null,
        note: typeof d.note === "string" ? d.note : "",
        callback: typeof d.callback === "string" ? d.callback : "",
      };
  } catch {
    // no draft, or storage is off
  }
  return { outcome: null, note: "", callback: "" };
}

export function writeDraft(contactId: string, d: Draft) {
  try {
    if (!d.outcome && !d.note.trim() && !d.callback)
      sessionStorage.removeItem(draftKey(contactId));
    else sessionStorage.setItem(draftKey(contactId), JSON.stringify(d));
  } catch {
    // storage is off; the note still works, it just forgets on reload
  }
}

export function clearDraft(contactId: string) {
  try {
    sessionStorage.removeItem(draftKey(contactId));
  } catch {
    // nothing to clear
  }
}

// ---------------------------------------------------------------------------
// Alerts: a short sound and, while the tab is in the background, a desktop
// notification, for a "call now" lead the rep has not been told about yet
// ---------------------------------------------------------------------------

const ALERTS = "sales_dialer_alerts";

export function alertsWanted(): boolean {
  try {
    return localStorage.getItem(ALERTS) === "on";
  } catch {
    return false;
  }
}

export function setAlertsWanted(on: boolean) {
  try {
    localStorage.setItem(ALERTS, on ? "on" : "off");
  } catch {
    // remembered for this page only
  }
}

let audio: AudioContext | null = null;

/** Wake the sound up; browsers only allow it from a click. */
export function primeSound() {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
  } catch {
    audio = null;
  }
}

/** Two short rising tones. */
export function chime() {
  if (audio?.state !== "running") return;
  const start = audio.currentTime;
  for (const [i, freq] of [660, 880].entries()) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = freq;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.0001, start + i * 0.18);
    gain.gain.exponentialRampToValueAtTime(0.25, start + i * 0.18 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + i * 0.18 + 0.16);
    osc.connect(gain).connect(audio.destination);
    osc.start(start + i * 0.18);
    osc.stop(start + i * 0.18 + 0.17);
  }
}
