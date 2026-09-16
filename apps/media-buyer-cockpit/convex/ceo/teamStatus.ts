import { ConvexError, v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { authenticatedMutation, authenticatedQuery } from "../functions";
import { requireCeo } from "./gate";
import type { TeamPayload } from "./payloads";
import { maskText, personLabelFromKey } from "./teamRules";
import { addDays } from "./time";
import {
  assertKuwaitDay,
  assertPersonKey,
  auditTrail,
  type CeoMutationCtx,
  ceoWrite,
  cleanText,
  type TeamStatus,
  vTeamStatus,
  writerLabel,
} from "./writeGuard";

/**
 * The Management team switch (2026-09-16): Aziz marks a person paused or left
 * (on leave, fired) and back to active. Convex only, CEO only, audited; see
 * convex/ceo/writeGuard.ts. The team adapter reads ceoTeamStatus and the
 * audit trail, so a paused or left person owes no EOD from `since` on and
 * leaves every EOD count.
 */

/** The earliest start date a status may carry. */
const FIRST_DAY = "2025-01-01";
/** A pause or a leave may be set this many days ahead. */
const DAYS_AHEAD = 31;
/** The screen caps the note at 300 characters; anything far longer is not a typed note. */
const NOTE_MAX = 300;
/** Longer than any "<role>:<first>" key the adapter builds. */
const KEY_MAX = 80;

const STATUS_WORD: Record<TeamStatus, string> = {
  active: "active",
  paused: "paused",
  left: "left",
};

/**
 * Plain Errors lose their message on a production deployment ("Server
 * Error"), so a refusal is passed on as a ConvexError carrying its sentence.
 * Throwing still rolls the whole write back.
 */
function asConvexError(e: unknown): unknown {
  if (e instanceof ConvexError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  return new ConvexError(msg || "The change could not be saved.");
}

/** "Nada (Media buyer)" from the stored team payload, or from the key. */
async function personLabel(
  ctx: CeoMutationCtx,
  personKey: string,
): Promise<{ label: string; known: boolean }> {
  const section = await ctx.db
    .query("ceoSections")
    .withIndex("by_key", q => q.eq("key", "team"))
    .first();
  const payload = (section?.payload ?? null) as TeamPayload | null;
  const person = [
    ...(payload?.people ?? []),
    ...(payload?.inactive ?? []),
  ].find(p => p.key === personKey);
  return person
    ? { label: `${person.name} (${person.role})`, known: true }
    : { label: personLabelFromKey(personKey), known: false };
}

const statusText = (row: Pick<Doc<"ceoTeamStatus">, "status" | "since">) =>
  `${STATUS_WORD[row.status]} from ${row.since}`;

/**
 * Set one person's status. Upserts the person's ceoTeamStatus row, leaves a
 * `teamStatus.set` audit entry with the row before and after, and recomputes
 * the team section. Setting what is already there changes nothing and says so.
 */
export const set = authenticatedMutation({
  args: {
    personKey: v.string(),
    status: vTeamStatus,
    since: v.string(),
    note: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, a) => {
    try {
      return await ceoWrite(ctx, async w => {
        if (a.personKey.length > KEY_MAX)
          throw new Error("That is not a Management person key.");
        if ((a.note ?? "").length > NOTE_MAX * 2)
          throw new Error(
            `The note is too long. Keep it to ${NOTE_MAX} characters.`,
          );
        const personKey = assertPersonKey(a.personKey.trim());
        // A return to active cannot be dated ahead: the person would read as
        // paused until then with no way to see it.
        const since = assertKuwaitDay(a.since.trim(), "The start date", {
          notBefore: FIRST_DAY,
          notAfter: a.status === "active" ? w.day : addDays(w.day, DAYS_AHEAD),
        });
        const row = await ctx.db
          .query("ceoTeamStatus")
          .withIndex("by_person", q => q.eq("personKey", personKey))
          .first();
        // The screen only ever sees a note with emails and numbers masked, so
        // a note sent back unchanged keeps the original instead of storing
        // the mask over it.
        const typed = cleanText(a.note, NOTE_MAX);
        const note =
          row?.note && typed === maskText(row.note, NOTE_MAX)
            ? row.note
            : typed;
        const who = await personLabel(ctx, personKey);
        // Only people the Management tab lists (or already has a status
        // for) can be switched, so a typo never creates a phantom person.
        if (!who.known && !row)
          throw new Error(
            `${personKey} is not on the Management list. Refresh the page and try again.`,
          );

        const noChange = row
          ? row.status === a.status &&
            row.since === since &&
            (row.note ?? undefined) === note
          : a.status === "active";
        if (noChange)
          return {
            result: null,
            audit: {
              action: "teamStatus.set",
              table: "ceoTeamStatus",
              rowId: personKey,
              what: row
                ? `No change: ${who.label} is already ${statusText(row)}`
                : `No change: ${who.label} is already active`,
            },
          };

        const next = {
          personKey,
          status: a.status,
          since,
          ...(note ? { note } : {}),
          setBy: w.by,
          setAt: w.at,
        };
        if (row) await ctx.db.replace(row._id, next);
        else await ctx.db.insert("ceoTeamStatus", next);

        const verb =
          a.status === "active" && row && row.status !== "active"
            ? `Marked ${who.label} as active again from ${since}`
            : `Marked ${who.label} as ${statusText({ status: a.status, since })}`;
        const was = row
          ? row.status === a.status && row.since === since
            ? ", note changed"
            : ` (was ${statusText(row)})`
          : " (was active)";
        const noted = note ? `. Note: ${maskText(note, 200)}` : "";
        return {
          result: null,
          audit: {
            action: "teamStatus.set",
            table: "ceoTeamStatus",
            rowId: personKey,
            what: `${verb}${was}${noted}`,
            before: row ?? undefined,
            after: next,
          },
          refresh: ["team"],
        };
      });
    } catch (e) {
      throw asConvexError(e);
    }
  },
});

const vStatusRow = v.object({
  personKey: v.string(),
  status: vTeamStatus,
  since: v.string(),
  note: v.union(v.string(), v.null()),
  setAt: v.number(),
  /** A name, never an email. */
  setBy: v.string(),
});

/**
 * Every status row, live, for the Management tab. The tab lays these over the
 * stored team payload so a switch shows the moment it is saved, before the
 * team section is recomputed.
 */
export const list = authenticatedQuery({
  args: {},
  returns: v.array(vStatusRow),
  handler: async ctx => {
    await requireCeo(ctx);
    const rows = await ctx.db.query("ceoTeamStatus").take(500);
    return rows.map(r => ({
      personKey: r.personKey,
      status: r.status,
      since: r.since,
      note: r.note ? maskText(r.note) : null,
      setAt: r.setAt,
      setBy: writerLabel(r.setBy),
    }));
  },
});

/** One person's status changes, newest first, at most 20. */
export const history = authenticatedQuery({
  args: { personKey: v.string() },
  returns: v.array(
    v.object({
      action: v.string(),
      table: v.string(),
      rowId: v.string(),
      what: v.string(),
      by: v.string(),
      at: v.number(),
    }),
  ),
  handler: async (ctx, { personKey }) => {
    await requireCeo(ctx);
    if (personKey.length > KEY_MAX) return [];
    const key = assertPersonKey(personKey.trim());
    const rows = await auditTrail(ctx, {
      table: "ceoTeamStatus",
      rowId: key,
      limit: 20,
    });
    return rows.map(r => ({ ...r, what: maskText(r.what, 400) }));
  },
});
