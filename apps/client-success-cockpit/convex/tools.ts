declare const process: { env: Record<string, string | undefined> };

const VIKTOR_API_URL = process.env.VIKTOR_SPACES_API_URL!;
const PROJECT_NAME = process.env.VIKTOR_SPACES_PROJECT_NAME!;
const PROJECT_SECRET = process.env.VIKTOR_SPACES_PROJECT_SECRET!;

export async function callTool<T>(
  role: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch(
    `${VIKTOR_API_URL}/api/viktor-spaces/tools/call`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_name: PROJECT_NAME,
        project_secret: PROJECT_SECRET,
        role,
        arguments: args,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  const json = await response.json();
  if (!json.success) {
    throw new Error(json.error ?? "Tool call failed");
  }
  return json.result as T;
}

/** Tool results arrive either as objects or as JSON in a `content` string. */
// biome-ignore lint/suspicious/noExplicitAny: tool payloads are untyped
export function unwrap(raw: any): any {
  let out = raw;
  if (out && typeof out.content === "string") {
    try {
      out = JSON.parse(out.content);
    } catch {
      return out.content;
    }
  } else if (out && typeof out.content === "object" && out.content !== null) {
    out = out.content;
  }
  if (out && typeof out === "object" && "body" in out) {
    out = out.body;
  }
  return out;
}
