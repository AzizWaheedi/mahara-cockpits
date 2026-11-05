/** The nudge's memory: what each page showed, how often it was dismissed, and when it may return. */
export type NudgeState = {
  shown: Record<string, string>;
  dismissStreak: number;
  mutedUntil: number;
  usedOn: string | null;
};

const DAY = 86400000;
const KEY = (app: string) => `hermes-nudge:v1:${app}`;

/** A fresh memory: nothing shown, nothing muted, nothing used. */
export function emptyNudge(): NudgeState {
  return { shown: {}, dismissStreak: 0, mutedUntil: 0, usedOn: null };
}

/** The browser's own calendar day, as YYYY-MM-DD. */
export function localDay(now: number): string {
  const d = new Date(now);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

/** Whether a suggestion may appear now on this page. */
export function shouldNudge(
  s: NudgeState,
  pageKey: string,
  now: number,
): boolean {
  const today = localDay(now);
  if (s.mutedUntil > now) return false;
  if (s.usedOn === today) return false;
  if (s.shown[pageKey] === today) return false;
  return true;
}

/** Records this page's suggestion for today and forgets the other days. */
export function markShown(
  s: NudgeState,
  pageKey: string,
  now: number,
): NudgeState {
  const today = localDay(now);
  const shown: Record<string, string> = {};
  for (const [key, day] of Object.entries(s.shown)) {
    if (day === today) shown[key] = day;
  }
  shown[pageKey] = today;
  return { ...s, shown };
}

/** Counts a dismissal; the second in a row mutes nudges for a week. */
export function markDismissed(s: NudgeState, now: number): NudgeState {
  const streak = s.dismissStreak + 1;
  return streak >= 2
    ? { ...s, dismissStreak: 0, mutedUntil: now + 7 * DAY }
    : { ...s, dismissStreak: streak };
}

/** Marks the suggestion used today, so nothing more appears until tomorrow. */
export function markUsed(s: NudgeState, now: number): NudgeState {
  return { ...s, usedOn: localDay(now), dismissStreak: 0 };
}

/** Picks the suggestion for the day, stepping through the list as days pass. */
export function pickNudge(suggestions: string[], now: number): string | null {
  if (suggestions.length === 0) return null;
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const dayNumber = Math.floor(midnight.getTime() / DAY);
  return suggestions[dayNumber % suggestions.length];
}

function store(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Reads the app's memory, or a fresh one when it is missing, broken, or unreadable. */
export function loadNudge(app: string): NudgeState {
  try {
    const raw = store()?.getItem(KEY(app));
    if (!raw) return emptyNudge();
    const value = JSON.parse(raw) as Partial<NudgeState> | null;
    if (!value || typeof value !== "object" || !value.shown)
      return emptyNudge();
    const shown: Record<string, string> = {};
    for (const [key, day] of Object.entries(value.shown)) {
      if (typeof day === "string") shown[key] = day;
    }
    return {
      shown,
      dismissStreak:
        typeof value.dismissStreak === "number" ? value.dismissStreak : 0,
      mutedUntil: typeof value.mutedUntil === "number" ? value.mutedUntil : 0,
      usedOn: typeof value.usedOn === "string" ? value.usedOn : null,
    };
  } catch {
    return emptyNudge();
  }
}

/** Writes the app's memory, and stays quiet when the store is missing or full. */
export function saveNudge(app: string, s: NudgeState): void {
  try {
    store()?.setItem(KEY(app), JSON.stringify(s));
  } catch {
    // A private window or a full store just means no memory, not a broken chat.
  }
}
