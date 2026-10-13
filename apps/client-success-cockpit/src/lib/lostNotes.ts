/**
 * Turns a GHL contact note into the words a person wrote about a lost lead.
 *
 * Most lost-lead notes now come from the Mahara power dialer
 * (`mahara-power-dialer/src/service.mjs`, `noteBody`). It writes one note per
 * call outcome: the outcome and reason ("LOST: Other"), system lines (follow-up
 * ladder, Maqsam check, sheet row), the agent's own note, optional feedback for
 * the client, and a `[mahara:<id>]` tag. Only the agent's note says why the
 * lead died, so the rest is cut here. A note that does not look like the
 * dialer's was typed straight into GHL and is kept as written. The view runs
 * this too, over notes stored before the sync cleaned them; those are flat and
 * may have lost the tag to the 240-character cut. [2026-10-13]
 */

const OUTCOMES =
  "LOST|NO ANSWER|CALLBACK|HANDLED|RESCHEDULE|CANCELLED|BOOKED|CONFIRMED|HANDOVER";
// The dialer's LOST_REASONS (src/domain.mjs). Matched by name so the header
// can still be cut when the line breaks are gone.
const REASONS = [
  "Has a setup issue",
  "Unsure of reason or never came back",
  "Financial Issue",
  "Distance Issue",
  "Client Had Unrealistic Expectations",
  "Unreachable",
  "Other",
];
const HEADER = new RegExp(
  `^\\s*(?:${OUTCOMES})\\b(?::\\s*(?:${REASONS.join("|")}))?`,
);
const TAG = /\[mahara:[^\]]*\]/g;
const UNVERIFIED =
  /Outcome recorded by the agent; this does not establish a verified Maqsam call\.|Manual call reported by the agent; Maqsam duration is unverified\./g;
const SYSTEM = [
  /:?\s*Follow-up ladder exhausted\. Lost: Unreachable\./g,
  /No-show attempt \d+ of \d+\.(?: Earlier attempts are unknown; this is the conservative retry budget\.)?/g,
  /Client requested sales follow-up: \S+\./g,
  /Client sheet: [^;\n]*; row \S+\./g,
  /Returned missed Maqsam call: \S+\./g,
];

export type LostNote = { note: string; unverified?: boolean };

function plain(raw: string) {
  return raw
    .replace(/<br\s*\/?>|<\/(?:p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

function fromDialer(text: string) {
  if (/\[mahara:[^\]]*\]/.test(text)) return true;
  if (!HEADER.test(text)) return false;
  return (
    /^\s*[A-Z ]+:/.test(text) ||
    text.search(UNVERIFIED) >= 0 ||
    SYSTEM.some(re => text.search(re) >= 0)
  );
}

/** The note a person wrote, or null when nothing human is left. */
export function cleanLostNote(raw: string): LostNote | null {
  const text = plain(raw);
  if (!fromDialer(text)) {
    const note = squash(text);
    return note ? { note } : null;
  }
  // What the agent told the client sits after their note; it is not the reason.
  let body = text.replace(/\n?\s*Feedback shared with client:[\s\S]*$/, "");
  body = body.replace(TAG, "");
  const unverified = body.search(UNVERIFIED) >= 0;
  body = body.replace(UNVERIFIED, "");
  for (const re of SYSTEM) body = body.replace(re, "");
  // Cut the outcome and a listed reason by name, so it works with or without
  // line breaks. A reason outside the list is left as ": <reason>" on the
  // header line; drop that line when the breaks survived.
  body = body.replace(HEADER, "").replace(/^[ \t]*:[^\n]*\n/, "");
  const note = squash(body);
  return note ? { note, ...(unverified ? { unverified } : {}) } : null;
}
