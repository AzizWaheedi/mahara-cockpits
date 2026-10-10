#!/usr/bin/env bun
/**
 * Record the SHAPES of the live Hubstaff and Timetastic answers, once a key
 * exists, so the hand-built fixtures can be checked against reality.
 *
 *   bun scripts/dev/hours-record.ts            both providers
 *   bun scripts/dev/hours-record.ts timetastic one of them
 *
 * GET only, through the same tools.ts helpers the sync uses. Every value is
 * replaced (strings become "<string>", numbers 0, booleans false; arrays keep
 * the shape of their first two items), so no name, email, pay or reason is
 * written. Keys are read from ~/.config/mahara/hubstaff_token and
 * ~/.config/mahara/timetastic_token (or HOURS_HUBSTAFF_TOKEN_FILE and
 * HOURS_TIMETASTIC_TOKEN_FILE) and never printed. Output goes to
 * supabase/functions/cockpit-hours-sync/fixtures/recorded/, which git ignores.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type HoursReceipt, hubstaffGet, timetasticGet } from "../../supabase/functions/cockpit-ceo-api/tools.ts";

/** The shape of a JSON value with every value replaced. */
export function shapeOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 2).map(shapeOf);
  if (value === null) return null;
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = shapeOf(v);
    return out;
  }
  if (typeof value === "string") return "<string>";
  if (typeof value === "number") return 0;
  if (typeof value === "boolean") return false;
  return null;
}

function key(file: string): string {
  const path = file.replace(/^~/, homedir());
  return existsSync(path) ? readFileSync(path, "utf8").trim() : "";
}

async function main() {
  const only = process.argv[2];
  const out = new URL("../../supabase/functions/cockpit-hours-sync/fixtures/recorded/", import.meta.url).pathname;
  mkdirSync(out, { recursive: true });
  const receipts: HoursReceipt[] = [];
  const health = async (r: HoursReceipt) => { receipts.push(r); };
  const save = (name: string, body: unknown) => {
    writeFileSync(join(out, name), JSON.stringify({ _source: `shape recorded ${new Date().toISOString().slice(0, 10)}; every value replaced`, body: shapeOf(body) }, null, 1));
    console.log(`saved ${name}`);
  };
  const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  if (!only || only === "hubstaff") {
    const token = key(process.env.HOURS_HUBSTAFF_TOKEN_FILE ?? "~/.config/mahara/hubstaff_token");
    if (!token) console.log("No Hubstaff token file; skipped.");
    else {
      const orgs = await hubstaffGet(token, health, fetch, "organizations");
      save("hubstaff-organizations.json", orgs);
      const ids = (Array.isArray(orgs.organizations) ? orgs.organizations : []).map(o => String((o as { id: unknown }).id));
      const org = ids.includes("705266") ? "705266" : ids[0];
      if (org) {
        save("hubstaff-members.json", await hubstaffGet(token, health, fetch, `organizations/${org}/members`, { include: "users", include_removed: "true", page_limit: 5 }));
        save("hubstaff-activities.json", await hubstaffGet(token, health, fetch, `organizations/${org}/activities`, { "time_slot[start]": `${yesterday}T00:00:00Z`, "time_slot[stop]": `${today}T00:00:00Z`, page_limit: 5 }));
        save("hubstaff-daily-activities.json", await hubstaffGet(token, health, fetch, `organizations/${org}/activities/daily`, { "date[start]": yesterday, "date[stop]": yesterday, page_limit: 5 }));
        save("hubstaff-last-activities.json", await hubstaffGet(token, health, fetch, `organizations/${org}/last_activities`, { page_limit: 5 }));
      }
    }
  }
  if (!only || only === "timetastic") {
    const token = key(process.env.HOURS_TIMETASTIC_TOKEN_FILE ?? "~/.config/mahara/timetastic_token");
    if (!token) console.log("No Timetastic token file; skipped.");
    else {
      const users = await timetasticGet(token, health, fetch, "users");
      save("timetastic-users.json", users);
      const first = Array.isArray(users) && users.length ? String((users[0] as { id: unknown }).id) : null;
      if (first) {
        save("timetastic-user-detail.json", await timetasticGet(token, health, fetch, `users/${first}`));
        save("timetastic-user-contact.json", await timetasticGet(token, health, fetch, `users/contact/${first}`));
      }
      save("timetastic-leavetypes.json", await timetasticGet(token, health, fetch, "leavetypes", { includeInactive: true }));
      save("timetastic-holidays.json", await timetasticGet(token, health, fetch, "holidays", { Start: `${today.slice(0, 7)}-01`, Status: "Any" }));
      await new Promise(r => setTimeout(r, 1100));
      save("timetastic-absences.json", await timetasticGet(token, health, fetch, "absences", { Start: `${today.slice(0, 7)}-01`, End: today, AbsenceQueryType: 1 }));
    }
  }
  console.log(`${receipts.filter(r => r.phase === "response").length} GET calls, answered ${[...new Set(receipts.map(r => r.http_status).filter(Boolean))].join(", ") || "nothing"}.`);
}

if (import.meta.main) await main();
