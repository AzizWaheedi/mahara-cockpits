import { describe, expect, test } from "bun:test";
import {
  ApiError,
  answerFailure,
  CUT,
  readFailure,
  sendFailure,
  timeoutWords,
  UNREACHED,
  uncertain,
} from "./apiErrors";

describe("a call that got no clear answer", () => {
  test("45 seconds with no answer may still go through", () => {
    const e = sendFailure(true, 45_000);
    expect(e.kind).toBe("timeout");
    expect(e.message).toBe(
      "The cockpit did not answer within 45 seconds. It may still go through, so check before you try again.",
    );
    expect(timeoutWords(4_000)).toContain("within 4 seconds");
    expect(uncertain(e)).toBe(true);
  });

  test("no connection keeps the sentence the cockpit always said", () => {
    const e = sendFailure(false, 45_000);
    expect(e.kind).toBe("network");
    expect(e.message).toBe(UNREACHED);
    expect(UNREACHED).toBe(
      "The cockpit could not reach its server. Check the connection and try again.",
    );
  });

  test("an answer that broke off is not a no", () => {
    const e = readFailure(false, 200, 45_000);
    expect(e.kind).toBe("cut");
    expect(e.status).toBe(200);
    expect(e.message).toBe(CUT);
    expect(uncertain(e)).toBe(true);
    expect(readFailure(true, 200, 45_000).kind).toBe("timeout");
  });
});

describe("an answer", () => {
  test("a yes is no failure", () => {
    expect(answerFailure(200, { ok: true })).toBeNull();
  });

  test("a refusal keeps the server's sentence and its status", () => {
    const e = answerFailure(409, {
      ok: false,
      error: "This call was already saved.",
    });
    expect(e).toBeInstanceOf(ApiError);
    expect(e?.kind).toBe("refused");
    expect(e?.status).toBe(409);
    expect(e?.message).toBe("This call was already saved.");
    expect(uncertain(e)).toBe(false);
  });

  test("a server failure may still have done the work", () => {
    const e = answerFailure(502, {
      ok: false,
      error: "The call did not go through: Maqsam did not answer.",
    });
    expect(e?.kind).toBe("server");
    expect(uncertain(e)).toBe(true);
  });

  test("something that is not an answer says the status, as before", () => {
    expect(answerFailure(504, null)?.message).toBe(
      "The server answered 504. Try again.",
    );
    expect(answerFailure(200, null)?.message).toBe(
      "The server answered 200. Try again.",
    );
    expect(answerFailure(200, null)?.kind).toBe("server");
  });

  test("only the cockpit's own errors count as uncertain", () => {
    expect(uncertain(new Error("x"))).toBe(false);
    expect(uncertain(null)).toBe(false);
    expect(uncertain(new ApiError("Sign in again.", "signin"))).toBe(false);
  });
});
