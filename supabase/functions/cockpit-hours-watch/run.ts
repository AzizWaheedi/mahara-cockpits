/**
 * One Hubstaff watch run (SPEC.md "Edge Function"), every 5 minutes:
 *
 *   lease -> inputs -> (nobody on shift, no shift ended in the last 30
 *   minutes and nothing open that needs Hubstaff: statuses, Slack left-overs,
 *   finish, no Hubstaff call) -> Hubstaff reads (blocks too for shifts that
 *   ended in the last 30 minutes, so the shift line fills in) -> classify new
 *   screenshots recorded inside the shift and outside part-day leave (at
 *   most 12, oldest first, with the first saved key not refused, OpenAI
 *   first) -> rules.ts decides -> cockpit_hours_watch_apply (images stored
 *   this run are deleted only when the database refused it on purpose:
 *   RpcError 40001, 22023 or 54000; on a lost answer they are kept, since
 *   the rows may have been written) -> Slack posts, thread replies, and
 *   replies left from earlier runs -> prune once a day after 03:00 Kuwait ->
 *   finish.
 *
 * A dry run reads Hubstaff and answers the plan; it classifies nothing,
 * applies nothing, posts nothing, stores and deletes nothing. The doctor
 * names what is missing and checks each provider once, writing nothing but
 * receipts.
 *
 * Failures never become alerts about a person: Hubstaff failing opens the
 * source incident, the model failing marks a screenshot error, Slack failing
 * is recorded on the incident. A run that cannot read Hubstaff finishes
 * failed, so the guardian's freshness check (cockpit_sync_state
 * 'hours-watch') never shows green while nobody is watched.
 */
import { HoursProviderError, hubstaffGet } from "../cockpit-ceo-api/tools.ts";
import { type Rpc, RpcError } from "../cockpit-hours-sync/db.ts";
import { type AppUse, checkAiKey, classifyShot, type ClassifyResult, failed } from "./classify.ts";
import { appsFor, DOWNLOAD_TIMEOUT_MS, downloadImage, readHubstaff, type Screenshot } from "./hubstaff.ts";
import { isObj, type KnownShot, leaveAt, onShift, type OpenIncident, parseInputs, parseSettings, type Verdict, type WatchInputs, type WatchPerson, type WatchSettings } from "./inputs.ts";
import { aiAccess, hubstaffAccess, markAiKey, refusedNote } from "./keys.ts";
import { type WatchInsert, watchHealth } from "./ledger.ts";
import { type Decision, decide, isNoAccount, pickShots, type Readings, type ShotFact, watchedUserId } from "./rules.ts";
import { checkChannel, type PostOutcome, sendPost } from "./slack.ts";
import { deletePaths, shotPaths, STORAGE_TIMEOUT_MS, uploadImage } from "./storage.ts";
import { kuwaitDay, kuwaitTime } from "./text.ts";

export type RunDeps = {
  rpc: Rpc;
  insertReceipt: WatchInsert;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  /** SLACK_BOT_TOKEN, read by name. Empty when it is not set. */
  slackToken: () => string;
  /** The project URL and service key, for the private bucket. */
  storage: { url: string; serviceKey: string };
  /** Which of the function's secrets are set, by name only (for the doctor). */
  secrets?: () => Record<string, boolean>;
};

export type ShotRow = {
  shotId: number;
  personId: number;
  hubstaffUserId: string;
  recordedAt: string;
  slotStart: string;
  verdict: Verdict;
  label: string | null;
  reason: string | null;
  category: string | null;
  confidence: number | null;
  model: string | null;
  apps: AppUse[];
  attempts: number;
  classifiedAt: string | null;
  thumbPath: string | null;
  fullPath: string | null;
  error: string | null;
};

export type ShotSummary = { classified: number; notWork: number; errors: number; skipped: number; pending: number; stored: number };
export type RunResult = {
  ok: boolean;
  runId: number | null;
  dryRun: boolean;
  note: string;
  onShift: number;
  opened: number[];
  closed: number[];
  shots: ShotSummary;
  posts: PostOutcome[];
  hubstaff: { state: string; note: string | null; called: boolean };
  ai: { state: "connected" | "missing" | "refused" | "off" | "not_needed"; provider: string | null };
  pruned: number | null;
  notes: string[];
  plan?: Pick<Decision<ShotRow>, "slots" | "shots" | "open" | "update" | "close"> & { statuses: (Decision<ShotRow>["statuses"][number] | RestingStatus)[] };
};

/** A status row written without reading Hubstaff: the state and the shift, no figures. */
export type RestingStatus = { personId: number; state: "off_shift" | "on_leave" | "holiday"; since: null; shiftStart: string | null; shiftEnd: string | null; detail: Record<string, unknown> };

/** No new screenshot starts this long into a run; the rest wait for the next run (the lease is 6 minutes). */
export const CLASSIFY_BUDGET_MS = 90_000;
/** One screenshot (download 15 s, model 25 s, storing the evidence) never takes longer than this. */
export const SHOT_BUDGET_MS = 60_000;
/** Hubstaff is still read for someone whose shift ended this recently, so the end of their shift line fills in. */
export const AFTER_SHIFT_MS = 30 * 60_000;
const KUWAIT_MS = 3 * 3600_000;

/** Off shift now, with a shift that ended in the last 30 minutes. */
export function shiftJustEnded(p: WatchPerson, now: Date): boolean {
  if (!p.shift || p.offReason) return false;
  const since = now.getTime() - Date.parse(p.shift.end);
  return since >= 0 && since < AFTER_SHIFT_MS;
}

/**
 * An open incident that needs a Hubstaff read or a decision this run: all but
 * a "not in Hubstaff" alert whose person is still listed, still employed and
 * not paused, and still has no account.
 */
export function needsRun(inc: OpenIncident, people: WatchPerson[]): boolean {
  if (!isNoAccount(inc)) return true;
  const p = people.find(x => x.personId === inc.personId);
  return !p || watchedUserId(p) !== null || p.offReason === "not_employed" || p.offReason === "paused";
}

/** A screenshot worth judging: recorded inside the person's shift, and not inside part-day leave. Others are dropped unread. */
export function shotInShift(p: WatchPerson, recordedAt: string): boolean {
  const t = Date.parse(recordedAt);
  return !!p.shift && Date.parse(p.shift.start) <= t && t < Date.parse(p.shift.end) && !leaveAt(p, t);
}

/** The database refused the apply on purpose (lost lease, a bad payload, too large): nothing was written. Anything else may have been. */
export const REFUSED_CODES = ["40001", "22023", "54000"];
export const applyRefused = (e: unknown) => e instanceof RpcError && REFUSED_CODES.includes(e.code ?? "");

export type Claim = { ok: true; runId: number; leaseToken: string } | { ok: false; busy: true; since: string | null };

export async function claimWatch(rpc: Rpc, p: { requestedBy: string; dryRun: boolean }): Promise<Claim> {
  const r = await rpc("cockpit_hours_watch_lease_claim", { p });
  if (isObj(r) && r.ok === true && typeof r.leaseToken === "string") return { ok: true, runId: Number(r.runId), leaseToken: r.leaseToken };
  return { ok: false, busy: true, since: isObj(r) && typeof r.since === "string" ? r.since : null };
}

/** Prune once a day: the first run after 03:00 Kuwait (by the last prune's day when the inputs carry it, else the 03:00 to 03:15 runs). */
export function pruneDue(now: Date, lastPruneOn: string | null): boolean {
  const local = new Date(now.getTime() + KUWAIT_MS);
  const hour = local.getUTCHours();
  if (hour < 3) return false;
  if (lastPruneOn) return lastPruneOn < kuwaitDay(now);
  return hour === 3 && local.getUTCMinutes() < 15;
}

const noteOf = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message.slice(0, 200) : fallback);
const emptyShots = (): ShotSummary => ({ classified: 0, notWork: 0, errors: 0, skipped: 0, pending: 0, stored: 0 });

export async function runWatch(deps: RunDeps, run: { runId: number | null; leaseToken: string | null; dryRun?: boolean }): Promise<RunResult> {
  const dry = run.dryRun === true;
  const started = deps.now();
  const { health, hubstaff } = watchHealth(deps.insertReceipt, run.runId);
  const out: RunResult = {
    ok: true, runId: run.runId, dryRun: dry, note: "", onShift: 0, opened: [], closed: [], shots: emptyShots(), posts: [],
    hubstaff: { state: "not_called", note: null, called: false }, ai: { state: "not_needed", provider: null }, pruned: null, notes: [],
  };
  let failure: string | null = null;
  try {
    const inputs: WatchInputs = parseInputs(await deps.rpc("cockpit_hours_watch_inputs", { p_now: started.toISOString() }));
    const cfg = inputs.settings;
    const people = inputs.people;
    const onShiftPeople = people.filter(p => onShift(p, started));
    const justEnded = people.filter(p => shiftJustEnded(p, started));
    out.onShift = onShiftPeople.length;
    const slack = { rpc: deps.rpc, health, fetch: deps.fetch, token: deps.slackToken };

    if (!onShiftPeople.length && !justEnded.length && !inputs.open.some(i => needsRun(i, people))) {
      out.note = "Nobody on shift";
      if (!dry) {
        // Statuses without Hubstaff's fields: the stored figures of the day stay as they are.
        await deps.rpc("cockpit_hours_watch_apply", { p: { runId: run.runId, leaseToken: run.leaseToken, statuses: people.map(p => restingStatus(p)), slots: [], shots: [], open: [], update: [], close: [] } });
        await sendAll(slack, cfg, inputs, [], [], out);
        out.pruned = await maybePrune(deps, health, started, inputs, out.notes);
      } else out.plan = { statuses: people.map(p => restingStatus(p)), slots: [], shots: [], open: [], update: [], close: [] };
      await finish(deps, run, out, null, dry);
      return out;
    }

    // ------------------------------------------------------------- Hubstaff
    const dayStart = Date.parse(`${kuwaitDay(started)}T00:00:00Z`) - KUWAIT_MS;
    const from = Math.min(dayStart, ...[...onShiftPeople, ...justEnded].map(p => Date.parse(p.shift!.start)));
    const read = await readHubstaff({ rpc: deps.rpc, hubstaff, fetch: deps.fetch, now: deps.now, sleep: deps.sleep }, { from: new Date(from), shots: cfg.shots });
    out.hubstaff = read.ok ? { state: "ok", note: null, called: true } : { state: read.state, note: read.note, called: true };
    if (read.ok) out.notes.push(...read.notes);
    const readings: Readings = read.ok
      ? { ok: true, lastActivities: read.lastActivities, activities: read.activities, screenshotsOn: read.screenshotsOn, readAt: read.readAt }
      : { ok: false, note: read.note };

    // ----------------------------------------------------------- screenshots
    const known = new Map<number, KnownShot>(inputs.knownShots.map(s => [s.shotId, s]));
    const byUser = new Map<string, WatchPerson>();
    for (const p of onShiftPeople) if (p.hubstaffUserId) byUser.set(p.hubstaffUserId, p);
    // Screenshots from before the shift starts (or after it ends, or inside part-day leave) are never classified, stored or shown.
    const screens = read.ok ? read.screenshots.filter(s => byUser.has(s.userId) && shotInShift(byUser.get(s.userId)!, s.recordedAt)) : [];
    const facts = new Map<number, ShotFact>();
    for (const k of inputs.knownShots) facts.set(k.shotId, { shotId: k.shotId, personId: k.personId, recordedAt: k.recordedAt, verdict: k.verdict, confidence: k.confidence, label: k.label });
    for (const s of screens) {
      const f = facts.get(s.id);
      if (f) facts.set(s.id, { ...f, personId: f.personId ?? byUser.get(s.userId)!.personId, recordedAt: f.recordedAt ?? s.recordedAt });
    }
    const rows: ShotRow[] = [];
    // Images stored this run: deleted again if the apply throws, so none is left without its row.
    const uploaded: string[] = [];
    const store = { url: deps.storage.url, serviceKey: deps.storage.serviceKey, health, fetch: deps.fetch };
    if (read.ok && cfg.shots && screens.length) {
      const toolUsages = read.toolUsages;
      const owed = pickShots(screens, known, screens.length);
      const ai = await aiAccess(deps.rpc);
      out.ai = ai.ok ? { state: "connected", provider: ai.key.provider } : { state: ai.state, provider: null };
      const key = ai.ok ? ai.key : null;
      const row = (s: Screenshot, verdict: Verdict, extra: Partial<ShotRow> = {}): ShotRow => ({
        shotId: s.id, personId: byUser.get(s.userId)!.personId, hubstaffUserId: s.userId, recordedAt: s.recordedAt, slotStart: s.slotStart, verdict,
        label: null, reason: null, category: null, confidence: null, model: null, apps: appsFor(toolUsages, s.userId, s.slotStart),
        attempts: known.get(s.id)?.attempts ?? 0, classifiedAt: null, thumbPath: null, fullPath: null, error: null, ...extra,
      });
      const todo = key && !dry ? pickShots(owed, known) : [];
      const waiting = owed.filter(s => !todo.includes(s));
      for (const s of waiting) {
        // Recorded once, so the card can show it: skipped without a key, pending otherwise.
        const k = known.get(s.id);
        if (!ai.ok && (!k || k.verdict === "pending")) rows.push(row(s, "skipped", { error: ai.note.slice(0, 240) }));
        else if (!k) rows.push(row(s, "pending"));
      }
      // Set when the model refuses the key: the key is marked and no other screenshot is checked this run.
      let refused: string | null = null;
      let confirmed = key?.state === "connected";
      for (const s of todo) {
        const k = known.get(s.id);
        if (refused) {
          if (!k || k.verdict === "pending" || k.verdict === "skipped") rows.push(row(s, "skipped", { error: refused }));
          continue;
        }
        if (!key || deps.now().getTime() - started.getTime() > CLASSIFY_BUDGET_MS) {
          if (!k) rows.push(row(s, "pending"));
          continue;
        }
        const person = byUser.get(s.userId)!;
        const attempts = (k?.attempts ?? 0) + 1;
        const apps = appsFor(toolUsages, s.userId, s.slotStart);
        const deadline = deps.now().getTime() + SHOT_BUDGET_MS;
        const timeLeft = () => deadline - deps.now().getTime();
        // A failed download or an expired link is category "download", a model failure "model": only the second says the key may be wrong.
        const judge = async (): Promise<{ result: ClassifyResult; full: Uint8Array | null }> => {
          let image: Uint8Array;
          try {
            if (!s.fullUrl) throw new Error("Hubstaff gave no link to the screenshot.");
            image = await downloadImage({ health, fetch: deps.fetch }, s.fullUrl, "full", Math.min(DOWNLOAD_TIMEOUT_MS, timeLeft()));
          } catch (e) {
            return { result: failed(noteOf(e, "The screenshot could not be downloaded."), null, "download"), full: null };
          }
          try {
            return { result: await classifyShot({ health, fetch: deps.fetch, timeLeft }, key, image, { role: person.role, apps }), full: image };
          } catch (e) {
            return { result: failed(noteOf(e, "The model could not be asked."), null, "model"), full: image };
          }
        };
        const { result, full } = await judge();
        if (result.verdict === "error" && result.refused) {
          // Not this screenshot's fault: it waits, unjudged, for a key that works.
          refused = refusedNote(key.provider);
          out.ai = { state: "refused", provider: key.provider };
          try {
            // Compare-and-swap on savedAt: a key pasted since this run read it is never marked by this one's failure.
            const mark = await markAiKey(deps.rpc, key, "refused", result.error);
            if (!mark.ok) out.notes.push(`The refused AI key was not marked: ${mark.note}`);
          } catch (e) {
            out.notes.push(`The refused AI key could not be marked: ${noteOf(e, "no answer")}`);
          }
          if (!k || k.verdict === "pending" || k.verdict === "skipped") rows.push(row(s, "skipped", { error: refused }));
          continue;
        }
        if (result.verdict !== "error" && !confirmed) {
          confirmed = true;
          try {
            const mark = await markAiKey(deps.rpc, key, "connected", "The screenshot check answered with this key.");
            if (!mark.ok) out.notes.push(`The AI key was not marked connected: ${mark.note}`);
          } catch (e) {
            out.notes.push(`The AI key could not be marked connected: ${noteOf(e, "no answer")}`);
          }
        }
        const r = row(s, result.verdict, {
          label: result.label, reason: result.reason, category: result.category, confidence: result.confidence, model: result.model, apps,
          attempts, classifiedAt: deps.now().toISOString(), error: result.error,
        });
        if (result.verdict === "not_work" && full) {
          // The evidence outlives Hubstaff's 2-hour link: thumbnail and full image, private bucket.
          const paths = shotPaths(person.personId, s.recordedAt, s.id);
          // Each step gets what is left of the screenshot's minute, never more than its own cap.
          const left = (cap: number) => {
            const t = Math.min(cap, timeLeft());
            if (t < 1000) throw new Error("the screenshot's minute ran out");
            return t;
          };
          try {
            await uploadImage(store, paths.full, full, left(STORAGE_TIMEOUT_MS));
            uploaded.push(paths.full);
            r.fullPath = paths.full;
            const thumb = s.thumbUrl ? await downloadImage({ health, fetch: deps.fetch }, s.thumbUrl, "thumb", left(DOWNLOAD_TIMEOUT_MS)) : null;
            if (thumb) {
              await uploadImage(store, paths.thumb, thumb, left(STORAGE_TIMEOUT_MS));
              uploaded.push(paths.thumb);
              r.thumbPath = paths.thumb;
            }
            out.shots.stored += 1;
          } catch (e) {
            r.error = `The images could not be stored: ${noteOf(e, "no answer")}`.slice(0, 240);
          }
        }
        rows.push(r);
        facts.set(s.id, { shotId: s.id, personId: person.personId, recordedAt: s.recordedAt, verdict: result.verdict, confidence: result.confidence, label: result.label });
      }
      if (dry) out.notes.push(`${owed.length} screenshot${owed.length === 1 ? "" : "s"} would be checked.`);
    } else if (read.ok && !cfg.shots) out.ai = { state: "off", provider: null };
    for (const r of rows) {
      if (!facts.has(r.shotId) || r.verdict === "skipped" || r.verdict === "pending")
        facts.set(r.shotId, { shotId: r.shotId, personId: r.personId, recordedAt: r.recordedAt, verdict: r.verdict, confidence: r.confidence, label: r.label });
      if (r.verdict === "error") out.shots.errors += 1;
      else if (r.verdict === "skipped") out.shots.skipped += 1;
      else if (r.verdict === "pending") out.shots.pending += 1;
      else out.shots.classified += 1;
      if (r.verdict === "not_work") out.shots.notWork += 1;
    }

    // ---------------------------------------------------------------- decide
    const plan = decide<ShotRow>({
      now: started, settings: cfg, people, open: inputs.open, readings, shots: [...facts.values()], shotRows: rows, rules: inputs.rules, lastOkRunAt: inputs.lastOkRunAt,
    });
    out.note = plan.note;
    if (!read.ok) failure = `Hubstaff cannot be read: ${read.note}`.slice(0, 240);
    if (dry) {
      out.plan = { statuses: plan.statuses, slots: plan.slots, shots: plan.shots, open: plan.open, update: plan.update, close: plan.close };
      await finish(deps, run, out, failure, dry);
      return out;
    }
    let applied: unknown;
    try {
      applied = await deps.rpc("cockpit_hours_watch_apply", { p: {
        runId: run.runId, leaseToken: run.leaseToken, statuses: plan.statuses, slots: plan.slots, shots: plan.shots, open: plan.open, update: plan.update, close: plan.close,
      } });
    } catch (e) {
      // Only a refusal on purpose means no row points at the images stored this run: then delete them. On a lost
      // answer (network, a 5xx) the rows may have been written, so the evidence is kept. Either way the run fails.
      if (uploaded.length && applyRefused(e)) {
        try {
          await deletePaths(store, uploaded);
        } catch (d) {
          out.notes.push(`Images stored this run could not be deleted: ${noteOf(d, "no answer")}`);
        }
      }
      throw e;
    }
    const ids = (v: unknown) => (Array.isArray(v) ? v.map(Number).filter(n => Number.isSafeInteger(n) && n > 0) : []);
    out.opened = ids(isObj(applied) ? applied.opened : null);
    out.closed = ids(isObj(applied) ? applied.closed : null);

    // ----------------------------------------------------------------- Slack
    await sendAll(slack, cfg, inputs, out.opened, out.closed, out);
    out.pruned = await maybePrune(deps, health, started, inputs, out.notes);
  } catch (e) {
    failure = noteOf(e, "The watch run stopped unexpectedly.");
    out.note = out.note || failure;
  }
  await finish(deps, run, out, failure, dry);
  return out;
}

/**
 * Slack for one run: posts for the incidents opened now and those still
 * pending from earlier runs, thread replies for those closed now and those
 * left pending by earlier runs (inputs.replies). Each is claimed, so a
 * second run never sends the same one twice.
 */
async function sendAll(slack: Parameters<typeof sendPost>[0], cfg: WatchSettings, inputs: WatchInputs, opened: number[], closed: number[], out: RunResult) {
  const posts = [...new Set([...opened, ...inputs.open.filter(i => i.slackState === "pending" && !closed.includes(i.id)).map(i => i.id)])];
  const replies = [...new Set([...closed, ...inputs.replies.map(i => i.id)])];
  const sends: [number, "open" | "resolve"][] = [
    ...posts.map(id => [id, "open"] as [number, "open"]),
    ...replies.map(id => [id, "resolve"] as [number, "resolve"]),
  ];
  for (const [id, which] of sends) {
    try {
      out.posts.push(await sendPost(slack, id, which, cfg));
    } catch (e) {
      out.notes.push(`Slack ${which === "open" ? "post" : "reply"} for incident ${id} stopped: ${noteOf(e, "no answer")}`);
    }
  }
}

/** A status row for a run that did not read Hubstaff: the state and the shift, no figures. */
function restingStatus(p: WatchPerson): RestingStatus {
  return {
    personId: p.personId,
    state: p.offReason === "holiday" ? "holiday" : p.offReason === "leave" ? "on_leave" : "off_shift",
    since: null, shiftStart: p.shift?.start ?? null, shiftEnd: p.shift?.end ?? null, detail: { offReason: p.offReason },
  };
}

async function maybePrune(deps: RunDeps, health: ReturnType<typeof watchHealth>["health"], now: Date, inputs: WatchInputs, notes: string[]): Promise<number | null> {
  if (!pruneDue(now, inputs.lastPruneOn)) return null;
  try {
    const r = await deps.rpc("cockpit_hours_watch_prune", {});
    const paths = Array.isArray(r) ? r : isObj(r) && Array.isArray(r.paths) ? r.paths : [];
    return await deletePaths({ url: deps.storage.url, serviceKey: deps.storage.serviceKey, health, fetch: deps.fetch }, paths);
  } catch (e) {
    notes.push(`The daily prune stopped: ${noteOf(e, "no answer")}`);
    return null;
  }
}

async function finish(deps: RunDeps, run: { runId: number | null; leaseToken: string | null }, out: RunResult, failure: string | null, dry: boolean) {
  out.ok = failure === null;
  if (failure && !out.note.includes(failure)) out.note = out.note ? `${out.note} ${failure}` : failure;
  if (dry) out.note = `Dry run: nothing written. ${out.note}`;
  if (run.runId === null || run.leaseToken === null) return;
  const { plan: _plan, ...summary } = out;
  try {
    await deps.rpc("cockpit_hours_watch_finish", { p: {
      runId: run.runId, leaseToken: run.leaseToken, state: out.ok ? "ok" : "failed", dryRun: dry, note: out.note.slice(0, 500), rowsSeen: out.onShift,
      result: { ...summary, watched: out.onShift, posts: summary.posts.map(p => ({ incidentId: p.incidentId, which: p.which, state: p.state, error: p.error ?? null })) },
      error: failure,
    } });
  } catch (e) {
    out.notes.push(`The run could not be closed: ${noteOf(e, "no answer")}`);
  }
}

export type DoctorResult = {
  ok: boolean;
  job: "doctor";
  secrets: Record<string, boolean>;
  hubstaff: { state: string; note: string };
  ai: { state: "connected" | "missing" | "refused" | "unchecked"; provider: string | null; note: string };
  slack: { state: "ok" | "failing" | "unknown"; channel: string; note: string };
  note: string;
};

/** Names what is missing and checks each provider once. Writes nothing but receipts. */
export async function runDoctor(deps: RunDeps): Promise<DoctorResult> {
  const { health, hubstaff } = watchHealth(deps.insertReceipt, null);
  const secrets = deps.secrets?.() ?? { SLACK_BOT_TOKEN: !!deps.slackToken().trim() };
  let settings = parseSettings(null);
  try {
    const inputs = await deps.rpc("cockpit_hours_watch_inputs", { p_now: deps.now().toISOString() });
    if (isObj(inputs)) settings = parseSettings(inputs.settings);
  } catch { /* the default channel stands */ }

  let hs: DoctorResult["hubstaff"];
  try {
    const access = await hubstaffAccess(deps.rpc, hubstaff, deps.fetch, deps.now);
    if (!access.ok) hs = { state: access.state, note: access.note };
    else {
      const page = await hubstaffGet(access.token, hubstaff, deps.fetch, `organizations/${access.accountId}/screenshot_settings`, { page_limit: 100 }, { sleep: deps.sleep });
      const rows = Object.values(page).filter(Array.isArray).flat().filter(isObj);
      const on = rows.filter(r => Number(r.screenshot_frequency) > 0).length;
      hs = { state: "connected", note: `Hubstaff answered: screenshots are on for ${on} ${on === 1 ? "person" : "people"}.` };
    }
  } catch (e) {
    hs = { state: e instanceof HoursProviderError ? e.kind : "failed", note: noteOf(e, "Hubstaff could not be read.") };
  }

  let ai: DoctorResult["ai"];
  try {
    const access = await aiAccess(deps.rpc);
    if (!access.ok) ai = { state: access.state, provider: null, note: access.note };
    else {
      const check = await checkAiKey({ health, fetch: deps.fetch }, access.key.provider, access.key.secret);
      ai = { state: check.state, provider: access.key.provider, note: check.note };
    }
  } catch (e) {
    ai = { state: "unchecked", provider: null, note: noteOf(e, "The AI key could not be read.") };
  }

  let slack: DoctorResult["slack"];
  try {
    slack = { ...(await checkChannel({ health, fetch: deps.fetch, token: deps.slackToken }, settings.channel)), channel: settings.channel };
  } catch (e) {
    slack = { state: "unknown", channel: settings.channel, note: noteOf(e, "Slack could not be checked.") };
  }

  const missing = Object.entries(secrets).filter(([, set]) => !set).map(([name]) => name);
  const ok = !missing.length && hs.state === "connected" && ai.state === "connected" && slack.state === "ok";
  const parts = [
    missing.length ? `Missing secrets: ${missing.join(", ")}.` : "Secrets are set.",
    hs.note, ai.note, slack.note,
  ];
  return { ok, job: "doctor", secrets, hubstaff: hs, ai, slack, note: `${parts.join(" ")} Checked at ${kuwaitTime(deps.now())} Kuwait.` };
}
