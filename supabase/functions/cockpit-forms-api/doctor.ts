/**
 * The doctor of the 1-1 notes (docs/forms/STAGE2-CONTRACT.md 6.7): the four keys
 * (never a secret), two light Fathom reads, one model-list read per saved model
 * key, and the store's own numbers. Its receipts use the strings the other
 * callers write (api.fathom.ai/external/v1/users and .../meetings, and the bare
 * hosts api.deepseek.com and api.anthropic.com that model.ts writes for every
 * draft), so one good run clears the native monitor's red for each of them.
 * ok needs the Fathom key and both reads; a missing model key is reported, not
 * a failure.
 */
import { type OpCtx } from "./door.ts";
import { fathomCheck, modelList } from "./keys.ts";

type KeyRow = { state?: string; meta?: Record<string, unknown> | null; secret?: string } | null;
export type Doctor = {
  ok: boolean;
  keys: {
    fathom: { state: string; saved: boolean };
    fathom_webhook: { state: string; registered: boolean };
    deepseek: { state: string; saved: boolean };
    anthropic: { state: string; saved: boolean };
  };
  fathom: { admin: boolean; csList: boolean; limit: { limit: number | null; remaining: number | null } };
  models: { deepseek: boolean; anthropic: boolean };
  store: { csRecordings24h: number; candidates7d: number; lastPull: string | null; lastDelivery: string | null };
  note: string;
};

export async function runDoctor(op: Pick<OpCtx, "deps">): Promise<Doctor> {
  const { deps } = op;
  const row = async (provider: string) => (await deps.rpc("cockpit_forms_key_get", { p_provider: provider })) as KeyRow;
  const [fathom, webhook, deepseek, anthropic] = [await row("fathom"), await row("fathom_webhook"), await row("deepseek"), await row("anthropic")];
  const health = (r: Record<string, unknown>) => deps.health({ ...r, run_key: "doctor", action_id: null });
  const notes: string[] = [];

  let admin = false;
  let csList = false;
  let limit = { limit: null as number | null, remaining: null as number | null };
  if (fathom?.secret) {
    const check = await fathomCheck(fathom.secret, health, deps.fetch, deps.now());
    admin = check.users.kind === "ok";
    csList = check.page?.kind === "ok" && Number(check.page.body.dropped ?? 0) === 0;
    const answered = check.page && check.page.kind !== "unknown" ? check.page : check.users.kind !== "unknown" ? check.users : null;
    if (answered) limit = { limit: answered.limit.limit, remaining: answered.limit.remaining };
    notes.push(
      admin && csList
        ? "Fathom reads work."
        : check.users.kind === "refused"
          ? `Fathom refused the key (${check.users.status}).`
          : !admin
            ? "Fathom could not be reached."
            : "Fathom's Customer Success list did not come back clean.",
    );
  } else notes.push("Fathom isn't connected.");

  const model = async (provider: "deepseek" | "anthropic", key: KeyRow, host: string) => {
    if (!key?.secret) return false;
    const list = await modelList(provider, key.secret, r => health({ ...r, provider }), host, deps.fetch);
    return list.kind === "ok" && list.listed;
  };
  const models = {
    deepseek: await model("deepseek", deepseek, "api.deepseek.com"),
    anthropic: await model("anthropic", anthropic, "api.anthropic.com"),
  };
  notes.push(deepseek?.secret ? (models.deepseek ? "DeepSeek works." : "DeepSeek did not answer with deepseek-flash.") : "No DeepSeek key: client notes drafts are off.");
  notes.push(anthropic?.secret ? (models.anthropic ? "Anthropic works." : "Anthropic did not answer with claude-opus-5-5.") : "No Anthropic key: suggestions, grades and recaps are off.");

  const store = ((await deps.rpc("cockpit_forms_doctor_store", {})) ?? {}) as Doctor["store"];
  const meta = webhook?.meta ?? {};
  return {
    ok: !!fathom?.secret && admin && csList,
    keys: {
      fathom: { state: fathom?.state ?? "missing", saved: !!fathom },
      fathom_webhook: { state: webhook?.state ?? "missing", registered: !!webhook && !!meta.webhookId && !meta.unregisteredAt },
      deepseek: { state: deepseek?.state ?? "missing", saved: !!deepseek },
      anthropic: { state: anthropic?.state ?? "missing", saved: !!anthropic },
    },
    fathom: { admin, csList, limit },
    models,
    // As the store counted them: missing is never zero.
    store: { csRecordings24h: store.csRecordings24h, candidates7d: store.candidates7d, lastPull: store.lastPull ?? null, lastDelivery: store.lastDelivery ?? null },
    note: notes.join(" "),
  };
}
