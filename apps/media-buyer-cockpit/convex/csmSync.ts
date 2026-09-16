import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { authenticatedAction } from "./functions";
import { metaImageUsable } from "./metaMedia";
import { latestStillAt } from "./previews";
import { callTool, unwrap } from "./tools";

const CLIENTS_LIST = "901816559981"; // Clients - Mahara
const CS_LIST = "901816723211"; // All Assignments > Client Success

/** Custom field ids on Clients - Mahara. */
export const CF = {
  lastPoc: "e183f2ce-8b7a-491a-b160-2287a247758b",
  lastCall: "032203ad-e327-4d76-a0ce-c07496da6486",
  nextPoc: "c48c1323-ca6a-465f-84cb-8c24f0f62df3",
  status: "9368ca9e-3549-4320-84ff-9abd0a2901cb",
  launchDate: "2e744484-f581-4c37-962a-023c4de23729",
  onboardingCall: "ee9bf855-e05b-4afc-addf-1063cb54d3f0",
  nextPayment: "669ae046-bf82-4b59-80d5-bf25d6b57ef3",
  happiness: "4e3924e3-4898-4e98-aca1-cc1ac3015b73",
  commsLevel: "a41bb123-95a9-408c-adb8-908afd3b453c",
  sheetLink: "e6da13ae-6498-44a1-b7dd-9c6198500aa9",
  csm: "68ff84db-6c66-4e70-8e72-15d70828fda6",
  contract: "91e9e408-5673-4d8c-96c5-b557f2803b86",
  resumeOn: "d3c46259-3017-4429-a52a-c609a40f348b",
  // DFY (fully done for them, we book the appointments) vs DWY (done with you, they book
  // their own, so cost per lead is the only number we own).
  service: "fccfc09c-650e-4aed-b4cd-3f50beba05a3",
} as const;

/** Stage order: what the CSM must look at first. */
const STAGE_RANK: Record<string, number> = {
  "Needs Contacting": 1,
  "SALES TEAM TO CONTACT": 2,
  GHOSTED: 3,
  "DELAY OUT OF OUR CONTROL": 4,
  "Onboarding Booked": 5,
  "Brand Blueprint Booked♠️": 6,
  "LAUNCH BOOKED": 7,
  "Ready For Launch🚀": 8,
  Active: 9,
  Paused: 20,
  Stopped: 30,
  "CANCELLED ONBOARDING": 31,
};

const PIPELINE = new Set([
  "Needs Contacting",
  "Onboarding Booked",
  "Brand Blueprint Booked♠️",
  "LAUNCH BOOKED",
  "Ready For Launch🚀",
]);

const DEAD = new Set(["Stopped", "CANCELLED ONBOARDING", "Paused"]);

/** Everything before a client is live and being managed. */
const ONBOARDING = new Set([
  "Needs Contacting",
  "Onboarding Booked",
  "Brand Blueprint Booked\u2660\ufe0f",
  "LAUNCH BOOKED",
  "Ready For Launch\ud83d\ude80",
  "DELAY OUT OF OUR CONTROL",
]);

/**
 * Lost leads. Aziz's call: they are not the CSM's work and not worth a row.
 * Dropped from the screen and from every count.
 */
const EXCLUDED_STAGES = new Set(["SALES TEAM TO CONTACT"]);

const NOTES_FORM = "fRokTITH"; // Client 1-1 Call Notes Form
const NOTES_CLIENT_ID = "c484f390-9695-4ffa-9693-9cc219592713"; // = the ClickUp task id
const NOTES_ADDITIONAL = "82a6b434-15d9-4a14-8496-c20c94628536";
const NOTES_CLIENT_NOTES = "5d071906-da6a-4413-a729-0c76d0188d91";
const NOTES_DEFCON = "ff7970f7-9fad-4fa5-b12b-4d719dfb7587";
const NOTES_PRIORITY = "c9f99fb1-fec9-47e7-9baa-c5554733723d";

type CallNote = {
  taskId: string;
  submitted: string;
  notes: string[];
  defcon?: string;
  priority?: string;
};

/**
 * The 1-1 Call Notes Form keys on the client's ClickUp task id, so call history joins
 * exactly. Its notes are also where commitments to clients actually live — that is the
 * Promised list, sourced from a form the team already fills.
 */
async function callNotes(ctx: ActionCtx): Promise<CallNote[]> {
  const out: CallNote[] = [];
  try {
    const res = await httpGet(
      ctx,
      "pd_typeform_proxy_get",
      `https://api.typeform.com/forms/${NOTES_FORM}/responses?page_size=200`,
    );
    // biome-ignore lint/suspicious/noExplicitAny: Typeform payload
    for (const item of (res?.items ?? []) as any[]) {
      // biome-ignore lint/suspicious/noExplicitAny: Typeform payload
      const answers: any[] = item.answers ?? [];
      const find = (ref: string) => answers.find(a => a.field?.ref === ref);
      const taskId = String(find(NOTES_CLIENT_ID)?.text ?? "").trim();
      if (!taskId) continue;
      // Commitments only. Splitting the notes on every newline used to turn one call into
      // a dozen fragments like "sent" or "waiting" — noise that made the task list
      // unreadable. A commitment is a sentence long enough to act on, so short fragments
      // and pure status words are dropped, duplicates collapse, and one call contributes
      // at most four lines. The full note is still on the form.
      const STATUS_ONLY =
        /^(done|sent|ok|okay|n\/a|na|none|nothing|fine|good|no|yes|waiting|pending|follow up|followup|noted)\b/i;
      const notes = [
        ...new Set(
          [find(NOTES_ADDITIONAL)?.text, find(NOTES_CLIENT_NOTES)?.text]
            .filter(Boolean)
            .flatMap((t: string) =>
              String(t)
                .split(/\n|\u2022|(?: - )/)
                .map(x => x.replace(/^[-*\d.\s]+/, "").trim())
                .filter(x => x.length >= 20 && !STATUS_ONLY.test(x)),
            ),
        ),
      ].slice(0, 4);
      out.push({
        taskId,
        submitted: new Date(Date.parse(item.submitted_at) + 3 * 3600 * 1000)
          .toISOString()
          .slice(0, 10),
        notes,
        defcon: find(NOTES_DEFCON)?.choice?.label,
        priority: find(NOTES_PRIORITY)?.choice?.label,
      });
    }
  } catch {
    // The screen still works without call notes; the loose end simply cannot be checked.
  }
  return out;
}

const EXT_FORM = "gqBcyK6g";
const EXT_CLIENT_REF = "5145ff0c-009b-4f51-b3a9-4651efc908be";
const EXT_DURATION_REF = "278c2f80-88bd-428e-b330-8c6b3175d63f";

type Extension = { client: string; until: string };

/**
 * Billing extensions live in the Client Extension Form, not in ClickUp. The clock
 * starts at submission, so a late form cannot backdate cover. Never tell a CSM to
 * pause a client without checking this first.
 */
async function extensions(ctx: ActionCtx): Promise<Extension[]> {
  const out: Extension[] = [];
  try {
    const res = await httpGet(
      ctx,
      "pd_typeform_proxy_get",
      `https://api.typeform.com/forms/${EXT_FORM}/responses?page_size=200`,
    );
    // biome-ignore lint/suspicious/noExplicitAny: Typeform payload
    for (const item of (res?.items ?? []) as any[]) {
      // biome-ignore lint/suspicious/noExplicitAny: Typeform payload
      const answers: any[] = item.answers ?? [];
      const client =
        answers.find(a => a.field?.ref === EXT_CLIENT_REF)?.text ?? "";
      const label =
        answers.find(a => a.field?.ref === EXT_DURATION_REF)?.choice?.label ??
        "";
      const weeks = { "1 WEEK": 1, "2 WEEKS": 2, "4 WEEKS": 4 }[
        String(label).trim().toUpperCase()
      ];
      if (!client.trim() || !weeks) continue;
      const granted = Date.parse(item.submitted_at);
      if (!Number.isFinite(granted)) continue;
      out.push({
        client: client.trim(),
        until: new Date(granted + weeks * 7 * 86400000 + 3 * 3600 * 1000)
          .toISOString()
          .slice(0, 10),
      });
    }
  } catch {
    // A form outage must never block the screen; the ladder just runs without cover.
  }
  return out;
}

function liveExtension(
  name: string,
  exts: Extension[],
  today: string,
): string | undefined {
  const key = name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  let best: string | undefined;
  for (const e of exts) {
    const other = e.client.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    if (other.length < 4) continue;
    if (!(other.includes(key) || key.includes(other))) continue;
    if (e.until >= today && (!best || e.until > best)) best = e.until;
  }
  return best;
}

function kuwaitToday(): string {
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

function dayNumber(iso: string): number {
  return Math.floor(Date.parse(iso) / 86400000);
}

/** ClickUp date fields are ms-epoch strings. */
function toIso(value: unknown): string | undefined {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return new Date(n + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

function daysSince(iso: string | undefined, today: string): number | undefined {
  if (!iso) return undefined;
  return dayNumber(today) - dayNumber(iso);
}

/**
 * Resolves a Clients - Mahara field id by name. Used for fields Aziz adds himself after
 * a build — hardcoding an id that does not exist yet would silently read undefined for
 * everyone, forever. Returns undefined when the field has not been created.
 */
async function fieldIdByName(
  ctx: ActionCtx,
  name: string,
): Promise<string | undefined> {
  const d = await clickup(
    ctx,
    `https://api.clickup.com/api/v2/list/${CLIENTS_LIST}/field`,
  );
  // biome-ignore lint/suspicious/noExplicitAny: ClickUp payload
  const fields: any[] = d?.fields ?? [];
  const hit = fields.find(
    f => String(f.name).trim().toLowerCase() === name.toLowerCase(),
  );
  return hit?.id as string | undefined;
}

/**
 * One GET, two possible sources. The bridge pushes raw bodies into `rawFetch` because the
 * Space tool gateway answers HTTP 500 for every integration call; when a fresh body is
 * cached we use it, otherwise we still try the gateway so this heals itself the day the
 * platform is fixed.
 */
async function httpGet(ctx: ActionCtx, tool: string, url: string) {
  const cached: string | null = await ctx.runQuery(internal.rawFetch.get, {
    url,
  });
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      // fall through to the live call rather than trusting a truncated body
    }
  }
  return unwrap(await callTool(tool, { url }));
}

async function clickup(ctx: ActionCtx, url: string) {
  return httpGet(ctx, "pd_clickup_proxy_get", url);
}

// biome-ignore lint/suspicious/noExplicitAny: ClickUp payload
async function allTasks(
  ctx: ActionCtx,
  listId: string,
  includeClosed: boolean,
): Promise<any[]> {
  // biome-ignore lint/suspicious/noExplicitAny: ClickUp payload
  const out: any[] = [];
  for (let page = 0; page < 6; page++) {
    const d = await clickup(
      ctx,
      `https://api.clickup.com/api/v2/list/${listId}/task?include_closed=${includeClosed}&page=${page}`,
    );
    // biome-ignore lint/suspicious/noExplicitAny: ClickUp payload
    const tasks: any[] = d?.tasks ?? [];
    out.push(...tasks);
    if (tasks.length < 100) break;
  }
  return out;
}

/** Dropdown values come back as an option id or an orderindex. */
// biome-ignore lint/suspicious/noExplicitAny: ClickUp payload
function dropdown(task: any, fieldId: string): string | undefined {
  // biome-ignore lint/suspicious/noExplicitAny: ClickUp payload
  const f = (task.custom_fields ?? []).find((c: any) => c.id === fieldId);
  if (!f || f.value === undefined || f.value === null || f.value === "")
    return undefined;
  // biome-ignore lint/suspicious/noExplicitAny: ClickUp payload
  const opts: any[] = f.type_config?.options ?? [];
  const hit =
    opts.find(o => o.id === f.value) ??
    opts.find(o => String(o.orderindex) === String(f.value));
  return hit?.name;
}

// biome-ignore lint/suspicious/noExplicitAny: ClickUp payload
function raw(task: any, fieldId: string): any {
  // biome-ignore lint/suspicious/noExplicitAny: ClickUp payload
  return (task.custom_fields ?? []).find((c: any) => c.id === fieldId)?.value;
}

/**
 * The cadence rules from the CSM SOP, expressed once. Returns what the CSM must
 * do about this client today plus how loud it should be.
 */
const normName = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

function instruct(c: {
  stage: string;
  silentDays?: number;
  /** Days since the client record was created, the spine's day 0. */
  signupDays?: number;
  callDays?: number;
  nextPoc?: string;
  launchDate?: string;
  paymentDue?: number;
  extendedUntil?: string;
  /** Meta spend in the last 7 days while the card is still pre-launch. */
  liveSpend7d?: number;
  today: string;
}): { todo: string; level: "red" | "amber" | "blue" | "green"; rank: number } {
  // Paused, stopped and cancelled clients carry no cadence at all. Reactivation is a
  // sales motion, not a CSM chore, and they used to flood the list with "call today".
  if (DEAD.has(c.stage)) {
    return {
      todo: `${c.stage}, no cadence. Reactivation sits with sales.`,
      // Not "green": green means healthy AND active. Calling a stopped client healthy
      // inflated the dashboard's healthy count and hid the referral/review list, since
      // every long-lived green client turned out to be stopped.
      level: "blue",
      rank: 60,
    };
  }
  // Billing outranks everything: a past-due invoice is never suppressed.
  if (c.paymentDue !== undefined && c.extendedUntil) {
    return {
      todo: `Invoice late but an extension is logged to ${c.extendedUntil}, no chase needed`,
      level: "blue",
      rank: 42,
    };
  }
  if (c.paymentDue !== undefined) {
    const d = c.paymentDue;
    if (d >= 3)
      return {
        todo: "PAUSE REQUIRED, 3+ days past due with no logged extension",
        level: "red",
        rank: 0,
      };
    if (d >= 1)
      return {
        todo: `Invoice ${d}d late, chase or log an extension`,
        level: "red",
        rank: 0.2,
      };
    if (d === 0)
      return {
        todo: "Invoice due today, confirm payment",
        level: "amber",
        rank: 0.4,
      };
    if (d >= -3)
      return {
        todo: `Invoice due in ${-d}d, confirm they're ready`,
        level: "amber",
        rank: 0.6,
      };
    if (d >= -7)
      return {
        todo: `Invoice due in ${-d}d, send notice`,
        level: "blue",
        rank: 0.8,
      };
  }
  if (c.stage === "Needs Contacting")
    return {
      todo: "New signup, run the welcome call today and book the onboarding call",
      level: "red",
      rank: 1,
    };
  if (c.stage === "GHOSTED")
    return {
      todo:
        (c.silentDays ?? 99) >= 14
          ? "14 days chased, hand to the sales team"
          : "Keep chasing daily until day 14",
      level: "red",
      rank: 2,
    };
  if (c.nextPoc && c.nextPoc > c.today)
    return {
      todo: `Booked ${c.nextPoc}, nothing due today`,
      level: "blue",
      rank: 40,
    };
  // The journey is fixed, so each pipeline stage gets its own next step rather than one
  // generic "keep messaging". Onboarding call books the brand blueprint, not the launch.
  if (PIPELINE.has(c.stage)) {
    // Ads already running: the card is behind reality and nobody told the client.
    if ((c.liveSpend7d ?? 0) > 0)
      return {
        todo: `Live in Meta ($${Math.round(c.liveSpend7d ?? 0)} in 7 days) while the card says ${c.stage}. Mark them Active and tell the client they are live`,
        level: "red",
        rank: 1,
      };
    const step = /onboarding booked/i.test(c.stage)
      ? "Run the onboarding call, then book the brand blueprint with the creative strategist"
      : /blueprint/i.test(c.stage)
        ? "Blueprint is with the creative strategist, then book the launch call"
        : /launch booked/i.test(c.stage)
          ? "Run the launch call, then mark them ready for launch"
          : /ready for launch/i.test(c.stage)
            ? "Confirm live with the media buyer, then tell the client they are live"
            : "Pipeline, message every working day until they move";
    return { todo: step, level: "amber", rank: 3 };
  }

  const live = daysSince(c.launchDate, c.today);
  if (c.stage === "Active" && live !== undefined && live <= 7)
    return {
      todo:
        live === 7
          ? "Day 7, run the review call"
          : `Launch week (day ${live}), message daily`,
      level: "amber",
      rank: 4,
    };
  if (c.silentDays === undefined)
    return {
      todo: "No contact ever logged, open the group and log it",
      level: "red",
      rank: 5,
    };
  if (c.silentDays >= 14)
    return {
      todo: `Silent ${c.silentDays}d, call today`,
      level: "red",
      rank: 6,
    };
  if ((c.callDays ?? 99) >= 14)
    return {
      todo: "14 days since the last call, book the check-in call",
      level: "amber",
      rank: 7,
    };
  if (c.silentDays >= 7)
    return {
      todo: `Silent ${c.silentDays}d, check-in message due`,
      level: "amber",
      rank: 8,
    };
  return { todo: "Healthy, no action needed today", level: "green", rank: 50 };
}

export const store = internalMutation({
  args: {
    // biome-ignore lint/suspicious/noExplicitAny: snapshot rows
    clients: v.array(v.any()),
    // biome-ignore lint/suspicious/noExplicitAny: snapshot rows
    tasks: v.array(v.any()),
    // biome-ignore lint/suspicious/noExplicitAny: checklist rows
    checks: v.array(v.any()),
  },
  returns: v.object({ clients: v.number(), tasks: v.number() }),
  handler: async (ctx, args) => {
    for (const row of await ctx.db.query("clients").collect())
      await ctx.db.delete(row._id);
    for (const row of await ctx.db.query("csTasks").collect())
      await ctx.db.delete(row._id);
    for (const c of args.clients) await ctx.db.insert("clients", c);
    for (const t of args.tasks) await ctx.db.insert("csTasks", t);

    const day = kuwaitToday();
    const existing = await ctx.db
      .query("checks")
      .withIndex("by_role_day", q => q.eq("role", "csm").eq("day", day))
      .collect();
    const byKey = new Map(existing.map(c => [c.key, c]));
    // A check whose work no longer exists must disappear, not linger from an earlier run.
    const keep = new Set(args.checks.map((c: { key: string }) => c.key));
    for (const c of existing) if (!keep.has(c.key)) await ctx.db.delete(c._id);
    for (const c of args.checks) {
      const prev = byKey.get(c.key);
      if (prev)
        await ctx.db.patch(prev._id, { detail: c.detail, label: c.label });
      else
        await ctx.db.insert("checks", { ...c, role: "csm", day, done: false });
    }
    await ctx.db.insert("syncRuns", {
      at: Date.now(),
      ok: true,
      role: "csm",
      campaigns: args.clients.length,
      ads: args.tasks.length,
      offBoard: 0,
    });
    return { clients: args.clients.length, tasks: args.tasks.length };
  },
});

type CsmSyncResult = { clients: number; tasks: number };

/**
 * Builds the CSM snapshot without storing it. Exists so the standalone Client Success
 * app can be fed from here while its own tool gateway is broken — one source of logic,
 * two consumers.
 */
export const buildCsmSnapshot = internalAction({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<unknown> => {
    const today = kuwaitToday();
    const now = Date.now();

    const exts = await extensions(ctx);
    const notes = await callNotes(ctx);
    // Aziz added "Last report sent" by hand; resolve it by name so this works the moment
    // it exists and degrades to "unknown" rather than "never sent" while it does not.
    const reportFieldId = await fieldIdByName(ctx, "Last report sent");
    const clientTasks = await allTasks(ctx, CLIENTS_LIST, true);
    const liveWatch: {
      client: string;
      spend7d: number;
      sheetStatus: string;
    }[] = await ctx.runQuery(internal.sync.liveWatch, {});
    const liveSpendFor = (name: string): number | undefined => {
      const nk = normName(name);
      const hit = liveWatch.find(w => {
        const a = normName(w.client);
        return (
          a === nk || (a.length >= 5 && (a.startsWith(nk) || nk.startsWith(a)))
        );
      });
      return hit && hit.spend7d > 0 ? hit.spend7d : undefined;
    };
    const csTasks = await allTasks(ctx, CS_LIST, false);
    // Campaign decisions already logged by the media buyer, so the CSM walks into a
    // check-in call knowing every change made on that client's account.
    const campaigns = await ctx.runQuery(internal.csmSync.campaignsForCsm, {});
    const changeLog = await ctx.runQuery(internal.csmSync.recentDecisions, {});

    // biome-ignore lint/suspicious/noExplicitAny: rows for storage
    const clients: any[] = [];
    for (const t of clientTasks) {
      const stage = dropdown(t, CF.status);
      const csm = (raw(t, CF.csm) ?? []) as unknown[];
      // Junk filter from the SOP: no stage and no CSM is not a real client record.
      if (!stage && csm.length === 0) continue;
      if (/playing account/i.test(t.name)) continue;
      if (stage && EXCLUDED_STAGES.has(stage)) continue;

      const lastPoc = toIso(raw(t, CF.lastPoc));
      const lastCall = toIso(raw(t, CF.lastCall));
      const nextPoc = toIso(raw(t, CF.nextPoc));
      const launchDate = toIso(raw(t, CF.launchDate));
      const paymentDate = toIso(raw(t, CF.nextPayment));
      const happiness = dropdown(t, CF.happiness);
      const sheetLink = raw(t, CF.sheetLink) as string | undefined;
      const service = dropdown(t, CF.service);
      // Done with you: we run the ads, the client books their own appointments. So no
      // report sheet is chased and cost per lead is the KPI we are accountable for.
      const dwy = /dwy|done with/i.test(String(service ?? ""));
      const stageName = stage ?? "Needs Contacting";
      const lastReport = reportFieldId
        ? toIso(raw(t, reportFieldId))
        : undefined;
      const reportDays = daysSince(lastReport, today);
      const silentDays = daysSince(lastPoc, today);
      const callDays = daysSince(lastCall, today);
      const paymentDue =
        paymentDate && !DEAD.has(stageName)
          ? dayNumber(today) - dayNumber(paymentDate)
          : undefined;

      const extendedUntil = liveExtension(t.name, exts, today);
      const { todo, level, rank } = instruct({
        stage: stageName,
        liveSpend7d: liveSpendFor(t.name),
        extendedUntil,
        silentDays,
        callDays,
        nextPoc,
        launchDate,
        paymentDue:
          paymentDue !== undefined && paymentDue >= -7 ? paymentDue : undefined,
        today,
      });

      const liveDays = daysSince(launchDate, today);
      // Day 0 of the onboarding spine: when the client record was created, which for a
      // signed client is the day they signed. The only dated anchor ClickUp gives us
      // before a launch date exists.
      const signupDays = t.date_created
        ? daysSince(
            new Date(Number(t.date_created)).toISOString().slice(0, 10),
            today,
          )
        : undefined;
      const norm = String(t.name)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]/gu, "");
      const clientCampaigns = campaigns.filter(
        (c: { clientName?: string }) =>
          c.clientName &&
          String(c.clientName)
            .toLowerCase()
            .replace(/[^\p{L}\p{N}]/gu, "") === norm,
      );
      const changes = changeLog
        .filter((d: { subject: string }) =>
          clientCampaigns.some(
            (c: { campaignName: string }) => c.campaignName === d.subject,
          ),
        )
        .slice(0, 6);

      // Hot list: only ever after a first win, one conversation per client per month.
      const hot: { kind: string; why: string }[] = [];
      const won = stageName === "Active" && (liveDays ?? 0) >= 14;
      const happy =
        happiness === "Happy" || happiness === "Very Happy (testimonial)";
      if (won && happy) {
        hot.push({
          kind: "Upsell",
          why: `Active ${liveDays}d and marked ${happiness}. Full price first, paid in full.`,
        });
        hot.push({
          kind: "Referral",
          why: "Happy client past the first win, ask for one introduction ($1,000 payout).",
        });
        if (happiness === "Very Happy (testimonial)")
          hot.push({
            kind: "Google review",
            why: "Marked testimonial-ready, ask on the next call.",
          });
      }

      // Call notes for this client, newest first.
      const myNotes = notes
        .filter(n => n.taskId === t.id)
        .sort((a, b) => (a.submitted < b.submitted ? 1 : -1));
      const lastNote = myNotes[0];
      // A call was logged but no 1-1 note followed it: the team never saw the summary.
      const noteMissing = Boolean(
        lastCall && (!lastNote || lastNote.submitted < lastCall),
      );
      const commitments = (lastNote?.notes ?? []).map(text => ({
        text,
        source: `1-1 call notes, ${lastNote?.submitted}`,
      }));

      const loose: string[] = [];
      if (DEAD.has(stageName)) {
        // no loose ends chased on a client we are not currently serving
      } else {
        if (!lastPoc) loose.push("No contact ever logged");
        else if ((silentDays ?? 0) > 7)
          loose.push(`Last POC is ${silentDays}d stale`);
        // Aziz's rule: every client we are serving, onboarding included, must have a
        // booked next point of contact. We always want to know when the next call is.
        if (!nextPoc) loose.push("No next touchpoint booked");
        // A booking that has already come and gone is worse than none: it reads as
        // covered on the board while the client has actually gone quiet.
        else if (nextPoc < today)
          loose.push(`Next touchpoint ${nextPoc} has passed, nothing rebooked`);
        if (stageName === "Active" && !sheetLink && !dwy)
          loose.push("No report sheet linked");
        // Monthly client report. Only claimed when the field exists, so a missing field
        // never reads as a missed report.
        if (stageName === "Active" && reportFieldId) {
          if (!lastReport) loose.push("No monthly report ever sent");
          else if ((reportDays ?? 0) > 30)
            loose.push(`Monthly report is ${reportDays}d overdue`);
        }
        if (stageName === "Active" && !happiness)
          loose.push("Client happiness not set");
        if (!stage) loose.push("Client status not set");
        if (noteMissing)
          loose.push("1-1 call notes form not submitted for the last call");
      }

      clients.push({
        taskId: t.id,
        taskUrl: t.url,
        name: t.name,
        stage: stageName,
        stageRank: STAGE_RANK[stageName] ?? 15,
        csmAssigned: (csm as { username?: string }[])[0]?.username,
        lastPoc,
        lastCall,
        nextPoc,
        launchDate,
        liveDays,
        signupDays,
        paymentDate,
        paymentDue,
        extendedUntil,
        happiness,
        commsLevel: dropdown(t, CF.commsLevel),
        contract: dropdown(t, CF.contract),
        service,
        dwy,
        sheetLink,
        lastReport,
        reportDays,
        reportTracked: !!reportFieldId,
        reportDue:
          !!reportFieldId &&
          stageName === "Active" &&
          (!lastReport || (reportDays ?? 0) > 30),
        silentDays,
        callDays,
        todo,
        level,
        rank,
        hot,
        loose,
        changes,
        lastNoteOn: lastNote?.submitted,
        noteMissing,
        defcon: lastNote?.defcon,
        callPriority: lastNote?.priority,
        commitments,
        bucket: DEAD.has(stageName)
          ? "inactive"
          : ONBOARDING.has(stageName) ||
              (stageName === "GHOSTED" && !launchDate)
            ? "onboarding"
            : "management",
        pauseRequired: (paymentDue ?? -99) >= 3 && !extendedUntil,
        newSignup: stageName === "Needs Contacting",
        onboarding: PIPELINE.has(stageName),
        syncedAt: now,
      });
    }

    clients.sort(
      (a, b) =>
        a.rank - b.rank ||
        a.stageRank - b.stageRank ||
        (b.silentDays ?? 99) - (a.silentDays ?? 99),
    );

    // biome-ignore lint/suspicious/noExplicitAny: rows for storage
    // Done means gone. A task marked complete or cancelled on the Client Success board is
    // finished work, and leaving it on the screen is what made the list feel endless.
    const DONE_STATUS = /complete|cancel|closed|done|archiv/i;
    const tasks: any[] = [];
    for (const t of csTasks) {
      const due = t.due_date ? toIso(t.due_date) : undefined;
      if (due && due > today) continue; // only today, overdue and undated
      if (DONE_STATUS.test(t.status?.status ?? "")) continue;
      tasks.push({
        taskId: t.id,
        taskUrl: t.url,
        name: t.name,
        status: t.status?.status ?? "to do",
        dueDate: due,
        overdueDays: due ? dayNumber(today) - dayNumber(due) : undefined,
        assignee: (t.assignees ?? [])[0]?.username,
        syncedAt: now,
      });
    }
    tasks.sort((a, b) => (b.overdueDays ?? -1) - (a.overdueDays ?? -1));

    const needContact = clients.filter(c => c.newSignup).length;
    const pauses = clients.filter(c => c.pauseRequired).length;
    const dueToday = clients.filter(
      c => c.rank < 40 && c.level !== "green",
    ).length;
    const pastDue = clients.filter(c => (c.paymentDue ?? -99) >= 1).length;
    const hotCount = clients.filter(c => c.hot.length > 0).length;
    const looseCount = clients.reduce((s, c) => s + c.loose.length, 0);

    // Aziz's rule: never show a checklist line for work that is already provably done.
    // Every entry below only appears when outstanding work actually exists.
    const noteMissingCount = clients.filter(c => c.noteMissing).length;
    const reportsDue = clients.filter(c => c.reportDue).length;
    // Kuwait day-of-week: the snapshot's own `today` string, not the server's clock.
    const isThursday = new Date(`${today}T00:00:00Z`).getUTCDay() === 4;
    const commitmentCount = clients.reduce(
      (n, c) => n + (c.commitments?.length ?? 0),
      0,
    );
    /**
     * The day as Aziz wants it read: sprint, work, sprint, work, sprint. `block` groups
     * the checks on screen so the three WhatsApp sprints never blur into the task list.
     * The sprints themselves are always present — they are the floor of the job, not
     * something that appears only when there is other work.
     */
    const checks = [
      {
        key: "sprint_1",
        block: "sprint_am",
        label: "Morning sprint, client WhatsApp groups cleared (10:00–10:30)",
        detail:
          dueToday > 0
            ? `${dueToday} clients need a message or call today`
            : "Clear every group, then get out",
      },
      tasks.length > 0 && {
        key: "clickup_1",
        block: "work_am",
        label: "ClickUp notifications read and answered",
        detail: `${tasks.length} Client Success tasks due, overdue or undated`,
      },
      needContact > 0 && {
        key: "signups",
        block: "work_am",
        label: "New signups: welcome call done and onboarding booked",
        detail: `${needContact} waiting`,
      },
      noteMissingCount > 0 && {
        key: "calls",
        block: "work_am",
        label: "1-1 call notes filed for every call held",
        detail: `${noteMissingCount} call(s) logged with no notes form`,
      },
      commitmentCount > 0 && {
        key: "commitments",
        block: "work_pm",
        label: "Commitments from calls turned into tasks",
        detail: `${commitmentCount} outstanding`,
      },
      (pauses > 0 || pastDue > 0) && {
        key: "billing",
        block: "work_am",
        label: "Billing ladder actioned",
        detail:
          pauses > 0
            ? `${pauses} pause request(s) to file · ${pastDue} invoice(s) past due`
            : `${pastDue} invoice(s) past due`,
      },
      reportsDue > 0 && {
        key: "reports",
        block: "work_pm",
        label: "Monthly client reports sent",
        detail: `${reportsDue} active client(s) with no report in the last 30 days`,
      },
      // Thursday is when the report reminders land in #csm-general for approval. Whether
      // each one was approved and reached the client is only knowable from the Make
      // webhook, so this is a prompt to clear the channel, never a claim that it is done.
      isThursday && {
        key: "report_approvals",
        block: "work_pm",
        label: "Report reminders in #csm-general approved and sent",
        detail: "Thursday: clear every pending approval in the channel",
      },
      hotCount > 0 && {
        key: "hot",
        block: "work_pm",
        label: "Hot list reviewed, upsells, referrals, reviews",
        detail: `${hotCount} client(s) eligible`,
      },
      {
        key: "sprint_2",
        block: "sprint_midday",
        label: "Midday sprint, replies + team Slack answered (~14:00)",
        detail: "Clients on WhatsApp, team on Slack",
      },
      {
        key: "sprint_3",
        block: "sprint_pm",
        label: "Evening sprint, loose ends cleared before 18:00 (17:30–18:00)",
        detail:
          looseCount > 0
            ? `${looseCount} loose end(s) open · then file your end of day`
            : "Close every loop you opened today, then file your end of day",
      },
    ].filter(Boolean);

    return { clients, tasks, checks };
  },
});

export const runCsmSync = internalAction({
  args: {},
  returns: v.object({ clients: v.number(), tasks: v.number() }),
  handler: async (ctx): Promise<CsmSyncResult> => {
    // biome-ignore lint/suspicious/noExplicitAny: snapshot payload
    const payload: any = await ctx.runAction(
      internal.csmSync.buildCsmSnapshot,
      {},
    );
    return (await ctx.runMutation(internal.csmSync.store, {
      clients: payload.clients,
      tasks: payload.tasks,
      checks: payload.checks,
    })) as CsmSyncResult;
  },
});

export const campaignsForCsm = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const rows = await ctx.db.query("campaigns").collect();
    return rows.filter(c => !c.internal);
  },
});

/** The media buyer's decision ledger, newest first — the client change history. */
export const recentDecisions = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const rows = await ctx.db.query("decisions").order("desc").take(200);
    return rows.map(d => ({
      subject: d.subject,
      action: d.action,
      kind: d.kind,
      evidence: d.evidence,
      day: d.day,
      taskUrl: d.clickupTaskUrl,
    }));
  },
});

export const csmSyncNow = authenticatedAction({
  args: {},
  returns: v.object({ clients: v.number(), tasks: v.number() }),
  handler: async (ctx): Promise<CsmSyncResult> =>
    (await ctx.runAction(internal.csmSync.runCsmSync, {})) as CsmSyncResult,
});

/**
 * The live Meta structure the media buyer already syncs, for the CSM's client
 * profile. Ads carry their saved still and ids; the live preview is fetched
 * when someone opens one (previews.ts), so no preview link is sent.
 * `latestStillAt` lets the feed skip the saved-stills push when the client
 * success cockpit already has them all.
 */
export const metaTreeForCsm = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const now = Date.now();
    const rows = await ctx.db.query("metaTree").collect();
    const tree = rows.map(r => ({
      campaignName: r.campaignName,
      kind: r.kind,
      metaId: r.metaId,
      name: r.name,
      status: r.status,
      effectiveStatus: r.effectiveStatus,
      adsetId: r.adsetId,
      dailyBudget: r.dailyBudget,
      accountId: r.accountId,
      stillKey: r.stillKey,
      stillUrl: r.stillUrl,
      stillTinyUrl: r.stillTinyUrl,
      // Meta's own picture link, only while it has not expired.
      thumbUrl: metaImageUsable(r.thumbUrl, now) ? r.thumbUrl : undefined,
    }));
    return { tree, latestStillAt: await latestStillAt(ctx.db) };
  },
});
