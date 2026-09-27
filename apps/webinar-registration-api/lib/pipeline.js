// GHL is a projection of the occurrence ledger, never the evidence for attendance or money.
export const PIPELINE_NAME = "WEBBY | Webinar Journey";
export const LOCATION_ID = "7NI8yyJtwsh2OOWA5Icr";
export const STAGES = [
  { key: "registered", name: "Registered" },
  { key: "attended", name: "Attended" },
  { key: "survey_completed", name: "Survey completed" },
  { key: "call_booked", name: "Call booked" },
  { key: "call_attended", name: "Call attended" },
  { key: "client_won", name: "Client won" },
  { key: "webinar_missed", name: "Missed webinar" },
  { key: "call_follow_up", name: "Call follow-up" },
];
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
