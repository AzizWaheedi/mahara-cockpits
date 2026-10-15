import { describe, expect, test } from "bun:test";
import {
  ahmedOnly, CH, join, makeContinuation, makeCsr, makeNextDay, makeTest, makeUnclosedDate, makeWrongSubmitter, mention,
  outboxClub, outboxNoId, PEOPLE, person, selfPosted,
} from "./fixtures.ts";
import { fits, headerFits, matchName, nameWords } from "./match.ts";
import { dateCandidates, hasWinsBlockersOrPlan, parsePost, qualityNote } from "./parse.ts";

const parse = (m: Parameters<typeof parsePost>[1], ch: string = CH.media) => parsePost(ch, m)!;

describe("reading a post", () => {
  test("Make's video editor form, posted the next day: header, Date, Name and Submitted by", () => {
    const p = parse(makeNextDay);
    expect(p).toMatchObject({ header: "VIDEO EDITOR", dateLine: "13-10-2026", nameLine: "Ali", submittedBy: "U0C69400F1U", poster: null, test: false, eodLike: true });
    expect(p.words).toBeGreaterThan(40);
  });

  test("a Date line whose bold never closes still reads", () => {
    const p = parse(makeUnclosedDate, CH.tech);
    expect(p.dateLine).toBe("14-10-2026");
    expect(p.nameLine).toBe("Muhammed Burhan");
    expect(p.header).toBe("SYSTEMS MANAGER");
  });

  test("the CSR form's '*Name:* Daniya' and its emoji header", () => {
    const p = parse(makeCsr, CH.csr);
    expect(p).toMatchObject({ header: "CSR", nameLine: "Daniya", submittedBy: "U0ANNBCT3B3", dateLine: "14-10-2026" });
  });

  test("the cockpit outbox: ISO Date line, Submitted by from the seat", () => {
    const p = parse(outboxClub, CH.sales);
    expect(p).toMatchObject({ header: "SALES REP", dateLine: "2026-10-13", nameLine: "Ahmed Abushaiba", submittedBy: "U0B665Z7WCQ", poster: null });
  });

  test("an outbox post with no Slack id keeps the name it gives", () => {
    const p = parse(outboxNoId, CH.sales);
    expect(p.submittedBy).toBeNull();
    expect(p.submittedByText).toBe("Ahmed Abushaiba");
  });

  test("a test submission is marked, so it credits nobody", () => {
    expect(parse(makeTest).test).toBe(true);
    expect(parse(makeNextDay).test).toBe(false);
  });

  test("a person's own message: the poster is theirs, and it looks like an EOD by its length", () => {
    const p = parse(selfPosted);
    expect(p.poster).toBe("U0AJQ8P1ACF");
    expect(p.eodLike).toBe(true);
    expect(p.header).toBeNull();
  });

  test("a bare mention is not an EOD; a join is not a message at all", () => {
    expect(parse(mention).eodLike).toBe(false);
    expect(parsePost(CH.media, join)).toBeNull();
    expect(parsePost(CH.media, { ...makeNextDay, thread_ts: "1791900000.000100" })).toBeNull();
  });

  test("Make's second half of a long EOD names nobody", () => {
    const p = parse(makeContinuation, CH.csms);
    expect(p).toMatchObject({ header: null, nameLine: null, submittedBy: null, poster: null });
  });

  test("Slack's escapes are read back", () => {
    const p = parse({ ts: "1791971820.000100", user: "U0AJQ8P1ACF", text: "*MEDIA BUYER EOD*\n*Name - Nada*\n*Marble &amp; More* relaunched" });
    expect(p.nameLine).toBe("Nada");
  });
});

describe("the Date line", () => {
  test("day-month-year first, month-day-year second when both fit", () => {
    expect(dateCandidates("13-10-2026")).toEqual(["2026-10-13"]);
    expect(dateCandidates("04-10-2026")).toEqual(["2026-10-04", "2026-04-10"]);
    expect(dateCandidates("2026-10-14")).toEqual(["2026-10-14"]);
    expect(dateCandidates("13102026")).toEqual(["2026-10-13"]);
    expect(dateCandidates("31-02-2026")).toEqual([]);
    expect(dateCandidates(null)).toEqual([]);
  });
});

describe("the quality note (the old radar's lazy rule, never a strike)", () => {
  test("the CSR form: under 50 words and Wins left as '.'", () => {
    const p = parse(makeCsr, CH.csr);
    expect(p.words).toBeLessThan(50);
    expect(p.quality).toBe(`Under 50 words (${p.words}); No wins, blockers or plan for tomorrow`);
  });
  test("a heading answered on the lines under it counts", () => {
    expect(parse(makeNextDay).quality).toBeNull();
  });
  test("'Wins From Today - --' is blank, and the next question is not its answer", () => {
    expect(hasWinsBlockersOrPlan(["Wins From Today - --", "1% improvement - --"])).toBe(false);
    expect(hasWinsBlockersOrPlan(["Blockers / decisions needed - Nothing"])).toBe(true);
    expect(hasWinsBlockersOrPlan(["*BLOCKERS*", "", "*DAY SUMMARY*", "Busy day"])).toBe(false);
    expect(qualityNote(["*TOMORROW'S PLAN*", "Finish the Madan cut"], 120)).toBeNull();
  });
});

describe("who a name means", () => {
  test("every word of the name is a word of the roster name", () => {
    expect(fits(person(19), "Nada")).toBe(true);
    expect(fits(person(28), "rasem abdel all")).toBe(true);
    expect(fits(person(18), "Muhammed Burhan")).toBe(true);
    expect(fits(person(21), "Ahmed Sabry")).toBe(true);
    expect(fits(person(4), "Ahmed Sabry")).toBe(false);
  });

  test("the email's local part catches a spelling the roster does not have", () => {
    expect(fits(person(4), "Ahmed Abushaiba")).toBe(true);
    expect(matchName(PEOPLE, "Ahmed Abushaiba")).toEqual({ kind: "one", person: person(4) });
  });

  test("two people with the same first name: the channel, then the form's header decides", () => {
    // Three Ahmeds: the closer, the creative strategist and a video editor.
    expect(matchName(PEOPLE, "Ahmed").kind).toBe("many");
    const inMedia = matchName(PEOPLE, "Ahmed", { channel: CH.media });
    expect(inMedia.kind).toBe("many");
    expect(matchName(PEOPLE, "Ahmed", { channel: CH.media, header: "VIDEO EDITOR" })).toEqual({ kind: "one", person: person(27) });
    expect(matchName(PEOPLE, "Ahmed", { channel: CH.media, header: "CREATIVE DIRECTOR" })).toEqual({ kind: "one", person: person(21) });
    expect(matchName(PEOPLE, "Ahmed", { channel: CH.sales })).toEqual({ kind: "one", person: person(4) });
    // Never a guess: no header and two Ahmeds in the channel is nobody.
    expect(matchName(PEOPLE, "Ahmed", { channel: CH.media, header: null }).kind).toBe("many");
    expect(parse(ahmedOnly("VIDEO EDITOR")).header).toBe("VIDEO EDITOR");
  });

  test("headers fit their roles", () => {
    expect(headerFits("CSR", "Call centre agent")).toBe(true);
    expect(headerFits("SALES REP", "Closer")).toBe(true);
    expect(headerFits("CREATIVE DIRECTOR", "Creative strategist")).toBe(true);
    expect(headerFits("VIDEO EDITOR", "Creative strategist")).toBe(false);
  });

  test("names are read without case or accents", () => {
    expect(nameWords("  Rasem ABDEL-all ")).toEqual(["rasem", "abdel", "all"]);
    expect(nameWords("Zoë")).toEqual(["zoe"]);
  });

  test("Saleh's id on Rasem's EOD is a deleted member, so the Name line decides", () => {
    expect(parse(makeWrongSubmitter, CH.csms).submittedBy).toBe("U09SHBK2C9F");
    expect(PEOPLE.some(p => p.slackUserId === "U09SHBK2C9F")).toBe(false);
  });
});
