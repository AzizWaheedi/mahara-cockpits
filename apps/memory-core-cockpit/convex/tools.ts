import { note, sourceFor, transient } from "./health";

declare const process: { env: Record<string, string | undefined> };

/**
 * The integration layer: every outside call the memory core makes goes through
 * here, so each one lands in the health ledger and every retry rule lives in
 * one place.
 *
 * Two doors:
 *
 *   1. Composio's MCP endpoint — Notion, Gmail and Google Drive, one HTTP call
 *      for all three (COMPOSIO_MULTI_EXECUTE_TOOL runs them in parallel).
 *   2. A model — Claude when ANTHROPIC_API_KEY is set, OpenAI otherwise.
 *
 * Env vars (set with `bunx convex env set NAME value`):
 *
 *   COMPOSIO_API_KEY       the Composio consumer key (x-consumer-api-key)
 *   ANTHROPIC_API_KEY      Claude writes the grounded answers
 *   ANTHROPIC_MODEL        optional, defaults to claude-opus-5
 *   OPENAI_API_KEY         the fallback that writes answers when Claude has no key
 *   OPENAI_MODEL           optional, defaults to gpt-4.1-mini
 *   MEMORY_CORE_ACCESS_CODE  the access code every screen and action checks
 */

export function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set on this Convex deployment`);
  }
  return value;
}

/** True when the name is set, without throwing — for the "missing is never zero" copy. */
export function envOrNull(name: string): string | null {
  return process.env[name] ?? null;
}

async function bodyOf(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function brief(value: unknown): string {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return String(s ?? "").slice(0, 400);
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Composio MCP (JSON-RPC 2.0 over HTTP; answers arrive as SSE)

const MCP_URL = "https://connect.composio.dev/mcp";

/**
 * Composio counts calls per toolkit, and one search fans out to three of them.
 * Calls leave at most one every 1.2 s so a burst of searches cannot trip the
 * limit for us or for anything else using the same key.
 */
let composioGate: Promise<void> = Promise.resolve();
const COMPOSIO_GAP_MS = 1200;

export function paceComposio(): Promise<void> {
  const turn: Promise<void> = composioGate
    .then(() => wait(COMPOSIO_GAP_MS))
    .then(() => undefined);
  composioGate = turn.catch(() => undefined);
  return turn;
}

type Any = any;

/** The result of one MCP tools/call, or the JSON inside its text block. */
function readRpc(raw: string): Any {
  const trimmed = raw.trim();
  // The endpoint answers with SSE ("data: {...}") but a plain JSON body is
  // valid too, so both are accepted.
  const payloads: Any[] = [];
  if (trimmed.startsWith("{")) {
    payloads.push(JSON.parse(trimmed));
  } else {
    for (const line of trimmed.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const body = line.slice(5).trim();
      if (!body) continue;
      try {
        payloads.push(JSON.parse(body));
      } catch {
        // A partial frame: ignore it, the complete one follows.
      }
    }
  }
  for (const payload of payloads.reverse()) {
    if (payload?.error) {
      throw new Error(
        `Composio refused the call: ${brief(payload.error.message ?? payload.error)}`,
      );
    }
    if (!payload?.result) continue;
    if (payload.result.isError === true) {
      throw new Error(
        `Composio reported an error: ${brief(payload.result.content)}`,
      );
    }
    const content = payload.result.content;
    const text =
      Array.isArray(content) && typeof content[0]?.text === "string"
        ? content[0].text
        : null;
    if (!text) return payload.result;
    try {
      return JSON.parse(text);
    } catch {
      // A half-delivered result parses as nothing. Saying so is the only
      // honest option: returning `{ text }` here would reach the adapters as
      // an empty result list, which reads on the screen as "you have nothing
      // about this" when in fact the answer was lost in transit.
      throw new Error(
        `Composio sent a result that could not be read: ${brief(text)}`,
      );
    }
  }
  throw new Error(`Composio sent something unreadable: ${brief(raw)}`);
}

/**
 * One MCP meta-tool call. Retries a network blip, a 429 and any 5xx, because a
 * rate limit here is not a broken integration — the sync should wait it out.
 */
export async function mcpCall(name: string, args: unknown): Promise<Any> {
  await paceComposio();
  const payload = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  };
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(MCP_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "x-consumer-api-key": env("COMPOSIO_API_KEY"),
        },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      if (attempt < 2) {
        await wait((attempt + 1) * 4_000);
        continue;
      }
      note("composio", false, `network: ${String(e).slice(0, 120)}`);
      throw new Error(
        `Composio could not be reached: ${String(e).slice(0, 120)}`,
      );
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await wait((attempt + 1) * 8_000);
      continue;
    }
    const text = await res.text();
    if (!res.ok) {
      note(
        "composio",
        transient(res.status) && attempt === 0,
        `HTTP ${res.status} ${brief(text)}`,
      );
      throw new Error(`Composio answered HTTP ${res.status}: ${brief(text)}`);
    }
    note("composio", true);
    return readRpc(text);
  }
}

export type ToolOutcome = {
  tool: string;
  ok: boolean;
  data: any;
  error: string | null;
  /** True when Composio sent a shortened preview of a large payload. */
  truncated: boolean;
};

/**
 * Run several Composio tools in one round trip. This is the shape every source
 * adapter uses, so one search is one HTTP call to Composio rather than three.
 */
export async function composioTools(
  calls: { tool_slug: string; arguments: Record<string, unknown> }[],
  thought: string,
): Promise<ToolOutcome[]> {
  const result: Any = await mcpCall("COMPOSIO_MULTI_EXECUTE_TOOL", {
    tools: calls,
    thought,
    current_step: "SEARCHING_MEMORY",
  });
  const rows = result?.data?.results;
  if (!Array.isArray(rows)) return [];
  return rows.map((row: Any) => {
    // A big result comes back as `data_preview`, shortened by Composio, with no
    // `data` at all. Taking the preview beats showing nothing — and `truncated`
    // travels with it so the screen can say the text is shortened instead of
    // pretending it is whole.
    const full = row?.response?.data ?? null;
    const preview = row?.response?.data_preview ?? null;
    return {
      tool: String(row?.tool_slug ?? ""),
      ok: row?.response?.successful === true,
      data: full ?? preview,
      error: row?.response?.error
        ? String(row.response.error).slice(0, 400)
        : null,
      truncated: full === null && preview !== null,
    };
  });
}

/** One Composio tool, with the ledger note attributed to its own source. */
export async function composioTool(
  tool: string,
  args: Record<string, unknown>,
  source: string,
): Promise<ToolOutcome> {
  const [outcome] = await composioTools(
    [{ tool_slug: tool, arguments: args }],
    `Read ${source} for the memory core`,
  );
  const result = outcome ?? {
    tool,
    ok: false,
    data: null,
    error: "Composio returned no result for this tool",
    truncated: false,
  };
  if (!result.ok) {
    note(source, false, result.error ?? "no reason given");
  } else {
    note(source, true);
  }
  return result;
}

// ---------------------------------------------------------------------------
// The answer model

export type Answer = { text: string; model: string };

/** The model the screen should name before anybody asks a question. */
export function answerModelName(): string {
  if (process.env.ANTHROPIC_API_KEY) {
    return `Claude ${process.env.ANTHROPIC_MODEL || "claude-opus-5"}`;
  }
  if (process.env.OPENAI_API_KEY) {
    return `OpenAI ${process.env.OPENAI_MODEL || "gpt-4.1-mini"}`;
  }
  return "no model connected";
}

async function anthropicAnswer(
  system: string,
  user: string,
  maxTokens: number,
): Promise<Answer> {
  const model = process.env.ANTHROPIC_MODEL || "claude-opus-5";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env("ANTHROPIC_API_KEY"),
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  const json: Any = await bodyOf(res);
  if (!res.ok) {
    note(
      "anthropic",
      transient(res.status),
      `HTTP ${res.status} ${brief(json)}`,
    );
    throw new Error(`Claude answered HTTP ${res.status}: ${brief(json)}`);
  }
  if (json?.stop_reason === "refusal") {
    note("anthropic", false, "the model declined the question");
    throw new Error("Claude declined to answer that question");
  }
  note("anthropic", true);
  const text = ((json?.content ?? []) as Any[])
    .filter(block => block?.type === "text")
    .map(block => String(block.text ?? ""))
    .join("")
    .trim();
  return { text, model: `Claude ${model}` };
}

async function openaiAnswer(
  system: string,
  user: string,
  maxTokens: number,
): Promise<Answer> {
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env("OPENAI_API_KEY")}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  const json: Any = await bodyOf(res);
  if (!res.ok) {
    note("openai", transient(res.status), `HTTP ${res.status} ${brief(json)}`);
    throw new Error(
      `The fallback model answered HTTP ${res.status}: ${brief(json)}`,
    );
  }
  note("openai", true);
  const text = String(json?.choices?.[0]?.message?.content ?? "").trim();
  return { text, model: `OpenAI ${model}` };
}

/**
 * Write the answer. Claude first when it has a key, OpenAI otherwise — the UI
 * names whichever model actually answered, so nobody has to guess.
 *
 * The reason for the fallback: ANTHROPIC_API_KEY is empty in this environment
 * (2026-09-19), and an Ask screen that cannot answer at all is worse than one
 * that answers with the model it really has.
 */
export async function writeAnswer(
  system: string,
  user: string,
  maxTokens = 1400,
): Promise<Answer> {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await anthropicAnswer(system, user, maxTokens);
    } catch (e) {
      if (!process.env.OPENAI_API_KEY) throw e;
      // Claude is set up but not answering right now: answer with the fallback
      // and let the ledger record both.
      note("anthropic", false, String(e).slice(0, 200));
    }
  }
  if (process.env.OPENAI_API_KEY) {
    return await openaiAnswer(system, user, maxTokens);
  }
  throw new Error(
    "No answer model is connected. Set ANTHROPIC_API_KEY (or OPENAI_API_KEY) on this deployment.",
  );
}

export { sourceFor };
