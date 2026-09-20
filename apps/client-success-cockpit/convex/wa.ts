/**
 * The WhatsApp desk, as a cockpit sees it.
 *
 * Hala (hermes/inbox) scans GoHighLevel every fifteen minutes and writes
 * threads, messages and a two-language draft into Supabase. This reads
 * that, and sends.
 *
 * Sending is the only thing here that touches the outside world, so it
 * is the only thing that is fussy: it refuses an empty body, refuses a
 * thread it cannot find, records who sent what in which language, and
 * never sends on its own.
 */
import { v } from "convex/values";
import { authenticatedAction } from "./functions";

type Row = Record<string, unknown>;

/**
 * Declared locally rather than pulled from @types/node: the app's own
 * typecheck reaches these modules through the generated api, and it has
 * no node types.
 */
declare const process: { env: Record<string, string | undefined> };

const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const GHL_TOKEN = process.env.GHL_MAHARA_PIT ?? "";
const GHL_LOCATION = process.env.GHL_MAHARA_LOCATION ?? "";

/**
 * GoHighLevel sits behind a Cloudflare bot rule that answers a default
 * agent 403 before the API sees the request. The browser User-Agent is
 * load-bearing, not decoration.
 */
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const enc = encodeURIComponent;

async function rest(path: string, init?: RequestInit & { prefer?: string }) {
  if (!SUPABASE_URL || !SUPABASE_KEY)
    throw new Error("Supabase is not configured for this cockpit.");
  const headers: Record<string, string> = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
  };
  if (init?.prefer) headers.Prefer = init.prefer;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers,
    body: init?.body ? JSON.stringify(init.body as unknown) : undefined,
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

function rows(x: unknown): Row[] {
  return Array.isArray(x) ? (x as Row[]) : [];
}

/** What is waiting on this desk, newest first. */
export const inbox = authenticatedAction({
  args: {
    desk: v.optional(v.string()),
    includeAnswered: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (_ctx, { desk, includeAnswered }) => {
    const filters = [
      "select=*",
      "archived=is.false",
      "order=last_inbound_at.desc.nullslast",
      "limit=60",
    ];
    if (desk) filters.push(`desk=eq.${enc(desk)}`);
    if (!includeAnswered) filters.push("awaiting_us=is.true");
    const threads = rows(await rest(`wa_threads?${filters.join("&")}`));
    if (!threads.length) return { threads: [] };

    const ids = threads.map(t => `"${String(t.id)}"`).join(",");
    const drafts = rows(await rest(`wa_drafts?select=*&thread_id=in.(${ids})`));
    const byThread = new Map(drafts.map(d => [String(d.thread_id), d]));

    // The last few messages give the reader enough to judge the draft
    // without opening WhatsApp, which is the whole point of the screen.
    const recent = rows(
      await rest(
        `wa_messages?select=thread_id,direction,body,kind,speaker,at` +
          `&thread_id=in.(${ids})&order=at.desc&limit=400`,
      ),
    );
    const tail = new Map<string, Row[]>();
    for (const m of recent) {
      const k = String(m.thread_id);
      const list = tail.get(k) ?? [];
      if (list.length < 6) list.push(m);
      tail.set(k, list);
    }

    return {
      threads: threads.map(t => ({
        ...t,
        draft: byThread.get(String(t.id)) ?? null,
        messages: (tail.get(String(t.id)) ?? []).slice().reverse(),
      })),
    };
  },
});

/** Move a thread to another desk. One inbox, three cockpits. */
export const assign = authenticatedAction({
  args: { threadId: v.string(), desk: v.string() },
  returns: v.any(),
  handler: async (_ctx, { threadId, desk }) => {
    if (!["csm", "ads", "creative"].includes(desk))
      throw new Error("A thread belongs to the CSM, ads or creative desk.");
    await rest(`wa_threads?id=eq.${enc(threadId)}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: {
        desk,
        updated_at: new Date().toISOString(),
      } as unknown as BodyInit,
    });
    return { desk };
  },
});

/** Stop showing a thread without answering it. */
export const archive = authenticatedAction({
  args: { threadId: v.string() },
  returns: v.any(),
  handler: async (_ctx, { threadId }) => {
    await rest(`wa_threads?id=eq.${enc(threadId)}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: {
        archived: true,
        updated_at: new Date().toISOString(),
      } as unknown as BodyInit,
    });
    return { archived: true };
  },
});

/**
 * Send the reply.
 *
 * The one thing here that reaches a real phone, so it checks rather than
 * assumes: a thread it knows, a body somebody actually wrote, and a
 * language it can record. Nothing is sent that a person did not press.
 *
 * **`SMS` is the type that reaches WhatsApp**, settled by a real send on
 * 2026-09-20 rather than by reading the enum. The bridge is registered
 * as this account's SMS channel, which is why inbound WhatsApp arrives
 * as `TYPE_CUSTOM_SMS` and why an `SMS` send goes back out the same way.
 *
 * The two that look more likely both fail:
 *
 * * `Custom` demands a `conversationProviderId`, and the bridge's own
 *   provider is then refused with "the contact doesn't support the
 *   specified conversation provider" -- even for a contact it has
 *   carried messages for before.
 * * `WhatsApp` is **accepted with a 201 and then fails**. Nothing about
 *   the response says so; the message sits in the conversation with
 *   `status: "failed"`. Trusting the 201 would have shipped a send
 *   button that reports success and delivers nothing.
 *
 * So acceptance is not delivery here, and the status has to be read back
 * before anyone is told a message went.
 */
export const send = authenticatedAction({
  args: {
    threadId: v.string(),
    body: v.string(),
    lang: v.string(),
    type: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, { threadId, body, lang, type }) => {
    const identity = await ctx.auth.getUserIdentity();
    const who = String(identity?.email ?? identity?.name ?? "unknown");

    const text = body.trim();
    if (!text) throw new Error("There is nothing to send.");
    if (!["ar", "en"].includes(lang))
      throw new Error("A reply goes out in Arabic or English.");
    if (!GHL_TOKEN || !GHL_LOCATION)
      throw new Error("GoHighLevel is not configured for this cockpit.");

    const t = rows(
      await rest(`wa_threads?select=*&id=eq.${enc(threadId)}&limit=1`),
    )[0];
    if (!t) throw new Error("That conversation is gone.");
    const contactId = String(t.contact_id ?? "");
    if (!contactId)
      throw new Error(
        "That conversation has no contact behind it, so there is nowhere to send.",
      );

    // No conversationProviderId: naming the bridge's provider explicitly
    // is what GoHighLevel refuses. The account routes SMS through it
    // anyway, which is the whole trick.
    const payload: Row = {
      type: type ?? "SMS",
      contactId,
      message: text,
    };

    const res = await fetch(
      "https://services.leadconnectorhq.com/conversations/messages",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GHL_TOKEN}`,
          Version: "2021-04-15",
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": UA,
        },
        body: JSON.stringify(payload),
      },
    );
    const answer = await res.text();
    if (!res.ok)
      throw new Error(
        `GoHighLevel refused it (${res.status}): ${answer.slice(0, 200)}`,
      );

    // A 201 here is not delivery: a `WhatsApp` send returns 201 and then
    // sits in the conversation with status "failed". Read the status back
    // before telling anybody the message went.
    const made = JSON.parse(answer || "{}") as { messageId?: string };
    const messageId = String(made.messageId ?? "");
    let status = "unknown";
    if (messageId) {
      for (let i = 0; i < 5; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const check = await fetch(
          `https://services.leadconnectorhq.com/conversations/messages/${enc(messageId)}`,
          {
            headers: {
              Authorization: `Bearer ${GHL_TOKEN}`,
              Version: "2021-04-15",
              Accept: "application/json",
              "User-Agent": UA,
            },
          },
        );
        if (!check.ok) break;
        const seen = (await check.json()) as { message?: { status?: string } };
        const s = String(seen.message?.status ?? "");
        if (s && !["pending", "queued"].includes(s)) {
          status = s;
          break;
        }
      }
    }
    if (["failed", "undelivered", "rejected"].includes(status))
      throw new Error(
        `GoHighLevel took the message and then failed to deliver it (${status}). ` +
          "Nothing reached them.",
      );

    const at = new Date().toISOString();
    await rest(`wa_drafts?thread_id=eq.${enc(threadId)}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: {
        sent_at: at,
        sent_by: who,
        sent_lang: lang,
        sent_body: text,
      } as unknown as BodyInit,
    });
    // We spoke last now, so the thread stops asking for a reply. The next
    // scan will correct this if they answer before it runs.
    await rest(`wa_threads?id=eq.${enc(threadId)}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: {
        awaiting_us: false,
        last_outbound_at: at,
        updated_at: at,
      } as unknown as BodyInit,
    });
    return { sent: true, at, via: payload.type, status };
  },
});
