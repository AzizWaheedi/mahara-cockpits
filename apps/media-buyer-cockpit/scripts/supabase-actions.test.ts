import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

// Read service role key for testing RPC definitions and executions
const envPath = resolve(process.cwd(), "../../.env.local");
let serviceKey = "";
try {
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    if (line.startsWith("SUPABASE_SERVICE_ROLE_KEY=")) {
      serviceKey = line.split("=", 2)[1].trim().replace(/^["']|["']$/g, "");
      break;
    }
  }
} catch {
  // If not found, skip live API calls
}

const PROJECT_URL = "https://bldgtotkfmhoxmlzowdx.supabase.co";

describe("Supabase Cockpit RPCs", () => {
  test("unauthenticated call to cockpit_save_eod fails closed", async () => {
    const res = await fetch(`${PROJECT_URL}/rest/v1/rpc/cockpit_save_eod`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: "anon-dummy-key",
      },
      body: JSON.stringify({
        p_role: "media_buyer",
        p_day: "2026-09-23",
      }),
    });
    // Should fail with 401 or 400
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test("unauthenticated call to cockpit_log_decision fails closed", async () => {
    const res = await fetch(`${PROJECT_URL}/rest/v1/rpc/cockpit_log_decision`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: "anon-dummy-key",
      },
      body: JSON.stringify({
        p_role: "media_buyer",
        p_day: "2026-09-23",
        p_subject: "Test Campaign",
        p_action: "scale",
      }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test("unauthenticated call to cockpit_get_dashboard_summary fails closed", async () => {
    const res = await fetch(`${PROJECT_URL}/rest/v1/rpc/cockpit_get_dashboard_summary`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: "anon-dummy-key",
      },
      body: JSON.stringify({
        p_role: "media_buyer",
        p_day: "2026-09-23",
      }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test("invalid role rejected in cockpit_log_decision", async () => {
    if (!serviceKey) return;
    const res = await fetch(`${PROJECT_URL}/rest/v1/rpc/cockpit_log_decision`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        p_role: "hacker_role",
        p_day: "2026-09-23",
        p_subject: "Test",
        p_action: "scale",
      }),
    });
    expect(res.status).toBe(400);
  });
});
