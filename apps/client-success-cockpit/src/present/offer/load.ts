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
export async function loadOfferDeck(
  client: SupabaseClient,
  taskId: string,
): Promise<Loaded> {
  const [deck, offer, files] = await Promise.all([
    loadDeck(client, taskId, "offer_website"),
    readOfferSources(client, taskId, "website"),
    listUpsellFiles(client, taskId),
  ]);
  return {
    ...deck,
    offer: { ...offer, files: files.rows },
    prep: { ...deck.prep, offer_website: offer.prep?.overrides ?? {} },
  };
}
export function offerIO(client: SupabaseClient, taskId: string): OfferIO {
  return {
    readSources: () => readOfferSources(client, taskId, "website"),
    savePitch: (requestId, patch, revision) =>
      savePitch(client, taskId, "website", requestId, patch, revision),
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
