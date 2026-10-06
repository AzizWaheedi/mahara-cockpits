import { creativeRequestRest } from "./tools.js";
import { callCenterRange, parseCallCenterReport } from "./callCenterContract.js";
/** Service-role RPC through the existing instrumented Supabase transport; never browser credentials. */
export async function readCallCenterReport(from, to) {
    callCenterRange(from, to);
    const raw = await creativeRequestRest("rpc/mahara_call_center_report", {
        method: "POST",
        body: { p_from: from, p_to: to, p_agent: null, p_client: null },
    });
    return parseCallCenterReport(raw, from, to);
}
