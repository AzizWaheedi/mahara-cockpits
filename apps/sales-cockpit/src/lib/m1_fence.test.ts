// The Milestone 1 fence as the cockpit reads it (sendrules.ts agentOff and
// agentWorkOff): the drafts reps approve keep followups.enabled; the agent's
// own sends (waves, openers, confirmations, sends that need no approval)
// need followups.agent too, and no value, or settings not read, is off.
import { describe, expect, test } from "bun:test";
import { agentOff, agentWorkOff } from "./waves";

describe("the follow-up agent's two switches", () => {
  test("the drafts reps approve: on unless enabled is off", () => {
    expect(agentOff({ enabled: true })).toBe(false);
    expect(agentOff({})).toBe(false);
    expect(agentOff({ enabled: false })).toBe(true);
    expect(agentOff(null)).toBe(false);
  });

  test("the agent's own sends: on only when agent is true and enabled is not off", () => {
    expect(agentWorkOff({ enabled: true })).toBe(true);
    expect(agentWorkOff({ enabled: true, agent: false })).toBe(true);
    expect(agentWorkOff({ enabled: true, agent: "true" })).toBe(true);
    expect(agentWorkOff({ enabled: false, agent: true })).toBe(true);
    expect(agentWorkOff({ enabled: true, agent: true })).toBe(false);
    expect(agentWorkOff({ agent: true })).toBe(false);
    // Settings not read yet: the waves card says off, never on.
    expect(agentWorkOff(null)).toBe(true);
    expect(agentWorkOff(undefined)).toBe(true);
  });
});
