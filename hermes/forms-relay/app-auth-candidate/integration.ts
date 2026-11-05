/** Disconnected candidate. No env/file reads or default network ports. Do not wire to the worker yet. */
import { mintRestrictedToken, type Config as AppConfig } from "./auth.ts";
import { ledgerFetch, makeGithub, providerBody } from "../providers.ts";
import type { Answer, Config, Row } from "../relay.ts";

type MintInit = { method: "POST"; headers: Record<string, string>; body: string; signal: AbortSignal };
type MintReply = { status: number; body: unknown };
type Receipt = (row: Row) => Promise<void>;

/** Narrow mint-only port. No response body, credentials, IDs or exception details enter receipts. */
export function mintPort(cfg: AppConfig, insert: Receipt, runKey: string, request: typeof fetch) {
  const expectedUrl = `https://api.github.com/app/installations/${cfg.installationId}/access_tokens`;
  const expectedBody = JSON.stringify({ repository_ids: [cfg.repositoryId], permissions: { contents: "write" } });
  return async (url: string, init: MintInit): Promise<MintReply> => {
    if (!/^[1-9][0-9]{0,19}$/.test(cfg.installationId) || !Number.isSafeInteger(cfg.repositoryId) || cfg.repositoryId < 1 ||
        url !== expectedUrl || init.method !== "POST" || init.body !== expectedBody) throw new Error("Mint request refused.");
    // Snapshot all outbound fields before the asynchronous intent receipt.
    const snapshot = new Request(expectedUrl, { method: "POST", headers: { ...init.headers }, body: expectedBody, signal: init.signal, redirect: "error" });
    const receipt = { provider: "github", method: "POST", resource: "api.github.com/app/installations/:id/access_tokens", action_id: null, run_key: runKey, object_id: null };
    let response: Response;
    let aborted: (() => void) | undefined;
    let attempted = false;
    try {
      const stopped = new Promise<never>((_, reject) => {
        aborted = () => reject(new Error("Mint timed out."));
        if (snapshot.signal.aborted) aborted();
        else snapshot.signal.addEventListener("abort", aborted, { once: true });
      });
      try { await Promise.race([insert({ ...receipt, phase: "intent", http_status: null }), stopped]); }
      catch { throw new Error("Mint intent unavailable."); }
      if (snapshot.signal.aborted) throw new Error("Mint timed out.");
      attempted = true;
      const outbound = request(snapshot).then(res => {
        if (snapshot.signal.aborted) void res.body?.cancel().catch(() => {});
        return res;
      });
      response = await Promise.race([outbound, stopped]);
      const text = await Promise.race([providerBody(response, snapshot.signal), stopped]);
      let body: unknown = null;
      try { body = text ? JSON.parse(text) : null; } catch { /* scope check will fail closed */ }
      await Promise.race([insert({ ...receipt, phase: "response", http_status: response.status }).catch(() => {}), stopped]);
      return { status: response.status, body };
    } catch {
      if (attempted) void insert({ ...receipt, phase: "unknown", http_status: null }).catch(() => {});
      throw new Error("Mint response unavailable.");
    } finally {
      if (aborted) snapshot.signal.removeEventListener("abort", aborted);
    }
  };
}

/** App mode is explicitly opted into and cannot silently use a static token. */
export function makeAppDispatcher(options: {
  enabled: boolean;
  staticTokenPresent: boolean;
  config: Config;
  app: AppConfig;
  privatePem: string;
  insert: Receipt;
  runKey: string;
  request: typeof fetch;
  now?: () => number;
}) {
  const { enabled, staticTokenPresent, privatePem, insert, runKey, request } = options;
  const app = Object.freeze({ ...options.app });
  const config = Object.freeze({ ...options.config });
  const bound = app.repositoryFullName === `${config.dispatchOwner}/${config.dispatchRepo}`;
  return {
    async dispatch(body: Row): Promise<Answer> {
      if (enabled !== true || staticTokenPresent !== false || !bound || typeof insert !== "function" || typeof request !== "function")
        return { ok: false, status: 0, definite: true };
      let frozenBody: Row;
      try {
        const encoded = JSON.stringify(body);
        frozenBody = JSON.parse(encoded);
        if (!frozenBody || typeof frozenBody !== "object" || Array.isArray(frozenBody)) throw new Error();
      } catch { return { ok: false, status: 0, definite: true }; }
      let token: string;
      try {
        token = (await mintRestrictedToken(app, privatePem, mintPort(app, insert, runKey, request), options.now?.() ?? Date.now())).token;
      } catch { return { ok: false, status: 0, definite: true }; }
      // Existing dispatch implementation owns its ledger and unknown-outcome semantics.
      return makeGithub({ GITHUB_DISPATCH_TOKEN: token }, config, ledgerFetch(insert, runKey, request)).dispatch(frozenBody);
    },
  };
}
