import { isOfferDeck, offerDeckUrl, offerOfDeck } from "./offer/kinds";
import type { PresentUrls } from "./PresentApp";
import type { DeckKind } from "./sources";

/** The app's base path; read when used (tests run without Vite's env). */
const base = () =>
  (import.meta.env?.BASE_URL ?? "/client-success/").replace(/\/$/, "");

export function presentUrls(
  key: string,
  deck: DeckKind,
  lang?: string,
  rehearse = false,
): PresentUrls {
  if (isOfferDeck(deck)) {
    const params = lang ? `?lang=${lang}` : "";
    const offer = offerOfDeck(deck);
    return {
      deck: offerDeckUrl(key, offer) + params,
      notes: offerDeckUrl(key, offer, "notes") + params,
      prep: offerDeckUrl(key, offer, "prep"),
      client: `${base()}/clients/${encodeURIComponent(key)}?tab=money`,
      other: offerDeckUrl(key, offer, "prep"),
    };
  }
  const k = encodeURIComponent(key);
  // A rehearsal stays a rehearsal in every window it opens: each window
  // reads ?rehearse=1 from its own address only.
  const params = [lang ? `lang=${lang}` : null, rehearse ? "rehearse=1" : null]
    .filter(Boolean)
    .join("&");
  const q = params ? `?${params}` : "";
  const r = rehearse ? "&rehearse=1" : "";
  // The Blueprint deck has no sister deck: its "other" link is its own prep.
  const other: DeckKind =
    deck === "blueprint"
      ? "blueprint"
      : deck === "onboarding"
        ? "launch"
        : "onboarding";
  return {
    deck: `${base()}/clients/${k}/present/${deck}${q}`,
    notes: `${base()}/clients/${k}/present/${deck}/notes${q}`,
    prep: `${base()}/clients/${k}/present/${deck}?view=prep${r}`,
    client: `${base()}/clients/${k}?tab=onboarding`,
    other: `${base()}/clients/${k}/present/${other}?view=prep${r}`,
  };
}
