import { expect, test } from "bun:test";
import { launchFixture } from "../src/dev/launchFixture";
import {
  accountStatus,
  contractedBudget,
  defaultAccount,
  justLaunched,
  laneClients,
  nextAction,
} from "../src/lib/launchModel";

test("missing status remains unknown, not healthy", () => {
  expect(accountStatus(null)).toContain("hourly read");
  expect(accountStatus(3)).toBe("Unpaid balance");
});
test("all five counts and readonly search agree with the lane filter", () => {
  const p = launchFixture();
  for (const lane of [
    "onboarding",
    "ready",
    "nothing",
    "waiting",
    "ads",
  ] as const)
    expect(laneClients(p, lane).length).toBe(p.lanes[lane]);
  const stopped = p.clients.find(c => c.readOnly)!;
  expect(nextAction(stopped)).toBe("View history");
});
test("only confirmed delivery reaches Just launched and native rows remove it", () => {
  const p = launchFixture("waiting-fresh");
  expect(justLaunched(p)).toHaveLength(0);
  const l = p.clients.flatMap(c => c.launches)[0];
  l.hasImpressions = true;
  expect(justLaunched(p)).toHaveLength(1);
  l.inAds = true;
  expect(justLaunched(p)).toHaveLength(0);
});
test("budget source order and healthy account default", () => {
  const c = launchFixture().clients[0];
  c.cards = [{ dailyAdSpend: 20 }];
  c.brief = { answers: { daily_budget: 30 } };
  c.handover = { daily_budget: 40 };
  expect(contractedBudget(c)).toEqual({ value: 20, source: "Ads card" });
  c.cards = [];
  expect(contractedBudget(c)?.value).toBe(30);
  c.brief = null;
  expect(contractedBudget(c)?.value).toBe(40);
  c.accounts = [
    { id: "bad", status: 3 } as any,
    { id: "good", status: 1 } as any,
  ];
  expect(defaultAccount(c)?.id).toBe("good");
});
