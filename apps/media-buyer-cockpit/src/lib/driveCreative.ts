/**
 * The pure parts of "paste a Drive link, it lands in the ad account": link
 * parsing, progress arithmetic, the words for an access refusal, and the
 * lookup that reuses a file the worker already uploaded. No Convex, no
 * network, so `bun test` covers it.
 */

export const DRIVE_ID =
  /(?:\/d\/|id=|\/file\/d\/|folders\/)([A-Za-z0-9_-]{16,})/;

/** The file (or folder) id inside any shape of Drive link, or a bare id. */
export function driveId(link: string): string | undefined {
  const m = DRIVE_ID.exec(link);
  if (m) return m[1];
  const bare = link.trim();
  return /^[A-Za-z0-9_-]{16,}$/.test(bare) ? bare : undefined;
}

export function isDriveLink(s: string): boolean {
  return /drive\.google\.com|docs\.google\.com/i.test(s);
}

/** A chunked video upload in flight; kept on the request row so a killed action resumes. */
export type Progress = {
  sessionId: string;
  videoId: string;
  /** Next byte Meta wants, and the exclusive end of the chunk it asked for. */
  start: number;
  end: number;
  size: number;
};

export type Media = {
  name: string;
  link: string;
  kind?: string;
  imageHash?: string;
  videoId?: string;
  thumbUrl?: string;
  error?: string;
  progress?: Progress;
  percent?: number;
};

export function percent(p: Progress | undefined): number | undefined {
  if (!p || !(p.size > 0)) return undefined;
  return Math.max(0, Math.min(100, Math.floor((p.start / p.size) * 100)));
}

/** What to tell her when Google will not show the file to the cockpit. */
export function accessHint(status: number, serviceAccount: string): string {
  const who = serviceAccount
    ? `share it with ${serviceAccount} (Viewer)`
    : "share it with the cockpit's service account";
  if (status === 404 || status === 403)
    return `Google will not show me this file. Open its sharing and ${who}, or set the link to "Anyone with the link", then press Get it from Drive again.`;
  return `Google refused the file (HTTP ${status}). Check the link opens for you, then try again.`;
}

/**
 * A file the worker already loaded into this campaign's ad account, by Drive
 * id: pasting the same link twice must not upload it twice or dead-end.
 */
export function reusable(
  rows: { media?: Media[] | null }[],
  link: string,
): Media | undefined {
  const want = driveId(link);
  if (!want) return undefined;
  for (const row of rows) {
    for (const m of row.media ?? []) {
      if (m.error || !(m.videoId || m.imageHash)) continue;
      if (driveId(m.link) === want) return m;
    }
  }
  return undefined;
}

/** Plain words for the wait, with how long it has been. */
export function waitingLabel(
  media: Media[] | undefined,
  requestedAt: number | undefined,
  now: number,
): string {
  const secs = requestedAt
    ? Math.max(0, Math.floor((now - requestedAt) / 1000))
    : 0;
  const since =
    secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)} min ${secs % 60}s`;
  const moving = (media ?? []).find(
    m =>
      !m.error && !m.videoId && !m.imageHash && typeof m.percent === "number",
  );
  if (moving)
    return `${moving.name}: loading into the ad account, ${moving.percent}% · ${since}`;
  return `Working on it now · ${since}. A big video takes a few minutes; it appears here with a Use this button, nothing to paste below.`;
}
