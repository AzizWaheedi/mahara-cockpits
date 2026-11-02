/**
 * checkin.typeformSent (docs/forms/STAGE2-CONTRACT.md 6.2, 8.6): has the 1-1 form
 * already gone to Typeform for this client's last call? The nudges ask before
 * they offer the Typeform, because a second fRokTITH response makes Make post a
 * second comment and grade and draft a second recap. Each item is one read of
 * fRokTITH's responses since the call began (typeformTools, receipts in
 * cockpit_csm_provider_health), searched for the card id. The search is free
 * text, so a hit counts only when the card is in the response's hidden task_id
 * or its Client ID answer. Nothing of a response but its time leaves here.
 */
import { RpcError } from "../cockpit-hours-sync/db.ts";
import { typeformTools } from "../cockpit-csm-api/tools.ts";
import { DoorError, type OpCtx } from "./door.ts";

const FORM = "fRokTITH";
/** The form's typed "Client ID" question (hermes/csm-calls/match.ts CHECKIN_TASK_REF). */
const CLIENT_ID_REF = "c484f390-9695-4ffa-9693-9cc219592713";
const MAX_ITEMS = 6;
const CACHE_MS = 60_000;

export type SentItem = { taskId: string; sent: boolean | null; at: string | null };
const cache = new Map<string, { answer: SentItem; at: number }>();

/** Forget the isolate's answers (tests). */
export function clearTypeformCache(): void {
  cache.clear();
}

/** When a response carries this card, its submit time; else null. */
export function sentAt(item: Record<string, unknown>, taskId: string): string | null {
  const hidden = String((item.hidden as Record<string, unknown> | undefined)?.task_id ?? "").trim();
  const typed = (Array.isArray(item.answers) ? item.answers : []).find(
    a => (a as { field?: { ref?: string } })?.field?.ref === CLIENT_ID_REF,
  ) as { text?: unknown } | undefined;
  const card = hidden === taskId || String(typed?.text ?? "").trim() === taskId;
  const at = typeof item.submitted_at === "string" && Number.isFinite(Date.parse(item.submitted_at)) ? item.submitted_at : null;
  return card ? at : null;
}

export async function typeformSent(op: OpCtx, body: Record<string, unknown>): Promise<{ items: SentItem[]; now: string }> {
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length < 1 || items.length > MAX_ITEMS) throw new DoorError("Ask about 1 to 6 clients at a time.", 400);
  const asked = items.map(i => {
    const taskId = String((i as Record<string, unknown>)?.taskId ?? "");
    const since = String((i as Record<string, unknown>)?.since ?? "");
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(taskId) || !Number.isFinite(Date.parse(since))) throw new DoorError("Each client needs its card and the start of its last call.", 400);
    // Typeform documents `since` as ISO 8601 UTC to the second (no fractions), so the milliseconds are dropped:
    // the second the call began, never later.
    return { taskId, since: new Date(Math.floor(Date.parse(since) / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z") };
  });
  const now = op.deps.now();
  const runKey = `typeform:${op.deps.uuid()}`;
  const out: SentItem[] = [];
  for (const { taskId, since } of asked) {
    // The client gate per item: a client outside this seat's list answers nothing, and Typeform is not asked.
    try {
      await op.deps.rpc("cockpit_csm_client_gate_for_actor", { p_actor: op.actor.actorId, p_task_id: taskId });
    } catch (e) {
      if (e instanceof RpcError) {
        out.push({ taskId, sent: null, at: null });
        continue;
      }
      throw e;
    }
    const key = `${taskId}|${since}`;
    const hit = cache.get(key);
    if (hit && now.getTime() - hit.at < CACHE_MS) {
      out.push(hit.answer);
      continue;
    }
    let answer: SentItem;
    try {
      const typeform = typeformTools(op.deps.env("TYPEFORM_TOKEN") ?? "", row => op.deps.health({ ...row, run_key: runKey, action_id: null }), op.deps.fetch);
      const query = new URLSearchParams({ since, query: taskId, page_size: "5" });
      const page = await typeform.get(`forms/${FORM}/responses?${query}`);
      const found = (Array.isArray(page.items) ? page.items : [])
        .map(i => sentAt((i ?? {}) as Record<string, unknown>, taskId))
        .filter((at): at is string => at !== null && Date.parse(at) >= Date.parse(since))
        .sort((a, b) => Date.parse(b) - Date.parse(a));
      answer = { taskId, sent: found.length > 0, at: found[0] ?? null };
    } catch {
      answer = { taskId, sent: null, at: null };
    }
    cache.set(key, { answer, at: now.getTime() });
    out.push(answer);
  }
  return { items: out, now: now.toISOString() };
}
