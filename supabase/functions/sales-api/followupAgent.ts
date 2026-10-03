// The follow-up agent's sales-api actions, phase 1 (desk NOTES sections 4 and
// 5, glossary 1.5): backlog waves, the approved batch, holds, the desk's paced
// send, the stop task and the levels. The desk (hermes/sales-desk/desk/waves.py)
// enrols, drafts and paces; these are the doors it and the screens use.
//
// Every action is gated (a seat; needManager where the glossary says), every
// write leaves an audit row, and every refusal says what to do next. A
// refusal that holds every send carries hold_all, which the desk reads as
// "stop the run".

import { cleanText, redact, type Who } from "./lib.ts";
import { ApiRefusal, DbError, isUnique, type LiveIO } from "./liveio.ts";
import { GATE_SHUT, gateOpen, hoursRefusal } from "./sendrules.ts";

type Row = Record<string, unknown>;
type Action = (who: Who, b: Row) => Promise<Row>;

const enc = encodeURIComponent;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POOLS = ["no_show_cancelled", "good_intro", "unclosed_demo", "never_booked"] as const;
export const LEVELS = ["approve", "send_unless_stopped", "sends_by_itself", "off"] as const;
export const KIND_KEY = /^(reply|confirm|no_show|cancelled|new|after_call|nurture|good_intro|reactivate)\.(ar|en)\.(whatsapp|whatsapp_template|email)$/;
/** The most openers one approval schedules (followups.waves.per_day's ceiling for a day). */
export const BATCH_MAX = 40;
/** An approved opener may still go this long after its turn: past a night and the lead's day off. */
export const APPROVED_KEEP_MS = 72 * 3_600_000;

/**
 * Refusals that only say another send got there first, or the draft's state
 * moved on (two desk runs, an approval not due yet, a wave paused): the draft
 * is not at fault, so it is never set aside for a person.
 */
export const STATE_RACE =
  /someone else has just dealt with this draft|this draft was already|not approved to go yet|paused or stopped|is held, so it was not sent|backlog opener was taken back|kind of opener is off|already going out|conversation has moved on/i;

/**
 * Refusals about the template's setup, not the lead (the template not set up
 * or not in the cockpit, the HighLevel contact fields not set): they hold
 * every opener of that template, so the batch waits in the queue (hold_all,
 * code setup) and nothing is set aside lead by lead.
 */
export const SETUP_FAULT =
  /template is not set up|whatsapp template is not in the cockpit|contact fields? (?:for the room code and the call's time )?are not set|setting wa_fields/i;

/** held_by while followup.send_due sends an opener: a Hold that lands now is told it is already going out. */
export const SENDING = "sales-desk:sending";
/** A sending mark older than this is a send that stopped half way: the next send_due may take it again. */
export const SENDING_STALE_MS = 5 * 60_000;

export const AGENT_COPY = {
  manager_only: "Only a sales manager can change this.",
  bad_pool: "Pick one of the four pools: no-shows and cancellations, good intros, unclosed demos, never booked.",
  wave_running: "A wave for this pool is already running or paused. Resume it, or stop it first.",
  wave_missing: "That wave is not here any more. Reload the page.",
  wave_state: "This wave is {state}, so it cannot be {op}.",
  stopped: "Stopped by a manager.",
  batch_empty: "There are no open backlog openers to approve here.",
  batch_too_many: "Approve at most 40 openers at a time.",
  batch_not_open: "Some of these openers were already sent, skipped or taken back. Reload the page.",
  batch_not_opener: "Only backlog openers go out in a paced batch. Approve other drafts one by one.",
  batch_all_held: "Every opener here is held by a rep. Ask them, or release the hold first.",
  not_yours: "That is another rep's lead.",
  draft_missing: "That draft is not here any more.",
  agent_off: "The follow-up agent is switched off (followups.enabled), so nothing is sent.",
  agent_off_screen: "The follow-up agent is switched off, so no wave starts and no opener is approved. A manager switches it on under Follow-ups, How it works.",
  wa_off: "Sending by WhatsApp is switched off in the cockpit.",
  held: "This draft is held, so it was not sent. Release the hold or approve it again.",
  not_due: "This draft is not approved to go yet.",
  wave_not_running: "This opener was approved for a wave that is paused or stopped, so it was not sent.",
  not_draft: "This draft was already {status}.",
  stop_missing: "That stop is not here any more. Reload the page.",
  stop_answer: "Answer stop, pause or resume.",
  level_bad: "Pick approve, sends unless stopped, sends by itself or off.",
  kind_bad: "That is not a kind of follow-up.",
  lead_missing: "That lead is not in the cockpit.",
  opener_booked: "The lead has a call booked now, so the backlog opener was taken back.",
  sending: "This opener is already going out, so it cannot be held now.",
  raced: "Someone else has just dealt with this draft.",
  kind_off: "This kind of opener is off ({kind}), so it waits in the queue. A manager switches it back on under Follow-ups, or pauses the wave.",
  batch_partial:
    "{done} of {total} openers were approved and go from {time}, one every {gap} seconds. The rest were not: press Approve all again for them.",
} as const;

export interface AgentDeps {
  io: LiveIO;
  audit(who: Who, action: string, entityType: string, entityId: string | null, before: unknown, after: unknown, metadata?: Row): Promise<void>;
  /** index.ts sendFollowup, sending as `who` and recording `decidedBy` as the person who approved it. */
  sendFollowup(who: Who, f: Row, b: Row, auto: boolean, opts?: { decidedBy?: string | null }): Promise<Row>;
  /** WhatsApp health for one source (index.ts whatsappHealth({source})). */
  whatsappHealth(source: "followup"): Promise<{ paused: boolean; why: string }>;
}

const refusal = (message: string, status = 409, extra: Row = {}) => new ApiRefusal(message, status, extra);
const holdAll = (message: string, status = 409) => new ApiRefusal(message, status, { hold_all: true });
const lower = (v: unknown) => String(v ?? "").trim().toLowerCase();
const obj = (v: unknown): Row => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {});

/** "14:02", Kuwait time (no daylight saving). */
function kuwaitClock(t: number): string {
  return new Date(t + 3 * 3_600_000).toISOString().slice(11, 16);
}

/** A backlog opener's meta as the desk writes it: its wave and its kind, from the draft's own context. */
export function openerMeta(f: Row): Row {
  const c = obj(f.context);
  const wave = String(c.wave_id ?? "");
  const lang = String(c.language ?? "");
  const channel = String(f.channel ?? "");
  const kind = `reactivate.${lang}.${channel}`;
  return {
    ...(UUID.test(wave) ? { wave_id: wave } : {}),
    ...(f.segment === "reactivate" && KIND_KEY.test(kind) ? { kind_key: kind } : {}),
  };
}

function needManager(who: Who): void {
  if (!who.manager) throw refusal(AGENT_COPY.manager_only, 403);
}

/** Words the desk reads as a hold on every send (desk/waves.py HOLD_ALL_WORDS), as a refusal's extra. */
const HOLD_WORDS = ["today's", "switched off", "are paused", "paused:", "wallet", "funds", "insufficient", "budget", "30 messages in ten minutes", "single-copy"];
export function holdsEverything(message: string, status: number): boolean {
  const m = message.toLowerCase();
  return status === 429 || HOLD_WORDS.some(w => m.includes(w));
}

export function makeFollowupAgent(deps: AgentDeps): { actions: Record<string, Action>; desk: Record<string, Action> } {
  const { io } = deps;
  const iso = (t: number) => new Date(t).toISOString();

  async function settings(keys: string[]): Promise<Record<string, unknown>> {
    const rows = await io.db(`cockpit_sales_settings?key=in.(${keys.join(",")})&select=key,value`);
    return Object.fromEntries(rows.map(r => [String(r.key), r.value]));
  }

  async function draft(id: string): Promise<Row> {
    if (!UUID.test(id)) throw refusal(AGENT_COPY.draft_missing, 404);
    const f = (await io.db(`cockpit_sales_followups?id=eq.${enc(id)}&select=*`))[0];
    if (!f) throw refusal(AGENT_COPY.draft_missing, 404);
    return f;
  }
  async function metaOf(id: string): Promise<Row | null> {
    return (await io.db(`cockpit_sales_followup_meta?followup_id=eq.${enc(id)}&select=*`))[0] ?? null;
  }
  function mayAct(who: Who, f: Row): void {
    if (!who.manager && f.owner_email && lower(f.owner_email) !== lower(who.email)) throw refusal(AGENT_COPY.not_yours, 403);
  }
  async function putMeta(id: string, patch: Row): Promise<Row> {
    const rows = await io.db("cockpit_sales_followup_meta?on_conflict=followup_id", {
      method: "POST",
      body: { followup_id: id, ...patch },
      prefer: "resolution=merge-duplicates,return=representation",
    });
    return rows[0] ?? {};
  }

  // ------------------------------------------------------------- followup.wave

  async function wave(who: Who, b: Row): Promise<Row> {
    needManager(who);
    const op = String(b.op ?? "");
    const s = await settings(["followups", "whatsapp_guard"]);
    if (op === "start") {
      const pool = String(b.pool ?? "");
      if (!(POOLS as readonly string[]).includes(pool)) throw refusal(AGENT_COPY.bad_pool, 400);
      // The agent's switch holds every wave (the screen disables the press too).
      if (obj(s.followups).enabled === false) throw refusal(AGENT_COPY.agent_off_screen, 409);
      if (!gateOpen(s.whatsapp_guard)) throw refusal(GATE_SHUT, 409, { hold_all: true });
      const w = obj(obj(s.followups).waves);
      const perDay = b.per_day === undefined ? Number(w.per_day ?? 40) : Number(b.per_day);
      if (!Number.isInteger(perDay) || perDay < 0 || perDay > 200) throw refusal("Openers a day has to be a whole number from 0 to 200.", 400);
      const share = Number(w.holdout_share ?? 0.1);
      const row = {
        pool,
        segment: "reactivate",
        per_day: perDay,
        holdout_share: Number.isFinite(share) && share >= 0 && share <= 0.5 ? share : 0.1,
        state: "running",
        made_by: lower(who.email),
        note: cleanText(b.note, 500) || null,
      };
      let made: Row;
      try {
        made = (await io.db("cockpit_sales_followup_waves", { method: "POST", body: row, prefer: "return=representation" }))[0] as Row;
      } catch (e) {
        if (isUnique(e)) {
          // The same manager's second press within a minute: the wave it made.
          const cur = (await io.db(
            `cockpit_sales_followup_waves?pool=eq.${enc(pool)}&state=in.(running,paused)&select=*&limit=1`,
          ))[0];
          if (cur && lower(cur.made_by) === lower(who.email) && io.now() - Date.parse(String(cur.created_at)) < 60_000)
            return { wave: cur, repeated: true };
          throw refusal(AGENT_COPY.wave_running, 409);
        }
        throw e;
      }
      await deps.audit(who, "followup.wave.start", "cockpit_sales_followup_waves", String(made.id), null, made);
      return { wave: made };
    }
    const id = String(b.wave_id ?? "");
    if (!UUID.test(id)) throw refusal(AGENT_COPY.wave_missing, 404);
    const moves: Record<string, { from: string[]; to: string; patch?: Row }> = {
      pause: { from: ["running"], to: "paused" },
      resume: { from: ["paused"], to: "running" },
      stop: { from: ["running", "paused", "draft"], to: "done", patch: { done_reason: AGENT_COPY.stopped } },
    };
    const m = moves[op];
    if (!m) throw refusal("Start, pause, resume or stop?", 400);
    // Two managers at once (pause and stop): each move is written only from
    // the state it read; one that misses reads the wave again and decides
    // again, so a stop after a pause still stops it.
    for (let i = 0; i < 3; i++) {
      const before = (await io.db(`cockpit_sales_followup_waves?id=eq.${enc(id)}&select=*`))[0];
      if (!before) throw refusal(AGENT_COPY.wave_missing, 404);
      if (before.state === m.to) return { wave: before, repeated: true };
      if (!m.from.includes(String(before.state)))
        throw refusal(AGENT_COPY.wave_state.replace("{state}", String(before.state)).replace("{op}", op === "stop" ? "stopped" : `${op}d`));
      // Pause and stop always work; a resume waits for the switch and the gate.
      if (op === "resume" && obj(s.followups).enabled === false) throw refusal(AGENT_COPY.agent_off_screen, 409);
      if (op === "resume" && !gateOpen(s.whatsapp_guard)) throw refusal(GATE_SHUT, 409, { hold_all: true });
      const rows = await io.db(`cockpit_sales_followup_waves?id=eq.${enc(id)}&state=eq.${enc(String(before.state))}`, {
        method: "PATCH",
        body: { state: m.to, ...(m.patch ?? {}) },
        prefer: "return=representation",
      });
      if (rows.length) {
        await deps.audit(who, `followup.wave.${op}`, "cockpit_sales_followup_waves", id, before, rows[0]);
        return { wave: rows[0] };
      }
    }
    throw refusal("This wave changed a moment ago. Reload the page.", 409);
  }

  // ------------------------------------------------------------- followup.batch

  /**
   * A rep's own hold (held_by is a person, not the desk's set-aside): an
   * Approve all never lifts it. The desk's set-aside (held_by sales-desk) is
   * a refusal a manager's approval answers, so that one is cleared.
   */
  const repHold = (m: Row | undefined) => Boolean(m?.held_by) && lower(m?.held_by) !== "sales-desk" && lower(m?.held_by) !== SENDING;

  /**
   * One opener's approval, written only where no person holds it: a Hold
   * that lands first wins, and one that lands after holds it again (the
   * desk's send_due refuses a held draft). Answers whether it was approved.
   */
  async function approveOne(id: string, patch: Row, made_with: Row = {}): Promise<boolean> {
    for (const guard of ["held_by=is.null", "held_by=eq.sales-desk"]) {
      const rows = await io.db(`cockpit_sales_followup_meta?followup_id=eq.${enc(id)}&${guard}`, {
        method: "PATCH",
        body: { ...patch, held_by: null, hold_reason: null },
        prefer: "return=representation",
      });
      if (rows.length) return true;
    }
    // No meta row yet (the desk stopped between the draft and its meta): made
    // here with the draft's own wave and kind, so a paused wave still holds
    // it, unless a Hold made it first.
    const made = await io.db("cockpit_sales_followup_meta?on_conflict=followup_id", {
      method: "POST",
      body: { followup_id: id, ...made_with, ...patch, held_by: null, hold_reason: null },
      prefer: "resolution=ignore-duplicates,return=representation",
    });
    if (made.length) return true;
    const rows = await io.db(`cockpit_sales_followup_meta?followup_id=eq.${enc(id)}&held_by=is.null`, {
      method: "PATCH",
      body: patch,
      prefer: "return=representation",
    });
    return rows.length > 0;
  }

  async function batch(who: Who, b: Row): Promise<Row> {
    const s = await settings(["followups", "whatsapp_guard"]);
    if (obj(s.followups).enabled === false) throw refusal(AGENT_COPY.agent_off_screen, 409);
    if (!gateOpen(s.whatsapp_guard)) throw refusal(GATE_SHUT, 409, { hold_all: true });
    let ids: string[];
    let held: string[] = [];
    if (b.wave_id !== undefined && b.wave_id !== null) {
      const waveId = String(b.wave_id);
      if (!UUID.test(waveId)) throw refusal(AGENT_COPY.wave_missing, 404);
      // The wave's open openers, however many it has finished: the open
      // drafts first (few), then which of them belong to this wave.
      const open = await io.db(
        "cockpit_sales_followups?status=eq.draft&segment=eq.reactivate&select=id,created_at&order=created_at.asc&limit=1000",
      );
      const metas: Row[] = [];
      for (let i = 0; i < open.length; i += 100) {
        const chunk = open.slice(i, i + 100).map(r => enc(String(r.id)));
        metas.push(...(await io.db(`cockpit_sales_followup_meta?wave_id=eq.${enc(waveId)}&followup_id=in.(${chunk.join(",")})&select=followup_id,held_by`)));
      }
      const byId = new Map(metas.map(m => [String(m.followup_id), m]));
      const mine = open.filter(r => byId.has(String(r.id)));
      held = mine.filter(r => repHold(byId.get(String(r.id)))).map(r => String(r.id));
      // At most a day's batch at a time; the rest wait for the next press.
      ids = mine.filter(r => !repHold(byId.get(String(r.id)))).slice(0, BATCH_MAX).map(r => String(r.id));
      if (!ids.length && held.length) throw refusal(AGENT_COPY.batch_all_held, 409);
    } else {
      ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(x => String(x ?? "").toLowerCase()))];
      if (ids.some(x => !UUID.test(x))) throw refusal(AGENT_COPY.batch_not_open, 400);
    }
    if (!ids.length) throw refusal(AGENT_COPY.batch_empty, 409);
    if (ids.length > BATCH_MAX) throw refusal(AGENT_COPY.batch_too_many, 400);
    const drafts = await io.db(`cockpit_sales_followups?id=in.(${ids.map(enc).join(",")})&select=id,status,segment,owner_email,expires_at,channel,context`);
    if (drafts.length !== ids.length || drafts.some(d => d.status !== "draft")) throw refusal(AGENT_COPY.batch_not_open, 409);
    if (drafts.some(d => d.segment !== "reactivate")) throw refusal(AGENT_COPY.batch_not_opener, 409);
    for (const d of drafts) mayAct(who, d);
    const gap = Math.max(30, Math.min(3600, Number(obj(obj(s.followups).waves).batch_gap_s ?? 45) || 45));
    const start = io.now();
    const order = new Map(ids.map((x, i) => [x, i]));
    const sorted = [...drafts].sort((a, c) => (order.get(String(a.id)) ?? 0) - (order.get(String(c.id)) ?? 0));
    const approved: string[] = [];
    let i = 0;
    try {
      for (const d of sorted) {
        const sendAfter = start + i * gap * 1000;
        const ok = await approveOne(
          String(d.id),
          { send_after: iso(sendAfter), approved_by: lower(who.email), approved_at: iso(start) },
          openerMeta(d),
        );
        if (!ok) {
          // A rep held it (before or while this press ran): the hold stands.
          held.push(String(d.id));
          continue;
        }
        approved.push(String(d.id));
        // An approved opener waits for the lead's hours and day off, and never
        // goes stale meanwhile: it may go until 72 hours past its turn.
        const keep = sendAfter + APPROVED_KEEP_MS;
        if (!d.expires_at || Date.parse(String(d.expires_at)) < keep)
          await io
            .db(`cockpit_sales_followups?id=eq.${enc(String(d.id))}&status=eq.draft`, {
              method: "PATCH",
              body: { expires_at: iso(keep) },
              prefer: "return=minimal",
            })
            .catch(e => io.log(`followups: an approved opener's expiry was not moved: ${redact(String((e as Error)?.message ?? e))}`));
        i++;
      }
    } catch (e) {
      // A write failed part way (a database stall): what went through is
      // scheduled and the desk sends it, so it is audited now and the answer
      // names it. Nothing went through: the error stands as it is.
      if (!approved.length) throw e;
      const err = redact(String((e as Error)?.message ?? e)).slice(0, 200);
      const partial: Row = {
        count: approved.length,
        of: sorted.length,
        first_at: iso(start),
        last_at: iso(start + (approved.length - 1) * gap * 1000),
        gap_s: gap,
        partial: true,
        error: err,
      };
      await deps
        .audit(who, "followup.batch", "cockpit_sales_followup_meta", null, null, partial, { ids: approved, held })
        .catch(a => io.log(`followups: the part-way batch was not audited: ${redact(String((a as Error)?.message ?? a))}`));
      throw refusal(
        AGENT_COPY.batch_partial
          .replace("{done}", String(approved.length))
          .replace("{total}", String(sorted.length))
          .replace("{time}", kuwaitClock(start))
          .replace("{gap}", String(gap)),
        503,
        { code: "partial", approved: approved.length, ids: approved },
      );
    }
    if (!approved.length) throw refusal(AGENT_COPY.batch_all_held, 409);
    const out: Row = {
      count: approved.length,
      first_at: iso(start),
      last_at: iso(start + (approved.length - 1) * gap * 1000),
      gap_s: gap,
      ...(held.length ? { held: held.length } : {}),
    };
    await deps.audit(who, "followup.batch", "cockpit_sales_followup_meta", null, null, out, { ids: approved, held });
    return out;
  }

  // ------------------------------------------------------------- followup.hold

  /** followup.send_due's mark on an opener it is sending right now (not one left by a send that stopped half way). */
  const sendingNow = (m: Row | null | undefined) =>
    lower(m?.held_by) === SENDING && (Date.parse(String(m?.held_at ?? "")) || 0) > io.now() - SENDING_STALE_MS;

  async function hold(who: Who, b: Row): Promise<Row> {
    const f = await draft(String(b.id ?? ""));
    mayAct(who, f);
    const on = b.on === true;
    const id = String(f.id);
    if (on && f.status !== "draft") throw refusal(f.status === "sending" ? AGENT_COPY.sending : AGENT_COPY.not_draft.replace("{status}", String(f.status)));
    const want = on ? { held_by: lower(who.email), held_at: iso(io.now()), hold_reason: cleanText(b.reason, 300) || null } : { held_by: null, hold_reason: null };
    // Written only from what was read: a send that claimed the opener in
    // between wins (it is already going out), and the press says so; it
    // never shows as held while the opener goes.
    for (let i = 0; i < 3; i++) {
      const before = await metaOf(id);
      if (sendingNow(before)) throw refusal(AGENT_COPY.sending);
      let rows: Row[];
      if (!before) {
        rows = await io.db("cockpit_sales_followup_meta?on_conflict=followup_id", {
          method: "POST",
          body: { followup_id: id, ...openerMeta(f), ...want },
          prefer: "resolution=ignore-duplicates,return=representation",
        });
      } else {
        const guard = before.held_by ? `held_by=eq.${enc(String(before.held_by))}` : "held_by=is.null";
        rows = await io.db(`cockpit_sales_followup_meta?followup_id=eq.${enc(id)}&${guard}`, {
          method: "PATCH",
          body: want,
          prefer: "return=representation",
        });
      }
      if (rows.length) {
        await deps.audit(who, on ? "followup.hold" : "followup.unhold", "cockpit_sales_followup_meta", id, before, rows[0]);
        return { meta: rows[0] };
      }
    }
    throw refusal("This opener changed a moment ago. Reload the page.", 409);
  }

  // ------------------------------------------------------------- followup.send_due (desk)

  async function setAside(who: Who, id: string, reason: string): Promise<void> {
    try {
      const before = await metaOf(id);
      const after = await putMeta(id, { send_after: null, held_by: "sales-desk", hold_reason: reason.slice(0, 300) });
      await deps.audit(who, "followup.set_aside", "cockpit_sales_followup_meta", id, before, after);
    } catch (e) {
      io.log(`followups: a refused draft was not set aside: ${redact(String((e as Error)?.message ?? e))}`);
    }
  }

  async function sendDue(who: Who, b: Row): Promise<Row> {
    const f = await draft(String(b.id ?? ""));
    const meta = await metaOf(String(f.id));
    const s = await settings(["followups", "whatsapp_guard", "messaging"]);
    const followups = obj(s.followups);
    if (followups.enabled === false) throw holdAll(AGENT_COPY.agent_off);
    if (f.status !== "draft") throw refusal(AGENT_COPY.not_draft.replace("{status}", String(f.status)));
    // A sending mark left by a send that stopped half way (the draft is still
    // a draft) is no hold: this send takes it again.
    const staleMark = lower(meta?.held_by) === SENDING && !sendingNow(meta);
    // Another send_due is sending it right now: this one only lost the race.
    if (sendingNow(meta)) throw refusal(AGENT_COPY.raced);
    if (!meta || (meta.held_by && !staleMark)) throw refusal(AGENT_COPY.held);
    const due = Date.parse(String(meta.send_after ?? ""));
    if (!Number.isFinite(due) || due > io.now()) throw refusal(AGENT_COPY.not_due);
    // The opener's wave: its meta's, else the draft's own (a meta row made
    // without it), so a paused or stopped wave always holds it.
    const own = openerMeta(f);
    const waveId = (meta.wave_id as string | null) || (own.wave_id as string | undefined) || null;
    if (waveId) {
      const w = (await io.db(`cockpit_sales_followup_waves?id=eq.${enc(String(waveId))}&select=state`))[0];
      if (w?.state !== "running") throw refusal(AGENT_COPY.wave_not_running);
    }
    // The kind's own switch (followup.level): an opener of a kind a manager
    // switched off waits in the queue, never set aside.
    const kind = (meta.kind_key as string | null) || (own.kind_key as string | undefined) || null;
    if (kind) {
      const lv = (await io.db(`cockpit_sales_followup_levels?kind_key=eq.${enc(kind)}&select=level`))[0];
      if (lv?.level === "off") throw refusal(AGENT_COPY.kind_off.replace("{kind}", kind), 409, { code: "kind_off" });
    }
    const whatsapp = f.channel === "whatsapp" || f.channel === "whatsapp_template";
    if (whatsapp) {
      if (!gateOpen(s.whatsapp_guard)) throw holdAll(GATE_SHUT);
      if (obj(s.messaging).whatsapp === false) throw holdAll(AGENT_COPY.wa_off);
      const h = await deps.whatsappHealth("followup");
      if (h.paused) throw holdAll(h.why);
    }
    const lead = (await io.db(`cockpit_sales_leads?contact_id=eq.${enc(String(f.contact_id))}&select=country`))[0];
    const hours = hoursRefusal({ segment: f.segment, touch: f.touch, country: lead?.country, now: io.now(), followups, dayOff: true });
    if (hours) throw refusal(hours);
    if (f.segment === "reactivate") {
      // A backlog opener never goes to a lead who has booked since the batch
      // was approved ("How are you?" to a lead booked for tomorrow): the
      // opener is taken back, whatever the desk read before it asked.
      const ahead = await io.db(
        `cockpit_sales_calendar?contact_id=eq.${enc(String(f.contact_id))}&call_type=in.(intro,demo)&start_at=gt.${enc(iso(io.now()))}&status=not.in.(cancelled,noshow,invalid)&select=appointment_id&limit=1`,
      );
      if (ahead.length) {
        await io.db(`cockpit_sales_followups?id=eq.${enc(String(f.id))}&status=eq.draft`, {
          method: "PATCH",
          body: { status: "expired", decided_at: iso(io.now()), error: AGENT_COPY.opener_booked },
          prefer: "return=minimal",
        });
        await deps.audit(who, "followup.send_due", "cockpit_sales_followups", String(f.id), { status: "draft" }, {
          status: "expired",
          why: AGENT_COPY.opener_booked,
        });
        throw refusal(AGENT_COPY.opener_booked);
      }
    }
    // The opener is claimed for this send, in one write, only while no person
    // holds it: a Hold that landed during the checks above wins (nothing goes),
    // and one that lands from now on is told the opener is already going out.
    const id = String(f.id);
    const mark = { held_by: SENDING, held_at: iso(io.now()) };
    let claimed = await io.db(`cockpit_sales_followup_meta?followup_id=eq.${enc(id)}&held_by=is.null`, {
      method: "PATCH",
      body: mark,
      prefer: "return=representation",
    });
    if (!claimed.length && staleMark)
      claimed = await io.db(
        `cockpit_sales_followup_meta?followup_id=eq.${enc(id)}&held_by=eq.${enc(SENDING)}&held_at=eq.${enc(String(meta.held_at))}`,
        { method: "PATCH", body: mark, prefer: "return=representation" },
      );
    if (!claimed.length) throw refusal(sendingNow(await metaOf(id)) ? AGENT_COPY.raced : AGENT_COPY.held);
    const release = () =>
      io
        .db(`cockpit_sales_followup_meta?followup_id=eq.${enc(id)}&held_by=eq.${enc(SENDING)}`, {
          method: "PATCH",
          body: { held_by: null, held_at: null },
          prefer: "return=minimal",
        })
        .catch(e => io.log(`followups: an opener's sending mark was not cleared: ${redact(String((e as Error)?.message ?? e))}`));
    try {
      const out = await deps.sendFollowup(who, f, {}, false, { decidedBy: (meta.approved_by as string | null) ?? null });
      await release();
      const m = obj(out.message);
      const err = String(m.error ?? "");
      // A 200 whose message failed for the wallet or funds holds every send.
      if (m.state === "failed" && /wallet|funds|insufficient|balance/i.test(err)) return { ...out, hold_all: true, error: err };
      return out;
    } catch (e) {
      if (e instanceof ApiRefusal) {
        // The template is not set up, or HighLevel's contact fields are not
        // set: every opener of the template waits, the batch stays in the queue.
        const setup = e.extra.code === "setup" || SETUP_FAULT.test(e.message);
        const all = setup || e.extra.hold_all === true || holdsEverything(e.message, e.status);
        const hoursWords = /their time|day off|friday|time zone/i.test(e.message);
        if (!all && !hoursWords && e.status !== 502 && !STATE_RACE.test(e.message)) await setAside(who, id, e.message);
        else await release();
        if (all && (e.extra.hold_all !== true || (setup && e.extra.code !== "setup")))
          throw new ApiRefusal(e.message, e.status, { ...e.extra, hold_all: true, ...(setup ? { code: "setup" } : {}) });
      } else await release();
      throw e;
    }
  }

  // ------------------------------------------------------------- followup.stop_task

  async function stopTask(who: Who, b: Row): Promise<Row> {
    const contactId = cleanText(b.contact_id, 80);
    const answer = String(b.answer ?? "");
    if (!contactId) throw refusal(AGENT_COPY.lead_missing, 400);
    if (!["dnd", "pause", "resume"].includes(answer)) throw refusal(AGENT_COPY.stop_answer, 400);
    const lead = (await io.db(`cockpit_sales_leads?contact_id=eq.${enc(contactId)}&select=contact_id,assigned_to`))[0];
    if (!lead) throw refusal(AGENT_COPY.lead_missing, 404);
    if (!who.manager && lead.assigned_to) {
      const owner = (await io.db(`cockpit_sales_people?ghl_user_id=eq.${enc(String(lead.assigned_to))}&active=eq.true&select=email`))[0];
      if (owner && lower(owner.email) !== lower(who.email)) throw refusal(AGENT_COPY.not_yours, 403);
    }
    const s = await settings(["followups"]);
    const pauseDays = Math.max(1, Math.min(90, Number(obj(s.followups).stop_pause_days ?? 30) || 30));
    const now = io.now();
    const decided = { decided_by: lower(who.email), decided_at: iso(now) };
    const until = iso(now + pauseDays * 86_400_000);
    const saidAt = b.said_at === undefined || b.said_at === null ? null : String(b.said_at);
    if (saidAt !== null) {
      if (!Number.isFinite(Date.parse(saidAt))) throw refusal(AGENT_COPY.stop_missing, 400);
      const filter = `cockpit_sales_followup_stops?contact_id=eq.${enc(contactId)}&said_at=eq.${enc(new Date(Date.parse(saidAt)).toISOString())}`;
      const before = (await io.db(`${filter}&select=*`))[0];
      if (!before) throw refusal(AGENT_COPY.stop_missing, 404);
      if (answer === "dnd") {
        // Do-not-disturb on WhatsApp only, in HighLevel (D21: a rep confirms every stop).
        try {
          await io.ghl("PUT", `/contacts/${enc(contactId)}`, { dndSettings: { WhatsApp: { status: "active", message: "Asked to stop (cockpit)" } } }, "2021-07-28");
        } catch (e) {
          throw refusal(`HighLevel did not take the stop: ${redact(String((e as Error)?.message ?? e))}. Try again.`, 502);
        }
      }
      const patch = answer === "dnd" ? { state: "dnd" } : answer === "pause" ? { state: "paused", paused_until: until } : { state: "resumed" };
      const rows = await io.db(filter, { method: "PATCH", body: { ...patch, ...decided }, prefer: "return=representation" });
      await deps.audit(who, `followup.stop_task.${answer}`, "cockpit_sales_followup_stops", contactId, before, rows[0] ?? null);
      return { stop: rows[0] ?? null };
    }
    if (answer === "dnd") throw refusal("Answer the lead's stop message from its task. Here you can pause or resume the agent.", 400);
    if (answer === "pause") {
      const row = {
        contact_id: contactId,
        said_at: iso(now),
        kind: "manual",
        state: "paused",
        paused_until: until,
        created_by: lower(who.email),
        ...decided,
      };
      const rows = await io.db("cockpit_sales_followup_stops", { method: "POST", body: row, prefer: "return=representation" });
      await deps.audit(who, "followup.stop_task.pause", "cockpit_sales_followup_stops", contactId, null, rows[0] ?? row);
      return { stop: rows[0] ?? row };
    }
    const rows = await io.db(`cockpit_sales_followup_stops?contact_id=eq.${enc(contactId)}&state=in.(asked,paused)`, {
      method: "PATCH",
      body: { state: "resumed", ...decided },
      prefer: "return=representation",
    });
    await deps.audit(who, "followup.stop_task.resume", "cockpit_sales_followup_stops", contactId, null, { resumed: rows.length });
    return { resumed: rows.length };
  }

  // ------------------------------------------------------------- followup.level

  async function level(who: Who, b: Row): Promise<Row> {
    needManager(who);
    const key = String(b.kind_key ?? "");
    const lv = String(b.level ?? "");
    if (!KIND_KEY.test(key)) throw refusal(AGENT_COPY.kind_bad, 400);
    if (!(LEVELS as readonly string[]).includes(lv)) throw refusal(AGENT_COPY.level_bad, 400);
    if (key.startsWith("reactivate.") && lv !== "approve" && lv !== "off")
      throw refusal("Backlog openers go only in an approved batch, so their level stays at Approve or Off.", 409);
    const before = (await io.db(`cockpit_sales_followup_levels?kind_key=eq.${enc(key)}&select=*`))[0] ?? null;
    let rows: Row[];
    try {
      rows = await io.db("cockpit_sales_followup_levels?on_conflict=kind_key", {
        method: "POST",
        body: { kind_key: key, level: lv, set_by: lower(who.email), reason: cleanText(b.reason, 500) || null },
        prefer: "resolution=merge-duplicates,return=representation",
      });
    } catch (e) {
      // The database's own gate (WhatsApp levels above Approve need the connector off and the single-copy test).
      if (e instanceof DbError && (e.code === "P0001" || /single-copy|WA Connector/i.test(e.message))) throw refusal(GATE_SHUT, 409);
      throw e;
    }
    await deps.audit(who, "followup.level", "cockpit_sales_followup_levels", key, before, rows[0] ?? null);
    return { level: rows[0] ?? null };
  }

  return {
    actions: {
      "followup.wave": wave,
      "followup.batch": batch,
      "followup.hold": hold,
      "followup.stop_task": stopTask,
      "followup.level": level,
    },
    desk: { "followup.send_due": sendDue },
  };
}
