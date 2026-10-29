/**
 * The focus view's read (contract 5.4). The seat's own sign-in asks the
 * database first (cockpit_task_detail decides who may open a task); only then
 * is ClickUp read with the function's token, at most once a minute unless the
 * person asked to refresh, and the answer cached on the mirror row with the
 * service key. The seat's sign-in reads the result again, so what comes back
 * is always what the database lets this seat see.
 */
import { ClickUpReader, type Deps, detailCache, kuwaitClock, mirrorTask, type Row, sentence } from "./clickup.ts";

/** A call made with the person's own sign-in (their JWT); throws an RpcError. */
export type UserRpc = (jwt: string, name: string, args: Record<string, unknown>) => Promise<any>;

export class RpcError extends Error {
  code: string | null;
  constructor(message: string, code: string | null) {
    super(message);
    this.name = "RpcError";
    this.code = code;
  }
}

export type DetailDeps = Deps & { userRpc: UserRpc };
export type DetailAnswer = { status: number; body: Row };

export const FRESH_MS = 60_000;
export const NOT_READ = "This task could not be read from ClickUp just now. Try again in a minute, or open it in ClickUp.";
export const readAt = (at: string) => `This task could not be read from ClickUp just now. What you see was read at ${at}.`;

/** The database's refusal as an answer: its sentence, and a status that says whose problem it is. */
function refusal(e: unknown): DetailAnswer {
  const code = e instanceof RpcError ? e.code : null;
  const status = code === "42501" ? 403 : code === "P0002" ? 404 : code === "22023" ? 400 : 500;
  const error = status === 500 ? "This task could not be opened. Open it in ClickUp." : sentence(e);
  return { status, body: { error } };
}

export async function runDetail(deps: DetailDeps, jwt: string, input: { taskId: string; refresh: boolean }): Promise<DetailAnswer> {
  const args = { p_task_id: input.taskId };
  let first: Row;
  try {
    first = await deps.userRpc(jwt, "cockpit_task_detail", args);
  } catch (e) {
    return refusal(e);
  }
  const cachedAt = first?.detail?.at ? Date.parse(first.detail.at) : Number.NaN;
  const stale = input.refresh || !Number.isFinite(cachedAt) || deps.now() - cachedAt > FRESH_MS;
  if (!stale) return { status: 200, body: first };

  let note: string | null = null;
  try {
    if (!deps.env("CLICKUP_API_TOKEN")?.trim()) throw new Error("CLICKUP_API_TOKEN is not set");
    // A person is waiting: not paced, and one more try after ClickUp's 429.
    const cu = new ClickUpReader(deps, deps.uuid(), { interactive: true });
    const task = await cu.get(`task/${input.taskId}?include_markdown_description=true&include_subtasks=true`);
    const comments = await cu.get(`task/${input.taskId}/comment`);
    const row = mirrorTask(task);
    if (!row) throw new Error("ClickUp's answer had no readable task");
    // The row first, so a request's task the mirror has not seen yet gets one; then its cache.
    await deps.rpc("cockpit_task_mirror_upsert", { p_tasks: [row], p_source: "detail" });
    await deps.rpc("cockpit_task_detail_cache", {
      p_task_id: input.taskId,
      p_detail: detailCache(task, (Array.isArray(comments?.comments) ? comments.comments : []).slice(0, 25)),
    });
  } catch (e) {
    console.error(`cockpit-tasks detail ${input.taskId}: ${sentence(e)}`);
    note = Number.isFinite(cachedAt) ? readAt(kuwaitClock(cachedAt)) : NOT_READ;
  }

  let after: Row;
  try {
    after = await deps.userRpc(jwt, "cockpit_task_detail", args);
  } catch (e) {
    return refusal(e);
  }
  return { status: 200, body: note ? { ...after, detailNote: note } : after };
}
