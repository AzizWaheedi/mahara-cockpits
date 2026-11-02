import { describe, expect, test } from "bun:test";
import {
  CLICKUP_BUSY,
  CLICKUP_BUSY_LANDED,
  CLICKUP_RETRY_MAX_MS,
  CLICKUP_RETRY_MIN_MS,
  clickupBusy,
  clickupRetryWait,
} from "./clickupRetry";

// The wait before the one retry after ClickUp's 429
// (docs/requests/CLICKUP-DOWNGRADE.md 2.1): ClickUp's own wait, 1 s to 5 s.

const NOW = Date.parse("2026-10-29T09:00:00Z");
const h = (headers: Record<string, string>) => new Headers(headers);

describe("clickupRetryWait", () => {
  test("Retry-After in seconds comes first", () => {
    expect(clickupRetryWait(h({ "Retry-After": "2" }), NOW)).toBe(2_000);
    expect(
      clickupRetryWait(
        h({ "Retry-After": "3", "X-RateLimit-Reset": String(NOW / 1000 + 1) }),
        NOW,
      ),
    ).toBe(3_000);
  });

  test("X-RateLimit-Reset as epoch seconds is read against the clock", () => {
    expect(
      clickupRetryWait(h({ "X-RateLimit-Reset": String(NOW / 1000 + 3) }), NOW),
    ).toBe(3_000);
    // 30 s away is more than the 5 s a person is kept waiting.
    expect(
      clickupRetryWait(
        h({ "X-RateLimit-Reset": String(NOW / 1000 + 30) }),
        NOW,
      ),
    ).toBe(CLICKUP_RETRY_MAX_MS);
    // Already past: the shortest wait.
    expect(
      clickupRetryWait(h({ "X-RateLimit-Reset": String(NOW / 1000 - 5) }), NOW),
    ).toBe(CLICKUP_RETRY_MIN_MS);
  });

  test("a small X-RateLimit-Reset is seconds from now, clamped to 1 s to 5 s", () => {
    expect(clickupRetryWait(h({ "X-RateLimit-Reset": "30" }), NOW)).toBe(5_000);
    expect(clickupRetryWait(h({ "X-RateLimit-Reset": "0.2" }), NOW)).toBe(
      1_000,
    );
    expect(clickupRetryWait(h({ "X-RateLimit-Reset": "4" }), NOW)).toBe(4_000);
  });

  test("no header, a zero, a negative or garbage waits 1 s", () => {
    expect(clickupRetryWait(h({}), NOW)).toBe(1_000);
    expect(clickupRetryWait(h({ "Retry-After": "soon" }), NOW)).toBe(1_000);
    expect(clickupRetryWait(h({ "Retry-After": "0" }), NOW)).toBe(1_000);
    expect(clickupRetryWait(h({ "Retry-After": "-4" }), NOW)).toBe(1_000);
    expect(clickupRetryWait(h({ "X-RateLimit-Reset": "later" }), NOW)).toBe(
      1_000,
    );
    expect(clickupRetryWait(h({ "Retry-After": " " }), NOW)).toBe(1_000);
  });

  test("garbage in Retry-After falls through to a good X-RateLimit-Reset", () => {
    expect(
      clickupRetryWait(
        h({ "Retry-After": "x", "X-RateLimit-Reset": String(NOW / 1000 + 2) }),
        NOW,
      ),
    ).toBe(2_000);
  });
});

describe("clickupBusy", () => {
  test("keeps the helper's sentence first, then says what to do next", () => {
    expect(
      clickupBusy("ClickUp rejected the request (429); inspect its receipt."),
    ).toBe(
      `ClickUp rejected the request (429); inspect its receipt. ${CLICKUP_BUSY}`,
    );
    expect(
      clickupBusy("clickup rejected the request (429): Rate limit reached"),
    ).toBe(
      `clickup rejected the request (429): Rate limit reached. ${CLICKUP_BUSY}`,
    );
    expect(CLICKUP_BUSY).toBe(
      "ClickUp is at its limit of calls this minute and refused this step.",
    );
  });

  test("speaks for the refused call only; an earlier write that went through is named", () => {
    // A press can make several calls (fields, a ticket, a comment): the refused one is all the helper knows about.
    const first = clickupBusy(
      "ClickUp rejected the request (429); inspect its receipt.",
    );
    const later = clickupBusy(
      "ClickUp rejected the request (429); inspect its receipt.",
      true,
    );
    expect(later).toBe(
      `ClickUp rejected the request (429); inspect its receipt. ${CLICKUP_BUSY} ${CLICKUP_BUSY_LANDED}`,
    );
    expect(CLICKUP_BUSY_LANDED).toBe(
      "An earlier step of this action already went through, so check what it changed before you try again.",
    );
    for (const m of [first, later]) {
      expect(m).not.toMatch(/nothing was changed/i);
      expect(m).not.toContain("Try again in a minute");
    }
    expect(first).not.toContain(CLICKUP_BUSY_LANDED);
  });
});
