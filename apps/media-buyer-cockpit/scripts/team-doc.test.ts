import { describe, expect, test } from "bun:test";
import {
  cleanDoc,
  cleanLinks,
  docHtml,
  docText,
  isHtml,
  linksOf,
  picturePath,
  picturePaths,
  textToHtml,
  withPictureUrls,
} from "../convex/teamDoc";
import { cleanPasted } from "../src/pages/team/pasteClean";
import { rangeIn, seriesIn, seriesInDays } from "../src/pages/team/teamTime";

// The Creative Call's doc as it was written before the editor (2026-09-30).
const OLD_DOC = `Who attends: the creative lead chairs; the editors.

Who owns each field of a row
- Script due: the creative lead
- Edit due (first cut): the editors

Rule: a video with no launch date is not planned.`;

describe("the doc written before the editor", () => {
  test("is told from HTML", () => {
    expect(isHtml(OLD_DOC)).toBe(false);
    expect(isHtml("<p>Hello</p>")).toBe(true);
    expect(isHtml("<h2>Plan</h2><ul><li><p>a</p></li></ul>")).toBe(true);
    expect(isHtml("<3 the team")).toBe(false);
  });

  test("opens as paragraphs, a heading over its list, and a list", () => {
    expect(textToHtml(OLD_DOC)).toBe(
      "<p>Who attends: the creative lead chairs; the editors.</p>" +
        "<h3>Who owns each field of a row</h3>" +
        "<ul><li><p>Script due: the creative lead</p></li><li><p>Edit due (first cut): the editors</p></li></ul>" +
        "<p>Rule: a video with no launch date is not planned.</p>",
    );
  });

  test("numbered lines are a numbered list; words are escaped", () => {
    expect(textToHtml("1. Win\n2. Fires & <solutions>")).toBe(
      "<ol><li><p>Win</p></li><li><p>Fires &amp; &lt;solutions&gt;</p></li></ol>",
    );
  });

  test("an empty doc stays empty; HTML opens as it is", () => {
    expect(docHtml("  ")).toBe("");
    expect(docHtml("<p>x</p>")).toBe("<p>x</p>");
  });

  test("its words read back one block to a line", () => {
    expect(
      docText(
        '<h2>Plan</h2><ul><li><p>One &amp; two</p></li></ul><img src="x" data-path="a">',
      ),
    ).toBe("Plan\nOne & two\n[picture]");
  });
});

describe("a save", () => {
  test("keeps no scripts, frames, handlers or inline pictures", () => {
    const dirty =
      '<p onclick="steal()">Hi<script>alert(1)</script></p>' +
      '<iframe src="https://x"></iframe>' +
      '<a href="javascript:alert(1)">x</a>' +
      '<img src="data:image/png;base64,AAAA">' +
      '<img src="blob:https://cockpit/1">' +
      '<img src="https://ok/x.png" data-path="m/2026-09/0123456789abcdef.png">';
    const out = cleanDoc(dirty);
    expect(out).not.toContain("script");
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("iframe");
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("data:image");
    expect(out).not.toContain("blob:");
    expect(out).toContain('data-path="m/2026-09/0123456789abcdef.png"');
  });
});

describe("the doc's pictures", () => {
  const path = picturePath(
    "slow-client-call",
    "png",
    new Date("2026-09-30T10:00:00Z"),
    "0123456789abcdef0123456789abcdef",
  );

  test("live in the meeting's folder by month", () => {
    expect(path).toBe(
      "slow-client-call/2026-09/0123456789abcdef0123456789abcdef.png",
    );
  });

  test("are found by path and given fresh links", () => {
    const html = `<p>a</p><img src="https://old?token=1" data-path="${path}"><img data-path="${path}">`;
    expect(picturePaths(html)).toEqual([path]);
    expect(picturePaths('<img data-path="../../etc/passwd">')).toEqual([]);
    const out = withPictureUrls(
      html,
      new Map([[path, "https://new/sign?token=a&b"]]),
    );
    expect(out).toBe(
      `<p>a</p><img src="https://new/sign?token=a&amp;b" data-path="${path}"><img src="https://new/sign?token=a&amp;b" data-path="${path}">`,
    );
  });
});

describe("a meeting's links", () => {
  test("keep http and https, name a nameless one by its host, drop repeats", () => {
    expect(
      cleanLinks([
        { label: " Ads board ", url: "https://app.clickup.com/9/v/li/1" },
        { label: "", url: "https://www.example.com/x" },
        { label: "again", url: "https://app.clickup.com/9/v/li/1" },
        { label: "", url: "" },
      ]),
    ).toEqual([
      { label: "Ads board", url: "https://app.clickup.com/9/v/li/1" },
      { label: "example.com", url: "https://www.example.com/x" },
    ]);
  });

  test("refuse what is not a web address, with a sentence", () => {
    expect(() =>
      cleanLinks([{ label: "Bad", url: "javascript:alert(1)" }]),
    ).toThrow('"Bad" needs a full web address starting with https://.');
    expect(() => cleanLinks([{ label: "", url: "clickup board" }])).toThrow();
  });

  test("an old row with one bad link still shows the rest", () => {
    expect(
      linksOf([
        { label: "Good", url: "https://a.com" },
        { label: "Bad", url: "nope" },
      ]),
    ).toEqual([{ label: "Good", url: "https://a.com" }]);
    expect(linksOf(null)).toEqual([]);
  });
});

describe("a paste from Google Docs", () => {
  test("loses the wrapper, fonts, normal sizes and colours that vanish; keeps the rest", () => {
    const html =
      '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-abc">' +
      '<p style="line-height:1.38;text-align: center;margin-top:0pt">' +
      '<span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;font-weight:700">Bold</span>' +
      '<span style="font-size:18pt;color:#e06666;background-color:#ffff00">Big</span>' +
      '<span style="color:#1155cc">Dark blue</span>' +
      '<span style="background-color:#ffffff;color:rgb(255, 255, 255)">Plain</span></p></b>';
    const out = cleanPasted(html);
    expect(out).not.toContain("docs-internal-guid");
    expect(out).not.toContain("font-family");
    expect(out).not.toContain("11pt");
    expect(out).not.toContain("#000000");
    expect(out).toContain("text-align: center");
    expect(out).toContain("font-weight: 700");
    expect(out).toContain("font-size: 18pt");
    expect(out).toContain("color: #e06666");
    // A dark blue would vanish on the dark page: the doc's own colour shows.
    expect(out).toContain("<span>Dark blue</span>");
    expect(out).toContain("background-color: rgba(255, 255, 0, 0.35)");
    expect(out).toContain("<span>Plain</span>");
  });
});

describe("meeting times on the viewer's clock", () => {
  // Wednesday 30 September 2026: London is on summer time, two hours behind Kuwait.
  const today = "2026-09-30";

  test("a Kuwait series reads in London time, with Kuwait's beside it", () => {
    const s = seriesIn(
      {
        weekdays: [1, 2, 3],
        startTime: "15:00:00",
        minutes: 30,
        tz: "Asia/Kuwait",
      },
      today,
      { tz: "Europe/London" },
    );
    expect(s.line).toBe("Mon, Tue and Wed, 13:00 to 13:30, London time");
    expect(s.theirs).toBe("15:00 to 15:30 Kuwait time");
  });

  test("in Kuwait it reads as it always did", () => {
    const s = seriesIn(
      { weekdays: [0, 2], startTime: "15:30", minutes: 30, tz: "Asia/Kuwait" },
      today,
      { tz: "Asia/Kuwait" },
    );
    expect(s.line).toBe("Sun and Tue, 15:30 to 16:00, Kuwait time");
    expect(s.theirs).toBeNull();
  });

  test("after London's clocks go back, the gap is three hours", () => {
    const s = seriesIn(
      { weekdays: [6], startTime: "15:00", minutes: 30, tz: "Asia/Kuwait" },
      "2026-10-28",
      { tz: "Europe/London", zone: false },
    );
    expect(s.line).toBe("Sat, 12:00 to 12:30");
  });

  test("a late Kuwait meeting lands on the London day it falls on", () => {
    const s = seriesIn(
      { weekdays: [0], startTime: "01:00", minutes: 30, tz: "Asia/Kuwait" },
      today,
      { tz: "Europe/London", zone: false },
    );
    expect(s.line).toBe("Sat, 23:00 to 23:30");
  });

  test("a sitting's range is the viewer's", () => {
    expect(
      rangeIn(
        "2026-10-05T12:00:00+00:00",
        "2026-10-05T12:30:00+00:00",
        "Europe/London",
      ),
    ).toBe("13:00 to 13:30");
  });
});

describe("a meeting whose days start at different times", () => {
  test("CSM Daily reads Monday to Wednesday, then the Thursday wrap", () => {
    const parts = [
      { weekday: 1, startTime: "15:00:00", minutes: 30 },
      { weekday: 2, startTime: "15:00:00", minutes: 30 },
      { weekday: 3, startTime: "15:00:00", minutes: 30 },
      { weekday: 4, startTime: "16:30:00", minutes: 30 },
      { weekday: null, startTime: "13:00:00", minutes: 30 },
    ];
    const s = seriesInDays(parts, "Asia/Kuwait", "2026-09-30", {
      tz: "Europe/London",
    });
    expect(s?.line).toBe(
      "Mon, Tue and Wed, 13:00 to 13:30; Thu, 14:30 to 15:00, London time",
    );
    expect(s?.theirs).toBe(
      "Mon, Tue and Wed 15:00 to 15:30; Thu 16:30 to 17:00 Kuwait time",
    );
  });

  test("days that all start together keep the one line", () => {
    expect(
      seriesInDays(
        [
          { weekday: 0, startTime: "15:30", minutes: 30 },
          { weekday: 2, startTime: "15:30", minutes: 30 },
        ],
        "Asia/Kuwait",
        "2026-09-30",
      ),
    ).toBeNull();
  });
});
