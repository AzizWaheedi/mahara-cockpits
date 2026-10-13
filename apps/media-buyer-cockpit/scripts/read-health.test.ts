import { describe, expect, test } from "bun:test";
import {
  isTransient,
  markStale,
  RETRY_MS,
  retryDelay,
  staleReads,
  toError,
} from "../src/lib/readHealth";

// The shapes supabase-js 2.117 returns, taken from the 2026-10-13 restart.
const restarting = {
  code: "PGRST001",
  message: "Database client error. Retrying the connection.",
  details: null,
  hint: null,
};
const cloudflarePage = { message: "<!DOCTYPE html><html>520 error</html>" };
const noNetwork = {
  code: "",
  message: "TypeError: Failed to fetch",
  details: "",
  hint: "",
};
const refused = {
  code: "42501",
  message: "permission denied for function cockpit_media_statistics",
  details: null,
  hint: null,
};
const raised = { code: "P0001", message: "Statistics need a campaign." };

describe("toError", () => {
  test("a Supabase error object keeps its message, never [object Object]", () => {
    const error = toError(refused);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(refused.message);
    expect((error as Error & { code?: string }).code).toBe("42501");
    expect(String(error)).not.toContain("[object Object]");
  });

  test("an HTML error page becomes a sentence", () => {
    expect(toError(cloudflarePage).message).toBe(
      "The server did not answer. Try again in a moment.",
    );
    expect(toError(new Error("<html>bad gateway</html>")).message).toBe(
      "The server did not answer. Try again in a moment.",
    );
  });

  test("an object with no message and empty values still read as a sentence", () => {
    expect(toError({}).message).toBe(
      "The server did not answer. Try again in a moment.",
    );
    expect(toError(undefined).message).toBe(
      "The server did not answer. Try again in a moment.",
    );
    expect(toError("Sign in again").message).toBe("Sign in again");
  });

  test("a real Error is returned as it is", () => {
    const original = new Error("Sign in again");
    expect(toError(original)).toBe(original);
  });
});

describe("isTransient", () => {
  test("a restarting database, a gateway page and no network are worth a retry", () => {
    expect(isTransient(restarting)).toBe(true);
    expect(isTransient(cloudflarePage)).toBe(true);
    expect(isTransient(noNetwork)).toBe(true);
    expect(isTransient({ code: "57P03", message: "cannot connect now" })).toBe(
      true,
    );
    expect(isTransient({ code: "57014", message: "statement timeout" })).toBe(
      true,
    );
    expect(isTransient({ code: "PGRST303", message: "JWT expired" })).toBe(
      true,
    );
    expect(isTransient(new TypeError("Failed to fetch"))).toBe(true);
  });

  test("a refusal is not", () => {
    expect(isTransient(refused)).toBe(false);
    expect(isTransient(raised)).toBe(false);
    expect(isTransient({ code: "PGRST116", message: "no rows" })).toBe(false);
    expect(
      isTransient(new Error("An active confirmed cockpit seat is required.")),
    ).toBe(false);
    expect(isTransient(new Error("Order 5023 was refused"))).toBe(false);
  });
});

describe("retryDelay", () => {
  test("a passing failure is retried three times, then stops", () => {
    expect(retryDelay(restarting, 1)).toBe(RETRY_MS[0]);
    expect(retryDelay(restarting, 2)).toBe(RETRY_MS[1]);
    expect(retryDelay(restarting, 3)).toBe(RETRY_MS[2]);
    expect(retryDelay(restarting, 4)).toBeNull();
  });

  test("a refusal is not retried", () => {
    expect(retryDelay(refused, 1)).toBeNull();
  });
});

describe("markStale", () => {
  test("counts each read once and clears it", () => {
    const a = {};
    const b = {};
    const before = staleReads();
    markStale(a, true);
    markStale(a, true);
    markStale(b, true);
    expect(staleReads()).toBe(before + 2);
    markStale(a, false);
    markStale(b, false);
    markStale(b, false);
    expect(staleReads()).toBe(before);
  });
});
