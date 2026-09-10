import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { CLIENTS_LIST, CREATIVE_LIST, VIDEO_LIST } from "./sync";
import { callTool, unwrap } from "./tools";

/**
 * Execute the writes the other two cockpits queue.
 *
 * Neither the creative director's nor the client success cockpit holds
 * ClickUp credentials, so "complete this", "comment this", "log a call",
 * "send this to tech" are queued as intents in their own `outbox` tables and
 * executed here, from this backend, every few minutes. Anything that fails is
 * marked failed with the reason, so a write is never silently dropped. This
 * replaces `drain_creative_outbox` in sync_cockpit.py and `handle()` in
 * csm_app_bridge.py.
 */

declare const process: { env: Record<string, string | undefined> };

// biome-ignore lint/suspicious/noExplicitAny: ClickUp payloads
type Any = any;

const CS_LIST = "901816723211";
// Field ids on Clients - Mahara.
const CF = {
  lastPoc: "e183f2ce-8b7a-491a-b160-2287a247758b",
  lastCall: "032203ad-e327-4d76-a0ce-c07496da6486",
  nextPoc: "c48c1323-ca6a-465f-84cb-8c24f0f62df3",
  status: "9368ca9e-3549-4320-84ff-9abd0a2901cb",
  happiness: "4e3924e3-4898-4e98-aca1-cc1ac3015b73",
  service: "fccfc09c-650e-4aed-b4cd-3f50beba05a3",
};
const DEPARTMENTS: Record<string, [string, string]> = {
  creative: ["901818016338", "Media/Creative"],
  tech: ["901816723190", "Operations/Tech"],
  client_success: ["901816723211", "Client Success"],
  call_center: ["901816723206", "Call Center"],
  media_buyer: ["901816723196", "Marketing/ADs"],
};
const REQUEST_TYPE_FIELD = "e9fd8024-8abe-4094-ac08-e6c0e736ad7e";
const REQUEST_TYPE: Record<string, string> = {
  "Switch this campaign to a landing page": "Create Landing Page📊",
  "Add qualification questions to the lead form":
    "Add Custom Qualification Questions🙋",
  "Tracking / page is broken": "Missing Leads ❌",
  "Pause this client": "Client Pause Request ⏸️",
  "Relaunch this client": "Client Relaunch Request ⏯️",
  "Offboard this client": "Client Offboarding Request 🔴",
};
const FOOTAGE_FIELD = "d37a6747-c4a1-43c5-bb73-e1725ecec982";
const DAY_MS = 86_400_000;

const cu = (path: string) => `https://api.clickup.com/api/v2/${path}`;
async function get(path: string): Promise<Any> {
  return unwrap(await callTool("pd_clickup_proxy_get", { url: cu(path) }));
}
async function post(path: string, json_body: unknown): Promise<Any> {
  return unwrap(
    await callTool("pd_clickup_proxy_post", { url: cu(path), json_body }),
  );
}
async function put(path: string, json_body: unknown): Promise<Any> {
  return unwrap(
    await callTool("pd_clickup_proxy_put", { url: cu(path), json_body }),
  );
}

async function bridge(
  app: "creative" | "csm",
  fn: string,
  args: Record<string, unknown>,
): Promise<Any> {
  const url =
    process.env[app === "creative" ? "CREATIVE_BRIDGE_URL" : "CSM_BRIDGE_URL"];
  const token =
    process.env[
      app === "creative" ? "CREATIVE_BRIDGE_TOKEN" : "CSM_BRIDGE_TOKEN"
    ];
  if (!url || !token) throw new Error(`${app} bridge not configured`);
  const res = await fetch(`${url}/bridge`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ fn, args }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.ok === false)
    throw new Error(
      `${app}:${fn} → HTTP ${res.status} ${String(body?.error ?? "").slice(0, 200)}`,
    );
  return body.data;
}

/** Midday UTC on a YYYY-MM-DD, so a date never slips a day in Kuwait. */
function epochMs(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d, 12);
}
/** 09:00 Kuwait today, as ClickUp wants it. */
function msToday(): number {
  const t = new Date(Date.now() + 3 * 3600_000);
  return Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), 6);
}

async function optionId(
  listId: string,
  fieldId: string,
  label: string,
): Promise<string | undefined> {
  const defs = await get(`list/${listId}/field`);
  const f = (defs?.fields ?? []).find((x: Any) => x.id === fieldId);
  return (f?.type_config?.options ?? []).find((o: Any) => o.name === label)?.id;
}
async function fieldIdByName(name: string): Promise<string | undefined> {
  const defs = await get(`list/${CLIENTS_LIST}/field`);
  return (defs?.fields ?? []).find(
    (f: Any) =>
      String(f.name ?? "")
        .trim()
        .toLowerCase() === name.toLowerCase(),
  )?.id;
}
const setField = (taskId: string, fieldId: string, value: unknown) =>
  post(`task/${taskId}/field/${fieldId}`, { value });
const comment = (taskId: string, text: string) =>
  post(`task/${taskId}/comment`, { comment_text: text, notify_all: false });

/**
 * Move a task to its list's "done" status, and verify it moved. Only ClickUp's
 * done type counts: the closed type on these lists is `cancelled`, and marking
 * a finished video cancelled would be worse than doing nothing.
 */
async function closeTask(taskId: string): Promise<[boolean, string]> {
  const task = await get(`task/${taskId}`);
  if (!task?.id) return [false, "task not found"];
  const statuses: Any[] =
    (await get(`list/${task.list?.id ?? ""}`))?.statuses ?? [];
  const done = statuses.find(s => s.type === "done")?.status;
  if (!done)
    return [
      false,
      `list has no done status, only ${statuses.map(s => s.status).join(", ")}`,
    ];
  await put(`task/${taskId}`, { status: done });
  const after = await get(`task/${taskId}`);
  const now = String(after?.status?.status ?? "");
  return now.toLowerCase() === String(done).toLowerCase()
    ? [true, `moved to ${done}`]
    : [false, `status still ${now}, wanted ${done}`];
}

// --- creative director ---------------------------------------------------------

async function creativeItem(item: Any): Promise<[boolean, string]> {
  const { kind, taskId } = item;
  const data: Any = item.payload ?? {};
  if (kind === "comment" && taskId) {
    await comment(taskId, String(data.text ?? ""));
    return [true, "comment posted"];
  }
  if (kind === "complete" && taskId) return await closeTask(taskId);
  if (kind === "videoRequest") {
    const body: Any = {
      name: data.type || "New Video Request 🎥",
      description: data.brief ?? "",
      // The tag is what makes the task findable per client.
      tags: [String(data.client ?? "").toLowerCase()],
    };
    if (data.due) body.due_date = epochMs(String(data.due));
    const created = await post(`list/${VIDEO_LIST}/task`, body);
    if (created?.id && data.footage)
      await setField(created.id, FOOTAGE_FIELD, data.footage);
    return [Boolean(created?.id), `video task ${created?.id}`];
  }
  if (kind === "planScript") {
    const body: Any = {
      name: data.title || "New Script Request✍️",
      description: data.brief ?? "",
      tags: [String(data.client ?? "").toLowerCase()],
    };
    if (data.due) {
      body.due_date = epochMs(String(data.due));
      body.due_date_time = false;
    }
    const created = await post(`list/${CREATIVE_LIST}/task`, body);
    return [Boolean(created?.id), `script task ${created?.id}`];
  }
  if (kind === "schedule" && taskId) {
    await put(`task/${taskId}`, {
      due_date: epochMs(String(data.due)),
      due_date_time: false,
    });
    const back = await get(`task/${taskId}`);
    const got = Number(back?.due_date ?? 0);
    const ok = got > 0 && Math.abs(got - epochMs(String(data.due))) < DAY_MS;
    return [ok, ok ? `due ${data.due}` : `board still says ${got}`];
  }
  return [false, `unknown action ${kind}`];
}

export const drainCreative = internalAction({
  args: {},
  returns: v.object({ done: v.number(), failed: v.number() }),
  handler: async () => {
    const items: Any[] = (await bridge("creative", "outboxPending", {})) ?? [];
    let done = 0;
    let failed = 0;
    for (const item of items) {
      let ok = false;
      let result = "";
      try {
        [ok, result] = await creativeItem(item);
      } catch (e) {
        result = String(e).slice(0, 300);
      }
      await bridge("creative", "outboxSettle", { id: item.id, ok, result });
      ok ? done++ : failed++;
      console.log(
        `creative outbox ${item.kind}: ${ok ? "ok" : "FAILED"} — ${result}`,
      );
    }
    return { done, failed };
  },
});

// --- client success ------------------------------------------------------------

/** Perform one client success outbox row. Returns [resultUrl, error]. */
async function csmRow(
  row: Any,
): Promise<[string | undefined, string | undefined]> {
  const kind: string = row.kind;
  const taskId: string = row.clientTaskId ?? "";
  if (kind === "report") {
    const fid = await fieldIdByName("Last report sent");
    if (!fid)
      return [undefined, 'ClickUp field "Last report sent" does not exist yet'];
    await setField(taskId, fid, msToday());
  } else if (kind === "touchpoint" || kind === "call") {
    await setField(taskId, CF.lastPoc, msToday());
    if (kind === "call") await setField(taskId, CF.lastCall, msToday());
  } else if (kind === "booked" && row.value) {
    await setField(
      taskId,
      CF.nextPoc,
      epochMs(String(row.value)) - 3 * 3600_000,
    );
  } else if (kind === "stage" && row.value) {
    const oid = await optionId(CLIENTS_LIST, CF.status, String(row.value));
    if (oid) await setField(taskId, CF.status, oid);
  } else if (kind === "service" && row.value) {
    const fid = CF.service ?? (await fieldIdByName("Service"));
    const oid = fid
      ? await optionId(CLIENTS_LIST, fid, String(row.value))
      : undefined;
    if (!oid) return [undefined, `no Service option called ${row.value}`];
    await setField(taskId, fid, oid);
  } else if (kind === "happiness" && row.value) {
    const oid = await optionId(CLIENTS_LIST, CF.happiness, String(row.value));
    if (oid) await setField(taskId, CF.happiness, oid);
  }

  let resultUrl: string | undefined;
  if (kind === "plan_task" || kind === "issue") {
    const name = row.clientName
      ? `${row.clientName} — ${row.action}`
      : kind === "issue"
        ? `Cockpit fix — ${String(row.action).slice(0, 60)}`
        : row.action;
    const created = await post(`list/${CS_LIST}/task`, {
      name,
      description: row.evidence,
    });
    if (kind === "issue" && !row.clientName) {
      // A wrong screen, reported by the CSM: Hermes gets the job too.
      try {
        await ctx.runMutation(internal.fixRequests.file, {
          source: "Report an issue (client success cockpit)",
          app: "client-success",
          title: String(row.action).slice(0, 120),
          detail: String(row.evidence ?? row.action),
        });
      } catch (e) {
        console.error(`fix request failed: ${String(e).slice(0, 120)}`);
      }
    }
    return [created?.url, undefined];
  }

  if (row.department) {
    const dep = DEPARTMENTS[row.department];
    if (!dep) return [undefined, `unknown department ${row.department}`];
    const [listId] = dep;
    const created = await post(`list/${listId}/task`, {
      name: `${row.clientName} — ${row.action}`,
      description: [
        "Requested by the CSM via the Client Success Cockpit.",
        "",
        `Client: ${row.clientName}`,
        `Why: ${row.evidence}`,
        row.note ? `Note: ${row.note}` : "",
        `Client task: https://app.clickup.com/t/${taskId}`,
      ]
        .join("\n")
        .trim(),
    });
    resultUrl = created?.url;
    const typeLabel = REQUEST_TYPE[row.action];
    if (resultUrl && typeLabel) {
      const oid = await optionId(listId, REQUEST_TYPE_FIELD, typeLabel);
      if (oid) await setField(created.id, REQUEST_TYPE_FIELD, oid);
    }
  }

  let head =
    (
      {
        call: "CALL LOGGED",
        touchpoint: "TOUCHPOINT",
        left: "LEFT AS IS",
        report: "MONTHLY REPORT SENT",
      } as Record<string, string>
    )[kind] ?? "UPDATED";
  if (row.department && DEPARTMENTS[row.department])
    head = `SENT TO ${DEPARTMENTS[row.department][1].toUpperCase()}`;
  if (taskId) {
    const lines = [
      `🎯 Cockpit · ${head} — ${row.action}`,
      "",
      `Why: ${row.evidence}`,
    ];
    if (row.note) lines.push(`Note: ${row.note}`);
    if (row.snooze) lines.push(`Checked again: ${row.snooze}`);
    if (resultUrl) lines.push(`Task created: ${resultUrl}`);
    lines.push("Logged by the CSM via the Client Success Cockpit.");
    await comment(taskId, lines.join("\n"));
  }
  return [resultUrl, undefined];
}

export const drainCsm = internalAction({
  args: {},
  returns: v.object({ done: v.number(), failed: v.number() }),
  handler: async () => {
    const rows: Any[] = (await bridge("csm", "pending", {})) ?? [];
    let done = 0;
    let failed = 0;
    for (const row of rows) {
      let url: string | undefined;
      let error: string | undefined;
      try {
        [url, error] = await csmRow(row);
      } catch (e) {
        error = String(e).slice(0, 300);
      }
      await bridge("csm", "markSent", { id: row._id, resultUrl: url, error });
      error ? failed++ : done++;
      console.log(
        `csm outbox ${row.kind} ${row.clientName ?? ""}: ${error ?? url ?? "ok"}`,
      );
    }
    return { done, failed };
  },
});

/** Both queues. Every 5 minutes, so an action in either app lands within minutes. */
export const drainAll = internalAction({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<unknown> => {
    const out: Record<string, unknown> = {};
    for (const [name, fn] of [
      ["creative", "drainCreative"],
      ["csm", "drainCsm"],
    ] as const) {
      try {
        out[name] = await ctx.runAction(
          fn === "drainCreative"
            ? internal.outboxDrains.drainCreative
            : internal.outboxDrains.drainCsm,
          {},
        );
      } catch (e) {
        out[name] = `FAILED ${String(e).slice(0, 200)}`;
        console.error(`${name} outbox drain: ${String(e).slice(0, 300)}`);
      }
    }
    return out;
  },
});
