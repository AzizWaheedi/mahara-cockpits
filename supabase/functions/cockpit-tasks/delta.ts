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
 */
import { chunks, ClickUpReader, commentRow, type Deps, mirrorTask, ms, NO_TOKEN, type Row, sentence, TEAM_ID } from "./clickup.ts";

export const DELTA_PAGES = 10;
export const COMMENT_TASKS = 40;
export const REPLY_READS = 10;
export const OVERLAP_MS = 600_000;
export const FIRST_LOOK_MS = 24 * 3600_000;
export const TRUNCATED = "More than 1,000 tasks changed in one read; the next run goes on.";

export type DeltaResult = {
  ok: boolean;
  note: string;
  cursorMs: number | null;
  pages: number;
  tasks: number;
  comments: number;
  alerts: number;
  truncated: boolean;
  calls: number;
};

export async function runDelta(deps: Deps): Promise<DeltaResult> {
  const result: DeltaResult = { ok: true, note: "", cursorMs: null, pages: 0, tasks: 0, comments: 0, alerts: 0, truncated: false, calls: 0 };
  const problems: string[] = [];
  const finish = async () => {
    const said = `Read ${result.tasks} changed tasks and ${result.comments} comment threads; ${result.alerts} alerts.`;
    result.ok = problems.length === 0 && !result.truncated;
    result.note = [...problems, ...(result.truncated ? [TRUNCATED] : []), said].join(" ");
    await deps.rpc("cockpit_task_mirror_state", {
      p_job: "delta",
      p_ok: result.ok,
      p_note: result.note,
      p_detail: {
        cursorMs: result.cursorMs,
        pages: result.pages,
        tasks: result.tasks,
        comments: result.comments,
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
  const from = (typeof inputs?.cursorMs === "number" ? inputs.cursorMs : deps.now() - FIRST_LOOK_MS) - OVERLAP_MS;

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
  result.cursorMs = complete || ordered ? seen : null;

  // 2. New comments and replies on the tasks that changed.
  try {
    const due = (await deps.rpc("cockpit_task_mirror_comment_due", { p_limit: COMMENT_TASKS })) as Row[];
    let replies = 0;
    for (const d of Array.isArray(due) ? due : []) {
      if (!d || typeof d.taskId !== "string") continue;
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
        const saved = (await deps.rpc("cockpit_task_mirror_comments", { p_task_id: d.taskId, p_comments: rows })) as Row;
        result.alerts += Number(saved?.alerts ?? 0);
        result.comments += 1;
      } catch (e) {
        problems.push(`The comments on task ${d.taskId} could not be read: ${sentence(e)}`);
      }
    }
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
