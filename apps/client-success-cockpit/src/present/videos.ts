import { digits, fill, GROUP_LINKS, type L, type Lang, VIDEO } from "./content";
import type { DeckData } from "./deckData";
import type {
  DeckKind,
  DeckVideos,
  VideoLang,
  VideoProvider,
  VideoRow,
} from "./sources";

/**
 * The decks' video slots (the CEO, 2026-10-20: "There should be
 * placeholders for the videos"): one slot per main part of each deck, so a
 * part the CSM skips for time can still be watched. docs/csm-decks/
 * CONTENT.md "Video slots" is the registry, VIDEOS.md the backend, and
 * DESIGN.md 21.2 to 21.5 the control, the player, the notes and prep.
 *
 * This file is pure: the registry, which recording a slot uses for this
 * client, the length as each language says it, the recap's lines, and the
 * rules for a provider's frame and its messages. Missing is never zero: an
 * unread slot is "not read", never "Not recorded yet".
 */

/** Who a slot is shown to: both service models, done for you, or done for you and an approved Mahara OS. */
export type VideoShow = "both" | "dfy" | "dfy-os";

export interface VideoSlot {
  deck: DeckKind;
  key: string;
  /** The slide it belongs to, by id. */
  slide: string;
  show: VideoShow;
  /** What the recording covers (prep's hint, English). */
  covers: string;
}

/**
 * The registry, in slide order: the same twelve `deck:slot` keys as the
 * migration's cockpit_csm_deck_video_slots() (the copy test compares them).
 */
export const VIDEO_SLOTS: readonly VideoSlot[] = [
  {
    deck: "onboarding",
    key: "welcome",
    slide: "welcome",
    show: "both",
    covers: "Mahara's onboarding welcome video.",
  },
  {
    deck: "onboarding",
    key: "meta-access",
    slide: "this-week",
    show: "both",
    covers: "Sharing the Page and the ad account through the one link.",
  },
  {
    deck: "onboarding",
    key: "whatsapp-calendar",
    slide: "this-week",
    show: "dfy-os",
    covers: "Connecting WhatsApp and Google Calendar in Mahara OS.",
  },
  {
    deck: "onboarding",
    key: "testing",
    slide: "next",
    show: "both",
    covers:
      "The same recording as the launch deck's: the ads' job, the volume, input first, the quick check, the content. Save the one link to both.",
  },
  {
    deck: "launch",
    key: "start-to-finish",
    slide: "journey",
    show: "dfy",
    covers:
      "The seven stops, from their ad to the mark after the meeting, with the call within 5 minutes during working hours.",
  },
  {
    deck: "launch",
    key: "testing",
    slide: "creative-freedom",
    show: "both",
    covers:
      "The five stops: the ads' job, the volume, their input first, the quick check, the content.",
  },
  {
    deck: "launch",
    key: "call-team",
    slide: "call",
    show: "dfy",
    covers:
      "How our callers speak for them, the call guide and what we do before the meeting. Never a real customer's call.",
  },
  {
    deck: "launch",
    key: "winning",
    slide: "partnership",
    show: "dfy",
    covers:
      "The pie, the two roads, and why whoever meets the customers takes Project Closing Mastery first (it covers slide 8 too).",
  },
  {
    deck: "launch",
    key: "portal-guide",
    slide: "portal",
    show: "dfy-os",
    covers: "Mahara OS for clients, 13 chapters.",
  },
  {
    deck: "launch",
    key: "calendar-hours",
    slide: "your-part",
    show: "both",
    covers: "Blocking calendar times: the hours, not the whole day.",
  },
  {
    deck: "launch",
    key: "first-90-days",
    slide: "first-90-days",
    show: "both",
    covers:
      "The slower first weeks, the first check-in, then weekly or every two weeks with the reason. No numbers, no dates.",
  },
  {
    deck: "launch",
    key: "payments",
    slide: "good-to-know",
    show: "both",
    covers:
      "The ad account's card and the payments to us on the agreement's dates. No amounts.",
  },
];

export const slotId = (s: { deck: DeckKind; key: string }) =>
  `${s.deck}:${s.key}`;

/** A deck's slots, in slide order. */
export const deckSlots = (deck: DeckKind) =>
  VIDEO_SLOTS.filter(s => s.deck === deck);

/** The slots on one slide (onboarding slide 6 has two). */
export const slideSlots = (deck: DeckKind, slide: string) =>
  VIDEO_SLOTS.filter(s => s.deck === deck && s.slide === slide);

/** The slot's own title. */
export const slotTitle = (s: VideoSlot): L =>
  VIDEO.titles[slotId(s)] ?? { en: s.key, ar: s.key };

export const LANG_NAME: Record<VideoLang, string> = {
  en: "English",
  ar: "Arabic",
  any: "any language",
};

/** How a slot stands for this client's deck, in the deck's language. */
export type SlotState =
  /** The mode rule leaves it out for this client. */
  | { kind: "hidden"; why: "dwy" | "os" }
  /** The read failed or has not happened: never "Not recorded yet". */
  | { kind: "unread"; reason: string | null }
  /** The row the deck would use failed the browser's shape check. */
  | { kind: "refused"; lang: VideoLang }
  /** Nothing in the deck's language or for any; maybe one in the other. */
  | { kind: "empty"; other: VideoRow | null }
  | { kind: "filled"; row: VideoRow };

/** The videos as the deck read them, with the reason when they were not. */
export interface VideoRead {
  videos: DeckVideos | null;
  problem: string | null;
}

/** Done for you only, or Mahara OS approval too: why it is not shown. */
export function hiddenWhy(
  slot: VideoSlot,
  mode: { dwy: boolean; os: boolean },
): "dwy" | "os" | null {
  if (!mode.dwy) return null;
  if (slot.show === "dfy") return "dwy";
  if (slot.show === "dfy-os" && !mode.os) return "os";
  return null;
}

/**
 * The recording a slot uses: the deck's language first, then one for any
 * language. A recording in the other language never shows on the canvas or
 * in the recap; the notes window offers it to the CSM by name.
 */
export function slotState(
  slot: VideoSlot,
  read: VideoRead,
  lang: Lang,
  mode: { dwy: boolean; os: boolean },
): SlotState {
  const why = hiddenWhy(slot, mode);
  if (why) return { kind: "hidden", why };
  const v = read.videos;
  if (!v) return { kind: "unread", reason: read.problem };
  const mine = (l: VideoLang) =>
    v.rows.find(
      r => r.deck === slot.deck && r.slotKey === slot.key && r.lang === l,
    ) ?? null;
  const refused = (l: VideoLang) =>
    v.refused.some(r => r.slotKey === slot.key && r.lang === l);
  for (const l of [lang, "any"] as const) {
    const row = mine(l);
    if (row) return { kind: "filled", row };
    if (refused(l)) return { kind: "refused", lang: l };
  }
  return { kind: "empty", other: mine(lang === "ar" ? "en" : "ar") };
}

/**
 * The revision prep sends when it saves a slot's language: the read's
 * row's; else a refused row's, because the server still holds that row
 * and 0 would conflict on every try; else 0, never recorded (VIDEOS.md 4).
 */
export function saveRevision(
  v: Pick<DeckVideos, "rows" | "refused">,
  slot: Pick<VideoSlot, "deck" | "key">,
  lang: VideoLang,
): number {
  return (
    v.rows.find(
      r => r.deck === slot.deck && r.slotKey === slot.key && r.lang === lang,
    )?.revision ??
    v.refused.find(r => r.slotKey === slot.key && r.lang === lang)?.revision ??
    0
  );
}

/** The mode a deck's videos follow, from its data. */
export const videoMode = (d: DeckData) => ({
  dwy: d.mode.dwy,
  os: d.launch.dwyOs,
});

/** Each slot of one slide with how it stands for this client. */
export function slideVideos(d: DeckData, slide: string) {
  return slideSlots(d.deck, slide).map(slot => ({
    slot,
    state: slotState(slot, d.videos, d.lang, videoMode(d)),
  }));
}

/** The recorded videos a slide shows on the canvas: filled and shown only. */
export function filledOn(d: DeckData, slide: string) {
  return slideVideos(d, slide).flatMap(v =>
    v.state.kind === "filled" ? [{ slot: v.slot, row: v.state.row }] : [],
  );
}

/** A recording's title: the one typed in prep, else the slot's own. */
export const rowTitle = (slot: VideoSlot, row: VideoRow, lang: Lang) =>
  row.title?.trim() || slotTitle(slot)[lang];

/** m:ss, for English and for the cockpit's own windows. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * A video's length as the deck says it, or null with none on file (the
 * control then shows the title alone, never "0:00"). English: m:ss.
 * Arabic: in words, rounded to the minute (a ٠ beside a colon reads as a
 * dot at size): أقل من دقيقة under 30 seconds, دقيقة, دقيقتين, ٣ to ١٠
 * دقايق, then ١١ دقيقة and up.
 */
export function lengthText(
  seconds: number | null | undefined,
  lang: Lang,
): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  if (lang === "en") return clock(seconds);
  const M = VIDEO.minutes;
  if (seconds < 30) return M.under.ar;
  const n = Math.round(seconds / 60);
  if (n <= 1) return M.one.ar;
  if (n === 2) return M.two.ar;
  return fill(n <= 10 ? M.few.ar : M.many.ar, { n: digits(n, "ar") });
}

/**
 * The recap's last block, in the deck's language: every slot that is
 * filled and shown for this client, in slide order, with the link people
 * open (never the embed address). Null with none: never "Watch:" with
 * nothing under it. Filled without Arabic isolates, so each link stays one
 * clickable run in WhatsApp.
 */
/**
 * Whether a slot's recording is shown for this client. An empty, refused,
 * unread or hidden slot (done for you only, for a done-with-you client)
 * is not, so the recaps keep the line that stands in for it.
 */
export function slotCovered(d: DeckData, key: string): boolean {
  const slot = deckSlots(d.deck).find(s => s.key === key);
  return slot
    ? slotState(slot, d.videos, d.lang, videoMode(d)).kind === "filled"
    : false;
}

export function recapVideos(d: DeckData): string | null {
  const lines = deckSlots(d.deck).flatMap(slot => {
    const s = slotState(slot, d.videos, d.lang, videoMode(d));
    return s.kind === "filled"
      ? [`- ${rowTitle(slot, s.row, d.lang)}: ${s.row.url}`]
      : [];
  });
  return lines.length ? [GROUP_LINKS.watch[d.lang], ...lines].join("\n") : null;
}

// ------------------------------------------------- the frame and its messages

/** Each provider's origin: messages are read only from it, and posted only to it. */
export const PROVIDER_ORIGIN: Record<VideoProvider, string> = {
  youtube: "https://www.youtube-nocookie.com",
  vimeo: "https://player.vimeo.com",
  wistia: "https://fast.wistia.net",
  loom: "https://www.loom.com",
  drive: "https://drive.google.com",
};

/**
 * The frame's address: the server's embed address as served, with the
 * deck's autoplay (and YouTube's origin) set through URL and searchParams,
 * never by concatenation (VIDEOS.md 6). Prep's check adds nothing. Null for
 * an address that is not on its provider's own host.
 */
export function frameSrc(
  row: Pick<VideoRow, "provider" | "embedUrl">,
  opts: { autoplay: boolean; origin?: string },
): string | null {
  let u: URL;
  try {
    u = new URL(row.embedUrl);
  } catch {
    return null;
  }
  const origin = PROVIDER_ORIGIN[row.provider];
  if (!origin || u.origin !== origin || u.username || u.password) return null;
  if (opts.autoplay) {
    if (row.provider === "youtube") {
      u.searchParams.set("autoplay", "1");
      if (opts.origin) u.searchParams.set("origin", opts.origin);
    } else if (row.provider === "vimeo") u.searchParams.set("autoplay", "1");
    else if (row.provider === "wistia") u.searchParams.set("autoPlay", "true");
  }
  return u.toString();
}

/** What the deck posts to a provider once its frame has loaded. */
export function handshake(provider: VideoProvider): unknown[] {
  if (provider === "youtube") {
    const w = { id: 1, channel: "widget" };
    return [
      JSON.stringify({ event: "listening", ...w }),
      JSON.stringify({
        event: "command",
        func: "addEventListener",
        args: ["onStateChange"],
        ...w,
      }),
      JSON.stringify({
        event: "command",
        func: "addEventListener",
        args: ["onError"],
        ...w,
      }),
    ];
  }
  if (provider === "vimeo")
    return [
      { method: "addEventListener", value: "play" },
      { method: "addEventListener", value: "error" },
    ];
  return [];
}

export type PlayerSignal = "ready" | "playing" | "blocked";

const asJson = (data: unknown): Record<string, unknown> | null => {
  if (data && typeof data === "object") return data as Record<string, unknown>;
  if (typeof data !== "string" || !data.startsWith("{")) return null;
  try {
    const v = JSON.parse(data) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/**
 * One message from a player, read as the provider posts it (the shapes
 * were read from real frames on 2026-10-20 and are pinned in
 * deck-videos.test.ts). Null for anything else. Only YouTube's own error
 * codes for a removed, private or embed-off video, and Vimeo's errors other
 * than a playback hiccup, count as "can't play here": a missing message is
 * never read as a block. Wistia posts nothing for a video it cannot play,
 * so it never reports a block; Loom and Drive are not read at all.
 */
export function readPlayerMessage(
  provider: VideoProvider,
  data: unknown,
): PlayerSignal | null {
  if (provider === "loom" || provider === "drive") return null;
  if (provider === "wistia") {
    if (data === "new-wistia-iframe") return "ready";
    const j = asJson(data);
    const args = Array.isArray(j?.args) ? (j.args as unknown[]) : [];
    if (j?.method !== "_trigger") return null;
    if (args[0] === "play") return "playing";
    if (args[0] === "statechange" && args[1] === "playing") return "playing";
    return null;
  }
  const j = asJson(data);
  if (!j) return null;
  if (provider === "youtube") {
    if (j.event === "onReady") return "ready";
    if (j.event === "onStateChange" && j.info === 1) return "playing";
    if (
      j.event === "infoDelivery" &&
      (j.info as { playerState?: unknown } | null)?.playerState === 1
    )
      return "playing";
    if (j.event === "onError" && [100, 101, 150].includes(Number(j.info)))
      return "blocked";
    return null;
  }
  // Vimeo
  if (j.event === "ready") return "ready";
  if (j.event === "play" || j.event === "playing") return "playing";
  if (j.event === "error") {
    const name = String((j.data as { name?: unknown } | null)?.name ?? "");
    return name === "PlaybackError" ? null : "blocked";
  }
  return null;
}

/** "m:ss" or "mm:ss" typed in prep, as seconds; null when blank, NaN when unreadable. */
export function parseClock(text: string): number | null {
  const v = text.trim();
  if (!v) return null;
  const m = /^(?:(\d{1,2}):)?(\d{1,3}):([0-5]\d)$/.exec(v);
  if (!m) return Number.NaN;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** The host and id of a link, short enough for prep's row. */
export function shortLink(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname}`;
  } catch {
    return url;
  }
}

// ------------------------------------------------------------- the player

/** What the player shows (DESIGN 21.3); "closed" is only ever reported. */
export type PlayerPhase =
  | "loading"
  | "ready"
  | "playing"
  | "failed"
  | "blocked";

export type PlayerEvent =
  /** The frame's own `load` event. */
  | { type: "load" }
  /** A message read from that player's own frame and its provider's origin. */
  | { type: "signal"; signal: PlayerSignal }
  /** 15 seconds passed without a `load`. */
  | { type: "timeout" }
  /** The browser went offline. */
  | { type: "offline" };

/** How long the frame has to load before the player says it didn't. */
export const LOAD_TIMEOUT_MS = 15_000;
/** "Loading the video" waits this long, so a quick load never flashes it. */
export const LOADING_LINE_MS = 400;

/**
 * One step of the player. A frame that loaded and then says nothing stays
 * up as it is (Loom and Drive always, any provider whose messages don't
 * arrive): a missing message is never read as a failure or a block. Only a
 * frame that never loads fails, and only the provider's own error blocks.
 */
export function playerStep(phase: PlayerPhase, ev: PlayerEvent): PlayerPhase {
  if (phase === "failed" || phase === "blocked") return phase;
  switch (ev.type) {
    case "load":
      return phase === "loading" ? "ready" : phase;
    case "timeout":
    case "offline":
      return phase === "loading" ? "failed" : phase;
    case "signal":
      if (ev.signal === "blocked") return "blocked";
      if (ev.signal === "playing") return "playing";
      return phase === "loading" ? "ready" : phase;
  }
}

/**
 * A message is credited to a player only when it comes from that player's
 * own frame and its provider's exact origin, so a second frame from the same
 * provider (prep's check, onboarding slide 6's two) is never mixed up.
 */
export function ownMessage(
  ev: { origin: string; source: unknown },
  provider: VideoProvider,
  frame: unknown,
): boolean {
  return (
    frame != null &&
    ev.source === frame &&
    ev.origin === PROVIDER_ORIGIN[provider]
  );
}
