import type { SupabaseClient } from "@supabase/supabase-js";
import { loadDeck } from "../load";
import type { Loaded } from "../useDeckModel";
import {
  findLogos,
  listUpsellFiles,
  markWin,
  pickLogo,
  pitchVideo,
  readOfferSources,
  removeUpsellFile,
  runSiteCheck,
  savePitch,
  updateUpsellFile,
  uploadUpsellFile,
} from "./sources";
import type { OfferIO } from "./useOffer";
import { deckOfOffer, type OfferKey } from "./kinds";
export async function loadOfferDeck(
  client: SupabaseClient,
  taskId: string,
  key: OfferKey = "website",
): Promise<Loaded> {
  const [deck, offer, files] = await Promise.all([
    loadDeck(client, taskId, deckOfOffer(key)),
    readOfferSources(client, taskId, key),
    listUpsellFiles(client, taskId),
  ]);
  return {
    ...deck,
    offer: { ...offer, files: files.rows },
    prep: { ...deck.prep, [deckOfOffer(key)]: offer.prep?.overrides ?? {} },
  };
}
export function offerIO(
  client: SupabaseClient,
  taskId: string,
  key: OfferKey = "website",
): OfferIO {
  return {
    readSources: () => readOfferSources(client, taskId, key),
    savePitch: (requestId, patch, revision) =>
      savePitch(client, taskId, key, requestId, patch, revision),
    pitchVideo: id => pitchVideo(client, id),
    siteCheck: url => runSiteCheck(client, taskId, url),
    markWin: (text, on) => markWin(client, taskId, text, on),
    upload: (file, on, searchedAs, requestId) =>
      uploadUpsellFile(client, taskId, file, on, searchedAs, requestId),
    updateFile: (id, patch) => updateUpsellFile(client, taskId, id, patch),
    removeFile: id => removeUpsellFile(client, taskId, id),
    findLogos: () => findLogos(client, taskId),
    pickLogo: (url, id) => pickLogo(client, taskId, url, id),
  };
}
