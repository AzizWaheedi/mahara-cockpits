// bun test supabase/functions/sales-api/convo.test.ts
import { describe, expect, test } from "bun:test";
import { channelOf, dndFor, emailHtml, mergeThreads, sendBody, stateOf, toThread, whatsappWindow } from "./lib.ts";

describe("threads", () => {
  test("HighLevel's messages become the cockpit's, attachments only over https", () => {
    const [m] = toThread([{
      id: "m1", conversationId: "c1", direction: "inbound", messageType: "TYPE_WHATSAPP", status: "delivered",
      dateAdded: "2026-09-24T10:00:00Z", body: "  hello\n there ", attachments: ["https://x/a.jpg", "http://x/b", "javascript:1"],
    }], "c1");
    expect(m.channel).toBe("whatsapp");
    // Line breaks stay: a chat message keeps its shape.
    expect(m.body).toBe("hello\n there");
    expect(m.attachments).toEqual(["https://x/a.jpg"]);
    expect(m.error).toBeNull();
  });
  test("a failed send keeps its reason", () => {
    const [m] = toThread([{ id: "m2", messageType: "TYPE_WHATSAPP", status: "failed", meta: { error: "131049 marketing cap" } }], "c");
    expect(m.error).toBe("131049 marketing cap");
  });
  test("two conversations read as one thread, newest first, each message once", () => {
    const a = toThread([{ id: "1", dateAdded: "2026-09-24T09:00:00Z" }, { id: "2", dateAdded: "2026-09-24T11:00:00Z" }], "a");
    const b = toThread([{ id: "3", dateAdded: "2026-09-24T10:00:00Z" }, { id: "2", dateAdded: "2026-09-24T11:00:00Z" }], "b");
    expect(mergeThreads([a, b]).map(m => m.id)).toEqual(["2", "3", "1"]);
    expect(mergeThreads([a, b], 2)).toHaveLength(2);
  });
  test("channels by message type", () => {
    expect(channelOf("TYPE_EMAIL")).toBe("email");
    expect(channelOf("TYPE_CALL")).toBe("call");
    expect(channelOf("TYPE_SMS")).toBe("sms");
    expect(channelOf("TYPE_ACTIVITY_OPPORTUNITY")).toBe("other");
  });
});

describe("the WhatsApp window", () => {
  const now = Date.parse("2026-09-24T12:00:00Z");
  test("open for 24 hours after the lead's last message", () => {
    expect(whatsappWindow("2026-09-24T09:00:00Z", now)).toEqual({
      open: true, closes_at: "2026-09-25T09:00:00.000Z", last_inbound_at: "2026-09-24T09:00:00.000Z" });
    expect(whatsappWindow("2026-09-23T11:59:00Z", now).open).toBe(false);
  });
  test("a lead who never wrote has no window", () => {
    expect(whatsappWindow(null, now)).toEqual({ open: false, closes_at: null, last_inbound_at: null });
  });
});

describe("sending", () => {
  test("do-not-disturb, overall or on the one channel", () => {
    expect(dndFor({ dnd: true }, "email")).toBe(true);
    expect(dndFor({ dndSettings: { WhatsApp: { status: "active" } } }, "whatsapp")).toBe(true);
    expect(dndFor({ dndSettings: { WhatsApp: { status: "active" } } }, "email")).toBe(false);
    expect(dndFor({ dndSettings: { Email: { status: "inactive" } } }, "email")).toBe(false);
  });
  test("an email's text is escaped HTML, never markup of its own", () => {
    expect(emailHtml("Hi <b>Omar</b>\n\nThe deck & the price\nbelow"))
      .toBe('<p dir="auto">Hi &lt;b&gt;Omar&lt;/b&gt;</p>\n<p dir="auto">The deck &amp; the price<br>below</p>');
  });
  test("the body for each channel", () => {
    expect(sendBody("whatsapp", "c", "hi")).toEqual({ type: "WhatsApp", contactId: "c", message: "hi" });
    expect(sendBody("email", "c", "hi", " Next step ")).toMatchObject({ type: "Email", subject: "Next step" });
  });
  test("HighLevel's statuses as the cockpit's", () => {
    expect(stateOf("undelivered")).toBe("failed");
    expect(stateOf("opened")).toBe("read");
    expect(stateOf("pending")).toBe("sending");
    expect(stateOf("delivered")).toBe("delivered");
  });
});
