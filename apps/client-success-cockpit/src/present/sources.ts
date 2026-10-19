import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * The reads and writes behind the two decks (supabase/migrations/
 * 20261019120000_csm_decks.sql, supabase/functions/cockpit-csm-api/
 * launchAds.ts). Every call goes through the signed-in seat's own client,
 * so cockpit_csm_client_gate decides which client may be opened. Nothing
 * here returns leads, cost per lead, spend or budgets.
 */

export type DeckKind = "onboarding" | "launch";

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
  })
  .passthrough();
export type LaunchAd = z.infer<typeof launchAdSchema>;

const prepRow = z
  .object({
    deck: z.enum(["onboarding", "launch"]),
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
