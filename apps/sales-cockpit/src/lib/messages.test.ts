// bun test src/lib/messages.test.ts
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  accountLabel,
  hourShare,
  previewLine,
  readInboxCounts,
  readInboxPage,
  syncWords,
  waitTone,
  waitWords,
} from "./messages";

const NOW = Date.parse("2026-10-29T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

test("the reply clock runs against the one-hour standard", () => {
  expect(waitTone(ago(5), NOW)).toBe("fresh");
  expect(waitTone(ago(45), NOW)).toBe("due");
  expect(waitTone(ago(61), NOW)).toBe("late");
  expect(waitTone(ago(26 * 60), NOW)).toBe("stale");
  expect(hourShare(ago(30), NOW)).toBeCloseTo(0.5);
  expect(hourShare(ago(300), NOW)).toBe(1);
  expect(waitWords(ago(0), NOW)).toBe("now");
  expect(waitWords(ago(7), NOW)).toBe("7m");
  expect(waitWords(ago(134), NOW)).toBe("2h 14m");
  expect(waitWords(ago(120), NOW)).toBe("2h");
  expect(waitWords(ago(3 * 24 * 60), NOW)).toBe("3d");
  expect(waitWords(null, NOW)).toBe("");
});

test("a garbled answer is an error, never an empty inbox", () => {
  expect(() => readInboxPage(null)).toThrow();
  expect(() => readInboxPage({ rows: "x" })).toThrow();
  expect(() => readInboxCounts({})).toThrow();
  const page = readInboxPage({
    rows: [
      {
        conversation_id: "v1",
        contact_id: "c1",
        channels: ["whatsapp", "telegram"],
        needs_reply: true,
        unread: "2",
      },
      { conversation_id: "", contact_id: "c2" },
    ],
    more: true,
  });
  expect(page.more).toBe(true);
  expect(page.rows).toHaveLength(1);
  expect(page.rows[0]).toMatchObject({
    channels: ["whatsapp"],
    needs_reply: true,
    unread: 2,
    read: true,
  });
});

test("inboxes are said the way people say them", () => {
  expect(accountLabel("whatsapp:+96590054963")).toBe("WhatsApp +965 9005 4963");
  expect(accountLabel("instagram:MaharaMedia")).toBe("Instagram @MaharaMedia");
  expect(accountLabel("facebook:MaharaMedia")).toBe(
    "Facebook page MaharaMedia",
  );
  expect(accountLabel("email:aziz@info.maharamedia.com")).toBe(
    "aziz@info.maharamedia.com",
  );
});

test("the preview says who spoke last", () => {
  const base = readInboxPage({
    rows: [{ conversation_id: "v", contact_id: "c" }],
  }).rows[0];
  expect(
    previewLine({
      ...base,
      needs_reply: true,
      last_in_body: "كم السعر؟",
      last_body: "Automation text",
    }),
  ).toBe("كم السعر؟");
  expect(
    previewLine({
      ...base,
      last_direction: "outbound",
      last_automated: true,
      last_body: "Reminder",
    }),
  ).toBe("Automation: Reminder");
  expect(
    previewLine({
      ...base,
      last_direction: "outbound",
      last_automated: false,
      last_reply_by: "Ahmed Abushaiba",
      last_body: "Done",
    }),
  ).toBe("Ahmed: Done");
});

test("a copy that stopped is said, never shown as up to date", () => {
  expect(syncWords(null, NOW).tone).toBe("behind");
  expect(
    syncWords(
      {
        last_ok_at: ago(12),
        last_run_at: ago(1),
        last_error: "HighLevel 503",
        full_done_at: null,
        conversations: 10,
        unread_backlog: 0,
      },
      NOW,
    ),
  ).toMatchObject({ tone: "behind" });
  expect(
    syncWords(
      {
        last_ok_at: ago(1),
        last_run_at: ago(1),
        last_error: null,
        full_done_at: null,
        conversations: 4810,
        unread_backlog: 1200,
      },
      NOW,
    ).text,
  ).toContain("3,610 of 4,810");
  expect(
    syncWords(
      {
        last_ok_at: ago(1),
        last_run_at: ago(1),
        last_error: null,
        full_done_at: ago(5),
        conversations: 4810,
        unread_backlog: 0,
      },
      NOW,
    ).tone,
  ).toBe("ok");
});

test("the 14-day Needs reply window matches the database", () => {
  const sql = readFileSync(
    new URL(
      "../../../../supabase/migrations/20261029d_sales_conversations.sql",
      import.meta.url,
    ),
    "utf8",
  );
  expect(sql).toContain(
    "cockpit_sales_reply_days()\nreturns integer language sql immutable set search_path = '' as $$ select 14 $$",
  );
  expect(readInboxCounts({ states: {} }).reply_days).toBe(14);
});
