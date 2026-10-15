import { describe, expect, test } from "bun:test";
import { kw } from "./testkit.ts";
import {
  activeAgainText, backOnText, duration, idleText, idleUnjudgedText, kuwaitDay, kuwaitTime, noAccountText, notTrackingText, notWorkText, roleWords, shiftEndedOffText,
  shiftEndedText, slackEscape, sourceBackText, sourceText, WATCH_URL, workAgainText,
} from "./text.ts";

describe("the Kuwait clock", () => {
  test("times are UTC+3 wall clock, days turn at Kuwait midnight", () => {
    expect(kuwaitTime("2026-10-13T07:12:00Z")).toBe("10:12");
    expect(kuwaitTime("2026-10-13T21:30:00Z")).toBe("00:30");
    expect(kuwaitDay("2026-10-13T20:59:00Z")).toBe("2026-10-13");
    expect(kuwaitDay("2026-10-13T21:00:00Z")).toBe("2026-10-14");
  });
  test("durations read 35 min, 2 h, 1 h 50 min", () => {
    expect(duration(0)).toBe("0 min");
    expect(duration(35)).toBe("35 min");
    expect(duration(59.6)).toBe("1 h");
    expect(duration(120)).toBe("2 h");
    expect(duration(110)).toBe("1 h 50 min");
  });
  test("roles are said in lower case, call centre spelt the house way", () => {
    expect(roleWords("Call Center Agent")).toBe("call centre agent");
    expect(roleWords("Media Buyer")).toBe("media buyer");
    expect(roleWords(null)).toBe("no role set");
  });
});

describe("the Slack sentences (SPEC.md)", () => {
  test("not tracking", () => {
    expect(notTrackingText({ name: "Lama Harb", role: "Call Centre Agent", since: kw("10:12"), shiftStart: kw("10:00"), shiftEnd: kw("18:00"), now: kw("10:35") }))
      .toBe(`*Lama Harb* (call centre agent) has not had Hubstaff on since 10:12, 35 min into the 10:00 to 18:00 shift. <${WATCH_URL}|Open Hubstaff watch>`);
  });
  test("not in Hubstaff yet", () => {
    expect(noAccountText({ name: "Nada Al Saed", role: "Media Buyer", invited: true }))
      .toBe(`*Nada Al Saed* (media buyer) is on shift but is not in Hubstaff yet (invite not accepted). <${WATCH_URL}|Open Hubstaff watch>`);
    expect(noAccountText({ name: "Nada Al Saed", role: "Media Buyer", invited: false })).toContain("(no account linked)");
  });
  test("not work", () => {
    expect(notWorkText({ name: "Daniya Ziad", role: "Call Centre Agent", count: 3, total: 3, labels: ["YouTube video", "Instagram feed"] }))
      .toBe(`*Daniya Ziad* (call centre agent): 3 of the last 3 screenshots do not look like work (YouTube video, Instagram feed). <${WATCH_URL}|See the screenshots>`);
    expect(notWorkText({ name: "Daniya Ziad", role: "Call Centre Agent", count: 1, total: 1, labels: ["YouTube video."] }))
      .toBe(`*Daniya Ziad* (call centre agent): The last screenshot does not look like work (YouTube video). <${WATCH_URL}|See the screenshots>`);
    // Final round: one screenshot never reads "1 of the last 1 screenshots".
    expect(notWorkText({ name: "D", role: null, count: 1, total: 1, labels: [] })).not.toContain("of the last 1");
    expect(notWorkText({ name: "D", role: "Call Centre Agent", count: 2, total: 3, labels: ["YouTube video"] })).toContain(": 2 of the last 3 screenshots do not look like work (YouTube video). <");
    expect(notWorkText({ name: "D", role: "Call Centre Agent", count: 1, total: 3, labels: [] })).toContain(": 1 of the last 3 screenshots does not look like work. <");
  });
  test("idle", () => {
    expect(idleText({ name: "Lama Harb", role: "Call Centre Agent", since: kw("11:00"), pct: 3.2 }))
      .toBe(`*Lama Harb* (call centre agent): Hubstaff has been running since 11:00 with 3% keyboard and mouse activity. <${WATCH_URL}|Open Hubstaff watch>`);
    // Rounded down: 9.7% under a 10% floor never reads "10%".
    expect(idleText({ name: "Lama Harb", role: "Call Centre Agent", since: kw("11:00"), pct: 9.7 })).toContain(" with 9% keyboard");
    expect(idleText({ name: "Lama Harb", role: "Call Centre Agent", since: kw("11:00"), pct: (58.2 / 600) * 100 })).toContain(" with 9% keyboard");
    expect(idleText({ name: "Lama Harb", role: "Call Centre Agent", since: kw("11:00"), pct: (60 / 600) * 100 })).toContain(" with 10% keyboard");
  });
  test("source", () => {
    expect(sourceText("Hubstaff isn't connected."))
      .toBe(`Hubstaff watch cannot read Hubstaff: Hubstaff isn't connected. Nobody is being watched until it can. <${WATCH_URL}|Open Hubstaff watch>`);
  });
  test("the thread replies", () => {
    expect(backOnText({ at: kw("10:47"), since: kw("10:12") })).toBe("Back on Hubstaff at 10:47 (35 min off).");
    expect(shiftEndedOffText({ since: kw("16:10"), shiftEnd: kw("18:00") })).toBe("Shift ended. Hubstaff was off from 16:10 to 18:00 (1 h 50 min).");
    expect(workAgainText({ lastNotWorkAt: kw("11:30") })).toBe("No more screenshots off work since 11:30.");
    expect(activeAgainText({ floorPct: 10, at: kw("11:40") })).toBe("Activity back above 10% at 11:40.");
    expect(activeAgainText({ floorPct: 12.5, at: kw("11:40") })).toBe("Activity back above 12% at 11:40.");
    expect(idleUnjudgedText({ at: kw("12:30") })).toBe("Too little time on the computer to judge activity at 12:30.");
    expect(sourceBackText()).toBe("Hubstaff can be read again.");
    expect(shiftEndedText({ shiftEnd: kw("18:00") })).toBe("Shift ended at 18:00.");
  });
  test("names and notes can never become a link or a mention; no emoji anywhere", () => {
    expect(slackEscape("<!channel> & <https://x.test|y>")).toBe("&lt;!channel&gt; &amp; &lt;https://x.test|y&gt;");
    const text = notTrackingText({ name: "<!here>", role: "Agent <b>", since: kw("10:12"), shiftStart: kw("10:00"), shiftEnd: kw("18:00"), now: kw("10:35") });
    expect(text).toStartWith("*&lt;!here&gt;* (agent &lt;b&gt;)");
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(text).not.toContain("—");
  });
});
