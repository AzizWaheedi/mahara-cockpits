/**
 * Sending a finished video to a client for review, from this cockpit.
 *
 * The page the client sees lives in the editor cockpit and is the same
 * one for everybody; this only makes the link. Both cockpits call the
 * same Supabase functions, so a review made here and a review made there
 * are the same object with the same rules.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { authenticatedAction } from "./functions";

type Seat = { email: string; clients: { name: string; taskId: string }[] };
function clientFor(seat: Seat, name?: string, taskId?: string) {
  const hits = seat.clients.filter(
    c =>
      (!taskId || c.taskId === taskId) &&
      c.name.trim().toLowerCase() === name?.trim().toLowerCase(),
  );
  if (hits.length !== 1)
    throw new Error("Select one of your clients before creating a review.");
  return hits[0];
}

declare const process: { env: Record<string, string | undefined> };

const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/** Where the client's page lives, whichever cockpit made the link. */
const REVIEW_BASE = "https://cockpit.maharamedia.com/editor/review";

async function rpc(fn: string, args: Record<string, unknown>) {
  if (!SUPABASE_URL || !SUPABASE_KEY)
    throw new Error("Supabase is not configured for this cockpit.");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    signal: AbortSignal.timeout(20000),
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(
      `The review service could not complete the request (${res.status}). Refresh its status before trying again.`,
    );
  return text ? JSON.parse(text) : null;
}

/**
 * Video or still, from the link alone.
 *
 * A pasted image would otherwise arrive as a video and the client gets a
 * player that will not play. Extension first, then the query string, so
 * a signed URL with `?token=` still reads correctly.
 */
function kindOf(url: string): "video" | "image" {
  const path = url.split("?")[0].toLowerCase();
  if (/\.(jpe?g|png|webp|gif|heic|avif)$/.test(path)) return "image";
  return "video";
}

/**
 * Make the link.
 *
 * A video URL is all that is strictly needed: the title falls back to
 * the position, and everything else is optional. Anything more would be
 * a form standing between somebody and sending a video.
 */
export const create = authenticatedAction({
  args: {
    title: v.string(),
    note: v.optional(v.string()),
    client: v.optional(v.string()),
    videos: v.array(
      v.object({
        title: v.optional(v.string()),
        url: v.string(),
        taskId: v.optional(v.string()),
      }),
    ),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const seat: Seat = await ctx.runQuery(internal.roles.actionSeat, {
      userId: ctx.userId,
    });
    const client = clientFor(seat, args.client);
    const by = seat.email;
    if (args.videos.length > 30 || (args.note?.length ?? 0) > 5000)
      throw new Error("Use up to 30 items and a short note.");

    const videos = args.videos
      .map(x => ({ ...x, url: x.url.trim() }))
      .filter(x => x.url);
    if (!videos.length) throw new Error("Give it at least one video link.");
    const bad = videos.find(x => !/^https?:\/\//i.test(x.url));
    if (bad)
      throw new Error(
        `"${bad.url.slice(0, 50)}" is not a link. Paste the address of the video file itself.`,
      );

    const made = (await rpc("review_create", {
      p_title: args.title.trim() || "Videos for review",
      p_note: (args.note ?? "").trim() || null,
      p_client: client.name,
      p_client_task_id: client.taskId,
      p_by: by,
      p_items: videos.map((x, i) => {
        const kind = kindOf(x.url);
        return {
          title:
            (x.title ?? "").trim() ||
            `${kind === "image" ? "Image" : "Video"} ${i + 1}`,
          video_url: x.url,
          task_id: x.taskId ?? null,
          kind,
        };
      }),
      p_days: 30,
    })) as { token: string; items: number };

    return { url: `${REVIEW_BASE}/${made.token}`, items: made.items };
  },
});

/** What has been sent, and what the client did about it. */
export const sent = authenticatedAction({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const seat: Seat = await ctx.runQuery(internal.roles.actionSeat, {
      userId: ctx.userId,
    });
    const rows = (await rpc("review_list", { p_limit: 25 })) as Array<
      Record<string, unknown>
    > | null;
    return (rows ?? [])
      .filter(r =>
        seat.clients.some(
          c =>
            c.name.trim().toLowerCase() ===
            String(r.client_name ?? "")
              .trim()
              .toLowerCase(),
        ),
      )
      .map(r => ({
        ...r,
        url: `${REVIEW_BASE}/${String(r.token)}`,
      }));
  },
});

/** The clients a review can be for: the ClickUp cards, not free text. */
export const clients = authenticatedAction({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const seat: Seat = await ctx.runQuery(internal.roles.actionSeat, {
      userId: ctx.userId,
    });
    return seat.clients.map(c => ({ name: c.name, task_id: c.taskId }));
  },
});

/**
 * Hand a whole Drive folder over and let a worker do it.
 *
 * Expanding a folder needs Drive's OAuth token, which lives on the VPS
 * with the editor desk, and copying a 100MB cut into our bucket is not
 * something to do inside a request. So this queues it and the screen
 * watches; `importStatus` is what it watches with.
 */
export const importFolder = authenticatedAction({
  args: {
    folder: v.string(),
    title: v.optional(v.string()),
    note: v.optional(v.string()),
    client: v.optional(v.string()),
    clientTaskId: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const seat: Seat = await ctx.runQuery(internal.roles.actionSeat, {
      userId: ctx.userId,
    });
    const client = clientFor(seat, args.client, args.clientTaskId);
    const folder = args.folder.trim();
    if (
      !/^(?:https:\/\/drive\.google\.com\/(?:drive\/folders\/|folders\/)[A-Za-z0-9_-]+(?:\?[^\s]*)?|[A-Za-z0-9_-]{20,})$/.test(
        folder,
      )
    )
      throw new Error("Paste the Google Drive folder link.");
    return await rpc("review_import_folder", {
      p_folder: folder,
      p_title: (args.title ?? "").trim() || "Videos for review",
      p_note: (args.note ?? "").trim() || null,
      p_client: client.name,
      p_client_task_id: client.taskId,
      p_by: seat.email,
    });
  },
});

export const importStatus = authenticatedAction({
  args: { id: v.number() },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    const seat: Seat = await ctx.runQuery(internal.roles.actionSeat, {
      userId: ctx.userId,
    });
    if (!Number.isSafeInteger(id) || id < 1)
      throw new Error("Choose a valid import.");
    if (!SUPABASE_URL || !SUPABASE_KEY)
      throw new Error("The review service is not configured.");
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/review_imports?select=id,status,token,found,copied,error,client_task_id,client_name,requested_by&id=eq.${id}&limit=1`,
      {
        signal: AbortSignal.timeout(15000),
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      },
    );
    if (!res.ok)
      throw new Error(
        "The import status could not be read. Try refreshing it.",
      );
    const rows = (await res.json()) as Record<string, unknown>[];
    const out = rows[0];
    if (out && !seat.clients.some(c => c.taskId === out.client_task_id))
      throw new Error("That import is not for one of your clients.");
    if (!out) return null;
    return out.token
      ? { ...out, url: `${REVIEW_BASE}/${String(out.token)}` }
      : out;
  },
});
