import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  type ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import {
  boardStatusAfter,
  cardFor,
  changeComment,
  isChange,
} from "./changeLog";
import { AZIZ_SLACK_ID, CPB_GATE, CPL_GATE } from "./constants";
import { flush } from "./health";
import { isRefusal } from "./outboxCore";
import { callTool, graph, mirrorCockpitFeedback, unwrap } from "./tools";

declare const process: { env: Record<string, string | undefined> };

const ADS_LIST = "901817774521";

/** Custom fields on the Ads Managment list. */
const FIELD = {
  cpl7d: "1e821b51-4c40-4885-ba79-163fb348f796",
  dailySpend: "932aad28-0f2a-4905-be48-5b6dc1a8b2c3",
  lastUpdated: "d1ae5334-d0a6-436c-88ea-1104be8ef112",
  metaAccount: "8f9032d4-017c-4634-85d9-7ab046cc142f",
  launchDate: "2e744484-f581-4c37-962a-023c4de23729",
  adStatus: "7f118f61-34b6-483a-b749-ff9fc31fd423",
  funnelType: "d9714549-c02f-4b62-a52d-1ed587bb38c4",
  cplStatus: "e33b20f0-0cd5-440e-b7eb-e0c5702f09df",
  cpbStatus: "3adfc8f2-dad8-4a09-ac3c-76d2043efec9",
  bookings7d: "ce2f302a-2856-4349-bddc-79ba5dcaebaf",
  serviceType: "94ad466d-7a45-427f-83da-9cd93002ff97",
  priority: "4f884743-a582-4bfe-9588-db8f70f68afe",
};

/** Deliver a tool call, or queue it for the sandbox bridge if unreachable. */
async function callOrQueue(
  ctx: ActionCtx,
  role: string,
  args: Record<string, unknown>,
) {
  try {
    return unwrap(await callTool(role, args));
  } catch (e) {
    await ctx.runMutation(internal.outbox.enqueue, {
      role,
      args,
      error: String(e instanceof Error ? e.message : e).slice(0, 300),
    });
    return null;
  }
}

/** Dropdown option ids, resolved once from the list's field definitions. */
async function optionId(
  fieldId: string,
  label: string,
): Promise<string | undefined> {
  const defs = unwrap(
    await callTool("pd_clickup_proxy_get", {
      url: `https://api.clickup.com/api/v2/list/${ADS_LIST}/field`,
    }),
  );
  // biome-ignore lint/suspicious/noExplicitAny: ClickUp payload
  const f = (defs?.fields ?? []).find((x: any) => x.id === fieldId);
  // biome-ignore lint/suspicious/noExplicitAny: ClickUp payload
  return (f?.type_config?.options ?? []).find((o: any) => o.name === label)?.id;
}

async function setDropdown(
  ctx: ActionCtx,
  taskId: string,
  fieldId: string,
  label: string,
) {
  const id = await optionId(fieldId, label);
  if (id) await setField(ctx, taskId, fieldId, id);
}

/**
 * Keep the board's own KPI columns true instead of hand-typed. Cost against a KPI
 * reads the way the team says it out loud: cost ABOVE the KPI is the bad one.
 */
/** Board dropdown band. Above KPI = beating the gate (good); Below KPI = missing it. */
function kpiBand(value: number, gate: number): string {
  if (value <= gate * 0.75) return "Above KPI";
  if (value <= gate) return "At KPI";
  if (value <= gate * 1.5) return "Below KPI";
  return "911";
}

const cplStatusFor = (cpl: number) => kpiBand(cpl, CPL_GATE);

async function refreshKpiFields(
  ctx: ActionCtx,
  taskId: string,
  c: { cpl?: number; bookings7d?: number; spend7d?: number; priority?: string },
) {
  await setField(ctx, taskId, FIELD.lastUpdated, Date.now());
  if (c.cpl !== undefined) {
    await setField(ctx, taskId, FIELD.cpl7d, Number(c.cpl.toFixed(2)));
    await setDropdown(
      ctx,
      taskId,
      FIELD.cplStatus,
      // Board language: "Above KPI" means performing ABOVE the KPI, i.e. good.
      // "Below KPI" is the bad one. Confirmed by Aziz 2026-09-03.
      cplStatusFor(c.cpl),
    );
  }
  if (
    c.bookings7d !== undefined &&
    c.bookings7d > 0 &&
    c.spend7d !== undefined
  ) {
    const cpb = c.spend7d / c.bookings7d;
    await setField(ctx, taskId, FIELD.bookings7d, c.bookings7d);
    await setDropdown(ctx, taskId, FIELD.cpbStatus, kpiBand(cpb, CPB_GATE));
  }
}

/**
 * The ticketing form's own fields, on the Operations/Tech list. A request raised from
 * the cockpit fills the same fields the form would, so tech sees one kind of ticket.
 */
const TECH_FIELD = {
  requestType: "e9fd8024-8abe-4094-ac08-e6c0e736ad7e",
  additionalNotes: "6742edfb-9b6f-4615-933d-7ebd74f9542b",
  qualificationQuestions: "35f4bf1a-7df5-4cc0-919c-2669aea0bc27",
};

const TECH_REQUEST_TYPE: Record<string, string> = {
  "Add qualification questions to the lead form":
    "37d99ca0-e53f-4499-90e8-f1be8a21b207",
  "Switch to a landing page": "37d99ca0-e53f-4499-90e8-f1be8a21b207",
  "Landing page or tracking is broken": "9fd304bb-7078-4485-9b9f-aa19ad47ed98",
};

/** Where a rerouted request lands. Matches the boards each role actually works. */
export const DEPARTMENT_LIST: Record<string, { id: string; label: string }> = {
  creative: { id: "901818016338", label: "Media/Creative" },
  tech: { id: "901816723190", label: "Operations/Tech" },
  client_success: { id: "901816723211", label: "Client Success" },
  call_center: { id: "901816723206", label: "Call Center" },
  media_buyer: { id: "901816723196", label: "Marketing/ADs" },
};

/**
 * Write to ClickUp, or queue it when ClickUp cannot be reached.
 *
 * A dropped write is worse than a visible failure: she would believe the client
 * record was updated when it wasn't. See convex/outbox.ts. A refusal (a
 * deleted task, a value the field does not take) is thrown, not queued: a
 * retry cannot change it, and a queue full of them is what hid the outbox
 * jam of 2026-09-12 for three weeks. `queue: false` is for numbers that are
 * rewritten every hour anyway, where a late copy would only be a stale one.
 */
async function send(
  ctx: ActionCtx,
  role: "pd_clickup_proxy_post" | "pd_clickup_proxy_put",
  url: string,
  json_body: Record<string, unknown>,
  { queue = true }: { queue?: boolean } = {},
) {
  try {
    return unwrap(await callTool(role, { url, json_body }));
  } catch (e) {
    const error = String(e instanceof Error ? e.message : e).slice(0, 300);
    if (!queue || isRefusal(error)) throw e;
    await ctx.runMutation(internal.outbox.enqueue, {
      role,
      args: { url, json_body },
      error,
    });
    return null;
  }
}

async function post(
  ctx: ActionCtx,
  url: string,
  json_body: Record<string, unknown>,
  opts?: { queue?: boolean },
) {
  return send(ctx, "pd_clickup_proxy_post", url, json_body, opts);
}

/** ClickUp updates a task with PUT; a POST to /task/<id> is a 405. */
async function put(
  ctx: ActionCtx,
  url: string,
  json_body: Record<string, unknown>,
) {
  return send(ctx, "pd_clickup_proxy_put", url, json_body);
}

async function setField(
  ctx: ActionCtx,
  taskId: string,
  fieldId: string,
  value: unknown,
  opts?: { queue?: boolean },
) {
  await post(
    ctx,
    `https://api.clickup.com/api/v2/task/${taskId}/field/${fieldId}`,
    {
      value,
    },
    opts,
  );
}

function money(n: number | undefined): string {
  return n === undefined ? "—" : `$${n.toFixed(2)}`;
}

/**
 * The comment the CSM reads before a check-in call: what changed, why, and the
 * numbers it was decided on. Deliberately one block, no ambiguity about who did it.
 */
function decisionComment(d: {
  action: string;
  kind: string;
  evidence: string;
  reason?: string;
  snooze?: string;
  reroutedTo?: string;
  byEmail?: string;
}): string {
  const head =
    d.kind === "touch"
      ? "CLIENT UPDATED"
      : d.kind === "left"
        ? "LEFT AS IS"
        : d.kind === "rerouted"
          ? `SENT TO ${(d.reroutedTo ?? "another team").toUpperCase()}`
          : "CHANGE MADE";
  const lines = [
    `🎯 Cockpit · ${head} — ${d.action}`,
    "",
    `Why: ${d.evidence}`,
  ];
  if (d.reason) lines.push(`Note: ${d.reason}`);
  if (d.snooze) lines.push(`Checked again: ${d.snooze}`);
  lines.push(
    d.kind === "touch"
      ? "Sent by the media buyer via the Media Buyer Cockpit. Proactive touchpoint — the client has been told."
      : `Logged by: ${d.byEmail ?? "media buyer"} via the Media Buyer Cockpit. Checked again in 7 days.`,
  );
  return lines.join("\n");
}

export const getDecision = internalQuery({
  args: { id: v.id("decisions") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    const d = await ctx.db.get(id);
    if (!d) return null;
    const rows = await ctx.db.query("campaigns").collect();
    const campaign = rows.find(c => c.campaignName === d.subject) ?? null;
    return { ...d, campaign };
  },
});

export const boardCampaigns = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const rows = await ctx.db.query("campaigns").collect();
    return rows.filter(c => c.taskId && !c.internal);
  },
});

export const getManualChange = internalQuery({
  args: { id: v.id("manualChanges") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    const m = await ctx.db.get(id);
    if (!m) return null;
    const campaigns = (await ctx.db.query("campaigns").collect()).filter(
      c => !c.internal,
    );
    const card = cardFor(m.campaignName, campaigns);
    return {
      ...m,
      taskId: card?.taskId,
      ownCard: card?.ownCard ?? false,
      metaCampaignId: card?.campaign?.metaCampaignId,
      boardAdStatus: card?.campaign?.boardAdStatus,
    };
  },
});

export const markChangeLogged = internalMutation({
  args: {
    id: v.id("manualChanges"),
    taskId: v.optional(v.string()),
    /** False when the comment is queued rather than on the card yet. */
    delivered: v.optional(v.boolean()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, taskId, delivered, error }) => {
    const m = await ctx.db.get(id);
    if (!m) return null;
    await ctx.db.patch(id, {
      ...(taskId ? { clickupTaskId: taskId } : {}),
      ...(delivered ? { clickupLoggedAt: Date.now() } : {}),
      clickupError: error?.slice(0, 300),
    });
    return null;
  },
});

export const markLogged = internalMutation({
  args: {
    id: v.id("decisions"),
    clickupTaskId: v.optional(v.string()),
    clickupTaskUrl: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, clickupTaskId, clickupTaskUrl, error }) => {
    await ctx.db.patch(id, {
      loggedAt: error ? undefined : Date.now(),
      logError: error,
      ...(clickupTaskId ? { clickupTaskId } : {}),
      ...(clickupTaskUrl ? { clickupTaskUrl } : {}),
    });
    return null;
  },
});

export const attachTask = internalMutation({
  args: { campaignName: v.string(), taskId: v.string(), taskUrl: v.string() },
  returns: v.null(),
  handler: async (ctx, { campaignName, taskId, taskUrl }) => {
    const rows = await ctx.db.query("campaigns").collect();
    const row = rows.find(c => c.campaignName === campaignName);
    if (row)
      await ctx.db.patch(row._id, {
        taskId,
        taskUrl,
        onBoard: true,
        verdict: "hold",
      });
    return null;
  },
});

/**
 * Every decision becomes a comment on the campaign's own Ads Managment task, so
 * the CSM opens one place and sees the whole history of changes on that account.
 * Off-board campaigns get a task created first — no decision is allowed to
 * vanish because nobody had added the campaign to the board.
 */
export const logDecision = internalAction({
  args: { id: v.id("decisions") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const d = await ctx.runQuery(internal.writeback.getDecision, { id });
    if (!d) return null;
    try {
      let taskId = d.campaign?.taskId;
      let taskUrl = d.campaign?.taskUrl;

      // Aziz's rule: one task per client. If this client already has a task under an
      // older campaign name, rename that task and note the dead campaign — never open
      // a second row for the same client.
      if (taskId && d.campaign?.staleTaskName) {
        await put(ctx, `https://api.clickup.com/api/v2/task/${taskId}`, {
          name: d.campaign.campaignName,
        });
        await post(
          ctx,
          `https://api.clickup.com/api/v2/task/${taskId}/comment`,
          {
            comment_text: [
              `🎯 Cockpit · CAMPAIGN REPLACED — this task now tracks ${d.campaign.campaignName}`,
              "",
              `${d.campaign.staleTaskName} is no longer delivering. The live campaign for this client is ${d.campaign.campaignName} (${money(d.campaign.spend7d)} in the last 7 days).`,
              "One task per client — the history stays in this thread.",
            ].join("\n"),
            notify_all: false,
          },
        );
        await ctx.runMutation(internal.writeback.attachTask, {
          campaignName: d.campaign.campaignName,
          taskId,
          taskUrl: taskUrl ?? "",
        });
      }

      // Genuinely new client on the board — create the task, always tagged.
      if (!taskId && d.campaign) {
        const created = await post(
          ctx,
          "https://api.clickup.com/api/v2/list/" + ADS_LIST + "/task",
          {
            name: d.campaign.campaignName,
            markdown_description: [
              `Added from the cockpit on behalf of the media buyer because this campaign was spending with no task on the board.`,
              "",
              `Account: ${d.campaign.accountName}`,
              `Last 7 days: ${money(d.campaign.spend7d)} spend · ${d.campaign.leads7d} leads · ${money(d.campaign.cpl)} CPL`,
              `Live: ${d.campaign.daysLive ?? "?"} days`,
            ].join("\n"),
            status: "to do",
            tags: d.campaign.clientTag ? [d.campaign.clientTag] : [],
          },
        );
        taskId = created?.id;
        taskUrl = created?.url;
        if (taskId) {
          await setDropdown(ctx, taskId, FIELD.adStatus, "Live");
          await refreshKpiFields(ctx, taskId, d.campaign);
          await ctx.runMutation(internal.writeback.attachTask, {
            campaignName: d.campaign.campaignName,
            taskId,
            taskUrl: taskUrl ?? "",
          });
        }
      }

      if (!taskId) throw new Error("No ClickUp task to log against");

      await post(ctx, `https://api.clickup.com/api/v2/task/${taskId}/comment`, {
        comment_text: decisionComment(d),
        notify_all: false,
      });
      if (d.campaign) await refreshKpiFields(ctx, taskId, d.campaign);
      // The client tag is what links this row to the client board, the ad account and
      // everyone else's view — never let a row sit untagged.
      if (
        d.campaign?.clientTag &&
        !(d.campaign.tags ?? []).includes(d.campaign.clientTag)
      ) {
        await post(
          ctx,
          `https://api.clickup.com/api/v2/task/${taskId}/tag/${encodeURIComponent(d.campaign.clientTag)}`,
          {},
        );
      }

      // A reroute is a real request on another team's board, not just a note.
      if (d.kind === "rerouted" && d.reroutedTo) {
        const dest = DEPARTMENT_LIST[d.reroutedTo];
        if (dest) {
          const created = await post(
            ctx,
            `https://api.clickup.com/api/v2/list/${dest.id}/task`,
            {
              name: `${d.campaign?.clientName ?? d.subject} — ${d.action}`,
              markdown_description: [
                `Requested from the Media Buyer Cockpit.`,
                "",
                `Campaign: ${d.subject}`,
                `Why: ${d.evidence}`,
                d.reason ? `Note: ${d.reason}` : "",
                taskUrl ? `Campaign task: ${taskUrl}` : "",
              ]
                .filter(Boolean)
                .join("\n"),
              status: "to do",
              tags: d.campaign?.clientTag ? [d.campaign.clientTag] : [],
            },
          );
          // Fill the ticket the way the form would, so nothing arrives half-described.
          if (created?.id && d.reroutedTo === "tech") {
            const rt = TECH_REQUEST_TYPE[d.action];
            if (rt) await setField(ctx, created.id, TECH_FIELD.requestType, rt);
            await setField(
              ctx,
              created.id,
              TECH_FIELD.additionalNotes,
              (d.reason ?? d.evidence).slice(0, 250),
            );
            if (d.action.includes("qualification")) {
              await setField(
                ctx,
                created.id,
                TECH_FIELD.qualificationQuestions,
                (d.reason ?? "See notes").slice(0, 250),
              );
            }
          }
          if (created?.url) {
            await post(
              ctx,
              `https://api.clickup.com/api/v2/task/${taskId}/comment`,
              {
                comment_text: `🎯 Cockpit · Request raised on the ${dest.label} board: ${created.url}`,
                notify_all: false,
              },
            );
          }
        }
      }

      await ctx.runMutation(internal.writeback.markLogged, {
        id,
        clickupTaskId: taskId,
        clickupTaskUrl: taskUrl,
      });
    } catch (e) {
      await ctx.runMutation(internal.writeback.markLogged, {
        id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    return null;
  },
});

/**
 * Every change made in the cockpit, onto the client's card on the ads
 * management board: the switches, budgets, copied ad sets, new ads, new
 * creatives, builds and the typed change log (see changeLog.ts). A campaign
 * switched on or off in Meta also moves the card's Ad Status, read back from
 * Meta so two quick switches can never leave the card on the wrong one.
 */
export const logManualChange = internalAction({
  args: {
    id: v.id("manualChanges"),
    /** A whole campaign was switched on or off: bring the card's Ad Status along. */
    syncAdStatus: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, { id, syncAdStatus }) => {
    const m = await ctx.runQuery(internal.writeback.getManualChange, { id });
    if (!m || !isChange(m.what)) return null;
    if (!m.taskId) {
      await ctx.runMutation(internal.writeback.markChangeLogged, {
        id,
        error: `No card on the ads management board for ${m.campaignName}, so this change is in the cockpit only.`,
      });
      return null;
    }
    try {
      const posted = await post(
        ctx,
        `https://api.clickup.com/api/v2/task/${m.taskId}/comment`,
        { comment_text: changeComment(m), notify_all: false },
      );
      await ctx.runMutation(internal.writeback.markChangeLogged, {
        id,
        taskId: m.taskId,
        delivered: Boolean(posted),
      });
    } catch (e) {
      // The cockpit entry stands; the reason is kept on it.
      await ctx.runMutation(internal.writeback.markChangeLogged, {
        id,
        taskId: m.taskId,
        error: String(e instanceof Error ? e.message : e),
      });
    }
    if (syncAdStatus && m.ownCard && m.metaCampaignId) {
      try {
        const live = await graph<{ status?: string }>(m.metaCampaignId, {
          fields: "status",
        });
        const status = boardStatusAfter(live?.status, m.boardAdStatus);
        const option = status
          ? await optionId(FIELD.adStatus, status)
          : undefined;
        if (status && option) {
          await setField(ctx, m.taskId, FIELD.adStatus, option);
          await ctx.runMutation(internal.board.patchStatus, {
            campaignName: m.campaignName,
            status,
            taskId: m.taskId,
          });
        }
      } catch (e) {
        console.error(
          `ad status for ${m.campaignName}: ${String(e).slice(0, 200)}`,
        );
      }
    }
    await flush(ctx);
    return null;
  },
});

/** Ask a named person for what is missing, on the task itself. */
export const askOnTask = internalAction({
  args: {
    taskId: v.string(),
    question: v.string(),
    assignee: v.optional(v.number()),
    assigneeName: v.optional(v.string()),
    askedBy: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const body: Record<string, unknown> = {
      comment_text: [
        `🎯 ${args.assigneeName ? `@${args.assigneeName} — ` : ""}${args.askedBy} needs something to move this forward:`,
        "",
        args.question,
        "",
        "Reply here so the answer stays on the task.",
      ].join("\n"),
      notify_all: true,
    };
    if (args.assignee !== undefined) body.assignee = args.assignee;
    try {
      await post(
        ctx,
        `https://api.clickup.com/api/v2/task/${args.taskId}/comment`,
        body,
      );
    } catch (e) {
      console.error(`ask on task ${args.taskId}: ${String(e).slice(0, 200)}`);
    }
    await flush(ctx);
    return null;
  },
});

/**
 * Pushes the live 7 day numbers onto every matched board task, so the CPL and
 * Last Updated columns stop being hand-typed. Not queued: the next hour
 * writes fresh numbers, and a queued copy would only be a stale one (1,927
 * of them piled up from 24 to 27 September). A run where no card took the
 * numbers fails, so the job ledger says so.
 */
export const pushMetrics = internalAction({
  args: {},
  returns: v.object({ updated: v.number(), failed: v.number() }),
  handler: async ctx => {
    const campaigns = await ctx.runQuery(internal.writeback.boardCampaigns, {});
    let updated = 0;
    let failed = 0;
    let lastError = "";
    for (const c of campaigns) {
      if (!c.taskId) continue;
      try {
        if (c.cpl !== undefined)
          await setField(ctx, c.taskId, FIELD.cpl7d, Number(c.cpl.toFixed(2)), {
            queue: false,
          });
        await setField(ctx, c.taskId, FIELD.lastUpdated, Date.now(), {
          queue: false,
        });
        updated += 1;
      } catch (e) {
        failed += 1;
        lastError = String(e instanceof Error ? e.message : e).slice(0, 200);
      }
    }
    await flush(ctx);
    if (failed > 0 && updated === 0)
      throw new Error(
        `No board card took the KPI columns (${failed} tried): ${lastError}`,
      );
    return { updated, failed };
  },
});

/**
 * Forward a cockpit message to Viktor's Slack DM. She should never have to
 * leave the screen to report that something looks wrong.
 */
export const forwardFeedback = internalAction({
  args: { id: v.id("feedback") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const row = await ctx.runQuery(internal.writeback.getFeedback, { id });
    if (!row) return null;
    try {
      await mirrorCockpitFeedback({
        sourceId: String(id),
        app: "media-buyer",
        page: String(row.page ?? "unknown"),
        role: "media_buyer",
        text: String(row.text ?? ""),
        actorEmail: row.email ? String(row.email) : undefined,
        at: Number(row.at ?? Date.now()),
        metadata: { delivered: Boolean(row.delivered) },
      });
    } catch {
      // Shadow migration failures are visible in the health ledger. They must
      // not block the existing Slack and fix-request delivery path.
    }
    await callOrQueue(ctx, "coworker_send_slack_message", {
      // Aziz's user id opens his DM; the old D... channel id no longer exists.
      channel_id: process.env.ALERT_SLACK_TO || AZIZ_SLACK_ID,
      do_send: true,
      blocks: [
        {
          type: "markdown",
          text: `**From the media buyer cockpit** · ${row.page}\n\n> ${row.text}`,
        },
      ],
    });
    try {
      await ctx.runMutation(internal.fixRequests.file, {
        source: "feedback box (media buyer cockpit)",
        app: "media-buyer",
        title: String(row.text).slice(0, 120),
        detail: String(row.text),
        page: String(row.page ?? ""),
      });
    } catch (e) {
      console.error(`fix request failed: ${String(e).slice(0, 120)}`);
    }
    await ctx.runMutation(internal.writeback.markFeedbackDelivered, { id });
    await flush(ctx);
    return null;
  },
});

export const getFeedback = internalQuery({
  args: { id: v.id("feedback") },
  returns: v.any(),
  handler: async (ctx, { id }) => await ctx.db.get(id),
});

export const markFeedbackDelivered = internalMutation({
  args: { id: v.id("feedback") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { delivered: true });
    return null;
  },
});

/* ------------------------------------------------------------------ *
 * End of day — into the EOD Reports sheet and #media-eods, in exactly
 * the shape the existing form produces.
 *
 * The sheet is Aziz's accountability record for every role. We only ever
 * APPEND to the 'Media Buyer' tab, never write to a cell that already has
 * something in it. The 21 columns below are read off that tab's header row
 * in order and must not be reordered.
 * ------------------------------------------------------------------ */

const EOD_SHEET = "1EhPp7x0jZfV8dNjUvmuWv_alNvduMGpe_COjUAB13bw";
const EOD_TAB = "Media Buyer";
const MEDIA_EODS_CHANNEL = "C0AQ2LD0PL1";

/** dd-mm-yyyy, the format the form posts. */
function eodDate(day: string): string {
  const [y, m, d] = day.split("-");
  return `${d}-${m}-${y}`;
}

/** How long one post run owns the row. A run that died without reporting back frees it after this. */
const EOD_CLAIM_MS = 60_000;

/**
 * Claim the row before anything is sent. A resubmit or a re-save can schedule
 * a second run while a ladder retry is still in flight; the first one to
 * claim posts, the other returns null. Returns the row, or null when it has
 * already gone out or someone else holds it.
 */
export const claimEod = internalMutation({
  args: { id: v.id("eodReports") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (!row || row.submittedAt) return null; // never double-post
    const now = Date.now();
    if (row.postingAt && now - row.postingAt < EOD_CLAIM_MS) return null;
    await ctx.db.patch(id, { postingAt: now });
    return row;
  },
});

export const markEodSubmitted = internalMutation({
  args: { id: v.id("eodReports"), ts: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { id, ts }) => {
    await ctx.db.patch(id, {
      submittedAt: Date.now(),
      slackTs: ts,
      error: undefined,
      postingAt: undefined,
    });
    return null;
  },
});

/** A failed post is recorded on the row, so the cockpit can say so and retry. */
export const markEodError = internalMutation({
  args: { id: v.id("eodReports"), error: v.string(), attempts: v.number() },
  returns: v.null(),
  handler: async (ctx, { id, error, attempts }) => {
    // The run is over, so the claim is released: a Retry may go straight away.
    await ctx.db.patch(id, { error, attempts, postingAt: undefined });
    return null;
  },
});

/** Retry gaps for the Slack post, minutes: the same ladder the outbox uses. */
const EOD_RETRY_MIN = [1, 5, 15, 60, 240];

export const submitEod = internalAction({
  args: { id: v.id("eodReports") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const row = await ctx.runMutation(internal.writeback.claimEod, { id });
    if (!row) return null; // already out, or another run holds it
    const a = row.answers ?? {};
    const c = row.computed ?? {};
    const name = a.name ?? "Nada";
    const slackId = a.slackId ?? "U0AJQ8P1ACF";
    const dateFor = eodDate(row.day);

    // --- the Slack message, matched line for line against the form's output.
    // The unclosed asterisk on the Date line and the newline before the
    // "Food, Sleep, Water" and "Any Clients Above KPI?" values are quirks of
    // the live template — reproduced deliberately so this is indistinguishable.
    const msg = [
      "*MEDIA BUYER EOD*",
      `*Date - ${dateFor}`,
      "",
      `*Name - ${name}*`,
      `Submitted by: <@${slackId}>`,
      "",
      "*HEALTH*",
      `Focus - ${a.focus ?? ""}`,
      `Energy - ${a.energy ?? ""}`,
      `Food, Sleep, Water - \n${a.biology ?? ""}`,
      "",
      "*TASKS*",
      `Did you check and update the Master Fulfillment Dashboard for all active clients today? - ${a.dashboard ?? ""}`,
      `Are all client ad accounts within their daily budget targets? - ${a.onBudget ?? ""}`,
      `Did you flag any off-KPI client accounts to the CSM today? - ${a.flagged ?? ""}`,
      `Did you submit any video requests or creative briefs that were due today? - ${a.videoRequests ?? ""}`,
      `Did you upload any approved creatives to the client's Google Drive Creatives folder? - ${a.creativesUploaded ?? ""}`,
      "",
      "*Today's Numbers*",
      `Total Ad Spend Today - ${c.spend ?? ""}`,
      `Leads Generated - ${c.leads ?? ""}`,
      `Average CPL - ${c.cpl ?? ""}`,
      `Active Accounts Managed - ${c.accounts ?? ""}`,
      `Any Clients Above KPI? - \n${c.overGate ?? ""}`,
      `Any new creatives launched or paused today? - ${a.launchedPaused ?? ""}`,
      "",
      "*DAILY WRAP UP*",
      `Account Summary - ${a.accountSummary ?? ""}`,
      `Actions to get back into KPI - ${a.outOfKpi ?? "--"}`,
      "",
      "*ADDITIONAL NOTES*",
      `1% improvement - ${a.one_percent_better ?? "--"}`,
    ].join("\n");

    // A scheduled action that throws is not retried and leaves no trace, and
    // she has already been told the EOD went out. So a Slack failure is
    // written on the row, retried on the outbox ladder, and left visible.
    let posted: any;
    try {
      // `text`, not `blocks`. A blocks-only message stores the EOD inside
      // the block and leaves `message.text` as the tool's fallback --
      // "Message from the cockpit". The EOD Radar reads `message.text`,
      // as anything reading Slack reasonably would, so it saw no name and
      // no "Submitted by", and marked the person MISSED every single day
      // while the EOD sat in the channel in plain sight. Found 2026-09-22.
      posted = await callTool<any>("coworker_send_slack_message", {
        channel_id: MEDIA_EODS_CHANNEL,
        do_send: true,
        text: msg,
      });
    } catch (e) {
      const n = Number(row.attempts ?? 0);
      await ctx.runMutation(internal.writeback.markEodError, {
        id,
        error: String(e instanceof Error ? e.message : e).slice(0, 300),
        attempts: n + 1,
      });
      if (n < EOD_RETRY_MIN.length) {
        await ctx.scheduler.runAfter(
          EOD_RETRY_MIN[n] * 60_000,
          internal.writeback.submitEod,
          { id },
        );
      }
      return null;
    }

    // --- the sheet row, in the tab's own column order.
    const values = [
      new Date().toISOString().slice(0, 19).replace("T", " "), // Submitted At
      name, // Name
      `cockpit-${row.day}`, // Response ID
      dateFor, // Date For
      String(a.energy ?? ""), // Energy
      String(a.focus ?? ""), // Focus
      String(a.biology ?? ""), // Biology
      a.dashboard ?? "", // Fulfillment Dashboard Updated
      a.onBudget ?? "", // Ad Accounts On Budget
      a.flagged ?? "", // Off-KPI Flagged to CSM
      a.videoRequests ?? "", // Video Requests Submitted
      a.creativesUploaded ?? "", // Creatives Uploaded
      String(c.spend ?? ""), // Ad Spend ($)
      String(c.leads ?? ""), // Leads
      String(c.cpl ?? ""), // Avg CPL ($)
      String(c.accounts ?? ""), // Active Accounts
      c.overGate ?? "", // CPL > $20?
      a.launchedPaused ?? "", // Creatives Launched/Paused?
      a.accountSummary ?? "", // Account Summary
      a.outOfKpi ?? "", // Clients Out of KPI
      a.one_percent_better ?? "", // 1% Better
    ];
    // append, not update — existing rows are never touched.
    await callOrQueue(ctx, "pd_google_sheets_proxy_post", {
      url:
        `https://sheets.googleapis.com/v4/spreadsheets/${EOD_SHEET}/values/` +
        `${encodeURIComponent(`'${EOD_TAB}'!A:U`)}:append` +
        `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      json_body: { values: [values] },
    });

    await ctx.runMutation(internal.writeback.markEodSubmitted, {
      id,
      ts: posted?.message_ts ? String(posted.message_ts) : undefined,
    });
    return null;
  },
});
