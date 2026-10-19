import { projectCallCenterReports } from "../callCenterProjection.js";
import { readCallCenterReport } from "../callCenterSource.js";
import { addDays, kuwaitDay } from "../time.js";
/** One canonical Supabase report, shared with the dialer. No phone joins or clock formulas here. */
export const calls = {
    key: "calls",
    label: "Call center",
    compute: async () => {
        const today = kuwaitDay();
        // Two bounded reads per 15-minute refresh. True period medians and distinct
        // lead counts come from the RPC, never a sum or average of daily results.
        // One after the other: run together, the two report scans and their
        // retries overlapped on the Small database (2026-10-19 memory dips).
        const report = await readCallCenterReport(addDays(today, -29), today);
        const report7d = await readCallCenterReport(addDays(today, -6), today);
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
