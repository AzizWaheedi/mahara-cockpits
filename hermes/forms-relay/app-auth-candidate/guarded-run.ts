/** Synthetic protocol candidate only. No production DB, filesystem or provider adapters. */
export type HoldReason = "credentials_unavailable" | "repository_unverified" | "readiness_expired" | "reservation_unknown" | "start_unknown" | "release_unknown" | "dispatch_unknown" | "authorization_refused" | "completion_unknown";
type Token = { value: string; expiresAtMs: number; repositoryId: number; repositoryFullName: string };
type Reservation = { id: string; lease: string };
type Outcome = "sent" | "refused" | "unknown" | "authorization_refused";
type Result = { status: "disabled" | "no_work" | "sent" | "refused" | "held" | "hold_unrecorded"; reason?: HoldReason };

/**
 * Every port must implement the atomic, fenced contracts documented in README.
 * The AbortSignal is advisory: an operation may finish after timeout. Never
 * retry an ambiguous mutation. Do not log arguments or exception messages.
 */
export type Ports = {
  now: () => number;
  mint: (signal: AbortSignal) => Promise<Token>;
  verify: (token: string, signal: AbortSignal) => Promise<{ id: number; fullName: string; private: boolean; contentsWrite: boolean }>;
  hold: (reason: HoldReason, signal: AbortSignal) => Promise<void>;
  /** Atomically checks the global hold and reserves at most one row. */
  reserveOne: (signal: AbortSignal) => Promise<{ kind: "none" | "held" } | { kind: "reserved"; row: Reservation }>;
  begin: (row: Reservation, signal: AbortSignal) => Promise<boolean>;
  /** Atomically restores the pre-claim state/attempt and installs a global hold. */
  releaseAndHold: (row: Reservation, reason: HoldReason, signal: AbortSignal) => Promise<boolean>;
  dispatch: (row: Reservation, token: string, signal: AbortSignal) => Promise<Outcome>;
  /** Atomically settles row and records hold when reason is non-null. */
  finish: (row: Reservation, outcome: Outcome, reason: HoldReason | null, signal: AbortSignal) => Promise<boolean>;
};

/** Reject on deadline even when a port ignores abort. A rejected mutation may still commit. */
async function bounded<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error("deadline")); }, ms);
  });
  try { return await Promise.race([Promise.resolve().then(() => fn(controller.signal)), timeout]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}

export async function guardedRun(settings: {
  enabled: boolean; staticTokenPresent: boolean; repositoryId: number; repositoryFullName: string;
  timeoutMs: number; minTokenLifeMs: number;
}, p: Ports): Promise<Result> {
  settings = Object.freeze({ ...settings });
  // Off means no queue, token, provider or even hold write.
  if (settings.enabled !== true) return { status: "disabled" };
  const timeoutMs = settings.timeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) return { status: "hold_unrecorded", reason: "credentials_unavailable" };
  const hold = async (reason: HoldReason): Promise<Result> => {
    try { await bounded(timeoutMs, s => p.hold(reason, s)); return { status: "held", reason }; }
    catch { return { status: "hold_unrecorded", reason }; }
  };
  if (settings.staticTokenPresent !== false || !Number.isSafeInteger(settings.repositoryId) || settings.repositoryId < 1 ||
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(settings.repositoryFullName) ||
      settings.repositoryFullName.split("/").some(s => s === "." || s === "..") ||
      !Number.isSafeInteger(settings.minTokenLifeMs) || settings.minTokenLifeMs < 60_000 || settings.minTokenLifeMs > 3_600_000)
    return hold("credentials_unavailable");
  const currentTime = (): number | null => {
    try { const value = p.now(); return Number.isSafeInteger(value) && value > 0 ? value : null; }
    catch { return null; }
  };
  if (currentTime() === null) return hold("credentials_unavailable");
  let token: Token;
  try {
    token = { ...await bounded(timeoutMs, s => p.mint(s)) };
    const mintedAt = currentTime();
    if (!token || typeof token.value !== "string" || token.value.length < 8 || /\s/.test(token.value) ||
        token.repositoryId !== settings.repositoryId || token.repositoryFullName !== settings.repositoryFullName ||
        !Number.isSafeInteger(token.expiresAtMs) || mintedAt === null || token.expiresAtMs - mintedAt < settings.minTokenLifeMs)
      return hold("credentials_unavailable");
  } catch { return hold("credentials_unavailable"); }
  try {
    const repo = await bounded(timeoutMs, s => p.verify(token.value, s));
    if (!repo || repo.id !== settings.repositoryId || repo.fullName !== settings.repositoryFullName || repo.private !== true || repo.contentsWrite !== true)
      return hold("repository_unverified");
  } catch { return hold("repository_unverified"); }
  const beforeReservation = currentTime();
  if (beforeReservation === null || token.expiresAtMs - beforeReservation < settings.minTokenLifeMs) return hold("readiness_expired");
  let reserved: Awaited<ReturnType<Ports["reserveOne"]>>;
  try { reserved = await bounded(timeoutMs, s => p.reserveOne(s)); }
  catch { return hold("reservation_unknown"); }
  if (reserved?.kind === "none") return { status: "no_work" };
  if (reserved?.kind === "held") return { status: "held" };
  if (reserved?.kind !== "reserved" || !reserved.row || typeof reserved.row.id !== "string" || typeof reserved.row.lease !== "string" || !reserved.row.id || !reserved.row.lease)
    return hold("reservation_unknown");
  const row = Object.freeze({ ...reserved.row });
  // A reservation can be released only by the DB's atomic pre-start fence.
  const beforeStart = currentTime();
  if (beforeStart === null || token.expiresAtMs - beforeStart < settings.minTokenLifeMs) {
    try {
      if (!await bounded(timeoutMs, s => p.releaseAndHold(row, "readiness_expired", s))) return hold("release_unknown");
      return { status: "held", reason: "readiness_expired" };
    } catch { return hold("release_unknown"); }
  }
  try {
    if (!await bounded(timeoutMs, s => p.begin(row!, s))) return hold("start_unknown");
  } catch { return hold("start_unknown"); }
  let result: Outcome;
  try {
    result = await bounded(timeoutMs, s => p.dispatch(row!, token.value, s));
    if (!["sent", "refused", "unknown", "authorization_refused"].includes(result)) result = "unknown";
  } catch { result = "unknown"; }
  const reason: HoldReason | null = result === "unknown" ? "dispatch_unknown" : result === "authorization_refused" ? "authorization_refused" : null;
  try {
    if (!await bounded(timeoutMs, s => p.finish(row!, result, reason, s))) return hold("completion_unknown");
  } catch { return hold("completion_unknown"); }
  if (reason) return { status: "held", reason };
  return { status: result === "sent" ? "sent" : "refused" };
}

/** Recovery is a model: only a real atomic DB adapter can enforce its contract. */
export async function recoverHeld(settings: { timeoutMs: number }, ports: {
  inspect: (signal: AbortSignal) => Promise<{ revision: string; reason: HoldReason } | null>;
  /** Must perform fresh scoped credential and repository checks without reserving. */
  readiness: (signal: AbortSignal) => Promise<boolean>;
  /** One transaction: compare hold revision, confirm all uncertain claims/effects resolved, clear hold. */
  resumeIfSafe: (revision: string, signal: AbortSignal) => Promise<boolean>;
}): Promise<{ status: "not_held" | "not_ready" | "needs_review" | "resumed" | "resume_unknown" }> {
  const timeoutMs = settings.timeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) return { status: "needs_review" };
  let hold: Awaited<ReturnType<typeof ports.inspect>>;
  try { hold = await bounded(timeoutMs, s => ports.inspect(s)); }
  catch { return { status: "needs_review" }; }
  if (hold === null) return { status: "not_held" };
  if (!hold || typeof hold.revision !== "string" || !hold.revision || hold.revision.length > 100) return { status: "needs_review" };
  const revision = hold.revision;
  try { if (await bounded(timeoutMs, s => ports.readiness(s)) !== true) return { status: "not_ready" }; }
  catch { return { status: "not_ready" }; }
  try {
    return { status: await bounded(timeoutMs, s => ports.resumeIfSafe(revision, s)) === true ? "resumed" : "needs_review" };
  } catch { return { status: "resume_unknown" }; }
}
