import { ExternalLink, Film, Youtube } from "lucide-react";
import { EmptyState } from "@/components/ceo/EmptyState";
import { count, countCompact, shortDate } from "@/components/ceo/format";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatTile } from "@/components/ceo/StatTile";
import { StatusChip } from "@/components/ceo/StatusChip";
import type { OrganicPayload } from "../../../convex/ceo/payloads";
import type { CeoTabProps } from "./types";

/**
 * Mahara's own content: what is performing best right now across the
 * platforms, then one card per platform. Nothing on this tab is an ad
 * number: it is what people saw and did without being paid to.
 *
 * "Best" is a multiple of the platform's own normal, so a reel and a long
 * video sit in the same ranking without the reel always winning on raw
 * views.
 */

const na = (v: number | null) => (v === null ? "—" : countCompact(v));
const times = (m: number) => `${m >= 10 ? Math.round(m) : m.toFixed(1)}×`;

function Best({ rows }: { rows: OrganicPayload["best"] }) {
  if (!rows.length)
    return (
      <EmptyState
        title="Nothing ranked yet"
        text="Once Instagram and YouTube have returned per-post numbers, the posts running above their platform's normal appear here."
        icon={Film}
        compact
      />
    );
  return (
    <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
      {rows.map(r => (
        <a
          key={`${r.platform}-${r.id}`}
          href={r.url}
          target="_blank"
          rel="noreferrer"
          className="w-[168px] shrink-0 rounded-lg border p-2 hover:bg-muted/40"
        >
          <div
            className={`relative w-full overflow-hidden rounded-md bg-muted ${r.platform === "youtube" ? "aspect-video" : "aspect-[4/5]"}`}
          >
            {r.thumbnail ? (
              <img
                src={r.thumbnail}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
                onError={e => {
                  e.currentTarget.style.display = "none";
                }}
              />
            ) : null}
            <span
              className="absolute left-2 top-2 rounded-full bg-foreground px-2 py-0.5 text-xs font-bold text-background"
              style={{ fontVariantNumeric: "tabular-nums" }}
              title={`${times(r.multiple)} the platform's normal`}
            >
              {times(r.multiple)}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="font-semibold">{`${countCompact(r.value)} ${r.metric}`}</span>
            <span className="text-muted-foreground">
              {r.platform === "youtube" ? "YouTube" : "Instagram"}
            </span>
          </div>
          <p
            className="mt-1 line-clamp-2 text-xs text-muted-foreground"
            dir="auto"
          >
            {r.title}
          </p>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {shortDate(r.at)}
          </div>
        </a>
      ))}
    </div>
  );
}

function Posts({
  posts,
}: {
  posts: NonNullable<OrganicPayload["instagram"]>["posts"];
}) {
  if (!posts.length) return null;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {posts.slice(0, 12).map(p => (
        <a
          key={p.id}
          href={p.url}
          target="_blank"
          rel="noreferrer"
          className="grid gap-1 rounded-md border p-2 hover:bg-muted/40"
        >
          <div className="relative aspect-square w-full overflow-hidden rounded bg-muted">
            {p.thumbnail ? (
              <img
                src={p.thumbnail}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
                onError={e => {
                  e.currentTarget.style.display = "none";
                }}
              />
            ) : null}
            {p.multiple !== null && p.multiple >= 1.5 ? (
              <span className="absolute left-1.5 top-1.5 rounded-full bg-foreground px-1.5 py-0.5 text-[10px] font-bold text-background">
                {times(p.multiple)}
              </span>
            ) : null}
          </div>
          <div
            className="flex items-center justify-between text-xs"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            <span>
              {p.views !== null
                ? `${countCompact(p.views)} views`
                : p.reach !== null
                  ? `${countCompact(p.reach)} reach`
                  : `♥ ${count(p.likes)}`}
            </span>
            <span className="text-muted-foreground">{shortDate(p.at)}</span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            {`♥ ${count(p.likes)} · ${count(p.comments)}${p.saved !== null ? ` · ${count(p.saved)} saved` : ""}${p.shares !== null ? ` · ${count(p.shares)} shared` : ""}`}
          </div>
          {p.caption ? (
            <div className="truncate text-xs text-muted-foreground" dir="auto">
              {p.caption}
            </div>
          ) : null}
        </a>
      ))}
    </div>
  );
}

export function OrganicTab({ sections }: CeoTabProps) {
  const section = sections.organic;
  const p = section?.payload ?? null;
  if (!p)
    return (
      <SectionCard title="Content" section={section}>
        {() => null}
      </SectionCard>
    );
  const fb = p.facebook;
  const ig = p.instagram;
  const yt = p.youtube;
  const cadenceOf = (name: string) => p.cadence.find(c => c.platform === name);
  const reelC = cadenceOf("Instagram reels");
  const ytC = cadenceOf("YouTube videos");

  return (
    <div className="grid gap-4 lg:gap-6">
      <SectionCard
        kicker="Across Instagram and YouTube, by how far above each platform's normal a post is running"
        title="Performing best"
        section={section}
        notes={p.notes}
        order={0}
      >
        {() => (
          <div className="grid gap-4">
            <Best rows={p.best ?? []} />
            <p className="text-xs text-muted-foreground">
              {`Normal is the median of what was read: ${ig?.normalViews ? `${countCompact(ig.normalViews)} views a reel` : "Instagram not read"}${yt.enabled && yt.normalViewsPerDay ? ` · ${yt.normalViewsPerDay.toFixed(1)} views a day on YouTube` : ""}.`}
            </p>
          </div>
        )}
      </SectionCard>

      <SectionCard
        kicker="@mahara_media · last 28 days"
        title="Instagram"
        section={section}
        order={1}
        actions={
          ig ? (
            <a
              href={`https://www.instagram.com/${ig.username}/`}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-foreground"
              title="Open on Instagram"
            >
              <ExternalLink className="size-4" aria-hidden />
            </a>
          ) : undefined
        }
      >
        {() =>
          ig ? (
            <div className="grid gap-5">
              <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-5">
                <StatTile
                  variant="plain"
                  label="Followers"
                  value={count(ig.followers)}
                />
                <StatTile
                  variant="plain"
                  label="Reach, 28 days"
                  value={na(ig.reach28)}
                  naHint="Meta did not return the 28-day reach on this run."
                />
                <StatTile
                  variant="plain"
                  label="Accounts engaged, 28 days"
                  value={na(ig.engaged28)}
                />
                <StatTile
                  variant="plain"
                  label="Posted, 28 days"
                  value={count(ig.published28)}
                  sub={
                    reelC
                      ? `library: ${count(reelC.last90)} reels in 90 · newest ${reelC.newest ?? "—"}`
                      : undefined
                  }
                  hint="Counted from the live post list. The asset library lags it by days."
                />
                <StatTile
                  variant="plain"
                  label="Posts, all time"
                  value={count(ig.mediaCount)}
                />
              </div>
              <Posts posts={ig.posts} />
            </div>
          ) : (
            <EmptyState
              title="Instagram could not be read"
              text="See the Machine tab for the reason."
              compact
            />
          )
        }
      </SectionCard>

      <SectionCard
        kicker="maharamedia"
        title="YouTube"
        section={section}
        order={2}
        actions={
          yt.enabled ? undefined : (
            <StatusChip tone="warning" label="Not measured yet" />
          )
        }
      >
        {() =>
          yt.enabled ? (
            <div className="grid gap-5">
              <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
                <StatTile
                  variant="plain"
                  label="Subscribers"
                  value={na(yt.subscribers)}
                />
                <StatTile
                  variant="plain"
                  label="Views, all time"
                  value={na(yt.views)}
                />
                <StatTile
                  variant="plain"
                  label="Videos"
                  value={na(yt.videos)}
                />
                <StatTile
                  variant="plain"
                  label="Published, 28 days"
                  value={na(yt.published28)}
                  sub={
                    ytC
                      ? `library: ${count(ytC.last90)} in 90 · newest ${ytC.newest ?? "—"}`
                      : undefined
                  }
                  hint="Counted from the live upload list. The asset library lags it by days."
                />
              </div>
              {yt.recent.length ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  {yt.recent.map(v => (
                    <a
                      key={v.id}
                      href={`https://www.youtube.com/watch?v=${v.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="grid gap-1 rounded-md border p-2 hover:bg-muted/40"
                    >
                      <div className="relative aspect-video w-full overflow-hidden rounded bg-muted">
                        {v.thumbnail ? (
                          <img
                            src={v.thumbnail}
                            alt=""
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        ) : null}
                        {v.multiple !== null && v.multiple >= 1.5 ? (
                          <span className="absolute left-1.5 top-1.5 rounded-full bg-foreground px-1.5 py-0.5 text-[10px] font-bold text-background">
                            {times(v.multiple)}
                          </span>
                        ) : null}
                      </div>
                      <div className="truncate text-xs font-medium" dir="auto">
                        {v.title}
                      </div>
                      <div
                        className="text-xs text-muted-foreground"
                        style={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        {`${countCompact(v.views)} views${v.viewsPerDay !== null ? ` · ${v.viewsPerDay.toFixed(1)} a day` : ""} · ${shortDate(v.at)}`}
                      </div>
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="grid gap-3">
              <EmptyState
                title="YouTube is one switch away"
                text="The YouTube Data API is off in the Google Cloud project behind the cockpit's service account. Enable it and the channel's subscribers, views and recent videos appear on the next refresh."
                icon={Youtube}
                compact
              />
              <a
                href={yt.enableUrl}
                target="_blank"
                rel="noreferrer"
                className="justify-self-start rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"
              >
                Enable the YouTube Data API
              </a>
            </div>
          )
        }
      </SectionCard>

      <SectionCard
        kicker="MaharaMedia page · last 28 days"
        title="Facebook"
        section={section}
        order={3}
        actions={
          fb?.url ? (
            <a
              href={fb.url}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-foreground"
              title="Open on Facebook"
            >
              <ExternalLink className="size-4" aria-hidden />
            </a>
          ) : undefined
        }
      >
        {() =>
          fb ? (
            <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
              <StatTile
                variant="plain"
                label="Followers"
                value={count(fb.followers)}
              />
              <StatTile
                variant="plain"
                label="Page views, 28 days"
                value={na(fb.views28)}
                naHint="Meta returns no insights for this page on the current API version."
              />
              <StatTile
                variant="plain"
                label="Post engagements, 28 days"
                value={na(fb.engagements28)}
              />
              <StatTile
                variant="plain"
                label="New followers, 28 days"
                value={na(fb.newFollowers28)}
              />
            </div>
          ) : (
            <EmptyState
              title="Facebook could not be read"
              text="See the Machine tab for the reason."
              compact
            />
          )
        }
      </SectionCard>
    </div>
  );
}
