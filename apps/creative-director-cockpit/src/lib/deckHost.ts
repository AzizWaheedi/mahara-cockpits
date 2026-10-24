/**
 * The Brand Blueprint call inside the creative director cockpit
 * (docs/brand-blueprint/EMBED.md 4.5): the five messages a client success
 * deck frame and the creative director's page exchange, and the addresses
 * both sides build. One file, byte for byte in both apps
 * (apps/client-success-cockpit/src/present/deckHost.ts and
 * apps/creative-director-cockpit/src/lib/deckHost.ts, pinned by
 * scripts/check-shared.sh), and import-free, so neither app reaches into
 * the other.
 */

/** The envelope's source and version: anything else is not ours. */
export const DECK_HOST = "mahara-deck-host";
export const DECK_HOST_V = 1;

export type FrameView = "prep" | "present" | "notes";
export type PartAnchor = "part1" | "part2" | "part3";

export type FrameMessage =
  /** The frame's data is drawn; `name` is the client's, for the header. */
  | { type: "ready"; view: FrameView; name: string }
  /** The deck's own sentence: a server refusal, a read that failed, a crash. */
  | { type: "failed"; message: string }
  /** Prep's Present: the host lays the shared deck over the tab. */
  | { type: "present" }
  /** The deck's Back: the host offers Back to prep and Present again. */
  | { type: "end" }
  /** The frame found no session. */
  | { type: "signed-out" };

export type FrameEnvelope = FrameMessage & { source: string; v: number };

export function frameMessage(m: FrameMessage): FrameEnvelope {
  return { ...m, source: DECK_HOST, v: DECK_HOST_V };
}

const VIEWS: readonly string[] = ["prep", "present", "notes"];

/** The message inside a valid envelope, else null. */
export function readFrameMessage(data: unknown): FrameMessage | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.source !== DECK_HOST || d.v !== DECK_HOST_V) return null;
  if (d.type === "ready") {
    if (typeof d.view !== "string" || !VIEWS.includes(d.view)) return null;
    const name = typeof d.name === "string" ? d.name.trim().slice(0, 200) : "";
    return { type: "ready", view: d.view as FrameView, name };
  }
  if (d.type === "failed") {
    const message =
      typeof d.message === "string" ? d.message.trim().slice(0, 600) : "";
    return message ? { type: "failed", message } : null;
  }
  if (d.type === "present" || d.type === "end" || d.type === "signed-out")
    return { type: d.type };
  return null;
}

/**
 * A message the host takes: from this origin, from that frame's own
 * window, in our envelope. Anything else is dropped.
 */
export function acceptFrame(
  e: { origin: string; source: unknown; data: unknown },
  origin: string,
  frame: unknown,
): FrameMessage | null {
  if (!frame || e.origin !== origin || e.source !== frame) return null;
  return readFrameMessage(e.data);
}

/** A ClickUp task ID, the rule readBlueprints applies. */
export const isTaskId = (s: string) => /^[A-Za-z0-9_-]{1,40}$/.test(s);

/**
 * A path on this origin under /creative/, else null: no second slash, no
 * backslash, no space or control character, no dot segment (plain or
 * percent-encoded), 400 at most.
 */
export function creativePath(p: string | null | undefined): string | null {
  if (typeof p !== "string" || p.length > 400) return null;
  if (!p.startsWith("/creative/")) return null;
  if (p.includes("//") || p.includes("\\")) return null;
  if (/\s/.test(p)) return null;
  for (let i = 0; i < p.length; i++) {
    const c = p.charCodeAt(i);
    if (c < 32 || c === 127) return null;
  }
  if (/\/\.\.?(?:[/?#]|$)/.test(p)) return null;
  // The browser reads %2e as a dot: /creative/%2e%2e/x is /x.
  if (/%2e/i.test(p)) return null;
  return p;
}

/** The client success deck's address for one view, in host mode. */
export function blueprintFrame(
  taskId: string,
  o: {
    view: FrameView;
    rehearse?: boolean;
    notes?: string | null;
    at?: PartAnchor | null;
  },
): string | null {
  if (!isTaskId(taskId)) return null;
  const q = new URLSearchParams();
  if (o.view === "prep") q.set("view", "prep");
  if (o.rehearse) q.set("rehearse", "1");
  q.set("host", "creative");
  const notes = o.view === "notes" ? null : creativePath(o.notes);
  if (notes) q.set("notes", notes);
  const tail = o.view === "notes" ? "/notes" : "";
  return `/client-success/clients/${taskId}/present/blueprint${tail}?${q.toString()}${o.at ? `#${o.at}` : ""}`;
}

/** The creative director's call page and its notes popup. */
export function blueprintCall(
  taskId: string,
  rehearse = false,
): { call: string; notes: string } | null {
  if (!isTaskId(taskId)) return null;
  const r = rehearse ? "?rehearse=1" : "";
  return {
    call: `/creative/blueprint/${taskId}${r}`,
    notes: `/creative/blueprint/${taskId}/notes${r}`,
  };
}

/** One notes window per call, whoever opens it (the deck's N or the header). */
export const notesWindowName = (taskId: string, rehearse = false) =>
  `mahara-notes-${taskId}-blueprint${rehearse ? "-rehearse" : ""}`;
export const NOTES_FEATURES = "popup,width=520,height=820";

/** The Blueprint deck's own paths in the client success app, else null. */
export function blueprintPathOf(
  pathname: string,
): { taskId: string; view: "deck" | "notes" } | null {
  const m =
    /^\/client-success\/clients\/([A-Za-z0-9_-]{1,40})\/present\/blueprint(\/notes)?\/?$/.exec(
      pathname,
    );
  return m?.[1] ? { taskId: m[1], view: m[2] ? "notes" : "deck" } : null;
}

/** The parent page when this window is a frame on the same origin. */
export function sameOriginParent(w: Window): Window | null {
  try {
    if (w.parent === w || !w.parent) return null;
    return w.parent.location.origin === w.location.origin ? w.parent : null;
  } catch {
    // another origin's page holds this frame
    return null;
  }
}

/** The address asks for host mode. */
export const hostAsked = (search: string) =>
  new URLSearchParams(search).get("host") === "creative";
