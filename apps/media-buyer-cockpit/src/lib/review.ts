import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export const REVIEW_BASE = "https://cockpit.maharamedia.com/editor/review";

function kindOf(url: string): "video" | "image" {
  const path = url.split("?")[0].toLowerCase();
  if (/\.(jpe?g|png|webp|gif|heic|avif)$/.test(path)) return "image";
  return "video";
}

export async function createReview(
  client?: SupabaseClient | null,
  userEmail?: string,
  args?: {
    title: string;
    note?: string;
    client?: string;
    videos: Array<{
      title?: string;
      url: string;
      taskId?: string;
    }>;
  },
) {
  const sb = client ?? supabase;
  if (!args) throw new Error("No review data provided.");
  const videos = (args.videos ?? [])
    .map(x => ({ ...x, url: x.url.trim() }))
    .filter(x => x.url);
  if (!videos.length) throw new Error("Give it at least one video link.");
  const bad = videos.find(x => !/^https?:\/\//i.test(x.url));
  if (bad)
    throw new Error(
      `"${bad.url.slice(0, 50)}" is not a link. Paste the address of the video file itself.`,
    );

  const { data, error } = await sb.rpc("cockpit_review_create", {
    p_title: args.title.trim() || "Videos for review",
    p_note: (args.note ?? "").trim() || null,
    p_client: (args.client ?? "").trim() || null,
    p_client_task_id: null,
    p_by: userEmail || "creative",
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
  });

  if (error) throw new Error(error.message);
  const made = data as { token: string; items: number };
  return { url: `${REVIEW_BASE}/${made.token}`, items: made.items };
}

export async function listSentReviews(
  client?: SupabaseClient | null,
  _userEmail?: string,
  _args?: any,
) {
  const sb = client ?? supabase;
  const { data, error } = await sb.rpc("cockpit_review_list", { p_limit: 25 });
  if (error) throw new Error(error.message);
  const rows = (data as Array<Record<string, unknown>>) ?? [];
  return rows.map(r => ({
    ...r,
    url: `${REVIEW_BASE}/${String(r.token)}`,
  }));
}

export async function listReviewClients(
  client?: SupabaseClient | null,
  _userEmail?: string,
  _args?: any,
) {
  const sb = client ?? supabase;
  const { data, error } = await sb.rpc("cockpit_review_clients", {});
  if (error) throw new Error(error.message);
  return (data as Array<{ task_id: string; name: string }>) ?? [];
}

export async function importReviewFolder(
  client?: SupabaseClient | null,
  userEmail?: string,
  args?: {
    folder: string;
    title?: string;
    note?: string;
    client?: string;
    clientTaskId?: string;
  },
) {
  const sb = client ?? supabase;
  if (!args) throw new Error("No folder import data provided.");
  const folder = args.folder.trim();
  if (!/drive\.google\.com|^[A-Za-z0-9_-]{20,}$/.test(folder))
    throw new Error("Paste the Google Drive folder link.");
  const { data, error } = await sb.rpc("cockpit_review_import_folder", {
    p_folder: folder,
    p_title: (args.title ?? "").trim() || "Videos for review",
    p_note: (args.note ?? "").trim() || null,
    p_client: (args.client ?? "").trim() || null,
    p_client_task_id: args.clientTaskId ?? null,
    p_by: userEmail || "creative",
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function checkReviewImportStatus(
  client?: SupabaseClient | null,
  _userEmail?: string,
  args?: { id: number },
) {
  const sb = client ?? supabase;
  if (!args) return null;
  const { data, error } = await sb.rpc("cockpit_review_import_status", {
    p_id: args.id,
  });
  if (error) throw new Error(error.message);
  const out = data as Record<string, unknown> | null;
  if (!out) return null;
  return out.token ? { ...out, url: `${REVIEW_BASE}/${String(out.token)}` } : out;
}

export const api = {
  review: {
    create: (args: any) => createReview(supabase, "creative", args),
    sent: () => listSentReviews(supabase),
    clients: () => listReviewClients(supabase),
    importFolder: (args: any) => importReviewFolder(supabase, "creative", args),
    importStatus: (args: any) => checkReviewImportStatus(supabase, "creative", args),
  },
};
