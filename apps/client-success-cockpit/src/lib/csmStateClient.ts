import type { SupabaseClient } from "@supabase/supabase-js";

export type CsmState = {
  day: string;
  month: string;
  profiles: Record<string, any>[];
  prefs: { clientName: string; language: string }[];
  hotRows: Record<string, any>[];
  dismissed: { clientName: string; text: string }[];
  money: {
    month: string;
    target: number | null;
    clients: number | null;
    counts: Record<string, number>;
    byEmail: string;
    at: number;
  } | null;
};
export type CsmMoneyPatch = {
  month: string;
  target?: number | null;
  clients?: number | null;
  counts?: Record<string, number>;
};

export function csmMoneyPatch(
  month: string,
  targetEdit: string | null,
  clientsEdit: string | null,
  counts: Record<string, number>,
): CsmMoneyPatch {
  const result: CsmMoneyPatch = { month, counts };
  const numberOrNull = (value: string) => {
    if (!value.trim()) return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0)
      throw new Error("Enter a nonnegative number");
    return number;
  };
  if (targetEdit !== null) result.target = numberOrNull(targetEdit);
  if (clientsEdit !== null) {
    result.clients = numberOrNull(clientsEdit);
    if (result.clients !== null && !Number.isInteger(result.clients))
      throw new Error("Client count must be an integer");
  }
  return result;
}

async function rpc(
  client: SupabaseClient | null,
  name: string,
  args: Record<string, unknown>,
) {
  if (!client) throw new Error("Client-success sign-in is required");
  const { data, error } = await client.rpc(name, args);
  if (error)
    throw new Error(error.message || "Client-success operation failed");
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("Unrecognized client-success response");
  return data;
}

export async function readCsmState(
  client: SupabaseClient | null,
  month?: string,
): Promise<CsmState> {
  const data = await rpc(client, "cockpit_csm_state", {
    p_month: month ?? null,
  });
  if (
    typeof data.day !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(data.day) ||
    typeof data.month !== "string" ||
    !/^\d{4}-\d{2}$/.test(data.month) ||
    ![data.profiles, data.prefs, data.hotRows, data.dismissed].every(
      Array.isArray,
    ) ||
    !(
      data.money === null ||
      (typeof data.money === "object" &&
        data.money.month === data.month &&
        data.money.counts)
    )
  ) {
    throw new Error("Unrecognized client-success state");
  }
  if (month !== undefined && data.month !== month)
    throw new Error("Wrong income-plan month returned");
  return data as CsmState;
}

export function isMoneyLoose(text: string): boolean {
  return /invoice|payment|past due|billing|pause|refund|card/i.test(text ?? "");
}

export function visibleLooseEnds(
  state: CsmState,
  clientName: string,
  loose: unknown,
): string[] {
  if (!Array.isArray(loose)) return [];
  const dismissed = new Set(
    state.dismissed.filter(d => d.clientName === clientName).map(d => d.text),
  );
  return loose.filter(
    (text): text is string =>
      typeof text === "string" && (!dismissed.has(text) || isMoneyLoose(text)),
  );
}

export function csmPreferences(state: CsmState) {
  const preferences = new Map<
    string,
    { clientName: string; language: string }
  >();
  // Preserve any prior imported preference until explicit staff state supersedes it.
  for (const profile of state.profiles) {
    if (typeof profile.overview?.language === "string")
      preferences.set(profile.client_name, {
        clientName: profile.client_name,
        language: profile.overview.language,
      });
  }
  for (const preference of state.prefs)
    preferences.set(preference.clientName, preference);
  return [...preferences.values()];
}

export async function saveCsmLanguage(
  client: SupabaseClient | null,
  args: { clientName: string; language: string },
) {
  const data = await rpc(client, "cockpit_csm_set_language", {
    p_client_name: args.clientName,
    p_language: args.language,
  });
  if (
    data.clientName !== args.clientName.trim() ||
    data.language !== args.language.trim()
  )
    throw new Error("Language save was not confirmed");
  return data;
}

export async function saveCsmHotRow(
  client: SupabaseClient | null,
  input: Record<string, unknown>,
) {
  const patch = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
  const data = await rpc(client, "cockpit_csm_save_hot_row", {
    p_patch: patch,
  });
  if (data.key !== patch.key)
    throw new Error("Hot-list save was not confirmed");
  for (const [key, value] of Object.entries(patch)) {
    const expected =
      key === "clientName" && typeof value === "string" ? value.trim() : value;
    if (data[key] !== expected)
      throw new Error("Hot-list save was not confirmed");
  }
  return data;
}

export async function dismissCsmLooseEnds(
  client: SupabaseClient | null,
  args: { clientName?: string } = {},
) {
  const result = await rpc(client, "cockpit_csm_clear_loose", {
    p_client_name: args.clientName ?? null,
  });
  if (![result.cleared, result.kept].every(n => Number.isInteger(n) && n >= 0))
    throw new Error("Loose-end update was not confirmed");
  return result as { cleared: number; kept: number };
}

export async function saveCsmMoneyGoals(
  client: SupabaseClient | null,
  input: CsmMoneyPatch,
) {
  for (const value of [
    input.target,
    input.clients,
    ...Object.values(input.counts ?? {}),
  ]) {
    if (value != null && (!Number.isFinite(value) || value < 0))
      throw new Error("Income-plan numbers must be nonnegative and finite");
  }
  const patch = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
  const data = await rpc(client, "cockpit_csm_save_money_goals", {
    p_patch: patch,
  });
  if (
    data.month !== input.month ||
    !data.counts ||
    typeof data.counts !== "object"
  )
    throw new Error("Income-plan save was not confirmed");
  for (const key of ["target", "clients"] as const)
    if (key in patch && data[key] !== patch[key])
      throw new Error("Income-plan save was not confirmed");
  for (const [key, value] of Object.entries(input.counts ?? {}))
    if (data.counts[key] !== value)
      throw new Error("Income counts were not confirmed");
  return data;
}
