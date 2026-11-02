/**
 * One run of cockpit-notices (contract 4.3), the dry run and the rehearsal.
 *
 *   run       sweep, check new channels, reconcile unknowns, claim, post, record
 *   dryRun    build one notice's text from the mirror (or given facts); posts nothing, writes no notice
 *   rehearse  queue one test to a person's direct messages, post it, find it again by its Ref
 *
 * Before the first Slack call of a run the token is checked once with
 * auth.test: it must be mahara-club-bot's (NOTICES_BOT_USER). Otherwise
 * nothing is posted or checked, and every claimed notice goes back to the
 * queue (or fails, with no token at all) with a sentence for the tech lead.
 */
import { checkChannel, recordChannel } from "./doctor.ts";
import { cachedLookup, type ClaimMentions, type Mention, type PersonLooked, resolveMentions } from "./mentions.ts";
import { findRef, readUnknown, reconcileUnknowns } from "./reconcile.ts";
import {
  botGate, type ClaimedRow, type Gate, kickoffComment, type NoticeDeps, pickVariant, readClaimed, rememberPeople, sendClaimed, sendContext, type SendResult, settleAll,
  slackFor,
  wantedMentions,
} from "./send.ts";
import { isNoticeKind, isVariantOf, type NoticeKind, noticeText, type SlackBlock, type Variant } from "./text.ts";

export type RunResult = {
  ok: boolean;
  swept: Record<string, number>;
  channels: number;
  /** People an editor tagged, checked in Slack by their address this run. */
  people: number;
  reconciled: number;
  claimed: number;
  posted: number;
  requeued: number;
  retried: number;
  failed: number;
  unknown: number;
  busy?: boolean;
  note?: string;
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const say = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message.slice(0, 240) : fallback);
const SPACING_MS = 1000;
/**
 * At most three notices a run (the minute kick brings the rest), and no new
 * post after a minute of work: one notice can take a ClickUp read (25 s at
 * worst) and a post and a permalink (15 s each), and the Edge wall clock
 * stops a background run at 150 s. A claimed row not reached in time goes
 * back to the queue (not an attempt), so it never sits in `sending` until the
 * sweep calls it unknown for a person to find (as meta-ad-days budgets 110 s).
 */
export const CLAIM_LIMIT = 3;
export const RUN_BUDGET_MS = 60_000;
export const OUT_OF_TIME = "The run ran out of time before posting it; the next run sends it.";

/** The bot check, made at most once per run and only when something needs Slack. */
function lazyGate(deps: NoticeDeps, token: string, runKey: string): () => Promise<Gate> {
  let gate: Promise<Gate> | null = null;
  return () => (gate ??= botGate(deps, token, runKey));
}

export async function runNotices(deps: NoticeDeps): Promise<RunResult> {
  const result: RunResult = { ok: true, swept: {}, channels: 0, people: 0, reconciled: 0, claimed: 0, posted: 0, requeued: 0, retried: 0, failed: 0, unknown: 0 };
  const token = deps.slackToken().trim();
  const gate = lazyGate(deps, token, "run");
  const stop = (note: string, ok = false) => ({ ...result, ok, note });
  const started = deps.now().getTime();
  const late = () => deps.now().getTime() - started > RUN_BUDGET_MS;

  // 1. The sweep: stuck sends become unknown, anything the triggers missed is queued.
  try {
    const swept = await deps.rpc("cockpit_slack_notice_sweep", {});
    if (isObj(swept)) for (const [k, v] of Object.entries(swept)) if (typeof v === "number") result.swept[k] = v;
  } catch (e) {
    return stop(`The sweep failed: ${say(e, "no answer")}`);
  }

  // 2. Channels an editor added: is the bot in them?
  try {
    const pending = await deps.rpc("cockpit_slack_channel_pending", {});
    const list = Array.isArray(pending) ? pending.filter(isObj).filter(c => typeof c.id === "string") : [];
    if (list.length && token && (await gate()).ok) {
      const slack = slackFor(deps, token, "run");
      for (const c of list) {
        const id = String(c.id);
        if (await recordChannel(deps, id, await checkChannel(slack, id, typeof c.name === "string" ? c.name : null))) result.channels += 1;
      }
    }
  } catch (e) {
    result.ok = false;
    result.note = `The channel check failed: ${say(e, "no answer")}`;
  }

  // 2b. People an editor tagged: does Slack know their address (contract X4)?
  try {
    const pending = await deps.rpc("cockpit_slack_person_pending", {});
    const list = (Array.isArray(pending) ? pending : []).filter(isObj)
      .filter(p => typeof p.personId === "number" && typeof p.email === "string" && p.email);
    if (list.length && token && (await gate()).ok) {
      const slack = slackFor(deps, token, "run");
      const looked: PersonLooked[] = [];
      for (const p of list) {
        const found = await slack.lookupByEmail(String(p.email));
        // No answer: it stays checking for the next run.
        if (found.state === "unknown") continue;
        looked.push({ personId: Number(p.personId), state: found.state, slackId: found.state === "ok" ? found.id : null, code: found.state === "refused" ? found.code : null });
      }
      result.people = await rememberPeople(deps, looked);
    }
  } catch (e) {
    result.ok = false;
    result.note = `The people check failed: ${say(e, "no answer")}`;
  }

  // 3. Reconcile: find unknowns in Slack by their Ref; never resend.
  try {
    const raw = await deps.rpc("cockpit_slack_notice_unknowns", { p_limit: 10 });
    const rows = (Array.isArray(raw) ? raw : []).map(readUnknown).filter((r): r is NonNullable<typeof r> => !!r);
    if (rows.length && token && (await gate()).ok) result.reconciled = (await reconcileUnknowns(deps, token, rows)).found;
  } catch (e) {
    result.ok = false;
    result.note = `The reconcile failed: ${say(e, "no answer")}`;
  }

  // 4. Claim, while there is time to post what is claimed.
  if (late()) return stop("The run ran out of time before the claim; the next run sends what is due.", result.ok);
  let rows: ClaimedRow[];
  try {
    const claim = await deps.rpc("cockpit_slack_notice_claim", { p_limit: CLAIM_LIMIT });
    if (isObj(claim) && claim.busy === true) return { ...result, busy: true, note: "Another run holds the notices; this one stopped." };
    rows = (isObj(claim) && Array.isArray(claim.rows) ? claim.rows : []).map(readClaimed).filter((r): r is ClaimedRow => !!r);
  } catch (e) {
    return stop(`The claim failed: ${say(e, "no answer")}`);
  }
  result.claimed = rows.length;
  if (!rows.length) return result;

  // 5. The bot check before the first post.
  const g = await gate();
  if (!g.ok) {
    tally(result, await settleAll(deps, rows, g));
    return stop(g.error);
  }

  // 6. One row at a time, about a second apart, none started after the budget.
  const ctx = sendContext(deps, token);
  for (const [i, row] of rows.entries()) {
    if (late()) {
      tally(result, await settleAll(deps, rows.slice(i), { ok: false, outcome: "requeue", error: OUT_OF_TIME, retryAfterSec: 30, userId: null }));
      result.note = result.note ?? OUT_OF_TIME;
      break;
    }
    if (i > 0) await deps.sleep(SPACING_MS);
    let out: SendResult;
    try {
      out = await sendClaimed(ctx, row);
    } catch (e) {
      // Only a receipt or the result RPC can throw here; the row stays sending and the sweep makes it unknown.
      result.ok = false;
      result.note = `A notice could not be finished: ${say(e, "no answer")}`;
      continue;
    }
    tally(result, [out]);
  }
  return result;
}

function tally(result: RunResult, outs: SendResult[]) {
  for (const o of outs) {
    if (o.outcome === "posted") result.posted += 1;
    else if (o.outcome === "requeue") result.requeued += 1;
    else if (o.outcome === "retry") result.retried += 1;
    else if (o.outcome === "failed") result.failed += 1;
    else result.unknown += 1;
    if (o.recordError) {
      result.ok = false;
      result.note = `A result could not be recorded: ${o.recordError}`;
    }
  }
}

// ------------------------------------------------------------------ dry run

export type DryRunJob = { responseId: string } | { kind: NoticeKind; taskId: string; facts: Record<string, unknown>; variant?: Variant };
export type DryRun = {
  ok: true;
  kind: NoticeKind;
  variant: Variant;
  target: string | null;
  threadTs: string | null;
  text: string;
  blocks: SlackBlock[];
  tags: { label: string; tagged: boolean }[];
  commentCheck: "found" | "missing" | "unread" | null;
};

export class JobError extends Error {}

/** Build one notice as it would post now. Writes no notice row; its receipts carry run_key dry-run. */
export async function runDryRun(deps: NoticeDeps, job: DryRunJob): Promise<DryRun> {
  const p = "responseId" in job ? { responseId: job.responseId } : { kind: job.kind, taskId: job.taskId, facts: job.facts };
  const raw = await deps.rpc("cockpit_slack_notice_inputs", { p });
  if (!isObj(raw) || !isNoticeKind(raw.kind)) throw new JobError("The database returned no notice inputs.");
  const kind = raw.kind;
  const facts = isObj(raw.facts) ? raw.facts : {};
  const live = isObj(raw.live) ? raw.live : {};
  const taskId = typeof raw.taskId === "string" ? raw.taskId : String(facts.taskId ?? "");
  const threadTs = typeof raw.threadTs === "string" ? raw.threadTs : null;
  const asked = "variant" in job ? job.variant : undefined;
  if (asked !== undefined && !isVariantOf(kind, asked)) throw new JobError(`There is no ${asked} wording for ${kind}.`);

  let variant: Variant;
  let commentCheck: DryRun["commentCheck"] = null;
  let sendFacts: Record<string, unknown> = {};
  if (kind === "kickoff") {
    const check = await kickoffComment(deps, taskId, String(facts.submittedAt ?? ""), "dry-run");
    commentCheck = check.state;
    // As the sender: complete needs the comment and the card at the Brand Blueprint stage.
    variant = asked ?? (check.state === "found" && live.looksDone === true ? "complete" : "late");
    sendFacts = { commentCheck: check.state, handoffAt: check.state === "found" ? check.at : null, filledByRole: typeof live.filledByRole === "string" ? live.filledByRole : null, looksDone: live.looksDone === true };
  } else {
    variant = asked ?? pickVariant(kind, facts, live, threadTs);
  }

  const token = deps.slackToken().trim();
  const lookup = token ? cachedLookup(email => slackFor(deps, token, "dry-run").lookupByEmail(email)) : null;
  const mentions = isObj(raw.mentions) || Array.isArray(raw.mentions) ? (raw.mentions as ClaimMentions | Mention[]) : [];
  const resolved = await resolveMentions(wantedMentions(kind, variant, mentions, facts.second === true), lookup);
  const built = noticeText(kind, variant, {
    ...facts, ...live, ...sendFacts,
    ref: typeof raw.ref === "string" ? raw.ref : "CN-dryrun00",
    taskId,
    client: String(facts.client ?? raw.clientName ?? ""),
    mentions: resolved.tags,
  });
  return {
    ok: true, kind, variant, target: typeof raw.target === "string" ? raw.target : null, threadTs, text: built.text, blocks: built.blocks,
    tags: resolved.report.map(r => ({ label: r.label, tagged: r.tagged })), commentCheck,
  };
}

// ------------------------------------------------------------------ rehearsal

export type RehearseJob = { kind: NoticeKind; to: string | null };
export type Rehearsal = { ok: boolean; id: string | null; state: string; channel: string | null; ts: string | null; reconcileFound: boolean; note: string };

/** One test post to a person's direct messages, then the same reconcile read on that DM. */
export async function runRehearse(deps: NoticeDeps, job: RehearseJob): Promise<Rehearsal> {
  const to = (job.to ?? deps.alertTo()).trim();
  if (!/^[UW][A-Z0-9]{8,12}$/.test(to)) throw new JobError("A test goes to a person's Slack id (it starts with U or W). Set ALERT_SLACK_TO or send \"to\".");
  const queued = await deps.rpc("cockpit_slack_notice_rehearse_service", { p_kind: job.kind, p_target: to });
  const id = isObj(queued) && typeof queued.id === "string" ? queued.id : null;
  if (!id) throw new JobError("The test could not be queued.");
  const answer = (state: string, note: string, extra: Partial<Rehearsal> = {}): Rehearsal => ({ ok: false, id, state, channel: null, ts: null, reconcileFound: false, note, ...extra });

  const claim = await deps.rpc("cockpit_slack_notice_claim", { p_limit: 1, p_only: id });
  if (isObj(claim) && claim.busy === true) return answer("queued", "Another run is posting now. The next run sends this test within a minute.");
  const row = (isObj(claim) && Array.isArray(claim.rows) ? claim.rows : []).map(readClaimed).find(r => r?.id === id) ?? null;
  if (!row) return answer("queued", "The test is queued but was not claimed. The next run sends it.");

  const token = deps.slackToken().trim();
  const g = await botGate(deps, token, id);
  if (!g.ok) {
    const [out] = await settleAll(deps, [row], g);
    return answer(String(out.view?.state ?? (g.outcome === "failed" ? "failed" : "queued")), g.error);
  }
  const out = await sendClaimed(sendContext(deps, token), row);
  const state = String(out.view?.state ?? out.outcome);
  if (out.outcome !== "posted" || !out.channel || !out.ts) return answer(state, out.error ?? "The test was not posted.", { channel: out.channel, ts: out.ts });
  const oldest = (Number(out.ts) - 60).toFixed(6);
  const found = await findRef(slackFor(deps, token, id), out.channel, null, oldest, row.ref);
  return {
    ok: found === out.ts,
    id, state, channel: out.channel, ts: out.ts, reconcileFound: found === out.ts,
    note: found === out.ts
      ? `Posted to the direct message and found again by its Ref ${row.ref}.`
      : `Posted, but reading the direct message back did not find Ref ${row.ref}. Reading direct messages needs the im:history permission on the Slack app.`,
  };
}

