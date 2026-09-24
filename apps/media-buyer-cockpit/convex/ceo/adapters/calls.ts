import { projectCallCenterReports } from "../callCenterProjection";
import { readCallCenterReport } from "../callCenterSource";
import { addDays, kuwaitDay } from "../time";
import type { Adapter } from "../types";

/** One canonical Supabase report, shared with the dialer. No phone joins or clock formulas here. */
export const calls: Adapter = {
  key: "calls",
  label: "Call center",
  compute: async () => {
    const today = kuwaitDay();
    // Two bounded reads per 15-minute refresh. True period medians and distinct
    // lead counts come from the RPC, never a sum or average of daily results.
    const [report, report7d] = await Promise.all([
      readCallCenterReport(addDays(today, -29), today),
      readCallCenterReport(addDays(today, -6), today),
    ]);
    const payload = projectCallCenterReports(report, report7d);
    return {
      payload,
      sources: [
        {
          name: "Supabase shared call center report v1 (power dialer and CEO)",
          ok: true,
          note: "Team & Payroll working hours. Coverage and import watermarks are included in the shared report.",
        },
      ],
    };
  },
};
