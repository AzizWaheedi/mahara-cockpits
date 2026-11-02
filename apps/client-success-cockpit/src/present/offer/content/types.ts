/**
 * The shapes of the offer decks' words (CONTRACT.md 5.7,
 * docs/upsell-studio/CONTENT.md). The words themselves live beside this
 * file: OFFER_CHROME (shared.ts), WEBSITE_DECK (website.ts) and
 * WEBSITE_VIDEO (websiteVideo.ts). Each offer's catalog copy (name, lines,
 * parts, get, need, steps, why, button) lives in the database, written by
 * supabase/migrations/20261026x_upsell_catalog_copy.sql.
 *
 * Slots. `{slot}` marks a value the deck fills (content.ts `fill`; a slot
 * with no value is left out). The slots these files use:
 * - `{name}`: the client's name (the tab, the "Example, drawn for" tag); in
 *   the after-call WhatsApp message, the CSM's own first name, signing off.
 * - `{date}`: a day, written the deck's way (dates.ts), in the capture's
 *   "Captured" line and the "Your answer" line.
 * - `{city}`: what a capture was searched as.
 * - `{build}`, `{care}`: the opening price of each part with its unit, as
 *   formatMoney writes it ("2,000 dollars", "٢٠٠٠ دولار"). Notes only.
 * - `{final}`: the lower build price said on the call after "Held full
 *   price". Notes only, never the canvas.
 * - `{project}`: the client's typical project value with its currency.
 *   Notes only; the canvas shows it on its own line.
 * - `{video}`, `{next}`: the pitch's video link and the agreed next step,
 *   in the WhatsApp message.
 * - `{url}`: the proposal's own link, on the printed page.
 *
 * Notes lines open with the stop they belong to in brackets, "(capture)",
 * and directions to the CSM are whole lines in brackets. Neither is said
 * aloud.
 */
import type { L } from "../../content";

export type { L };

/**
 * What the CSM says on one slide, in the notes window only. `say` is
 * English; `sayKw` and `saySa` are the same moments spoken in Kuwaiti and
 * Saudi (`dialectFor` in callScript.ts picks one). `push` holds what to say
 * only if the client pushes back.
 */
export interface OfferNotesCopy {
  say: string[];
  sayKw: string[];
  saySa: string[];
  push?: string[];
  pushKw?: string[];
  pushSa?: string[];
}

/** One slide: its title, one canvas line per stop, and its notes. */
export interface OfferSlideCopy {
  title: L;
  /** One line per stop, keyed by the stop's id, in the stops' order. */
  stops: Record<string, L>;
  /**
   * Canvas lines that are not a stop's own: the variant a client's data
   * picks (a site that doesn't open, a thin site), the label above their
   * own words, the drawn site's own labels, and the ask shown when a slot
   * is empty.
   */
  lines?: Record<string, L>;
  notes: OfferNotesCopy;
}

export type OfferCountry = "any" | "KW" | "SA" | "AE" | "QA" | "BH";

/** An outside fact for the notes, never the canvas, with where it came from. */
export interface OfferFact {
  text: string;
  source: string;
  year: number;
  country: OfferCountry;
}

/** The three answers slide 1's question can get. */
export type OfferBranch = "no_site" | "broken" | "working_on_it";
/** The three reasons a client gives for not having one yet. */
export type OfferObjection = "busy" | "burned" | "expensive";
/** The price steps, in the order they may happen on a call. */
export type OfferPriceStep = "hold" | "lower" | "split";

export interface OfferDeckCopy<S extends string = string> {
  /** The deck's name in the notes window and prep. */
  name: L;
  /** The browser tab: "{name}: your website". */
  tab: L;
  slides: Record<S, OfferSlideCopy>;
  branches: Record<OfferBranch, OfferNotesCopy>;
  objections: Record<OfferObjection, OfferNotesCopy>;
  price: Record<OfferPriceStep, OfferNotesCopy>;
  /** The after-call WhatsApp message, with {video}, {next} and {name}. */
  whatsapp: { en: string; kw: string; sa: string };
  facts: OfferFact[];
}

export type OfferVideoBeatId = "hook" | "gap" | "what" | "need" | "return";

/** One beat of an offer's one-minute video. Times are seconds. */
export interface OfferVideoBeat {
  id: OfferVideoBeatId;
  start: number;
  end: number;
  /** The narrator's words. ".." is a short pause, never read aloud. */
  vo: L;
  /** Every word the beat puts on screen, in the order it lands. */
  labels: { en: string[]; ar: string[] };
}

export interface OfferVideoCopy {
  beats: OfferVideoBeat[];
  /** The closing line, from the CEO's own recorded clip. */
  closing: L;
  /** The poster's one line: the still a client sees before pressing play. */
  poster: L;
}

/** The words every offer deck shares (OFFER_CHROME). */
export type OfferChromeKey =
  | "revA"
  | "revB"
  | "captured"
  | "searchedAs"
  | "example"
  | "yourFigure"
  | "fromAnswer"
  | "fromSheet"
  | "item"
  | "description"
  | "terms"
  | "dollars"
  | "paidInFull"
  | "typicalProject"
  | "thisFirstYear"
  | "howMany"
  | "weNeed"
  | "commitTitle"
  | "fromMainProgramme"
  | "oneTime"
  | "monthly"
  | "perDay"
  | "per90";
