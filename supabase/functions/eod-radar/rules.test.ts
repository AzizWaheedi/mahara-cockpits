import { describe, expect, test } from "bun:test";
import {
  ahmedOnly, CH, makeContinuation, makeCsr, makeNextDay, makeTest, makeUnclosedDate, makeWrongSubmitter, mention,
  outboxClub, outboxCsm, outboxNoId, PEOPLE, person, selfPosted, tsAt,
} from "./fixtures.ts";
import { parsePost, type Post, type SlackMessage } from "./parse.ts";
import {
  creditPosts, type DayInfo, decideDay, digestText, eodDayOf, kuwaitAt, minutesLabel, type OutboxRow, type Row, workingDayOf,
} from "./rules.ts";

const post = (m: SlackMessage, ch: string = CH.media) => parsePost(ch, m) as Post;
const SETTINGS = { lateAt: "22:00", closeoutAt: "23:00" };
const kw = (s: string) => Date.parse(`${s.replace(" ", "T")}:00Z`) - 3 * 3600_000;
const info = (day: string, over: Partial<DayInfo> = {}): DayInfo => ({ day, off: null, offNote: null, leave: null, ...over });

describe("the EOD day of a post", () => {
  test("Kuwait time minus 4 hours: 03:59 is the day before, 04:00 is the day", () => {
    expect(workingDayOf(kw("2026-10-15 03:59"))).toBe("2026-10-14");
    expect(workingDayOf(kw("2026-10-15 04:00"))).toBe("2026-10-15");
  });
  test("a next-day Make post counts for its Date line", () => {
    expect(eodDayOf(post(makeNextDay))).toEqual({ day: "2026-10-13", from: "date_line", ignoredDate: null });
  });
  test("a Date line in the future or more than 14 days back is not trusted", () => {
    expect(eodDayOf({ at: kw("2026-10-14 21:00"), dateLine: "15-10-2026" }).day).toBe("2026-10-14");
    expect(eodDayOf({ at: kw("2026-10-14 21:00"), dateLine: "15-10-2026" }).ignoredDate).toBe("15-10-2026");
    expect(eodDayOf({ at: kw("2026-10-14 21:00"), dateLine: "13-10-2025" }).day).toBe("2026-10-14");
  });
  test("a month-first Date line is read month-first only when day-first does not fit", () => {
    // 10-04-2026 day-first is 10 April (too old); month-first is 4 October.
    expect(eodDayOf({ at: kw("2026-10-05 00:45"), dateLine: "10-04-2026" }).day).toBe("2026-10-04");
  });
  test("a Friday post is Thursday's EOD", () => {
    expect(eodDayOf({ at: kw("2026-10-16 15:00"), dateLine: null }).day).toBe("2026-10-15");
  });
});

describe("who a post credits", () => {
  const outbox: OutboxRow[] = [
    { id: 5, role: "sales_closer", day: "2026-10-13", person: "Ahmed Abushaiba", slackId: "U0B665Z7WCQ", channel: CH.sales, slackTs: "1791971404.316399", createdAt: "2026-10-14T09:47:24Z" },
    { id: 2, role: "sales_closer", day: "2026-10-08", person: "Ahmed Abushaiba", slackId: null, channel: CH.sales, slackTs: "1791572104.421879", createdAt: "2026-10-09T18:50:55Z" },
  ];
  const run = (posts: Post[], ob: OutboxRow[] = [], from = "2026-10-06", to = "2026-10-15") => creditPosts({ posts, people: PEOPLE, outbox: ob, from, to });

  test("Submitted by on a Make post", () => {
    const { credits } = run([post(makeNextDay)]);
    expect(credits.get("26:2026-10-13")).toMatchObject({ by: "submitted_by", ts: makeNextDay.ts, channel: CH.media });
  });

  test("a Submitted by of someone not on the radar falls back to the Name line", () => {
    const { credits } = run([post(makeWrongSubmitter, CH.csms)]);
    expect(credits.get("28:2026-10-10")).toMatchObject({ by: "name_line" });
  });

  test("a Submitted by that names someone else on the radar loses to the Name line, with a note", () => {
    const m = { ...makeCsr, text: String(makeCsr.text).replace("<@U0ANNBCT3B3>", "<@U09SF7GUEHY>") };
    const { credits } = run([post(m, CH.csr)]);
    expect(credits.get("7:2026-10-14")).toMatchObject({ by: "name_line", note: "Submitted by named Lama Harb; credited to the Name line" });
    expect(credits.has("12:2026-10-14")).toBe(false);
  });

  test("the cockpit outbox: its person, its day and when it was filed, earlier than Slack had it", () => {
    const { credits } = run([post(outboxClub, CH.sales), post(outboxNoId, CH.sales)], outbox);
    const c13 = credits.get("4:2026-10-13")!;
    expect(c13.by).toBe("cockpit_outbox");
    expect(c13.at).toBe(Date.parse("2026-10-14T09:47:24Z"));
    // No Slack id on the row: the name and the closer's role find him.
    expect(credits.get("4:2026-10-08")).toMatchObject({ by: "cockpit_outbox" });
  });

  test("a sent outbox EOD in a channel that was not read still credits, from the outbox", () => {
    const { credits } = run([], outbox);
    expect(credits.get("4:2026-10-13")).toMatchObject({ by: "cockpit_outbox", words: null, note: "From the cockpit's sent EODs; the post itself was not read in Slack" });
  });

  test("an outbox row that names its channel (#eods-csms) still matches its Slack post, once, under the channel's id", () => {
    const csm: OutboxRow = { id: 9, role: "csm", day: "2026-10-14", person: "Rasem Abdel All", slackId: "U0C5JHUCTPG", channel: "#eods-csms", slackTs: outboxCsm.ts as string, createdAt: "2026-10-14T16:58:00Z" };
    const { credits } = run([post(outboxCsm, CH.csms)], [csm]);
    const c = credits.get("28:2026-10-14")!;
    expect(c).toMatchObject({ by: "cockpit_outbox", channel: CH.csms, ts: outboxCsm.ts, posts: 1, at: Date.parse("2026-10-14T16:58:00Z") });
    const r = decideDay({ person: person(28), info: info("2026-10-14"), credit: c, now: kw("2026-10-14 23:05"), settings: SETTINGS, unread: [] });
    expect(r).toMatchObject({ status: "on_time", postedChannel: CH.csms, creditedBy: "cockpit_outbox", posts: 1 });
    // Not read in Slack: credited from the outbox, with no channel rather than a name the table refuses.
    const unread = run([], [csm]).credits.get("28:2026-10-14")!;
    expect(unread).toMatchObject({ by: "cockpit_outbox", channel: null, ts: outboxCsm.ts });
    expect(decideDay({ person: person(28), info: info("2026-10-14"), credit: unread, now: kw("2026-10-14 23:05"), settings: SETTINGS, unread: [] }).postedChannel).toBeNull();
    // A row that names another channel's id is not that post: the post and the row are two filings.
    expect(run([post(outboxCsm, CH.csms)], [{ ...csm, channel: CH.sales }]).credits.get("28:2026-10-14")).toMatchObject({ channel: CH.sales, posts: 2 });
  });

  test("a person's own message credits them; a mention does not", () => {
    const { credits } = run([post(selfPosted), post(mention)].filter(p => p.eodLike));
    expect(credits.get("19:2026-10-14")).toMatchObject({ by: "poster" });
    expect(credits.has("18:2026-10-14")).toBe(false);
  });

  test("a test submission and a continuation credit nobody", () => {
    const { credits, tests, unmatched } = run([post(makeTest), post(makeContinuation, CH.csms)]);
    expect(credits.size).toBe(0);
    expect(tests).toBe(1);
    expect(unmatched).toEqual([]);
  });

  test("two people with the same first name: never a guess", () => {
    const editor = run([post(ahmedOnly("VIDEO EDITOR"))]);
    expect(editor.credits.get("27:2026-10-14")).toMatchObject({ by: "name_line" });
    const unsure = run([post(ahmedOnly("TEAM"))]);
    expect(unsure.credits.size).toBe(0);
    expect(unsure.unmatched).toEqual([{ channel: CH.media, ts: ahmedOnly("TEAM").ts as string, name: "Ahmed", reason: "ambiguous" }]);
  });

  test("two posts for one day: the first counts, both are counted", () => {
    const again = { ...makeNextDay, ts: tsAt("2026-10-14 13:00") };
    const { credits } = run([post(again), post(makeNextDay)]);
    expect(credits.get("26:2026-10-13")).toMatchObject({ ts: makeNextDay.ts, posts: 2 });
  });

  test("posts outside the window are left out", () => {
    expect(run([post(makeNextDay)], [], "2026-10-14", "2026-10-15").credits.size).toBe(0);
  });
});

describe("a person's day", () => {
  const day = "2026-10-14";
  const credit = (at: number) => ({ personId: 18, day, at, ts: makeUnclosedDate.ts as string, channel: CH.tech, by: "submitted_by" as const, words: 120, quality: null, posts: 1, note: null });
  const decide = (over: Partial<Parameters<typeof decideDay>[0]>) =>
    decideDay({ person: person(18), info: info(day), credit: undefined, now: kw("2026-10-15 09:00"), settings: SETTINGS, unread: [], ...over });

  test("on time up to 22:00, late after it with the minutes", () => {
    expect(decide({ credit: credit(kw("2026-10-14 22:00")) })).toMatchObject({ status: "on_time", lateMinutes: null });
    const late = decide({ credit: credit(kw("2026-10-14 22:27")) });
    expect(late).toMatchObject({ status: "late", lateMinutes: 27, creditedBy: "submitted_by", slackTs: makeUnclosedDate.ts });
    expect(decide({ credit: credit(kw("2026-10-15 12:17")) }).lateMinutes).toBe(14 * 60 + 17);
    expect(minutesLabel(14 * 60 + 17)).toBe("14 h 17 min");
  });

  test("Friday is off, and so is a day before the roster or after the last day", () => {
    expect(decide({ info: info("2026-10-16", { off: "friday" }) })).toMatchObject({ status: "off", note: "Friday, no EOD due" });
    expect(decide({ info: info(day, { off: "ended" }) }).status).toBe("off");
    expect(decide({ info: info(day, { off: "holiday", offNote: "Prophet's Birthday" }) }).note).toBe("Public holiday: Prophet's Birthday");
  });

  test("leave is leave, not missed", () => {
    expect(decide({ info: info(day, { leave: "Annual leave" }) })).toMatchObject({ status: "leave", note: "On leave: Annual leave" });
  });

  test("a post on leave or a day off still counts as filed", () => {
    expect(decide({ info: info(day, { leave: "Annual leave" }), credit: credit(kw("2026-10-14 20:00")) })).toMatchObject({ status: "on_time", note: "Filed while on leave" });
  });

  test("pending until 23:00, missed after", () => {
    expect(decide({ now: kw("2026-10-14 21:00") })).toMatchObject({ status: "pending", note: "Due by 22:00" });
    expect(decide({ now: kw("2026-10-14 22:30") }).status).toBe("pending");
    expect(decide({ now: kw("2026-10-14 23:00") }).status).toBe("missed");
  });

  test("not read is never missed: a channel Slack refused, or no Slack id", () => {
    const unread = [{ id: CH.csr, name: "eods-csr", error: "missing_scope" }];
    const r = decide({ unread });
    expect(r.status).toBe("not_read");
    expect(r.note).toBe("Could not read #eods-csr (the Slack app needs the groups:history scope), so this day is not counted");
    expect(decide({ person: person(27) })).toMatchObject({ status: "not_read" });
    // A credit still counts while a channel is unread.
    expect(decide({ unread, credit: credit(kw("2026-10-14 20:00")) }).status).toBe("on_time");
  });
});

describe("the closeout post", () => {
  const day = "2026-10-14";
  const row = (personId: number, status: Row["status"]): Row => ({
    personId, day, channel: null, status, postedAt: null, slackTs: null, postedChannel: null, lateMinutes: status === "late" ? 5 : null,
    creditedBy: null, words: null, quality: null, note: null, posts: 0,
  });

  test("counts, the missed by name, leave", () => {
    const rows = [row(18, "late"), row(7, "on_time"), row(11, "late"), row(12, "missed"), row(26, "missed"), row(19, "leave"), row(28, "on_time"), row(4, "off"), { ...row(7, "missed"), day: "2026-10-13" }];
    expect(digestText(day, rows, PEOPLE, [])).toBe("EOD Radar, Wed 14 Oct: 2 on time, 2 late, 2 missed (Lama Harb, Ali), 1 on leave.");
  });

  test("a channel that could not be read is named, and its people are not counted", () => {
    const rows = [row(7, "not_read"), row(12, "not_read"), row(18, "on_time")];
    expect(digestText(day, rows, PEOPLE, [{ id: CH.csr, name: "eods-csr", error: "not_in_channel" }])).toBe(
      "EOD Radar, Wed 14 Oct: 1 on time, 0 late, 0 missed, 0 on leave.\nCould not read #eods-csr (the bot is not in the channel), so 2 people are not counted.",
    );
    expect(digestText(day, [row(27, "not_read")], PEOPLE, [])).toBe(
      "EOD Radar, Wed 14 Oct: 0 on time, 0 late, 0 missed, 0 on leave.\nNot counted: Ahmed (no Slack id on the roster).",
    );
  });

  test("nothing to post when nobody owed an EOD", () => {
    expect(digestText("2026-10-16", [{ ...row(7, "off"), day: "2026-10-16" }], PEOPLE, [])).toBeNull();
  });

  test("no em dash, no emoji", () => {
    const text = digestText(day, [row(18, "late"), row(12, "missed")], PEOPLE, [{ id: CH.csr, name: "eods-csr", error: "missing_scope" }]) ?? "";
    expect(text).not.toMatch(/[—–]/);
    expect(text).not.toMatch(/:[a-z_]+:/);
  });

  test("closeout and late cut-offs are Kuwait wall clock", () => {
    expect(new Date(kuwaitAt(day, "23:00")).toISOString()).toBe("2026-10-14T20:00:00.000Z");
  });
});
