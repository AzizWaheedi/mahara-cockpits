/** Client-only WhatsApp inbox. Service-role credentials stay behind server-owned access checks. */
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { CLIENT_ID_FIELD, ghlRequest } from "./checkInCore";
import { authenticatedAction } from "./functions";

declare const process: { env: Record<string, string | undefined> };
type Row = Record<string, any>;
type Seat = {
  email: string;
  isAdmin: boolean;
  clients: { taskId: string; name: string }[];
};
const enc = encodeURIComponent;
const norm = (s: unknown) => String(s ?? "").trim();
const location = () => process.env.GHL_MAHARA_LOCATION ?? "";
const request = () =>
  ghlRequest(process.env.GHL_MAHARA_PIT ?? "", location(), "messages");
const plain = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (e) {
    throw new ConvexError({
      message:
        e instanceof Error ? e.message : "The inbox could not be loaded.",
    });
  }
};
async function rest(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<Row[]> {
  const url = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("The client inbox connection is not configured.");
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    signal: AbortSignal.timeout(15000),
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok)
    throw new Error(
      `The client inbox did not respond (${res.status}). Try refreshing it.`,
    );
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}
function checkDesk(desk: string) {
  if (desk !== "csm")
    throw new Error("This cockpit can only open client success conversations.");
  if (!location())
    throw new Error("The client account connection is not configured.");
}
function visible(t: Row, seat: Seat) {
  return (
    t.desk === "csm" &&
    t.location_id === location() &&
    seat.clients.some(c => c.taskId === norm(t.client_task_id))
  );
}
async function thread(threadId: string, desk: string, seat: Seat) {
  checkDesk(desk);
  const rows = await rest(`wa_threads?select=*&id=eq.${enc(threadId)}&limit=1`);
  if (!rows[0] || !visible(rows[0], seat))
    throw new Error("That conversation is not linked to one of your clients.");
  return rows[0];
}
export const inbox = authenticatedAction({
  args: { desk: v.string(), includeAnswered: v.optional(v.boolean()) },
  returns: v.any(),
  handler: async (ctx, a): Promise<any> =>
    plain(async () => {
      const seat: Seat = await ctx.runQuery(internal.roles.actionSeat, {
        userId: ctx.userId,
      });
      checkDesk(a.desk);
      if (!seat.clients.length) return { threads: [] };
      const ids = seat.clients
        .map(c => `"${c.taskId.replace(/["\\]/g, "")}"`)
        .join(",");
      const found = await rest(
        `wa_threads?select=*&archived=is.false&desk=eq.csm&location_id=eq.${enc(location())}&client_task_id=in.(${enc(ids)})&order=last_inbound_at.desc.nullslast&limit=60${a.includeAnswered ? "" : "&awaiting_us=is.true"}`,
      );
      const threads = found.filter(t => visible(t, seat));
      if (!threads.length) return { threads: [] };
      const threadIds = enc(
        threads.map(t => `"${norm(t.id).replace(/["\\]/g, "")}"`).join(","),
      );
      const [drafts, messages] = await Promise.all([
        rest(`wa_drafts?select=*&thread_id=in.(${threadIds})`),
        rest(
          `wa_messages?select=thread_id,direction,body,kind,speaker,at&thread_id=in.(${threadIds})&order=at.desc&limit=400`,
        ),
      ]);
      return {
        threads: threads.map(t => ({
          ...t,
          client_name: seat.clients.find(c => c.taskId === t.client_task_id)
            ?.name,
          draft: drafts.find(d => d.thread_id === t.id) ?? null,
          messages: messages
            .filter(m => m.thread_id === t.id)
            .slice(0, 6)
            .reverse(),
        })),
      };
    }),
});
export const assign = authenticatedAction({
  args: { threadId: v.string(), desk: v.string() },
  returns: v.any(),
  handler: async (ctx, a): Promise<any> =>
    plain(async () => {
      const seat: Seat = await ctx.runQuery(internal.roles.actionSeat, {
        userId: ctx.userId,
      });
      if (!seat.isAdmin)
        throw new Error(
          "Only an admin can move a conversation to another team.",
        );
      await thread(a.threadId, "csm", seat);
      if (!["csm", "ads", "creative"].includes(a.desk))
        throw new Error("Choose a team from the list.");
      await rest(`wa_threads?id=eq.${enc(a.threadId)}`, "PATCH", {
        desk: a.desk,
        updated_at: new Date().toISOString(),
      });
      return { desk: a.desk };
    }),
});
export const archive = authenticatedAction({
  args: { threadId: v.string(), desk: v.string() },
  returns: v.any(),
  handler: async (ctx, a): Promise<any> =>
    plain(async () => {
      const seat: Seat = await ctx.runQuery(internal.roles.actionSeat, {
        userId: ctx.userId,
      });
      await thread(a.threadId, a.desk, seat);
      await rest(`wa_threads?id=eq.${enc(a.threadId)}`, "PATCH", {
        archived: true,
        updated_at: new Date().toISOString(),
      });
      return { archived: true };
    }),
});

// One reply per inbound message. An uncertain result never starts another provider send.
export const claim = internalMutation({
  args: { key: v.string(), fingerprint: v.string() },
  handler: async (ctx, a) => {
    const old = await ctx.db
      .query("actionReceipts")
      .withIndex("by_key", q => q.eq("key", a.key))
      .unique();
    if (old) {
      if (old.fingerprint !== a.fingerprint)
        throw new Error(
          "A reply is already recorded for this incoming message. Check the CRM before replying again.",
        );
      return {
        id: old._id,
        existing: true,
        status: old.status,
        receipt: old.receipt,
      };
    }
    const id = await ctx.db.insert("actionReceipts", {
      ...a,
      status: "pending",
      at: Date.now(),
    });
    return { id, existing: false, status: "pending", receipt: undefined };
  },
});
export const settle = internalMutation({
  args: {
    id: v.id("actionReceipts"),
    status: v.string(),
    receipt: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    await ctx.db.patch(a.id, {
      status: a.status,
      receipt: a.receipt,
      at: Date.now(),
    });
  },
});
export const send = authenticatedAction({
  args: {
    threadId: v.string(),
    desk: v.string(),
    body: v.string(),
    lang: v.string(),
    type: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, a): Promise<any> =>
    plain(async () => {
      const seat: Seat = await ctx.runQuery(internal.roles.actionSeat, {
        userId: ctx.userId,
      });
      const t = await thread(a.threadId, a.desk, seat);
      const body = a.body.trim();
      if (!body || body.length > 4000)
        throw new Error("Write a reply under 4,000 characters.");
      if (!["ar", "en"].includes(a.lang) || (a.type && a.type !== "SMS"))
        throw new Error("Choose Arabic or English for this WhatsApp reply.");
      if (!t.contact_id || !t.last_inbound_at)
        throw new Error("Refresh the conversation before replying.");
      const ghl = request();
      const got = await ghl("GET", `/contacts/${enc(t.contact_id)}`);
      const contact = got.contact;
      if (
        contact?.id !== t.contact_id ||
        contact?.locationId !== location() ||
        !contact?.customFields?.some(
          (f: Row) =>
            f.id === CLIENT_ID_FIELD && norm(f.value) === t.client_task_id,
        )
      )
        throw new Error(
          "The contact's Client ID needs checking before you can reply.",
        );
      const claim = await ctx.runMutation(internal.wa.claim, {
        key: `wa|${a.threadId}|${t.last_inbound_at}`,
        fingerprint: JSON.stringify({ by: seat.email, body, lang: a.lang }),
      });
      if (claim.existing)
        return {
          sent: claim.status === "sent",
          status: claim.status,
          messageId: claim.receipt,
          duplicate: true,
        };
      let messageId: string | undefined;
      try {
        const made = await ghl("POST", "/conversations/messages", {
          type: "SMS",
          contactId: t.contact_id,
          message: body,
        });
        messageId = norm(made.messageId) || undefined;
        if (!messageId) throw new Error("No message receipt returned.");
        // Accepted is not delivered. A bounded status read can confirm a send, or leave it for reconciliation.
        const checked = await ghl(
          "GET",
          `/conversations/messages/${enc(messageId)}`,
        ).catch(() => null);
        const status = ["sent", "delivered", "read"].includes(
          checked?.message?.status,
        )
          ? "sent"
          : ["failed", "undelivered", "rejected"].includes(
                checked?.message?.status,
              )
            ? "failed"
            : "accepted";
        await ctx.runMutation(internal.wa.settle, {
          id: claim.id,
          status,
          receipt: messageId,
        });
        if (status !== "failed") {
          const at = new Date().toISOString();
          // Reconciliation can repair these display fields without sending again.
          await rest(`wa_drafts?thread_id=eq.${enc(a.threadId)}`, "PATCH", {
            sent_at: status === "sent" ? at : null,
            sent_by: seat.email,
            sent_lang: a.lang,
            sent_body: body,
          }).catch(() => undefined);
          await rest(
            `wa_threads?id=eq.${enc(a.threadId)}&last_inbound_at=eq.${enc(t.last_inbound_at)}`,
            "PATCH",
            { awaiting_us: false, last_outbound_at: at, updated_at: at },
          ).catch(() => undefined);
        }
        return { sent: status === "sent", status, messageId };
      } catch {
        await ctx.runMutation(internal.wa.settle, {
          id: claim.id,
          status: "unknown",
          ...(messageId ? { receipt: messageId } : {}),
        });
        throw new Error(
          "The send result needs checking in the CRM. Do not send it again.",
        );
      }
    }),
});
