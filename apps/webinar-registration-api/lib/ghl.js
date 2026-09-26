// Credentials stay in Vercel. The generated repository schedule owns event settings.
import { schedule } from "./schedule.js";
export const CFG = {
  token: process.env.GHL_TOKEN,                                   // Private Integration token (Settings → Private Integrations)
  locationId: schedule.providers.ghl_location_id,
  calendarId: schedule.providers.ghl_calendar_id,
  webinarStart: schedule.starts_at,
  webinarMinutes: schedule.duration_minutes,
  round: schedule.legacy_round,
  thanksUrl: process.env.THANKS_URL || "/thanks.html",
  fields: {
    webinarDatetime: "x7aG8iLqmTzQEr6SGCaH",
    webinarRound:    "a2j833icPANKyXtSsGu1",
    profitBand:      "Iq6wchuoidufxUWhSnGk",
    surveyNotes:     "owV2w8UB2nBbPpknQUJ8",
  },
};

const BASE = "https://services.leadconnectorhq.com";

export async function ghl(method, path, body, version = "2021-07-28") {
  if (!CFG.token) throw new Error("GHL_TOKEN env var is not set");
  const r = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${CFG.token}`, Version: version, "Content-Type": "application/json", Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  if (!r.ok) { const e = new Error(`GHL ${method} ${path} → ${r.status}: ${text.slice(0, 300)}`); e.status = r.status; throw e; }
  return json;
}

export function normalizePhone(raw) {
  if (!raw) return undefined;
  let p = String(raw).replace(/[^\d+]/g, "");
  if (p.startsWith("00")) p = "+" + p.slice(2);
  if (/^\d{8}$/.test(p)) p = "+965" + p;              // Kuwait local number
  if (/^965\d{8}$/.test(p)) p = "+" + p;
  if (/^0\d{8,9}$/.test(p)) p = "+966" + p.slice(1);  // Saudi local number (0 5x…)
  if (!p.startsWith("+")) p = "+" + p;
  return p;
}

export function readBody(req) {
  // Vercel parses JSON and urlencoded bodies into req.body already; fall back to raw.
  const b = req.body;
  if (!b) return {};
  if (typeof b === "string") { try { return JSON.parse(b); } catch { return Object.fromEntries(new URLSearchParams(b)); } }
  return b;
}

export const isEmail = (s) => typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
