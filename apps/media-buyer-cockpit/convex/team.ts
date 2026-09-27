import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalQuery } from "./_generated/server";
import type { SbRow } from "./ceo/sbWrite";
import { kuwaitDay } from "./ceo/time";
import { authenticatedAction } from "./functions";
import { accessFor } from "./roles";
import { ensureSitting } from "./teamCalendar";
import {
  appendWithVersion,
  blocksFor,
  pickIndex,
  renderOption,
  STAGES,
  slipsAdded,
  spinLine,
  spinRefusal,
} from "./teamCore";
import {
  type Any,
  clean,
  db,
  enc,
  logChange,
  meetingOrRefuse,
  mustBeBoss,
  mustManage,
  noted,
  slug,
  type Who,
} from "./teamDb";
import { type MeetingPage, type Overview, overviewOf, page } from "./teamPage";

/**
 * Team meetings: the screen at /team, for everybody on the team.
 *
 * The CEO, 2026-09-22: "an entire team section on the cockpit that the whole
 * team can see for team meetings and agendas, including what we're going to
 * cover in each meeting ... a doc and an agenda for each meeting ...
 * everybody can edit it ... We can look back on them in the next meeting
 * and make sure we're getting everything done, and every meeting has a
 * specific purpose."
 *
 * v5, 2026-09-27: the weekly meeting system. Each meeting has a timed run of
 * show, wheels (any meeting can have them), the creative pipeline on the
 * creative call, and its Google Calendar series edited from the page
 * (teamCalendar.ts; hermes/team-sync reads Google back every five minutes).
 *
 * The data is in Supabase (20260922b, 20260923d, 20260927d, 20260927e). An
 * agenda item belongs to the meeting, not to one sitting, and stays open
 * until somebody closes it, so the next meeting opens with what was not
 * finished. The run of show is the fixed part: the same blocks every
 * sitting, some only on one weekday.
 *
 * Who may do what. Everyone signed in to the portal reads every meeting and
 * edits agendas, the run of show, scenario options, the pipeline, the doc
 * and the notes, as in a shared document. Who is in a meeting, when it
 * meets, what it is for, its wheels and the week's goal are for its hosts,
 * admins and the CEO; prize wheels and their amounts for the CEO and
 * admins. Every write leaves a row in team_changes.
 */

/** Anyone with a seat in the portal: any cockpit, admin, or the CEO. */
export const who = internalQuery({
  args: { userId: v.id("users") },
  returns: v.any(),
  handler: async (ctx, { userId }): Promise<Who> => {
    const user = await ctx.db.get(userId);
    const a = await accessFor(ctx, user?.email, userId);
    if (!a.isCeo && !a.isAdmin && a.cockpits.length === 0)
      throw new Error(
        "Team meetings are for the team. Ask an admin to add you in the portal.",
      );
    return {
      email: a.email,
      name: (user?.name as string | undefined) ?? a.name ?? null,
      isCeo: a.isCeo,
      isAdmin: a.isAdmin,
    };
  },
});

// --- reads -------------------------------------------------------------------

export const overview = authenticatedAction({
  args: {},
  returns: v.any(),
  handler: (ctx): Promise<Overview> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      return overviewOf(w);
    }),
});

export const meeting = authenticatedAction({
  args: { id: v.string() },
  returns: v.any(),
  handler: (ctx, { id }): Promise<MeetingPage> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      return page(w, id);
    }),
});

/** The meeting a sitting belongs to, from its id ("<meeting>:<YYYY-MM-DD>"). */
function meetingOfSitting(sittingId: string): string {
  return sittingId.replace(/:\d{4}-\d{2}-\d{2}$/, "");
}

// --- the doc and the notes -----------------------------------------------------

type Saved =
  | { ok: true; page: MeetingPage }
  | {
      ok: false;
      conflict: {
        text: string;
        by: string | null;
        at: string | null;
        version: number;
      };
    };

/**
 * The meeting's living doc. A save carries the version it started from; if
 * somebody saved in between, nothing is overwritten and their version comes
 * back to choose from.
 */
export const saveDoc = authenticatedAction({
  args: { meetingId: v.string(), text: v.string(), version: v.number() },
  returns: v.any(),
  handler: (ctx, a): Promise<Saved> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      const text = String(a.text).slice(0, 60_000);
      const done = await db(
        `team_meetings?id=eq.${enc(a.meetingId)}&doc_version=eq.${Math.trunc(a.version)}`,
        {
          method: "PATCH",
          body: {
            doc: text,
            doc_by: w.email,
            doc_at: new Date().toISOString(),
            doc_version: Math.trunc(a.version) + 1,
          },
          prefer: "return=representation",
        },
      );
      if (!done.length) {
        const now = await meetingOrRefuse(
          a.meetingId,
          "doc,doc_by,doc_at,doc_version",
        );
        return {
          ok: false as const,
          conflict: {
            text: String(now.doc ?? ""),
            by: now.doc_by ?? null,
            at: now.doc_at ?? null,
            version: Number(now.doc_version ?? 0),
          },
        };
      }
      await logChange(w.email, a.meetingId, "edited the doc", {
        version: Math.trunc(a.version) + 1,
        length: text.length,
      });
      return { ok: true as const, page: await page(w, a.meetingId) };
    }),
});

/** Notes for one sitting: what was said. Same rule as the doc. */
export const saveNotes = authenticatedAction({
  args: { sittingId: v.string(), text: v.string(), version: v.number() },
  returns: v.any(),
  handler: (ctx, a): Promise<Saved> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      const sitting = await ensureSitting(
        meetingOfSitting(a.sittingId),
        a.sittingId,
      );
      const text = String(a.text).slice(0, 30_000);
      const done = await db(
        `team_sittings?id=eq.${enc(a.sittingId)}&notes_version=eq.${Math.trunc(a.version)}`,
        {
          method: "PATCH",
          body: {
            notes: text,
            notes_by: w.email,
            notes_at: new Date().toISOString(),
            notes_version: Math.trunc(a.version) + 1,
          },
          prefer: "return=representation",
        },
      );
      if (!done.length) {
        const [now] = await db(
          `team_sittings?select=notes,notes_by,notes_at,notes_version&id=eq.${enc(a.sittingId)}`,
        );
        return {
          ok: false as const,
          conflict: {
            text: String(now?.notes ?? ""),
            by: now?.notes_by ?? null,
            at: now?.notes_at ?? null,
            version: Number(now?.notes_version ?? 0),
          },
        };
      }
      await logChange(
        w.email,
        String(sitting.meeting_id),
        `wrote the notes for ${sitting.on_date}`,
      );
      return {
        ok: true as const,
        page: await page(w, String(sitting.meeting_id)),
      };
    }),
});

// --- the agenda ----------------------------------------------------------------

async function itemOrRefuse(id: number): Promise<SbRow> {
  const [item] = await db(`team_agenda?select=*&id=eq.${Math.trunc(id)}`);
  if (!item) throw new Error("That agenda item is not there any more.");
  return item;
}

export const addItem = authenticatedAction({
  args: {
    meetingId: v.string(),
    text: v.string(),
    ownerId: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, a): Promise<MeetingPage> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      const text = clean(a.text, 500);
      if (text.length < 3) throw new Error("Write the agenda item first.");
      await meetingOrRefuse(a.meetingId, "id");
      const [last] = await db(
        `team_agenda?select=position&meeting_id=eq.${enc(a.meetingId)}&status=eq.open&order=position.desc&limit=1`,
      );
      await db("team_agenda", {
        method: "POST",
        body: {
          meeting_id: a.meetingId,
          text,
          owner_id: a.ownerId || null,
          status: "open",
          position: Number(last?.position ?? 0) + 1,
          added_by: w.email,
        },
        prefer: "return=minimal",
      });
      await logChange(w.email, a.meetingId, `added "${text.slice(0, 80)}"`);
      return page(w, a.meetingId);
    }),
});

export const editItem = authenticatedAction({
  args: {
    id: v.number(),
    text: v.optional(v.string()),
    ownerId: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.any(),
  handler: (ctx, a): Promise<MeetingPage> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      const item = await itemOrRefuse(a.id);
      const body: Any = {};
      if (a.text !== undefined) {
        const text = clean(a.text, 500);
        if (text.length < 3) throw new Error("An agenda item needs words.");
        body.text = text;
      }
      if (a.ownerId !== undefined) body.owner_id = a.ownerId || null;
      if (!Object.keys(body).length) return page(w, String(item.meeting_id));
      await db(`team_agenda?id=eq.${Math.trunc(a.id)}`, {
        method: "PATCH",
        body,
        prefer: "return=minimal",
      });
      await logChange(
        w.email,
        String(item.meeting_id),
        body.text !== undefined
          ? `reworded "${String(item.text).slice(0, 60)}"`
          : `gave "${String(item.text).slice(0, 60)}" ${body.owner_id ? "an owner" : "no owner"}`,
      );
      return page(w, String(item.meeting_id));
    }),
});

/**
 * Close an item (done or dropped) or open it again. Closing stamps the
 * sitting it was closed in: the latest meeting on or before today, so the
 * next meeting can look back at what the last one finished.
 */
export const closeItem = authenticatedAction({
  args: {
    id: v.number(),
    status: v.union(v.literal("done"), v.literal("dropped"), v.literal("open")),
  },
  returns: v.any(),
  handler: (ctx, a): Promise<MeetingPage> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      const item = await itemOrRefuse(a.id);
      const meetingId = String(item.meeting_id);
      if (a.status === "open") {
        await db(`team_agenda?id=eq.${Math.trunc(a.id)}`, {
          method: "PATCH",
          body: {
            status: "open",
            sitting_id: null,
            closed_at: null,
            closed_by: null,
          },
          prefer: "return=minimal",
        });
        await logChange(
          w.email,
          meetingId,
          `reopened "${String(item.text).slice(0, 60)}"`,
        );
        return page(w, meetingId);
      }
      const today = kuwaitDay();
      const [at] = await db(
        `team_sittings?select=id&meeting_id=eq.${enc(meetingId)}&on_date=lte.${today}&status=neq.cancelled&order=on_date.desc&limit=1`,
      );
      await db(`team_agenda?id=eq.${Math.trunc(a.id)}`, {
        method: "PATCH",
        body: {
          status: a.status,
          sitting_id: at?.id ?? null,
          closed_at: new Date().toISOString(),
          closed_by: w.email,
        },
        prefer: "return=minimal",
      });
      await logChange(
        w.email,
        meetingId,
        `${a.status === "done" ? "finished" : "dropped"} "${String(item.text).slice(0, 60)}"`,
      );
      return page(w, meetingId);
    }),
});

/** Move an open item one place up or down the agenda. */
export const moveItem = authenticatedAction({
  args: { id: v.number(), dir: v.union(v.literal("up"), v.literal("down")) },
  returns: v.any(),
  handler: (ctx, a): Promise<MeetingPage> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      const item = await itemOrRefuse(a.id);
      const meetingId = String(item.meeting_id);
      const open = await db(
        `team_agenda?select=id,position&meeting_id=eq.${enc(meetingId)}&status=eq.open&order=position.asc,id.asc`,
      );
      const at = open.findIndex(o => Number(o.id) === Math.trunc(a.id));
      const to = a.dir === "up" ? at - 1 : at + 1;
      if (at < 0 || to < 0 || to >= open.length) return page(w, meetingId);
      const order = open.map(o => Number(o.id));
      [order[at], order[to]] = [order[to], order[at]];
      // Positions rewritten 1..n, so ties from older rows cannot stick.
      for (let i = 0; i < order.length; i++)
        await db(`team_agenda?id=eq.${order[i]}`, {
          method: "PATCH",
          body: { position: i + 1 },
          prefer: "return=minimal",
        });
      return page(w, meetingId);
    }),
});

// --- the run of show ------------------------------------------------------------

async function blockOrRefuse(id: number): Promise<SbRow> {
  const [b] = await db(`team_meeting_blocks?select=*&id=eq.${Math.trunc(id)}`);
  if (!b)
    throw new Error("That part of the run of show is not there any more.");
  return b;
}

function checkWeekday(d: number | null | undefined): number | null {
  if (d === null || d === undefined) return null;
  if (!Number.isInteger(d) || d < 0 || d > 6)
    throw new Error("Pick a day from Sunday to Saturday.");
  return d;
}

/** Add a block to the run of show, or change one. Anyone on the team may. */
export const saveBlock = authenticatedAction({
  args: {
    meetingId: v.string(),
    id: v.optional(v.number()),
    weekday: v.optional(v.union(v.number(), v.null())),
    minutes: v.optional(v.union(v.number(), v.null())),
    title: v.string(),
    detail: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.any(),
  handler: (ctx, a): Promise<MeetingPage> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      const title = clean(a.title, 200);
      if (!title) throw new Error("Give the block a title.");
      const detail =
        a.detail === undefined ? undefined : clean(a.detail, 1000) || null;
      const minutes =
        a.minutes === undefined || a.minutes === null
          ? a.minutes
          : Math.trunc(a.minutes);
      if (typeof minutes === "number" && (minutes < 0 || minutes > 480))
        throw new Error("A block runs between 0 and 480 minutes.");
      const weekday =
        a.weekday === undefined ? undefined : checkWeekday(a.weekday);
      const stamp = {
        updated_by: w.email,
        updated_at: new Date().toISOString(),
      };
      if (a.id !== undefined) {
        const b = await blockOrRefuse(a.id);
        if (String(b.meeting_id) !== a.meetingId)
          throw new Error("That block belongs to another meeting.");
        await db(`team_meeting_blocks?id=eq.${Math.trunc(a.id)}`, {
          method: "PATCH",
          body: {
            title,
            ...(detail !== undefined ? { detail } : {}),
            ...(minutes !== undefined ? { minutes } : {}),
            ...(weekday !== undefined ? { weekday } : {}),
            ...stamp,
          },
          prefer: "return=minimal",
        });
        await logChange(
          w.email,
          a.meetingId,
          `changed "${title.slice(0, 60)}" in the run of show`,
          {
            before: {
              title: b.title,
              minutes: b.minutes,
              detail: b.detail,
              weekday: b.weekday,
            },
          },
        );
        return page(w, a.meetingId);
      }
      await meetingOrRefuse(a.meetingId, "id");
      const [last] = await db(
        `team_meeting_blocks?select=position&meeting_id=eq.${enc(a.meetingId)}&order=position.desc&limit=1`,
      );
      await db("team_meeting_blocks", {
        method: "POST",
        body: {
          meeting_id: a.meetingId,
          weekday: weekday ?? null,
          position: Number(last?.position ?? 0) + 1,
          minutes: minutes ?? null,
          title,
          detail: detail ?? null,
          ...stamp,
        },
        prefer: "return=minimal",
      });
      await logChange(
        w.email,
        a.meetingId,
        `added "${title.slice(0, 60)}" to the run of show`,
      );
      return page(w, a.meetingId);
    }),
});

export const deleteBlock = authenticatedAction({
  args: { id: v.number() },
  returns: v.any(),
  handler: (ctx, a): Promise<MeetingPage> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      const b = await blockOrRefuse(a.id);
      await db(`team_meeting_blocks?id=eq.${Math.trunc(a.id)}`, {
        method: "DELETE",
        prefer: "return=minimal",
      });
      await logChange(
        w.email,
        String(b.meeting_id),
        `took "${String(b.title).slice(0, 60)}" out of the run of show`,
        {
          block: b,
        },
      );
      return page(w, String(b.meeting_id));
    }),
});

/**
 * Move a block one place up or down in the run of show as one day shows
 * it. The blocks of other days keep their places.
 */
export const moveBlock = authenticatedAction({
  args: {
    id: v.number(),
    dir: v.union(v.literal("up"), v.literal("down")),
    weekday: v.optional(v.union(v.number(), v.null())),
  },
  returns: v.any(),
  handler: (ctx, a): Promise<MeetingPage> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      const b = await blockOrRefuse(a.id);
      const meetingId = String(b.meeting_id);
      const all = (
        await db(
          `team_meeting_blocks?select=id,weekday,position&meeting_id=eq.${enc(meetingId)}`,
        )
      ).map(x => ({
        id: Number(x.id),
        weekday: x.weekday === null ? null : Number(x.weekday),
        position: Number(x.position ?? 0),
        minutes: null,
        title: "",
        detail: null,
      }));
      const global = [...all].sort(
        (x, y) => x.position - y.position || x.id - y.id,
      );
      const shown = blocksFor(all, checkWeekday(a.weekday ?? null));
      const at = shown.findIndex(x => x.id === Math.trunc(a.id));
      const to = a.dir === "up" ? at - 1 : at + 1;
      if (at < 0 || to < 0 || to >= shown.length) return page(w, meetingId);
      // Swap the two slots in the whole run of show, then number it 1..n.
      const i = global.findIndex(x => x.id === shown[at].id);
      const j = global.findIndex(x => x.id === shown[to].id);
      [global[i], global[j]] = [global[j], global[i]];
      for (let k = 0; k < global.length; k++)
        if (global[k].position !== k + 1)
          await db(`team_meeting_blocks?id=eq.${global[k].id}`, {
            method: "PATCH",
            body: { position: k + 1 },
            prefer: "return=minimal",
          });
      return page(w, meetingId);
    }),
});

// --- wheels ----------------------------------------------------------------------

async function wheelOrRefuse(id: string): Promise<SbRow> {
  const [wheel] = await db(`team_wheels?select=*&id=eq.${enc(id)}`);
  if (!wheel) throw new Error("That wheel is not there any more.");
  return wheel;
}

/** Scenario and name wheels are the meeting's hosts'; prize wheels the CEO's and admins'. */
async function mustEditWheel(
  w: Who,
  wheel: { kind: string; meeting_id: string | null },
): Promise<void> {
  if (wheel.kind === "prize") return mustBeBoss(w, "change prize wheels");
  if (wheel.meeting_id) return mustManage(w, wheel.meeting_id);
  mustBeBoss(w, "change a wheel with no meeting");
}

/** Add a wheel to any meeting, or rename, lock or switch one off. */
export const saveWheel = authenticatedAction({
  args: {
    meetingId: v.string(),
    id: v.optional(v.string()),
    name: v.string(),
    kind: v.optional(
      v.union(v.literal("scenario"), v.literal("person"), v.literal("prize")),
    ),
    lockedUntilGoal: v.optional(v.boolean()),
    active: v.optional(v.boolean()),
    sourceUrl: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.any(),
  handler: (ctx, a): Promise<MeetingPage> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      const name = clean(a.name, 80);
      if (name.length < 2) throw new Error("Give the wheel a name.");
      const sourceUrl =
        a.sourceUrl === undefined
          ? undefined
          : a.sourceUrl
            ? clean(a.sourceUrl, 300)
            : null;
      if (sourceUrl && !/^https:\/\//.test(sourceUrl))
        throw new Error("A source link starts with https://.");
      const stamp = {
        updated_by: w.email,
        updated_at: new Date().toISOString(),
      };
      if (a.id) {
        const wheel = await wheelOrRefuse(a.id);
        await mustEditWheel(
          w,
          wheel as { kind: string; meeting_id: string | null },
        );
        await db(`team_wheels?id=eq.${enc(a.id)}`, {
          method: "PATCH",
          body: {
            name,
            ...(a.lockedUntilGoal !== undefined && wheel.kind === "prize"
              ? { locked_until_goal: a.lockedUntilGoal }
              : {}),
            ...(a.active !== undefined ? { active: a.active } : {}),
            ...(sourceUrl !== undefined ? { source_url: sourceUrl } : {}),
            ...stamp,
          },
          prefer: "return=minimal",
        });
        await logChange(
          w.email,
          String(wheel.meeting_id ?? a.meetingId),
          `changed the ${name} wheel`,
          {
            before: {
              name: wheel.name,
              locked: wheel.locked_until_goal,
              active: wheel.active,
            },
          },
        );
        return page(w, String(wheel.meeting_id ?? a.meetingId));
      }
      const kind = a.kind ?? "scenario";
      await mustEditWheel(w, { kind, meeting_id: a.meetingId });
      await meetingOrRefuse(a.meetingId, "id");
      const base = slug(`${a.meetingId}-${name}`) || "wheel";
      const taken = new Set(
        (await db(`team_wheels?select=id&id=like.${enc(`${base}*`)}`)).map(r =>
          String(r.id),
        ),
      );
      let id = base;
      for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
      const [last] = await db(
        `team_wheels?select=position&meeting_id=eq.${enc(a.meetingId)}&order=position.desc&limit=1`,
      );
      await db("team_wheels", {
        method: "POST",
        body: {
          id,
          meeting_id: a.meetingId,
          name,
          kind,
          source_url: sourceUrl ?? null,
          locked_until_goal:
            kind === "prize" ? (a.lockedUntilGoal ?? true) : false,
          active: true,
          position: Number(last?.position ?? 0) + 1,
          ...stamp,
        },
        prefer: "return=minimal",
      });
      await logChange(w.email, a.meetingId, `added the ${name} wheel`, {
        wheel: id,
        kind,
      });
      return page(w, a.meetingId);
    }),
});

export const deleteWheel = authenticatedAction({
  args: { id: v.string() },
  returns: v.any(),
  handler: (ctx, a): Promise<MeetingPage> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      const wheel = await wheelOrRefuse(a.id);
      await mustEditWheel(
        w,
        wheel as { kind: string; meeting_id: string | null },
      );
      const options = await db(
        `team_wheel_options?select=label,amount,currency,amount_suffix,condition&wheel_id=eq.${enc(a.id)}`,
      );
      await db(`team_wheels?id=eq.${enc(a.id)}`, {
        method: "DELETE",
        prefer: "return=minimal",
      });
      // The spins it made stay in the sittings' notes.
      await logChange(
        w.email,
        wheel.meeting_id ?? null,
        `deleted the ${wheel.name} wheel`,
        { wheel, options },
      );
      return page(w, String(wheel.meeting_id ?? ""));
    }),
});

async function optionOrRefuse(
  id: number,
): Promise<{ option: SbRow; wheel: SbRow }> {
  const [option] = await db(
    `team_wheel_options?select=*&id=eq.${Math.trunc(id)}`,
  );
  if (!option) throw new Error("That option is not there any more.");
  return { option, wheel: await wheelOrRefuse(String(option.wheel_id)) };
}

/** Anyone on the team edits a scenario; a prize is the CEO's and admins'. */
function mustEditOption(w: Who, wheel: SbRow): void {
  if (wheel.kind === "prize") mustBeBoss(w, "change prizes");
}

function cents(amount: number): number {
  if (!Number.isFinite(amount) || amount < 0)
    throw new Error("An amount is a number of zero or more.");
  const c = Math.round(amount * 100);
  if (Math.abs(c - amount * 100) > 1e-6)
    throw new Error("An amount has at most two decimals.");
  return c / 100;
}

export const saveWheelOption = authenticatedAction({
  args: {
    wheelId: v.string(),
    id: v.optional(v.number()),
    label: v.string(),
    condition: v.optional(v.union(v.string(), v.null())),
    amount: v.optional(v.union(v.number(), v.null())),
    currency: v.optional(v.union(v.string(), v.null())),
    suffix: v.optional(v.union(v.string(), v.null())),
    active: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: (ctx, a): Promise<MeetingPage> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      const wheel = await wheelOrRefuse(a.wheelId);
      mustEditOption(w, wheel);
      if (wheel.kind === "person")
        throw new Error(
          "A name wheel fills itself from the people in the sitting.",
        );
      const label = clean(a.label, 200);
      if (!label) throw new Error("An option needs words.");
      const body: Any = {
        label,
        ...(a.condition !== undefined
          ? { condition: a.condition ? clean(a.condition, 200) : null }
          : {}),
        ...(a.amount !== undefined
          ? { amount: a.amount === null ? null : cents(a.amount) }
          : {}),
        ...(a.currency !== undefined
          ? { currency: a.currency ? clean(a.currency, 8).toUpperCase() : null }
          : {}),
        ...(a.suffix !== undefined
          ? { amount_suffix: a.suffix ? clean(a.suffix, 8) : null }
          : {}),
        ...(a.active !== undefined ? { active: a.active } : {}),
        updated_by: w.email,
        updated_at: new Date().toISOString(),
      };
      const meetingId = String(wheel.meeting_id ?? "");
      if (a.id !== undefined) {
        const { option } = await optionOrRefuse(a.id);
        if (option.wheel_id !== a.wheelId)
          throw new Error("That option is on another wheel.");
        await db(`team_wheel_options?id=eq.${Math.trunc(a.id)}`, {
          method: "PATCH",
          body,
          prefer: "return=minimal",
        });
        await logChange(
          w.email,
          meetingId || null,
          `changed "${renderOption(option as never)}" on the ${wheel.name} wheel`,
          {
            before: option,
          },
        );
      } else {
        const [last] = await db(
          `team_wheel_options?select=position&wheel_id=eq.${enc(a.wheelId)}&order=position.desc&limit=1`,
        );
        await db("team_wheel_options", {
          method: "POST",
          body: {
            wheel_id: a.wheelId,
            active: true,
            position: Number(last?.position ?? 0) + 1,
            ...body,
          },
          prefer: "return=minimal",
        });
        await logChange(
          w.email,
          meetingId || null,
          `added "${label}" to the ${wheel.name} wheel`,
        );
      }
      return page(w, meetingId);
    }),
});

export const deleteWheelOption = authenticatedAction({
  args: { id: v.number() },
  returns: v.any(),
  handler: (ctx, a): Promise<MeetingPage> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      const { option, wheel } = await optionOrRefuse(a.id);
      mustEditOption(w, wheel);
      await db(`team_wheel_options?id=eq.${Math.trunc(a.id)}`, {
        method: "DELETE",
        prefer: "return=minimal",
      });
      await logChange(
        w.email,
        wheel.meeting_id ?? null,
        `took "${option.label}" off the ${wheel.name} wheel`,
        {
          option,
        },
      );
      return page(w, String(wheel.meeting_id ?? ""));
    }),
});

export const moveWheelOption = authenticatedAction({
  args: { id: v.number(), dir: v.union(v.literal("up"), v.literal("down")) },
  returns: v.any(),
  handler: (ctx, a): Promise<MeetingPage> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      const { wheel } = await optionOrRefuse(a.id);
      mustEditOption(w, wheel);
      const rows = await db(
        `team_wheel_options?select=id,position&wheel_id=eq.${enc(String(wheel.id))}&order=position.asc,id.asc`,
      );
      const at = rows.findIndex(r => Number(r.id) === Math.trunc(a.id));
      const to = a.dir === "up" ? at - 1 : at + 1;
      if (at >= 0 && to >= 0 && to < rows.length) {
        const order = rows.map(r => Number(r.id));
        [order[at], order[to]] = [order[to], order[at]];
        for (let i = 0; i < order.length; i++)
          await db(`team_wheel_options?id=eq.${order[i]}`, {
            method: "PATCH",
            body: { position: i + 1 },
            prefer: "return=minimal",
          });
      }
      return page(w, String(wheel.meeting_id ?? ""));
    }),
});

/** A prize's number. The CEO and admins set it; the sentence around it stays. */
export const setPrizeAmount = authenticatedAction({
  args: {
    optionId: v.number(),
    amount: v.number(),
    meetingId: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, a): Promise<MeetingPage | Overview> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      mustBeBoss(w, "set prize amounts");
      const { option, wheel } = await optionOrRefuse(a.optionId);
      if (wheel.kind !== "prize")
        throw new Error("Only a prize has an amount to set.");
      const amount = cents(a.amount);
      await db(`team_wheel_options?id=eq.${Math.trunc(a.optionId)}`, {
        method: "PATCH",
        body: {
          amount,
          updated_by: w.email,
          updated_at: new Date().toISOString(),
        },
        prefer: "return=minimal",
      });
      const face = {
        label: String(option.label),
        currency: option.currency ?? null,
        amount_suffix: option.amount_suffix ?? null,
      };
      const before = renderOption({
        ...face,
        amount: option.amount === null ? null : Number(option.amount),
      });
      const after = renderOption({ ...face, amount });
      await logChange(
        w.email,
        wheel.meeting_id ?? null,
        `set the ${wheel.name} prize "${before}" to "${after}"`,
        {
          option: option.id,
          before: option.amount,
          after: amount,
        },
      );
      return a.meetingId ? page(w, a.meetingId) : overviewOf(w);
    }),
});

/**
 * Spin a wheel for a sitting. The server picks, with crypto random over the
 * active options (or the people in the sitting for a name wheel); the
 * screen only shows the wheel landing where the server said. The result
 * goes into the sitting's notes ("Spun <wheel>: <result>") with the notes'
 * version, so nobody's typing is overwritten, and into the spin log with
 * the label as it read that day.
 */
export const spin = authenticatedAction({
  args: {
    wheelId: v.string(),
    sittingId: v.string(),
    among: v.optional(v.array(v.string())),
    forPerson: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (
    ctx,
    a,
  ): Promise<{
    page: MeetingPage;
    result: {
      wheelId: string;
      index: number;
      label: string;
      choices: string[];
    };
  }> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      const wheel = await wheelOrRefuse(a.wheelId);
      const meetingId = String(wheel.meeting_id ?? "");
      if (!meetingId) throw new Error("That wheel is not on a meeting.");
      if (meetingOfSitting(a.sittingId) !== meetingId)
        throw new Error("That sitting is another meeting's.");
      const sitting = await ensureSitting(meetingId, a.sittingId);
      let choices: { id: number | null; label: string }[] = [];
      if (wheel.kind === "person") {
        const links = await db(
          `team_meeting_people?select=person_id&meeting_id=eq.${enc(meetingId)}&removed=eq.false`,
        );
        const ids = links
          .map(l => String(l.person_id))
          .filter(id => !a.among || a.among.includes(id));
        const people = ids.length
          ? await db(
              `team_people?select=id,name&id=in.(${ids.map(id => `"${id.replace(/"/g, "")}"`).join(",")})`,
            )
          : [];
        choices = ids
          .map(id => people.find(p => p.id === id))
          .filter((p): p is SbRow => Boolean(p))
          .map(p => ({ id: null, label: String(p.name) }));
      } else {
        const options = await db(
          `team_wheel_options?select=*&wheel_id=eq.${enc(a.wheelId)}&active=eq.true&order=position.asc,id.asc`,
        );
        choices = options.map(o => ({
          id: Number(o.id),
          label: renderOption(o as never),
        }));
      }
      const refusal = spinRefusal(
        {
          kind: String(wheel.kind),
          locked_until_goal: Boolean(wheel.locked_until_goal),
          active: wheel.active !== false,
          name: String(wheel.name),
        },
        { goal_hit: sitting.goal_hit ?? null },
        choices.length,
      );
      if (refusal) throw new Error(refusal);
      const index = pickIndex(
        choices.length,
        () => crypto.getRandomValues(new Uint32Array(1))[0],
      );
      const won = choices[index];
      let forName: string | null = null;
      if (a.forPerson) {
        const [p] = await db(
          `team_people?select=name&id=eq.${enc(a.forPerson)}`,
        );
        forName = p ? String(p.name) : null;
      }
      await appendWithVersion(
        async () => {
          const [s] = await db(
            `team_sittings?select=notes,notes_version&id=eq.${enc(a.sittingId)}`,
          );
          return {
            notes: String(s?.notes ?? ""),
            version: Number(s?.notes_version ?? 0),
          };
        },
        async (notes, version) =>
          (
            await db(
              `team_sittings?id=eq.${enc(a.sittingId)}&notes_version=eq.${version}`,
              {
                method: "PATCH",
                body: {
                  notes,
                  notes_by: w.email,
                  notes_at: new Date().toISOString(),
                  notes_version: version + 1,
                },
                prefer: "return=representation",
              },
            )
          ).length > 0,
        spinLine(String(wheel.name), won.label, forName),
      );
      await db("team_wheel_spins", {
        method: "POST",
        body: {
          wheel_id: a.wheelId,
          sitting_id: a.sittingId,
          option_id: won.id,
          result_label: won.label,
          spun_by: w.email,
          spun_for: forName,
        },
        prefer: "return=minimal",
      });
      await logChange(
        w.email,
        meetingId,
        `spun the ${wheel.name} wheel: ${won.label}`,
        {
          sitting: a.sittingId,
        },
      );
      return {
        page: await page(w, meetingId),
        result: {
          wheelId: a.wheelId,
          index,
          label: won.label,
          choices: choices.map(c => c.label),
        },
      };
    }),
});

/** Whether the week's goal was hit, on a sitting: it unlocks an earned prize wheel. */
export const setGoalHit = authenticatedAction({
  args: { sittingId: v.string(), hit: v.union(v.boolean(), v.null()) },
  returns: v.any(),
  handler: (ctx, a): Promise<MeetingPage> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      const meetingId = meetingOfSitting(a.sittingId);
      await mustManage(w, meetingId);
      const s = await ensureSitting(meetingId, a.sittingId);
      await db(`team_sittings?id=eq.${enc(a.sittingId)}`, {
        method: "PATCH",
        body: { goal_hit: a.hit },
        prefer: "return=minimal",
      });
      await logChange(
        w.email,
        meetingId,
        a.hit === null
          ? `cleared the goal for ${s.on_date}`
          : `marked the week's goal ${a.hit ? "hit" : "missed"} on ${s.on_date}`,
      );
      return page(w, meetingId);
    }),
});

// --- the creative pipeline ---------------------------------------------------------

const KINDS = ["new", "refresh", "edit"] as const;
const SOURCES = [
  "slow_client_call",
  "creative_request",
  "fatigue",
  "other",
] as const;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function day(value: string | null | undefined, what: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (!DAY.test(value)) throw new Error(`Pick a date for ${what}.`);
  return value;
}

/**
 * A video on the pipeline. Anyone on the team adds and edits rows; moving a
 * due date that already passed, for a step not yet done, is a slip, counted
 * here and never typed.
 */
export const saveCreativeRow = authenticatedAction({
  args: {
    meetingId: v.string(),
    id: v.optional(v.number()),
    client: v.string(),
    angle: v.optional(v.union(v.string(), v.null())),
    kind: v.optional(v.union(v.string(), v.null())),
    source: v.optional(v.union(v.string(), v.null())),
    creativeRequestId: v.optional(v.union(v.string(), v.null())),
    scriptDue: v.optional(v.union(v.string(), v.null())),
    footageDue: v.optional(v.union(v.string(), v.null())),
    editDue: v.optional(v.union(v.string(), v.null())),
    approvedOn: v.optional(v.union(v.string(), v.null())),
    launchOn: v.optional(v.union(v.string(), v.null())),
    launchedOn: v.optional(v.union(v.string(), v.null())),
    status: v.optional(v.string()),
    ownerId: v.optional(v.union(v.string(), v.null())),
    notes: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.any(),
  handler: (ctx, a): Promise<MeetingPage> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      const client = clean(a.client, 120);
      if (!client) throw new Error("Name the client the video is for.");
      if (a.kind && !(KINDS as readonly string[]).includes(a.kind))
        throw new Error("Pick new, refresh or edit.");
      if (a.source && !(SOURCES as readonly string[]).includes(a.source))
        throw new Error("Pick where the video came from.");
      if (a.status && !(STAGES as readonly string[]).includes(a.status))
        throw new Error("Pick a status from the list.");
      const today = kuwaitDay();
      const body: Any = { client };
      const set = (key: string, value: unknown) => {
        if (value !== undefined) body[key] = value;
      };
      set(
        "angle",
        a.angle === undefined
          ? undefined
          : a.angle
            ? clean(a.angle, 200)
            : null,
      );
      set("kind", a.kind === undefined ? undefined : a.kind || null);
      set("source", a.source === undefined ? undefined : a.source || null);
      set(
        "creative_request_id",
        a.creativeRequestId === undefined
          ? undefined
          : a.creativeRequestId || null,
      );
      set(
        "script_due",
        a.scriptDue === undefined ? undefined : day(a.scriptDue, "the script"),
      );
      set(
        "footage_due",
        a.footageDue === undefined
          ? undefined
          : day(a.footageDue, "the footage"),
      );
      set(
        "edit_due",
        a.editDue === undefined ? undefined : day(a.editDue, "the first cut"),
      );
      set(
        "approved_on",
        a.approvedOn === undefined
          ? undefined
          : day(a.approvedOn, "the approval"),
      );
      set(
        "launch_on",
        a.launchOn === undefined ? undefined : day(a.launchOn, "the launch"),
      );
      set(
        "launched_on",
        a.launchedOn === undefined
          ? undefined
          : day(a.launchedOn, "the launch"),
      );
      set("status", a.status);
      set("owner_id", a.ownerId === undefined ? undefined : a.ownerId || null);
      set(
        "notes",
        a.notes === undefined
          ? undefined
          : a.notes
            ? String(a.notes).slice(0, 2000)
            : null,
      );
      if (body.status === "launched" && body.launched_on === undefined)
        body.launched_on = today;
      if (body.status === "approved" && body.approved_on === undefined)
        body.approved_on = today;
      body.updated_by = w.email;
      body.updated_at = new Date().toISOString();
      if (a.id !== undefined) {
        const [before] = await db(
          `team_creative_rows?select=*&id=eq.${Math.trunc(a.id)}`,
        );
        if (!before)
          throw new Error("That row is not on the pipeline any more.");
        const after = { ...before, ...body };
        const slips = slipsAdded(before as never, after as never, today);
        if (slips) body.slip_count = Number(before.slip_count ?? 0) + slips;
        if (
          body.launched_on === undefined &&
          before.status !== "launched" &&
          body.status === "launched"
        )
          body.launched_on = today;
        await db(`team_creative_rows?id=eq.${Math.trunc(a.id)}`, {
          method: "PATCH",
          body,
          prefer: "return=minimal",
        });
        await logChange(
          w.email,
          a.meetingId,
          slips
            ? `moved a passed date on ${client}'s video: slip ${body.slip_count}`
            : `updated ${client}'s video on the pipeline`,
          { before, after: body },
        );
        return page(w, a.meetingId);
      }
      await db("team_creative_rows", {
        method: "POST",
        body: {
          ...body,
          status: body.status ?? "planned",
          created_by: w.email,
        },
        prefer: "return=minimal",
      });
      await logChange(
        w.email,
        a.meetingId,
        `added a ${body.kind ?? "new"} video for ${client} to the pipeline`,
      );
      return page(w, a.meetingId);
    }),
});

export const deleteCreativeRow = authenticatedAction({
  args: { meetingId: v.string(), id: v.number() },
  returns: v.any(),
  handler: (ctx, a): Promise<MeetingPage> =>
    noted(ctx, async () => {
      const w: Who = await ctx.runQuery(internal.team.who, {
        userId: ctx.userId,
      });
      const [row] = await db(
        `team_creative_rows?select=*&id=eq.${Math.trunc(a.id)}`,
      );
      if (!row) throw new Error("That row is not on the pipeline any more.");
      await db(`team_creative_rows?id=eq.${Math.trunc(a.id)}`, {
        method: "DELETE",
        prefer: "return=minimal",
      });
      await logChange(
        w.email,
        a.meetingId,
        `took ${row.client}'s video off the pipeline`,
        { row },
      );
      return page(w, a.meetingId);
    }),
});

/** Open creative requests from the cockpit that are not on the pipeline yet. */
export const openCreativeRequests = authenticatedAction({
  args: {},
  returns: v.any(),
  handler: ctx =>
    noted(ctx, async () => {
      await ctx.runQuery(internal.team.who, { userId: ctx.userId });
      const [requests, rows] = await Promise.all([
        db(
          "cockpit_creative_requests?select=id,client_name,campaign_name,request_reason,note,status,created_at&status=in.(requested,script_ready,editing,asset_ready)&order=created_at.desc&limit=60",
        ),
        db(
          "team_creative_rows?select=creative_request_id&creative_request_id=not.is.null",
        ),
      ]);
      const onBoard = new Set(rows.map(r => String(r.creative_request_id)));
      return requests
        .filter(r => !onBoard.has(String(r.id)))
        .map(r => ({
          id: String(r.id),
          client: String(r.client_name ?? r.campaign_name ?? "Client"),
          campaign: r.campaign_name ?? null,
          reason: r.request_reason ?? null,
          note: r.note ?? null,
          status: String(r.status),
          createdAt: String(r.created_at).slice(0, 10),
        }));
    }),
});
