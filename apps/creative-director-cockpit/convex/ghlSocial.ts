/**
 * GoHighLevel's Social Planner.
 *
 * Not the appointment calendars in `ghlCalendar.ts`. Same host and the
 * same kind of bearer token, and nothing else in common: a different
 * version header, its own scopes, and a token scoped to the client's
 * sub-account rather than to Mahara's.
 *
 * GHL is the posting engine and nothing more. It holds the Meta and
 * LinkedIn connections, it shows the client the approval link, and it
 * publishes natively at the scheduled time. Staff never open it; the
 * cockpit is the control surface.
 *
 * **The calendar is cached, never read live.** GHL's API is not reliable
 * enough to sit in front of a page load. The cockpit shows what it last
 * saw and says when that was, so a slow GHL makes the calendar stale
 * rather than blank.
 */
declare const process: { env: Record<string, string | undefined> };

export const BASE = "https://services.leadconnectorhq.com";

/**
 * The version header, per endpoint, because their own documentation does
 * not agree with itself: the create-post page says `v3` while the rest of
 * the v2 API -- and the community thread on the "Invalid JWT" error that
 * is really a missing header -- says a date. Both are overridable from the
 * environment so a wrong guess is a variable change and not a deploy.
 */
export const VERSION = {
  posts: process.env.GHL_SOCIAL_VERSION_POSTS ?? "2021-07-28",
  write: process.env.GHL_SOCIAL_VERSION_WRITE ?? "v3",
  oauth: process.env.GHL_OAUTH_VERSION ?? "2021-07-28",
} as const;

/** The scopes a token needs. Named here so a 401 can say which is missing. */
export const SCOPES = [
  "socialplanner/post.readonly",
  "socialplanner/post.write",
  "socialplanner/account.readonly",
] as const;

// biome-ignore lint/suspicious/noExplicitAny: GHL's shapes are its own
type Json = Record<string, any>;

export class GhlError extends Error {
  // Declared rather than parameter properties: this project compiles with
  // erasableSyntaxOnly, which forbids syntax that emits code.
  status: number;
  path: string;

  constructor(status: number, path: string, body: string) {
    super(GhlError.explain(status, body));
    this.status = status;
    this.path = path;
  }

  /**
   * GHL's own messages are not much use on their own. The two that come up
   * are worth translating, because both look like a broken token and
   * neither is.
   */
  static explain(status: number, body: string): string {
    const short = body.slice(0, 200);
    if (/invalid jwt/i.test(short))
      return (
        "GoHighLevel refused the token as an invalid JWT. That is usually a " +
        "missing or wrong Version header rather than a bad token -- see " +
        "GHL_SOCIAL_VERSION_POSTS and GHL_SOCIAL_VERSION_WRITE."
      );
    if (status === 401 || status === 403)
      return (
        "GoHighLevel refused the token. It needs the scopes " +
        `${SCOPES.join(", ")} and has to belong to that client's sub-account.`
      );
    if (status === 404) return "GoHighLevel has no such sub-account or post.";
    return `GoHighLevel ${status}: ${short}`;
  }
}

export async function ghl(
  path: string,
  init: {
    token: string;
    method?: string;
    version?: string;
    body?: unknown;
  },
): Promise<Json> {
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${init.token}`,
      // Required on every v2 call. Leaving it off is the usual cause of
      // "Invalid JWT", which reads like the token is wrong when it is not.
      Version: init.version ?? VERSION.posts,
      Accept: "application/json",
      ...(init.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new GhlError(res.status, path, text);
  return text ? JSON.parse(text) : {};
}

/**
 * A token for one client's sub-account.
 *
 * Two ways in, and the cockpit takes whichever is set up. A Private
 * Integration Token made in that sub-account's own settings never expires
 * and needs no app; an agency token mints one per location through
 * `/oauth/locationToken`, which is one credential for twelve clients
 * instead of twelve. Starting with the first and moving to the second
 * later changes nothing above this function.
 */
export async function locationToken(
  locationId: string,
  stored: { token?: string | null; expiresAt?: string | null } | null,
  agency: { token?: string | null; companyId?: string | null } | null,
): Promise<{ token: string; expiresAt: string | null; minted: boolean }> {
  const fresh =
    stored?.token &&
    (!stored.expiresAt || Date.parse(stored.expiresAt) > Date.now() + 60_000);
  if (fresh && stored?.token)
    return {
      token: stored.token,
      expiresAt: stored.expiresAt ?? null,
      minted: false,
    };

  if (!agency?.token)
    throw new Error(
      `No GoHighLevel token for ${locationId}. Either add that sub-account's ` +
        "Private Integration Token, or add the agency token so the cockpit can " +
        "mint one per client.",
    );
  if (!agency.companyId)
    throw new Error(
      "Minting a sub-account token needs the agency's company id alongside the token.",
    );

  const out = await ghl("/oauth/locationToken", {
    token: agency.token,
    method: "POST",
    version: VERSION.oauth,
    body: { companyId: agency.companyId, locationId },
  });
  const token = String(out.access_token ?? "");
  if (!token)
    throw new Error("GoHighLevel returned no token for that sub-account.");
  const seconds = Number(out.expires_in ?? 86400);
  return {
    token,
    expiresAt: new Date(Date.now() + seconds * 1000).toISOString(),
    minted: true,
  };
}

/** The social accounts GHL holds for a client. */
export async function accounts(
  locationId: string,
  token: string,
): Promise<Json[]> {
  const out = await ghl(
    `/social-media-posting/${encodeURIComponent(locationId)}/accounts`,
    {
      token,
    },
  );
  const rows = out.results?.accounts ?? out.accounts ?? out.data ?? [];
  return Array.isArray(rows) ? rows : [];
}

/** Posts in a window, for the cockpit's own calendar. */
export async function posts(
  locationId: string,
  token: string,
  opts: { from?: string; to?: string; limit?: number } = {},
): Promise<Json[]> {
  const q = new URLSearchParams();
  if (opts.from) q.set("fromDate", opts.from);
  if (opts.to) q.set("toDate", opts.to);
  q.set("limit", String(Math.max(1, Math.min(100, opts.limit ?? 100))));
  const out = await ghl(
    `/social-media-posting/${encodeURIComponent(locationId)}/posts?${q}`,
    { token },
  );
  const rows = out.results?.posts ?? out.posts ?? out.data ?? [];
  return Array.isArray(rows) ? rows : [];
}

/**
 * Put a post in front of the client.
 *
 * `in_review` is the whole client-approval step, and none of it is ours to
 * build: GHL holds the post, sends the client a password-protected
 * approval link, and publishes natively at `scheduleDate` once they
 * approve. The client never logs into anything and we never touch the
 * publish button.
 */
export async function createPost(
  locationId: string,
  token: string,
  post: {
    accountIds: string[];
    summary: string;
    media?: { url: string; type?: string; caption?: string }[];
    scheduleDate: string;
    type?: "post" | "story" | "reel";
    approverUserId?: string;
  },
): Promise<Json> {
  if (!post.accountIds.length)
    throw new Error("That client has no connected social account to post to.");
  if (!post.summary.trim())
    throw new Error("A post with no caption is not ready to go to the client.");
  const body: Json = {
    accountIds: post.accountIds,
    summary: post.summary,
    type: post.type ?? "post",
    status: "in_review",
    scheduleDate: post.scheduleDate,
  };
  if (post.media?.length)
    body.media = post.media.map(m => ({
      url: m.url,
      type: m.type ?? "image",
      ...(m.caption ? { caption: m.caption } : {}),
    }));
  if (post.approverUserId)
    body.postApprovalDetails = { requesterUserId: post.approverUserId };
  return ghl(`/social-media-posting/${encodeURIComponent(locationId)}/posts`, {
    token,
    method: "POST",
    version: VERSION.write,
    body,
  });
}

export async function deletePost(
  locationId: string,
  token: string,
  postId: string,
): Promise<void> {
  await ghl(
    `/social-media-posting/${encodeURIComponent(locationId)}/posts/${encodeURIComponent(postId)}`,
    { token, method: "DELETE", version: VERSION.write },
  );
}

/**
 * GHL's own words for where a post is, mapped to ours.
 *
 * Kept as a function rather than a lookup so an unfamiliar status is
 * carried through instead of silently becoming something it is not. The
 * cockpit showing a status it does not recognise is better than the
 * cockpit saying "published" about something that is not.
 */
export function ourStatus(theirs: string): string {
  switch ((theirs || "").toLowerCase()) {
    case "in_review":
    case "pending":
      return "with_client";
    case "scheduled":
    case "notification_sent":
      return "scheduled";
    case "published":
      return "published";
    case "failed":
      return "failed";
    case "deleted":
      return "client_rejected";
    case "draft":
    case "in_progress":
      return "generated";
    default:
      return theirs || "unknown";
  }
}
