import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * The reads and writes behind the two decks (supabase/migrations/
 * 20261019120000_csm_decks.sql, supabase/functions/cockpit-csm-api/
 * launchAds.ts). Every call goes through the signed-in seat's own client,
 * so cockpit_csm_client_gate decides which client may be opened. Nothing
 * here returns leads, cost per lead, spend or budgets.
 */

/**
 * The client decks: the CSM's two, and the creative director's Brand
 * Blueprint call (docs/brand-blueprint/SPEC.md 5).
 */
import type { OfferDeckKind } from "./offer/kinds";
export type DeckKind = "onboarding" | "launch" | "blueprint" | OfferDeckKind;

/** The few calls the decks make, so a harness or a test can stand in. */
export type DeckClient = Pick<SupabaseClient, "rpc" | "functions" | "auth">;

const text = z.string();
const opt = text.nullable().optional();
const iso = z.union([z.string(), z.number()]).nullable().optional();
const callAt = z
  .object({ startsAt: text, endsAt: opt, status: opt })
  .passthrough();
const calls = z
  .object({
    blueprint: callAt.optional(),
    launch: callAt.optional(),
    checkin: callAt.optional(),
    onboarding: callAt.optional(),
  })
  .passthrough();

export const launchAdSchema = z
  .object({
    id: text,
    taskId: text,
    kind: z.enum(["starter", "custom", "logo", "page"]),
    status: z.enum(["uploading", "ready", "removed"]),
    path: text,
    mime: text,
    bytes: z.number(),
    width: z.number().nullable().optional(),
    height: z.number().nullable().optional(),
    seconds: z.union([z.number(), z.string()]).nullable().optional(),
    posterPath: opt,
    posterMime: opt,
    fileName: opt,
    placement: z.enum(["feed", "reels", "facebook"]).nullable().optional(),
    primaryText: opt,
    headline: opt,
    cta: opt,
    language: z.enum(["ar", "en"]).nullable().optional(),
    hidden: z.boolean().optional(),
    createdAt: opt,
    url: opt,
    posterUrl: opt,
    /**
     * Where the file came from, on the tray's read only (20261020160300):
     * an upload by hand or a Drive link. A Drive file adds the first name of
     * whoever pasted the link and when. These three never carry an address
     * or the link; the row's own createdBy, returned since 20261019120000,
     * is unchanged, and on a Drive row it is the importer's address. Prep
     * shows them; the deck window reads the same list but never renders
     * them. Optional, so a read from before that migration still parses; a
     * value this build does not know reads as none.
     */
    source: z.enum(["upload", "drive"]).nullable().optional().catch(null),
    importedBy: opt,
    importedAt: opt,
  })
  .passthrough();
export type LaunchAd = z.infer<typeof launchAdSchema>;

const prepRow = z
  .object({
    deck: z.string(),
    overrides: z.record(z.string(), z.unknown()),
    revision: z.number(),
    updatedAt: opt,
    updatedBy: opt,
  })
  .passthrough();
export type PrepRow = z.infer<typeof prepRow>;

const funnel = z
  .object({
    sourceId: text,
    formId: opt,
    formName: opt,
    kind: opt,
    headline: opt,
    url: opt,
    followUpUrl: opt,
    formStatus: opt,
    staleReason: opt,
    checkedAt: opt,
    questions: z
      .array(
        z
          .object({
            type: opt,
            label: opt,
            isGate: z.boolean().nullable().optional(),
            options: z.array(z.string()).nullable().optional(),
          })
          .passthrough(),
      )
      .default([]),
    adIds: z.array(z.string()).default([]),
  })
  .passthrough();
export type Funnel = z.infer<typeof funnel>;

const metaAd = z
  .object({
    id: text,
    name: opt,
    campaignName: opt,
    accountId: opt,
    creativeId: opt,
    status: opt,
    effectiveStatus: opt,
    still: z
      .object({ url: opt, tinyUrl: opt })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();
export type MetaAd = z.infer<typeof metaAd>;

export const sourcesSchema = z
  .object({
    taskId: text,
    clientName: text,
    at: opt,
    presenter: z
      .object({ email: opt, firstName: opt })
      .passthrough()
      .nullable()
      .optional(),
    client: z
      .object({
        stage: opt,
        service: opt,
        launchDate: iso,
        bucket: opt,
      })
      .passthrough()
      .nullable()
      .optional(),
    logo: z
      .object({ bucket: text, path: text, verifiedAt: opt })
      .passthrough()
      .nullable()
      .optional(),
    ghl: z
      .object({
        name: opt,
        country: opt,
        city: opt,
        language: opt,
        serviceMode: opt,
      })
      .passthrough()
      .nullable()
      .optional(),
    editor: z
      .object({
        offer: opt,
        offerUrl: opt,
        brandDna: opt,
        brandDnaUrl: opt,
        driveUrl: opt,
        website: opt,
        instagram: opt,
      })
      .passthrough()
      .nullable()
      .optional(),
    dosDonts: z
      .object({ text: opt, source: opt, syncedAt: opt })
      .passthrough()
      .nullable()
      .optional(),
    kit: z
      .object({
        onboardingCallOn: opt,
        launchOn: opt,
        signupOn: opt,
        links: z.record(z.string(), z.string()).default({}),
        syncedAt: opt,
      })
      .passthrough()
      .nullable()
      .optional(),
    callers: z
      .array(z.object({ firstName: opt }).passthrough())
      .nullable()
      .optional(),
    calls: z
      .object({ next: calls.default({}), last: calls.default({}) })
      .passthrough()
      .default({ next: {}, last: {} }),
    meta: z
      .object({
        match: opt,
        note: opt,
        campaigns: z.array(z.unknown()).default([]),
        ads: z.array(metaAd).nullable().optional(),
        adsReady: z.boolean().optional(),
        funnels: z.array(funnel).nullable().optional(),
        funnelsReady: z.boolean().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    prep: z
      .object({
        onboarding: prepRow.nullable().optional(),
        launch: prepRow.nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    launchAds: z.array(launchAdSchema).default([]),
    notes: z.array(z.string()).default([]),
  })
  .passthrough();
export type DeckSources = z.infer<typeof sourcesSchema>;

/** The browser could not reach the server at all (offline, a dropped Wi-Fi). */
const OFFLINE =
  /Failed to fetch|NetworkError|Load failed|FetchError|network request failed/i;

/** A plain sentence from whatever the server or the network said. */
export function problem(
  error: unknown,
  fallback: string,
  /** What to say when the browser is offline (a save says its change is kept). */
  offline = "No connection. Check the internet, then try again.",
): string {
  const m =
    error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message ?? "")
      : typeof error === "string"
        ? error
        : "";
  if (OFFLINE.test(m)) return offline;
  if (/JWT|sign.?in|not authenticated|401/i.test(m))
    return "Saving needs your cockpit sign-in. The preview still works.";
  if (/could not find the function|PGRST202|does not exist/i.test(m))
    return "The deck's backend is not live yet, so its sources and prep cannot be read.";
  return m.trim() || fallback;
}

export async function readDeckSources(
  client: DeckClient,
  taskId: string,
): Promise<DeckSources> {
  const { data, error } = await client.rpc("cockpit_csm_deck_sources", {
    p_task_id: taskId,
  });
  if (error)
    throw Error(problem(error, "The deck's sources could not be read."));
  const parsed = sourcesSchema.safeParse(data);
  if (!parsed.success)
    throw Error(
      "The deck's sources came back in a shape this page does not read.",
    );
  return parsed.data;
}

const saved = prepRow.extend({ changed: z.boolean().optional() });
export type SavedPrep = z.infer<typeof saved>;

export async function savePrep(
  client: DeckClient,
  taskId: string,
  deck: DeckKind,
  patch: Record<string, unknown>,
): Promise<SavedPrep> {
  const { data, error } = await client.rpc("cockpit_csm_deck_prep_save", {
    p_task_id: taskId,
    p_deck: deck,
    p_patch: patch,
  });
  if (error)
    throw Error(
      problem(
        error,
        "This change was not saved. Try again.",
        "No connection. Your change is kept here and saves when you are back online.",
      ),
    );
  const parsed = saved.safeParse(data);
  if (!parsed.success)
    throw Error("The server did not confirm the save. Try again.");
  return parsed.data;
}

// ------------------------------------------------- the ads tray (signed)

async function invoke<T>(
  client: DeckClient,
  body: Record<string, unknown>,
  shape: z.ZodType<T>,
): Promise<T> {
  const { data, error } = await client.functions.invoke("cockpit-csm-api", {
    body,
  });
  if (error) {
    // The function answers {error: "plain sentence"} with a 4xx or 5xx.
    let said = "";
    const ctx = (error as { context?: unknown }).context;
    if (ctx && typeof (ctx as Response).json === "function") {
      try {
        const j = (await (ctx as Response).clone().json()) as {
          error?: string;
        };
        said = j?.error ?? "";
      } catch {
        // not JSON
      }
    }
    throw Error(
      said || problem(error, "The server did not answer. Try again."),
    );
  }
  const parsed = shape.safeParse(data);
  if (!parsed.success) throw Error("The server's answer could not be read.");
  return parsed.data;
}

/** This client's ready uploads, with links signed for an hour. */
export async function listLaunchAds(
  client: DeckClient,
  taskId: string,
): Promise<LaunchAd[]> {
  const out = await invoke(
    client,
    {
      operation: "launchAds.list",
      requestId: crypto.randomUUID(),
      args: { taskId, includeHidden: true },
    },
    z.object({ ads: z.array(launchAdSchema) }).passthrough(),
  );
  return out.ads;
}

/** How long a read link is used before it is signed again (it lasts an hour). */
export const SIGN_FRESH_MS = 50 * 60_000;
/** A Storage read link signed for one seat (never a public object URL). */
export const SIGNED_LINK = /\/storage\/v1\/object\/sign\//;

/**
 * The tray read again while its links are still fresh: a file whose path is
 * unchanged keeps the link it is drawn with, so a playing video does not
 * restart and no picture flickers. New files take their new links.
 */
export function keepLinks(before: LaunchAd[], after: LaunchAd[]): LaunchAd[] {
  const old = new Map(before.map(a => [a.id, a]));
  return after.map(a => {
    const o = old.get(a.id);
    if (
      !o ||
      o.path !== a.path ||
      (o.posterPath ?? null) !== (a.posterPath ?? null)
    )
      return a;
    return { ...a, url: o.url ?? a.url, posterUrl: o.posterUrl ?? a.posterUrl };
  });
}

/**
 * Stills and posters fetched when the deck opens (DESIGN 10.6), so a slide
 * mounting later never pops a creative in. Videos load poster-first.
 */
export function preloadMedia(
  ads: LaunchAd[],
  stills: (string | null | undefined)[] = [],
): string[] {
  const srcs = [
    ...ads.map(a => (a.mime.startsWith("video/") ? a.posterUrl : a.url)),
    ...stills,
  ].filter((s): s is string => typeof s === "string" && s.length > 0);
  if (typeof Image === "undefined") return srcs;
  for (const src of srcs) {
    const img = new Image();
    img.decoding = "async";
    img.src = src;
    void img.decode?.().catch(() => undefined);
  }
  return srcs;
}

export const UPLOAD_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
} as const;
export const MAX_UPLOAD_BYTES = 157_286_400;

export type UploadKind = "starter" | "custom" | "logo" | "page";

/** What a file is, read in the browser before it is reserved. */
export interface FileFacts {
  width?: number;
  height?: number;
  seconds?: number;
  poster?: Blob;
}

/** Why a file cannot be saved, in the notes window's words (DESIGN 10.4). */
export function uploadRefusal(file: File): string | null {
  const ext = file.name.split(".").pop()?.toUpperCase() ?? "file";
  if (!(file.type in UPLOAD_TYPES))
    return `${file.name} is a ${ext}. Add a picture (JPG, PNG, WebP) or a video (MP4, MOV, WebM).`;
  if (file.size > MAX_UPLOAD_BYTES)
    return `Shown, not saved: ${file.name} is over 150 MB. Export a smaller copy to keep it.`;
  if (file.size === 0) return `${file.name} is empty.`;
  return null;
}

/** The size, length and first frame of a picture or a video. */
export async function readFileFacts(file: File): Promise<FileFacts> {
  const url = URL.createObjectURL(file);
  try {
    if (file.type.startsWith("image/")) {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { width: img.naturalWidth, height: img.naturalHeight };
    }
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.src = url;
    await new Promise<void>((ok, bad) => {
      video.onloadeddata = () => ok();
      video.onerror = () => bad(Error("This browser can't play it."));
    });
    const facts: FileFacts = {
      width: video.videoWidth || undefined,
      height: video.videoHeight || undefined,
      seconds: Number.isFinite(video.duration)
        ? Math.round(video.duration * 100) / 100
        : undefined,
    };
    try {
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 1080 / Math.max(video.videoWidth, 1));
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas
        .getContext("2d")
        ?.drawImage(video, 0, 0, canvas.width, canvas.height);
      facts.poster = await new Promise<Blob | undefined>(ok =>
        canvas.toBlob(b => ok(b ?? undefined), "image/jpeg", 0.82),
      );
    } catch {
      // no poster: the tray shows the first frame instead
    }
    return facts;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Storage refused a PUT for its size (its own upload limit): a retry never passes. */
export class TooLargeForStorage extends Error {}

/** Storage's answer to a PUT over its upload limit. */
export const tooLarge = (status: number, body: string) =>
  status === 413 ||
  (status === 400 &&
    /maximum allowed size|payload too large|entity too large|exceeded/i.test(
      body,
    ));

/** PUT a file to a signed upload URL, reporting progress (0 to 1). */
export function putSigned(
  url: string,
  file: Blob,
  type: string,
  onProgress?: (share: number) => void,
): Promise<void> {
  return new Promise((ok, bad) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", type);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? ok()
        : bad(
            tooLarge(xhr.status, String(xhr.responseText ?? ""))
              ? new TooLargeForStorage("too large")
              : Error("Not saved. Add it again to retry."),
          );
    xhr.onerror = () => bad(Error("Not saved. Add it again to retry."));
    xhr.send(file);
  });
}

const signedUpload = z
  .object({
    path: text,
    url: text.nullable(),
    token: text.nullable(),
    uploaded: z.boolean().optional(),
  })
  .passthrough()
  .nullable();

/**
 * Save one file to the client's ads tray: reserve (gated), PUT to the signed
 * URL, then ready (checked against Storage and audited). The request id is
 * kept so a retry returns the same reservation.
 */
export async function uploadLaunchAd(
  client: DeckClient,
  args: {
    taskId: string;
    file: File;
    kind: UploadKind;
    facts: FileFacts;
    requestId?: string;
    onProgress?: (share: number) => void;
    /** The PUT itself (a test hands in its own). */
    put?: typeof putSigned;
  },
): Promise<LaunchAd> {
  const { taskId, file, kind, facts } = args;
  const put = args.put ?? putSigned;
  const requestId = args.requestId ?? crypto.randomUUID();
  const poster =
    file.type.startsWith("video/") && facts.poster
      ? { mime: "image/jpeg", bytes: facts.poster.size }
      : null;
  const reserved = await invoke(
    client,
    {
      operation: "launchAds.reserve",
      requestId,
      args: {
        taskId,
        kind,
        mime: file.type,
        bytes: file.size,
        width: facts.width ?? null,
        height: facts.height ?? null,
        seconds: facts.seconds ?? null,
        fileName: file.name.slice(0, 200),
        poster,
      },
    },
    z
      .object({
        ad: launchAdSchema,
        upload: signedUpload,
        posterUpload: signedUpload.optional(),
      })
      .passthrough(),
  );
  const parts = poster && reserved.posterUpload?.url ? 0.9 : 1;
  try {
    if (reserved.upload?.url)
      await put(reserved.upload.url, file, file.type, s =>
        args.onProgress?.(s * parts),
      );
    if (poster && facts.poster && reserved.posterUpload?.url)
      await put(reserved.posterUpload.url, facts.poster, "image/jpeg", s =>
        args.onProgress?.(0.9 + s * 0.1),
      );
  } catch (e) {
    // The reservation goes with the failed PUT (and any bytes that arrived),
    // so failed tries never pile up against the unfinished-uploads cap.
    try {
      await invoke(
        client,
        {
          operation: "launchAds.remove",
          requestId: crypto.randomUUID(),
          args: { taskId, id: reserved.ad.id },
        },
        z.object({ ad: launchAdSchema }).passthrough(),
      );
    } catch {
      // Swept with the client's stale uploads the next time the tray is read.
    }
    if (e instanceof TooLargeForStorage)
      throw Error(
        `Shown, not saved: ${file.name} is larger than storage accepts. Export a smaller copy to keep it.`,
      );
    throw e;
  }
  const ready = await invoke(
    client,
    {
      operation: "launchAds.ready",
      requestId: crypto.randomUUID(),
      args: { taskId, id: reserved.ad.id },
    },
    z.object({ ad: launchAdSchema }).passthrough(),
  );
  args.onProgress?.(1);
  return ready.ad;
}

/** Change an upload's text, placement, kind or hidden flag. */
export async function updateLaunchAd(
  client: DeckClient,
  taskId: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<LaunchAd> {
  const out = await invoke(
    client,
    {
      operation: "launchAds.update",
      requestId: crypto.randomUUID(),
      args: { taskId, id, patch },
    },
    z.object({ ad: launchAdSchema }).passthrough(),
  );
  return out.ad;
}

/**
 * Delete one file from the client's tray for good: cockpit_csm_launch_ad_remove
 * (gated, audited; the row stays for the audit), then cockpit-csm-api deletes
 * its bytes. Prep's tray uses it for a file that is not this client's.
 */
export async function removeLaunchAd(
  client: DeckClient,
  taskId: string,
  id: string,
): Promise<LaunchAd> {
  const out = await invoke(
    client,
    {
      operation: "launchAds.remove",
      requestId: crypto.randomUUID(),
      args: { taskId, id },
    },
    z.object({ ad: launchAdSchema }).passthrough(),
  );
  return out.ad;
}

// ------------------------------------------------- the deck's video slots

/**
 * The videos behind each slot (docs/csm-decks/VIDEOS.md, the migration
 * 20261020120000_csm_deck_videos.sql): read, saved and cleared only through
 * the three gated functions. The server parses every link and stores the
 * embed address the player frames; the browser checks each row's hosts
 * again and never builds an embed address of its own.
 */
export type VideoLang = "en" | "ar" | "any";
export type VideoProvider = "loom" | "youtube" | "wistia" | "vimeo" | "drive";

const EMBED_HOST = {
  loom: "www.loom.com",
  youtube: "www.youtube-nocookie.com",
  wistia: "fast.wistia.net",
  vimeo: "player.vimeo.com",
  drive: "drive.google.com",
} as const;
const OPEN_HOST =
  /^(www\.loom\.com|www\.youtube\.com|fast\.wistia\.net|vimeo\.com|drive\.google\.com)$/;
const EMBED_HOSTS =
  /^(www\.loom\.com|www\.youtube-nocookie\.com|fast\.wistia\.net|player\.vimeo\.com|drive\.google\.com)$/;
/** Where a provider's poster lives (VIDEOS.md 9, the column's own check). */
const POSTER_HOSTS =
  /^(cdn\.loom\.com|embed-ssl\.wistia\.com|i\.vimeocdn\.com|i\.ytimg\.com)$/;
/** No user, no password, no port. */
const bare = (s: string) => {
  try {
    const u = new URL(s);
    return !u.username && !u.password && !u.port;
  } catch {
    return false;
  }
};

const videoBase = z.object({
  deck: z.enum([
    "onboarding",
    "launch",
    "offer_website",
    "offer_second_campaign",
    "offer_seo_geo",
    "offer_smm",
    "offer_cameraman",
    "offer_ugc",
    "offer_closer",
  ]),
  slotKey: z.string(),
  lang: z.enum(["en", "ar", "any"]),
  provider: z.enum(["loom", "youtube", "wistia", "vimeo", "drive"]),
  url: z.url({ protocol: /^https$/, hostname: OPEN_HOST }).refine(bare),
  embedUrl: z.url({ protocol: /^https$/, hostname: EMBED_HOSTS }).refine(bare),
  title: z.string().nullable(),
  durationSeconds: z.number().int().nullable(),
  revision: z.number().int().min(1),
  updatedBy: z.string(),
  updatedAt: z.string(),
  /**
   * The provider's own thumbnail, kept by the worker (VIDEOS.md 9); absent
   * before the posters migration, null until it is found. A poster from
   * any other host reads as none, so the card is designed and the row
   * itself still plays.
   */
  posterUrl: z
    .url({ protocol: /^https$/, hostname: POSTER_HOSTS })
    .nullable()
    .optional()
    .catch(null),
});
const sameHost = (r: { embedUrl: string; provider: VideoProvider }) =>
  new URL(r.embedUrl).hostname === EMBED_HOST[r.provider];

export const videoRow = videoBase.refine(sameHost);
export type VideoRow = z.infer<typeof videoRow>;
const savedVideo = videoBase.extend({ changed: z.boolean() }).refine(sameHost);

export interface DeckVideos {
  rows: VideoRow[];
  /**
   * Rows the server returned that failed the shape: never shown, never "Not
   * recorded yet". Each keeps the server's revision when it has one, so
   * prep can save it again over the row the server still holds.
   */
  refused: Array<{ slotKey: string; lang: VideoLang; revision?: number }>;
  slots: string[];
}

/** The sentence when the three functions are not deployed yet. */
export const VIDEOS_NOT_LIVE =
  "The deck's videos are not live yet, so no video shows.";

/** The video functions are not live yet: the deck works as it did. */
export class VideosNotLive extends Error {
  constructor() {
    super(VIDEOS_NOT_LIVE);
  }
}

const notLive = (error: unknown) => {
  const e = (error ?? {}) as { code?: unknown; message?: unknown };
  return (
    e.code === "PGRST202" ||
    /could not find the function|PGRST202|does not exist/i.test(
      String(e.message ?? ""),
    )
  );
};

const readShape = z
  .object({
    rows: z.array(z.unknown()).default([]),
    slots: z.array(z.string()).default([]),
  })
  .passthrough();
const keyShape = z
  .object({
    slotKey: z.string(),
    lang: z.enum(["en", "ar", "any"]),
    revision: z.number().int().min(1).optional().catch(undefined),
  })
  .passthrough();

/** A read's rows, split into the ones the browser keeps and the ones it refuses. */
export function videosFrom(data: unknown): DeckVideos {
  const parsed = readShape.safeParse(data);
  if (!parsed.success)
    throw Error(
      "The deck's videos came back in a shape this page does not read.",
    );
  const rows: VideoRow[] = [];
  const refused: DeckVideos["refused"] = [];
  for (const raw of parsed.data.rows) {
    const ok = videoRow.safeParse(raw);
    if (ok.success) rows.push(ok.data);
    else {
      const key = keyShape.safeParse(raw);
      if (key.success)
        refused.push({
          slotKey: key.data.slotKey,
          lang: key.data.lang,
          revision: key.data.revision,
        });
    }
  }
  return { rows, refused, slots: parsed.data.slots };
}

/** cockpit_csm_deck_videos_read, for one deck. */
export async function readDeckVideos(
  client: DeckClient,
  deck: DeckKind,
): Promise<DeckVideos> {
  const { data, error } = await client.rpc("cockpit_csm_deck_videos_read", {
    p_deck: deck,
  });
  if (error) {
    if (notLive(error)) throw new VideosNotLive();
    throw Error(problem(error, "try again"));
  }
  return videosFrom(data);
}

/** The prep field a server sentence is about (VIDEOS.md 4); null puts it on the row. */
export function videoErrorField(
  message: string,
): "link" | "title" | "length" | "language" | null {
  if (
    /^Use the https link\.|^Paste a link from Loom|^That Drive link is a folder|link has no video in it|^That link is too long/.test(
      message,
    )
  )
    return "link";
  if (/^Keep the title under|^The title has a character/.test(message))
    return "title";
  if (/^The length must be between/.test(message)) return "length";
  if (/^Choose English, Arabic or any language/.test(message))
    return "language";
  return null;
}

/** A save or clear the server refused, with what prep does with it. */
export class VideoSaveError extends Error {
  code: "42501" | "22023" | "40001" | "other";
  /** The prep field the sentence goes under; null puts it on the row. */
  field: "link" | "title" | "length" | "language" | null;
  constructor(
    message: string,
    code: VideoSaveError["code"],
    field: VideoSaveError["field"],
  ) {
    super(message);
    this.code = code;
    this.field = field;
  }
}

function saveError(error: unknown, fallback: string): VideoSaveError {
  if (notLive(error)) return new VideoSaveError(VIDEOS_NOT_LIVE, "other", null);
  const raw = String((error as { code?: unknown })?.code ?? "");
  const code: VideoSaveError["code"] =
    raw === "42501" || raw === "22023" || raw === "40001" ? raw : "other";
  const message = problem(error, fallback);
  return new VideoSaveError(
    message,
    code,
    code === "22023" ? videoErrorField(message) : null,
  );
}

/** cockpit_csm_deck_video_save: the saved row, and whether anything changed. */
export async function saveDeckVideo(
  client: DeckClient,
  v: {
    deck: DeckKind;
    slotKey: string;
    lang: VideoLang;
    url: string;
    title?: string | null;
    durationSeconds?: number | null;
    /** The read's revision for this slot and language; 0 when the read left it out. */
    revision: number;
  },
): Promise<VideoRow & { changed: boolean }> {
  const { data, error } = await client.rpc("cockpit_csm_deck_video_save", {
    p_deck: v.deck,
    p_slot_key: v.slotKey,
    p_lang: v.lang,
    p_url: v.url,
    p_title: v.title ?? null,
    p_duration_seconds: v.durationSeconds ?? null,
    p_revision: v.revision,
  });
  if (error) throw saveError(error, "This video was not saved. Try again.");
  const parsed = savedVideo.safeParse(data);
  if (!parsed.success)
    throw new VideoSaveError(
      "The server did not confirm the save. Read the videos again.",
      "other",
      null,
    );
  return parsed.data;
}

/** cockpit_csm_deck_video_clear. */
export async function clearDeckVideo(
  client: DeckClient,
  v: { deck: DeckKind; slotKey: string; lang: VideoLang; revision: number },
): Promise<{ cleared: boolean; revision: number | null }> {
  const { data, error } = await client.rpc("cockpit_csm_deck_video_clear", {
    p_deck: v.deck,
    p_slot_key: v.slotKey,
    p_lang: v.lang,
    p_revision: v.revision,
  });
  if (error) throw saveError(error, "This video was not cleared. Try again.");
  const parsed = z
    .object({ cleared: z.boolean(), revision: z.number().int().nullable() })
    .passthrough()
    .safeParse(data);
  if (!parsed.success)
    throw new VideoSaveError(
      "The server did not confirm the clear. Read the videos again.",
      "other",
      null,
    );
  return { cleared: parsed.data.cleared, revision: parsed.data.revision };
}

// ------------------------------------------- their ads from a Drive link

/**
 * The Drive box's two calls (docs/csm-decks/DRIVE-IMPORT.md 4 and 8; the
 * migration 20261020160000_csm_launch_ads_drive.sql): a request per link and
 * the client's imports, both gated on the client success seat for that
 * client. The browser never reads the imports table; the worker on the
 * editor desk does the rest with the service key.
 */
export const driveImportFile = z.object({
  driveId: z.string().regex(/^[A-Za-z0-9_-]{10,200}$/),
  name: z.string().min(1).max(200),
  kind: z.enum(["image", "video"]),
  bytes: z.number().int().nonnegative().nullable(),
  status: z.enum(["queued", "working", "landed", "skipped", "failed"]),
  code: z
    .enum([
      "too_big",
      "wrong_type",
      "heic",
      "unplayable",
      "download",
      "storage",
      "unfinished",
      "full",
    ])
    .nullable(),
  message: z.string().nullable(),
  note: z.literal("converted").nullable(),
  adId: z.string().uuid().nullable(),
});
export type DriveImportFile = z.infer<typeof driveImportFile>;
export const driveImport = z.object({
  id: z.string().uuid(),
  taskId: z.string(),
  link: z.url({ protocol: /^https$/, hostname: /^drive\.google\.com$/ }),
  driveId: z.string(),
  kind: z.enum(["file", "folder", "either"]),
  status: z.enum(["queued", "working", "done", "failed"]),
  code: z
    .enum([
      "not_found",
      "not_media",
      "nothing_found",
      "drive_down",
      "access_revoked",
      "stopped",
      "not_started",
    ])
    .nullable(),
  message: z.string().nullable(),
  found: z.number().int().min(1).max(20).nullable(),
  overLimit: z.boolean(),
  landed: z.number().int(),
  skipped: z.number().int(),
  failed: z.number().int(),
  files: z.array(driveImportFile).max(20),
  requestedBy: z.string(),
  requestedAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  updatedAt: z.string(),
});
export type DriveImport = z.infer<typeof driveImport>;
export const driveImports = z.object({
  imports: z.array(driveImport).max(20),
  workerSeenAt: z.string().nullable(),
  at: z.string(),
});
export type DriveImports = z.infer<typeof driveImports>;

/**
 * A request or read the server refused: its sentence as the message, the
 * code from the server's HINT (link_empty, too_many_open, …) when it gave
 * one. `notLive`: the two functions are not deployed yet.
 */
export class DriveImportError extends Error {
  code: string | null;
  sqlstate: string | null;
  notLive: boolean;
  constructor(
    message: string,
    o: { code?: string | null; sqlstate?: string | null; notLive?: boolean },
  ) {
    super(message);
    this.code = o.code ?? null;
    this.sqlstate = o.sqlstate ?? null;
    this.notLive = o.notLive ?? false;
  }
  /** A refusal about the link itself goes under the field. */
  get aboutLink(): boolean {
    return /^link_/.test(this.code ?? "");
  }
}

function driveError(error: unknown, fallback: string): DriveImportError {
  if (notLive(error))
    return new DriveImportError(
      "The Drive import's functions are not live yet.",
      { notLive: true },
    );
  const e = (error ?? {}) as { code?: unknown; hint?: unknown };
  const hint = typeof e.hint === "string" && e.hint ? e.hint : null;
  const sqlstate = typeof e.code === "string" && e.code ? e.code : null;
  return new DriveImportError(problem(error, fallback), {
    code: hint && /^[a-z_]{3,40}$/.test(hint) ? hint : null,
    sqlstate,
  });
}

/** Ask for one import. An open import of the same link comes back with existing: true. */
export async function requestDriveImport(
  client: Pick<DeckClient, "rpc">,
  taskId: string,
  link: string,
): Promise<DriveImport & { existing: boolean }> {
  const { data, error } = await client.rpc(
    "cockpit_csm_launch_ads_import_request",
    { p_task_id: taskId, p_link: link },
  );
  if (error) throw driveError(error, "This link was not sent. Try again.");
  const parsed = driveImport.extend({ existing: z.boolean() }).safeParse(data);
  if (!parsed.success)
    throw new DriveImportError(
      "The server did not confirm the import. Paste the link again.",
      {},
    );
  return parsed.data;
}

/** This client's imports, newest first. */
export async function readDriveImports(
  client: Pick<DeckClient, "rpc">,
  taskId: string,
): Promise<DriveImports> {
  const { data, error } = await client.rpc(
    "cockpit_csm_launch_ads_imports_read",
    { p_task_id: taskId },
  );
  if (error) throw driveError(error, "the server did not answer");
  const parsed = driveImports.safeParse(data);
  if (!parsed.success)
    throw new DriveImportError(
      "the imports came back in a shape this page does not read",
      {},
    );
  return parsed.data;
}
