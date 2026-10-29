/**
 * The delta (contract 5.2), every 2 minutes: the tasks that changed in the
 * whole workspace since the cursor (with 10 minutes of overlap, as
 * task-assignment-alerts reads), their new comments and replies, the daily
 * due and overdue alerts, then one state row.
 *
 * Pages are asked oldest change first (reverse=true), so when a read stops
 * part way (more than 1,000 changes, or an error) the cursor moves only over
 * what was saved, and the next run goes on from there. If ClickUp ever sends
 * them in another order, a run that did not finish keeps the old cursor.
 *
 * A run that stopped part way leaves the cursor at the last change it read
 * less 1 ms, so tasks sharing that last timestamp on the next page are read
 * again, never skipped. The run after a truncated one starts at the cursor
 * itself, without the 10-minute overlap: with more than 1,000 changes inside
 * 10 minutes the overlap alone would read the same 1,000 every run.
 *
 * A comment thread that cannot be read is named and counted, and its task is
 * marked tried (cockpit_task_mirror_comments with p_failed) so it steps back
 * instead of coming first every run. Only when most threads fail is the run
 * not ok. Each thread read passes p_read_at, the moment its read began, so a
 * comment posted while the run went on is read next time.
 */
import { chunks, ClickUpReader, commentRow, type Deps, mirrorTask, ms, NO_TOKEN, type Row, sentence, TEAM_ID } from "./clickup.ts";

// At 30 calls a minute (callsPerMinute) a full run is at most 10 pages, 25 threads and 5 reply reads: 40 calls,
// about 80 s, inside the 2 minutes before the next run. The due queue rotates (cockpit_task_mirror_comment_due),
// so a busy minute only delays a comment alert by one run (docs/requests/CLICKUP-DOWNGRADE.md section 1.4).
export const DELTA_PAGES = 10;
export const COMMENT_TASKS = 25;
export const REPLY_READS = 5;
export const OVERLAP_MS = 600_000;
export const FIRST_LOOK_MS = 24 * 3600_000;
export const TRUNCATED = "More than 1,000 tasks changed in one read; the next run goes on.";

/** A run's comment reads fail it only when most of them fail (and more than one). */
export const mostFailed = (failed: number, tried: number) => failed >= 2 && failed * 2 > tried;

export type DeltaResult = {
  ok: boolean;
  note: string;
  cursorMs: number | null;
  pages: number;
  tasks: number;
  comments: number;
  commentsFailed: number;
  alerts: number;
  truncated: boolean;
  calls: number;
};

export async function runDelta(deps: Deps): Promise<DeltaResult> {
  const result: DeltaResult = { ok: true, note: "", cursorMs: null, pages: 0, tasks: 0, comments: 0, commentsFailed: 0, alerts: 0, truncated: false, calls: 0 };
  const problems: string[] = [];
  /** Said in the note, but not a reason to call the run not ok. */
  const notes: string[] = [];
  const finish = async () => {
    const said = `Read ${result.tasks} changed tasks and ${result.comments} comment threads; ${result.alerts} alerts.`;
    result.ok = problems.length === 0 && !result.truncated;
    result.note = [...problems, ...(result.truncated ? [TRUNCATED] : []), said, ...notes].join(" ");
    await deps.rpc("cockpit_task_mirror_state", {
      p_job: "delta",
      p_ok: result.ok,
      p_note: result.note,
      p_detail: {
        cursorMs: result.cursorMs,
        pages: result.pages,
        tasks: result.tasks,
        comments: result.comments,
        commentsFailed: result.commentsFailed,
        alerts: result.alerts,
        truncated: result.truncated,
      },
    });
    return result;
  };
  if (!deps.env("CLICKUP_API_TOKEN")?.trim()) {
    problems.push(NO_TOKEN);
    return finish();
  }
  const inputs = (await deps.rpc("cockpit_task_mirror_inputs", {})) as Row;
  const cu = new ClickUpReader(deps, deps.uuid());
  const cursor = typeof inputs?.cursorMs === "number" ? inputs.cursorMs : null;
  // The run before stopped at its cap: go on from exactly where it stopped (see the header).
  const afterTruncated =
    typeof inputs?.deltaTruncated === "boolean" ? inputs.deltaTruncated : String(inputs?.states?.delta?.note ?? "").includes(TRUNCATED);
  const from = cursor === null ? deps.now() - FIRST_LOOK_MS - OVERLAP_MS : afterTruncated ? cursor : cursor - OVERLAP_MS;

  // 1. The changed tasks.
  let seen: number | null = null;
  let ordered = true;
  let previous = 0;
  let complete = false;
  try {
    for (let page = 0; page < DELTA_PAGES; page += 1) {
      const body = await cu.get(
        `team/${TEAM_ID}/task?include_closed=true&subtasks=true&order_by=updated&reverse=true&date_updated_gt=${Math.max(0, Math.trunc(from))}&page=${page}`,
      );
      result.pages += 1;
      const list: unknown[] = Array.isArray(body?.tasks) ? body.tasks : [];
      const rows = list.map(mirrorTask).filter((r): r is Row => r !== null);
      for (const batch of chunks(rows, 100)) {
        const saved = (await deps.rpc("cockpit_task_mirror_upsert", { p_tasks: batch, p_source: "delta" })) as Row;
        result.tasks += Number(saved?.upserted ?? 0);
        result.alerts += Number(saved?.alerts ?? 0);
        for (const r of batch) {
          if (r.dateUpdatedMs < previous) ordered = false;
          previous = r.dateUpdatedMs;
          seen = Math.max(seen ?? 0, r.dateUpdatedMs);
        }
      }
      if (body?.last_page === true || list.length < 100) {
        complete = true;
        break;
      }
    }
    if (!complete) result.truncated = true;
  } catch (e) {
    problems.push(`The changed tasks could not all be read from ClickUp: ${sentence(e)}`);
  }
  // Finished: the newest change read. Stopped part way, oldest first: every change before the last one
  // read is in, but more may share its timestamp, so the cursor sits 1 ms before it (unless that would
  // not move past where this run began, which only a single millisecond holding 1,000 changes can do).
  result.cursorMs = complete ? seen : ordered && seen !== null ? (seen - 1 > from ? seen - 1 : seen) : null;

  // 2. New comments and replies on the tasks that changed.
  try {
    const due = (await deps.rpc("cockpit_task_mirror_comment_due", { p_limit: COMMENT_TASKS })) as Row[];
    let replies = 0;
    let tried = 0;
    const failedIds: string[] = [];
    for (const d of Array.isArray(due) ? due : []) {
      if (!d || typeof d.taskId !== "string") continue;
      tried += 1;
      // The moment this thread's read began: a comment posted after it is newer than the cut-off next time.
      const readAt = new Date(deps.now()).toISOString();
      try {
        const body = await cu.get(`task/${d.taskId}/comment`);
        const list: Row[] = (Array.isArray(body?.comments) ? body.comments : []).slice(0, 25);
        const rows = list.map(c => commentRow(c)).filter((c): c is Row => c !== null);
        // Threads with replies, at most REPLY_READS a run: those started after the cut-off first, then
        // older threads (a new reply can sit under an old comment), newest first within each.
        const withReplies = list.filter(c => Number(c?.reply_count ?? 0) > 0);
        const newest = (a: Row, b: Row) => (ms(b.date) ?? 0) - (ms(a.date) ?? 0);
        const threads = [
          ...withReplies.filter(c => (ms(c.date) ?? 0) > Number(d.sinceMs)).sort(newest),
          ...withReplies.filter(c => (ms(c.date) ?? 0) <= Number(d.sinceMs)).sort(newest),
        ];
        for (const c of threads) {
          if (replies >= REPLY_READS) break;
          replies += 1;
          const thread = await cu.get(`comment/${c.id}/reply`);
          for (const r of Array.isArray(thread?.comments) ? thread.comments : []) {
            const row = commentRow(r, String(c.id));
            if (row) rows.push(row);
          }
        }
        const saved = (await deps.rpc("cockpit_task_mirror_comments", { p_task_id: d.taskId, p_comments: rows, p_read_at: readAt })) as Row;
        result.alerts += Number(saved?.alerts ?? 0);
        result.comments += 1;
      } catch (e) {
        failedIds.push(d.taskId);
        notes.push(`The comments on task ${d.taskId} could not be read: ${sentence(e)}`);
        // Marked tried, so it steps back instead of coming first every run. Best effort: a database
        // without p_failed refuses the call and the task is simply asked again next run.
        await deps
          .rpc("cockpit_task_mirror_comments", { p_task_id: d.taskId, p_comments: [], p_read_at: readAt, p_failed: true })
          .catch(() => undefined);
      }
    }
    result.commentsFailed = failedIds.length;
    if (mostFailed(failedIds.length, tried))
      problems.push(`Most comment threads could not be read (${failedIds.length} of ${tried}); check the ClickUp token and the receipts.`);
  } catch (e) {
    problems.push(`The comment check did not run: ${sentence(e)}`);
  }

  // 3. The daily due and overdue alerts.
  try {
    const t = (await deps.rpc("cockpit_task_alerts_tick", {})) as Row;
    result.alerts += Number(t?.dueToday ?? 0) + Number(t?.overdue ?? 0);
  } catch (e) {
    problems.push(`The due and overdue alerts did not run: ${sentence(e)}`);
  }
  result.calls = cu.calls;
  return finish();
}
