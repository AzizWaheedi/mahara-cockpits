"use node";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
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
type Media = {
  name: string;
  link: string;
  kind?: string;
  imageHash?: string;
  videoId?: string;
  thumbUrl?: string;
  error?: string;
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
async function writeCopy(
  req: Req,
  ctx: Ctx,
): Promise<{ variants: Variant[]; note: string }> {
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

Ads that have actually produced cheap leads for similar clients — steal the
angles, not the words:
${proof || "No comparable winners on file yet."}
${HOUSE_RULES}
Give 5 distinct angles, not 5 rewrites of one sentence: outcome, objection,
proof, question, direct offer. Write in ${language}. Name the angle in English.
`;
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

const DRIVE_ID = /(?:\/d\/|id=|\/file\/d\/|folders\/)([A-Za-z0-9_-]{16,})/;

/** The file id inside any shape of Drive link, or a bare id. */
function driveId(link: string): string | undefined {
  const m = DRIVE_ID.exec(link);
  if (m) return m[1];
  const bare = link.trim();
  return /^[A-Za-z0-9_-]{16,}$/.test(bare) ? bare : undefined;
}

type DriveFile = { id: string; name: string; mimeType: string; size?: string };

async function driveMeta(id: string, token: string): Promise<DriveFile> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,mimeType,size&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const json = await res.json();
  if (!res.ok) {
    throw new Error(
      json?.error?.message ??
        "Drive would not hand the file over — is it shared with the service account?",
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

/** Pull each Drive link into the client's Meta ad account, ready to use. */
async function loadCreatives(
  req: Req,
  ctx: Ctx,
): Promise<{ media: Media[]; note: string }> {
  const c = ctx.campaign ?? {};
  const account: string | undefined =
    c.metaAccountId || ctx.onboarding?.accountId || ctx.launchWatch?.accountId;
  const links: string[] = req.driveLinks ?? [];
  const media: Media[] = [];
  let token: string | undefined;

  for (const link of links) {
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
        const entry: Media = { name: file.name.slice(0, 120), link };
        try {
          const isVideo =
            file.mimeType.startsWith("video") ||
            /\.(mp4|mov|m4v)$/i.test(file.name);
          entry.kind = isVideo ? "video" : "image";
          const bytes = await driveDownload(file.id, token);
          const up = await metaUpload(account, file, bytes, isVideo);
          if (isVideo) entry.videoId = up.id;
          else {
            entry.imageHash = up.hash;
            entry.thumbUrl = up.url;
          }
        } catch (e) {
          // one bad file must not kill the batch
          entry.error = String(e instanceof Error ? e.message : e).slice(
            0,
            300,
          );
        }
        media.push(entry);
      }
    } catch (e) {
      media.push({
        name: fid,
        link,
        error: String(e instanceof Error ? e.message : e).slice(0, 300),
      });
    }
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

  let copy: { variants: Variant[]; note: string } | undefined;
  try {
    copy = await writeCopy(req, ctx);
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
  return { steps, note, variants: copy?.variants, media: creative?.media };
}

/** Drain the queue: claim, do, write back. Woken on enqueue and every 10 min. */
export const run = internalAction({
  args: {},
  returns: v.object({ done: v.number(), failed: v.number() }),
  handler: async ctx => {
    // biome-ignore lint/suspicious/noExplicitAny: queue rows
    const pending: any[] = await ctx.runQuery(internal.assist.pending, {});
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
              ? await loadCreatives(req, context ?? {})
              : req.kind === "launch"
                ? await setUpLaunch(req, context ?? {})
                : (() => {
                    throw new Error(`unknown request kind ${req.kind}`);
                  })();
        await ctx.runMutation(internal.assist.fulfill, {
          id: req.id,
          status: "ready",
          ...Object.fromEntries(
            Object.entries(out).filter(
              ([, val]) => val !== undefined && val !== null,
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
