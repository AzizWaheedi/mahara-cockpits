// The ClickUp log: decisions, typed manual changes and confirmed provider
// actions, each turned into the comment (and, where Convex did it, the Ad
// Status move or the rerouted ticket) on the client's card.
//
// Ports convex/writeback.ts logDecision and logManualChange. Not ported, by
// design: creating a missing board task, renaming a stale task and adding the
// client tag from inside the log. The native cockpit has explicit, previewed
// board actions for those (board.addToBoard, board.renameCard), and an
// automatic task creation could not be read back safely.
//
// Retry safety: every comment and ticket carries a reference line. Before a
// step's write the item records that the step started; a later attempt reads
// the task back and looks for the reference before writing again, so an
// unknown outcome never becomes a duplicate comment.

import {
  ADS_LIST,
  boardStatusAfter,
  type Campaign,
  cardFor,
  changeComment,
  decisionComment,
  DEPARTMENT_LIST,
  FIELD,
  isChange,
  refLine,
  type Row,
  TECH_FIELD,
  TECH_REQUEST_TYPE,
} from "./rules.ts";
import { dropdownLabel, optionId } from "./kpi.ts";

export interface Provider {
  call(provider: "meta" | "clickup", method: string, path: string, body?: Row): Promise<Row>;
}

export type Step =
  | { key: string; type: "comment"; taskId: string; text: string }
  | { key: string; type: "create_task"; listId: string; body: Row; marker: string }
  | { key: string; type: "field"; taskId: string; fieldId: string; field: string; value: unknown }
  | { key: string; type: "ad_status"; taskId: string; metaCampaignId: string };

export type QueueItem = {
  id: string;
  kind: "decision" | "manual_change" | "provider_action" | "tracking_backlog";
  payload: Row;
  attempts: number;
  created_at: string;
  steps?: Step[] | null;
  progress?: Record<string, Row> | null;
  source_exists?: boolean;
};

export type Planned = {
  queueId: string;
  kind: string;
  taskId: string | null;
  field: string;
  fieldId?: string;
  old: unknown;
  new: unknown;
  note?: string;
};

/** What happened to one provider error: retry later, read back first, or give up. */
export function classify(error: unknown): "retry" | "unknown" | "refused" | "config" {
  const message = error instanceof Error ? error.message : String(error);
  if (/is not configured/.test(message)) return "config";
  if (/response is unknown|unreadable response/i.test(message)) return "unknown";
  const status = Number(/rejected the request \((\d{3})/.exec(message)?.[1] ?? 0);
  if (status === 429) return "retry";
  // A server error on a write may still have landed: read back before writing again.
  if (status >= 500) return "unknown";
  return "refused";
}

/** Minutes between attempts: the outbox ladder from convex/outbox.ts. */
export const RETRY_MINUTES = [1, 5, 15, 60, 240];

const trimTo = (s: unknown, n: number) => String(s ?? "").slice(0, n);

/** The writes an item needs, or why it stays in the cockpit only. */
export function buildSteps(item: QueueItem, campaigns: Campaign[], now: number): { steps: Step[] } | { skip: string } {
  const p = item.payload ?? {};
  if (item.kind === "tracking_backlog") {
    const marker = refLine(item.id, "t");
    return {
      steps: [{
        key: "ticket",
        type: "create_task",
        listId: String(p.listId),
        marker,
        body: { name: String(p.name), description: `${String(p.description)}\n\n${marker}`, priority: Number(p.priority ?? 4) },
      }],
    };
  }
  if (item.source_exists === false) return { skip: "The cockpit entry was removed before it reached ClickUp, so nothing was posted." };
  if (item.kind === "decision") {
    const subject = String(p.subject ?? "");
    const card = cardFor(subject, campaigns);
    if (!card) return { skip: `No card on the ads management board for ${subject}, so this decision is in the cockpit only.` };
    const steps: Step[] = [{
      key: "comment",
      type: "comment",
      taskId: card.taskId,
      text: `${decisionComment({
        action: String(p.action ?? ""),
        kind: String(p.kind ?? "decision"),
        evidence: String(p.evidence ?? ""),
        reason: p.reason || undefined,
        snooze: p.snooze || undefined,
        reroutedTo: p.reroutedTo || undefined,
        byEmail: p.byEmail || undefined,
      })}\n\n${refLine(item.id)}`,
    }];
    // A reroute is a real request on another team's board, not just a note.
    const dest = p.kind === "rerouted" && p.reroutedTo ? DEPARTMENT_LIST[String(p.reroutedTo)] : undefined;
    if (dest) {
      const own = campaigns.find(c => c.taskId === card.taskId);
      const taskUrl = (card.campaign?.taskUrl ?? own?.taskUrl) as string | undefined;
      const marker = refLine(item.id, "t");
      const description = [
        "Requested from the Media Buyer Cockpit.",
        "",
        `Campaign: ${subject}`,
        `Why: ${p.evidence ?? ""}`,
        p.reason ? `Note: ${p.reason}` : "",
        taskUrl ? `Campaign task: ${taskUrl}` : "",
      ].filter(Boolean).join("\n");
      const tag = (card.campaign?.clientTag ?? own?.clientTag) as string | undefined;
      steps.push({
        key: "ticket",
        type: "create_task",
        listId: dest.id,
        marker,
        body: {
          name: `${card.campaign?.clientName ?? subject} — ${p.action}`,
          markdown_description: `${description}\n\n${marker}`,
          status: "to do",
          tags: tag ? [tag] : [],
        },
      });
      if (p.reroutedTo === "tech") {
        const rt = TECH_REQUEST_TYPE[String(p.action)];
        if (rt) steps.push({ key: "ticket_type", type: "field", taskId: "$ticket", fieldId: TECH_FIELD.requestType, field: "Request Type", value: rt });
        steps.push({ key: "ticket_notes", type: "field", taskId: "$ticket", fieldId: TECH_FIELD.additionalNotes, field: "Additional Notes", value: trimTo(p.reason || p.evidence, 250) });
        if (String(p.action).includes("qualification"))
          steps.push({ key: "ticket_questions", type: "field", taskId: "$ticket", fieldId: TECH_FIELD.qualificationQuestions, field: "Qualification Questions", value: trimTo(p.reason || "See notes", 250) });
      }
      steps.push({
        key: "ticket_link",
        type: "comment",
        taskId: card.taskId,
        text: `🎯 Cockpit · Request raised on the ${dest.label} board: $ticketUrl\n\n${refLine(item.id, "l")}`,
      });
    }
    return { steps };
  }
  // A typed change or a confirmed provider action: the change comment.
  const what = String(p.what ?? "");
  if (!isChange(what)) return { skip: "A question or a request, not a change, so it stays in the cockpit." };
  const campaignName = String(p.campaignName ?? "");
  const card = cardFor(campaignName, campaigns);
  if (!card) return { skip: `No card on the ads management board for ${campaignName}, so this change is in the cockpit only.` };
  const steps: Step[] = [{
    key: "comment",
    type: "comment",
    taskId: card.taskId,
    text: `${changeComment({ by: String(p.by ?? ""), campaignName, adName: p.adName || undefined, what, at: Number(p.at) || now }, now)}\n\n${refLine(item.id)}`,
  }];
  // A campaign switched on or off moves the card's Ad Status, read back from Meta.
  const metaCampaignId = String(p.metaId || card.campaign?.metaCampaignId || "");
  if (p.syncAdStatus === true && card.ownCard && /^\d{5,}$/.test(metaCampaignId))
    steps.push({ key: "ad_status", type: "ad_status", taskId: card.taskId, metaCampaignId });
  return { steps };
}

const resolveTask = (taskId: string, progress: Record<string, Row>) => {
  if (taskId !== "$ticket") return taskId;
  const id = progress.ticket?.id;
  if (!/^[a-zA-Z0-9_-]+$/.test(String(id ?? ""))) throw new Error("The ticket this field belongs to was not confirmed.");
  return String(id);
};
const resolveText = (text: string, progress: Record<string, Row>) =>
  text.includes("$ticketUrl") ? text.replace("$ticketUrl", String(progress.ticket?.url ?? "")) : text;
const commentText = (c: Row) => String(c.comment_text ?? (c.comment ?? []).map((x: Row) => x.text ?? "").join(""));

/** Read the card's current Ad Status and the campaign's Meta status; the move Convex made, if any. */
async function adStatusMove(step: Extract<Step, { type: "ad_status" }>, provider: Provider, boardFields: () => Promise<Row[]>) {
  const live = await provider.call("meta", "GET", `${step.metaCampaignId}?fields=status`);
  const task = await provider.call("clickup", "GET", `task/${step.taskId}`);
  const current = dropdownLabel((task.custom_fields ?? []).find((f: Row) => f.id === FIELD.adStatus));
  const target = boardStatusAfter(live.status, current);
  const option = target ? optionId(await boardFields(), FIELD.adStatus, target) : undefined;
  return { current, target, option, metaStatus: live.status };
}

/** What the item would write, for the dry-run review. Reads only. */
export async function planItem(item: QueueItem, steps: Step[], provider: Provider, boardFields: () => Promise<Row[]>): Promise<Planned[]> {
  const out: Planned[] = [];
  for (const step of steps) {
    const base = { queueId: item.id, kind: item.kind };
    if (step.type === "comment") out.push({ ...base, taskId: step.taskId, field: "comment", old: null, new: step.text });
    else if (step.type === "create_task")
      out.push({ ...base, taskId: null, field: `new task on list ${step.listId}`, old: null, new: { name: step.body.name, description: step.body.markdown_description ?? step.body.description, tags: step.body.tags } });
    else if (step.type === "field") out.push({ ...base, taskId: step.taskId, field: step.field, fieldId: step.fieldId, old: null, new: step.value });
    else {
      try {
        const move = await adStatusMove(step, provider, boardFields);
        out.push({ ...base, taskId: step.taskId, field: "Ad Status", fieldId: FIELD.adStatus, old: move.current ?? null, new: move.target ?? move.current ?? null, note: move.target ? (move.option ? `Meta says ${move.metaStatus}.` : `No "${move.target}" option on the Ad Status column.`) : `Meta says ${move.metaStatus}; the card already agrees.` });
      } catch (e) {
        out.push({ ...base, taskId: step.taskId, field: "Ad Status", fieldId: FIELD.adStatus, old: null, new: null, note: `Could not read the current status: ${String(e instanceof Error ? e.message : e).slice(0, 160)}` });
      }
    }
  }
  return out;
}

export type Outcome = {
  state: "delivered" | "retry" | "unknown" | "failed";
  progress: Record<string, Row>;
  error?: string;
  /** Whether the failure means the whole run should stop (a missing secret). */
  stop?: boolean;
};

/**
 * Perform the steps against ClickUp. `save` persists progress before and after
 * every write. Steps already done are skipped; a step that started before but
 * never finished is read back first.
 */
export async function executeItem(
  item: QueueItem,
  steps: Step[],
  provider: Provider,
  save: (progress: Record<string, Row>) => Promise<void>,
  boardFields: () => Promise<Row[]>,
): Promise<Outcome> {
  const progress: Record<string, Row> = { ...(item.progress ?? {}) };
  for (const step of steps) {
    if (progress[step.key]?.done) continue;
    const resumed = Boolean(progress[step.key]?.started);
    try {
      if (step.type === "comment") {
        const taskId = resolveTask(step.taskId, progress);
        const text = resolveText(step.text, progress);
        const marker = text.split("\n").pop() ?? "";
        if (resumed) {
          const found = ((await provider.call("clickup", "GET", `task/${taskId}/comment`)).comments ?? []).find((c: Row) => commentText(c).includes(marker));
          if (found) {
            progress[step.key] = { done: true, id: String(found.id), readBack: true };
            await save(progress);
            continue;
          }
        }
        progress[step.key] = { started: true };
        await save(progress);
        const made = await provider.call("clickup", "POST", `task/${taskId}/comment`, { comment_text: text, notify_all: false });
        progress[step.key] = { done: true, id: made.id === undefined ? null : String(made.id) };
      } else if (step.type === "create_task") {
        if (resumed) {
          const since = Date.parse(item.created_at) - 60_000;
          const list = await provider.call("clickup", "GET", `list/${step.listId}/task?include_closed=true&include_markdown_description=true&order_by=created&date_created_gt=${since}`);
          const found = (list.tasks ?? []).find((t: Row) => String(t.description ?? t.text_content ?? "").includes(step.marker) || String(t.markdown_description ?? "").includes(step.marker));
          if (found) {
            progress[step.key] = { done: true, id: String(found.id), url: found.url ?? null, readBack: true };
            await save(progress);
            continue;
          }
        }
        progress[step.key] = { started: true };
        await save(progress);
        const made = await provider.call("clickup", "POST", `list/${step.listId}/task`, step.body);
        if (!/^[a-zA-Z0-9_-]+$/.test(String(made.id ?? ""))) throw new Error("ClickUp returned no task id. Reconcile on the board before retrying.");
        progress[step.key] = { done: true, id: String(made.id), url: made.url ?? null };
      } else if (step.type === "field") {
        const taskId = resolveTask(step.taskId, progress);
        await provider.call("clickup", "POST", `task/${taskId}/field/${step.fieldId}`, { value: step.value });
        progress[step.key] = { done: true };
      } else {
        const move = await adStatusMove(step, provider, boardFields);
        if (move.target && move.option) {
          await provider.call("clickup", "POST", `task/${step.taskId}/field/${FIELD.adStatus}`, { value: move.option });
          progress[step.key] = { done: true, from: move.current ?? null, to: move.target };
        } else {
          progress[step.key] = { done: true, unchanged: true, current: move.current ?? null, metaStatus: move.metaStatus ?? null };
        }
      }
      await save(progress);
    } catch (e) {
      const kind = classify(e);
      const error = String(e instanceof Error ? e.message : e).slice(0, 300);
      if (kind === "config") return { state: "retry", progress, error, stop: true };
      if (kind === "retry") {
        // A 429 never landed: the next attempt need not read back.
        if (progress[step.key]?.started && !progress[step.key]?.done) delete progress[step.key];
        return { state: "retry", progress, error };
      }
      if (kind === "unknown") return { state: "unknown", progress, error };
      // Filling the ticket's form fields and moving the Ad Status are best effort in
      // Convex too: a refused value is noted and the comment still counts.
      if (step.type === "field" || step.type === "ad_status") {
        progress[step.key] = { done: true, refused: error };
        await save(progress);
        continue;
      }
      return { state: "failed", progress, error };
    }
  }
  return { state: "delivered", progress };
}

/** The board's field definitions, read once per run when a step needs an option id. */
export function boardFieldsLoader(provider: Provider) {
  let cached: Promise<Row[]> | undefined;
  return () => {
    cached ??= provider.call("clickup", "GET", `list/${ADS_LIST}/field`).then(r => {
      if (!Array.isArray(r.fields)) throw new Error("ClickUp did not return the board fields");
      return r.fields as Row[];
    });
    return cached;
  };
}
