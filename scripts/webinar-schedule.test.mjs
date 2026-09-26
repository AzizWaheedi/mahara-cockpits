import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { audit, calendarUrl, generate, labels, main, outputs, probeWeb, renderPage, ROOT, runtime, validate } from "./webinar-schedule.mjs";
import { scheduleIssues } from "../apps/webinar-registration-api/lib/schedule.js";
import register from "../apps/webinar-registration-api/api/register.js";

const draft = { ...JSON.parse(await readFile(join(ROOT, "config/webinar/current.json"))), event_key: "mahara-schedule-test-001", revision: 1, status: "draft", starts_at: null };
const scheduled = { ...draft, status: "scheduled", starts_at: "2099-10-01T20:00:00+03:00" };
const now = Date.parse("2099-09-29T12:00:00Z");
const landing = await readFile(join(ROOT, "sites/webinar/index.html"), "utf8");
const thanks = await readFile(join(ROOT, "sites/webinar/thank-you.html"), "utf8");
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "webinar-schedule-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "sites/webinar"), { recursive: true });
  await mkdir(join(root, "config/webinar"), { recursive: true });
  await writeFile(join(root, "sites/webinar/index.html"), landing);
  await writeFile(join(root, "sites/webinar/thank-you.html"), thanks);
  await writeFile(join(root, "config/webinar/current.json"), JSON.stringify(draft));
  await generate(draft, root);
  return root;
}

test("invalid, rolled-over, timezone-free and wrong-offset dates fail", () => {
  for (const starts_at of ["2099-02-30T20:00:00+03:00", "2099-10-01T20:00:00", "2099-10-01T20:00:00+04:00", "junk"]) {
    assert.throws(() => validate({ ...scheduled, starts_at }));
  }
  assert.throws(() => validate({ ...draft, timezone: "invalid/zone" }));
  assert.throws(() => validate({ ...scheduled, duration_minutes: 0 }));
  assert.throws(() => validate({ ...scheduled, status: "draft" }));
  assert.throws(() => validate({ ...scheduled, token: "must not enter config" }));
});

test("Arabic exact hours omit :00; minute precision and Gregorian dates remain", () => {
  assert.equal(labels(scheduled).ar.time, "٨ مساءً بتوقيت الكويت ومكة");
  assert.match(labels(scheduled).ar.date, /٢٠٩٩/);
  assert.equal(labels({ ...scheduled, starts_at: "2099-10-01T20:30:00+03:00" }).ar.time, "٨:٣٠ مساءً بتوقيت الكويت ومكة");
  assert.equal(labels({ ...scheduled, starts_at: "2099-10-01T00:00:00+03:00" }).ar.time, "١٢ صباحًا بتوقيت الكويت ومكة");
});

test("calendar uses the same instant, duration, and timezone across midnight", () => {
  const url = new URL(calendarUrl({ ...scheduled, starts_at: "2099-10-01T23:30:00+03:00" }));
  assert.equal(url.searchParams.get("dates"), "20991001T203000Z/20991001T220000Z");
  assert.equal(url.searchParams.get("ctz"), "Asia/Kuwait");
  assert.equal(calendarUrl(draft), null);
});

test("both pages, API, and downloadable config agree; draft has no calendar or live form", async () => {
  const files = await outputs(scheduled);
  const hash = runtime(scheduled).config_sha256;
  for (const content of Object.values(files)) assert.ok(content.includes(hash));
  const html = renderPage(landing, draft, "landing");
  assert.ok(!html.includes('src="https://link.maharamedia.com/widget/form/'));
  assert.ok(!renderPage(thanks, draft, "thanks").includes('href="https://calendar.google.com'));
  assert.match(renderPage(html, scheduled, "landing"), /src="https:\/\/link.maharamedia.com\/widget\/form\//);
  assert.throws(() => renderPage(landing.replace("webinar:date:end", "bad"), draft, "landing"));
});

test("reschedule keeps event identity and immutable previous revision", async (t) => {
  const root = await fixture(t);
  await main(["set", "--at", scheduled.starts_at, "--expected-revision", "1"], root);
  const next = JSON.parse(await readFile(join(root, "config/webinar/current.json")));
  assert.equal(next.event_key, draft.event_key);
  assert.equal(next.revision, 2);
  const old = JSON.parse(await readFile(join(root, `config/webinar/history/${draft.event_key}/revision-1.json`)));
  assert.deepEqual(old, draft);
  await generate(next, root, true);
  await assert.rejects(main(["set", "--at", scheduled.starts_at, "--expected-revision", "1"], root), /Revision conflict/);
  await assert.rejects(generate({ ...next, duration_minutes: 120 }, root), /Immutable revision/);
});

test("a second event in the same month gets a separate key; cannot reuse history", async (t) => {
  const root = await fixture(t);
  await main(["set", "--at", scheduled.starts_at, "--expected-revision", "1"], root);
  await main(["new", "--key", "mahara-live-training-next-002", "--at", "2099-10-12T20:00:00+03:00", "--expected-revision", "2"], root);
  const next = JSON.parse(await readFile(join(root, "config/webinar/current.json")));
  assert.notEqual(next.event_key, draft.event_key);
  assert.equal(next.revision, 1);
  assert.equal(runtime(next).legacy_round, runtime(scheduled).legacy_round);
  await assert.rejects(main(["new", "--key", draft.event_key, "--at", scheduled.starts_at, "--expected-revision", "1"], root), /already used/);
});

test("generation detects manual artifact drift and fixes it without changing revision", async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, "sites/webinar/webinar-schedule.js"), "stale");
  await assert.rejects(generate(draft, root, true), /stale/);
  await generate(draft, root);
  await generate(draft, root, true);
});

test("API rejects conflicting environment settings and missing or past dates", () => {
  const r = runtime(scheduled);
  assert.deepEqual(scheduleIssues({}, now, r), []);
  assert.ok(scheduleIssues({ WEBINAR_START: "different" }, now, r).includes("conflicting_webinar_start"));
  assert.ok(scheduleIssues({ WEBBY_CALENDAR_ID: "wrong" }, now, r).includes("conflicting_webby_calendar_id"));
  assert.ok(scheduleIssues({}, now, runtime(draft)).includes("training_date_not_ready"));
  assert.ok(scheduleIssues({}, now + 365 * 86400000, r).includes("training_date_not_ready"));
});

test("a conflicting API schedule blocks registration before a GHL request", async () => {
  const old = globalThis.fetch;
  const oldCalendar = process.env.WEBBY_CALENDAR_ID;
  process.env.WEBBY_CALENDAR_ID = "deliberately-mismatched-test-calendar";
  let fetches = 0;
  globalThis.fetch = async () => { fetches++; throw new Error("No network allowed"); };
  try {
    const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(value) { this.value = value; return this; } };
    await register({ method: "POST", body: {}, headers: {} }, res);
    assert.equal(res.code, 503);
    assert.equal(fetches, 0);
    assert.equal(res.value.ok, false);
  } finally {
    globalThis.fetch = old;
    if (oldCalendar === undefined) delete process.env.WEBBY_CALENDAR_ID;
    else process.env.WEBBY_CALENDAR_ID = oldCalendar;
  }
});

function evidence() {
  const base = { starts_at: scheduled.starts_at, duration_minutes: 90, timezone: "Asia/Kuwait", captured_at: new Date(now).toISOString(), event_key: scheduled.event_key, revision: 1, config_sha256: runtime(scheduled).config_sha256 };
  return { page: { ...base, rendered_pages_match: true }, api: { ...base, schedule_ready: true }, zoom: { ...base, meeting_id: scheduled.providers.zoom_meeting_id }, ghl: { ...base, location_id: scheduled.providers.ghl_location_id, calendar_id: scheduled.providers.ghl_calendar_id } };
}
test("release evidence requires all four current providers and exact event binding", () => {
  assert.deepEqual(audit(scheduled, evidence(), now), []);
  const e = evidence();
  e.zoom.starts_at = "2099-10-01T17:00:00Z"; // Same instant is valid.
  assert.deepEqual(audit(scheduled, e, now), []);
  e.ghl.calendar_id = "another";
  e.api.config_sha256 = "stale";
  e.page.captured_at = new Date(now - 16 * 60000).toISOString();
  e.zoom.duration_minutes = 60;
  assert.equal(audit(scheduled, e, now).length, 4);
  assert.equal(audit(scheduled, {}, now).length, 4);
  assert.ok(audit(draft, evidence(), now).includes("Choose a future training date before release"));
});

test("read-only web probe checks rendered date and calendar, not metadata alone", async () => {
  const files = await outputs(scheduled);
  let tamper = false;
  const fetcher = async (url, options) => {
    assert.equal(options.method, undefined); // GET only.
    let body;
    if (url.endsWith("schedule.json")) body = files["sites/webinar/schedule.json"];
    else if (url.endsWith("/api/health")) body = JSON.stringify({ webinarStart: scheduled.starts_at, durationMinutes: 90, timezone: scheduled.timezone, eventKey: scheduled.event_key, scheduleRevision: 1, configSha256: runtime(scheduled).config_sha256, scheduleReady: true });
    else if (url.endsWith("thank-you.html")) body = files["sites/webinar/thank-you.html"].replace(tamper ? "٨ مساءً" : "no-match", "٩ مساءً");
    else body = files["sites/webinar/index.html"];
    return { ok: true, text: async () => body };
  };
  assert.equal((await probeWeb(fetcher)).page.rendered_pages_match, true);
  tamper = true;
  assert.equal((await probeWeb(fetcher)).page.rendered_pages_match, false);
  await assert.rejects(probeWeb(async () => ({ ok: false, status: 404 })), /Read-back failed/);
});
