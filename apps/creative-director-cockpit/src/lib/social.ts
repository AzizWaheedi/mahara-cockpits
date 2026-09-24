import { supabase } from "./supabase";

// biome-ignore lint/suspicious/noExplicitAny: generic shapes
export type Row = Record<string, any>;

export function useAction<T>(fn: T): T {
  return fn;
}

export function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function now(): string {
  return new Date().toISOString();
}

async function who() {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    email: session?.user?.email ?? "creative@maharamedia.com",
    name: session?.user?.user_metadata?.full_name ?? session?.user?.email ?? "Creative",
  };
}

export async function roster(_args?: { month?: string }) {
  const month = _args?.month || thisMonth();
  const [{ data: profiles }, { data: social }, { data: batches }] = await Promise.all([
    supabase.from("cockpit_client_profiles").select("*").order("client_name"),
    supabase.from("social_clients").select("*"),
    supabase.from("social_batches").select("*").eq("month", month),
  ]);

  const byId = new Map((social ?? []).map(s => [s.client_task_id, s]));
  const batchBy = new Map((batches ?? []).map(b => [b.client_task_id, b]));

  const clients = (profiles ?? []).map(p => {
    const taskId = String(p.client_id || p.id);
    const s = byId.get(taskId);
    const b = batchBy.get(taskId);
    return {
      taskId,
      name: p.client_name,
      clientStatus: p.stage || p.status || null,
      active: Boolean(s?.active),
      pillars: s?.pillars ?? ["portfolio", "craft", "education"],
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
      batch: b
        ? {
            id: b.id,
            status: b.status,
            mix: b.mix ?? {},
          }
        : null,
    };
  });

  return { month, clients };
}

export async function pending(_args?: any) {
  const month = thisMonth();
  const [{ data: batches }, { data: posts }] = await Promise.all([
    supabase.from("social_batches").select("*").eq("month", month),
    supabase.from("social_posts").select("*"),
  ]);

  const reviewBatches = (batches ?? []).filter(b => b.status === "review");
  const clientReviewBatches = (batches ?? []).filter(b => b.status === "with_client");
  const scheduledPosts = (posts ?? []).filter(p => p.status === "scheduled");

  return {
    month,
    review: reviewBatches,
    clientReview: clientReviewBatches,
    scheduled: scheduledPosts,
  };
}

export async function batch(args: { clientTaskId: string; month?: string }) {
  const month = args.month || thisMonth();
  const id = `${args.clientTaskId}:${month}`;

  const [{ data: found }, { data: posts }, { data: jobs }, { data: health }] = await Promise.all([
    supabase.from("social_batches").select("*").eq("id", id).maybeSingle(),
    supabase.from("social_posts").select("*").eq("batch_id", id).order("n", { ascending: true }),
    supabase.from("social_jobs").select("id,kind,post_id,params,status,updated_at").eq("batch_id", id).in("status", ["queued", "running"]).order("created_at", { ascending: true }).limit(200),
    supabase.from("social_worker_status").select("check_name,ok,detail,checked_at").eq("ok", false),
  ]);

  const stale = Date.now() - 20 * 60_000;
  const filteredJobs = (jobs ?? []).filter(
    j => j.status === "queued" || new Date(String(j.updated_at)).getTime() > stale,
  );

  const formattedHealth = (health ?? []).map(h => ({
    check: h.check_name,
    detail: h.detail,
    at: h.checked_at,
  }));

  return {
    month,
    batch: found ?? null,
    posts: posts ?? [],
    jobs: filteredJobs,
    health: formattedHealth,
  };
}

export async function setActive(args: { clientTaskId: string; active: boolean }) {
  const stamp = now();
  const { error } = await supabase.from("social_clients").upsert({
    client_task_id: args.clientTaskId,
    active: args.active,
    started_at: args.active ? stamp : null,
    updated_at: stamp,
  });
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function configure(args: { clientTaskId: string; [key: string]: any }) {
  const { clientTaskId, ...rest } = args;
  const stamp = now();
  const { error } = await supabase
    .from("social_clients")
    .upsert({ client_task_id: clientTaskId, ...rest, updated_at: stamp });
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function onboardingStep(args: { clientTaskId: string; step: string; done: boolean }) {
  const stamp = now();
  const fieldMap: Record<string, string> = {
    socials: "socials_connected_at",
    tested: "test_post_at",
    slots: "slots_blocked_at",
    bank: "bank_ready_at",
  };
  const col = fieldMap[args.step] || `${args.step}_at`;
  const { error } = await supabase
    .from("social_clients")
    .upsert({ client_task_id: args.clientTaskId, [col]: args.done ? stamp : null, updated_at: stamp });
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function setMix(args: { clientTaskId: string; month?: string; mix: Record<string, number> }) {
  const month = args.month || thisMonth();
  const id = `${args.clientTaskId}:${month}`;
  const stamp = now();
  const { error } = await supabase.from("social_batches").upsert({
    id,
    client_task_id: args.clientTaskId,
    month,
    mix: args.mix,
    updated_at: stamp,
  });
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function approvePlan(args: { clientTaskId?: string; month?: string; batchId?: string }) {
  const id = args.batchId || (args.clientTaskId ? `${args.clientTaskId}:${args.month || thisMonth()}` : "");
  if (!id) throw new Error("Batch ID required");
  const user = await who();
  const stamp = now();
  const { error } = await supabase.from("social_batches").update({
    status: "approved",
    plan_approved_at: stamp,
    plan_approved_by: user.email,
    updated_at: stamp,
  }).eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function checkConnection(args: { clientTaskId: string }) {
  const { data } = await supabase
    .from("social_accounts")
    .select("*")
    .eq("client_task_id", args.clientTaskId);
  const rows = data ?? [];
  return {
    connected: rows.length,
    platforms: [...new Set(rows.map(r => r.platform).filter(Boolean))],
  };
}

export async function writePlan(args: { clientTaskId: string; month?: string; posts?: any[] }) {
  const month = args.month || thisMonth();
  const id = `${args.clientTaskId}:${month}`;
  const stamp = now();
  await supabase.from("social_batches").upsert({
    id,
    client_task_id: args.clientTaskId,
    month,
    status: "planned",
    updated_at: stamp,
  });
  return { ok: true };
}

export async function generateBatch(args: { clientTaskId?: string; month?: string; batchId?: string }) {
  const id = args.batchId || (args.clientTaskId ? `${args.clientTaskId}:${args.month || thisMonth()}` : "");
  if (!id) throw new Error("Batch ID required");
  const user = await who();
  const stamp = now();
  await supabase.from("social_jobs").insert({
    id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    kind: "generate",
    client_task_id: args.clientTaskId ?? id.split(":")[0],
    batch_id: id,
    status: "queued",
    requested_by: user.email,
    created_at: stamp,
    updated_at: stamp,
  });
  return { ok: true };
}

export async function passReview(args: { clientTaskId?: string; month?: string; batchId?: string }) {
  const id = args.batchId || (args.clientTaskId ? `${args.clientTaskId}:${args.month || thisMonth()}` : "");
  if (!id) throw new Error("Batch ID required");
  const user = await who();
  const stamp = now();
  await supabase.from("social_batches").update({
    status: "scheduled",
    reviewed_at: stamp,
    reviewed_by: user.email,
    updated_at: stamp,
  }).eq("id", id);
  return { ok: true };
}

export async function schedulePost(args: {
  postId: string;
  scheduledAt?: string | null;
  when?: string | null;
  [key: string]: any;
}) {
  const at = args.scheduledAt !== undefined ? args.scheduledAt : (args.when ?? null);
  const stamp = now();
  const { error } = await supabase.from("social_posts").update({
    scheduled_at: at,
    status: at ? "scheduled" : "draft",
    updated_at: stamp,
  }).eq("id", args.postId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function attachImages(args: {
  postId: string;
  media?: any[];
  urls?: any[];
  [key: string]: any;
}) {
  const stamp = now();
  const mediaItems = args.media ?? args.urls ?? [];
  const { error } = await supabase.from("social_posts").update({
    media: mediaItems,
    updated_at: stamp,
  }).eq("id", args.postId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function addPost(args: {
  clientTaskId: string;
  month?: string;
  pillar?: string;
  topic?: string;
  caption?: string;
  scheduledAt?: string | null;
  when?: string | null;
  slides?: number;
  generate?: boolean;
  refs?: string[];
  aspect?: any;
  media?: any[];
  [key: string]: any;
}) {
  const month = args.month || thisMonth();
  const batchId = `${args.clientTaskId}:${month}`;
  const at = args.scheduledAt !== undefined ? args.scheduledAt : (args.when ?? null);
  const stamp = now();
  const id = `post_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const { error } = await supabase.from("social_posts").insert({
    id,
    batch_id: batchId,
    client_task_id: args.clientTaskId,
    month,
    pillar: args.pillar || "portfolio",
    topic: args.topic || "Post",
    caption: args.caption || "",
    scheduled_at: at,
    aspect: args.aspect || "4:5",
    media: args.media || [],
    status: at ? "scheduled" : "draft",
    created_at: stamp,
    updated_at: stamp,
  });
  if (error) throw new Error(error.message);
  return { ok: true, id };
}

export async function generatePost(args: { postId: string; [key: string]: any }) {
  const user = await who();
  const stamp = now();
  await supabase.from("social_jobs").insert({
    id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    kind: "generate",
    post_id: args.postId,
    params: args,
    status: "queued",
    requested_by: user.email,
    created_at: stamp,
    updated_at: stamp,
  });
  return { ok: true };
}

export async function removePost(args: { postId: string }) {
  const { error } = await supabase.from("social_posts").delete().eq("id", args.postId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function fillMonth(args: { clientTaskId?: string; month?: string; batchId?: string; [key: string]: any }) {
  const month = args.month || thisMonth();
  const id = args.batchId || (args.clientTaskId ? `${args.clientTaskId}:${month}` : "");
  if (id) {
    const stamp = now();
    await supabase.from("social_batches").upsert({
      id,
      client_task_id: args.clientTaskId ?? id.split(":")[0],
      month,
      status: "planned",
      updated_at: stamp,
    });
  }
  return { ok: true, filling: 0 };
}

export async function updatePost(args: { id?: string; postId?: string; [key: string]: any }) {
  const targetId = args.id || args.postId;
  if (!targetId) throw new Error("Post ID required.");
  const { id: _id, postId: _pid, ...updates } = args;
  const stamp = now();
  const { error } = await supabase.from("social_posts").update({
    ...updates,
    updated_at: stamp,
  }).eq("id", targetId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function uploadUrl(args: {
  clientTaskId?: string;
  filename?: string;
  contentType?: string;
  path?: string;
  [key: string]: any;
}) {
  const filename = args.filename || `file_${Date.now()}`;
  const clientTaskId = args.clientTaskId || "general";
  const path = args.path || `${clientTaskId}/${Date.now()}_${filename}`;
  const cleanPath = path.replace(/^\/+/, "");
  const kind: "image" | "video" = args.contentType?.startsWith("video/") || /\.(mp4|mov|webm)$/i.test(cleanPath)
    ? "video"
    : "image";

  const { data, error } = await supabase.storage.from("social-media").createSignedUploadUrl(cleanPath);
  const pub = supabase.storage.from("social-media").getPublicUrl(cleanPath);
  if (error) {
    return { uploadUrl: pub.data.publicUrl, publicUrl: pub.data.publicUrl, kind };
  }
  return { uploadUrl: data.signedUrl, publicUrl: pub.data.publicUrl, kind };
}

export async function setMedia(args: { postId: string; media?: any[]; urls?: any[]; [key: string]: any }) {
  return attachImages(args);
}

export async function setRefs(args: { postId: string; refs: any[]; [key: string]: any }) {
  const stamp = now();
  const { error } = await supabase.from("social_posts").update({
    reference_urls: args.refs,
    updated_at: stamp,
  }).eq("id", args.postId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function writeCaption(args: { postId: string; caption?: string; [key: string]: any }) {
  const stamp = now();
  const updateData: Record<string, any> = { updated_at: stamp };
  if (args.caption !== undefined) {
    updateData.caption = args.caption;
  }
  const { error } = await supabase.from("social_posts").update(updateData).eq("id", args.postId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function makeCover(args: { postId: string; mediaIndex?: number; index?: number; [key: string]: any }) {
  const stamp = now();
  const idx = args.mediaIndex !== undefined ? args.mediaIndex : (args.index ?? 0);
  const { error } = await supabase.from("social_posts").update({
    cover_index: idx,
    updated_at: stamp,
  }).eq("id", args.postId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function setWords(args: { postId: string; words?: any; index?: number; [key: string]: any }) {
  const stamp = now();
  const { error } = await supabase.from("social_posts").update({
    on_screen_text: args.words,
    updated_at: stamp,
  }).eq("id", args.postId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function addWords(_args: { postId: string; index?: number; word?: string; [key: string]: any }) {
  return { ok: true };
}

export async function makeItMove(args: { postId: string; index?: number; [key: string]: any }) {
  const user = await who();
  const stamp = now();
  await supabase.from("social_jobs").insert({
    id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    kind: "animate",
    post_id: args.postId,
    status: "queued",
    requested_by: user.email,
    created_at: stamp,
    updated_at: stamp,
  });
  return { ok: true };
}

export async function library(args: { clientTaskId: string }) {
  const { data: assets } = await supabase
    .from("social_assets")
    .select("*")
    .eq("client_task_id", args.clientTaskId)
    .order("created_at", { ascending: false });

  return (assets ?? []).map(a => ({
    id: a.id,
    url: a.url,
    caption: a.caption ?? null,
    kind: a.kind ?? "image",
  }));
}

export async function addToLibrary(args: { clientTaskId: string; url: string; kind?: string }) {
  const stamp = now();
  const id = `asset_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const { error } = await supabase.from("social_assets").insert({
    id,
    client_task_id: args.clientTaskId,
    url: args.url,
    kind: args.kind || "image",
    created_at: stamp,
  });
  if (error) throw new Error(error.message);
  return { ok: true, id };
}

export async function removeFromLibrary(args: { id: string }) {
  await supabase.from("social_assets").delete().eq("id", args.id);
  await supabase.from("social_bank").update({ active: false }).eq("id", args.id);
  return { ok: true };
}

export async function pages(args?: { clientTaskId?: string }) {
  const { data: pageRows } = await supabase
    .from("social_meta_pages")
    .select("*");
  const { data: clientRow } = args?.clientTaskId
    ? await supabase.from("social_clients").select("*").eq("client_task_id", args.clientTaskId).maybeSingle()
    : { data: null };

  const pagesList = (pageRows ?? []).map(p => ({
    pageId: p.page_id,
    name: p.page_name,
    picture: p.picture_url ?? null,
    igUserId: p.ig_user_id ?? null,
    igUsername: p.ig_username ?? null,
    igPicture: p.ig_picture_url ?? null,
    suggested: null as "ads" | "name" | null,
  }));

  const current = clientRow?.fb_page_id ? {
    pageId: clientRow.fb_page_id,
    name: clientRow.fb_page_name ?? null,
    igUserId: clientRow.ig_user_id ?? null,
    igUsername: clientRow.ig_username ?? null,
    linkedAt: clientRow.updated_at ?? null,
    linkedBy: null,
  } : null;

  return {
    pages: pagesList,
    current,
    refreshedAt: new Date().toISOString(),
    refreshing: false,
    refreshError: null,
  };
}

export async function linkAccounts(args: { clientTaskId: string; pageId?: string | null }) {
  const stamp = now();
  await supabase.from("social_clients").update({
    fb_page_id: args.pageId ?? null,
    updated_at: stamp,
  }).eq("client_task_id", args.clientTaskId);
  return { ok: true };
}

export async function refreshPages(_args?: { clientTaskId?: string }) {
  return { ok: true };
}

export async function sendForSignoff(args: {
  clientTaskId: string;
  month: string;
  postIds?: string[];
  note?: string;
  [key: string]: any;
}) {
  const id = `${args.clientTaskId}:${args.month}`;
  const stamp = now();
  await supabase.from("social_batches").update({
    status: "with_client",
    sent_to_client_at: stamp,
    updated_at: stamp,
  }).eq("id", id);
  return {
    ok: true,
    url: `https://cockpit.maharamedia.com/social/review/${encodeURIComponent(args.clientTaskId)}/${args.month}`,
    sent: args.postIds?.length ?? 0,
    skipped: 0,
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
