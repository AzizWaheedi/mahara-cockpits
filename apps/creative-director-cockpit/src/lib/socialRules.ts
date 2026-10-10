/**
 * The Social calendar's rules that need no database.
 *
 * Ported from `convex/social.ts`, so the Supabase path refuses the same
 * things in the same words: what a clean pillar, shape, word or media list
 * is, which days a month fill takes, the id and payload of every job Salma
 * drains (`hermes/salma/salma.py`), and how fresh the list of Pages is.
 * Kept apart from `social.ts` so the tests can read it without a client.
 */

export type Row = Record<string, any>;

/** What a new client starts with; a client can rename or keep its own. */
export const DEFAULT_PILLARS = ["portfolio", "craft", "education"] as const;

/**
 * Every job kind Salma has a handler for (`KINDS` in salma.py). The
 * database refuses any other kind from a browser (20261009e).
 */
export const SALMA_KINDS = [
  "fill",
  "plan",
  "caption",
  "generate",
  "cover",
  "accounts",
  "words",
  "motion",
] as const;
export type SalmaKind = (typeof SALMA_KINDS)[number];

const TEXT_MAX = 2000;

/** This month in Kuwait, which is the month a batch belongs to. */
export function kuwaitMonth(nowMs = Date.now()): string {
  return new Date(nowMs + 3 * 3600_000).toISOString().slice(0, 7);
}

export function isMonth(month: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

export function batchIdOf(clientTaskId: string, month: string): string {
  return `${clientTaskId}:${month}`;
}

export function clip(x: unknown, max = TEXT_MAX): string | null {
  const s = String(x ?? "").trim();
  return s ? s.slice(0, max) : null;
}

/** Tidy a client's own pillar names: trimmed, unique, and few enough to plan against. */
export function cleanPillars(raw: string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const p of raw) {
    const name = String(p).trim().toLowerCase().slice(0, 24);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    kept.push(name);
  }
  return kept.slice(0, 6);
}

/**
 * The shapes a post can take, as Instagram's composer offers them. 3:4
 * posts by hand only: the publishing API takes 4:5 to 1.91:1.
 */
export const ASPECTS = ["1:1", "4:5", "3:4", "1.91:1"] as const;

export function cleanAspect(raw: string): string {
  if (!(ASPECTS as readonly string[]).includes(raw))
    throw new Error(
      "That is not a shape Instagram takes. Pick 1:1, 4:5, 3:4 or 1.91:1.",
    );
  return raw;
}

export const PLATFORMS = ["instagram", "facebook"] as const;

export function cleanPlatforms(raw: string[]): string[] {
  const asked = raw.map(x => String(x).toLowerCase());
  return PLATFORMS.filter(p => asked.includes(p));
}

export type Words = Record<string, string>;

const WORD_KEYS = ["headline", "line", "accent", "title", "cta", "handle"];

/** Words as stored: the keys a look uses, trimmed, never anything else. */
export function cleanWords(raw: unknown): Words | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Words = {};
  for (const k of WORD_KEYS) {
    const v = String((raw as Row)[k] ?? "")
      .replace(/\s+/g, " ")
      .replace(/\s*[—–]\s*/g, " ")
      .trim();
    if (v) out[k] = v.slice(0, 120);
  }
  return Object.keys(out).length ? out : undefined;
}

function httpsOrNone(x: unknown): string | undefined {
  const s = String(x ?? "").trim();
  return /^https:\/\//i.test(s) ? s : undefined;
}

function shortStrings(
  raw: unknown,
  keys: string[],
  max = 300,
): Words | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Words = {};
  for (const k of keys) {
    const v = String((raw as Row)[k] ?? "").trim();
    if (v) out[k] = v.slice(0, max);
  }
  return Object.keys(out).length ? out : undefined;
}

export type MediaItem = {
  kind: "image" | "video";
  url: string;
  source: "upload" | "ai";
  cover?: string | null;
  clean?: string;
  layer?: string;
  words?: Words;
  look?: "bold" | "showcase";
  readback?: Row;
  from?: string;
  motion?: Words;
};

/**
 * The items as stored: typed, https, and no more than Instagram allows.
 * What Salma put on an item (the clean picture, the words, the layer, the
 * read-back) rides along, so a reorder never loses the words.
 */
export function cleanMedia(raw: unknown): MediaItem[] {
  if (!Array.isArray(raw)) throw new Error("That is not a list of media.");
  const out: MediaItem[] = [];
  for (const x of raw as Record<string, unknown>[]) {
    const url = String(x?.url ?? "").trim();
    if (!/^https:\/\//i.test(url))
      throw new Error(
        "Every item needs a link Instagram can fetch, starting https://",
      );
    const kind = x?.kind === "video" ? "video" : "image";
    const cover = x?.cover ? String(x.cover) : null;
    const item: MediaItem = {
      kind,
      url,
      source: x?.source === "ai" ? "ai" : "upload",
      ...(kind === "video" ? { cover } : {}),
    };
    const clean = httpsOrNone(x?.clean);
    if (clean) item.clean = clean;
    const layer = httpsOrNone(x?.layer);
    if (layer) item.layer = layer;
    const words = cleanWords(x?.words);
    if (words) item.words = words;
    if (x?.look === "bold" || x?.look === "showcase") item.look = x.look;
    const from = httpsOrNone(x?.from);
    if (from) item.from = from;
    const motion = shortStrings(x?.motion, ["camera", "motion", "person"]);
    if (motion) item.motion = motion;
    if (x?.readback && typeof x.readback === "object") {
      const r = x.readback as Row;
      item.readback = {
        ok: r.ok === true ? true : r.ok === false ? false : null,
        ...(Array.isArray(r.missing)
          ? {
              missing: (r.missing as unknown[])
                .slice(0, 5)
                .map(m => String(m).slice(0, 120)),
            }
          : {}),
        ...(r.seen ? { seen: String(r.seen).slice(0, 300) } : {}),
        ...(r.error ? { error: String(r.error).slice(0, 200) } : {}),
      };
    }
    out.push(item);
  }
  if (out.length > 10)
    throw new Error("Instagram takes at most ten items in a carousel.");
  return out;
}

/** The upload's kind and a storage path that cannot escape the client's folder. */
export function uploadPlan(args: {
  clientTaskId: string;
  filename: string;
  contentType: string;
  month: string;
  uuid: string;
}): { path: string; kind: "image" | "video" } {
  const type = String(args.contentType ?? "").toLowerCase();
  const kind = type.startsWith("video/")
    ? "video"
    : type.startsWith("image/")
      ? "image"
      : null;
  if (!kind) throw new Error("Only images and videos can be uploaded here.");
  if (/heic|heif/.test(type))
    throw new Error(
      "Instagram does not take HEIC photos. Export it as a JPEG and upload that.",
    );
  const folder = String(args.clientTaskId ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!folder) throw new Error("Pick a client before uploading.");
  const safe =
    String(args.filename ?? "")
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(-60) || "file";
  return { path: `${folder}/${args.month}/${args.uuid}-${safe}`, kind };
}

/**
 * Which empty days a month fill takes, and the pillar for each.
 *
 * Counts how many posts the package wants, finds the empty days still to
 * come, spreads the missing posts evenly across them, and carries the
 * client's own pillar rotation on from the month's last post.
 */
export function fillSlots(args: {
  month: string;
  perMonth: number;
  pillars: string[];
  existing: { pillar?: string | null; scheduled_at?: string | null }[];
  today: string;
}): { slots: { day: string; pillar: string }[]; days: string[] } {
  if (!isMonth(args.month)) throw new Error("That is not a month.");
  const perMonth = Math.max(1, Number(args.perMonth) || 12);
  const own = cleanPillars(args.pillars ?? []);
  const rotation = own.length ? own : [...DEFAULT_PILLARS];
  const need = perMonth - args.existing.length;
  if (need <= 0)
    throw new Error(
      `This month already has ${args.existing.length} posts, which is what the package asks for. ` +
        "Click a day to add one more.",
    );
  const [y, m] = args.month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const taken = new Set(
    args.existing
      .map(p => String(p.scheduled_at ?? "").slice(0, 10))
      .filter(Boolean),
  );
  const open: string[] = [];
  for (let d = 1; d <= last; d++) {
    const day = `${args.month}-${String(d).padStart(2, "0")}`;
    if (day > args.today && !taken.has(day)) open.push(day);
  }
  if (!open.length)
    throw new Error("There are no empty days left in this month to fill.");
  const k = Math.min(need, open.length);
  const days = Array.from(
    { length: k },
    (_, i) =>
      open[
        Math.min(open.length - 1, Math.floor(((i + 0.5) * open.length) / k))
      ],
  );
  const lastPillar = String(
    args.existing[args.existing.length - 1]?.pillar ?? "",
  );
  let start = Math.max(0, rotation.indexOf(lastPillar) + 1);
  const slots = days.map(day => ({
    day,
    pillar: rotation[start++ % rotation.length],
  }));
  return { slots, days };
}

/** A short unique suffix, the shape the rest of the codebase writes. */
export function rid(prefix: string, nowMs = Date.now()): string {
  return `${prefix}_${nowMs.toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/**
 * The id of a job on one post. A caption is one per post; a cover, words
 * or motion is one per item, so asking for two covers queues two.
 */
export function postJobId(
  kind: "caption" | "cover" | "words" | "motion",
  postId: string,
  params: Row = {},
): string {
  return kind === "caption"
    ? `caption:${postId}`
    : `${kind}:${postId}:${Number(params.index ?? 0)}`;
}

/**
 * The id and params of a drawing job: the whole post, one picture again
 * (`index`), or one more on the end (`add`).
 */
export function generateJob(
  postId: string,
  ask: { index?: number; add?: boolean },
  nowMs = Date.now(),
): { id: string; params: Row } {
  if (ask.index !== undefined) {
    const i = Math.floor(ask.index);
    return { id: `generate:${postId}:${i}`, params: { index: i } };
  }
  if (ask.add)
    return {
      id: `generate:${postId}:add:${nowMs.toString(36)}`,
      params: { add: true },
    };
  return { id: `generate:${postId}`, params: {} };
}

/**
 * One row for `social_jobs`, always with every column, so a batch of them
 * never sends a null where the table wants a default. Re-queuing an id
 * resets it: queued, no attempts, no old error or result.
 */
export function queuedJob(j: {
  id: string;
  kind: SalmaKind;
  requestedBy: string;
  at: string;
  clientTaskId?: string | null;
  batchId?: string | null;
  postId?: string | null;
  params?: Row;
}): Row {
  if (!(SALMA_KINDS as readonly string[]).includes(j.kind))
    throw new Error(`Salma has no way to do "${j.kind}" yet.`);
  return {
    id: j.id,
    kind: j.kind,
    client_task_id: j.clientTaskId ?? null,
    batch_id: j.batchId ?? null,
    post_id: j.postId ?? null,
    params: j.params ?? {},
    status: "queued",
    attempts: 0,
    error: null,
    result: null,
    requested_by: j.requestedBy,
    updated_at: j.at,
  };
}

/** Words every agency client name has, which say nothing about which one. */
const GENERIC = new Set([
  "co",
  "company",
  "group",
  "llc",
  "wll",
  "est",
  "the",
  "and",
  "for",
  "of",
  "design",
  "designs",
  "interior",
  "interiors",
  "contracting",
  "construction",
  "trading",
  "general",
  "studio",
  "شركة",
  "مؤسسة",
  "مجموعة",
  "للمقاولات",
  "للتصميم",
  "والديكور",
  "للاستشارات",
  "الهندسية",
]);

function words(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(" ")
      .filter(w => w.length > 1 && !GENERIC.has(w)),
  );
}

/** Share of the client's name found in the Page's name or handle. */
export function nameScore(client: string, page: string): number {
  const a = words(client);
  if (!a.size) return 0;
  const b = words(page);
  let hit = 0;
  for (const w of a) if (b.has(w)) hit++;
  return hit / a.size;
}

/** The newest `seen_at` on the Pages list, or null when nothing says. */
export function latestSeen(rows: Row[]): string | null {
  let best: number | null = null;
  let iso: string | null = null;
  for (const r of rows) {
    const t = Date.parse(String(r.seen_at ?? ""));
    if (Number.isNaN(t)) continue;
    if (best === null || t > best) {
      best = t;
      iso = new Date(t).toISOString();
    }
  }
  return iso;
}

/**
 * What the Accounts picker shows: the Pages, best guess first, the one
 * linked now, and how fresh the list really is. `refreshedAt` comes from
 * the rows Salma wrote, never from the clock; null means nobody knows.
 */
export function pagesView(args: {
  pages: Row[];
  client: Row | null;
  job: Row | null;
  clientTaskId: string;
  clientName: string;
}) {
  const list = args.pages.map(p => {
    const byAds = ((p.ad_clients as string[]) ?? []).includes(
      args.clientTaskId,
    );
    const score = Math.max(
      nameScore(args.clientName, String(p.name ?? "")),
      nameScore(
        args.clientName,
        String(p.ig_username ?? "").replace(/[._]/g, " "),
      ),
    );
    return {
      pageId: String(p.page_id),
      name: String(p.name ?? p.page_id),
      picture: (p.picture_url as string | null) ?? null,
      igUserId: (p.ig_user_id as string | null) ?? null,
      igUsername: (p.ig_username as string | null) ?? null,
      igPicture: (p.ig_picture_url as string | null) ?? null,
      suggested: (byAds ? "ads" : score >= 0.5 ? "name" : null) as
        | "ads"
        | "name"
        | null,
      score: byAds ? 2 : score,
    };
  });
  list.sort(
    (x, y) => y.score - x.score || String(x.name).localeCompare(String(y.name)),
  );
  const c = args.client;
  const j = args.job;
  return {
    pages: list,
    current: c?.fb_page_id
      ? {
          pageId: String(c.fb_page_id),
          name: (c.fb_page_name as string | null) ?? null,
          igUserId: (c.ig_user_id as string | null) ?? null,
          igUsername: (c.ig_username as string | null) ?? null,
          linkedAt: (c.accounts_linked_at as string | null) ?? null,
          linkedBy: (c.accounts_linked_by as string | null) ?? null,
        }
      : null,
    refreshedAt: latestSeen(args.pages),
    refreshing: j ? j.status === "queued" || j.status === "running" : false,
    refreshError:
      j?.status === "failed"
        ? String(j.error ?? "") || "Salma did not say why."
        : null,
  };
}
