import { REVIEW_BASE } from "./review";
import {
  batchIdOf,
  cleanAspect,
  cleanMedia,
  cleanPillars,
  cleanPlatforms,
  cleanWords,
  clip,
  DEFAULT_PILLARS,
  fillSlots,
  generateJob,
  isMonth,
  kuwaitMonth,
  pagesView,
  postJobId,
  queuedJob,
  type Row,
  rid,
  uploadPlan,
} from "./socialRules";
import { supabase } from "./supabase";

/**
 * Social media management, straight on Supabase.
 *
 * The port of `convex/social.ts`. The cockpit still does not write plans,
 * captions or pictures itself: every button that needs a model queues a
 * `social_jobs` row with the exact id and payload the Convex version wrote,
 * and Salma (`hermes/salma`) drains it on the VPS.
 *
 * The server is the gate. Row security lets a creative seat or the CEO
 * write these tables and only queue job kinds Salma knows, and a trigger
 * writes an audit row for every change (20261009e). Every write here checks
 * its error and that it touched a row, so nothing says "done" that was not.
 */

export type { Row };

export function useAction<T>(fn: T): T {
  return fn;
}

/** This month in Kuwait, which is the month a batch belongs to. */
export function thisMonth(): string {
  return kuwaitMonth();
}

function now(): string {
  return new Date().toISOString();
}

const NO_ROLE =
  "Only the creative team can change social media work. Ask Aziz to give your seat the creative role.";

/** A database refusal, said plainly. */
function said(error: { message?: string; code?: string } | null): string {
  const m = String(error?.message ?? "").trim();
  if (/row-level security|permission denied/i.test(m)) return NO_ROLE;
  return m || "That did not save. Try again.";
}

function check(error: { message?: string; code?: string } | null): void {
  if (error) throw new Error(said(error));
}

/** An update that matched nothing did nothing, so it must not say it did. */
function touched(data: unknown, why: string): void {
  if (!Array.isArray(data) || data.length === 0) throw new Error(why);
}

async function who(): Promise<{ email: string; name: string }> {
  const { data, error } = await supabase.auth.getSession();
  const user = data?.session?.user;
  if (error || !user?.email)
    throw new Error("You are signed out. Sign in again, then try once more.");
  const email = user.email.trim().toLowerCase();
  const name =
    String(user.user_metadata?.full_name ?? "").trim() || email.split("@")[0];
  return { email, name };
}

/** The ClickUp client cards this seat may work on: `task_id` and name. */
async function clientCards(): Promise<{ taskId: string; name: string }[]> {
  const { data, error } = await supabase.rpc("cockpit_review_clients");
  check(error);
  return ((data as Row[] | null) ?? []).map(c => ({
    taskId: String(c.task_id),
    name: String(c.name ?? ""),
  }));
}

async function onePost(postId: string, columns = "*"): Promise<Row> {
  const { data, error } = await supabase
    .from("social_posts")
    .select(columns)
    .eq("id", postId)
    .maybeSingle();
  check(error);
  if (!data) throw new Error("That post is gone.");
  return data as Row;
}

async function oneBatch(batchId: string): Promise<Row | null> {
  const { data, error } = await supabase
    .from("social_batches")
    .select("*")
    .eq("id", batchId)
    .maybeSingle();
  check(error);
  return (data as Row | null) ?? null;
}

async function clientOrWhy(clientTaskId: string): Promise<Row> {
  const { data, error } = await supabase
    .from("social_clients")
    .select("*")
    .eq("client_task_id", clientTaskId)
    .maybeSingle();
  check(error);
  if (!data) throw new Error("That client is not set up for social media yet.");
  return data as Row;
}

async function patchPost(postId: string, body: Row): Promise<void> {
  const { data, error } = await supabase
    .from("social_posts")
    .update(body)
    .eq("id", postId)
    .select("id");
  check(error);
  touched(data, NO_ROLE);
}

/** Queue jobs for Salma. Re-queuing an id resets it rather than adding a second. */
async function queue(rows: Row[]): Promise<void> {
  const { error } = await supabase
    .from("social_jobs")
    .upsert(rows, { onConflict: "id" });
  check(error);
}

function batchIdFrom(args: {
  batchId?: string;
  clientTaskId?: string;
  month?: string;
}): string {
  if (args.batchId) return args.batchId;
  if (args.clientTaskId)
    return batchIdOf(args.clientTaskId, args.month || thisMonth());
  throw new Error("Pick a client and a month first.");
}

// ---------------------------------------------------------------------------
// Reading

/**
 * Every client this seat works on, keyed by the ClickUp card id: the id
 * Salma reads the brand from and the review page names the client by.
 */
export async function roster(_args?: Row) {
  const month = thisMonth();
  const [cards, social, batches] = await Promise.all([
    clientCards(),
    supabase.from("social_clients").select("*"),
    supabase.from("social_batches").select("*").eq("month", month),
  ]);
  check(social.error);
  check(batches.error);
  const byId = new Map(
    ((social.data as Row[]) ?? []).map(s => [String(s.client_task_id), s]),
  );
  const batchBy = new Map(
    ((batches.data as Row[]) ?? []).map(b => [String(b.client_task_id), b]),
  );
  const clients = cards.map(c => {
    const s = byId.get(c.taskId);
    const b = batchBy.get(c.taskId);
    return {
      taskId: c.taskId,
      name: c.name,
      clientStatus: null as string | null,
      active: Boolean(s?.active),
      pillars: (s?.pillars as string[] | undefined) ?? [],
      postsPerMonth: s?.posts_per_month ?? null,
      batchDay: s?.batch_day ?? null,
      dialect: s?.dialect ?? null,
      ghlLocationId: s?.ghl_location_id ?? null,
      platforms: s?.platforms ?? ["instagram", "facebook"],
      look: s?.look ?? "bold",
      autoApprove: Boolean(s?.auto_approve),
      publishing: Boolean(s?.publishing),
      publishingSince: s?.publishing_since ?? null,
      page: s?.fb_page_id
        ? {
            id: s.fb_page_id,
            name: s.fb_page_name ?? null,
            igUserId: s.ig_user_id ?? null,
            igUsername: s.ig_username ?? null,
          }
        : null,
      onboarding: {
        socials: Boolean(s?.socials_connected_at),
        tested: Boolean(s?.test_post_at),
        slots: Boolean(s?.slots_blocked_at),
        bank: Boolean(s?.bank_ready_at),
      },
      batch: b ? { id: b.id, status: b.status, mix: b.mix ?? {} } : null,
    };
  });
  return { month, clients };
}

/** Everything waiting on a person, across every client. */
export async function pending(_args?: Row) {
  const [cards, batches] = await Promise.all([
    clientCards(),
    supabase
      .from("social_batches")
      .select("*")
      .in("status", ["planned", "review", "with_client"])
      .order("updated_at", { ascending: true })
      .limit(200),
  ]);
  check(batches.error);
  const nameOf = new Map(cards.map(c => [c.taskId, c.name]));
  const label = (b: Row) => ({
    id: b.id,
    client: nameOf.get(String(b.client_task_id)) ?? String(b.client_task_id),
    clientTaskId: b.client_task_id,
    month: b.month,
    status: b.status,
    since: b.updated_at,
  });
  const rows = (batches.data as Row[]) ?? [];
  return {
    awaitingPlanApproval: rows.filter(b => b.status === "planned").map(label),
    awaitingInternalReview: rows.filter(b => b.status === "review").map(label),
    withClient: rows.filter(b => b.status === "with_client").map(label),
  };
}

/** One client's month: the batch, every post, and the work in flight. */
export async function batch(args: { clientTaskId: string; month?: string }) {
  const month = args.month || thisMonth();
  const id = batchIdOf(args.clientTaskId, month);
  const [found, posts, jobs, health] = await Promise.all([
    supabase.from("social_batches").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("social_posts")
      .select("*")
      .eq("batch_id", id)
      .order("n", { ascending: true }),
    supabase
      .from("social_jobs")
      .select("id,kind,post_id,params,status,updated_at")
      .eq("batch_id", id)
      .in("status", ["queued", "running"])
      .order("created_at", { ascending: true })
      .limit(200),
    supabase
      .from("social_worker_status")
      .select("check_name,ok,detail,checked_at")
      .eq("ok", false),
  ]);
  check(found.error);
  check(posts.error);
  check(jobs.error);
  // A job left running by a worker that died is not in flight: past twenty
  // minutes it is dropped, or the screen would say "drawing" forever.
  const stale = Date.now() - 20 * 60_000;
  const live = ((jobs.data as Row[]) ?? []).filter(
    j =>
      j.status === "queued" || new Date(String(j.updated_at)).getTime() > stale,
  );
  // The worker's health is a sentence on the calendar. Not being able to
  // read it is said the same way, never shown as "all fine".
  const sick = health.error
    ? [
        {
          check: "worker status",
          detail: `Salma's health could not be read: ${said(health.error)}`,
          at: null,
        },
      ]
    : ((health.data as Row[]) ?? []).map(h => ({
        check: h.check_name,
        detail: h.detail,
        at: h.checked_at,
      }));
  return {
    month,
    batch: (found.data as Row | null) ?? null,
    posts: (posts.data as Row[]) ?? [],
    jobs: live,
    health: sick,
  };
}

// ---------------------------------------------------------------------------
// The client's set-up

/** Turn the package on or off for a client. */
export async function setActive(args: {
  clientTaskId: string;
  active: boolean;
}) {
  const stamp = now();
  const { error } = await supabase.from("social_clients").upsert(
    {
      client_task_id: args.clientTaskId,
      active: args.active,
      started_at: args.active ? stamp : null,
      updated_at: stamp,
    },
    { onConflict: "client_task_id" },
  );
  check(error);
  return { active: args.active };
}

/** How a client's month is shaped. */
export async function configure(args: {
  clientTaskId: string;
  pillars?: string[];
  dialect?: string;
  postsPerMonth?: number;
  batchDay?: number;
  ghlLocationId?: string;
  note?: string;
  platforms?: string[];
  autoApprove?: boolean;
  publishing?: boolean;
  look?: string;
}) {
  const { email } = await who();
  const body: Row = { client_task_id: args.clientTaskId, updated_at: now() };
  if (args.look !== undefined) {
    if (!["bold", "showcase", "plain"].includes(args.look))
      throw new Error("Pick a look: bold, project showcase or pictures only.");
    body.look = args.look;
  }
  if (args.publishing !== undefined) {
    if (args.publishing) {
      const c = await clientOrWhy(args.clientTaskId);
      if (!c.fb_page_id)
        throw new Error(
          "Link the client's Instagram and Facebook first: there is nowhere to post yet.",
        );
    }
    body.publishing = args.publishing;
    body.publishing_since = args.publishing ? now() : null;
    body.publishing_by = email;
  }
  if (args.platforms) {
    const kept = cleanPlatforms(args.platforms);
    if (!kept.length)
      throw new Error("A client posts to at least one platform.");
    body.platforms = kept;
  }
  if (args.autoApprove !== undefined) body.auto_approve = args.autoApprove;
  if (args.pillars) {
    const kept = cleanPillars(args.pillars);
    if (!kept.length)
      throw new Error("A client needs at least one pillar to post anything.");
    body.pillars = kept;
  }
  if (args.dialect !== undefined) body.dialect = clip(args.dialect, 60);
  if (args.postsPerMonth !== undefined)
    body.posts_per_month = Math.max(
      1,
      Math.min(60, Math.floor(args.postsPerMonth)),
    );
  if (args.batchDay !== undefined)
    body.batch_day = Math.max(1, Math.min(28, Math.floor(args.batchDay)));
  if (args.ghlLocationId !== undefined)
    body.ghl_location_id = clip(args.ghlLocationId, 64);
  if (args.note !== undefined) body.note = clip(args.note);
  const { error } = await supabase
    .from("social_clients")
    .upsert(body, { onConflict: "client_task_id" });
  check(error);
  return { ok: true };
}

/** Mark a step of onboarding done, or undone. */
export async function onboardingStep(args: {
  clientTaskId: string;
  step: string;
  done: boolean;
}) {
  const column = (
    {
      socials: "socials_connected_at",
      tested: "test_post_at",
      slots: "slots_blocked_at",
      bank: "bank_ready_at",
    } as Record<string, string>
  )[args.step];
  if (!column)
    throw new Error("Onboarding steps are: socials, tested, slots, bank.");
  const stamp = now();
  const { error } = await supabase.from("social_clients").upsert(
    {
      client_task_id: args.clientTaskId,
      [column]: args.done ? stamp : null,
      updated_at: stamp,
    },
    { onConflict: "client_task_id" },
  );
  check(error);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The month, the older plan-first way (kept for parity with Convex)

/** How many of each pillar this month. */
export async function setMix(args: {
  clientTaskId: string;
  month?: string;
  mix: Record<string, number>;
}) {
  const month = args.month || thisMonth();
  const id = batchIdOf(args.clientTaskId, month);
  const c = await clientOrWhy(args.clientTaskId);
  const pillars = cleanPillars(
    (Array.isArray(c.pillars) ? c.pillars : []) as string[],
  );
  const mix: Row = {};
  let total = 0;
  for (const p of pillars.length ? pillars : [...DEFAULT_PILLARS]) {
    const n = Math.max(0, Math.floor(Number(args.mix?.[p] ?? 0)));
    mix[p] = n;
    total += n;
  }
  if (!total) throw new Error("A month with no posts in it is not a batch.");
  const existing = await oneBatch(id);
  if (
    existing &&
    existing.status !== "planning" &&
    existing.status !== "planned"
  )
    throw new Error(
      `This month is already ${existing.status}. Changing the mix now would not match what has been made.`,
    );
  const { error } = await supabase.from("social_batches").upsert(
    {
      id,
      client_task_id: args.clientTaskId,
      month,
      mix,
      status: "planning",
      updated_at: now(),
    },
    { onConflict: "id" },
  );
  check(error);
  return { id, mix, total };
}

/** The plan is right: generate from it. */
export async function approvePlan(args: {
  clientTaskId?: string;
  month?: string;
  batchId?: string;
}) {
  const { email, name } = await who();
  const id = batchIdFrom(args);
  const b = await oneBatch(id);
  if (!b) throw new Error("That month is not set up yet.");
  if (b.status !== "planned")
    throw new Error(
      b.status === "planning"
        ? "There is no plan to approve yet."
        : `This month is already ${b.status}.`,
    );
  const { data: planned, error: readError } = await supabase
    .from("social_posts")
    .select("id")
    .eq("batch_id", id)
    .limit(1);
  check(readError);
  if (!planned?.length)
    throw new Error(
      "That plan has no posts in it, so there is nothing to approve.",
    );
  const stamp = now();
  const { data, error } = await supabase
    .from("social_batches")
    .update({
      status: "approved",
      approved_at: stamp,
      approved_by: name || email,
      updated_at: stamp,
    })
    .eq("id", id)
    .select("id");
  check(error);
  touched(data, NO_ROLE);
  const posts = await supabase
    .from("social_posts")
    .update({ status: "approved", updated_at: stamp })
    .eq("batch_id", id)
    .eq("status", "planned");
  check(posts.error);
  return { status: "approved" };
}

/** Ask Salma to plan the month. One outstanding plan job per month. */
export async function writePlan(args: {
  clientTaskId: string;
  month?: string;
}) {
  const { email } = await who();
  const month = args.month || thisMonth();
  const batchId = batchIdOf(args.clientTaskId, month);
  const found = await oneBatch(batchId);
  if (!found) throw new Error("Set the pillar mix for the month first.");
  if (!["planning", "planned"].includes(String(found.status)))
    throw new Error(
      `This month is already ${found.status}. Re-planning would not match what has been made.`,
    );
  const { data: already, error } = await supabase
    .from("social_jobs")
    .select("id")
    .eq("batch_id", batchId)
    .eq("kind", "plan")
    .in("status", ["queued", "running"])
    .limit(1);
  check(error);
  if (already?.length) return { queued: false, why: "already on the queue" };
  const id = rid("job");
  await queue([
    queuedJob({
      id,
      kind: "plan",
      clientTaskId: args.clientTaskId,
      batchId,
      requestedBy: email,
      at: now(),
    }),
  ]);
  return { queued: true, job: id };
}

/** Generate the approved plan: a caption and pictures for every post. */
export async function generateBatch(args: {
  clientTaskId?: string;
  month?: string;
  batchId?: string;
}) {
  const { email } = await who();
  const batchId = batchIdFrom(args);
  const b = await oneBatch(batchId);
  if (!b) throw new Error("That month is not set up yet.");
  if (b.status !== "approved")
    throw new Error(
      b.status === "planned"
        ? "Read the plan and approve it first. That is the checkpoint the cost of this rests on."
        : `This month is ${b.status}, not waiting to be generated.`,
    );
  const { data: posts, error } = await supabase
    .from("social_posts")
    .select("id")
    .eq("batch_id", batchId)
    .eq("status", "approved")
    .order("n", { ascending: true });
  check(error);
  if (!posts?.length) throw new Error("Nothing in that plan is approved.");
  const at = now();
  // One job per post, so a single bad post fails on its own.
  const jobs = (posts as Row[]).flatMap(p =>
    (["caption", "generate"] as const).map(kind =>
      queuedJob({
        id: rid("job"),
        kind,
        clientTaskId: String(b.client_task_id),
        batchId,
        postId: String(p.id),
        requestedBy: email,
        at,
      }),
    ),
  );
  await queue(jobs);
  const moved = await supabase
    .from("social_batches")
    .update({ status: "generating", updated_at: at })
    .eq("id", batchId)
    .select("id");
  check(moved.error);
  touched(moved.data, NO_ROLE);
  const flagged = await supabase
    .from("social_posts")
    .update({ status: "generating", updated_at: at })
    .eq("batch_id", batchId)
    .eq("status", "approved");
  check(flagged.error);
  return { queued: jobs.length, posts: posts.length };
}

/** Somebody who did not generate it has read the batch. */
export async function passReview(args: {
  clientTaskId?: string;
  month?: string;
  batchId?: string;
}) {
  const { email, name } = await who();
  const batchId = batchIdFrom(args);
  const b = await oneBatch(batchId);
  if (!b) throw new Error("That month is not set up yet.");
  if (!["generating", "review"].includes(String(b.status)))
    throw new Error(`This month is ${b.status}, not waiting on review.`);
  const { data, error } = await supabase
    .from("social_posts")
    .select("id,n,topic,caption,images")
    .eq("batch_id", batchId);
  check(error);
  const all = (data as Row[]) ?? [];
  const noCaption = all.filter(p => !p.caption);
  const noImage = all.filter(
    p => !Array.isArray(p.images) || p.images.length === 0,
  );
  if (noCaption.length)
    throw new Error(
      `${noCaption.length} post(s) have no caption yet, starting with #${noCaption[0].n}. ` +
        "Salma has not finished, or something failed.",
    );
  if (noImage.length)
    throw new Error(
      `${noImage.length} post(s) have no image yet, starting with #${noImage[0].n}. ` +
        "Make them from the prompts and attach them first.",
    );
  const at = now();
  const ok = await supabase
    .from("social_posts")
    .update({ status: "internal_ok", updated_at: at })
    .eq("batch_id", batchId)
    .eq("status", "generated");
  check(ok.error);
  const moved = await supabase
    .from("social_batches")
    .update({
      status: "review",
      reviewed_at: at,
      reviewed_by: name || email,
      updated_at: at,
    })
    .eq("id", batchId)
    .select("id");
  check(moved.error);
  touched(moved.data, NO_ROLE);
  return { status: "review" };
}

/**
 * The client's connected accounts, as GoHighLevel last reported them.
 * The live check calls GoHighLevel, which a browser cannot; this reads
 * what the last check stored.
 */
export async function checkConnection(args: { clientTaskId: string }) {
  const { data, error } = await supabase
    .from("social_accounts")
    .select("platform,ok,seen_at")
    .eq("client_task_id", args.clientTaskId);
  check(error);
  const rows = (data as Row[]) ?? [];
  return {
    connected: rows.filter(r => r.ok !== false).length,
    platforms: [...new Set(rows.map(r => r.platform).filter(Boolean))],
    checkedAt:
      rows
        .map(r => String(r.seen_at ?? ""))
        .filter(Boolean)
        .sort()
        .pop() ?? null,
  };
}

// ---------------------------------------------------------------------------
// Posts

/** Move a post to another day. */
export async function schedulePost(args: {
  postId: string;
  when?: string | null;
  scheduledAt?: string | null;
}) {
  const raw = args.when ?? args.scheduledAt;
  const at = new Date(String(raw ?? ""));
  if (!raw || Number.isNaN(at.getTime()))
    throw new Error("That is not a date.");
  if (at.getTime() < Date.now() - 60_000)
    throw new Error("That day has already been. Pick a day still to come.");
  const p = await onePost(args.postId, "id,ghl_post_id");
  if (p.ghl_post_id)
    throw new Error(
      "This post is already in GoHighLevel, and moving it there from the cockpit is not available yet. Move it in GoHighLevel's planner instead.",
    );
  await patchPost(args.postId, {
    scheduled_at: at.toISOString(),
    updated_at: now(),
  });
  return { at: at.toISOString(), pushedToGhl: false };
}

/** Pictures somebody made by hand, attached as public https links. */
export async function attachImages(args: { postId: string; urls: string[] }) {
  const { email } = await who();
  const clean = (args.urls ?? []).map(u => String(u).trim()).filter(Boolean);
  if (!clean.length) throw new Error("No image URLs given.");
  const bad = clean.find(u => !/^https:\/\//i.test(u));
  if (bad)
    throw new Error(
      `"${bad.slice(0, 60)}" is not an https URL. Instagram fetches these ` +
        "itself, so a local path or a data URL cannot work.",
    );
  const p = await onePost(args.postId, "id,caption,status");
  const status = p.caption ? "generated" : p.status;
  await patchPost(args.postId, {
    images: clean,
    images_by: email,
    status,
    error: null,
    updated_at: now(),
  });
  return { images: clean.length, status };
}

/** Put a post on the month by hand. */
export async function addPost(args: {
  clientTaskId: string;
  month?: string;
  pillar: string;
  topic: string;
  slides?: number;
  when?: string;
  generate?: boolean;
  media?: unknown;
  refs?: string[];
  aspect?: string;
}) {
  const { email } = await who();
  const topic = String(args.topic ?? "").trim();
  const media = args.media ? cleanMedia(args.media) : [];
  const aspect = cleanAspect(args.aspect ?? "4:5");
  const refs = (args.refs ?? [])
    .filter(r => /^https:\/\//i.test(r))
    .slice(0, 6);
  if (!topic) throw new Error("Give the post a topic, even a rough one.");
  const month = args.month || thisMonth();
  const batchId = batchIdOf(args.clientTaskId, month);

  let at: string | null = null;
  if (args.when) {
    const d = new Date(args.when);
    if (Number.isNaN(d.getTime())) throw new Error("That is not a date.");
    at = d.toISOString();
  }

  // A month nobody planned is the normal case for a post somebody just
  // thought of: make it rather than refuse, and never move one that exists.
  const opened = await supabase.from("social_batches").upsert(
    {
      id: batchId,
      client_task_id: args.clientTaskId,
      month,
      status: "planning",
      updated_at: now(),
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  check(opened.error);

  const last = await supabase
    .from("social_posts")
    .select("n")
    .eq("batch_id", batchId)
    .order("n", { ascending: false })
    .limit(1);
  check(last.error);
  const n = Number((last.data as Row[] | null)?.[0]?.n ?? 0) + 1;
  const id = `${batchId}:${n}`;

  const made = await supabase.from("social_posts").insert({
    id,
    batch_id: batchId,
    client_task_id: args.clientTaskId,
    n,
    pillar:
      String(args.pillar ?? "")
        .trim()
        .toLowerCase()
        .slice(0, 24) || "portfolio",
    topic: clip(topic, 300),
    slides: media.length
      ? media.length
      : Math.max(1, Math.min(10, Math.floor(args.slides ?? 1))),
    media,
    images: media.filter(i => i.kind === "image").map(i => i.url),
    refs,
    aspect,
    // A person typing the topic is the decision plan approval asks for.
    status: "approved",
    scheduled_at: at,
    updated_at: now(),
  });
  if (made.error?.code === "23505")
    throw new Error(
      "Somebody added a post to this month at the same moment. Try again.",
    );
  check(made.error);

  // The caption always; pictures only when asked and nothing of ours is on
  // it; a lone video is a Reel, seen on the grid by its cover.
  const drawing = Boolean(args.generate) && media.length === 0;
  const reel = media.length === 1 && media[0].kind === "video";
  const stamp = now();
  const base = {
    clientTaskId: args.clientTaskId,
    batchId,
    postId: id,
    requestedBy: email,
    at: stamp,
  };
  await queue([
    queuedJob({ ...base, id: postJobId("caption", id), kind: "caption" }),
    ...(drawing
      ? [queuedJob({ ...base, id: `generate:${id}`, kind: "generate" })]
      : []),
    ...(reel
      ? [
          queuedJob({
            ...base,
            id: postJobId("cover", id, { index: 0 }),
            kind: "cover",
            params: { index: 0 },
          }),
        ]
      : []),
  ]);
  return { id, n, generating: drawing, cover: reel };
}

/** Draw the AI pictures for one post: all of them, one again, or one more. */
export async function generatePost(args: {
  postId: string;
  index?: number;
  add?: boolean;
}) {
  const { email } = await who();
  const p = await onePost(args.postId);
  const media = Array.isArray(p.media) ? (p.media as Row[]) : [];
  if (args.add && media.length >= 10)
    throw new Error("Instagram takes at most ten items in a carousel.");
  if (args.index !== undefined && media[args.index]?.source !== "ai")
    throw new Error("Only a picture the AI drew can be drawn again.");
  const job = generateJob(args.postId, { index: args.index, add: args.add });
  await queue([
    queuedJob({
      id: job.id,
      kind: "generate",
      clientTaskId: String(p.client_task_id),
      batchId: String(p.batch_id),
      postId: args.postId,
      params: job.params,
      requestedBy: email,
      at: now(),
    }),
  ]);
  return { queued: true };
}

/** Take a post off the month. */
export async function removePost(args: { postId: string }) {
  const p = await onePost(args.postId, "id,ghl_post_id");
  if (p.ghl_post_id)
    throw new Error(
      "This one is already with the client in GoHighLevel. Remove it there first, " +
        "so the two do not disagree about what was sent.",
    );
  const { data, error } = await supabase
    .from("social_posts")
    .delete()
    .eq("id", args.postId)
    .select("id");
  check(error);
  touched(data, NO_ROLE);
  return { removed: true };
}

/** Fill the month: a finished draft on every empty day it needs. */
export async function fillMonth(args: { clientTaskId: string; month: string }) {
  const { email } = await who();
  const month = args.month || thisMonth();
  if (!isMonth(month)) throw new Error("That is not a month.");
  const c = await clientOrWhy(args.clientTaskId);
  const batchId = batchIdOf(args.clientTaskId, month);
  const { data, error } = await supabase
    .from("social_posts")
    .select("pillar,scheduled_at")
    .eq("batch_id", batchId)
    .order("n", { ascending: true });
  check(error);
  const { slots, days } = fillSlots({
    month,
    perMonth: Number(c.posts_per_month ?? 12),
    pillars: (Array.isArray(c.pillars) ? c.pillars : []) as string[],
    existing: (data as Row[]) ?? [],
    today: new Date().toISOString().slice(0, 10),
  });
  const opened = await supabase.from("social_batches").upsert(
    {
      id: batchId,
      client_task_id: args.clientTaskId,
      month,
      status: "generating",
      updated_at: now(),
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  check(opened.error);
  await queue([
    queuedJob({
      id: `fill:${batchId}:${Date.now()}`,
      kind: "fill",
      clientTaskId: args.clientTaskId,
      batchId,
      params: { slots },
      requestedBy: email,
      at: now(),
    }),
  ]);
  return { filling: slots.length, days };
}

/** Change a post's words or shape at any stage before it goes out. */
export async function updatePost(args: {
  postId: string;
  caption?: string;
  captionFacebook?: string;
  topic?: string;
  platforms?: string[];
  aspect?: string;
}) {
  const p = await onePost(args.postId, "id,status");
  if (String(p.status) === "published")
    throw new Error(
      "That post has already gone out, so there is nothing to change.",
    );
  const body: Row = { updated_at: now() };
  if (args.caption !== undefined) body.caption = clip(args.caption, 2200);
  if (args.captionFacebook !== undefined)
    body.caption_facebook = clip(args.captionFacebook, 5000);
  if (args.topic !== undefined) body.topic = clip(args.topic, 300);
  if (args.aspect !== undefined) body.aspect = cleanAspect(args.aspect);
  if (args.platforms !== undefined) {
    const kept = cleanPlatforms(args.platforms);
    if (!kept.length) throw new Error("A post goes to at least one platform.");
    body.platforms = kept;
  }
  await patchPost(args.postId, body);
  return null;
}

// ---------------------------------------------------------------------------
// Media: uploads, items, references, words, covers, motion

/**
 * A one-off link the browser uploads straight to storage with. If storage
 * will not give one, the upload stops here and says so: a public address
 * is not an upload link, and pretending it is loses the file.
 */
export async function uploadUrl(args: {
  clientTaskId: string;
  filename: string;
  contentType: string;
}) {
  const { path, kind } = uploadPlan({
    clientTaskId: args.clientTaskId,
    filename: args.filename,
    contentType: args.contentType,
    month: new Date().toISOString().slice(0, 7),
    uuid: crypto.randomUUID(),
  });
  const bucket = supabase.storage.from("social-media");
  const { data, error } = await bucket.createSignedUploadUrl(path);
  if (error || !data?.signedUrl)
    throw new Error(
      `Storage would not take the upload${error?.message ? ` (${error.message})` : ""}. Try again, and tell Muhammed if it keeps happening.`,
    );
  const pub = bucket.getPublicUrl(path);
  return { uploadUrl: data.signedUrl, publicUrl: pub.data.publicUrl, kind };
}

/** Replace a post's items: after an upload, a removal or a reorder. */
export async function setMedia(args: { postId: string; media: unknown }) {
  const items = cleanMedia(args.media);
  const p = await onePost(args.postId, "id,media,status");
  if (String(p.status) === "published")
    throw new Error(
      "That post has already gone out, so there is nothing to change.",
    );
  const firstVideo = (list: Row[]) =>
    list.find(i => i.kind === "video")?.url ?? null;
  const body: Row = {
    media: items,
    images: items.filter(i => i.kind === "image").map(i => i.url),
    slides: Math.max(1, items.length),
    error: null,
    updated_at: now(),
  };
  // The captions are written from the first video's words; a different
  // video is different words, so the kept transcript goes with it.
  if (firstVideo(Array.isArray(p.media) ? p.media : []) !== firstVideo(items))
    body.transcript = null;
  await patchPost(args.postId, body);
  return null;
}

/** The example pictures the AI takes its look from for this post. */
export async function setRefs(args: { postId: string; refs: string[] }) {
  const kept = (args.refs ?? [])
    .map(r => String(r).trim())
    .filter(r => /^https:\/\//i.test(r));
  if (kept.length > 6)
    throw new Error(
      "Six references is plenty. More only blurs what the picture should be.",
    );
  await patchPost(args.postId, { refs: kept, updated_at: now() });
  return null;
}

/** Queue Salma's work on one post: captions, a cover, words or motion. */
async function queuePostJob(
  postId: string,
  kind: "caption" | "cover" | "words" | "motion",
  email: string,
  params: Row = {},
): Promise<void> {
  const p = await onePost(postId, "id,client_task_id,batch_id");
  await queue([
    queuedJob({
      id: postJobId(kind, postId, params),
      kind,
      clientTaskId: String(p.client_task_id),
      batchId: String(p.batch_id),
      postId,
      params,
      requestedBy: email,
      at: now(),
    }),
  ]);
}

/** Write (or rewrite) the Instagram and Facebook captions with the AI. */
export async function writeCaption(args: { postId: string }) {
  const { email } = await who();
  await queuePostJob(args.postId, "caption", email);
  return null;
}

/** Make a cover for a video on the post. */
export async function makeCover(args: { postId: string; index: number }) {
  const { email } = await who();
  const index = Math.floor(Number(args.index ?? 0));
  await queuePostJob(args.postId, "cover", email, { index });
  return null;
}

/** A post and the picture at `index`, or a sentence saying why not. */
async function pictureAt(
  postId: string,
  index: number,
): Promise<{ post: Row; media: Row[]; item: Row }> {
  const post = await onePost(postId);
  const media = Array.isArray(post.media) ? (post.media as Row[]) : [];
  const item = media[Math.floor(index)];
  if (item?.kind !== "image")
    throw new Error("There is no picture at that place on the post.");
  return { post, media, item };
}

/**
 * Change the words on a picture. The project look sets them again in type
 * in seconds; a bold picture has its words drawn in, so it is drawn again.
 */
export async function setWords(args: {
  postId: string;
  index: number;
  words: unknown;
}) {
  const { email } = await who();
  const i = Math.floor(Number(args.index ?? 0));
  const { media, item } = await pictureAt(args.postId, i);
  const kept = cleanWords(args.words);
  if (!kept)
    throw new Error("Write at least one line, or leave the words as they are.");
  const next = [...media];
  next[i] = { ...item, words: kept };
  await patchPost(args.postId, { media: next, updated_at: now() });
  await queuePostJob(args.postId, "words", email, { index: i });
  return null;
}

/** Have Salma write words for a picture and set them in the project look. */
export async function addWords(args: { postId: string; index: number }) {
  const { email } = await who();
  const i = Math.floor(Number(args.index ?? 0));
  await pictureAt(args.postId, i);
  await queuePostJob(args.postId, "words", email, { index: i, write: true });
  return null;
}

/** Make a picture move a little, with its words kept still. */
export async function makeItMove(args: { postId: string; index: number }) {
  const { email } = await who();
  const i = Math.floor(Number(args.index ?? 0));
  const { item } = await pictureAt(args.postId, i);
  if (item.look === "bold" && item.words)
    throw new Error(
      "The words on this picture are drawn into it, so it cannot move without bending them. Move a picture from the project look, or one without words.",
    );
  await queuePostJob(args.postId, "motion", email, { index: i });
  return null;
}

// ---------------------------------------------------------------------------
// The client's own photos

export async function library(args: { clientTaskId: string }) {
  const { data, error } = await supabase
    .from("social_assets")
    .select("id,url,caption,at")
    .eq("client_task_id", args.clientTaskId)
    .eq("active", true)
    .not("url", "is", null)
    .order("at", { ascending: false })
    .limit(200);
  check(error);
  return (data as Row[]) ?? [];
}

export async function addToLibrary(args: {
  clientTaskId: string;
  url: string;
  caption?: string;
}) {
  const { email } = await who();
  if (!/^https:\/\//i.test(String(args.url ?? "")))
    throw new Error("That is not a link to a picture.");
  const id = crypto.randomUUID();
  const { error } = await supabase.from("social_assets").insert({
    id,
    client_task_id: args.clientTaskId,
    kind: "photo",
    url: args.url,
    caption: args.caption ? clip(args.caption, 300) : null,
    active: true,
    added_by: email,
    at: now(),
  });
  check(error);
  return null;
}

/** Take a photo out of the library. Kept, switched off, never deleted. */
export async function removeFromLibrary(args: { id: string }) {
  const { data, error } = await supabase
    .from("social_assets")
    .update({ active: false })
    .eq("id", args.id)
    .select("id");
  check(error);
  touched(data, "That photo is gone, or your seat cannot change it.");
  return null;
}

// ---------------------------------------------------------------------------
// The accounts a client posts from

export async function pages(args: { clientTaskId: string }) {
  const [all, client, job, cards] = await Promise.all([
    supabase
      .from("social_meta_pages")
      .select(
        "page_id,name,picture_url,ig_user_id,ig_username,ig_name,ig_picture_url,ad_clients,seen_at",
      )
      .order("name", { ascending: true }),
    supabase
      .from("social_clients")
      .select(
        "fb_page_id,fb_page_name,ig_user_id,ig_username,accounts_linked_at,accounts_linked_by",
      )
      .eq("client_task_id", args.clientTaskId)
      .maybeSingle(),
    supabase
      .from("social_jobs")
      .select("status,error,updated_at")
      .eq("id", "accounts")
      .maybeSingle(),
    clientCards(),
  ]);
  check(all.error);
  check(client.error);
  check(job.error);
  return pagesView({
    pages: (all.data as Row[]) ?? [],
    client: (client.data as Row | null) ?? null,
    job: (job.data as Row | null) ?? null,
    clientTaskId: args.clientTaskId,
    clientName: cards.find(c => c.taskId === args.clientTaskId)?.name ?? "",
  });
}

/** Link a client to a Page (and its Instagram account), or unlink. */
export async function linkAccounts(args: {
  clientTaskId: string;
  pageId: string | null;
}) {
  const { email } = await who();
  let body: Row;
  if (args.pageId) {
    const { data: p, error } = await supabase
      .from("social_meta_pages")
      .select("page_id,name,ig_user_id,ig_username")
      .eq("page_id", args.pageId)
      .maybeSingle();
    check(error);
    if (!p)
      throw new Error(
        "That Page is not one our Meta account manages any more. Refresh the list and pick again.",
      );
    // One Page, one client: two on one Page is how a post lands on the
    // wrong account.
    const { data: taken, error: takenError } = await supabase
      .from("social_clients")
      .select("client_task_id")
      .eq("fb_page_id", args.pageId)
      .neq("client_task_id", args.clientTaskId)
      .limit(1);
    check(takenError);
    if (taken?.length)
      throw new Error(
        "Another client is already linked to that Page. Unlink it there first.",
      );
    body = {
      fb_page_id: p.page_id,
      fb_page_name: p.name,
      ig_user_id: p.ig_user_id ?? null,
      ig_username: p.ig_username ?? null,
      accounts_linked_at: now(),
      accounts_linked_by: email,
    };
  } else {
    body = {
      fb_page_id: null,
      fb_page_name: null,
      ig_user_id: null,
      ig_username: null,
      accounts_linked_at: null,
      accounts_linked_by: null,
    };
  }
  const { error } = await supabase
    .from("social_clients")
    .upsert(
      { client_task_id: args.clientTaskId, ...body, updated_at: now() },
      { onConflict: "client_task_id" },
    );
  check(error);
  return { linked: Boolean(args.pageId) };
}

/** Ask Salma for a fresh list of Pages from Meta. */
export async function refreshPages(_args?: Row) {
  const { email } = await who();
  await queue([
    queuedJob({
      id: "accounts",
      kind: "accounts",
      requestedBy: email,
      at: now(),
    }),
  ]);
  return null;
}

// ---------------------------------------------------------------------------
// The client's sign-off

/**
 * Make the client's sign-off link for some of the month's posts.
 *
 * The server checks the posts are finished, makes the review link on the
 * same Mahara review page the videos use (`/editor/review/<token>`, which
 * shows each post as it will go out), marks the posts as sent with that
 * token and writes the audit row, all in one transaction. This only makes
 * the link: a person copies it and sends it to the client.
 */
export async function sendForSignoff(args: {
  clientTaskId: string;
  month: string;
  postIds: string[];
  note?: string;
}) {
  if (!isMonth(String(args.month ?? "")))
    throw new Error("That is not a month.");
  if (!args.postIds?.length) throw new Error("Pick at least one post to send.");
  const { data, error } = await supabase.rpc("cockpit_social_send_signoff", {
    p_client_task_id: args.clientTaskId,
    p_month: args.month,
    p_post_ids: args.postIds,
    p_note: clip(args.note, 600),
  });
  check(error);
  const made = (data as Row | null) ?? null;
  const token = String(made?.token ?? "");
  if (!token) throw new Error("The link could not be made. Try again.");
  return {
    url: `${REVIEW_BASE}/${token}`,
    sent: Number(made?.sent ?? 0),
    skipped: Number(made?.skipped ?? 0),
  };
}

export const api = {
  social: {
    roster,
    pending,
    batch,
    setActive,
    configure,
    onboardingStep,
    setMix,
    approvePlan,
    checkConnection,
    writePlan,
    generateBatch,
    passReview,
    schedulePost,
    attachImages,
    addPost,
    generatePost,
    removePost,
    fillMonth,
    updatePost,
    uploadUrl,
    setMedia,
    setRefs,
    writeCaption,
    makeCover,
    setWords,
    addWords,
    makeItMove,
    library,
    addToLibrary,
    removeFromLibrary,
    pages,
    linkAccounts,
    refreshPages,
    sendForSignoff,
  },
};
