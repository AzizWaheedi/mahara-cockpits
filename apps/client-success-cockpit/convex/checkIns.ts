import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
import {
  type CallKind,
  callOf,
  createCheckIn,
  findContact,
  ghlRequest,
  ProviderError,
  prepareCheckIn,
  stageAfterBooking,
  verifySelection,
} from "./checkInCore";
import { authenticatedAction } from "./functions";
import { allowedClients, assertRole } from "./roles";

declare const process: { env: Record<string, string | undefined> };
const request = () =>
  ghlRequest(
    process.env.GHL_MAHARA_PIT ?? "",
    process.env.GHL_MAHARA_LOCATION ?? "",
  );
const identityArgs = { userId: v.id("users"), taskId: v.string() };
/** Which call: onboarding, blueprint, launch or checkin (the default, as before 2026-10-06). */
const kindArg = v.optional(
  v.union(
    v.literal("onboarding"),
    v.literal("blueprint"),
    v.literal("launch"),
    v.literal("checkin"),
  ),
);
/**
 * A receipt's key. Check-ins keep the key they had before other calls could
 * be booked, so a receipt written then still guards its slot.
 */
const bookingKey = (taskId: string, startTime: string, kind: CallKind) =>
  kind === "checkin"
    ? `${taskId}|${startTime}`
    : `${taskId}|${kind}|${startTime}`;

async function authorizedClient(
  ctx: QueryCtx,
  a: { userId: Id<"users">; taskId: string },
) {
  const auth = { ...ctx, userId: a.userId };
  await assertRole(auth);
  const user = await ctx.db.get(a.userId);
  const member = user?.email
    ? await ctx.db
        .query("portalMembers")
        .withIndex("by_email", q =>
          q.eq("email", user.email!.trim().toLowerCase()),
        )
        .unique()
    : null;
  if (member?.revokedAt) throw new Error("Your cockpit access has ended.");
  const client = await ctx.db
    .query("clients")
    .withIndex("by_taskId", q => q.eq("taskId", a.taskId))
    .unique();
  const scope = await allowedClients(auth);
  if (!client || (scope && !scope.has(client.name.toLowerCase())))
    throw new Error("That client is not on your list.");
  return client;
}

export const clientContext = internalQuery({
  args: {
    ...identityArgs,
    startTime: v.optional(v.string()),
    kind: kindArg,
  },
  handler: async (ctx, a) => {
    const c = await authorizedClient(ctx, a);
    const previous = a.startTime
      ? await ctx.db
          .query("checkInBookings")
          .withIndex("by_key", q =>
            q.eq(
              "key",
              bookingKey(a.taskId, a.startTime!, a.kind ?? "checkin"),
            ),
          )
          .unique()
      : null;
    return { name: c.name, taskId: c.taskId, stage: c.stage, previous };
  },
});

async function plainly<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw new ConvexError({
      message:
        error instanceof Error
          ? error.message
          : "Booking could not be completed.",
    });
  }
}

export const prepare = authenticatedAction({
  args: { taskId: v.string(), day: v.string(), kind: kindArg },
  handler: async (
    ctx,
    a,
  ): Promise<Awaited<ReturnType<typeof prepareCheckIn>>> =>
    plainly(async () => {
      await ctx.runQuery(internal.checkIns.clientContext, {
        userId: ctx.userId,
        taskId: a.taskId,
      });
      return prepareCheckIn(
        request(),
        a.taskId,
        a.day,
        Date.now(),
        a.kind ?? "checkin",
      );
    }),
});

/**
 * The client's main contact in the Mahara Media client account: the one
 * contact whose Client ID is this card (Aziz, 2026-10-06: "link their main
 * contact on the GoHighLevel Mahara client account to the cockpit").
 */
export const contact = authenticatedAction({
  args: { taskId: v.string() },
  handler: async (ctx, a): Promise<Awaited<ReturnType<typeof findContact>>> =>
    plainly(async () => {
      await ctx.runQuery(internal.checkIns.clientContext, {
        userId: ctx.userId,
        taskId: a.taskId,
      });
      return findContact(request(), a.taskId);
    }),
});

export const claim = internalMutation({
  args: {
    ...identityArgs,
    startTime: v.string(),
    contactId: v.string(),
    kind: kindArg,
  },
  handler: async (ctx, a) => {
    const c = await authorizedClient(ctx, a);
    const key = bookingKey(a.taskId, a.startTime, a.kind ?? "checkin");
    const row = await ctx.db
      .query("checkInBookings")
      .withIndex("by_key", q => q.eq("key", key))
      .unique();
    if (row && row.status !== "failed")
      return {
        id: row._id,
        existing: true,
        status: row.status,
        appointmentId: row.appointmentId,
      };
    const value = {
      key,
      taskId: a.taskId,
      clientName: c.name,
      contactId: a.contactId,
      startTime: a.startTime,
      kind: a.kind ?? "checkin",
      userId: a.userId,
      status: "pending",
      updatedAt: Date.now(),
    };
    if (row) await ctx.db.patch(row._id, value);
    const id = row?._id ?? (await ctx.db.insert("checkInBookings", value));
    return { id, existing: false, status: "pending", appointmentId: undefined };
  },
});

export const markUncertain = internalMutation({
  args: {
    id: v.id("checkInBookings"),
    definitive: v.boolean(),
    appointmentId: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const row = await ctx.db.get(a.id);
    if (row && row.status !== "confirmed")
      await ctx.db.patch(a.id, {
        status: a.definitive ? "failed" : "unknown",
        updatedAt: Date.now(),
        ...(a.appointmentId ? { appointmentId: a.appointmentId } : {}),
      });
  },
});

export const finish = internalMutation({
  args: {
    id: v.id("checkInBookings"),
    appointmentId: v.string(),
    calendarName: v.string(),
  },
  handler: async (ctx, a) => {
    const booking = await ctx.db.get(a.id);
    if (!booking || booking.status === "confirmed") return;
    const client = await ctx.db
      .query("clients")
      .withIndex("by_taskId", q => q.eq("taskId", booking.taskId))
      .unique();
    const call = callOf(booking.kind);
    const day = new Date(Date.parse(booking.startTime) + 3 * 3600_000)
      .toISOString()
      .slice(0, 10);
    await ctx.db.patch(a.id, {
      status: "confirmed",
      appointmentId: a.appointmentId,
      updatedAt: Date.now(),
    });
    const existing = await ctx.db
      .query("appointments")
      .withIndex("by_apptId", q => q.eq("apptId", a.appointmentId))
      .unique();
    if (!existing)
      await ctx.db.insert("appointments", {
        apptId: a.appointmentId,
        calendar: a.calendarName,
        title: `${booking.clientName} | ${call.label}`,
        kind: call.kind,
        startTime: booking.startTime,
        day,
        status: "confirmed",
        clientName: booking.clientName,
      });
    // Do not replace an earlier upcoming call with a later booking.
    if (
      client &&
      (!client.nextCallAt ||
        Date.parse(client.nextCallAt) <= Date.now() ||
        Date.parse(booking.startTime) < Date.parse(client.nextCallAt))
    ) {
      await ctx.db.patch(client._id, {
        nextPoc: day,
        nextCallAt: booking.startTime,
        nextCallKind: call.kind,
      });
      await ctx.db.insert("outbox", {
        kind: "booked",
        clientTaskId: booking.taskId,
        clientName: booking.clientName,
        action: `${call.label} booked`,
        evidence: `GoHighLevel appointment ${a.appointmentId}`,
        value: day,
        createdAt: Date.now(),
      });
    }
    // A booked onboarding, Blueprint or launch call moves the board forward,
    // never back: the same stage write the CSM's "Update the board" makes.
    const stage = client ? stageAfterBooking(client.stage, call.kind) : null;
    if (client && stage) {
      await ctx.db.patch(client._id, { stage });
      await ctx.db.insert("outbox", {
        kind: "stage",
        clientTaskId: booking.taskId,
        clientName: booking.clientName,
        action: `Moved to ${stage}`,
        evidence: `${call.label} booked, GoHighLevel appointment ${a.appointmentId}`,
        value: stage,
        createdAt: Date.now(),
      });
    }
    const user = await ctx.db.get(booking.userId);
    await ctx.db.insert("usage", {
      email: user?.email ?? "unknown",
      role: "csm",
      event:
        call.kind === "checkin"
          ? "client_check_in_booked"
          : `client_${call.kind}_call_booked`,
      detail: `${booking.taskId}: ${a.appointmentId} at ${booking.startTime}`,
      at: Date.now(),
    });
  },
});

export const book = authenticatedAction({
  args: {
    taskId: v.string(),
    contactId: v.string(),
    startTime: v.string(),
    kind: kindArg,
  },
  handler: async (
    ctx,
    a,
  ): Promise<{
    appointmentId: string;
    startTime: string;
    stage?: string | null;
  }> =>
    plainly(async () => {
      const start = Date.parse(a.startTime);
      if (!Number.isFinite(start)) throw new Error("Choose an available time.");
      const startTime = new Date(start).toISOString();
      const kind = callOf(a.kind).kind;
      const client = await ctx.runQuery(internal.checkIns.clientContext, {
        userId: ctx.userId,
        taskId: a.taskId,
        startTime,
        kind,
      });
      const stage = stageAfterBooking(client.stage, kind);
      // A confirmed slot is no longer free. Return its receipt before checking availability.
      if (client.previous && client.previous.status !== "failed") {
        if (
          client.previous.status === "confirmed" &&
          client.previous.appointmentId
        )
          return { appointmentId: client.previous.appointmentId, startTime };
        throw new Error(
          "A booking for this client and time is already being checked. Check the Mahara Media calendar before trying again.",
        );
      }
      const api = request();
      const selection = await verifySelection(
        api,
        a.taskId,
        a.contactId,
        a.startTime,
        Date.now(),
        kind,
      );
      const claimed = await ctx.runMutation(internal.checkIns.claim, {
        userId: ctx.userId,
        taskId: a.taskId,
        contactId: selection.contact.id,
        startTime: selection.startTime,
        kind,
      });
      if (claimed.existing) {
        if (claimed.status === "confirmed" && claimed.appointmentId)
          return {
            appointmentId: claimed.appointmentId,
            startTime: selection.startTime,
          };
        throw new Error(
          "A booking for this client and time is already being checked. Check the Mahara Media calendar before trying again.",
        );
      }
      let appointmentId: string | undefined;
      try {
        // The final provider request validates availability again; never override a busy slot.
        const receipt = await createCheckIn(api, selection, client.name);
        appointmentId = receipt.appointmentId;
        await ctx.runMutation(internal.checkIns.finish, {
          id: claimed.id,
          appointmentId,
          calendarName: selection.calendar.name,
        });
        return {
          appointmentId,
          startTime: selection.startTime,
          // Only when the board moves, so a check-in's receipt reads as before.
          ...(stage ? { stage } : {}),
        };
      } catch (error) {
        await ctx.runMutation(internal.checkIns.markUncertain, {
          id: claimed.id,
          definitive:
            error instanceof ProviderError &&
            error.definitive &&
            !appointmentId,
          ...(appointmentId ? { appointmentId } : {}),
        });
        throw new Error(
          appointmentId
            ? "The call was booked, but the cockpit update needs checking. Do not book it again."
            : error instanceof Error
              ? error.message
              : "Check the calendar before trying again.",
        );
      }
    }),
});
