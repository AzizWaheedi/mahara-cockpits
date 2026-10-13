/**
 * Keys for Hubstaff watch. Hubstaff's is the hours key (cockpit_hours_keys,
 * through cockpit-hours-sync/keys.ts hubstaffAccess); the screenshot check's
 * is in cockpit_hours_watch_keys, reached only through
 * cockpit_hours_watch_key_get (service only). The check uses the first saved
 * key that was not refused, OpenAI first (API data is not used for training),
 * then Google AI. When every saved key was refused the check stops until a new
 * one is pasted; with no key it is skipped and the card says how to switch it
 * on. A key the model refuses mid-run is marked refused through
 * cockpit_hours_watch_key_mark (state and note only), compare-and-swap on the
 * savedAt key_get returned, so a key pasted mid-run is never marked by the old
 * key's failure. Nothing here returns a key to a browser, a receipt, a log or
 * an error.
 */
import type { Rpc } from "../cockpit-hours-sync/db.ts";
import { isObj } from "./inputs.ts";

export { type Access, hubstaffAccess } from "../cockpit-hours-sync/keys.ts";

export type AiProvider = "google_ai" | "openai";
/** savedAt is when this key was saved, as key_get returned it: the compare-and-swap token for key_mark. */
export type AiKey = { provider: AiProvider; secret: string; state: string; savedAt: string | null };

export async function readAiKey(rpc: Rpc, provider: AiProvider): Promise<AiKey | null> {
  const row = await rpc("cockpit_hours_watch_key_get", { p_provider: provider });
  if (!isObj(row) || typeof row.secret !== "string" || !row.secret.trim()) return null;
  return {
    provider, secret: row.secret.trim(), state: typeof row.state === "string" ? row.state : "unchecked",
    savedAt: typeof row.savedAt === "string" && row.savedAt ? row.savedAt : null,
  };
}

export const AI_NAMES: Record<AiProvider, string> = { openai: "OpenAI", google_ai: "Google AI" };
export const refusedNote = (provider: AiProvider) => `The saved ${AI_NAMES[provider]} key was refused. Paste a new one in Settings.`;
/** The order saved keys are tried in. */
export const AI_ORDER: AiProvider[] = ["openai", "google_ai"];

/** The key the screenshot check uses this run: the first saved one not refused (OpenAI first), or the reason there is none. */
export async function aiAccess(rpc: Rpc): Promise<{ ok: true; key: AiKey } | { ok: false; state: "missing" | "refused"; note: string }> {
  let refused: AiKey | null = null;
  for (const provider of AI_ORDER) {
    const key = await readAiKey(rpc, provider);
    if (!key) continue;
    if (key.state !== "refused") return { ok: true, key };
    refused ??= key;
  }
  if (refused) return { ok: false, state: "refused", note: refusedNote(refused.provider) };
  return { ok: false, state: "missing", note: "Screenshot check needs an AI key (OpenAI or Google AI). Paste one in Settings." };
}

/**
 * Record what a model said about the key: refused, or connected. State and
 * note only, never the key, and only while the saved key is still the one
 * this run read (savedAt). Says whether the mark was made.
 */
export async function markAiKey(rpc: Rpc, key: Pick<AiKey, "provider" | "savedAt">, state: "refused" | "connected", note: string): Promise<{ ok: boolean; note: string | null }> {
  const r = await rpc("cockpit_hours_watch_key_mark", { p: { provider: key.provider, state, note: note.slice(0, 240), savedAt: key.savedAt } });
  if (isObj(r) && r.ok === false) return { ok: false, note: typeof r.note === "string" && r.note ? r.note.slice(0, 200) : "The key was not marked." };
  return { ok: true, note: null };
}
