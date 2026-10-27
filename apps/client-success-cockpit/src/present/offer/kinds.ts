export const OFFER_KEYS = [
  "website",
  "second_campaign",
  "seo_geo",
  "smm",
  "cameraman",
  "ugc",
  "closer",
] as const;
export type OfferKey = (typeof OFFER_KEYS)[number];
export const OFFER_ORDER = OFFER_KEYS;
export type OfferDeckKind = `offer_${OfferKey}`;
export const BUILT_OFFER_DECKS: readonly OfferDeckKind[] = OFFER_KEYS.map(
  key => `offer_${key}` as OfferDeckKind,
);
export const isOfferDeck = (value: unknown): value is OfferDeckKind =>
  typeof value === "string" &&
  BUILT_OFFER_DECKS.includes(value as OfferDeckKind);
export const isOfferKey = (value: unknown): value is OfferKey =>
  typeof value === "string" &&
  (OFFER_KEYS as readonly string[]).includes(value);
export const offerOfDeck = (deck: OfferDeckKind): OfferKey =>
  deck.slice(6) as OfferKey;
export const deckOfOffer = (offer: OfferKey): OfferDeckKind => `offer_${offer}`;
const base = () =>
  (import.meta.env?.BASE_URL ?? "/client-success/").replace(/\/$/, "");
export const offerDeckUrl = (
  taskId: string,
  key: OfferKey,
  view?: "prep" | "notes" | "present",
) =>
  `${base()}/clients/${encodeURIComponent(taskId)}/present/offer/${key}${view === "notes" ? "/notes" : view === "prep" ? "?view=prep" : ""}`;
export const proposalNewUrl = (taskId: string, key: OfferKey) =>
  `${base()}/clients/${encodeURIComponent(taskId)}/proposals/new?offer=${key}`;
export const proposalUrl = (taskId: string, id: string) =>
  `${base()}/clients/${encodeURIComponent(taskId)}/proposals/${encodeURIComponent(id)}`;
export const OFFER_NAMES: Record<OfferKey, string> = {
  website: "Website",
  second_campaign: "Second campaign",
  seo_geo: "Google and AI search",
  smm: "Social media",
  cameraman: "Cameraman day",
  ugc: "Presenter videos",
  closer: "Closer placement",
};
