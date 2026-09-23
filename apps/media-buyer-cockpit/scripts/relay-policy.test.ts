import { expect, test } from "bun:test";
import { shouldMarkThreadReading } from "../convex/relayPolicy";

test("real cockpit chats receive reading notifications", () => {
  for (const app of ["local", "csm", "creative"])
    expect(shouldMarkThreadReading(app)).toBe(true);
});

test("internal reply drafts and fix jobs never hit a cockpit chatReading validator", () => {
  for (const app of ["wadraft", "fix"])
    expect(shouldMarkThreadReading(app)).toBe(false);
});
