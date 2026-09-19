import { googleYoutubeToken, graph } from "../../tools";
import type { Note, OrganicPayload } from "../payloads";
import { B2B, num, sql } from "../sb";
import { addDays, kuwaitDay } from "../time";
import type { Adapter, DailyPoint, SourceStamp } from "../types";

/**
 * Mahara's own organic presence: the Facebook Page, @mahara_media on
 * Instagram, and the maharamedia YouTube channel.
 *
 * Facebook and Instagram come straight from the Graph API on the Meta
 * system-user token the cockpit already holds for ads: the page and the
 * Instagram business account are in the same Business Manager, so no new
 * credential was needed. YouTube's public statistics come from the Data API on
 * the Google service account, once that API is switched on in the Cloud
 * project; until then the section says exactly which switch, rather than
 * showing a channel with no numbers.
 *
 * Publishing cadence comes from the B2B asset library, which already mirrors
 * every YouTube video and Instagram reel with its publish date. That is the
 * one organic fact the business has had all along; the reach and engagement
 * beside it are new as of 2026-09-19.
 *
 * Nothing here is an ad number and nothing here is added to one.
 */

const PAGE_ID = "587094101153861";
const IG_ID = "17841473441237528";
const YT_HANDLE = "maharamedia";
const YT_ENABLE_URL =
  "https://console.developers.google.com/apis/api/youtube.googleapis.com/overview?project=195153154932";

type Any = Record<string, unknown>;

/**
 * Page insights answer only to the Page's own token, which the system user
 * can mint from me/accounts. A metric Meta will not return is null, never a
 * throw and never a zero. `sum` adds a daily series (new follows), otherwise
 * the last value of the period is taken.
 */
async function pageMetric(
  pageToken: string,
  metric: string,
  period: string,
  sum = false,
): Promise<number | null> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${PAGE_ID}/insights?metric=${metric}&period=${period}&access_token=${pageToken}`,
    );
    const r = (await res.json()) as {
      data?: { values?: { value?: unknown }[] }[];
      error?: unknown;
    };
    if (r.error) return null;
    const values = (r.data?.[0]?.values ?? [])
      .map(x => x.value)
      .filter((x): x is number => typeof x === "number");
    if (!values.length) return null;
    return sum ? values.reduce((a, b) => a + b, 0) : values[values.length - 1];
  } catch {
    return null;
  }
}

async function pageToken(): Promise<string | null> {
  try {
    const r = (await graph("me/accounts", { fields: "id,access_token" })) as {
      data?: { id: string; access_token?: string }[];
    };
    return r.data?.find(p => p.id === PAGE_ID)?.access_token ?? null;
  } catch {
    return null;
  }
}

export const organic: Adapter = {
  key: "organic",
  label: "Organic",
  compute: async ctx => {
    void ctx;
    const now = Date.now();
    const today = kuwaitDay(now);
    const from28 = addDays(today, -27);
    const notes: Note[] = [];
    const sources: SourceStamp[] = [];
    const missing: string[] = [];

    // --- Facebook page ----------------------------------------------------
    let facebook: OrganicPayload["facebook"] = null;
    try {
      const page = (await graph(PAGE_ID, {
        fields: "id,name,fan_count,followers_count,link",
      })) as Any;
      const token = await pageToken();
      const [views, engagements, newFollows] = token
        ? await Promise.all([
            pageMetric(token, "page_views_total", "days_28"),
            pageMetric(token, "page_post_engagements", "days_28"),
            pageMetric(token, "page_daily_follows_unique", "day", true),
          ])
        : [null, null, null];
      if (views === null) missing.push("Facebook page views");
      if (engagements === null) missing.push("Facebook post engagement");
      if (newFollows === null) missing.push("Facebook new followers");
      facebook = {
        pageId: String(page.id),
        name: String(page.name ?? "Facebook page"),
        url: page.link ? String(page.link) : null,
        followers: num(page.followers_count ?? page.fan_count),
        views28: views,
        engagements28: engagements,
        newFollowers28: newFollows,
      };
      sources.push({
        name: "Facebook Page (Graph API)",
        ok: true,
        freshestAt: now,
      });
    } catch (e) {
      sources.push({
        name: "Facebook Page (Graph API)",
        ok: false,
        note: String(e instanceof Error ? e.message : e).slice(0, 160),
      });
    }

    // --- Instagram business account ---------------------------------------
    let instagram: OrganicPayload["instagram"] = null;
    try {
      const acct = (await graph(IG_ID, {
        fields: "id,username,followers_count,media_count",
      })) as Any;
      const since = Math.floor(
        new Date(`${from28}T00:00:00Z`).getTime() / 1000,
      );
      const until = Math.floor(now / 1000);
      let reach28: number | null = null;
      let engaged28: number | null = null;
      try {
        const ins = (await graph(`${IG_ID}/insights`, {
          metric: "reach,accounts_engaged",
          period: "day",
          metric_type: "total_value",
          since,
          until,
        })) as {
          data?: { name?: string; total_value?: { value?: unknown } }[];
        };
        for (const m of ins.data ?? []) {
          const v = m.total_value?.value;
          if (m.name === "reach" && typeof v === "number") reach28 = v;
          if (m.name === "accounts_engaged" && typeof v === "number")
            engaged28 = v;
        }
      } catch {
        missing.push("Instagram reach");
      }
      const media = (await graph(`${IG_ID}/media`, {
        fields:
          "id,media_type,timestamp,like_count,comments_count,permalink,thumbnail_url,media_url,caption",
        limit: 24,
      })) as { data?: Any[] };
      const posts = (media.data ?? []).map(m => ({
        id: String(m.id),
        type: String(m.media_type ?? ""),
        at: String(m.timestamp ?? ""),
        likes: num(m.like_count),
        comments: num(m.comments_count),
        url: String(m.permalink ?? ""),
        thumbnail: m.thumbnail_url
          ? String(m.thumbnail_url)
          : m.media_type === "IMAGE" && m.media_url
            ? String(m.media_url)
            : null,
        caption: m.caption ? String(m.caption).slice(0, 120) : null,
      }));
      const from28Ms = new Date(`${from28}T00:00:00Z`).getTime();
      const published28 = posts.filter(
        p => Date.parse(p.at) >= from28Ms,
      ).length;
      instagram = {
        id: String(acct.id),
        username: String(acct.username ?? "mahara_media"),
        followers: num(acct.followers_count),
        mediaCount: num(acct.media_count),
        reach28,
        engaged28,
        /** Posts in the last 28 days, counted from the live media list (a floor once it hits the page size). */
        published28,
        posts,
      };
      sources.push({
        name: "Instagram business account (Graph API)",
        ok: true,
        freshestAt: now,
      });
    } catch (e) {
      sources.push({
        name: "Instagram business account (Graph API)",
        ok: false,
        note: String(e instanceof Error ? e.message : e).slice(0, 160),
      });
    }

    // --- YouTube channel --------------------------------------------------
    let youtube: OrganicPayload["youtube"] = {
      enabled: false,
      enableUrl: YT_ENABLE_URL,
      channelId: null,
      subscribers: null,
      views: null,
      videos: null,
      recent: [],
    };
    try {
      const token = await googleYoutubeToken();
      const h = { Authorization: `Bearer ${token}` };
      const ch = await fetch(
        `https://www.googleapis.com/youtube/v3/channels?part=statistics,contentDetails&forHandle=${YT_HANDLE}`,
        { headers: h },
      );
      const chText = await ch.text();
      if (!ch.ok) throw new Error(`HTTP ${ch.status}: ${chText.slice(0, 120)}`);
      const c = (JSON.parse(chText).items ?? [])[0] as Any | undefined;
      if (c) {
        const stats = (c.statistics ?? {}) as Any;
        const uploads = String(
          ((c.contentDetails as Any)?.relatedPlaylists as Any)?.uploads ?? "",
        );
        const recent: OrganicPayload["youtube"]["recent"] = [];
        if (uploads) {
          const pl = await fetch(
            `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=12&playlistId=${uploads}`,
            { headers: h },
          );
          const items = (
            pl.ok ? (JSON.parse(await pl.text()).items ?? []) : []
          ) as Any[];
          const ids = items
            .map(i => String((i.contentDetails as Any)?.videoId ?? ""))
            .filter(Boolean);
          if (ids.length) {
            const vs = await fetch(
              `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${ids.join(",")}`,
              { headers: h },
            );
            const vids = (
              vs.ok ? (JSON.parse(await vs.text()).items ?? []) : []
            ) as Any[];
            for (const v of vids) {
              const sn = (v.snippet ?? {}) as Any;
              const st = (v.statistics ?? {}) as Any;
              recent.push({
                id: String(v.id),
                title: String(sn.title ?? ""),
                at: String(sn.publishedAt ?? ""),
                views: num(st.viewCount),
                likes: num(st.likeCount),
                comments: num(st.commentCount),
                thumbnail:
                  String(((sn.thumbnails as Any)?.medium as Any)?.url ?? "") ||
                  null,
              });
            }
          }
        }
        youtube = {
          enabled: true,
          enableUrl: YT_ENABLE_URL,
          channelId: String(c.id),
          subscribers: num(stats.subscriberCount),
          views: num(stats.viewCount),
          videos: num(stats.videoCount),
          recent,
        };
        sources.push({ name: "YouTube Data API", ok: true, freshestAt: now });
      }
    } catch (e) {
      sources.push({
        name: "YouTube Data API",
        ok: false,
        note: String(e instanceof Error ? e.message : e).slice(0, 160),
      });
      notes.push({
        level: "warn",
        text: `YouTube is not measured yet: the YouTube Data API is switched off in the Google Cloud project behind the cockpit's service account. One switch enables it, at the link on the card. Until then the channel's subscribers and views are missing, not zero.`,
      });
    }

    // --- Publishing cadence from the asset library ------------------------
    const cadence: OrganicPayload["cadence"] = [];
    try {
      const rows = await sql(
        B2B,
        `select asset_type,
                count(*) filter (where published_at >= current_date - 27) as last28,
                count(*) filter (where published_at >= current_date - 89) as last90,
                to_char(max(published_at), 'YYYY-MM-DD') as newest
         from public.assets
         where asset_type in ('youtube_video','reel')
         group by asset_type`,
      );
      for (const r of rows)
        cadence.push({
          platform:
            String(r.asset_type) === "reel"
              ? "Instagram reels"
              : "YouTube videos",
          last28: num(r.last28),
          last90: num(r.last90),
          newest: r.newest ? String(r.newest) : null,
        });
      sources.push({ name: "B2B asset library (publish dates)", ok: true });
    } catch (e) {
      sources.push({
        name: "B2B asset library (publish dates)",
        ok: false,
        note: String(e instanceof Error ? e.message : e).slice(0, 160),
      });
    }

    if (missing.length)
      notes.push({
        level: "info",
        text: `Not returned by Meta on this run: ${missing.join(", ")}. Meta's page insights answer the Page token with empty series for this page, so the page's follower count is live and its 28-day roll-ups are missing rather than zero. Instagram's reach and engaged accounts read fine.`,
      });
    notes.push({
      level: "info",
      text: `Facebook and Instagram read live from the Graph API on the same token the ads use; the page and the account sit in the same Business Manager. Reach and engaged accounts cover the last 28 days. Publishing cadence comes from the asset library, which mirrors every video and reel with its publish date. None of this is an ad number and none of it is added to one.`,
    });

    const payload: OrganicPayload = {
      facebook,
      instagram,
      youtube,
      cadence,
      notes,
    };
    const daily: DailyPoint[] = [];
    if (facebook)
      daily.push({
        date: today,
        metric: "organic.facebook.followers",
        scope: "company",
        value: facebook.followers,
      });
    if (instagram) {
      daily.push({
        date: today,
        metric: "organic.instagram.followers",
        scope: "company",
        value: instagram.followers,
      });
      if (instagram.reach28 !== null)
        daily.push({
          date: today,
          metric: "organic.instagram.reach28",
          scope: "company",
          value: instagram.reach28,
        });
    }
    if (youtube.enabled && youtube.subscribers !== null)
      daily.push({
        date: today,
        metric: "organic.youtube.subscribers",
        scope: "company",
        value: youtube.subscribers,
      });
    return { payload, daily, sources };
  },
};
