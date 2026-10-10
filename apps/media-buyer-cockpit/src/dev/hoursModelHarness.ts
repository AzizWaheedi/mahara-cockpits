/**
 * The layout harness's stand-in for hoursModel.ts: the month comes from the
 * hand-made fixture (hoursFixture.ts) instead of the rule, so the screens
 * render every state without real inputs. With `?hours=e2e` the real rule
 * works the month out from real backend output instead (hoursHarness.ts).
 * vite.harness.config.ts points the client's import of the model here.
 * Never imported by the production app.
 */
import * as rule from "@/types/ceo/hoursModel";
import type { HoursInputs, HoursMonth } from "../types/ceo/hoursContract";
import { type HoursScenario, hoursFixtureMonth } from "./hoursFixture";
import { hoursScenario } from "./hoursHarness";

export function computeMonth(inputs: HoursInputs): HoursMonth {
  const scenario = hoursScenario();
  if (scenario === "e2e") return rule.computeMonth(inputs);
  const { inputs: _inputs, ...month } = hoursFixtureMonth(
    scenario as HoursScenario,
    inputs.month,
  );
  return month;
}

export async function hashMonth(month: HoursMonth): Promise<HoursMonth> {
  return hoursScenario() === "e2e" ? rule.hashMonth(month) : month;
}
