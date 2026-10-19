import { useSyncExternalStore } from "react";
import type { DeckMessage, LocalFile, UploadPhase } from "./channel";
import type { Creative } from "./creative";
import {
  type FileFacts,
  type LaunchAd,
  MAX_UPLOAD_BYTES,
  problem,
  UPLOAD_TYPES,
} from "./sources";

/**
 * Adding a creative during the call (DESIGN 10.3, 10.4). The CSM adds a
 * file in the notes window; it shows on the phone at once from the local
 * copy (posted to the deck window as a Blob), and the save runs behind it:
 * reserve, a signed upload with progress, then ready, through
 * cockpit-csm-api's launchAds operations (gated, audited). On the canvas
 * only a thin bar along the phone's foot moves; the words (progress,
 * "Saved", errors) are said in the notes window only. Anything the browser
 * can show is shown; only the save is refused.
 */

export type Refusal =
  /** Nothing changes: not a picture or a video, or an empty file. */
  | { show: false; save: false; message: string }
  /** Shown, not saved: over 150 MB. */
  | { show: true; save: false; message: string };

/** What happens to a file before anything is read from it. */
export function planUpload(file: {
  name: string;
  type: string;
  size: number;
}): Refusal | { show: true; save: true; message: null } {
  const ext = file.name.split(".").pop()?.toUpperCase() ?? "file";
  if (!(file.type in UPLOAD_TYPES))
    return {
      show: false,
      save: false,
      message: `${file.name} is a ${ext}. Add a picture (JPG, PNG, WebP) or a video (MP4, MOV, WebM).`,
    };
  if (file.size === 0)
    return { show: false, save: false, message: `${file.name} is empty.` };
  if (file.size > MAX_UPLOAD_BYTES)
    return {
      show: true,
      save: false,
      message: `Shown, not saved: ${file.name} is over 150 MB. Export a smaller copy to keep it.`,
    };
  return { show: true, save: true, message: null };
}

export interface AddDeps {
  /** The file's size, length and first frame (sources.readFileFacts). */
  facts: (file: File) => Promise<FileFacts>;
  /** The save itself (sources.uploadLaunchAd through the seat's client). */
  save: (args: {
    file: File;
    kind: "starter" | "custom";
    facts: FileFacts;
    onProgress: (share: number) => void;
  }) => Promise<LaunchAd>;
  /** Tell every window (and this one): the hub's post plus the local store. */
  emit: (m: DeckMessage) => void;
  newId?: () => string;
}

export interface AddResult {
  id: string | null;
  phase: UploadPhase | "refused";
  message: string | null;
  saved?: LaunchAd;
}

/** The plain sentence for a save that stopped. */
export function saveProblem(error: unknown): string {
  const said = problem(
    error,
    "Not saved. Add it again to retry.",
    "Not saved: no connection. Add it again once you are back online.",
  );
  if (/^Shown, not saved/.test(said)) return said;
  if (/^Not saved: no connection/.test(said)) return said;
  if (/sign-in|sign in|JWT|401/i.test(said))
    return "Saving needs your cockpit sign-in. The preview still works.";
  if (/backend is not live/i.test(said))
    return "Not saved: the deck's backend is not live yet. The preview still works.";
  return /add it again|try/i.test(said)
    ? said
    : `Not saved. Add it again to retry. (${said})`;
}

/** Add one file: show it, then save it, telling the windows as it goes. */
export async function addFile(
  file: File,
  opts: { kind: "starter" | "custom"; phone?: LocalFile["phone"] },
  deps: AddDeps,
): Promise<AddResult> {
  const plan = planUpload(file);
  if (!plan.show) return { id: null, phase: "refused", message: plan.message };
  let facts: FileFacts;
  try {
    facts = await deps.facts(file);
  } catch {
    return {
      id: null,
      phase: "refused",
      message: `This browser can't play ${file.name}. Export it as MP4.`,
    };
  }
  const id = `local-${deps.newId?.() ?? crypto.randomUUID()}`;
  const phase: UploadPhase = plan.save ? "saving" : "shown";
  deps.emit({
    type: "file",
    file: {
      id,
      name: file.name,
      mime: file.type,
      bytes: file.size,
      blob: file,
      poster: facts.poster ?? null,
      width: facts.width ?? null,
      height: facts.height ?? null,
      seconds: facts.seconds ?? null,
      kind: opts.kind,
      phone: opts.phone ?? null,
      phase,
      progress: 0,
      message: plan.message,
    },
  });
  if (!plan.save) return { id, phase: "shown", message: plan.message };
  let last = 0;
  try {
    const saved = await deps.save({
      file,
      kind: opts.kind,
      facts,
      onProgress: share => {
        // Every twentieth is enough for a 4 px bar and a percentage.
        if (share - last < 0.05 && share < 1) return;
        last = share;
        deps.emit({ type: "upload", id, phase: "saving", progress: share });
      },
    });
    deps.emit({
      type: "upload",
      id,
      phase: "saved",
      progress: 1,
      savedId: saved.id,
      message: null,
    });
    return { id, phase: "saved", message: null, saved };
  } catch (e) {
    const message = saveProblem(e);
    deps.emit({ type: "upload", id, phase: "failed", message });
    return { id, phase: "failed", message };
  }
}

// -------------------------------------------- what this window holds

export interface LocalItem extends Omit<LocalFile, "blob" | "poster"> {
  url: string;
  posterUrl: string | null;
  /** Its object URLs were freed: the saved copy draws it now. */
  released?: boolean;
}

type Listener = () => void;

/**
 * The files added during the call, in this window: each window makes its
 * own object URLs for the Blobs it was sent. Once the tray's saved copy
 * comes back, the saved one stands in its place and this window's object
 * URLs are freed (the row stays, so the notes window still says "Saved").
 * Adding a file again drops its earlier failed try.
 */
export class LocalAds {
  private items: LocalItem[] = [];
  private readonly listeners = new Set<Listener>();
  private readonly urls = new Map<string, string[]>();
  private readonly makeUrl: (b: Blob) => string;
  private readonly freeUrl: (u: string) => void;
  constructor(
    makeUrl: (b: Blob) => string = b => URL.createObjectURL(b),
    freeUrl: (u: string) => void = u => URL.revokeObjectURL(u),
  ) {
    this.makeUrl = makeUrl;
    this.freeUrl = freeUrl;
  }

  get list(): LocalItem[] {
    return this.items;
  }

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  private changed() {
    this.items = [...this.items];
    for (const l of this.listeners) l();
  }

  add(file: LocalFile) {
    if (this.items.some(i => i.id === file.id)) return;
    for (const i of this.items)
      if (i.phase === "failed" && i.name === file.name) this.free(i.id);
    this.items = this.items.filter(
      i => !(i.phase === "failed" && i.name === file.name),
    );
    const url = this.makeUrl(file.blob);
    const posterUrl = file.poster ? this.makeUrl(file.poster) : null;
    this.urls.set(file.id, posterUrl ? [url, posterUrl] : [url]);
    const { blob: _b, poster: _p, ...rest } = file;
    this.items.push({ ...rest, url, posterUrl });
    this.changed();
  }

  update(id: string, patch: Partial<LocalItem>) {
    const at = this.items.findIndex(i => i.id === id);
    if (at < 0) return;
    this.items[at] = { ...this.items[at], ...patch };
    this.changed();
  }

  private free(id: string) {
    for (const u of this.urls.get(id) ?? []) this.freeUrl(u);
    this.urls.delete(id);
  }

  remove(id: string) {
    const before = this.items.length;
    this.items = this.items.filter(i => i.id !== id);
    this.free(id);
    if (this.items.length !== before) this.changed();
  }

  /**
   * The tray read back these saved ids: their local copies' object URLs go
   * (the saved copy draws them now); the rows stay for the notes window.
   */
  release(savedIds: Iterable<string>) {
    const ids = new Set(savedIds);
    let any = false;
    this.items = this.items.map(i => {
      if (!(i.savedId && ids.has(i.savedId) && this.urls.has(i.id))) return i;
      this.free(i.id);
      any = true;
      return { ...i, released: true };
    });
    if (any) this.changed();
  }

  /** Apply a message from another window (or this one). */
  apply(m: DeckMessage) {
    if (m.type === "file") this.add(m.file);
    else if (m.type === "upload")
      this.update(m.id, {
        phase: m.phase,
        ...(m.progress != null ? { progress: m.progress } : {}),
        ...(m.savedId !== undefined ? { savedId: m.savedId } : {}),
        ...(m.message !== undefined ? { message: m.message } : {}),
      });
  }
}

/** This window's files added during the call. */
export const localAds = new LocalAds();

export function useLocalAds(): LocalItem[] {
  return useSyncExternalStore(
    localAds.subscribe,
    () => localAds.list,
    () => localAds.list,
  );
}

/** A file added on the call, as the phones draw it. */
export function localCreative(i: LocalItem): Creative {
  const video = i.mime.startsWith("video/");
  return {
    id: i.id,
    from: "upload",
    name: i.name,
    url: i.url,
    poster: video ? i.posterUrl : i.url,
    video,
    ratio: i.width && i.height ? i.width / i.height : null,
    primaryText: null,
    headline: null,
    cta: null,
    language: null,
    placement: null,
    starter: i.kind === "starter",
    seconds: i.seconds ?? null,
  };
}

/**
 * The tray: the saved uploads, then the files added on the call that the
 * saved list does not hold yet (a saved one stands in for its local copy).
 */
export function trayCreatives(
  saved: Creative[],
  local: LocalItem[],
): (Creative & { local?: LocalItem })[] {
  const ids = new Set(saved.map(c => c.id));
  return [
    ...saved,
    ...local
      .filter(i => !i.released && !(i.savedId && ids.has(i.savedId)))
      .map(i => ({ ...localCreative(i), local: i })),
  ];
}

/** A phone's creative id after a save: the local copy's id becomes the saved one. */
export function remapPhones<K extends string>(
  phones: Partial<Record<K, string>>,
  from: string,
  to: string,
): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = { ...phones };
  for (const k of Object.keys(out) as K[]) if (out[k] === from) out[k] = to;
  return out;
}
