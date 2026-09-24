import { creativeRequestRest } from "../tools";
import { callCenterRange, parseCallCenterReport } from "./callCenterContract";

/** Service-role RPC through the existing instrumented Supabase transport; never browser credentials. */
export async function readCallCenterReport(from: string, to: string) {
  callCenterRange(from, to);
  const raw = await creativeRequestRest<unknown>(
    "rpc/mahara_call_center_report",
    {
      method: "POST",
      body: { p_from: from, p_to: to, p_agent: null, p_client: null },
    },
  );
  return parseCallCenterReport(raw, from, to);
}
