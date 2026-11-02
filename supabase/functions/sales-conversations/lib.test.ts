// bun test supabase/functions/sales-conversations
import { expect, test } from "bun:test";
import { channelOf } from "../sales-api/lib.ts";
import {
  accountOf,
  automatedSource,
  channelOfType,
  connectorCopy,
  conversationRow,
  messageRow,
  needsMessages,
  plainText,
} from "./lib.ts";

const AT = "2026-10-29T12:00:00.000Z";

// Shapes as HighLevel gave them on 2026-10-29 (bodies shortened).
const waCopy = {
  id: "n5qUGVKpaVgHhDSDlGbM", direction: "outbound", status: "sent", type: 20, contactId: "c1",
  conversationId: "v1", dateAdded: "2026-10-29T11:19:35.736Z", userId: "XhBe1lFpWEK58KisM5XD", source: "workflow",
  conversationProviderId: "67c822224c79561add263440", from: "WA2 Connector", to: "+966561684040",
  messageType: "TYPE_CUSTOM_SMS", body: "إذا ما شفته للحين", contentType: "text/plain",
};
const waOfficial = {
  ...waCopy, id: "eGZg14qD69EmDNQC3AFH", status: "delivered", type: 19, conversationProviderId: undefined,
  from: "+965 9005 4963", messageType: "TYPE_WHATSAPP", dateAdded: "2026-10-29T11:19:34.553Z",
};
const igIn = {
  id: "3Bh4S68B36j72hqqIjC6", direction: "inbound", status: "delivered", type: 18, body: "من الصفر",
  contentType: "text/plain", conversationId: "v2", contactId: "c2", dateAdded: "2026-10-20T08:58:59.776Z",
  meta: { ig: { pageId: "17841473441237528", pageName: "MaharaMedia" } }, from: "Amr Ahmed", to: "MaharaMedia",
  messageType: "TYPE_INSTAGRAM",
};
const activity = {
  id: "cba0KPa2MT8XUPDGZHo1", direction: "outbound", type: 28, contactId: "c1", conversationId: "v1",
  dateAdded: "2026-10-29T11:11:04.009Z", source: "app", body: "Opportunity created", messageType: "TYPE_ACTIVITY_OPPORTUNITY",
};
const email = {
  id: "j6ChYqZYeQ9Yx1qSuhrV", direction: "outbound", type: 3, contactId: "c1", conversationId: "v1",
  dateAdded: "2026-10-29T09:35:53.006Z", contentType: "text/html", source: "workflow", messageType: "TYPE_EMAIL",
  body: "<p>هلا Alexandru،</p><p>تذكير سريع&nbsp;بخصوص رسالتي.</p>",
  meta: { email: { subject: "أتابع بخصوص مكالمتنا", from: "Aziz <aziz@info.maharamedia.com>" } },
};

test("the WA2 Connector's SMS is a copy; the official WhatsApp is the message", () => {
  const copy = messageRow(waCopy, AT);
  const real = messageRow(waOfficial, AT);
  expect(copy).toMatchObject({ channel: "sms", copy: true, automated: true, direction: "outbound" });
  expect(real).toMatchObject({ channel: "whatsapp", copy: false, automated: true, account: "+96590054963" });
  // An SMS a person sent from a real line is not a copy.
  expect(connectorCopy({ direction: "outbound", from: "+1 555 0100" }, "sms")).toBe(false);
  expect(connectorCopy({ direction: "inbound", conversationProviderId: "67c822224c79561add263440" }, "sms")).toBe(false);
});

test("Instagram and Facebook DMs are their own channels, with the page as the inbox", () => {
  expect(messageRow(igIn, AT)).toMatchObject({ channel: "instagram", account: "MaharaMedia", direction: "inbound", automated: false });
  expect(channelOfType("TYPE_FACEBOOK")).toBe("facebook");
  expect(channelOfType(11)).toBe("facebook");
  expect(channelOfType("TYPE_INSTAGRAM_COMMENT")).toBeNull();
  expect(channelOfType("TYPE_FACEBOOK_COMMENT")).toBeNull();
});

test("activity lines and unknown kinds are not kept", () => {
  expect(messageRow(activity, AT)).toBeNull();
  expect(channelOfType("TYPE_ACTIVITY_APPOINTMENT")).toBeNull();
  expect(channelOfType(100)).toBeNull();
  expect(channelOfType("")).toBeNull();
});

test("an email is kept as plain text with its subject and our address", () => {
  const r = messageRow(email, AT);
  expect(r).toMatchObject({ channel: "email", subject: "أتابع بخصوص مكالمتنا", account: "aziz@info.maharamedia.com", automated: true });
  expect(r?.body).toBe("هلا Alexandru،\nتذكير سريع بخصوص رسالتي.");
  expect(plainText("<div>a<br>b</div><script>x()</script>", true)).toBe("a\nb\n");
});

test("who sent it: workflows are automated, a rep (app, api, phone) is a person", () => {
  for (const s of ["workflow", "campaign", "bulk_actions", "WORKFLOW"]) expect(automatedSource(s)).toBe(true);
  for (const s of ["app", "api", "mobile_app", "", null, undefined]) expect(automatedSource(s)).toBe(false);
});

test("a message missing its id, time, direction or conversation is not kept", () => {
  expect(messageRow({ ...igIn, id: "" }, AT)).toBeNull();
  expect(messageRow({ ...igIn, dateAdded: null }, AT)).toBeNull();
  expect(messageRow({ ...igIn, direction: "sideways" }, AT)).toBeNull();
  expect(messageRow({ ...igIn, conversationId: undefined }, AT)).toBeNull();
});

test("every message row has the same keys, so a batch upsert never mixes shapes", () => {
  const keys = [waCopy, waOfficial, igIn, email].map(m => Object.keys(messageRow(m, AT) ?? {}).sort().join());
  expect(new Set(keys).size).toBe(1);
});

test("failed sends keep HighLevel's reason", () => {
  const r = messageRow({ ...waOfficial, status: "failed", error: "In order to maintain a healthy ecosystem engagement" }, AT);
  expect(r).toMatchObject({ status: "failed", error: "In order to maintain a healthy ecosystem engagement" });
  expect(messageRow(waOfficial, AT)?.error).toBeNull();
});

test("the conversation row carries who it is and HighLevel's own fields only", () => {
  const r = conversationRow(
    { id: "v1", contactId: "c1", fullName: "Alexandru Martin", email: "A@X.COM", phone: "+966561684040", assignedTo: "u1",
      tags: ["qualified"], unreadCount: 3, lastMessageDate: 1793277250730, dateUpdated: 1793277250732, lastMessageType: "TYPE_SMS" },
    AT,
  );
  expect(r).toMatchObject({ conversation_id: "v1", email: "a@x.com", unread: 3, assigned_to: "u1", ghl_last_type: "TYPE_SMS" });
  expect(r?.ghl_last_at).toBe(new Date(1793277250730).toISOString());
  expect(r).not.toHaveProperty("needs_reply");
  expect(conversationRow({ id: "v1" }, AT)).toBeNull();
});

test("messages are read again only for new, unread or moved-on conversations", () => {
  const stored = new Map([
    ["same", { ghl_last_at: "2026-10-29T10:00:00Z", messages_synced_at: "2026-10-29T10:01:00Z" }],
    ["moved", { ghl_last_at: "2026-10-29T10:00:00Z", messages_synced_at: "2026-10-29T10:01:00Z" }],
    ["never", { ghl_last_at: "2026-10-29T10:00:00Z", messages_synced_at: null }],
  ]);
  expect(
    needsMessages(
      [
        { conversation_id: "same", ghl_last_at: "2026-10-29T10:00:00Z" },
        { conversation_id: "moved", ghl_last_at: "2026-10-29T10:05:00Z" },
        { conversation_id: "never", ghl_last_at: "2026-10-29T10:00:00Z" },
        { conversation_id: "new", ghl_last_at: "2026-10-29T10:00:00Z" },
      ],
      stored,
    ),
  ).toEqual(["moved", "never", "new"]);
});

test("the worker and sales-api name channels alike", () => {
  for (const t of ["TYPE_WHATSAPP", "TYPE_EMAIL", "TYPE_INSTAGRAM", "TYPE_FACEBOOK", "TYPE_SMS", "TYPE_CUSTOM_SMS", "TYPE_CALL"])
    expect(channelOf(t)).toBe(channelOfType(t) as ReturnType<typeof channelOf>);
});

test("whatsapp inbox is our number whichever way the message went", () => {
  expect(accountOf({ direction: "inbound", from: "+966561684040", to: "+965 9005 4963" }, "whatsapp")).toBe("+96590054963");
  expect(accountOf({ direction: "outbound", from: "+965 9005 4963", to: "+966561684040" }, "whatsapp")).toBe("+96590054963");
});
