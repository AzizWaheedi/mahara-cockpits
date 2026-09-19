"use node";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import {
  accessHint,
  driveId,
  type Media,
  type Progress,
  percent,
} from "./driveCreative";
import { callTool, googleAccessToken, unwrap } from "./tools";

/**
 * Do the work the media buyer hands over from inside the cockpit.
 *
 * This is `viktor-side-scripts/assist_worker.py`, moved into the app. The
 * cockpit writes a request row (see assist.ts); this action picks it up and
 * writes the answer back into the same row, so the panel shows real progress.
 *
 * Three kinds of request:
 *   copy      — ad copy for a campaign, grounded in the winners archive
 *   creative  — pull creatives off Google Drive into the Meta ad account
 *   launch    — set a new client's campaign up as far as it can go without her
 *
 * Runs in the Node runtime because uploading a video to Meta needs multipart
 * bodies. Drive files must be shared with the deployment's service account.
 */

declare const process: { env: Record<string, string | undefined> };

// Rules that are not negotiable in anything client-facing. They are repeated in
// the prompt because a model that has not been told will reach for "contractor"
// and for local currency every single time. [aziz, standing]
const HOUSE_RULES = `
Hard rules, no exceptions:
- Never call the audience "contractors" and never imply one-man teams. They are
  construction and design businesses, firms or companies.
- Never use the term "B2B" in anything a client or a lead will read.
- Every money figure is in USD. Never dinar, riyal or dirham.
- Write like one person talking to another. Short sentences. Concrete, not
  aspirational. No emoji walls, no "unlock", no "revolutionise".
- Headline under 40 characters. Primary text 2 to 4 short lines.
`;

// A rule that is only in the prompt is a rule that gets broken, so it is
// checked on the way out too. [aziz, standing]
const BANNED = /\b(riyal|dinar|dirham|contractors?)\b|ريال|دينار|درهم/gi;

type Variant = {
  headline: string;
  message: string;
  description?: string;
  angle?: string;
};
type Step = { label: string; state: string; detail?: string };
// biome-ignore lint/suspicious/noExplicitAny: request and context rows
type Req = any;
// biome-ignore lint/suspicious/noExplicitAny: request and context rows
type Ctx = any;

function houseRuleBreaks(variants: Variant[]): string[] {
  const hits = new Set<string>();
  for (const vnt of variants) {
    for (const text of [vnt.headline, vnt.message, vnt.description ?? ""]) {
      for (const m of text.matchAll(BANNED)) hits.add(m[0]);
    }
  }
  return [...hits].sort();
}

// biome-ignore lint/suspicious/noExplicitAny: model output
function toVariants(list: any[]): Variant[] {
  return list.slice(0, 5).map(x => ({
    headline: String(x.headline ?? "").slice(0, 120),
    message: String(x.message ?? x.primaryText ?? "").slice(0, 1200),
    description: x.description
      ? String(x.description).slice(0, 300)
      : undefined,
    angle: x.angle ? String(x.angle).slice(0, 60) : undefined,
  }));
}

const VARIANT_SCHEMA = {
  type: "object",
  properties: {
    variants: {
      type: "array",
      items: {
        type: "object",
        properties: {
          headline: { type: "string" },
          message: { type: "string" },
          description: { type: "string" },
          angle: { type: "string" },
        },
        required: ["headline", "message", "angle"],
      },
    },
    note: { type: "string" },
  },
  required: ["variants"],
};

/** Ad copy grounded in what has actually won for this kind of client. */
/** Set by run() so the copy step can queue a job for the outside worker. */
let enqueueAi: (refId: string, prompt: string) => Promise<unknown> =
  async () => {
    throw new Error("Ask AI queue not wired");
  };

async function writeCopy(
  req: Req,
  ctx: Ctx,
): Promise<{ variants: Variant[]; note: string; pending?: boolean }> {
  const c = ctx.campaign ?? {};
  const client = req.client || ctx.client || c.clientName || "";
  const language =
    req.language || ctx.prefs?.language || c.language || "Arabic";
  const service = c.serviceType || ctx.onboarding?.service || "";
  const city = c.city || "";

  // Winners from the same service line first: those are the ones whose hooks
  // transfer. Fall back to the cheapest leads overall.
  // biome-ignore lint/suspicious/noExplicitAny: winner rows
  const winners: any[] = ctx.winners ?? [];
  const same = winners.filter(w => service && w.serviceLine === service);
  const picked = (same.length ? same : winners).slice(0, 8);
  const proof = picked
    .map(
      w =>
        `- ${w.client} · ${w.city ?? "?"} · $${Math.round((w.cpl ?? 0) * 100) / 100} a lead\n` +
        `  hook: ${w.hook ?? w.headline ?? ""}\n  copy: ${String(w.body ?? "").slice(0, 400)}`,
    )
    .join("\n\n");

  const prompt = `You write Meta ads for Mahara Media, a marketing agency whose
clients are construction and design businesses in the Gulf.

Write 5 ad options for: ${client}
Service they sell: ${service || "not stated"}
City: ${city || "not stated"}
Language of the ad: ${language}

What she asked for:
${req.brief || "No brief given — write the strongest general options for this client."}
${ctx.dosDonts ? `\nThe client's do's and don'ts from their ClickUp card. Follow every one:\n${ctx.dosDonts}\n` : ""}
Ads that have actually produced cheap leads for similar clients — steal the
angles, not the words:
${proof || "No comparable winners on file yet."}
${HOUSE_RULES}
Give 5 distinct angles, not 5 rewrites of one sentence: outcome, objection,
proof, question, direct offer. Write in ${language}. Name the angle in English.
`;
  if (!process.env.ANTHROPIC_API_KEY) {
    // No model on this deployment: hand the question to the outside worker.
    // The request row is patched with the copy when the answer lands.
    if (!req.id) throw new Error("no request id to hand to Ask AI");
    await enqueueAi(String(req.id), prompt);
    return {
      variants: [],
      note: "The copy is being written. This row fills in on its own, usually within a few minutes.",
      pending: true,
    };
  }
  const out = unwrap(
    await callTool("ai_structured_output", {
      prompt,
      intelligence_level: "smart",
      output_schema: VARIANT_SCHEMA,
    }),
  );
  let variants = toVariants(out?.variants ?? []);
  let breaks = houseRuleBreaks(variants);
  if (breaks.length > 0) {
    // One repair pass, naming exactly what was wrong. Cheaper and far more
    // reliable than hoping the next generation happens to comply.
    try {
      const fix = unwrap(
        await callTool("ai_structured_output", {
          prompt:
            "Rewrite these ads so they break none of the rules below. Keep the angle and the language of each one.\n" +
            `Rule breaks found: ${breaks.join(", ")}\n${HOUSE_RULES}\nAds:\n${JSON.stringify(variants)}`,
          intelligence_level: "smart",
          output_schema: VARIANT_SCHEMA,
        }),
      );
      const repaired = toVariants(fix?.variants ?? []);
      if (repaired.length > 0 && houseRuleBreaks(repaired).length === 0) {
        variants = repaired;
        breaks = [];
      }
    } catch {
      // keep the first pass and flag it below
    }
  }
  let note =
    out?.note ||
    `${variants.length} options, written off ${picked.length} ads that already produced cheap leads for this kind of client. Edit anything before you create them — nothing goes live until you switch it on.`;
  if (breaks.length > 0) {
    note += ` Check these before you use them — I could not get the wording clean on: ${breaks.join(", ")}.`;
  }
  return { variants, note };
}

// --- Drive → Meta ------------------------------------------------------------

/** The identity Drive files must be shared with; an email, never a secret. */
function serviceAccountEmail(): string {
  try {
    return String(
      JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "{}")
        .client_email ?? "",
    );
  } catch {
    return "";
  }
}

/** How long one worker run may spend before it hands the rest to the next run. */
const RUN_BUDGET_MS = 7 * 60_000;
/** Persist upload progress at least this often, so a killed run loses little. */
const PERSIST_EVERY_BYTES = 6 * 1024 * 1024;

type DriveFile = { id: string; name: string; mimeType: string; size?: string };

async function driveMeta(id: string, token: string): Promise<DriveFile> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,mimeType,size&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const json = await res.json();
  if (!res.ok) {
    // Google answers 404 for a file that exists but is not shared with the
    // caller. "File not found" would send her checking the link; the fix is
    // the sharing, so say that.
    if (res.status === 404 || res.status === 403)
      throw new Error(accessHint(res.status, serviceAccountEmail()));
    throw new Error(
      json?.error?.message ?? accessHint(res.status, serviceAccountEmail()),
    );
  }
  return json as DriveFile;
}

/** A folder link means every image and video inside it. */
async function driveChildren(id: string, token: string): Promise<DriveFile[]> {
  const q = encodeURIComponent(
    `'${id}' in parents and trashed = false and (mimeType contains 'image/' or mimeType contains 'video/')`,
  );
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,size)&pageSize=50&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const json = await res.json();
  if (!res.ok)
    throw new Error(json?.error?.message ?? "Drive folder unreadable");
  return (json.files ?? []) as DriveFile[];
}

async function driveDownload(id: string, token: string): Promise<ArrayBuffer> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Drive download failed: HTTP ${res.status}`);
  return await res.arrayBuffer();
}

/** One byte range of a Drive file; Drive honours Range on alt=media. */
async function driveRange(
  id: string,
  token: string,
  start: number,
  endExclusive: number,
): Promise<ArrayBuffer> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Range: `bytes=${start}-${endExclusive - 1}`,
      },
    },
  );
  if (!res.ok && res.status !== 206)
    throw new Error(`Drive download failed: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength !== endExclusive - start)
    throw new Error(
      `Drive sent ${buf.byteLength} bytes for a ${endExclusive - start} byte chunk`,
    );
  return buf;
}

// biome-ignore lint/suspicious/noExplicitAny: Meta payload
async function metaForm(
  path: string,
  fields: Record<string, any>,
): Promise<any> {
  const token = process.env.META_SYSTEM_TOKEN;
  if (!token) throw new Error("META_SYSTEM_TOKEN not set");
  const form = new FormData();
  form.append("access_token", token);
  for (const [k, val] of Object.entries(fields)) {
    if (val === undefined || val === null) continue;
    if (val instanceof Blob) form.append(k, val, fields.__name ?? "chunk");
    else if (k !== "__name") form.append(k, String(val));
  }
  const res = await fetch(`https://graph.facebook.com/v21.0/${path}`, {
    method: "POST",
    body: form,
  });
  const body = await res.json();
  if (body.error)
    throw new Error(String(body.error.message ?? body.error).slice(0, 300));
  return body;
}

/**
 * A video into the ad account in Meta's own resumable chunks, each byte range
 * read from Drive as it is needed. Nothing bigger than a chunk is ever in
 * memory, and the progress lives on the request row: a run that hits its
 * time budget hands the upload to the next run at the same byte instead of
 * starting over. This is what a 67 MB file needed and did not have on
 * 2026-09-19, when one run pushed the whole file at once, was killed at ten
 * minutes, and the retry landed fifty minutes later.
 */
async function metaChunkedVideo(
  act: string,
  file: DriveFile,
  token: string,
  prior: Progress | undefined,
  deadline: number,
  onProgress: (p: Progress) => Promise<void>,
): Promise<{ done: boolean; progress: Progress }> {
  const size = Number(file.size ?? 0);
  if (!(size > 0)) throw new Error("Drive did not say how big the video is");
  let p: Progress =
    prior ??
    (await (async () => {
      const started = await metaForm(`${act}/advideos`, {
        upload_phase: "start",
        file_size: size,
      });
      return {
        sessionId: String(started.upload_session_id),
        videoId: String(started.video_id),
        start: Number(started.start_offset),
        end: Number(started.end_offset),
        size,
      };
    })());
  let sinceSave = 0;
  while (p.start < size) {
    if (Date.now() > deadline) {
      await onProgress(p);
      return { done: false, progress: p };
    }
    const end = Math.min(
      p.end > p.start ? p.end : p.start + 4 * 1024 * 1024,
      size,
    );
    const bytes = await driveRange(file.id, token, p.start, end);
    const moved = await metaForm(`${act}/advideos`, {
      upload_phase: "transfer",
      upload_session_id: p.sessionId,
      start_offset: p.start,
      video_file_chunk: new Blob([bytes], {
        type: file.mimeType || "video/mp4",
      }),
      __name: file.name,
    });
    p = {
      ...p,
      start: Number(moved.start_offset ?? end),
      end: Number(moved.end_offset ?? size),
    };
    sinceSave += bytes.byteLength;
    if (sinceSave >= PERSIST_EVERY_BYTES) {
      await onProgress(p);
      sinceSave = 0;
    }
  }
  const finished = await metaForm(`${act}/advideos`, {
    upload_phase: "finish",
    upload_session_id: p.sessionId,
    title: file.name.replace(/\.[a-z0-9]+$/i, ""),
  });
  if (finished?.success === false)
    throw new Error("Meta did not accept the finished upload");
  return { done: true, progress: p };
}

/**
 * Load a file into a Meta ad account's creative library. Uploading is the only
 * way a file on Drive can become an ad; Meta will not read a URL we do not own.
 */
async function metaUpload(
  accountId: string,
  file: DriveFile,
  bytes: ArrayBuffer,
  isVideo: boolean,
): Promise<{ id?: string; hash?: string; url?: string }> {
  const token = process.env.META_SYSTEM_TOKEN;
  if (!token) throw new Error("META_SYSTEM_TOKEN not set");
  const act = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
  const form = new FormData();
  form.append("access_token", token);
  form.append(
    "source",
    new Blob([bytes], { type: file.mimeType || "application/octet-stream" }),
    file.name,
  );
  const res = await fetch(
    `https://graph.facebook.com/v21.0/${act}/${isVideo ? "advideos" : "adimages"}`,
    { method: "POST", body: form },
  );
  const body = await res.json();
  if (body.error)
    throw new Error(String(body.error.message ?? body.error).slice(0, 300));
  if (isVideo) return { id: body.id };
  // biome-ignore lint/suspicious/noExplicitAny: Meta payload
  const first: any = Object.values(body.images ?? {})[0] ?? {};
  return { hash: first.hash, url: first.url };
}

type LoadOpts = {
  /** When this run must stop and hand the rest to the next one. */
  deadline: number;
  /** Write the media list to the row mid-flight, so the panel shows percent and a killed run resumes. */
  persist: (media: Media[]) => Promise<unknown>;
};

/** Pull each Drive link into the client's Meta ad account, ready to use. */
async function loadCreatives(
  req: Req,
  ctx: Ctx,
  opts: LoadOpts = {
    deadline: Date.now() + RUN_BUDGET_MS,
    persist: async () => undefined,
  },
): Promise<{ media: Media[]; note: string; pending?: boolean }> {
  const c = ctx.campaign ?? {};
  const account: string | undefined =
    c.metaAccountId || ctx.onboarding?.accountId || ctx.launchWatch?.accountId;
  const links: string[] = req.driveLinks ?? [];
  // What an earlier run already did for this row: finished files are kept,
  // a half-uploaded video carries on from its byte.
  const prior: Media[] = Array.isArray(req.media) ? req.media : [];
  const media: Media[] = [];
  let token: string | undefined;
  let yielded = false;

  for (const link of links) {
    const already = prior.filter(
      m => m.link === link && (m.videoId || m.imageHash) && !m.error,
    );
    if (already.length) {
      media.push(...already);
      continue;
    }
    if (yielded) {
      // Out of time this run; the row goes back to the queue with what is done.
      continue;
    }
    const fid = driveId(link);
    if (!fid) {
      media.push({
        name: link.slice(0, 60),
        link,
        error: "That is not a Google Drive link I can read.",
      });
      continue;
    }
    if (!account) {
      media.push({
        name: fid,
        link,
        error: "No Meta ad account on this client yet.",
      });
      continue;
    }
    try {
      token ??= await googleAccessToken();
      const meta = await driveMeta(fid, token);
      const files =
        meta.mimeType === "application/vnd.google-apps.folder"
          ? await driveChildren(fid, token)
          : [meta];
      if (files.length === 0) {
        media.push({
          name: meta.name,
          link,
          error: "The folder has no images or videos in it.",
        });
        continue;
      }
      for (const file of files) {
        const before = prior.find(
          m => m.link === link && m.name === file.name.slice(0, 120),
        );
        const entry: Media = { name: file.name.slice(0, 120), link };
        if (before?.videoId || before?.imageHash) {
          media.push(before);
          continue;
        }
        if (yielded) continue;
        try {
          const isVideo =
            file.mimeType.startsWith("video") ||
            /\.(mp4|mov|m4v)$/i.test(file.name);
          entry.kind = isVideo ? "video" : "image";
          if (isVideo) {
            const act = account.startsWith("act_") ? account : `act_${account}`;
            const idx = media.push(entry) - 1;
            const out = await metaChunkedVideo(
              act,
              file,
              token,
              before?.progress,
              opts.deadline,
              async p => {
                media[idx] = { ...entry, progress: p, percent: percent(p) };
                await opts.persist([...media]);
              },
            );
            if (!out.done) {
              media[idx] = {
                ...entry,
                progress: out.progress,
                percent: percent(out.progress),
              };
              yielded = true;
              continue;
            }
            media[idx] = {
              ...entry,
              videoId: out.progress.videoId,
              percent: 100,
            };
            continue;
          }
          const bytes = await driveDownload(file.id, token);
          const up = await metaUpload(account, file, bytes, false);
          entry.imageHash = up.hash;
          entry.thumbUrl = up.url;
        } catch (e) {
          // one bad file must not kill the batch
          entry.error = String(e instanceof Error ? e.message : e).slice(
            0,
            300,
          );
        }
        if (!media.includes(entry)) media.push(entry);
      }
    } catch (e) {
      media.push({
        name: fid,
        link,
        error: String(e instanceof Error ? e.message : e).slice(0, 300),
      });
    }
  }

  if (yielded) {
    const moving = media.find(m => m.progress);
    return {
      media,
      pending: true,
      note: moving
        ? `${moving.name}: ${moving.percent ?? 0}% loaded into the ad account; carrying on.`
        : "Carrying on in the next run.",
    };
  }
  const ok = media.filter(m => !m.error);
  const bad = media.filter(m => m.error);
  let note = `${ok.length} of ${media.length} creatives are in the ad account and ready to use.`;
  if (bad.length > 0) {
    note += ` Could not take: ${bad
      .slice(0, 4)
      .map(m => `${m.name} (${m.error})`)
      .join("; ")}`;
  }
  if (!account)
    note =
      "No Meta ad account on this client yet, so there is nowhere to put these.";
  return { media, note };
}

/** Walk a new client's launch as far as it can go without her. */
async function setUpLaunch(
  req: Req,
  ctx: Ctx,
): Promise<{
  steps: Step[];
  note: string;
  variants?: Variant[];
  media?: Media[];
  pending?: boolean;
}> {
  const watch = ctx.launchWatch ?? {};
  const onb = ctx.onboarding ?? {};
  const client: string = req.client || ctx.client || "";
  const account: string | undefined = onb.accountId || watch.accountId;
  const steps: Step[] = [];
  const step = (label: string, state: string, detail?: string) =>
    steps.push({ label, state, detail });

  step(
    "Meta ad account",
    account ? "done" : "blocked",
    account ? `Account ${account}` : "No Meta ad account in Client Data yet.",
  );
  step(
    "Onboarding task in ClickUp",
    watch.hasTask || onb.taskId ? "done" : "blocked",
    watch.taskUrl ?? onb.taskUrl ?? undefined,
  );
  for (const issue of watch.issues ?? []) step(String(issue), "blocked");

  let creative: { media: Media[]; note: string } | undefined;
  if ((req.driveLinks ?? []).length > 0) {
    creative = await loadCreatives(req, ctx);
    const got = creative.media.filter(m => !m.error).length;
    step(
      "Creatives loaded into the ad account",
      got ? "done" : "blocked",
      creative.note,
    );
  } else {
    step("Creatives", "waiting", "Paste the Drive links and I will load them.");
  }

  let copy:
    | { variants: Variant[]; note: string; pending?: boolean }
    | undefined;
  try {
    copy = await writeCopy(req, ctx);
    if (copy.pending) step("Ad copy", "waiting", copy.note);
    else
      step("Ad copy written", "done", `${copy.variants.length} options below.`);
  } catch (e) {
    step(
      "Ad copy",
      "blocked",
      String(e instanceof Error ? e.message : e).slice(0, 200),
    );
  }

  // Naming follows the account convention already on the board so the tracker
  // keeps matching: Client-Mahara-<n>.
  const suggested = client ? `${client}-Mahara-1` : undefined;
  step(
    "Campaign name",
    suggested ? "waiting" : "blocked",
    suggested ? `Use ${suggested} unless you want something else.` : undefined,
  );
  step(
    "Build the campaign",
    "waiting",
    "Everything above is ready — open the builder and it is prefilled.",
  );

  const blocked = steps.filter(s => s.state === "blocked");
  const note =
    `${client}: I got through what I can without you. ` +
    (blocked.length === 0
      ? "Nothing is blocking the build."
      : `Blocked on: ${blocked
          .slice(0, 4)
          .map(s => s.label)
          .join("; ")}.`) +
    " Nothing was created live — the build is still your click.";
  return {
    steps,
    note,
    variants: copy?.variants,
    media: creative?.media,
    pending: copy?.pending,
  };
}

/** Drain the queue: claim, do, write back. Woken on enqueue and every 10 min. */
export const run = internalAction({
  args: {},
  returns: v.object({ done: v.number(), failed: v.number() }),
  handler: async ctx => {
    const deadline = Date.now() + RUN_BUDGET_MS;
    // biome-ignore lint/suspicious/noExplicitAny: queue rows
    const pending: any[] = await ctx.runQuery(internal.assist.pending, {});
    enqueueAi = (refId, prompt) =>
      ctx.runMutation(internal.askAi.enqueue, {
        kind: "assist_copy",
        refId,
        prompt,
      });
    let done = 0;
    let failed = 0;
    for (const req of pending) {
      await ctx.runMutation(internal.assist.claim, { id: req.id });
      try {
        const context = await ctx.runQuery(internal.assist.context, {
          campaignName: req.campaignName ?? undefined,
          client: req.client ?? undefined,
        });
        const out =
          req.kind === "copy"
            ? await writeCopy(req, context ?? {})
            : req.kind === "creative"
              ? await loadCreatives(req, context ?? {}, {
                  deadline,
                  persist: media =>
                    ctx.runMutation(internal.assist.progress, {
                      id: req.id,
                      media,
                    }),
                })
              : req.kind === "launch"
                ? await setUpLaunch(req, context ?? {})
                : (() => {
                    throw new Error(`unknown request kind ${req.kind}`);
                  })();
        // biome-ignore lint/suspicious/noExplicitAny: handler output
        const o: any = out;
        if (req.kind === "creative" && o.pending === true) {
          // Time is up mid-upload: back to the queue with the byte we reached,
          // and a fresh run picks it up at once.
          await ctx.runMutation(internal.assist.requeue, {
            id: req.id,
            media: o.media,
          });
          await ctx.scheduler.runAfter(0, internal.assistWorker.run, {});
          break;
        }
        // An empty variants list while Ask AI is still writing must not be
        // stored as "no copy": leave the field alone until the answer lands.
        const pendingCopy = o.pending === true;
        await ctx.runMutation(internal.assist.fulfill, {
          id: req.id,
          status: "ready",
          ...Object.fromEntries(
            Object.entries(o).filter(
              ([k, val]) =>
                val !== undefined &&
                val !== null &&
                k !== "pending" &&
                !(k === "variants" && pendingCopy),
            ),
          ),
        });
        done++;
      } catch (e) {
        // A failure must reach her, not the log.
        await ctx.runMutation(internal.assist.fulfill, {
          id: req.id,
          status: "failed",
          error: String(e instanceof Error ? e.message : e).slice(0, 400),
          note: "I could not finish this one. The reason is below — it is mine to fix, not yours to work around.",
        });
        failed++;
      }
    }
    return { done, failed };
  },
});
