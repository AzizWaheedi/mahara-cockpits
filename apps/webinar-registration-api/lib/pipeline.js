// GHL is a projection of the occurrence ledger, never the evidence for attendance or money.
export const PIPELINE_NAME = "WEBBY | Webinar Journey";
export const LOCATION_ID = "7NI8yyJtwsh2OOWA5Icr";
export const STAGES = [
  { key: "registered", name: "Registered" },
  { key: "attended", name: "Attended" },
  { key: "webinar_missed", name: "Missed webinar" },
  { key: "survey_completed", name: "Survey completed" },
  { key: "call_booked", name: "Call 1 booked" },
  { key: "call_attended", name: "Call 1 showed" },
  { key: "call_1_no_show", name: "Call 1 no-show" },
  { key: "call_1_cancelled", name: "Call 1 cancelled" },
  { key: "call_2_booked", name: "Call 2 booked" },
  { key: "call_2_attended", name: "Call 2 showed" },
  { key: "call_2_no_show", name: "Call 2 no-show" },
  { key: "call_2_cancelled", name: "Call 2 cancelled" },
  { key: "call_follow_up", name: "Follow-up needed" },
  { key: "client_won", name: "Closed won" },
  { key: "closed_lost", name: "Closed lost" },
  { key: "disqualified", name: "Disqualified" },
];
export const LEGACY_STAGE_NAMES = {
  registered: "Registered",
  attended: "Attended",
  survey_completed: "Survey completed",
  call_booked: "Call booked",
  call_attended: "Call attended",
  client_won: "Client won",
  webinar_missed: "Missed webinar",
  call_follow_up: "Call follow-up",
};
export class PipelineError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
export function pipelineBody() {
  return {
    name: PIPELINE_NAME,
    locationId: LOCATION_ID,
    showInFunnel: false,
    showInPieChart: false,
    useOpportunityProbability: false,
    colorRenderMode: "dot",
    stages: STAGES.map(({ name }, position) => ({
      name,
      position,
      showInFunnel: false,
      showInPieChart: false,
      stageWinProbability: 0,
    })),
  };
}
export function verifyPipeline(row) {
  if (
    !row?.id ||
    row.name !== PIPELINE_NAME ||
    (row.locationId && row.locationId !== LOCATION_ID) ||
    !Array.isArray(row.stages)
  )
    throw new PipelineError("pipeline_scope_mismatch");
  const stages = [...row.stages].sort((a, b) => a.position - b.position);
  if (
    stages.length !== STAGES.length ||
    stages.some((s, i) => !s.id || s.name !== STAGES[i].name) ||
    new Set(stages.map((s) => s.id)).size !== STAGES.length
  )
    throw new PipelineError("pipeline_stages_changed");
  return {
    location_id: LOCATION_ID,
    pipeline_id: row.id,
    name: row.name,
    stages: Object.fromEntries(STAGES.map((s, i) => [s.key, stages[i].id])),
  };
}
export function createPipelineProvider({
  env = process.env,
  fetcher = fetch,
} = {}) {
  async function request(path, method = "GET", body) {
    if (!env.GHL_TOKEN) throw new PipelineError("ghl_not_configured");
    let response;
    try {
      response = await fetcher("https://services.leadconnectorhq.com" + path, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Bearer ${env.GHL_TOKEN}`,
          Version: "v3",
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new PipelineError("ghl_response_uncertain");
    }
    if (!response.ok) throw new PipelineError(`ghl_http_${response.status}`);
    try {
      return await response.json();
    } catch {
      throw new PipelineError("ghl_response_invalid");
    }
  }
  return {
    request,
    list: async () => {
      const data = await request(
        "/opportunities/pipelines?" +
          new URLSearchParams({ locationId: LOCATION_ID }),
      );
      if (
        !Array.isArray(data.pipelines) ||
        data.meta?.nextPageUrl ||
        data.nextPageToken
      )
        throw new PipelineError("pipeline_list_incomplete");
      return data.pipelines;
    },
    update: (id, body) =>
      request(
        `/opportunities/pipelines/${encodeURIComponent(id)}`,
        "PUT",
        body,
      ),
    create: () => request("/opportunities/pipelines", "POST", pipelineBody()),
  };
}
export async function provisionPipeline(provider, { apply = false } = {}) {
  const find = (rows) =>
    rows.filter((p) => p.name?.toLowerCase() === PIPELINE_NAME.toLowerCase());
  const before = find(await provider.list());
  if (before.length > 1) throw new PipelineError("ambiguous_pipeline");
  if (before.length === 1)
    return { status: "existing", ...verifyPipeline(before[0]) };
  if (!apply) return { status: "planned", body: pipelineBody() };
  // A failed POST is never repeated. Readback resolves a lost response by exact unique name.
  let failure;
  try {
    await provider.create();
  } catch (error) {
    failure = error;
  }
  const after = find(await provider.list());
  if (after.length !== 1)
    throw failure || new PipelineError("pipeline_readback_failed");
  return { status: "created_and_verified", ...verifyPipeline(after[0]) };
}

// Preserve every existing stage ID. GHL's PUT replaces the entire stage array.
export function expansionBody(row, previous) {
  if (
    row?.id !== previous.pipeline_id ||
    row.locationId !== LOCATION_ID ||
    row.name !== PIPELINE_NAME
  )
    throw new PipelineError("pipeline_scope_mismatch");
  const keys = Object.keys(LEGACY_STAGE_NAMES);
  if (
    !Array.isArray(row.stages) ||
    row.stages.length !== keys.length ||
    keys.some(
      (k) =>
        !row.stages.some(
          (s) =>
            s.id === previous.stages[k] && s.name === LEGACY_STAGE_NAMES[k],
        ),
    )
  )
    throw new PipelineError("legacy_pipeline_changed");
  return {
    name: row.name,
    showInFunnel: row.showInFunnel,
    showInPieChart: row.showInPieChart,
    useOpportunityProbability: row.useOpportunityProbability,
    colorRenderMode: row.colorRenderMode,
    stages: STAGES.map((s, position) => ({
      ...(previous.stages[s.key] ? { id: previous.stages[s.key] } : {}),
      name: s.name,
      position,
      showInFunnel: false,
      showInPieChart: false,
      stageWinProbability: 0,
      color: "#64748B",
    })),
  };
}
export async function expandPipeline(
  provider,
  previous,
  { apply = false } = {},
) {
  const read = async () => {
    const matches = (await provider.list()).filter(
      (p) => p.id === previous.pipeline_id,
    );
    if (matches.length !== 1)
      throw new PipelineError("pipeline_scope_mismatch");
    return matches[0];
  };
  const verify = (row) => {
    const result = verifyPipeline(row);
    if (
      Object.entries(previous.stages).some(([k, id]) => result.stages[k] !== id)
    )
      throw new PipelineError("existing_stage_id_changed");
    return result;
  };
  const before = await read();
  if (before.stages?.length === STAGES.length)
    return { status: "existing", ...verify(before) };
  const body = expansionBody(before, previous);
  if (!apply) return { status: "planned", pipeline_id: before.id, body };
  let error;
  try {
    await provider.update(before.id, body);
  } catch (e) {
    error = e;
  }
  // Never repeat an ambiguous PUT; a readback may prove that it already applied.
  const after = await read();
  if (after.stages?.length !== STAGES.length)
    throw error || new PipelineError("pipeline_readback_failed");
  return { status: "expanded_and_verified", ...verify(after) };
}
