// A namespace import: the client success page test mocks convex/react with
// only useQuery and useMutation, and the hooks used here must not fail there.
import * as convexReact from "convex/react";
import { makeFunctionReference } from "convex/server";
import {
  ArrowUpRight,
  ImageOff,
  LoaderCircle,
  Play,
  RefreshCw,
} from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  adsManagerUrl,
  cacheUntil,
  isMetaPreviewUrl,
  metaImageUsable,
  PREVIEW_MAX_AGE_MS,
  type PreviewReason,
  type PreviewResult,
  REASON_TEXT,
  uniqueUrls,
} from "@/lib/metaMedia";

/**
 * One ad, shown so it never breaks.
 *
 * Meta's links expire (preview iframes after about a day, CDN images after a
 * few days), so nothing stored from Meta is shown without checking its age.
 * The picture comes from a chain, and each image that fails to load moves on
 * to the next one:
 *
 *   this cockpit's saved small still, the media buyer's copy, the bigger
 *   stills, Meta's own still while its link is still valid, then a grey
 *   placeholder that says why there is no picture.
 *
 * The live preview (Meta's iframe, video and all) is fetched only when someone
 * opens the ad, through this cockpit's previews.fresh (which asks the media
 * buyer system), and is kept in memory for this tab. If it cannot be fetched,
 * or does not load, the saved picture is shown with a plain reason and a link
 * to the ad in Ads Manager.
 *
 * The media buyer and creative director cockpits hold a copy of this
 * component with the same behaviour. Only their data calls differ.
 */

/** This cockpit's own copy of a saved still (convex/previews.ts stillUrls). */
export type LocalStill = { url?: string; tinyUrl?: string };

type FreshArgs = { adId: string; campaignName?: string; clientName?: string };
type FreshCall = (args: FreshArgs) => Promise<PreviewResult>;

// Both functions live in convex/previews.ts. Named references keep this file
// compiling before the generated api lists that module; they can become
// api.previews.fresh and api.previews.stillUrls after the next codegen.
const freshRef = makeFunctionReference<"action", FreshArgs, PreviewResult>(
  "previews:fresh",
);
const stillUrlsRef = makeFunctionReference<
  "query",
  { keys: string[] },
  Record<string, LocalStill>
>("previews:stillUrls");

const NO_STILLS: Record<string, LocalStill> = {};
const noClient = () => undefined;
const noFresh: FreshCall = () =>
  Promise.reject(new Error("Live previews are not available here."));
const noFreshHook = () => noFresh;

/**
 * This cockpit's saved stills for the rows a screen shows, in one query.
 * The query only re-runs when those stills change, not on every feed.
 *
 * It never breaks the page: if the lookup fails (for example the backend
 * does not have it yet), rows fall back to the media buyer's copies. That
 * is why it watches the query itself rather than using useQuery, which
 * throws into the page on an error.
 */
export function useLocalStills(
  keys: (string | null | undefined)[],
): Record<string, LocalStill> {
  const joined = [...new Set(keys.filter((k): k is string => Boolean(k)))]
    .sort()
    .slice(0, 400)
    .join("\n");
  const convex = (convexReact.useConvex ?? noClient)();
  const [stills, setStills] = useState<Record<string, LocalStill>>();
  useEffect(() => {
    if (!joined || !convex) return;
    const watch = convex.watchQuery(stillUrlsRef, { keys: joined.split("\n") });
    const read = () => {
      try {
        const value = watch.localQueryResult();
        if (value) setStills(value);
      } catch {
        // No local copies this time; the media buyer's copies still show.
      }
    };
    const stop = watch.onUpdate(read);
    read();
    return stop;
  }, [convex, joined]);
  return stills ?? NO_STILLS;
}

/** The picture props for a row: this cockpit's copy first, the media buyer's as backup. */
export function stillPropsFor(
  row: {
    stillKey?: string | null;
    stillUrl?: string | null;
    stillTinyUrl?: string | null;
  },
  local: Record<string, LocalStill>,
) {
  const mine = row.stillKey ? local[row.stillKey] : undefined;
  return {
    stillUrl: mine?.url,
    stillTinyUrl: mine?.tinyUrl,
    backupStillUrl: row.stillUrl ?? undefined,
    backupStillTinyUrl: row.stillTinyUrl ?? undefined,
  };
}

export type CreativePreviewProps = {
  name: string;
  metaAdId?: string;
  accountId?: string;
  /** This cockpit's own saved copy, about 320px. */
  stillUrl?: string;
  /** About 96px. */
  stillTinyUrl?: string;
  /** The media buyer's saved copy, used when ours is missing or fails. */
  backupStillUrl?: string;
  backupStillTinyUrl?: string;
  /** Meta CDN still from the row. Used only while its link has not expired. */
  thumbUrl?: string;
  /** Old stored preview link. Ignored unless previewAt is under 20 hours old. */
  previewSrc?: string;
  previewAt?: number;
  /** Trigger size: 40, 56 or 72px. */
  size?: "sm" | "md" | "lg";
  /** card: the bigger still inline, and "Watch" swaps in the live preview. */
  variant?: "thumb" | "card";
  /** The caller's own reason for having no picture. */
  emptyReason?: string;
  /** Lets a panel keep only one preview open at a time. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Where the ad runs, so the access check can find its client. */
  campaignName?: string;
  clientName?: string;
};

const MINUTE = 60_000;
/** Give up on the backend after this and say it is offline. */
const FETCH_TIMEOUT_MS = 25_000;
/** A preview iframe that has not loaded by now is treated as blocked. */
const FRAME_LOAD_MS = 12_000;
/** A picture that failed is skipped for this long, then tried again. */
const FAILED_IMAGE_MS = 10 * MINUTE;
/** A link dated further ahead than this has a wrong clock behind it. */
const CLOCK_SKEW_MS = 5 * MINUTE;

// The open preview is shorter on a short screen, so the close button and the
// links below it stay in view (280px at least, 560px at most). The saved
// picture leaves more room, for the note above it and the retry button.
const FRAME_HEIGHT = "h-[clamp(280px,calc(100dvh-14rem),560px)]";
const STILL_MAX_HEIGHT = "max-h-[clamp(280px,calc(100dvh-19rem),560px)]";

const BOX = {
  sm: "h-10 w-10",
  md: "h-14 w-14",
  lg: "h-[72px] w-[72px]",
} as const;

const NOTE = {
  loading: "Getting a fresh preview from Meta...",
  timedOut:
    "Meta's preview did not load. The browser may be blocking it. Showing the saved picture.",
  noId: "We do not have this ad's Meta id, so a live preview cannot be fetched.",
  noPicture: "No picture was saved for this ad.",
  liveDescription:
    "Meta's live preview of this ad. The link is fetched when you open it.",
  stillDescription: "Saved picture. Meta's live preview is not available.",
  chosenDescription:
    "Saved picture. Use the button below to try Meta's live preview again.",
} as const;

/** The note for a failed answer. Own keys only, never a built-in like toString. */
function reasonNote(r: PreviewResult): string {
  const reason = String(r.reason ?? "");
  if (Object.hasOwn(REASON_TEXT, reason)) {
    return REASON_TEXT[reason as PreviewReason];
  }
  return typeof r.message === "string" && r.message
    ? r.message
    : REASON_TEXT.error;
}

// ---------------------------------------------------------------------------
// In-memory state shared by every preview on the page (this tab only).

type Held = { result: PreviewResult; until: number };
const held = new Map<string, Held>();
const pending = new Map<string, Promise<PreviewResult>>();
const failedImages = new Map<string, number>();
const listeners = new Set<() => void>();

function changed() {
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The first picture in `sources` that has not failed. A component re-renders
 * only when its own answer changes, so a wall of broken pictures does not
 * re-render every preview on the page once per failure.
 */
function useFirstWorking(sources: string[]): string | undefined {
  const pick = () => sources.find(imageOk);
  return useSyncExternalStore(subscribe, pick, pick);
}

/** This tab's held preview result for one ad, while it is still fresh. */
function useHeld(adId: string | undefined): PreviewResult | undefined {
  const pick = () => (adId ? heldResult(adId) : undefined);
  return useSyncExternalStore(subscribe, pick, pick);
}

function heldResult(adId: string): PreviewResult | undefined {
  const hit = held.get(adId);
  return hit && hit.until > Date.now() ? hit.result : undefined;
}

function forgetResult(adId: string) {
  held.delete(adId);
  changed();
}

/**
 * Until when a fetched live link may be shown, or undefined when it may not.
 * A link dated more than 5 minutes ahead has a wrong clock behind it, so its
 * age cannot be trusted, and no link is used 20 hours after it was fetched.
 */
function linkUntil(
  r: PreviewResult | undefined,
  now: number,
): number | undefined {
  if (!r?.ok || !isMetaPreviewUrl(r.src)) return undefined;
  if (typeof r.expiresAt !== "number") return undefined;
  const fetchedAt = typeof r.fetchedAt === "number" ? r.fetchedAt : undefined;
  if (fetchedAt !== undefined && fetchedAt > now + CLOCK_SKEW_MS) {
    return undefined;
  }
  // A NaN time gives a NaN limit, which is never after now.
  const until = Math.min(r.expiresAt, (fetchedAt ?? now) + PREVIEW_MAX_AGE_MS);
  return until > now ? until : undefined;
}

/** How long a result is reused before asking again. */
function holdUntil(r: PreviewResult, now: number): number {
  // An answer without a usable link is asked for again soon.
  if (r.ok) return linkUntil(r, now) ?? now + 2 * MINUTE;
  return cacheUntil(r, now);
}

function browserOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function failedCall(
  adId: string,
  err: unknown,
  timedOut: boolean,
): PreviewResult {
  const text = err instanceof Error ? err.message : "";
  const offline =
    timedOut ||
    browserOffline() ||
    /connection|network|websocket|failed to fetch/i.test(text);
  return { ok: false, adId, reason: offline ? "offline" : "error" };
}

function cleanResult(adId: string, r: unknown): PreviewResult {
  if (!r || typeof r !== "object") return { ok: false, adId, reason: "error" };
  const result = r as PreviewResult;
  return { ...result, adId: result.adId || adId };
}

/** One call per ad at a time, reused until it goes stale. */
function loadPreview(call: FreshCall, args: FreshArgs): Promise<PreviewResult> {
  const { adId } = args;
  const hit = heldResult(adId);
  if (hit) return Promise.resolve(hit);
  const inFlight = pending.get(adId);
  if (inFlight) return inFlight;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">(resolve => {
    timer = setTimeout(() => resolve("timeout"), FETCH_TIMEOUT_MS);
  });
  const request: Promise<PreviewResult | "timeout"> = browserOffline()
    ? Promise.resolve("timeout")
    : Promise.race([call(args), timeout]);
  const job = request
    .then(r =>
      r === "timeout" ? failedCall(adId, null, true) : cleanResult(adId, r),
    )
    .catch(err => failedCall(adId, err, false))
    .then(result => {
      held.set(adId, { result, until: holdUntil(result, Date.now()) });
      return result;
    })
    .finally(() => {
      clearTimeout(timer);
      pending.delete(adId);
      changed();
    });
  pending.set(adId, job);
  return job;
}

function imageFailed(url: string) {
  failedImages.set(url, Date.now());
  changed();
}

function imageOk(url: string) {
  const at = failedImages.get(url);
  return at === undefined || Date.now() - at > FAILED_IMAGE_MS;
}

/** Rows are untyped: only a non-blank string is an ad id. */
function cleanId(id: unknown): string | undefined {
  return typeof id === "string" && id.trim() ? id.trim() : undefined;
}

/**
 * Rows are untyped: a null, blank or non-text name is left out of the
 * action's arguments, which take only a string.
 */
function cleanName(name: unknown): string | undefined {
  return typeof name === "string" && name.trim() ? name : undefined;
}

/** A Meta still from a fetched result, only while it has not expired. */
function resultThumb(r: PreviewResult | undefined, now: number) {
  if (!r?.thumbUrl) return undefined;
  if (r.thumbExpiresAt !== undefined && r.thumbExpiresAt <= now) {
    return undefined;
  }
  return metaImageUsable(r.thumbUrl, now) ? r.thumbUrl : undefined;
}

/** Meta's still from the row, only while its link has not expired. */
function rowThumb(p: CreativePreviewProps, now: number) {
  return metaImageUsable(p.thumbUrl, now) ? p.thumbUrl : undefined;
}

/** Small first: for the table trigger. */
function smallChain(
  p: CreativePreviewProps,
  r: PreviewResult | undefined,
  now: number,
) {
  return uniqueUrls([
    p.stillTinyUrl,
    p.backupStillTinyUrl,
    p.stillUrl,
    p.backupStillUrl,
    rowThumb(p, now),
    r?.stillTinyUrl,
    r?.stillUrl,
    resultThumb(r, now),
  ]);
}

/** Big first: for the dialog and the card. */
function bigChain(
  p: CreativePreviewProps,
  r: PreviewResult | undefined,
  now: number,
) {
  return uniqueUrls([
    p.stillUrl,
    p.backupStillUrl,
    r?.stillUrl,
    p.stillTinyUrl,
    p.backupStillTinyUrl,
    r?.stillTinyUrl,
    resultThumb(r, now),
    rowThumb(p, now),
  ]);
}

/** An old stored preview link, only while it is under 20 hours old. */
function storedLink(p: CreativePreviewProps): PreviewResult | undefined {
  if (!p.previewSrc || typeof p.previewAt !== "number") return undefined;
  const link: PreviewResult = {
    ok: true,
    adId: cleanId(p.metaAdId) ?? "",
    src: p.previewSrc,
    fetchedAt: p.previewAt,
    expiresAt: p.previewAt + PREVIEW_MAX_AGE_MS,
  };
  return linkUntil(link, Date.now()) ? link : undefined;
}

/**
 * The open preview starts over when the row now shows another ad, so it never
 * plays the previous ad under a new name.
 */
function bodyKey(p: CreativePreviewProps): string {
  const adId = cleanId(p.metaAdId);
  return adId ? `ad:${adId}` : `link:${p.previewSrc ?? ""}`;
}

/**
 * Why there is no picture, for the placeholder. The thumbnail is opened by
 * clicking it; the card has a "Watch" button, so the wording follows that.
 */
function emptyText(p: CreativePreviewProps, now: number): string {
  if (p.emptyReason) return p.emptyReason;
  const hadStill = Boolean(
    p.stillUrl || p.stillTinyUrl || p.backupStillUrl || p.backupStillTinyUrl,
  );
  if (!cleanId(p.metaAdId)) {
    return hadStill
      ? "The saved picture did not load, and we do not have this ad's Meta id to get a new one."
      : "No picture for this ad. It is not in Meta's current list, so none could be saved.";
  }
  const act = p.variant === "card" ? "Click Watch" : "Open it";
  if (hadStill) {
    return `The saved picture did not load. ${act} to get a new one from Meta.`;
  }
  if (p.thumbUrl && !metaImageUsable(p.thumbUrl, now)) {
    return `Meta's picture link has expired and no copy is saved yet. ${act} to get a new one.`;
  }
  return `No saved picture yet. ${act} to get one from Meta.`;
}

// ---------------------------------------------------------------------------

/**
 * The first working picture. Until it answers it sits on a grey box, so a
 * picture that never loads is not a blank space.
 */
function StillImage({
  sources,
  alt,
  className,
  pendingClassName,
  readyClassName = "",
  fallback,
}: {
  sources: string[];
  alt: string;
  className: string;
  /** Until the picture loads: a grey background, and a height if needed. */
  pendingClassName: string;
  readyClassName?: string;
  fallback: ReactNode;
}) {
  const src = useFirstWorking(sources);
  if (!src) return <>{fallback}</>;
  return (
    <LoadingImage
      key={src}
      src={src}
      alt={alt}
      className={className}
      pendingClassName={pendingClassName}
      readyClassName={readyClassName}
    />
  );
}

function LoadingImage({
  src,
  alt,
  className,
  pendingClassName,
  readyClassName,
}: {
  src: string;
  alt: string;
  className: string;
  pendingClassName: string;
  readyClassName: string;
}) {
  const [loaded, setLoaded] = useState(false);
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className={`${className} ${loaded ? readyClassName : pendingClassName}`}
      onLoad={() => setLoaded(true)}
      onError={() => imageFailed(src)}
    />
  );
}

function AdsManagerLink({
  adId,
  accountId,
}: {
  adId: string;
  accountId?: string;
}) {
  return (
    <a
      href={adsManagerUrl(adId, accountId)}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline pointer-coarse:min-h-10"
    >
      Open in Ads Manager
      <ArrowUpRight className="size-3.5" aria-hidden />
    </a>
  );
}

/**
 * The dialog starts on its close button. By default the first focusable
 * element would be Meta's preview iframe whenever the link is already held,
 * and once Meta's page loads, key presses go into that page, so Escape would
 * no longer close the dialog.
 */
function startOnClose(event: Event) {
  const dialog = event.currentTarget;
  if (!(dialog instanceof HTMLElement)) return;
  const close = dialog.querySelector<HTMLElement>('[data-slot="dialog-close"]');
  if (!close) return;
  event.preventDefault();
  close.focus();
}

function withoutShowing(note: string) {
  return note.replace(/\s*Showing the saved picture\.$/, "");
}

/**
 * The open preview: fetches the live link, shows the iframe when it is valid,
 * and falls back to the saved picture with a plain reason.
 */
function PreviewBody({
  p,
  header,
  onClose,
}: {
  p: CreativePreviewProps;
  header?: (description: string) => ReactNode;
  onClose?: () => void;
}) {
  // Mounted only while a preview is open, so a page test that mocks
  // convex/react without useAction still renders the closed thumbnails.
  const useFresh: (ref: typeof freshRef) => FreshCall =
    convexReact.useAction ?? noFreshHook;
  const fresh = useFresh(freshRef);
  // Held in a ref, so a new function identity never starts another fetch.
  const callRef = useRef(fresh);
  callRef.current = fresh;
  const adId = cleanId(p.metaAdId);
  const campaignName = cleanName(p.campaignName);
  const clientName = cleanName(p.clientName);
  const [initial] = useState(
    () => storedLink(p) ?? (adId ? heldResult(adId) : undefined),
  );
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<PreviewResult | undefined>(initial);
  const [loading, setLoading] = useState(Boolean(adId) && !initial);
  const [stillChosen, setStillChosen] = useState(false);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [frameTimedOut, setFrameTimedOut] = useState(false);

  useEffect(() => {
    if (!adId || (attempt === 0 && initial)) return;
    let live = true;
    setLoading(true);
    // Only names that are there are sent, so a missing one never fails the
    // action's arguments.
    const args: FreshArgs = { adId };
    if (campaignName) args.campaignName = campaignName;
    if (clientName) args.clientName = clientName;
    loadPreview(callRef.current, args).then(r => {
      if (!live) return;
      setResult(r);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [adId, attempt, campaignName, clientName, initial]);

  const now = Date.now();
  const frameSrc = linkUntil(result, now) ? result?.src : undefined;
  const showFrame = Boolean(frameSrc) && !stillChosen && !frameTimedOut;

  useEffect(() => {
    if (!showFrame || frameLoaded) return;
    const timer = setTimeout(() => setFrameTimedOut(true), FRAME_LOAD_MS);
    return () => clearTimeout(timer);
  }, [showFrame, frameLoaded]);

  const stills = bigChain(p, result, now);
  const hasStill = Boolean(useFirstWorking(stills));
  const noPicture = !loading && !showFrame && !hasStill;

  let note: string | undefined;
  if (loading) note = NOTE.loading;
  else if (showFrame) note = undefined;
  else if (frameTimedOut) note = NOTE.timedOut;
  else if (stillChosen) note = undefined;
  else if (!adId) note = NOTE.noId;
  else if (result && !result.ok) note = reasonNote(result);
  else if (result) note = REASON_TEXT.error;
  if (noPicture) {
    note = note ? `${withoutShowing(note)} ${NOTE.noPicture}` : NOTE.noPicture;
  }

  let description: string =
    showFrame || loading
      ? NOTE.liveDescription
      : (stillChosen || frameTimedOut) && frameSrc
        ? NOTE.chosenDescription
        : NOTE.stillDescription;
  // With nothing saved, "Saved picture." would be untrue.
  if (noPicture) description = description.replace(/^Saved picture\.\s*/, "");

  const retry = () => {
    if (adId) forgetResult(adId);
    setResult(undefined);
    setStillChosen(false);
    setFrameLoaded(false);
    setFrameTimedOut(false);
    setLoading(Boolean(adId));
    setAttempt(a => a + 1);
  };

  const accountId = p.accountId ?? result?.accountId;
  const ratio =
    result?.width && result?.height
      ? `${result.width} / ${result.height}`
      : undefined;

  return (
    <div className="min-w-0 space-y-2">
      {header?.(description)}
      {note && (
        <p
          role="status"
          className="flex items-start gap-1.5 text-xs text-muted-foreground"
        >
          {loading && (
            <LoaderCircle
              className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin"
              aria-hidden
            />
          )}
          <span>{note}</span>
        </p>
      )}
      {showFrame && frameSrc ? (
        <>
          <iframe
            key={frameSrc}
            src={frameSrc}
            title={p.name}
            loading="lazy"
            allow="autoplay; encrypted-media; picture-in-picture"
            referrerPolicy="strict-origin-when-cross-origin"
            style={{ aspectRatio: ratio }}
            className={`${FRAME_HEIGHT} w-full rounded border ${frameLoaded ? "bg-card" : "bg-muted"}`}
            onLoad={() => setFrameLoaded(true)}
          />
          <button
            type="button"
            onClick={() => setStillChosen(true)}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground pointer-coarse:min-h-10"
          >
            Blank, or says expired? Show the saved picture
          </button>
        </>
      ) : (
        <StillImage
          sources={stills}
          alt={p.name}
          className={`${STILL_MAX_HEIGHT} w-full rounded border object-contain`}
          pendingClassName="min-h-[200px] bg-muted"
          readyClassName="bg-card"
          fallback={
            <div
              role="img"
              aria-label={loading ? NOTE.loading : NOTE.noPicture}
              className="flex h-[200px] w-full items-center justify-center rounded border bg-muted text-muted-foreground"
            >
              {loading ? (
                <LoaderCircle className="h-6 w-6 animate-spin" aria-hidden />
              ) : (
                <ImageOff className="h-6 w-6" aria-hidden />
              )}
            </div>
          }
        />
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {adId && !loading && !showFrame && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-2.5 text-xs pointer-coarse:h-10"
            onClick={retry}
          >
            <RefreshCw aria-hidden />
            Try the live preview again
          </Button>
        )}
        {adId && <AdsManagerLink adId={adId} accountId={accountId} />}
        {onClose && (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2.5 text-xs pointer-coarse:h-10"
            onClick={onClose}
          >
            Hide the preview
          </Button>
        )}
      </div>
    </div>
  );
}

export function CreativePreview(props: CreativePreviewProps) {
  const { name, size = "sm", variant = "thumb" } = props;
  const metaAdId = cleanId(props.metaAdId);
  const [ownOpen, setOwnOpen] = useState(false);
  const isOpen = props.open ?? ownOpen;
  const setOpen = (next: boolean) => {
    if (props.open === undefined) setOwnOpen(next);
    props.onOpenChange?.(next);
  };

  const now = Date.now();
  const known = useHeld(metaAdId);
  const reason = emptyText(props, now);
  const chain =
    variant === "card"
      ? bigChain(props, known, now)
      : smallChain(props, known, now);
  const shown = useFirstWorking(chain);
  // Something to play: a Meta id to fetch with, or a stored link still valid.
  const canWatch = Boolean(metaAdId || storedLink(props));

  if (variant === "card") {
    return (
      <div className="min-w-0 space-y-1.5">
        {isOpen ? (
          <PreviewBody
            key={bodyKey(props)}
            p={props}
            onClose={() => setOpen(false)}
          />
        ) : (
          <>
            <StillImage
              sources={chain}
              alt={name}
              className="max-h-[420px] w-full rounded-md border object-contain"
              pendingClassName="min-h-[140px] bg-muted"
              readyClassName="bg-card"
              fallback={
                <div
                  role="img"
                  aria-label={reason}
                  title={reason}
                  className="flex min-h-[140px] w-full flex-col items-center justify-center gap-2 rounded-md border bg-muted p-3 text-center text-xs text-muted-foreground"
                >
                  <ImageOff className="h-6 w-6" aria-hidden />
                  <span>{reason}</span>
                </div>
              }
            />
            {canWatch && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8 px-2.5 text-xs pointer-coarse:h-10"
                  onClick={() => setOpen(true)}
                >
                  <Play aria-hidden />
                  Watch
                </Button>
                {metaAdId && (
                  <AdsManagerLink
                    adId={metaAdId}
                    accountId={props.accountId ?? known?.accountId}
                  />
                )}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  const box = BOX[size];
  const placeholderIcon = (
    <span className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
      <ImageOff className="h-4 w-4" aria-hidden />
    </span>
  );

  if (!canWatch && !shown) {
    return (
      <div
        role="img"
        aria-label={reason}
        title={reason}
        className={`${box} shrink-0 overflow-hidden rounded bg-muted ring-1 ring-border`}
      >
        {placeholderIcon}
      </div>
    );
  }

  const label = shown
    ? canWatch
      ? `Watch this ad: ${name}`
      : `View the saved picture: ${name}`
    : reason;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={label}
        aria-label={label}
        className={`${box} group relative shrink-0 overflow-hidden rounded bg-muted ring-1 ring-border transition hover:ring-2 hover:ring-primary`}
      >
        <StillImage
          sources={chain}
          alt=""
          className="h-full w-full object-cover"
          pendingClassName="bg-muted"
          fallback={placeholderIcon}
        />
        <span className="absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition group-hover:opacity-100">
          <Play className="h-4 w-4 fill-white text-white" aria-hidden />
        </span>
      </button>

      <Dialog open={isOpen} onOpenChange={setOpen}>
        {/* Capped at the screen height and scrolls, so on a short screen the
            close button and the links under the preview stay reachable. The
            width is the base dialog's: a 1rem gutter on a phone, 32rem wide
            from the sm breakpoint. */}
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
          onOpenAutoFocus={startOnClose}
        >
          {/* Mounted only while open, so each opening starts fresh. Keyed by
              the ad, so a row that now points at another ad starts over. */}
          <PreviewBody
            key={bodyKey(props)}
            p={props}
            header={description => (
              <DialogHeader>
                <DialogTitle className="pr-6 text-sm" dir="auto">
                  {name}
                </DialogTitle>
                <DialogDescription className="text-xs">
                  {description}
                </DialogDescription>
              </DialogHeader>
            )}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
