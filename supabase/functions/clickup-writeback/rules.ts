// Pure rules ported from the paused media Convex deployment (2026-10-07).
//
// Every function here is a copy of the Convex original, kept byte-for-byte in
// behaviour so the ClickUp board reads the same after the move:
//   kpiBand, money, decisionComment      convex/writeback.ts
//   isChange, cardFor, changeComment,
//   boardStatusAfter                     convex/changeLog.ts
//   cleanDosDonts, NOTES_MARK            convex/dosDonts.ts
//   daysAgo (7-day window)               convex/sync.ts
// convexGolden.ts holds outputs recorded from the Convex code itself; the
// parity tests compare against it. Do not "tidy" the text: the comment watch
// skips comments that start with the target emoji, and the notes mark.

export type Row = Record<string, any>;

/** Ads Managment list and its custom fields (convex/writeback.ts FIELD). */
export const ADS_LIST = "901817774521";
export const FIELD = {
  cpl7d: "1e821b51-4c40-4885-ba79-163fb348f796",
  lastUpdated: "d1ae5334-d0a6-436c-88ea-1104be8ef112",
  adStatus: "7f118f61-34b6-483a-b749-ff9fc31fd423",
  cplStatus: "e33b20f0-0cd5-440e-b7eb-e0c5702f09df",
  cpbStatus: "3adfc8f2-dad8-4a09-ac3c-76d2043efec9",
  bookings7d: "ce2f302a-2856-4349-bddc-79ba5dcaebaf",
} as const;
export const FIELD_NAME: Record<string, string> = {
  [FIELD.cpl7d]: "CPL (7d)",
  [FIELD.lastUpdated]: "Last Updated",
  [FIELD.adStatus]: "Ad Status",
  [FIELD.cplStatus]: "Cost Per Lead",
  [FIELD.cpbStatus]: "Cost Per Booking",
  [FIELD.bookings7d]: "Bookings (7d)",
};

/** convex/constants.ts */
export const CPL_GATE = 15;
export const CPB_GATE = 60;

/** The tech ticket's own form fields (convex/writeback.ts TECH_FIELD). */
export const TECH_FIELD = {
  requestType: "e9fd8024-8abe-4094-ac08-e6c0e736ad7e",
  additionalNotes: "6742edfb-9b6f-4615-933d-7ebd74f9542b",
  qualificationQuestions: "35f4bf1a-7df5-4cc0-919c-2669aea0bc27",
} as const;
export const TECH_REQUEST_TYPE: Record<string, string> = {
  "Add qualification questions to the lead form": "37d99ca0-e53f-4499-90e8-f1be8a21b207",
  "Switch to a landing page": "37d99ca0-e53f-4499-90e8-f1be8a21b207",
  "Landing page or tracking is broken": "9fd304bb-7078-4485-9b9f-aa19ad47ed98",
};
/** Where a rerouted request lands (convex/writeback.ts DEPARTMENT_LIST). */
export const DEPARTMENT_LIST: Record<string, { id: string; label: string }> = {
  creative: { id: "901818016338", label: "Media/Creative" },
  tech: { id: "901816723190", label: "Operations/Tech" },
  client_success: { id: "901816723211", label: "Client Success" },
  call_center: { id: "901816723206", label: "Call Center" },
  media_buyer: { id: "901816723196", label: "Marketing/ADs" },
};

/** Clients - Mahara list and the Do's & Don'ts field (convex/dosDonts.ts). */
export const CLIENTS_LIST = "901816559981";
export const DOS_DONTS_FIELD = "0f06a523-64f9-4f20-90a1-f76cb6f85318";

/** Board dropdown band. Above KPI = beating the gate (good); Below KPI = missing it. */
export function kpiBand(value: number, gate: number): string {
  if (value <= gate * 0.75) return "Above KPI";
  if (value <= gate) return "At KPI";
  if (value <= gate * 1.5) return "Below KPI";
  return "911";
}

/**
 * Mahara copy uses no em dashes (Muhammed, 2026-10-09). The Convex text had
 * them; every line the cockpit writes to ClickUp passes through this. The 🎯
 * marker stays: comment watch uses it to skip the cockpit's own comments.
 */
export function plain(s: string): string {
  return s.replace(/\s—\s/g, " - ").replace(/—/g, "-");
}

export function money(n: number | undefined): string {
  return n === undefined ? "-" : `$${n.toFixed(2)}`;
}

/** The comment the CSM reads before a check-in call (convex/writeback.ts). */
export function decisionComment(d: {
  action: string;
  kind: string;
  evidence: string;
  reason?: string;
  snooze?: string;
  reroutedTo?: string;
  byEmail?: string;
}): string {
  const head =
    d.kind === "touch"
      ? "CLIENT UPDATED"
      : d.kind === "left"
        ? "LEFT AS IS"
        : d.kind === "rerouted"
          ? `SENT TO ${(d.reroutedTo ?? "another team").toUpperCase()}`
          : "CHANGE MADE";
  const lines = [`🎯 Cockpit · ${head} — ${d.action}`, "", `Why: ${d.evidence}`];
  if (d.reason) lines.push(`Note: ${d.reason}`);
  if (d.snooze) lines.push(`Checked again: ${d.snooze}`);
  lines.push(
    d.kind === "touch"
      ? "Sent by the media buyer via the Media Buyer Cockpit. Proactive touchpoint — the client has been told."
      : `Logged by: ${d.byEmail ?? "media buyer"} via the Media Buyer Cockpit. Checked again in 7 days.`,
  );
  return plain(lines.join("\n"));
}

/** Notes that are not changes: a question to Aziz, anything asked. */
const QUIET = [/^Asked\b/i, /[?؟]\s*$/];
export function isChange(what: string): boolean {
  const text = String(what ?? "").trim();
  return text.length > 0 && !QUIET.some(q => q.test(text));
}

function tight(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export type Campaign = {
  campaignName: string;
  clientName?: string;
  clientTag?: string;
  taskId?: string;
  spend7d?: number;
  [key: string]: unknown;
};

/** The board card a change belongs on: its own card, else the client's biggest spender's card. */
export function cardFor<T extends Campaign>(
  campaignName: string,
  campaigns: T[],
): { taskId: string; ownCard: boolean; campaign?: T } | undefined {
  const own = campaigns.find(c => c.campaignName === campaignName);
  if (own?.taskId) return { taskId: own.taskId, ownCard: true, campaign: own };
  const keys = new Set([campaignName, own?.clientName, own?.clientTag].map(tight).filter(Boolean));
  const sibling = campaigns
    .filter(c => c.taskId && (keys.has(tight(c.clientName)) || keys.has(tight(c.clientTag))))
    .sort((a, b) => (b.spend7d ?? 0) - (a.spend7d ?? 0))[0];
  return sibling?.taskId ? { taskId: sibling.taskId, ownCard: false, campaign: own } : undefined;
}

/** The comment on the card: who, on what, when, and what changed. */
export function changeComment(
  m: { by: string; campaignName: string; adName?: string; what: string; at: number },
  now = Date.now(),
): string {
  const who = !m.by || m.by === "cockpit" || m.by === "Built from the cockpit" ? "the media buyer" : m.by;
  const day = new Date(m.at + 3 * 3_600_000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  // A change posted late says so by its date, and is not given a judging clock that has already run.
  const fresh = now - m.at < 86_400_000;
  return plain(
    [
      `🎯 Cockpit · CHANGE MADE — ${m.what}`,
      "",
      m.adName ? `${m.campaignName} · ${m.adName}` : m.campaignName,
      "",
      `Made by ${who} in the Media Buyer Cockpit on ${day}.${fresh ? " Three days before this is judged." : ""}`,
    ].join("\n"),
  );
}

/** The board's Ad Status after a campaign is switched in Meta; undefined when the board already agrees. */
export function boardStatusAfter(
  metaStatus: string | undefined,
  boardStatus: string | undefined,
): "Live" | "Paused" | undefined {
  const board = String(boardStatus ?? "");
  if (metaStatus === "ACTIVE") return board === "Live" ? undefined : "Live";
  if (metaStatus === "PAUSED")
    return ["Paused", "Dead Campaign", "Lost Client"].includes(board) ? undefined : "Paused";
  return undefined;
}

// --- Do's & Don'ts clean format (convex/dosDonts.ts) -------------------------

const NEGATIVE = /^(don'?t|do not|never|avoid|no|not|stop|without)\b/i;
const TICK_DO = /^(✅|✓|✔️?|☑️?)\s*/u;
const TICK_DONT = /^(❌|✕|✖️?|⛔|🚫)\s*/u;
/** Comments this job posts start with this, so the comment watch skips them. */
export const NOTES_MARK = "📌 Notes moved out of Do's & Don'ts";

export function cleanDosDonts(raw: string): { text: string; notes: string[] } {
  const out = { do: [] as string[], dont: [] as string[], notes: [] as string[] };
  let current: "do" | "dont" | "notes" | undefined;
  const add = (section: "do" | "dont" | "notes" | undefined, raw: string, tick?: "do" | "dont") => {
    let item = raw.replace(/\s+/g, " ").replace(/\.\s+\(/g, " (").trim();
    if (!item) return;
    if (/^[a-z][a-z\s]/.test(item)) item = item[0].toUpperCase() + item.slice(1);
    item = item.replace(/^dont\b/i, "Don't");
    const target: "do" | "dont" | "notes" = NEGATIVE.test(item) ? "dont" : (tick ?? section ?? "do");
    const key = item.toLowerCase();
    if (!out[target].some(x => x.toLowerCase() === key)) out[target].push(item);
  };
  for (const rawLine of String(raw ?? "").replace(/\r/g, "").split("\n")) {
    let line = rawLine
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/^[#>\s]+/, "")
      .replace(/^\*+|\*+$/g, "")
      .trim();
    const bulleted = /^(?:[-•*–—]|\d+[.)])\s+/.test(line);
    line = line.replace(/^(?:[-•*–—]|\d+[.)])\s+/, "").replace(/^\*+|\*+$/g, "").trim();
    let tick: "do" | "dont" | undefined;
    if (TICK_DO.test(line)) tick = "do";
    else if (TICK_DONT.test(line)) tick = "dont";
    line = line.replace(TICK_DO, "").replace(TICK_DONT, "").trim();
    if (!line || /^do'?s\s*(&|and)\s*don'?ts:?$/i.test(line)) continue;
    const head = bulleted ? null : /^(do'?s|do|don'?ts|don'?t|notes?)\s*(?::\s*(.*))?$/i.exec(line);
    if (head) {
      const h = head[1].toLowerCase();
      current = h.startsWith("don") ? "dont" : h.startsWith("note") ? "notes" : "do";
      if (head[2]?.trim()) add(current, head[2]);
      continue;
    }
    add(current, line, tick);
  }
  const block = (title: string, items: string[]) => (items.length ? `${title}\n${items.map(i => `- ${i}`).join("\n")}` : "");
  return {
    text: [block("DO", out.do), block("DON'T", out.dont)].filter(Boolean).join("\n\n"),
    notes: out.notes,
  };
}

// --- Time -------------------------------------------------------------------

/** Kuwait calendar day n days before `now` (convex/sync.ts daysAgo). */
export function daysAgo(n: number, now = Date.now()): string {
  return new Date(now + 3 * 3600 * 1000 - n * 86400000).toISOString().slice(0, 10);
}

// --- Retry-safe markers -------------------------------------------------------

/**
 * A short reference line appended to every comment and ticket this job
 * creates. A retry after an unknown outcome reads the task back and looks for
 * it, so the same comment is never posted twice.
 */
export function refLine(queueId: string, step = ""): string {
  const short = String(queueId).replace(/-/g, "").slice(0, 10);
  return `Cockpit ref ${short}${step ? `-${step}` : ""}`;
}
