import type { SupabaseClient } from "@supabase/supabase-js";
import {
  selectTargets,
  type TargetEditorState,
  type TargetSelection,
  type TargetVersion,
  type WebinarTargets,
  webinarTargetsSchema,
} from "../types/ceo/webinarTargetsModel";

export type WebinarTargetSaveResult =
  | { conflict: true }
  | {
      conflict: false;
      version: TargetVersion;
      startedAt: number | null;
      selection: TargetSelection;
    };

export type TargetContextRpcResponse = {
  scope: string;
  startedAt: number | null;
  own: TargetVersion[];
  inherited: TargetVersion[];
};

export type SaveTargetsRpcResponse = {
  status: "saved" | "conflict";
  version?: TargetVersion;
  startedAt?: number | null;
};

function parseVersion(value: unknown, scope: string): TargetVersion {
  const version = value as TargetVersion | null;
  if (
    !version ||
    version.scope_key !== scope ||
    !Number.isInteger(version.revision) ||
    version.revision < 1 ||
    typeof version.changed_by !== "string" ||
    !version.changed_by.trim() ||
    typeof version.changed_at !== "string" ||
    !Number.isFinite(Date.parse(version.changed_at))
  ) {
    throw new Error("Unrecognized target version response");
  }
  return { ...version, values: webinarTargetsSchema.parse(version.values) };
}

export async function fetchWebinarTargetContext(
  client: SupabaseClient,
  scope: string,
): Promise<TargetEditorState> {
  if (!client) {
    throw new Error("Supabase client is required");
  }

  const { data, error } = await client.rpc(
    "cockpit_ceo_webinar_target_context",
    {
      p_scope: scope,
    },
  );

  if (error) {
    throw new Error(error.message || "Failed to load webinar target context");
  }

  if (!data || typeof data !== "object") {
    throw new Error("Unrecognized target context response");
  }

  const response = data as TargetContextRpcResponse;
  if (
    response.scope !== scope ||
    !Array.isArray(response.own) ||
    !Array.isArray(response.inherited) ||
    !(
      response.startedAt === null ||
      (Number.isFinite(response.startedAt) && response.startedAt > 0)
    )
  ) {
    throw new Error("Unrecognized target context response");
  }
  const own = response.own;
  const inherited = response.inherited;
  const startedAt = response.startedAt;
  const returnedScope = response.scope;

  // Validate versions using pure model schema
  const validatedOwn = own.map(v => parseVersion(v, scope));
  const validatedInherited = inherited.map(v => parseVersion(v, "defaults"));

  const selection = selectTargets(
    [...validatedInherited, ...validatedOwn],
    returnedScope,
    startedAt,
  );

  return {
    scope: returnedScope,
    selection,
    history: validatedOwn,
  };
}

export async function saveWebinarTargets(
  client: SupabaseClient,
  params: {
    scope: string;
    expectedRevision: number;
    values: WebinarTargets;
    requestId: string;
  },
): Promise<WebinarTargetSaveResult> {
  if (!client) {
    throw new Error("Supabase client is required");
  }

  // Pure validation check before RPC invocation
  const validatedValues = webinarTargetsSchema.parse(params.values);
  if (
    !Number.isInteger(params.expectedRevision) ||
    params.expectedRevision < 0 ||
    !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(params.requestId)
  ) {
    throw new Error("Invalid revision or request ID");
  }

  const { data, error } = await client.rpc("cockpit_ceo_save_webinar_targets", {
    p_scope: params.scope,
    p_expected_revision: params.expectedRevision,
    p_values: validatedValues,
    p_request_id: params.requestId,
  });

  if (error) {
    throw new Error(error.message || "Failed to save webinar targets");
  }

  if (!data || typeof data !== "object") {
    throw new Error("Unrecognized save response");
  }

  const response = data as SaveTargetsRpcResponse;
  if (response.status === "conflict") {
    return { conflict: true };
  }

  if (response.status === "saved") {
    if (!response.version) {
      throw new Error("Missing saved version in RPC response");
    }

    const savedVersion = parseVersion(response.version, params.scope);
    if (
      savedVersion.revision !== params.expectedRevision + 1 ||
      JSON.stringify(savedVersion.values) !== JSON.stringify(validatedValues)
    ) {
      throw new Error("Saved receipt does not match the requested change");
    }

    const startedAt =
      typeof response.startedAt === "number" ? response.startedAt : null;

    const selection: TargetSelection = {
      values: savedVersion.values,
      revision: savedVersion.revision,
      basis: params.scope !== "defaults" ? "round" : "defaults",
      savedAt: savedVersion.changed_at,
    };

    return {
      conflict: false,
      version: savedVersion,
      startedAt,
      selection,
    };
  }

  throw new Error(
    `Unrecognized save status: ${(response as { status: string }).status}`,
  );
}
