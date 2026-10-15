/**
 * EOD Radar, the screen side (2026-10-15): the board the browser trusts, the
 * read's arguments, the 15 working days, what each dot says, every missing or
 * failing sentence, and the card at each scenario. The people are made up
 * (src/dev/eodRadarFixture.ts).
 */
import { describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { eodRadarFixture } from "../src/dev/eodRadarFixture";
import { parseEodRadar, readEodRadar } from "../src/lib/eodRadarClient";
import { EodRadarCard } from "../src/pages/ceo/eodRadarCard";
import {
  checkedLine,
  daySentence,
  digestLine,
  gridWindow,
  lateText,
  problems,
  radarToday,
  settingsLine,
  tally,
  tallyText,
  workingDays,
} from "../src/pages/ceo/eodRadarCopy";
import type { EodDay } from "../src/types/ceo/eodRadar";

/** 19:00 in Kuwait on Wednesday 14 October 2026. */
const NOW = Date.parse("2026-10-14T16:00:00Z");
const board = (s: Parameters<typeof eodRadarFixture>[0] = "full", now = NOW) =>
  parseEodRadar(eodRadarFixture(s, now));
const words = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ");
const render = (
  b: ReturnType<typeof board> | null,
  error: string | null = null,
) =>
  renderToStaticMarkup(
    createElement(EodRadarCard, { board: b, error, now: NOW }),
  );
const row = (over: Partial<EodDay>): EodDay => ({
  day: "2026-10-14",
  status: "on_time",
  postedAt: null,
  lateMinutes: null,
  creditedBy: null,
  words: null,
  quality: null,
  note: null,
  slackTs: null,
  postedChannel: null,
  posts: 0,
  ...over,
});

describe("the days", () => {
  test("today is Kuwait time minus 4 hours", () => {
    expect(radarToday(Date.parse("2026-10-15T00:59:00Z"))).toBe("2026-10-14");
    expect(radarToday(Date.parse("2026-10-15T01:00:00Z"))).toBe("2026-10-15");
  });
  test("15 working days up to today, Fridays left out", () => {
    const days = workingDays("2026-10-14");
    expect(days).toHaveLength(15);
    expect(days.at(-1)).toBe("2026-10-14");
    expect(days[0]).toBe("2026-09-28");
    expect(days).not.toContain("2026-10-09");
    expect(workingDays("2026-10-16").at(-1)).toBe("2026-10-15");
    expect(gridWindow(NOW)).toEqual({ from: "2026-09-28", to: "2026-10-14" });
  });
});

describe("the board the browser trusts", () => {
  test("the fixture reads; a status it does not know is an error, never an empty board", () => {
    expect(board().people).toHaveLength(5);
    const raw = eodRadarFixture("full", NOW) as unknown as Record<string, any>;
    raw.people[0].days[0].status = "strike";
    expect(() => parseEodRadar(raw)).toThrow("does not read");
    expect(() => parseEodRadar({ today: "x" })).toThrow();
  });

  test("the read sends the two days and says the database's sentence", async () => {
    const asked: unknown[] = [];
    const client = {
      rpc: async (name: string, args: unknown) => {
        asked.push([name, args]);
        return { data: eodRadarFixture("full", NOW), error: null };
      },
    } as unknown as SupabaseClient;
    await readEodRadar(client, { from: "2026-09-28", to: "2026-10-14" });
    expect(asked).toEqual([
      ["cockpit_eod_radar_read", { p_from: "2026-09-28", p_to: "2026-10-14" }],
    ]);
    await expect(
      readEodRadar(client, { from: "28-09-2026", to: "2026-10-14" }),
    ).rejects.toThrow("YYYY-MM-DD");
    const refusing = {
      rpc: async () => ({
        data: null,
        error: { message: "EOD Radar is for the CEO and admins" },
      }),
    } as unknown as SupabaseClient;
    await expect(
      readEodRadar(refusing, { from: "2026-09-28", to: "2026-10-14" }),
    ).rejects.toThrow("EOD Radar is for the CEO and admins");
    await expect(
      readEodRadar(null, { from: "2026-09-28", to: "2026-10-14" }),
    ).rejects.toThrow("Sign in");
  });
});

describe("what a dot says", () => {
  test("late, with how long, when and how it was credited", () => {
    expect(
      daySentence(
        "2026-10-14",
        row({
          status: "late",
          lateMinutes: 28,
          postedAt: "2026-10-14T19:28:00Z",
          creditedBy: "submitted_by",
        }),
      ),
    ).toBe("Wed 14 Oct: late by 28 min, posted 22:28 (Submitted by line)");
    expect(
      daySentence(
        "2026-10-13",
        row({
          day: "2026-10-13",
          status: "late",
          lateMinutes: 858,
          postedAt: "2026-10-14T09:17:00Z",
          creditedBy: "name_line",
        }),
      ),
    ).toBe(
      "Tue 13 Oct: late by 14 h 18 min, posted Wed 14 Oct, 12:17 (Name line)",
    );
    expect(lateText(60 * 26)).toBe("1 day 2 h");
  });
  test("filed in the cockpit; the quality note and the radar's own note follow", () => {
    expect(
      daySentence(
        "2026-10-14",
        row({
          postedAt: "2026-10-14T18:50:00Z",
          creditedBy: "cockpit_outbox",
          quality: "Under 50 words (40)",
        }),
      ),
    ).toBe(
      "Wed 14 Oct: on time, filed 21:50 (filed in the cockpit). Under 50 words (40)",
    );
  });
  test("missed, not read, leave and a day the radar has not looked at", () => {
    expect(
      daySentence(
        "2026-10-14",
        row({
          status: "missed",
          note: "No EOD in #eods-csr or the other EOD channels by 23:00",
        }),
      ),
    ).toBe(
      "Wed 14 Oct: missed. No EOD in #eods-csr or the other EOD channels by 23:00",
    );
    expect(daySentence("2026-10-14", row({ status: "not_read" }))).toBe(
      "Wed 14 Oct: not read",
    );
    expect(daySentence("2026-10-14", undefined)).toBe(
      "Wed 14 Oct: not checked yet",
    );
  });
  test("the tally counts only settled, owed days", () => {
    const b = board();
    const omar = b.people.find(p => p.name === "Omar Fayed")!;
    const t = tally(omar, workingDays(b.today));
    expect(t.due).toBe(t.onTime + t.late + t.missed);
    expect(tallyText({ onTime: 11, late: 2, missed: 1, due: 14 })).toBe(
      "11 on time, 2 late, 1 missed",
    );
    expect(tallyText({ onTime: 0, late: 0, missed: 0, due: 0 })).toBe(
      "Nothing owed yet",
    );
  });
});

describe("the lines the card owes", () => {
  test("the settings: reminders and strikes off, late after 22:00, the closeout post", () => {
    expect(settingsLine(board())).toBe(
      "Reminders and strikes are off. Late after 22:00, and the closeout post goes to #team-management at 23:00.",
    );
    expect(checkedLine(board(), NOW)).toBe("Checked 12 min ago");
  });
  test("a channel that could not be read is named with the fix, and nobody there is missed", () => {
    const b = board("unread");
    const texts = problems(b, NOW).map(p => p.text);
    expect(texts[0]).toBe(
      "Could not read #eods-csr: the Slack app needs the groups:history scope. Add it to mahara-club-bot in the Slack app settings and reinstall the app.",
    );
    const csr = b.people.filter(p => p.channelName === "eods-csr");
    expect(csr.flatMap(p => p.days).some(d => d.status === "missed")).toBe(
      false,
    );
  });
  test("a radar that never ran says why", () => {
    expect(problems(board("never"), NOW)[0].text).toBe(
      "EOD Radar has not run yet. The vault has no cockpit_sync_secret, so EOD Radar was not started. Add it to the vault.",
    );
  });
  test("posts that named nobody, people with no Slack id, roles with no channel", () => {
    const texts = problems(board(), NOW).map(p => p.text);
    expect(texts).toContain(
      'One EOD post named nobody on the radar, such as "Ahmed", so it was not credited. A full name on the form fixes it.'.replace(
        "One EOD post",
        "1 EOD post",
      ),
    );
    expect(texts.some(t => t.startsWith("No Slack id for Lina Haddad"))).toBe(
      true,
    );
    expect(texts).toContain(
      "Not on the radar: Rami Saleh (Operations lead). Their role has no EOD channel.",
    );
    expect(digestLine(board())).toBe(
      "Last closeout post: Tue 13 Oct, in #team-management.",
    );
  });
  test("a stale run is called out", () => {
    const b = board("full", NOW);
    const later = NOW + 3 * 3600_000;
    expect(problems(b, later)[0].text).toContain("The last run was 3 h ago");
  });
});

describe("the card", () => {
  test("every person, today's lamp, the legend and the settings line; no em dash", () => {
    const html = render(board());
    const text = words(html);
    for (const s of [
      "EOD Radar",
      "Hala Mansour",
      "Sara Kanaan",
      "Reminders and strikes are off",
      "On time",
      "Late",
      "Missed",
      "Not in yet",
      "On leave",
      "Day off",
      "Not read",
    ])
      expect(text).toContain(s);
    expect(html).toContain("bg-primary");
    expect(html).toMatch(/title="Wed 14 Oct: /);
    expect(html).not.toMatch(/[—–]/);
  });
  test("an error says what to do", () => {
    expect(
      words(
        render(null, "permission denied for function cockpit_eod_radar_read."),
      ),
    ).toContain(
      "EOD Radar could not be read permission denied for function cockpit_eod_radar_read. Reload the page; if it keeps failing, the radar's migration (20261015210000) may not be applied yet.",
    );
  });
  test("before the first read, and with nobody to watch", () => {
    expect(words(render(null))).toContain("Reading EOD Radar");
    expect(words(render(board("empty")))).toContain("Nobody owes an EOD");
  });
});
