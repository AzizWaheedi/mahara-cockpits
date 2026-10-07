import type { SupabaseClient } from "@supabase/supabase-js";
export type EodRole = "media_buyer" | "csm" | "creative";
export type PersonalEodContext = {
  owner: string;
  day: string;
  report: any;
  delivery: "not_configured";
};
function checked(data: any): PersonalEodContext {
  if (
    !data ||
    typeof data.owner !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      data.owner,
    ) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(data.day) ||
    data.delivery !== "not_configured" ||
    (data.report !== null &&
      (typeof data.report !== "object" ||
        data.report.owner_user_id !== data.owner ||
        data.report.day !== data.day ||
        typeof data.report.answers !== "object"))
  )
    throw new Error("The server did not confirm your EOD.");
  if (data.report) {
    const r = data.report;
    if (
      !Number.isSafeInteger(Number(r.id)) ||
      Number(r.id) <= 0 ||
      !Number.isFinite(Date.parse(r.updated_at)) ||
      (r.submitted_at !== null &&
        !Number.isFinite(Date.parse(r.submitted_at))) ||
      !r.answers ||
      Array.isArray(r.answers) ||
      !r.computed ||
      typeof r.computed !== "object" ||
      Array.isArray(r.computed)
    )
      throw new Error("The server returned an invalid EOD report.");
    data = {
      ...data,
      report: {
        ...r,
        _id: String(r.id),
        at: Date.parse(r.updated_at),
        submittedAt: r.submitted_at ? Date.parse(r.submitted_at) : null,
        deliveryStatus: "not_configured",
      },
    };
  }
  return data;
}
export async function readPersonalEod(
  client: SupabaseClient,
  role: EodRole,
  day?: string,
) {
  const { data, error } = await client.rpc("cockpit_personal_eod", {
    p_role: role,
    p_day: day ?? null,
  });
  if (error) throw new Error(error.message);
  return checked(data);
}
export async function savePersonalEod(
  client: SupabaseClient,
  role: EodRole,
  context: { owner: string; day: string },
  args: Record<string, unknown>,
) {
  if (!context.owner || !context.day)
    throw new Error("Reload your EOD before saving.");
  const patch = Object.fromEntries(
    Object.entries(args).filter(([, value]) => value !== undefined),
  );
  const { data, error } = await client.rpc("cockpit_save_personal_eod", {
    p_role: role,
    p_patch: patch,
    p_expected_owner: context.owner,
    p_day: context.day,
  });
  if (error) throw new Error(error.message);
  return checked(data);
}
