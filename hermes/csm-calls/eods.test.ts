import { expect, test } from "bun:test";
import { clientsNamedIn, excerptFor, mentionRows, sameReport, sheetTime, slackText, type Report } from "./eods";
import { makeTransport } from "./lib";

const clients = [
  { taskId: "t1", name: "Atlantis Contracting", aliases: ["Atlantis"] },
  { taskId: "t2", name: "Al Rai Group", aliases: [] },
  { taskId: "t3", name: "Al Rai", aliases: [] },
  { taskId: "t4", name: "Ardon", aliases: [] },
  { taskId: "t5", name: "ARC", aliases: [] },
];

test("a client is named by whole word; short names and parts of words never match", () => {
  expect(clientsNamedIn("Paused two ads for Atlantis today", clients).map(c => c.taskId)).toEqual(["t1"]);
  expect(clientsNamedIn("Gardoned the arcade", clients)).toEqual([]);
  expect(clientsNamedIn("ARC called twice", clients)).toEqual([]);
});

test("the longer client name wins when one name contains another", () => {
  expect(clientsNamedIn("Al Rai Group asked for a new offer", clients).map(c => c.taskId)).toEqual(["t2"]);
  expect(clientsNamedIn("Al Rai asked", clients).map(c => c.taskId)).toEqual(["t3"]);
});

test("only the lines that name the client are kept, and personal answers never are", () => {
  const out = excerptFor(
    [
      { label: "Energy", text: "Atlantis drained me, 3/10" },
      { label: "Call Summary", text: "Ardon happy with leads\nAtlantis wants to pause Friday\nTeam lunch" },
    ],
    clients[0],
  );
  expect(out).toBe("Call Summary: Atlantis wants to pause Friday");
});

test("the same EOD in the sheet and Slack is stored once, the sheet copy kept", () => {
  const base = { day: "2026-10-11", at: Date.parse("2026-10-11T16:00:00Z"), author: "Rasem", where: "x" };
  const reports: Report[] = [
    { ...base, source: "slack", sourceId: "slack:1", passages: [{ text: "Atlantis wants to pause their campaign on Friday" }] },
    { ...base, source: "sheet", sourceId: "sheet:1", passages: [{ label: "Call Summary", text: "Atlantis wants to pause their campaign on Friday" }] },
    { ...base, source: "slack", sourceId: "slack:2", passages: [{ text: "Ardon booked 4 appointments from the new ad" }] },
  ];
  const rows = mentionRows(reports, clients, Date.now());
  expect(rows.map(r => `${r.source}:${r.task_id}`)).toEqual(["sheet:t1", "slack:t4"]);
  expect(sameReport("Atlantis wants to pause on Friday", "Ardon booked four")).toBe(false);
});

test("sheet times are Kuwait time; Slack markup becomes plain text", () => {
  expect(new Date(sheetTime("2026-10-06 20:05:04")).toISOString()).toBe("2026-10-06T17:05:04.000Z");
  expect(new Date(sheetTime("11-10-2026")).toISOString().slice(0, 10)).toBe("2026-10-11");
  expect(Number.isNaN(sheetTime("Submitted At"))).toBe(true);
  expect(slackText("*Hi* <@U1> see <https://x.io|the doc>")).toBe("Hi  see the doc");
});

test("the transport reads only the EOD sheet and Slack history, and a Slack ok:false fails", async () => {
  const t = makeTransport({ SLACK_BOT_TOKEN: "x" }, "test", (async () => new Response(JSON.stringify({ ok: false, error: "not_in_channel" }), { status: 200 })) as any, async () => {});
  await expect(t.slackHistory({ channel: "C1" })).rejects.toThrow("not_in_channel");
});
