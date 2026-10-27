/**
 * The seats job (contract 5.3), hourly at :11: the workspace members (which
 * links seats by email), the request field catalog, the ClickUp template
 * objects, every linked seat's open tasks read in full, and the old ClickUp
 * form's unrouted tickets on All Tasks. One state row; the first run that
 * finished every linked seat sets the alert baseline (20261026t).
 *
 * Each step stands alone: one that fails is named in the note and the rest
 * still run. A seat's read that fails, or that would need more than 5 pages,
 * is skipped (nobody is taken off a task on half a read) and the run is not
 * complete.
 */
import { ALL_TASKS, chunks, ClickUpReader, type Deps, FIELDS_LIST, importTask, mirrorTask, NO_TOKEN, type Row, sentence, TEAM_ID } from "./clickup.ts";

export const SEAT_PAGES = 5;
export const TEMPLATE_PAGES = 6;
export const ALL_TASKS_PAGES = 5;

export type SeatsResult = {
  ok: boolean;
  note: string;
  members: number | null;
  linked: number;
  seats: number;
  imported: number | null;
  templates: number | null;
  fields: number | null;
  complete: boolean;
  calls: number;
};

/** Pages of a task list until the last one, at most `max`; `full` is false when there were more. */
async function pages(cu: ClickUpReader, path: (page: number) => string, max: number): Promise<{ tasks: unknown[]; full: boolean }> {
  const tasks: unknown[] = [];
  for (let page = 0; page < max; page += 1) {
    const body = await cu.get(path(page));
    const list: unknown[] = Array.isArray(body?.tasks) ? body.tasks : [];
    tasks.push(...list);
    if (body?.last_page === true || list.length < 100) return { tasks, full: true };
  }
  return { tasks, full: false };
}

export async function runSeats(deps: Deps): Promise<SeatsResult> {
  const result: SeatsResult = {
    ok: false,
    note: "",
    members: null,
    linked: 0,
    seats: 0,
    imported: null,
    templates: null,
    fields: null,
    complete: false,
    calls: 0,
  };
  const problems: string[] = [];
  const finish = async () => {
    result.ok = problems.length === 0;
    const said =
      `${result.seats} of ${result.linked} linked seats read in full` +
      (result.members === null ? "" : `; ${result.members} ClickUp members`) +
      (result.imported === null ? "" : `; ${result.imported} old form tickets imported`) +
      ".";
    result.note = [...problems, said].join(" ");
    await deps.rpc("cockpit_task_mirror_state", {
      p_job: "seats",
      p_ok: result.ok,
      p_note: result.note,
      p_detail: {
        members: result.members,
        linked: result.linked,
        seats: result.seats,
        imported: result.imported,
        templates: result.templates,
        fields: result.fields,
        complete: result.complete,
      },
    });
    return result;
  };
  if (!deps.env("CLICKUP_API_TOKEN")?.trim()) {
    problems.push(NO_TOKEN);
    return finish();
  }
  const cu = new ClickUpReader(deps, deps.uuid());

  // 1. The workspace members, which link seats by exact email.
  try {
    const body = await cu.get("team");
    const team = (Array.isArray(body?.teams) ? body.teams : []).find((t: Row) => String(t?.id) === TEAM_ID);
    const members = (Array.isArray(team?.members) ? team.members : [])
      .map((m: Row) => m?.user)
      .filter((u: Row) => u && u.id !== undefined && u.id !== null)
      .map((u: Row) => ({ id: String(u.id), username: u.username ?? null, email: u.email ?? null }));
    if (!members.length) throw new Error("ClickUp listed no members for the workspace");
    const synced = (await deps.rpc("cockpit_clickup_members_sync", { p_members: members })) as Row;
    result.members = Number(synced?.members ?? members.length);
  } catch (e) {
    problems.push(`The ClickUp members were not read: ${sentence(e)}`);
  }

  // 2. The request field catalog: names and choices, and a field ClickUp added that a request can write
  // (added unmapped, review R1 F11). The database never adds Request Type or the two fields the cockpit
  // never writes (cockpit_request_never_written, review round 2), so every field the read returns is sent.
  try {
    const body = await cu.get(`list/${FIELDS_LIST}/field`);
    const fields = (Array.isArray(body?.fields) ? body.fields : []).map((f: Row) => ({
      id: f?.id,
      name: f?.name,
      type: f?.type,
      options: Array.isArray(f?.type_config?.options) ? f.type_config.options.map((o: Row) => ({ id: o?.id, name: o?.name ?? o?.label })) : null,
    }));
    if (!fields.length) throw new Error("ClickUp listed no fields");
    const synced = (await deps.rpc("cockpit_request_field_catalog_sync", { p_fields: fields })) as Row;
    result.fields = Number(synced?.updated ?? 0);
  } catch (e) {
    problems.push(`The request fields were not read: ${sentence(e)}`);
  }

  // 3. The template objects (id and name; no API returns their content).
  try {
    const found = new Map<string, Row>();
    for (let page = 0; page < TEMPLATE_PAGES; page += 1) {
      const body = await cu.get(`team/${TEAM_ID}/taskTemplate?page=${page}`);
      const list: Row[] = Array.isArray(body?.templates) ? body.templates : [];
      const before = found.size;
      for (const t of list) if (t?.id) found.set(String(t.id), { id: String(t.id), name: String(t.name ?? "") });
      if (!list.length || found.size === before) break;
    }
    if (!found.size) throw new Error("ClickUp listed no templates");
    const synced = (await deps.rpc("cockpit_request_templates_sync", { p_templates: [...found.values()] })) as Row;
    result.templates = Number(synced?.seen ?? found.size);
  } catch (e) {
    problems.push(`The ClickUp templates were not read: ${sentence(e)}`);
  }

  // 4. Every linked seat's open tasks, in full.
  let inputs: Row | null = null;
  try {
    inputs = (await deps.rpc("cockpit_task_mirror_inputs", {})) as Row;
  } catch (e) {
    problems.push(`The linked seats could not be listed: ${sentence(e)}`);
  }
  const linked: Row[] = Array.isArray(inputs?.linked) ? inputs.linked : [];
  // One read per ClickUp user, even when two seats share one.
  const users = new Map<number, string[]>();
  for (const l of linked) {
    const cuId = Number(l?.clickupUserId);
    if (!Number.isFinite(cuId)) continue;
    users.set(cuId, [...(users.get(cuId) ?? []), String(l?.label ?? "a seat")]);
  }
  result.linked = linked.length;
  const missed: string[] = [];
  for (const [cuId, labels] of users) {
    try {
      const read = await pages(
        cu,
        page => `team/${TEAM_ID}/task?assignees[]=${cuId}&subtasks=true&include_closed=false&page=${page}`,
        SEAT_PAGES,
      );
      if (!read.full) throw new Error(`more than ${SEAT_PAGES * 100} open tasks`);
      const rows = read.tasks.map(mirrorTask).filter((r): r is Row => r !== null);
      for (const batch of chunks(rows, 100)) await deps.rpc("cockpit_task_mirror_upsert", { p_tasks: batch, p_source: "seat" });
      await deps.rpc("cockpit_task_mirror_seat", { p_clickup_user_id: cuId, p_task_ids: rows.map(r => r.taskId) });
      result.seats += labels.length;
    } catch (e) {
      missed.push(`${labels.join(" and ")} (${sentence(e)})`);
    }
  }
  if (missed.length) problems.push(`These seats' tasks were not read in full: ${missed.join("; ")}.`);
  result.complete = inputs !== null && missed.length === 0;

  // 5. The old ClickUp form's tickets that never left All Tasks. After a complete read (every page), the ids of
  // every task still open there go too (review round 3): an imported ticket missing from them was moved, closed
  // or deleted in ClickUp, which the delta never reads for a deleted task, so it leaves the queues. A read cut
  // short sends none, so a ticket on a page not read is never taken for gone.
  try {
    const read = await pages(cu, page => `list/${ALL_TASKS}/task?include_closed=false&subtasks=false&page=${page}`, ALL_TASKS_PAGES);
    const tickets = read.tasks.map(importTask).filter((t): t is Row => t !== null);
    // By the task's own id and status type, so a ticket whose other fields read oddly is still counted open.
    const open = read.full
      ? read.tasks
          .filter((t): t is Row => typeof t === "object" && t !== null && !["done", "closed"].includes(String((t as Row).status?.type ?? "").toLowerCase()))
          .map(t => String(t.id ?? ""))
          .filter(id => /^[A-Za-z0-9_-]{1,40}$/.test(id))
      : null;
    const done = (await deps.rpc("cockpit_request_import", open ? { p_tasks: tickets, p_open_ids: open } : { p_tasks: tickets })) as Row;
    result.imported = Number(done?.imported ?? 0);
  } catch (e) {
    problems.push(`The old form's tickets on All Tasks were not read: ${sentence(e)}`);
  }
  result.calls = cu.calls;
  return finish();
}
