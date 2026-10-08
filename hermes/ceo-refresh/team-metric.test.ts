import { describe, expect, test } from "bun:test";
import { DEFINITIONS } from "./native/metrics.ts";
import { team } from "./native/adapters/team.js";
import { KUWAIT_OFFSET_MS, kuwaitDay } from "./native/time.js";
import { withRuntime, type Runtime, type Repository, type ProviderTools, type Row } from "./runtime.ts";

function createTeamRepository(overrides: Partial<Awaited<ReturnType<Repository["team"]>>> = {}): Repository {
  const defaultTeamData = {
    chat: [],
    manualChanges: [],
    decisions: [],
    digests: [],
    adChanges: [],
    adChangesRows: 1,
    commentsToday: [],
    eods: [],
    statuses: [],
    statusChanges: [],
    members: [],
    ...overrides,
  };

  return {
    async read() { return []; },
    async delivery() { return {}; },
    async clients() { return {}; },
    async billing() { return {}; },
    async jobs() { return []; },
    async sources() { return []; },
    async staleJobs() { return []; },
    async askAiHealth() { return {}; },
    async team() { return defaultTeamData; },
  };
}

function createMockRuntime(repository: Repository, readImpl?: (project: string, query: string) => Promise<Row[]>): Runtime {
  const tools: ProviderTools = {
    async graph() { return {}; },
    async request() { return new Response(); },
    async clickup() { return {}; },
    async typeform() { return {}; },
    async hiring() { return {}; },
    async youtubeToken() { return ""; },
    async rest() { return {}; },
  };

  return {
    env: (_name: string) => undefined,
    read: readImpl ?? (async (_project: string, _query: string) => []),
    repository,
    tools,
  };
}

describe("Team Metric Contract & Definitions Regression", () => {
  test("native DEFINITIONS contract: every daily metric is team-prefixed and defined under section 'team'", () => {
    const teamDailyMetricName = "team.actions";

    const teamDailyDef = DEFINITIONS.find(d => d.metric === teamDailyMetricName);
    const legacyDailyDef = DEFINITIONS.find(d => d.metric === "team_actions");

    // Regression check: DEFINITIONS currently lacks both team_actions and team.actions
    expect(legacyDailyDef).toBeUndefined();
    // This assertion documents the missing definition bug in DEFINITIONS
    expect(teamDailyDef).toBeDefined();

    if (teamDailyDef) {
      expect(teamDailyDef.section).toBe("team");
      expect(teamDailyDef.unit).toBe("count");
    }
  });

  test("team adapter contract: daily metrics must be team-prefixed to satisfy worker validation", async () => {
    const repository = createTeamRepository();
    const runtime = createMockRuntime(repository);

    const result = await withRuntime(runtime, async () => team.compute({ repository }));

    expect(result.daily).toBeDefined();
    expect(Array.isArray(result.daily)).toBe(true);

    const dailyPoints = result.daily!;
    expect(dailyPoints.length).toBeGreaterThan(0);

    for (const point of dailyPoints) {
      // Worker validateDaily contract: row.metric.startsWith(`${key}.`) where key is "team"
      expect(point.metric.startsWith("team.")).toBe(true);
      expect(point.metric).toBe("team.actions");
      expect(typeof point.value).toBe("number");
      expect(Number.isFinite(point.value)).toBe(true);
      expect(typeof point.scope).toBe("string");
      expect(point.scope.length).toBeGreaterThan(0);
      expect(/^\d{4}-\d{2}-\d{2}$/.test(point.date)).toBe(true);
    }
  });

  test("team adapter action count: human events and comments count, while machine and leadership are excluded", async () => {
    const now = Date.now();
    const today = kuwaitDay(now);
    const todayStart = new Date(`${today}T00:00:00Z`).getTime() - KUWAIT_OFFSET_MS;
    const actionTime = todayStart + 3600_000;

    const repository = createTeamRepository({
      commentsToday: [
        { by: "Sarah Specialist", at: actionTime, text: "Followed up with client" },
        { by: "Hermes", at: actionTime, text: "Hermes automated summary" },
        { by: "Claude", at: actionTime, text: "Claude bot note" },
        { by: "Clickbot", at: actionTime, text: "Automated bot sync" },
        { by: "Meta", at: actionTime, text: "Meta webhook sync" },
        { by: "Aziz", at: actionTime, text: "Leadership review note" },
        { by: "Abdulaziz", at: actionTime, text: "Leadership second review note" },
      ],
      manualChanges: [
        { campaignName: "Client Alpha", what: "Renamed the board card", at: actionTime },
        { campaignName: "Rehearsal Test", what: "Rehearsal build item", at: actionTime },
        { campaignName: "Delete Me Test", what: "Test campaign build", at: actionTime },
      ],
      decisions: [
        { subject: "Client Beta", role: "media_buyer", kind: "accept", action: "Approved spend increase", at: actionTime },
      ],
      chat: [
        { campaignName: "Client Gamma", kind: "action", text: "Renamed board card", at: actionTime, ok: true },
        { campaignName: "Client Gamma", kind: "action", text: "Hermes: verify spend rate", at: actionTime, ok: true },
      ],
    });

    const runtime = createMockRuntime(repository);
    const result = await withRuntime(runtime, async () => team.compute({ repository }));

    expect(result.daily).toBeDefined();
    const dailyPoint = result.daily!.find(d => d.metric === "team.actions" || d.metric === "team_actions");
    expect(dailyPoint).toBeDefined();

    // 1 human comment + 1 non-rehearsal manual change + 1 decision + 1 human chat action = 4 actions
    // Excluded: 4 machines (Hermes, Claude, Clickbot, Meta), 2 leadership (Aziz, Abdulaziz), 2 rehearsal changes, 1 Hermes read action
    expect(dailyPoint!.value).toBe(4);
  });

  test("team adapter action count: confirmed real zero when no activity occurs", async () => {
    const repository = createTeamRepository({
      commentsToday: [],
      manualChanges: [],
      decisions: [],
      chat: [],
      adChanges: [],
      digests: [],
    });

    const runtime = createMockRuntime(repository);
    const result = await withRuntime(runtime, async () => team.compute({ repository }));

    expect(result.daily).toBeDefined();
    const dailyPoint = result.daily!.find(d => d.metric === "team.actions" || d.metric === "team_actions");
    expect(dailyPoint).toBeDefined();
    expect(dailyPoint!.value).toBe(0);
  });

  test("team adapter source trust: unreadable source fails rather than emitting fake zero", async () => {
    const repository: Repository = {
      ...createTeamRepository(),
      async team() {
        throw new Error("Repository team query failed: connection timeout");
      },
    };

    const runtime = createMockRuntime(repository);

    await expect(withRuntime(runtime, async () => team.compute({ repository }))).rejects.toThrow(
      "Repository team query failed: connection timeout"
    );
  });
});
