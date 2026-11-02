// bun test supabase/functions/sales-api/inbox.test.ts
import { expect, test } from "bun:test";
import { assignRefusal, makeInbox } from "./inbox.ts";
import { channelOf, dmWindow, dndFor, lastInboundOn, sendBody, toThread } from "./lib.ts";

const rep = { signed_in: true, seat: true, ghl_user_id: "me" };
const manager = { signed_in: true, seat: true, manager: true, ghl_user_id: "boss" };

test("a rep takes an unassigned lead or lets go of their own; a manager moves anyone's", () => {
  expect(assignRefusal(rep, null, "me")).toBeNull();
  expect(assignRefusal(rep, "me", null)).toBeNull();
  expect(assignRefusal(rep, "other", "me")).toContain("someone else's");
  expect(assignRefusal(rep, null, "other")).toContain("Only a manager");
  expect(assignRefusal(rep, "other", null)).toContain("someone else's");
  expect(assignRefusal({ ...rep, ghl_user_id: null }, null, "me")).toContain("not linked");
  expect(assignRefusal(manager, "other", "me")).toBeNull();
  expect(assignRefusal(manager, "me", null)).toBeNull();
});

test("Instagram and Facebook DMs are channels, comments are not", () => {
  expect(channelOf("TYPE_INSTAGRAM")).toBe("instagram");
  expect(channelOf("TYPE_FACEBOOK")).toBe("facebook");
  expect(channelOf("TYPE_INSTAGRAM_COMMENT")).toBe("other");
  expect(sendBody("instagram", "c", "hi")).toEqual({ type: "IG", contactId: "c", message: "hi" });
  expect(sendBody("facebook", "c", "hi")).toEqual({ type: "FB", contactId: "c", message: "hi" });
  expect(sendBody("whatsapp", "c", "hi").type).toBe("WhatsApp");
});

test("a DM takes a reply for seven days after the lead's own last DM", () => {
  const now = Date.parse("2026-10-29T12:00:00Z");
  const thread = toThread(
    [
      { id: "1", direction: "inbound", messageType: "TYPE_INSTAGRAM", dateAdded: "2026-10-25T12:00:00Z", body: "hi" },
      { id: "2", direction: "outbound", messageType: "TYPE_INSTAGRAM", dateAdded: "2026-10-28T12:00:00Z", body: "hello" },
      { id: "3", direction: "inbound", messageType: "TYPE_WHATSAPP", dateAdded: "2026-10-29T11:00:00Z", body: "x" },
    ],
    "v",
  );
  const last = lastInboundOn(thread, "instagram");
  expect(last).toBe("2026-10-25T12:00:00.000Z");
  expect(dmWindow(last, now).open).toBe(true);
  expect(dmWindow("2026-10-21T12:00:00Z", now).open).toBe(false);
  expect(dmWindow(null, now)).toEqual({ open: false, closes_at: null, last_inbound_at: null });
  expect(lastInboundOn(thread, "facebook")).toBeNull();
});

test("the WA2 Connector's SMS is marked a copy in the thread", () => {
  const [copy, real] = toThread(
    [
      { id: "a", direction: "outbound", messageType: "TYPE_CUSTOM_SMS", conversationProviderId: "67c822224c79561add263440", from: "WA2 Connector", dateAdded: "2026-10-29T11:19:35Z", body: "x" },
      { id: "b", direction: "outbound", messageType: "TYPE_WHATSAPP", from: "+965 9005 4963", dateAdded: "2026-10-29T11:19:34Z", body: "x" },
    ],
    "v",
  );
  expect(copy.copy).toBe(true);
  expect(real.copy).toBe(false);
});

test("do not disturb on Facebook covers Instagram and Facebook replies", () => {
  const c = { dndSettings: { FB: { status: "active" } } };
  expect(dndFor(c, "facebook")).toBe(true);
  expect(dndFor(c, "instagram")).toBe(true);
  expect(dndFor(c, "whatsapp")).toBe(false);
});

test("No reply needed marks the conversation and undo clears it, each audited", async () => {
  const rows: Record<string, Record<string, unknown>> = {
    v1: { conversation_id: "v1", contact_id: "c1", needs_reply: true, cleared_at: null, cleared_by: null, last_in_at: "2026-10-29T10:00:00Z" },
    v2: { conversation_id: "v2", contact_id: "c2", needs_reply: false, cleared_at: null, cleared_by: null, last_in_at: null },
  };
  const audits: string[] = [];
  const svc = async (path: string, init?: { method?: string; body?: unknown }) => {
    const id = /conversation_id=eq\.([^&]+)/.exec(path)?.[1] ?? "";
    const r = rows[id];
    if (!r) return [];
    if (init?.method === "PATCH") {
      Object.assign(r, init.body as object);
      r.needs_reply = r.cleared_at === null || String(r.cleared_at) < String(r.last_in_at);
    }
    return [{ ...r }];
  };
  const { actions } = makeInbox({ svc, ghl: async () => ({}), audit: async (_w, a) => void audits.push(a) });
  const who = { signed_in: true, seat: true, email: "rep@x.com" };
  // A message newer than the one on the rep's screen is refused.
  await expect(actions["inbox.done"](who, { conversation_id: "v1", seen_in_at: "2026-10-29T09:00:00Z" })).rejects.toThrow("wrote again");
  expect(await actions["inbox.done"](who, { conversation_id: "v1", seen_in_at: "2026-10-29T10:00:00Z" })).toMatchObject({ cleared: true, needs_reply: false });
  expect(rows.v1.cleared_by).toBe("rep@x.com");
  // The mark is the lead's message time, so a later message brings it back.
  expect(rows.v1.cleared_at).toBe("2026-10-29T10:00:00Z");
  expect(await actions["inbox.done"](who, { conversation_id: "v1", undo: true })).toMatchObject({ cleared: false, needs_reply: true });
  expect(await actions["inbox.done"](who, { conversation_id: "v2" })).toMatchObject({ unchanged: true });
  expect(audits).toEqual(["inbox.done", "inbox.undone"]);
  await expect(actions["inbox.done"](who, { conversation_id: "nope" })).rejects.toThrow("not in the cockpit");
});
