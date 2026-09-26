import { useAction } from "convex/react";
import { ArrowUpRight, Radar } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/ceo/EmptyState";
import {
  count,
  countCompact,
  humanize,
  shortDate,
} from "@/components/ceo/format";
import { Kicker } from "@/components/ceo/Kicker";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatTile } from "@/components/ceo/StatTile";
import { StatusChip } from "@/components/ceo/StatusChip";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import { api } from "../../../convex/_generated/api";
import { IdeationPage } from "../IdeationPage";
import type { CeoTabProps } from "./types";

/**
 * Mahara's own ideation board: the people Mahara competes with and learns
 * from, read by the same radar that reads the clients' industry, kept on
 * their own board (`industry = mahara`) so the two never mix.
 *
 * The desk on top is the CEO's view of it: who is watched, who is winning
 * this week and by how much, and one form to add a competitor on any
 * platform. The board underneath is the shared Ideation page pinned to this
 * board, so keeping, dismissing, trends and the scrape box behave exactly as
 * they do for Sabry.
 */

const BOARD = "mahara" as const;
/** Aziz's swipe file on Foreplay; anything saved there lands on this board. */
const FOREPLAY_BOARD = "https://app.foreplay.co/boards/V0Xhnevd47snnHqze5Av";

// biome-ignore lint/suspicious/noExplicitAny: rows come straight from Supabase
type Row = any;

const PLATFORMS: [string, string][] = [
  ["instagram", "Instagram"],
  ["youtube", "YouTube channel"],
  ["tiktok", "TikTok"],
  ["snapchat", "Snapchat"],
];

const platformName = (p: string) =>
  PLATFORMS.find(([k]) => k === p)?.[1]?.replace(" channel", "") ??
  (p === "meta_ads" ? "Meta ad" : p === "google_ads" ? "Google ad" : p);

const num = (x: unknown): number | null => {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : null;
};

const profileUrl = (platform: string, value: string): string => {
  if (/^https?:\/\//i.test(value)) return value;
  const v = value.replace(/^@/, "");
  switch (platform) {
    case "instagram":
      return `https://www.instagram.com/${v}/`;
    case "tiktok":
      return `https://www.tiktok.com/@${v}`;
    case "youtube":
      return `https://www.youtube.com/@${v}/videos`;
    case "snapchat":
      return `https://www.snapchat.com/add/${v}`;
    default:
      return "";
  }
};

/** A list the server sent, or none: a missing or odd reply renders the empty state, never a crash. */
const rowsOf = (x: unknown): Row[] =>
  Array.isArray(x)
    ? x
    : Array.isArray((x as { rows?: unknown } | null)?.rows)
      ? (x as { rows: Row[] }).rows
      : [];

function serverMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  return (
    raw
      .split("\n")[0]
      .replace(/^\[.*?]\s*/, "")
      .trim() || "That did not go through."
  );
}

/** The best outliers on the board right now, biggest multiple of their account's normal first. */
function WinningStrip({ rows }: { rows: Row[] }) {
  if (!rows.length)
    return (
      <EmptyState
        title="Nothing scored yet"
        text="Add the accounts below. A first read lands within minutes; the scan then reads every account each Saturday and proposes what ran three times its normal or more."
        icon={Radar}
        compact
      />
    );
  return (
    <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
      {rows.map((r: Row) => {
        const src = r.still_url || r.thumb_url;
        const mult = num(r.multiplier);
        const hook = r.hook?.text || r.caption || "";
        return (
          <a
            key={r.key}
            href={r.url}
            target="_blank"
            rel="noreferrer"
            className="group w-[168px] shrink-0 rounded-lg bg-muted/40 p-2 transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="relative aspect-[4/5] w-full overflow-hidden rounded-md bg-muted">
              {src ? (
                <img
                  src={src}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                  onError={e => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              ) : null}
              {mult ? (
                <span
                  className="absolute left-2 top-2 rounded-full bg-background/85 px-2 py-0.5 text-xs font-semibold tabular-nums text-foreground backdrop-blur-sm"
                  title="How many times the account's normal views this post reached"
                >
                  {`${mult >= 10 ? Math.round(mult) : mult.toFixed(1)}×`}
                </span>
              ) : null}
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-xs">
              <span className="truncate font-semibold">
                @{r.author_handle || "?"}
              </span>
              <span className="ml-auto shrink-0 text-muted-foreground">
                {platformName(r.platform)}
              </span>
            </div>
            <p
              className="mt-1 line-clamp-2 text-xs text-muted-foreground"
              dir="auto"
            >
              {hook}
            </p>
            <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="tabular-nums">
                {r.views ? `${countCompact(num(r.views))} views` : ""}
              </span>
              <span className="truncate">
                {r.hook_kind ? humanize(String(r.hook_kind)) : ""}
              </span>
            </div>
          </a>
        );
      })}
    </div>
  );
}

export function IdeationTab(_props: CeoTabProps) {
  const listIdeas = useAction(api.ideation.list);
  const countIdeas = useAction(api.ideation.counts);
  const watchlistList = useAction(api.ideation.watchlistList);
  const watchlistAdd = useAction(api.ideation.watchlistAdd);
  const watchlistRemove = useAction(api.ideation.watchlistRemove);
  const requestScrape = useAction(api.ideation.requestScrape);
  const requestsList = useAction(api.ideation.requestsList);

  const [watch, setWatch] = useState<Row[] | null>(null);
  const [proposed, setProposed] = useState<Row[]>([]);
  const [saved, setSaved] = useState<Row[]>([]);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [requests, setRequests] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [platform, setPlatform] = useState("instagram");
  const [value, setValue] = useState("");
  const [readNow, setReadNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [w, p, s, c, rq] = await Promise.all([
        watchlistList({}),
        listIdeas({ tab: "proposed", industry: BOARD, limit: 150 }),
        listIdeas({ tab: "saved", industry: BOARD, limit: 150 }),
        countIdeas({ industry: BOARD }),
        requestsList({ limit: 10 }),
      ]);
      setWatch(rowsOf(w).filter((x: Row) => x.industry === BOARD));
      setProposed(rowsOf(p));
      setSaved(rowsOf(s));
      setCounts(
        c && typeof c === "object" ? (c as Record<string, number>) : null,
      );
      setRequests(rowsOf(rq).filter((r: Row) => r.params?.industry === BOARD));
      setError(null);
    } catch (e) {
      setError(serverMessage(e));
    }
  }, [watchlistList, listIdeas, countIdeas, requestsList]);

  useEffect(() => {
    void load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const winning = useMemo(() => {
    const seen = new Set<string>();
    return [...proposed, ...saved]
      .filter((r: Row) => {
        if (seen.has(r.key) || !(num(r.multiplier) ?? 0)) return false;
        seen.add(r.key);
        return true;
      })
      .sort(
        (a: Row, b: Row) => (num(b.multiplier) ?? 0) - (num(a.multiplier) ?? 0),
      )
      .slice(0, 10);
  }, [proposed, saved]);

  const since30 = Date.now() - 30 * 86_400_000;
  const outliers30 = proposed.filter(
    (r: Row) => Date.parse(r.at ?? "") >= since30,
  );
  const outliersByTarget = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of outliers30)
      if (r.target_key) m.set(r.target_key, (m.get(r.target_key) ?? 0) + 1);
    return m;
  }, [outliers30]);
  const byPlatform = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of watch ?? [])
      m.set(w.platform, (m.get(w.platform) ?? 0) + 1);
    return [...m.entries()]
      .map(([p, n]) => `${n} ${platformName(p)}`)
      .join(" · ");
  }, [watch]);

  async function add() {
    const v = value.trim();
    if (!v) return;
    setBusy(true);
    setNotice(null);
    try {
      await watchlistAdd({
        platform,
        kind: "account",
        value: v,
        industry: BOARD,
      });
      let note = "Added. The scan reads it every Saturday.";
      if (readNow) {
        try {
          await requestScrape({
            kind: "profile",
            input: v,
            platform,
            industry: BOARD,
            watch: true,
            ads: false,
          });
          note =
            "Added, and a first read is queued: its best posts show up here within a few minutes. The scan then reads it every Saturday.";
        } catch (e) {
          note = `Added for the Saturday scan. The first read could not be queued: ${serverMessage(e)}`;
        }
      }
      setValue("");
      setNotice(note);
      await load();
    } catch (e) {
      setNotice(`Not added: ${serverMessage(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const field = "h-9 rounded-md border bg-background px-2 text-sm";

  return (
    <div className="@container grid gap-4 lg:gap-6">
      <SectionCard
        kicker="Mahara B2B"
        title="Competitor desk"
        description="Who we compete with and learn from."
        order={0}
        actions={
          <a
            href={FOREPLAY_BOARD}
            target="_blank"
            rel="noreferrer"
            className="-my-1 inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-[var(--ceo-hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title="The #mahara_b2b swipe file on Foreplay; saves there land on this board"
          >
            Foreplay board
            <ArrowUpRight className="size-3.5" aria-hidden />
          </a>
        }
      >
        {() => (
          <div className="grid gap-6">
            <div className="grid grid-cols-2 gap-x-6 gap-y-6 @xl:grid-cols-4">
              <StatTile
                variant="plain"
                label="Watching"
                value={watch ? count(watch.length) : null}
                naHint="Not loaded yet."
                sub={byPlatform || undefined}
              />
              <StatTile
                variant="plain"
                label="Outliers, 30 days"
                value={count(outliers30.length)}
                hint="Posts the scan proposed in the last thirty days: three times the account's normal views or more."
              />
              <StatTile
                variant="plain"
                label="Saved ideas"
                value={counts ? count(counts.saved ?? 0) : null}
                naHint="Not loaded yet."
              />
              <StatTile
                variant="plain"
                label="Trends"
                value={counts ? count(counts.trends ?? 0) : null}
                naHint="Not loaded yet."
                hint="The same format on three or more accounts inside two weeks."
              />
            </div>

            <div>
              <Kicker className="mb-2">Winning right now</Kicker>
              <WinningStrip rows={winning} />
            </div>

            <div className="grid gap-3 rounded-xl bg-muted/40 p-4">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-sm font-medium">Add a competitor</span>
                <span className="text-xs text-muted-foreground">
                  Any account you want read every week
                </span>
              </div>
              <div className="grid gap-2 @lg:grid-cols-[150px_minmax(0,1fr)_auto]">
                <AnimatedSelect
                  value={platform}
                  onChange={e => setPlatform(e.target.value)}
                  aria-label="Platform"
                  className={field}
                >
                  {PLATFORMS.map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </AnimatedSelect>
                <input
                  value={value}
                  onChange={e => setValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") void add();
                  }}
                  placeholder={
                    platform === "youtube"
                      ? "@handle or channel link"
                      : "@handle"
                  }
                  dir="ltr"
                  aria-label="Account"
                  className={field}
                />
                <Button
                  type="button"
                  disabled={busy || !value.trim()}
                  onClick={() => void add()}
                >
                  {busy ? "Adding…" : "Watch"}
                </Button>
              </div>
              <label
                htmlFor="read-now"
                className="flex items-start gap-2 text-xs text-muted-foreground"
              >
                <input
                  id="read-now"
                  type="checkbox"
                  checked={readNow}
                  onChange={e => setReadNow(e.target.checked)}
                  className="mt-px"
                />
                Read it now as well: its best posts within minutes, not on
                Saturday
              </label>
              {notice ? <p className="text-sm">{notice}</p> : null}
            </div>

            {watch === null ? null : watch.length ? (
              <div className="divide-y text-sm">
                {watch.map((w: Row) => {
                  const url = profileUrl(w.platform, String(w.value ?? ""));
                  const n = outliersByTarget.get(w.key) ?? 0;
                  const status = String(w.last_status ?? "");
                  return (
                    <div
                      key={w.key}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0"
                    >
                      <StatusChip
                        tone="neutral"
                        label={platformName(w.platform)}
                      />
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold hover:underline"
                          dir="ltr"
                        >
                          {/^https?:\/\//i.test(String(w.value))
                            ? String(w.value).replace(
                                /^https?:\/\/(www\.)?/,
                                "",
                              )
                            : `@${w.value}`}
                        </a>
                      ) : (
                        <span className="font-semibold">@{w.value}</span>
                      )}
                      <span
                        className="text-xs text-muted-foreground"
                        style={{ fontVariantNumeric: "tabular-nums" }}
                      >
                        {[
                          num(w.followers)
                            ? `${countCompact(num(w.followers))} followers`
                            : null,
                          num(w.baseline_views)
                            ? `normal ${countCompact(Math.round(num(w.baseline_views) ?? 0))} views`
                            : null,
                          w.last_scanned_at
                            ? `read ${shortDate(w.last_scanned_at)}`
                            : "not read yet",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      {n ? (
                        <StatusChip
                          tone="good"
                          label={`${n} outlier${n === 1 ? "" : "s"} in 30 days`}
                        />
                      ) : null}
                      {status && status !== "ok" ? (
                        <StatusChip tone="warning" label={humanize(status)} />
                      ) : null}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void watchlistRemove({ key: w.key })
                            .then(load)
                            .catch(e => setNotice(serverMessage(e)))
                        }
                        className="ml-auto"
                      >
                        Stop watching
                      </Button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nobody is watched yet. Add the agencies, coaches and channels
                you measure yourself against.
              </p>
            )}

            {requests.length ? (
              <div className="grid gap-1 text-xs text-muted-foreground">
                {requests.slice(0, 5).map((r: Row) => (
                  <div key={r.id} className="break-words">
                    {`${shortDate(r.created_at)} · ${r.kind} ${r.input}: ${r.status}${r.error ? `, ${String(r.error).slice(0, 120)}` : ""}`}
                  </div>
                ))}
              </div>
            ) : null}
            {error ? (
              <p className="text-sm text-[var(--ceo-critical)]">{error}</p>
            ) : null}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="The board"
        description="Proposed by the scan, kept by you, and the trends across them."
        order={1}
      >
        {() => <IdeationPage board={BOARD} embedded />}
      </SectionCard>
    </div>
  );
}
