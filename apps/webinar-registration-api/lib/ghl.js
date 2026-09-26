// Thin GHL v2 client. All config from environment variables (set in Vercel → Settings → Environment Variables).
export const CFG = {
  token: process.env.GHL_TOKEN,                                   // Private Integration token (Settings → Private Integrations)
  locationId: process.env.GHL_LOCATION_ID || "7NI8yyJtwsh2OOWA5Icr",
  calendarId: process.env.WEBBY_CALENDAR_ID || "jRmgyFgUvWoiqQ83bPJj", // WEBBY · Live Training (internal)
  webinarStart: process.env.WEBINAR_START || "2026-09-24T20:00:00+03:00",  // ISO with offset — the ONE place the round's date lives
  webinarMinutes: Number(process.env.WEBINAR_MINUTES || 90),
  round: process.env.WEBINAR_ROUND || "sep-2026",
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
