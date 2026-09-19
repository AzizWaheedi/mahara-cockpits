import { ExternalLink, Youtube } from "lucide-react";
import { EmptyState } from "@/components/ceo/EmptyState";
import { count, countCompact, shortDate } from "@/components/ceo/format";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatTile } from "@/components/ceo/StatTile";
import { StatusChip } from "@/components/ceo/StatusChip";
import type { OrganicPayload } from "../../../convex/ceo/payloads";
import type { CeoTabProps } from "./types";

/**
 * Mahara's own organic presence, one card per platform. Nothing on this tab is
 * an ad number: it is what people saw and did without being paid to.
 */

const na = (v: number | null) => (v === null ? "—" : countCompact(v));

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
          className="group grid gap-1 rounded-md border p-2 hover:bg-muted/40"
        >
          {p.thumbnail ? (
            <img
              src={p.thumbnail}
              alt=""
              loading="lazy"
              className="aspect-square w-full rounded object-cover"
              onError={e => {
                e.currentTarget.style.display = "none";
              }}
            />
          ) : (
            <div className="aspect-square w-full rounded bg-muted" />
          )}
          <div
            className="flex items-center justify-between text-xs"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            <span>{`♥ ${count(p.likes)} · ${count(p.comments)}`}</span>
            <span className="text-muted-foreground">{shortDate(p.at)}</span>
          </div>
          {p.caption ? (
            <div className="truncate text-xs text-muted-foreground">
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
      <SectionCard title="Organic" section={section}>
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
        kicker="@mahara_media · last 28 days"
        title="Instagram"
        section={section}
        notes={p.notes}
        order={0}
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
        kicker="MaharaMedia page · last 28 days"
        title="Facebook"
        section={section}
        order={1}
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
                  value={ytC ? count(ytC.last28) : "—"}
                  sub={
                    ytC
                      ? `${count(ytC.last90)} in 90 · newest ${ytC.newest ?? "—"}`
                      : undefined
                  }
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
                      {v.thumbnail ? (
                        <img
                          src={v.thumbnail}
                          alt=""
                          loading="lazy"
                          className="aspect-video w-full rounded object-cover"
                        />
                      ) : null}
                      <div className="truncate text-xs font-medium">
                        {v.title}
                      </div>
                      <div
                        className="text-xs text-muted-foreground"
                        style={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        {`${countCompact(v.views)} views · ${shortDate(v.at)}`}
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
              {ytC ? (
                <p className="text-xs text-muted-foreground">
                  {`What is known meanwhile, from the asset library: ${count(ytC.last28)} videos published in 28 days, ${count(ytC.last90)} in 90, newest ${ytC.newest ?? "—"}.`}
                </p>
              ) : null}
            </div>
          )
        }
      </SectionCard>
    </div>
  );
}
