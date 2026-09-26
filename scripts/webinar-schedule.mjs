#!/usr/bin/env node
// Repository-owned schedule. No provider writes, secrets, or messaging here.
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CURRENT = "config/webinar/current.json";
const fail = (message) => { throw new Error(message); };
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const objectKeys = (value, keys, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join() !== [...keys].sort().join()) fail(`Invalid ${label} fields`);
};

export function validate(c) {
  objectKeys(c, ["schema_version", "event_key", "revision", "status", "starts_at", "timezone", "duration_minutes", "title", "providers"], "schedule");
  if (c.schema_version !== 1) fail("Unsupported schedule schema");
  if (!/^[a-z][a-z0-9-]{5,79}$/.test(c.event_key)) fail("Invalid event_key");
  if (!Number.isSafeInteger(c.revision) || c.revision < 1) fail("Invalid revision");
  if (!["draft", "scheduled"].includes(c.status)) fail("Invalid status");
  if (!Number.isInteger(c.duration_minutes) || c.duration_minutes < 5 || c.duration_minutes > 480) fail("Duration must be 5–480 minutes");
  if (typeof c.timezone !== "string" || !c.timezone.includes("/")) fail("Use an IANA timezone");
  // This validates the zone even while the date remains undecided.
  new Intl.DateTimeFormat("en-GB", { timeZone: c.timezone }).format();
  objectKeys(c.title, ["ar", "en"], "title");
  for (const title of Object.values(c.title)) {
    if (typeof title !== "string" || !title.trim() || title.length > 160 || /[<>\u0000-\u001f]/.test(title)) fail("Invalid title");
  }
  objectKeys(c.providers, ["zoom_meeting_id", "ghl_location_id", "ghl_calendar_id"], "providers");
  if (!/^\d{9,12}$/.test(c.providers.zoom_meeting_id)) fail("Invalid Zoom meeting id");
  for (const id of [c.providers.ghl_location_id, c.providers.ghl_calendar_id]) {
    if (!/^[A-Za-z0-9]{15,40}$/.test(id)) fail("Invalid GHL id");
  }
  if (c.status === "draft") {
    if (c.starts_at !== null) fail("Draft schedules must have starts_at=null");
  } else {
    // No implicit machine timezone, impossible dates, seconds, or mismatched offset.
    if (typeof c.starts_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00[+-]\d{2}:\d{2}$/.test(c.starts_at)) fail("Use ISO datetime with seconds 00 and explicit offset");
    const at = new Date(c.starts_at);
    if (!Number.isFinite(+at)) fail("Invalid start time");
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
      timeZone: c.timezone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(at).map((p) => [p.type, p.value]));
    const local = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00`;
    if (local !== c.starts_at.slice(0, 19)) fail("Start date or UTC offset does not match the timezone");
  }
  return c;
}

export function runtime(c) {
  validate(c);
  const hash = createHash("sha256").update(json(c)).digest("hex");
  const start = c.starts_at ? new Date(c.starts_at) : null;
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  return {
    ...c,
    config_sha256: hash,
    ends_at: start ? new Date(+start + c.duration_minutes * 60000).toISOString() : null,
    // Compatibility only. Never use this month label as the event's identity.
    legacy_round: start ? `${months[Number(c.starts_at.slice(5, 7)) - 1]}-${c.starts_at.slice(0, 4)}` : null,
  };
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const arabicDigits = (s) => String(s).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
export function labels(c) {
  validate(c);
  if (!c.starts_at) return { ar: { date: "الموعد الياي بنعلنه قريب", time: "" }, en: { date: "Next date to be announced", time: "" } };
  const at = new Date(c.starts_at);
  const date = (locale) => new Intl.DateTimeFormat(locale, { timeZone: c.timezone, calendar: "gregory", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(at);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: c.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour), minute = Number(parts.minute);
  const clock = `${hour % 12 || 12}${minute ? `:${parts.minute}` : ""}`;
  const zone = c.timezone === "Asia/Kuwait" ? { ar: "بتوقيت الكويت ومكة", en: "Kuwait / Mecca time (GMT+3)" } : { ar: c.timezone, en: c.timezone };
  return {
    ar: { date: date("ar-KW-u-nu-arab"), time: `${arabicDigits(clock)} ${hour < 12 ? "صباحًا" : "مساءً"} ${zone.ar}` },
    en: { date: date("en-US"), time: `${clock} ${hour < 12 ? "AM" : "PM"} ${zone.en}` },
  };
}

export function calendarUrl(c) {
  const r = runtime(c);
  if (!c.starts_at) return null;
  const compact = (iso) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(".000", "");
  const query = new URLSearchParams({ action: "TEMPLATE", text: `${c.title.ar} | ${c.title.en}`, dates: `${compact(c.starts_at)}/${compact(r.ends_at)}`, ctz: c.timezone, location: "Zoom", details: "https://webinar.maharamedia.com/live" });
  return `https://calendar.google.com/calendar/render?${query}`;
}

function replaceRegion(html, name, content) {
  const from = `<!-- webinar:${name}:start -->`, to = `<!-- webinar:${name}:end -->`;
  if (html.split(from).length !== 2 || html.split(to).length !== 2 || html.indexOf(to) < html.indexOf(from)) fail(`Missing or duplicate generated region: ${name}`);
  return html.slice(0, html.indexOf(from) + from.length) + `\n${content}\n` + html.slice(html.indexOf(to));
}

export function renderPage(html, c, kind) {
  const l = labels(c), r = runtime(c);
  html = replaceRegion(html, "metadata", `<meta name="webinar-event-key" content="${c.event_key}">\n<meta name="webinar-schedule-revision" content="${c.revision}">\n<meta name="webinar-config-sha256" content="${r.config_sha256}">\n<meta name="webinar-start" content="${c.starts_at || ""}">\n<script src="/webinar-schedule.js"></script>`);
  const line = (language, full = false) => `<span data-only="${language}">${escapeHtml(l[language].date + (full && l[language].time ? ` · ${l[language].time}` : ""))}</span>`;
  html = replaceRegion(html, "date", line("ar", kind === "thanks") + line("en", kind === "thanks"));
  if (kind === "landing") {
    if (html.split("data-webinar-form").length !== 2 || !/<iframe\s+(?:src="https:\/\/link.maharamedia.com\/widget\/form\/5wC0SkFcgCfFzbpOUBWk"\s+)?data-webinar-form/.test(html)) fail("Missing or duplicate registration form marker");
    html = replaceRegion(html, "time", `<span data-only="ar">${escapeHtml(l.ar.time)}</span><span data-only="en">${escapeHtml(l.en.time)}</span>`);
    html = html.replace(/(<iframe\s+)(?:src="https:\/\/link.maharamedia.com\/widget\/form\/5wC0SkFcgCfFzbpOUBWk"\s+)?(data-webinar-form)/, `$1${c.status === "scheduled" ? 'src="https://link.maharamedia.com/widget/form/5wC0SkFcgCfFzbpOUBWk" ' : ""}$2`);
    html = replaceRegion(html, "registration-note", c.status === "draft" ? '<p><span data-only="ar">التسجيل يفتح أول ما نأكد الموعد الياي.</span><span data-only="en">Registration opens when the next date is confirmed.</span></p>' : "");
  } else {
    const url = calendarUrl(c);
    html = replaceRegion(html, "calendar", url
      ? `<a class="step-btn stroke" href="${escapeHtml(url)}" target="_blank" rel="noopener"><span data-only="ar">أضف للتقويم</span><span data-only="en">Add to calendar</span></a>`
      : `<span class="step-btn stroke" aria-disabled="true"><span data-only="ar">بنضيف الموعد أول ما يتأكد</span><span data-only="en">Available when the date is confirmed</span></span>`);
  }
  return html;
}

export async function outputs(c, root = ROOT) {
  const r = runtime(c);
  const js = `// Generated by scripts/webinar-schedule.mjs. Do not edit.\n`;
  return {
    "apps/webinar-registration-api/lib/schedule.generated.js": `${js}export default ${json(r).trim()};\n`,
    "sites/webinar/webinar-schedule.js": `${js}window.MAHARA_WEBINAR = ${json(r).trim()};\n`,
    "sites/webinar/schedule.json": json(r),
    "sites/webinar/index.html": renderPage(await readFile(join(root, "sites/webinar/index.html"), "utf8"), c, "landing"),
    "sites/webinar/thank-you.html": renderPage(await readFile(join(root, "sites/webinar/thank-you.html"), "utf8"), c, "thanks"),
  };
}

// Provider evidence must come from fresh read-back, never from desired inputs.
export function audit(c, evidence, now = Date.now(), sources = ["page", "api", "zoom", "ghl"]) {
  const r = runtime(c), issues = [];
  if (c.status !== "scheduled" || +new Date(c.starts_at) <= now) issues.push("Choose a future training date before release");
  for (const source of sources) {
    const e = evidence?.[source];
    const captured = e && Date.parse(e.captured_at);
    if (!e || !Number.isFinite(captured) || captured > now + 60000 || now - captured > 15 * 60000) { issues.push(`${source}: missing or stale read-back (maximum 15 minutes)`); continue; }
    if (!e.starts_at || Date.parse(e.starts_at) !== Date.parse(c.starts_at) || e.duration_minutes !== c.duration_minutes || e.timezone !== c.timezone) issues.push(`${source}: schedule differs`);
    if (["page", "api"].includes(source)) {
      if (e.event_key !== c.event_key || e.revision !== c.revision || e.config_sha256 !== r.config_sha256) issues.push(`${source}: deployed config differs`);
    }
    if (source === "page" && e.rendered_pages_match !== true) issues.push("page: landing, thank-you, or calendar content differs");
    if (source === "api" && e.schedule_ready !== true) issues.push("api: schedule guard is not ready");
    if (source === "zoom" && e.meeting_id !== c.providers.zoom_meeting_id) issues.push("zoom: different meeting");
    if (source === "ghl" && (e.location_id !== c.providers.ghl_location_id || e.calendar_id !== c.providers.ghl_calendar_id || e.event_key !== c.event_key || e.revision !== c.revision)) issues.push("ghl: occurrence binding differs or is not installed");
  }
  return issues;
}

export async function probeWeb(fetcher = fetch) {
  const get = async (url) => {
    const response = await fetcher(url, { signal: AbortSignal.timeout(20000), headers: { "Cache-Control": "no-cache" } });
    if (!response.ok) fail(`Read-back failed (${response.status}) at ${new URL(url).pathname}`);
    const body = await response.text();
    if (body.length > 500000) fail("Read-back body too large");
    return body;
  };
  const [raw, landing, thanks, health] = await Promise.all([
    get("https://webinar.maharamedia.com/schedule.json"),
    get("https://webinar.maharamedia.com/"),
    get("https://webinar.maharamedia.com/thank-you.html"),
    get("https://webby-live-training.vercel.app/api/health"),
  ]);
  const page = JSON.parse(raw), api = JSON.parse(health);
  // Strip computed fields, validate, then verify both generated pages against that config.
  const { config_sha256, ends_at, legacy_round, ...config } = page;
  const regenerated = runtime(config);
  const rendered = config_sha256 === regenerated.config_sha256 && ends_at === regenerated.ends_at && legacy_round === regenerated.legacy_round &&
    renderPage(landing, config, "landing") === landing && renderPage(thanks, config, "thanks") === thanks;
  const captured_at = new Date().toISOString();
  return {
    page: { captured_at, starts_at: page.starts_at, duration_minutes: page.duration_minutes, timezone: page.timezone, event_key: page.event_key, revision: page.revision, config_sha256, rendered_pages_match: rendered },
    api: { captured_at, starts_at: api.webinarStart, duration_minutes: api.durationMinutes, timezone: api.timezone, event_key: api.eventKey, revision: api.scheduleRevision, config_sha256: api.configSha256, schedule_ready: api.scheduleReady },
  };
}

export async function generate(c, root = ROOT, check = false) {
  const files = await outputs(c, root);
  const history = `config/webinar/history/${c.event_key}/revision-${c.revision}.json`;
  let previous;
  try { previous = await readFile(join(root, history), "utf8"); } catch (e) { if (e.code !== "ENOENT") throw e; }
  if (previous && previous !== json(c)) fail("Immutable revision already exists. Increment revision for a schedule change.");
  if (c.revision > 1) {
    const prior = JSON.parse(await readFile(join(root, `config/webinar/history/${c.event_key}/revision-${c.revision - 1}.json`), "utf8"));
    validate(prior);
    if (prior.event_key !== c.event_key || prior.revision !== c.revision - 1) fail("Invalid preceding revision");
  }
  files[history] = json(c);
  const drift = [];
  for (const [file, content] of Object.entries(files)) {
    if (check) {
      let current;
      try { current = await readFile(join(root, file), "utf8"); } catch (e) { if (e.code !== "ENOENT") throw e; }
      if (current !== content) drift.push(file);
    } else {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), content);
    }
  }
  if (drift.length) fail(`Generated schedule is stale: ${drift.join(", ")}. Run node scripts/webinar-schedule.mjs generate`);
}

export async function main(argv, root = ROOT) {
  const [command = "check", ...args] = argv, opts = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!["--at", "--expected-revision", "--key", "--minutes", "--evidence"].includes(args[i]) || !args[i + 1] || opts[args[i]]) fail("Unknown, duplicated, or incomplete option");
    opts[args[i]] = args[i + 1];
  }
  let c = validate(JSON.parse(await readFile(join(root, CURRENT), "utf8")));
  if (["set", "new"].includes(command)) {
    if (opts["--evidence"]) fail(`${command} does not accept --evidence`);
    if (Number(opts["--expected-revision"]) !== c.revision) fail(`Revision conflict; read ${CURRENT} again`);
    await generate(c, root, true); // Do not bury earlier unsynced/manual changes.
    if (!opts["--at"]) fail("--at is required");
    if (command === "set" && opts["--key"]) fail("A reschedule must keep the event_key");
    if (command === "new" && (!opts["--key"] || opts["--key"] === c.event_key)) fail("A new training needs a different --key");
    c = validate({ ...c, event_key: command === "new" ? opts["--key"] : c.event_key, revision: command === "new" ? 1 : c.revision + 1, status: "scheduled", starts_at: opts["--at"], duration_minutes: opts["--minutes"] ? Number(opts["--minutes"]) : c.duration_minutes });
    if (+new Date(c.starts_at) <= Date.now()) fail("Choose a future date");
    if (command === "new") {
      try { await readFile(join(root, `config/webinar/history/${c.event_key}/revision-1.json`)); fail("Event key already used; choose a new key"); } catch (e) { if (e.code !== "ENOENT") throw e; }
    }
    // A crash leaves detectable drift; check refuses deployment until regenerated.
    await writeFile(join(root, CURRENT), json(c));
    await generate(c, root);
  } else if (command === "generate" || command === "check") {
    if (args.length) fail(`${command} takes no options`);
    await generate(c, root, command === "check");
  } else if (command === "probe") {
    if (Object.keys(opts).some((key) => key !== "--evidence") || !opts["--evidence"]) fail("probe requires --evidence PATH");
    const path = resolve(opts["--evidence"]);
    let evidence = {};
    try { evidence = JSON.parse(await readFile(path, "utf8")); } catch (e) { if (e.code !== "ENOENT") throw e; }
    const readings = await probeWeb();
    await writeFile(path, json({ ...evidence, ...readings }));
  } else if (command === "audit" || command === "release-check") {
    if (Object.keys(opts).some((key) => key !== "--evidence") || !opts["--evidence"]) fail(`${command} requires --evidence PATH`);
    await generate(c, root, true);
    const issues = audit(c, JSON.parse(await readFile(resolve(opts["--evidence"]), "utf8")), Date.now(), command === "release-check" ? ["zoom", "ghl"] : undefined);
    if (issues.length) fail(issues.join("\n"));
  } else fail("Use check, generate, set, new, probe, release-check, or audit");
  console.log(`${command}: ${c.event_key} revision ${c.revision} (${c.status}). No provider changes made.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
