import type { SupabaseClient } from "@supabase/supabase-js";
import { normaliseSchedule } from "../types/ceo/schedule";
import { peopleRoles, peopleRoster } from "./ceoPeopleModel";

async function rows(
  client: SupabaseClient,
): Promise<Record<string, unknown>[]> {
  const { data, error } = await client.rpc("cockpit_ceo_people_list");
  if (error) throw new Error(error.message);
  if (
    !Array.isArray(data) ||
    data.some(
      r =>
        !r ||
        typeof r !== "object" ||
        !Number.isSafeInteger(Number(r.id)) ||
        typeof r.name !== "string" ||
        typeof r.active !== "boolean" ||
        (r.monthly_cost !== null &&
          (r.monthly_cost === undefined ||
            !Number.isFinite(Number(r.monthly_cost)))),
    )
  ) {
    throw new Error("The roster was not confirmed by the server.");
  }
  return data;
}
export async function readPeople(client: SupabaseClient) {
  return peopleRoster(await rows(client));
}
export async function readPeopleRoles(client: SupabaseClient) {
  return peopleRoles(await rows(client));
}
export async function savePerson(
  client: SupabaseClient,
  args: Record<string, unknown>,
) {
  const patch = Object.fromEntries(
    Object.entries(args).filter(([, v]) => v !== undefined),
  );
  for (const key of ["monthlyCost", "commissionPct", "commissionRate"]) {
    if (
      Object.hasOwn(patch, key) &&
      patch[key] !== null &&
      (typeof patch[key] !== "number" || !Number.isFinite(patch[key]))
    ) {
      throw new Error("Costs and commission rates must be finite numbers.");
    }
  }
  if (Object.hasOwn(patch, "schedule") && patch.schedule !== null)
    patch.schedule = normaliseSchedule(patch.schedule);
  const { data, error } = await client.rpc("cockpit_ceo_people_save", {
    p_patch: patch,
  });
  if (error) throw new Error(error.message);
  if (
    !data ||
    data.ok !== true ||
    !Number.isSafeInteger(Number(data.id)) ||
    Number(data.id) <= 0
  )
    throw new Error("The roster save was not confirmed.");
  return { ok: true as const, id: Number(data.id) };
}
export async function setPersonActive(
  client: SupabaseClient,
  args: Record<string, unknown>,
) {
  if (!Object.hasOwn(args, "id") || typeof args.active !== "boolean")
    throw new Error("Choose a person and their active status.");
  return savePerson(client, args);
}
export async function setPersonPay(
  client: SupabaseClient,
  args: Record<string, unknown>,
) {
  const patch = Object.fromEntries(
    Object.entries(args).filter(([, v]) => v !== undefined),
  );
  if (!Number.isSafeInteger(patch.id) || Number(patch.id) <= 0)
    throw new Error("Choose a person to change pay.");
  for (const key of ["monthlyCost", "commissionRate"]) {
    const value = patch[key];
    if (
      value !== undefined &&
      value !== null &&
      (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    )
      throw new Error(
        "Costs and commission rates must be finite, nonnegative numbers.",
      );
  }
  const { data, error } = await client.rpc("cockpit_ceo_people_set_pay", {
    p_patch: patch,
  });
  if (error) throw new Error(error.message);
  if (!data || data.ok !== true || data.id !== patch.id)
    throw new Error("The pay save was not confirmed.");
  return { ok: true as const, id: Number(data.id) };
}
