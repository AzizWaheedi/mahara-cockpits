/** Offline experiment only: this is not connected to the relay or production.
 * A caller MUST inject the HTTP adapter; this module never defaults to fetch.
 * All inputs and outputs containing credentials must stay out of logs.
 */
import { createPrivateKey, createSign } from "node:crypto";

export type Config = {
  appId: string;
  installationId: string;
  repositoryId: number;
  repositoryFullName: string;
};
type Reply = { status: number; body: unknown };
type Request = (url: string, init: { method: "POST"; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<Reply>;
export class AuthDenied extends Error {
  constructor(message: string) { super(message); this.name = "AuthDenied"; }
}
const deny = (message: string): never => { throw new AuthDenied(message); };
const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
const positiveId = (v: string) => /^[1-9][0-9]{0,19}$/.test(v);
const safeRepo = (v: string) => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(v) && !v.split("/").some(x => x === "." || x === "..");

/** Exact config must come from a reviewed private installation registry, not an event payload. */
export async function mintRestrictedToken(cfg: Config, privatePem: string, request: Request, nowMs = Date.now()) {
  if (!cfg || typeof cfg.appId !== "string" || !positiveId(cfg.appId) ||
      typeof cfg.installationId !== "string" || !positiveId(cfg.installationId) ||
      !Number.isSafeInteger(cfg.repositoryId) || cfg.repositoryId < 1 ||
      typeof cfg.repositoryFullName !== "string" || !safeRepo(cfg.repositoryFullName) ||
      typeof privatePem !== "string" || typeof request !== "function" ||
      !Number.isSafeInteger(nowMs) || nowMs < 0) deny("Invalid GitHub App configuration");
  const nowSec = Math.floor(nowMs / 1000);
  const signedPart = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat: nowSec - 60, exp: nowSec + 480, iss: cfg.appId })}`;
  let jwt: string;
  try {
    const key = createPrivateKey(privatePem);
    if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) deny("Invalid signing key");
    const signer = createSign("RSA-SHA256");
    signer.update(signedPart); signer.end();
    jwt = `${signedPart}.${signer.sign(key).toString("base64url")}`;
  } catch { return deny("Invalid signing key"); }
  let response: Reply;
  try {
    response = await request(`https://api.github.com/app/installations/${cfg.installationId}/access_tokens`, {
      method: "POST", headers: { Authorization: `Bearer ${jwt}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json", "User-Agent": "mahara-forms-relay" },
      body: JSON.stringify({ repository_ids: [cfg.repositoryId], permissions: { contents: "write" } }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch { return deny("GitHub App token request failed"); }
  if (!response || response.status !== 201 || !response.body || typeof response.body !== "object" || Array.isArray(response.body)) deny("GitHub App token request was refused");
  const data = response.body as Record<string, any>;
  const expires = typeof data.expires_at === "string" ? Date.parse(data.expires_at) : NaN;
  const perms = data.permissions;
  const repos = data.repositories;
  // Validate the provider's returned scope, not only the requested scope.
  if (typeof data.token !== "string" || data.token.length < 8 || data.token.length > 1024 || /\s/.test(data.token) ||
      !Number.isFinite(expires) || expires <= nowMs + 60_000 || expires > nowMs + 2 * 60 * 60_000 ||
      !perms || typeof perms !== "object" || Array.isArray(perms) || perms.contents !== "write" ||
      Object.entries(perms).some(([k,v]) => !(k === "contents" && v === "write") && !(k === "metadata" && v === "read")) ||
      data.repository_selection !== "selected" || !Array.isArray(repos) || repos.length !== 1 ||
      repos[0]?.id !== cfg.repositoryId || repos[0]?.full_name !== cfg.repositoryFullName || repos[0]?.private !== true) deny("GitHub App token scope could not be verified");
  return { token: data.token, expiresAt: data.expires_at as string };
}
