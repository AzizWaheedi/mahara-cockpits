import { describe, expect, test } from "bun:test";
import {
  boardStatusAfter,
  cardFor,
  changeComment,
  changesForCard,
  isChange,
  isClientOf,
} from "../convex/changeLog";
import {
  accountIndex,
  budgetToUsd,
  budgetWords,
  rowKeys,
  spendToUsd,
  usdToBudget,
} from "../convex/currency";
import {
  backlogNote,
  deliverable,
  isRefusal,
  LATE_MS,
  MAX_TRIES,
  STALE_MS,
  settled,
} from "../convex/outboxCore";

const NOW = Date.parse("2026-10-06T12:00:00Z");

describe("the outbox never jams again", () => {
  test("fifty exhausted rows in front do not hide the live ones behind them", () => {
    // The state found on 2026-10-06: the 50 oldest open rows had all failed
    // five times, so the old `take(50)` then `tries < 5` returned nothing.
    const dead = Array.from({ length: 50 }, (_, i) => ({
      id: `dead${i}`,
      tries: MAX_TRIES,
      at: NOW - 30 * 86_400_000 + i,
    }));
    const live = Array.from({ length: 10 }, (_, i) => ({
      id: `live${i}`,
      tries: 0,
      at: NOW - 60_000 + i,
    }));
    const picked = deliverable([...dead, ...live]);
    expect(picked.map(r => r.id)).toEqual(live.map(r => r.id));
  });

  test("the fifth failure closes the row with its reason", () => {
    const out = settled({ tries: 4 }, false, NOW, "HTTP 400 field refused");
    expect(out.doneAt).toBe(NOW);
    expect(out.gaveUpAt).toBe(NOW);
    expect(out.lastError).toContain("gave up after 5 tries");
    expect(out.lastError).toContain("HTTP 400 field refused");
  });

  test("an earlier failure stays open for the next try", () => {
    const out = settled({ tries: 1 }, false, NOW, "HTTP 503");
    expect(out.doneAt).toBeUndefined();
    expect(out.tries).toBe(2);
  });

  test("a refusal is told apart from a blip", () => {
    expect(isRefusal("Error: HTTP 405 https://api.clickup.com/x: method")).toBe(
      true,
    );
    expect(isRefusal("HTTP 400 https://api.clickup.com/x: bad value")).toBe(
      true,
    );
    expect(isRefusal("HTTP 404 https://api.clickup.com/x: not found")).toBe(
      true,
    );
    expect(isRefusal("HTTP 429 rate limited")).toBe(false);
    expect(isRefusal("HTTP 401 token revoked")).toBe(false);
    expect(isRefusal("HTTP 502 bad gateway")).toBe(false);
    expect(isRefusal("CLICKUP_API_TOKEN is not set")).toBe(false);
    expect(isRefusal("TypeError: fetch failed")).toBe(false);
  });

  test("the health line fails only when a write has waited too long", () => {
    expect(backlogNote([], NOW).ok).toBe(true);
    expect(backlogNote([{ at: NOW - 60_000 }], NOW).ok).toBe(true);
    const late = backlogNote(
      [
        { at: NOW - LATE_MS - 60_000, lastError: "HTTP 503 down" },
        { at: NOW - 60_000 },
      ],
      NOW,
    );
    expect(late.ok).toBe(false);
    expect(late.error).toContain("1 media buyer change is waiting");
    expect(late.error).toContain("HTTP 503 down");
    // Rows past two days are closed unsent on the next pass, not waiting:
    // they raised a false alarm while the old backlog closed (2026-10-06).
    expect(backlogNote([{ at: NOW - STALE_MS - 60_000 }], NOW).ok).toBe(true);
  });
});

describe("Ardon's riyals", () => {
  test("a riyal budget reads in dollars", () => {
    // 175 SAR a day, as Meta stores it (minor units).
    expect(budgetToUsd("17500", "SAR")).toBeCloseTo(46.66, 2);
    expect(budgetToUsd("3800", "USD")).toBe(38);
    expect(budgetToUsd(undefined, "SAR")).toBeUndefined();
    expect(budgetToUsd("0", "USD")).toBeUndefined();
  });

  test("a typed dollar budget goes to Meta in the account's currency", () => {
    expect(usdToBudget(38, "USD")).toBe(3800);
    expect(usdToBudget(38, "SAR")).toBe(14254);
    expect(usdToBudget(38, "QAR")).toBe(13833);
  });

  test("a currency without a safe rate is refused, in words", () => {
    expect(() => usdToBudget(30, "KWD")).toThrow(/Ads Manager/);
    expect(() => usdToBudget(30, "JPY")).toThrow(/JPY/);
    expect(budgetToUsd("3000", "KWD")).toBeUndefined();
  });

  test("spend converts, and the change log names both amounts", () => {
    // Meta's last 7 days for Ardon_mahar-22\9 on 2026-10-06.
    expect(spendToUsd(1274.5, "SAR")).toBeCloseTo(339.78, 2);
    expect(spendToUsd(100, "USD")).toBe(100);
    expect(budgetWords(38, "USD")).toBe("$38");
    expect(budgetWords(38, "SAR")).toBe("$38 (142.54 SAR in Meta)");
  });

  test("the sheet's label for the account finds Meta's account", () => {
    const index = accountIndex([
      {
        id: "718146936708597",
        name: "718146936708597",
        currency: "SAR",
        spend30: 1572.77,
      },
      { id: "1059789685990610", name: "Ardon", currency: "SAR", spend30: 0 },
      { id: "1", name: "Castello add", currency: "USD", spend30: 900 },
    ]);
    expect(index.find("718146936708597, SAR")?.id).toBe("718146936708597");
    expect(index.currencyOf("718146936708597, SAR")).toBe("SAR");
    expect(index.currencyOf("castello add")).toBe("USD");
    expect(index.currencyOf("Ardon")).toBe("SAR");
    expect(index.currencyOf("Someone new")).toBeUndefined();
  });

  test("the same ad-day from the sheet and from Meta is one row", () => {
    const sheet = rowKeys({
      date: "2026-10-05",
      adId: "120253286399830526",
      campaign: "Ardon_mahar-22\\9",
      adSet: "Riyadh",
      adName: "ad-1",
    });
    const meta = rowKeys({
      date: "2026-10-05",
      adId: "120253286399830526",
      campaign: "Ardon_mahar-22\\9",
      adSet: "Riyadh",
      adName: "ad-1",
    });
    expect(meta.some(k => sheet.includes(k))).toBe(true);
    // No ad id in the sheet: the names still match.
    const named = rowKeys({
      date: "2026-10-05",
      campaign: "Ardon_mahar-22\\9",
      adSet: "Riyadh",
      adName: "AD-1",
    });
    expect(meta.some(k => named.includes(k))).toBe(true);
    // Another day is another row.
    const nextDay = rowKeys({
      date: "2026-10-06",
      adId: "120253286399830526",
    });
    expect(nextDay.some(k => sheet.includes(k))).toBe(false);
  });
});

describe("every change reaches the card", () => {
  const campaigns = [
    {
      campaignName: "Ola|mahara|13\\9",
      clientName: "Ola",
      clientTag: "ola",
      taskId: "86eywcnhy",
      spend7d: 240,
    },
    {
      campaignName: "Ola relaunch",
      clientName: "Ola",
      clientTag: "ola",
      spend7d: 20,
    },
    {
      campaignName: "Arcturus-Mahara-3\\9",
      clientName: "Arcturus",
      taskId: "86eyudahw",
      spend7d: 260,
    },
  ];

  test("a campaign with a card uses its own", () => {
    expect(cardFor("Ola|mahara|13\\9", campaigns)).toMatchObject({
      taskId: "86eywcnhy",
      ownCard: true,
    });
  });

  test("a campaign without a card uses its client's", () => {
    expect(cardFor("Ola relaunch", campaigns)).toMatchObject({
      taskId: "86eywcnhy",
      ownCard: false,
    });
  });

  test("a build filed under the client's name finds the client's card", () => {
    expect(cardFor("Arcturus", campaigns)?.taskId).toBe("86eyudahw");
    expect(cardFor("Nobody", campaigns)).toBeUndefined();
  });

  test("a question to Aziz is not a change", () => {
    expect(isChange("Asked Aziz: اعاده تفعيل الحمله")).toBe(false);
    expect(isChange("Is the form broken?")).toBe(false);
    expect(isChange('Turned off campaign "mardal" from the cockpit')).toBe(
      true,
    );
    expect(
      isChange(
        "Set the campaign's daily budget to $38 (the budget lives on the campaign)",
      ),
    ).toBe(true);
  });

  test("the comment says who made the change, and when", () => {
    const text = changeComment(
      {
        by: "nada@maharamedia.com",
        campaignName: "Ola|mahara|13\\9",
        what: "Set the campaign's daily budget to $38",
        at: NOW - 60_000,
      },
      NOW,
    );
    expect(text).toContain("CHANGE MADE");
    expect(text).toContain("nada@maharamedia.com");
    expect(text).toContain("on 6 Oct 2026");
    expect(text).toContain("Three days before this is judged");
    // Posted late: dated, and no clock that has already run.
    const late = changeComment(
      { by: "cockpit", campaignName: "x", what: "y", at: NOW - 2 * 86_400_000 },
      NOW,
    );
    expect(late).toContain("the media buyer");
    expect(late).toContain("on 4 Oct 2026");
    expect(late).not.toContain("Three days");
  });

  test("a campaign finds its card by name, alias or a one-letter typo", () => {
    const arcturus = {
      name: "Arcturus Construction",
      aliases: ["arcturus", "arcturus construction"],
    };
    expect(isClientOf("Acturus Construction", arcturus)).toBe(true);
    expect(isClientOf("Arcturus Construction", arcturus)).toBe(true);
    expect(isClientOf("arcturus", arcturus)).toBe(true);
    expect(isClientOf("Atlantis Contracting", arcturus)).toBe(false);
    expect(isClientOf(undefined, arcturus)).toBe(false);
    // Short names must match exactly: one letter is a different client.
    expect(isClientOf("Ola", { name: "Ula" })).toBe(false);
    expect(isClientOf("شركة العلا", { name: "شركة العلا" })).toBe(true);
  });

  test("the card's Ad Status follows Meta, never over a dead campaign", () => {
    expect(boardStatusAfter("PAUSED", "Live")).toBe("Paused");
    expect(boardStatusAfter("ACTIVE", "Paused")).toBe("Live");
    expect(boardStatusAfter("ACTIVE", "Live")).toBeUndefined();
    expect(boardStatusAfter("PAUSED", "Dead Campaign")).toBeUndefined();
    expect(boardStatusAfter("PAUSED", undefined)).toBe("Paused");
    expect(boardStatusAfter("ARCHIVED", "Live")).toBeUndefined();
  });

  test("the CSM card carries the client's last 90 days of changes", () => {
    const day = 86_400_000;
    const all = [
      {
        subject: "Ola|mahara|13\\9",
        action: "Budget to $38",
        kind: "change",
        evidence: "",
        day: "2026-10-04",
        at: NOW - 2 * day,
      },
      {
        subject: "Ola|mahara|13\\9",
        action: "Paused ad 2",
        kind: "change",
        evidence: "",
        day: "2026-09-20",
        at: NOW - 16 * day,
      },
      {
        subject: "Ola",
        action: "Built a new campaign",
        kind: "change",
        evidence: "",
        day: "2026-10-05",
        at: NOW - day,
      },
      {
        subject: "Ola|mahara|13\\9",
        action: "Too old",
        kind: "change",
        evidence: "",
        day: "2026-06-01",
        at: NOW - 120 * day,
      },
      {
        subject: "Arcturus-Mahara-3\\9",
        action: "Budget to $38",
        kind: "change",
        evidence: "",
        day: "2026-10-05",
        at: NOW - day,
      },
    ];
    const ola = {
      name: "Ola",
      campaigns: ["Ola|mahara|13\\9", "Ola relaunch"],
    };
    // Newest first, the client's own only, nothing past 90 days.
    expect(changesForCard(all, ola, NOW).map(c => c.action)).toEqual([
      "Built a new campaign",
      "Budget to $38",
      "Paused ad 2",
    ]);
    expect(changesForCard(all, ola, NOW, { days: 14 })).toHaveLength(2);
    expect(changesForCard(all, ola, NOW, { max: 1 })).toHaveLength(1);
  });
});
