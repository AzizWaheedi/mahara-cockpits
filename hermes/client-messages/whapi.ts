/**
 * WhatsApp, Client Data and the ClickUp card for the client messages sender
 * (docs/forms/STAGE2B-CONTRACT.md 4.3, 3b; Z26, Z59). It reuses the ad-billing
 * guard's proven Transport, imported read only: its `json()` for every call,
 * its `sheet()` (the read-only Client Data credential) and its `task()`. It
 * never calls the guard's `send()`, which appends a reference line to the
 * client's message: the send here is its own `sendText`, exactly `{to, body}`
 * with the approved text byte for byte.
 *
 * The send is one fetch with `read` false, so Transport.json never loops it
 * (with `read` true it retries 429, 5xx and timeouts, which would post a
 * second WhatsApp to a client's group). It counts as sent only on a 2xx with
 * `sent === true` and a string `message.id`; a 5xx, 408, 429, a timeout, a
 * network break, an unreadable answer or any other 2xx is `unknown` (a person
 * looks in the group; it is never sent again); another 4xx is `failed`.
 *
 * A send the ledger stopped before it left (its intent receipt could not be
 * written, or the time ran out while it was written) is `failed`, not
 * `unknown`: nothing reached WhatsApp, so nobody needs to look in the group.
 * Transport.json turns every error into ProviderError(0), so the send's own
 * fetcher notes the ledger's NotSent before Transport can wrap it.
 */
import { ProviderError, Transport } from "../ad-billing-guard/transport.ts";
import { GROUP_JID, last4 } from "./core.ts";
import { NotSent } from "./ledger.ts";

export const SEND_URL = "https://gate.whapi.cloud/messages/text";
const LIST_URL = "https://gate.whapi.cloud/messages/list";
const HEALTH_URL = "https://gate.whapi.cloud/health?wakeup=false";
/** Reads page by 100 up to 500 messages. */
export const LIST_PAGE = 100;
export const LIST_MAX = 500;

export type Env = Record<string, string | undefined>;
export type SendOutcome =
  | { state: "sent"; providerId: string; status: number }
  | { state: "unknown"; reason: string; status: number | null }
  | { state: "failed"; reason: string; status: number };
export type WaMessage = {
  id: string;
  fromMe: boolean;
  from: string | null;
  body: string;
  at: number | null;
};

export const NOT_CONFIRMED =
  "WhatsApp did not confirm the send. Look in the group before anything else; it is never sent again.";
/** The ledger stopped the send before it left: nothing reached WhatsApp. */
export const NOT_LEFT =
  "The send could not be recorded first, so nothing was sent. Press Try again.";

const str = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * One WhatsApp message as the list returns it, kept to what the sender reads.
 * A message we sent through Whapi that holds a URL comes back as `type:
 * link_preview`, with no `text` and no top-level `body`: its whole text is in
 * `link_preview.body` (read from real payloads on the VPS, 2026-10-30). Every
 * recap ends with the booking link, so every recap reads back this way.
 */
export function readMessage(v: unknown): WaMessage | null {
  const m = v as Record<string, any> | null;
  if (!m || typeof m !== "object" || typeof m.id !== "string") return null;
  const body = str(m.text?.body) || str(m.link_preview?.body) || str(m.body);
  const at =
    typeof m.timestamp === "number" ? m.timestamp : Number(m.timestamp) || null;
  return {
    id: m.id,
    fromMe: m.from_me === true,
    from: typeof m.from === "string" ? m.from : null,
    body,
    at,
  };
}

export function makeWhapi(env: Env, fetcher: typeof fetch) {
  const transport = new Transport(env, fetcher);
  const auth = () => ({
    Authorization: `Bearer ${transport.needed("AD_BILLING_WHAPI_TOKEN")}`,
  });

  /** The one POST: the stored text to one client group, once. */
  async function sendText(group: string, body: string): Promise<SendOutcome> {
    if (!GROUP_JID.test(group))
      return {
        state: "failed",
        reason: "Only a client group can receive a recap.",
        status: 0,
      };
    // The send's own Transport: its fetcher notes a ledger stop (NotSent) before
    // Transport.json wraps every error into ProviderError(0), which reads as unknown.
    let notLeft: NotSent | null = null;
    const once = new Transport(env, (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      try {
        return await fetcher(input, init);
      } catch (e) {
        if (e instanceof NotSent) notLeft = e;
        throw e;
      }
    }) as typeof fetch);
    let result: any;
    try {
      result = await once.json(
        "Whapi",
        SEND_URL,
        {
          method: "POST",
          headers: { ...auth(), "Content-Type": "application/json" },
          body: JSON.stringify({ to: group, body }),
        },
        false,
      );
    } catch (e) {
      // Never left (the ledger stopped it before the request): failed, so it can be tried again.
      if (notLeft) return { state: "failed", reason: NOT_LEFT, status: 0 };
      if (e instanceof ProviderError) {
        const s = e.status;
        if (s === 0 || s >= 500 || s === 408 || s === 429)
          return { state: "unknown", reason: NOT_CONFIRMED, status: s || null };
        return {
          state: "failed",
          reason: `WhatsApp refused the recap (${s}). Nothing was sent.`,
          status: s,
        };
      }
      // A missing token or anything before the request left: nothing was sent.
      if (e instanceof Error && /^Missing configuration/.test(e.message)) {
        return {
          state: "failed",
          reason:
            "The WhatsApp token is not set up, so nothing was sent. Tell the tech lead.",
          status: 0,
        };
      }
      return { state: "unknown", reason: NOT_CONFIRMED, status: null };
    }
    if (
      result?.sent === true &&
      typeof result?.message?.id === "string" &&
      result.message.id
    ) {
      return { state: "sent", providerId: result.message.id, status: 200 };
    }
    return { state: "unknown", reason: NOT_CONFIRMED, status: 200 };
  }

  /** A group's messages since a time (epoch seconds), paged by offset to 500. Reads may retry. */
  async function listMessages(
    group: string,
    sinceEpoch: number,
    untilEpoch?: number,
  ): Promise<WaMessage[]> {
    if (!GROUP_JID.test(group))
      throw new Error("Only a client group can be read.");
    const out: WaMessage[] = [];
    for (let offset = 0; offset < LIST_MAX; offset += LIST_PAGE) {
      const q = new URLSearchParams({
        count: String(LIST_PAGE),
        offset: String(offset),
        time_from: String(Math.floor(sinceEpoch)),
      });
      if (untilEpoch !== undefined)
        q.set("time_to", String(Math.floor(untilEpoch)));
      const page = await transport.json(
        "Whapi",
        `${LIST_URL}/${group}?${q}`,
        { headers: auth() },
        true,
      );
      const items: unknown[] = Array.isArray(page?.messages)
        ? page.messages
        : [];
      for (const item of items) {
        const m = readMessage(item);
        if (m) out.push(m);
      }
      if (items.length < LIST_PAGE) break;
    }
    return out;
  }

  /** The channel's health; the number only as its last four digits. */
  async function health(): Promise<{
    status: string | null;
    channelLast4: string | null;
  }> {
    const h = await transport.json(
      "Whapi",
      HEALTH_URL,
      { headers: auth() },
      true,
    );
    const status =
      typeof h?.status?.text === "string"
        ? h.status.text
        : typeof h?.status === "string"
          ? h.status
          : null;
    return { status, channelLast4: last4(h?.user?.id ?? h?.phone) };
  }

  return {
    transport,
    sendText,
    listMessages,
    health,
    /** Client Data, through the guard's read-only credential. */
    sheet: () => transport.sheet(),
    /** One ClickUp card, read only. */
    task: (id: string) => transport.task(id),
  };
}
export type Whapi = ReturnType<typeof makeWhapi>;
