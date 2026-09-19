import { useAction } from "convex/react";
import {
  ExternalLink,
  Eye,
  ImageOff,
  Keyboard,
  Lightbulb,
  LoaderCircle,
  Radar,
  RefreshCw,
  Search,
  Star,
  TrendingUp,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "../../convex/_generated/api";
import ForeplayLinks from "../components/ForeplayLinks";

/**
 * Ideation.
 *
 * His own library, next to the winning ads. Two ways in: paste a link to any
 * Instagram, TikTok or Snapchat post and the radar fetches it, watches it
 * (speech and on-screen text) and writes the breakdown; or the radar's scan
 * proposes posts that ran far above their account's normal, from our
 * industry and from others, and he keeps or dismisses them. Nothing here is
 * client-private, so the list is not cut by client access, like What works.
 *
 * The rows live in Supabase (the ideation home since 2026-09-17) and are
 * read through actions, so the page refreshes itself: on every filter
 * change, after every action, and once a minute while it is on screen.
 * It never pretends a fetch already happened: a pasted link shows as
 * "Fetching" until the transcript is in, or "Failed" with the reason.
 *
 * Since 2026-09-18: a Trends tab (the same format from three accounts or
 * more inside two weeks, flagged by the radar), a three-frame storyboard
 * instead of one still, keyboard shortcuts (press ? for the list), a Scrape
 * box (any creator or brand page, or the Meta and Google ad libraries; the
 * radar runs it within two minutes), the watchlist editable here, and ads
 * as rows: a paid ad still running after weeks is a proven ad, so ad rows
 * carry "running N days" instead of a multiplier.
 *
 * This file is the same in the creative director and media buyer cockpits.
 */

type Tab = "saved" | "proposed" | "trends" | "working" | "failed" | "dismissed";
const TABS: { key: Tab; label: string }[] = [
  { key: "saved", label: "Saved ideas" },
  { key: "proposed", label: "Proposed by the scan" },
  { key: "trends", label: "Trends" },
  { key: "working", label: "Fetching" },
  { key: "failed", label: "Failed" },
  { key: "dismissed", label: "Dismissed" },
];

type Platform =
  | ""
  | "instagram"
  | "tiktok"
  | "snapchat"
  | "youtube"
  | "facebook"
  | "meta_ads"
  | "google_ads";
const PLATFORM_CHIPS: [Platform, string][] = [
  ["", "All"],
  ["instagram", "Instagram"],
  ["tiktok", "TikTok"],
  ["snapchat", "Snapchat"],
  ["youtube", "YouTube"],
  ["facebook", "Facebook"],
  ["meta_ads", "Meta ads"],
  ["google_ads", "Google ads"],
];
function isAd(r: Row): boolean {
  return r.platform === "meta_ads" || r.platform === "google_ads";
}
type Industry = "" | "ours" | "other";

// biome-ignore lint/suspicious/noExplicitAny: rows come straight from Supabase
type Row = any;

function Pill({
  children,
  tone = "neutral",
  title,
}: {
  children: React.ReactNode;
  tone?: "good" | "warn" | "bad" | "neutral";
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`tone-${tone} rounded-full px-2 py-0.5 text-[11px] font-medium`}
    >
      {children}
    </span>
  );
}

function isStoryboard(r: Row): boolean {
  return typeof r.still_path === "string" && r.still_path.includes(".story.");
}

function TrendPill({ r }: { r: Row }) {
  if (!r.trend_id) return null;
  const n = num(r.trend_n);
  return (
    <Pill
      tone="good"
      title={`${r.trend_label ?? "Trend"}: the same format on ${n ?? "several"} accounts in the last two weeks.`}
    >
      <TrendingUp className="mr-1 inline h-3 w-3" />
      Trend{n ? ` · ${n} accounts` : ""}
    </Pill>
  );
}

const SHORTCUTS: [string, string][] = [
  ["j / k", "next / previous idea"],
  ["Enter", "read it / hide it"],
  ["s", "keep it (a proposal)"],
  ["x", "dismiss, or restore a dismissed one"],
  ["o", "open the post in a new tab"],
  ["/", "search"],
  ["1 to 6", "switch tab"],
  ["?", "this list"],
];

function typingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable ||
    Boolean(el.closest("[role=dialog]"))
  );
}

function n(x: unknown): string {
  const v = typeof x === "string" ? Number(x) : x;
  return typeof v === "number" && Number.isFinite(v)
    ? v.toLocaleString("en-US")
    : "?";
}

function num(x: unknown): number | null {
  const v = typeof x === "string" ? Number(x) : x;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function fmtDay(s: string | null | undefined): string {
  if (!s) return "";
  const t = Date.parse(s);
  return Number.isNaN(t)
    ? s
    : new Date(t).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
      });
}

function fmtWhen(s: string | number | null | undefined): string {
  if (!s) return "";
  const t = typeof s === "number" ? s : Date.parse(s);
  return Number.isNaN(t)
    ? ""
    : new Date(t).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
}

function platformLabel(p: string): string {
  const found = PLATFORM_CHIPS.find(([k]) => k === p);
  if (found?.[0] === "meta_ads") return "Meta ad";
  if (found?.[0] === "google_ads") return "Google ad";
  return found?.[1] ?? p;
}

/** Ads are judged by how long they have run, not by views. */
function runningPill(
  r: Row,
): { text: string; tone: "good" | "warn" | "neutral" } | null {
  if (!isAd(r)) return null;
  const d = num(r.running_days);
  if (d === null) return null;
  const text = `running ${d} day${d === 1 ? "" : "s"}${r.ad_active === false ? ", ended" : ""}`;
  if (r.tier === "reverse_engineer") return { text, tone: "good" };
  if (r.tier === "study") return { text, tone: "warn" };
  return { text, tone: "neutral" };
}

function tierLabel(
  r: Row,
): { text: string; tone: "good" | "warn" | "neutral" } | null {
  const m = num(r.multiplier);
  if (m === null) return null;
  const x = `${m.toFixed(1)}x the account's normal${r.provisional ? ", provisional" : ""}`;
  if (r.tier === "reverse_engineer") return { text: x, tone: "good" };
  if (r.tier === "study") return { text: x, tone: "warn" };
  return { text: x, tone: "neutral" };
}

function statusPill(r: Row) {
  switch (r.status) {
    case "queued":
      return <Pill tone="warn">Queued</Pill>;
    case "fetching":
      return (
        <Pill tone="warn">
          <LoaderCircle className="mr-1 inline h-3 w-3 animate-spin" />
          Fetching
        </Pill>
      );
    case "failed":
      return <Pill tone="bad">Failed</Pill>;
    case "dismissed":
      return <Pill>Dismissed</Pill>;
    case "saved":
      return (
        <Pill tone="good">
          <Star className="mr-1 inline h-3 w-3" />
          Saved
        </Pill>
      );
    default:
      return <Pill>Proposed</Pill>;
  }
}

function serverMessage(e: unknown): string {
  // biome-ignore lint/suspicious/noExplicitAny: ConvexError data is untyped
  const data = (e as any)?.data;
  if (typeof data === "string") return data;
  const msg = String((e as Error)?.message ?? e);
  return msg.replace(/^.*Uncaught Error: /, "").split("\n")[0];
}

/** The post's picture: the cockpit's own copy first (a three-frame storyboard when the radar could fetch the clip), the platform's link second, else a grey box that says why. */
function Thumb({ r }: { r: Row }) {
  const [failed, setFailed] = useState(false);
  const src =
    !failed && (r.still_url || r.thumb_url)
      ? String(r.still_url || r.thumb_url)
      : "";
  const wide = isStoryboard(r) && Boolean(r.still_url) && !failed;
  if (!src) {
    return (
      <div
        className="flex h-14 w-10 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground"
        title={
          r.thumb_url
            ? "The platform's picture link has expired."
            : "No picture for this post."
        }
      >
        <ImageOff className="h-4 w-4" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      title={
        wide ? "Storyboard: start, middle and end of the clip." : undefined
      }
      className={`h-14 shrink-0 rounded object-cover ${wide ? "w-[100px]" : "w-10"}`}
    />
  );
}

/** Lift the whole idea into a doc without retyping it. */
function CopyButton({
  text,
  label = "Copy this idea",
}: {
  text: string;
  label?: string;
}) {
  const [done, setDone] = useState(false);
  if (!text) return null;
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        });
      }}
      className="rounded border px-2 py-0.5 text-[12px] font-semibold text-muted-foreground hover:bg-muted"
    >
      {done ? "Copied" : label}
    </button>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// ---------------------------------------------------------------------------

export function IdeationPage() {
  const [tab, setTab] = useState<Tab>("saved");
  const [platform, setPlatform] = useState<Platform>("");
  const [industry, setIndustry] = useState<Industry>("");
  const [q, setQ] = useState("");
  const qd = useDebounced(q, 300);
  const [sort, setSort] = useState<"newest" | "multiplier">("newest");
  const listIdeas = useAction(api.ideation.list);
  const countIdeas = useAction(api.ideation.counts);
  const [data, setData] = useState<
    { rows: Row[]; capped: boolean } | undefined
  >(undefined);
  const [counts, setCounts] = useState<Record<string, number> | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set());
  const [keepingKey, setKeepingKey] = useState<string | null>(null);
  const [showKeys, setShowKeys] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const dismissIdea = useAction(api.ideation.dismiss);
  const restoreIdea = useAction(api.ideation.restore);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const [d, c] = await Promise.all([
        listIdeas({
          tab,
          platform: platform || undefined,
          industry: industry || undefined,
          q: qd.trim() || undefined,
          limit: 150,
        }),
        countIdeas({}),
      ]);
      if (!alive.current) return;
      setData(d);
      setCounts(c);
      setError(null);
    } catch (e) {
      if (alive.current) setError(serverMessage(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [listIdeas, countIdeas, tab, platform, industry, qd]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Once a minute while the tab is on screen: the radar writes in the background.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 60_000);
    return () => clearInterval(t);
  }, [refresh]);

  const rows = useMemo(() => {
    if (!data) return undefined;
    let out: Row[] = data.rows;
    if (sort === "multiplier")
      out = [...out].sort(
        (a, b) => (num(b.multiplier) ?? 0) - (num(a.multiplier) ?? 0),
      );
    return out;
  }, [data, sort]);

  const countOf = (t: Tab) =>
    counts && typeof counts[t] === "number" ? String(counts[t]) : "";

  const toggleOpen = useCallback((key: string) => {
    setOpenKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Keyboard: j/k move, Enter reads, s keeps, x dismisses or restores, o opens, / searches, 1-6 tabs, ? help.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (typingTarget(e.target)) {
        if (e.key === "Escape" && e.target instanceof HTMLElement)
          e.target.blur();
        return;
      }
      const list = rows ?? [];
      const at = cursor ? list.findIndex((r: Row) => r.key === cursor) : -1;
      const current = at >= 0 ? list[at] : null;
      const move = (delta: number) => {
        if (!list.length) return;
        const idx = Math.max(
          0,
          Math.min(
            list.length - 1,
            (at < 0 ? (delta > 0 ? -1 : list.length) : at) + delta,
          ),
        );
        const key = list[idx].key;
        setCursor(key);
        document
          .querySelector(`[data-idea="${CSS.escape(key)}"]`)
          ?.scrollIntoView({ block: "nearest" });
      };
      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          move(1);
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          move(-1);
          break;
        case "Enter":
          if (current) {
            e.preventDefault();
            toggleOpen(current.key);
          }
          break;
        case "s":
          if (current?.status === "proposed") setKeepingKey(current.key);
          break;
        case "x":
          if (current) {
            const fn =
              current.status === "dismissed"
                ? () => restoreIdea({ key: current.key })
                : () => dismissIdea({ key: current.key });
            void fn()
              .then(async () => {
                toast.success(
                  current.status === "dismissed"
                    ? "Back in the list."
                    : "Dismissed.",
                );
                await refresh();
              })
              .catch(err => toast.error(serverMessage(err)));
          }
          break;
        case "o":
          if (current?.url)
            window.open(String(current.url), "_blank", "noopener");
          break;
        case "/":
          e.preventDefault();
          searchRef.current?.focus();
          break;
        case "?":
          setShowKeys(v => !v);
          break;
        case "Escape":
          setShowKeys(false);
          break;
        default: {
          const n = Number(e.key);
          if (n >= 1 && n <= TABS.length) setTab(TABS[n - 1].key);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, cursor, toggleOpen, refresh, dismissIdea, restoreIdea]);

  const keepingRow = keepingKey
    ? (rows ?? []).find((r: Row) => r.key === keepingKey)
    : undefined;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Lightbulb className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-[15px] font-bold tracking-tight">Ideation</h2>
        <span className="text-[13px] text-muted-foreground">
          {counts
            ? `${countOf("saved")} saved, ${countOf("proposed")} proposed by the scan`
            : "Loading…"}
        </span>
        <button
          type="button"
          onClick={() => void refresh()}
          className="ml-auto rounded border px-2 py-0.5 text-[12px] font-semibold text-muted-foreground hover:bg-muted"
          title="Read the latest from the radar"
        >
          <RefreshCw
            className={`mr-1 inline h-3 w-3 ${busy ? "animate-spin" : ""}`}
          />
          Refresh
        </button>
        <button
          type="button"
          onClick={() => setShowKeys(v => !v)}
          aria-pressed={showKeys}
          className="rounded border px-2 py-0.5 text-[12px] font-semibold text-muted-foreground hover:bg-muted"
          title="Keyboard shortcuts (?)"
        >
          <Keyboard className="mr-1 inline h-3 w-3" />
          Keys
        </button>
      </div>
      {showKeys ? (
        <div className="mb-3 grid grid-cols-2 gap-x-6 gap-y-0.5 rounded-md border bg-muted/30 px-3 py-2 text-[12px] md:grid-cols-4">
          {SHORTCUTS.map(([k, what]) => (
            <div key={k}>
              <kbd className="rounded border bg-background px-1 font-mono text-[11px]">
                {k}
              </kbd>{" "}
              <span className="text-muted-foreground">{what}</span>
            </div>
          ))}
        </div>
      ) : null}
      <p className="mb-3 text-[13px] text-muted-foreground">
        Posts that ran far above their account's normal, from our industry and
        from others, with what they say, what is on screen and why they work.
        Paste a link to add your own; the scan proposes the rest. The winning
        ads we ran ourselves stay on What works.
      </p>

      {error ? (
        <div className="callout-bad mb-3 rounded-md border p-2 text-[13px]">
          {error}
        </div>
      ) : null}

      <ForeplayLinks />
      <PasteBox onDone={refresh} />
      <ScrapeBox onDone={refresh} />
      <WatchlistPanel />

      <div className="mb-3 flex flex-wrap gap-1 border-b">
        {TABS.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-2.5 py-1.5 text-[13px] font-semibold transition ${
              tab === t.key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
            {countOf(t.key) ? (
              <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                {countOf(t.key)}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {PLATFORM_CHIPS.map(([k, label]) => (
            <button
              key={k || "all"}
              type="button"
              onClick={() => setPlatform(k)}
              aria-pressed={platform === k}
              className={`rounded-full border px-2.5 py-0.5 text-[12px] font-semibold ${
                platform === k
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          value={industry}
          onChange={e => setIndustry(e.target.value as Industry)}
          aria-label="Industry"
          className="h-7 rounded-md border bg-background px-2 text-[12px]"
        >
          <option value="">Every industry</option>
          <option value="ours">Our industry</option>
          <option value="other">Other industries</option>
        </select>
        <select
          value={sort}
          onChange={e => setSort(e.target.value as "newest" | "multiplier")}
          aria-label="Sort"
          className="h-7 rounded-md border bg-background px-2 text-[12px]"
        >
          <option value="newest">Newest first</option>
          <option value="multiplier">Biggest outliers first</option>
        </select>
        <div className="ml-auto flex items-center gap-1.5 rounded-md border px-2 py-1">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            ref={searchRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search hooks, captions, transcripts, notes"
            className="w-56 bg-transparent text-[13px] outline-none"
          />
        </div>
      </div>

      {rows === undefined ? (
        <p className="text-[13px] text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{emptyText(tab, q)}</p>
      ) : tab === "trends" ? (
        <TrendGroups
          rows={rows}
          cursor={cursor}
          openKeys={openKeys}
          onToggleOpen={toggleOpen}
          onKeep={setKeepingKey}
          onFocus={setCursor}
          onChanged={refresh}
        />
      ) : (
        <div className="divide-y rounded-lg border">
          {rows.map((r: Row) => (
            <IdeaRow
              key={r.key}
              r={r}
              active={cursor === r.key}
              open={openKeys.has(r.key)}
              onToggleOpen={() => toggleOpen(r.key)}
              onKeep={() => setKeepingKey(r.key)}
              onFocus={() => setCursor(r.key)}
              onChanged={refresh}
            />
          ))}
        </div>
      )}
      {keepingRow ? (
        <KeepDialog
          r={keepingRow}
          onClose={() => setKeepingKey(null)}
          onKept={refresh}
        />
      ) : null}
      {data?.capped ? (
        <p className="mt-2 text-[12px] text-muted-foreground">
          Showing the newest 150. Narrow the filter or search to find older
          ones.
        </p>
      ) : null}
    </div>
  );
}

function emptyText(tab: Tab, q: string): string {
  if (q.trim()) return "No idea here matches that search.";
  switch (tab) {
    case "saved":
      return "Nothing saved yet. Paste an Instagram, TikTok or Snapchat link above, or keep one of the scan's proposals.";
    case "proposed":
      return "Nothing proposed yet. The scan proposes posts doing three times an account's usual views or more; a scrape proposes a page's best videos and its longest running ads.";
    case "trends":
      return "No trend yet. A trend is the same format from three accounts or more inside two weeks; the radar flags them after every scan.";
    case "working":
      return "Nothing is being fetched right now.";
    case "failed":
      return "Nothing has failed.";
    default:
      return "Nothing dismissed.";
  }
}

// ---------------------------------------------------------------------------

function PasteBox({ onDone }: { onDone: () => Promise<void> }) {
  const paste = useAction(api.ideation.paste);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [industry, setIndustry] = useState<"ours" | "other">("other");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "warn" | "bad";
    text: string;
  } | null>(null);

  const submit = async () => {
    const u = url.trim();
    if (!u) return;
    setBusy(true);
    setFeedback(null);
    try {
      await paste({ url: u, note: note.trim() || undefined, industry });
      setUrl("");
      setNote("");
      setFeedback({
        tone: "warn",
        text: "Queued. The radar fetches it and reads it within a few minutes; it shows under Fetching until the transcript is in.",
      });
      await onDone();
    } catch (e) {
      setFeedback({ tone: "bad", text: `Not queued: ${serverMessage(e)}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mb-4 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <Lightbulb className="h-4 w-4" />
        <h3 className="text-[14px] font-bold">Add a post</h3>
        <span className="text-[12px] text-muted-foreground">
          paste the link from Instagram, TikTok or Snapchat
        </span>
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,1fr)_150px_auto]">
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") void submit();
          }}
          placeholder="https://www.instagram.com/reel/…"
          dir="ltr"
          className="rounded border bg-transparent px-2 py-1 text-[13px]"
        />
        <select
          value={industry}
          onChange={e => setIndustry(e.target.value as "ours" | "other")}
          className="rounded border bg-transparent px-2 py-1 text-[13px]"
        >
          <option value="ours">Our industry</option>
          <option value="other">Another industry</option>
        </select>
        <Button
          size="sm"
          onClick={() => void submit()}
          disabled={busy || !url.trim()}
        >
          {busy ? "Queuing…" : "Fetch and save"}
        </Button>
      </div>
      <Textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        dir="auto"
        maxLength={500}
        placeholder="Why it caught your eye (optional). It stays on the idea."
        className="mt-2 min-h-[44px] text-[13px]"
      />
      {feedback ? (
        <div
          className={`callout-${feedback.tone} mt-2 rounded-md border p-2 text-[13px]`}
        >
          {feedback.text}
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------

type ScrapeKind = "profile" | "meta" | "google";

/** Paste any page, or name a page, advertiser or keyword: the radar scrapes it within two minutes. */
function ScrapeBox({ onDone }: { onDone: () => Promise<void> }) {
  const request = useAction(api.ideation.requestScrape);
  const listRequests = useAction(api.ideation.requestsList);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ScrapeKind>("profile");
  const [input, setInput] = useState("");
  const [platform, setPlatform] = useState("");
  const [country, setCountry] = useState("KW");
  const [industry, setIndustry] = useState<"ours" | "other">("other");
  const [client, setClient] = useState("");
  const [watch, setWatch] = useState(true);
  const [ads, setAds] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "warn" | "bad";
    text: string;
  } | null>(null);
  const [requests, setRequests] = useState<Row[] | undefined>(undefined);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const load = useCallback(async () => {
    try {
      const rows = await listRequests({ limit: 12 });
      if (alive.current) setRequests(rows);
    } catch {
      /* the list is a convenience; the board still works */
    }
  }, [listRequests]);
  useEffect(() => {
    if (open) void load();
  }, [open, load]);
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 20_000);
    return () => clearInterval(t);
  }, [open, load]);

  const submit = async () => {
    const value = input.trim();
    if (!value) return;
    setBusy(true);
    setFeedback(null);
    try {
      await request({
        kind: kind === "profile" ? "profile" : "ads",
        input: value,
        platform: kind === "profile" ? platform || undefined : kind,
        country: kind === "profile" ? undefined : country || undefined,
        industry,
        client: client.trim() || undefined,
        watch: kind === "profile" ? watch : undefined,
        ads: kind === "profile" ? ads : undefined,
      });
      setInput("");
      setFeedback({
        tone: "warn",
        text:
          kind === "profile"
            ? "Queued. Within two minutes the radar reads the page, proposes its best videos, watches the account and pulls its current Meta ads."
            : "Queued. Within two minutes the radar pulls the active ads and proposes the ones running a week or more, longest first.",
      });
      await load();
      await onDone();
    } catch (e) {
      setFeedback({ tone: "bad", text: `Not queued: ${serverMessage(e)}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mb-4 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Radar className="h-4 w-4" />
        <h3 className="text-[14px] font-bold">
          Scrape a page or an ad library
        </h3>
        <span className="text-[12px] text-muted-foreground">
          any creator or brand page; or the Meta and Google ad libraries, where
          an ad still running after weeks is a proven one
        </span>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className="ml-auto rounded border px-2 py-0.5 text-[12px] font-semibold text-muted-foreground hover:bg-muted"
        >
          {open ? "Hide" : "Open"}
        </button>
      </div>
      {open ? (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                [
                  "profile",
                  "A page (Instagram, TikTok, YouTube, Facebook, Snapchat)",
                ],
                ["meta", "Meta Ad Library (Facebook and Instagram ads)"],
                ["google", "Google Ads Transparency"],
              ] as [ScrapeKind, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                aria-pressed={kind === k}
                className={`rounded-full border px-2.5 py-0.5 text-[12px] font-semibold ${
                  kind === k
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_150px_130px_auto]">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") void submit();
              }}
              placeholder={
                kind === "profile"
                  ? "https://www.instagram.com/brand/ or @handle with the platform"
                  : kind === "meta"
                    ? "Page name, Instagram handle, page id, or a keyword"
                    : "Advertiser name"
              }
              dir="auto"
              className="rounded border bg-transparent px-2 py-1 text-[13px]"
            />
            {kind === "profile" ? (
              <select
                value={platform}
                onChange={e => setPlatform(e.target.value)}
                aria-label="Platform for a bare handle"
                className="rounded border bg-transparent px-2 py-1 text-[13px]"
              >
                <option value="">Platform (from the link)</option>
                <option value="instagram">Instagram</option>
                <option value="tiktok">TikTok</option>
                <option value="youtube">YouTube</option>
                <option value="facebook">Facebook</option>
                <option value="snapchat">Snapchat</option>
              </select>
            ) : (
              <input
                value={country}
                onChange={e =>
                  setCountry(e.target.value.toUpperCase().slice(0, 2))
                }
                aria-label="Country"
                placeholder="Country (KW)"
                className="rounded border bg-transparent px-2 py-1 text-[13px]"
              />
            )}
            <select
              value={industry}
              onChange={e => setIndustry(e.target.value as "ours" | "other")}
              className="rounded border bg-transparent px-2 py-1 text-[13px]"
            >
              <option value="ours">Our industry</option>
              <option value="other">Another industry</option>
            </select>
            <Button
              size="sm"
              onClick={() => void submit()}
              disabled={busy || !input.trim()}
            >
              {busy ? "Queuing…" : "Scrape"}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[12px] text-muted-foreground">
            <input
              value={client}
              onChange={e => setClient(e.target.value)}
              placeholder="Client it is for (optional)"
              dir="auto"
              className="rounded border bg-transparent px-2 py-0.5 text-[12px]"
            />
            {kind === "profile" ? (
              <>
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={watch}
                    onChange={e => setWatch(e.target.checked)}
                  />
                  watch this account every week
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={ads}
                    onChange={e => setAds(e.target.checked)}
                  />
                  pull its current Meta ads too
                </label>
              </>
            ) : (
              <span>
                TikTok and Snapchat publish no public ad library outside Europe;
                their organic pages still work above.
              </span>
            )}
          </div>
          {feedback ? (
            <div
              className={`callout-${feedback.tone} rounded-md border p-2 text-[13px]`}
            >
              {feedback.text}
            </div>
          ) : null}
          <RequestsList rows={requests} />
        </div>
      ) : null}
    </section>
  );
}

function requestStatus(r: Row): {
  text: string;
  tone: "good" | "warn" | "bad" | "neutral";
} {
  switch (r.status) {
    case "done":
      return { text: "Done", tone: "good" };
    case "running":
      return { text: "Running", tone: "warn" };
    case "failed":
      return { text: "Failed", tone: "bad" };
    default:
      return { text: "Queued", tone: "neutral" };
  }
}

function requestSummary(r: Row): string {
  const res = r.result ?? {};
  if (r.status === "failed") return String(r.error ?? "failed");
  if (r.status !== "done") return "";
  const parts: string[] = [];
  if (r.kind === "profile") {
    if (num(res.posts) !== null) parts.push(`${n(res.posts)} posts read`);
    if (num(res.proposals) !== null) parts.push(`${n(res.proposals)} proposed`);
    if (num(res.ads) !== null) parts.push(`${n(res.ads)} ads`);
    if (res.watched) parts.push("now watched");
  } else {
    if (num(res.ads_seen) !== null) parts.push(`${n(res.ads_seen)} ads seen`);
    if (num(res.proposals) !== null) parts.push(`${n(res.proposals)} proposed`);
    if (num(res.longest_days) !== null)
      parts.push(`longest ${n(res.longest_days)} days`);
    if (res.matched?.name) parts.push(`page: ${res.matched.name}`);
  }
  const w: string[] = Array.isArray(res.warnings) ? res.warnings : [];
  if (w.length) parts.push(w[0]);
  return parts.join(" · ");
}

function RequestsList({ rows }: { rows: Row[] | undefined }) {
  if (!rows) return null;
  if (!rows.length)
    return <p className="text-[12px] text-muted-foreground">No scrapes yet.</p>;
  return (
    <div className="divide-y rounded-md border text-[12px]">
      {rows.map((r: Row) => {
        const st = requestStatus(r);
        return (
          <div
            key={r.id}
            className="flex flex-wrap items-center gap-2 px-2 py-1"
          >
            <Pill tone={st.tone}>{st.text}</Pill>
            <span className="font-semibold">
              {r.kind === "profile"
                ? "Page"
                : r.platform === "google"
                  ? "Google ads"
                  : "Meta ads"}
            </span>
            <span className="truncate" dir="auto" title={r.input}>
              {r.input}
            </span>
            <span className="text-muted-foreground">
              {r.requested_by_name ? `by ${r.requested_by_name} · ` : ""}
              {fmtWhen(r.created_at)}
            </span>
            <span className="basis-full text-muted-foreground" dir="auto">
              {requestSummary(r)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** The accounts, hashtags and keyword searches the Saturday scan reads. */
function WatchlistPanel() {
  const list = useAction(api.ideation.watchlistList);
  const add = useAction(api.ideation.watchlistAdd);
  const remove = useAction(api.ideation.watchlistRemove);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[] | undefined>(undefined);
  const [platform, setPlatform] = useState("instagram");
  const [kind, setKind] = useState("account");
  const [value, setValue] = useState("");
  const [industry, setIndustry] = useState<"ours" | "other">("ours");
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const load = useCallback(async () => {
    try {
      const out = await list({});
      if (alive.current) setRows(out);
    } catch (e) {
      if (alive.current) toast.error(serverMessage(e));
    }
  }, [list]);
  useEffect(() => {
    if (open && rows === undefined) void load();
  }, [open, rows, load]);

  const submit = async () => {
    if (!value.trim()) return;
    setBusy(true);
    try {
      await add({ platform, kind, value: value.trim(), industry });
      setValue("");
      toast.success(
        kind === "search"
          ? "Keyword added. The scan searches it every Saturday."
          : "Added. The scan reads it every Saturday.",
      );
      await load();
    } catch (e) {
      toast.error(serverMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mb-4 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Eye className="h-4 w-4" />
        <h3 className="text-[14px] font-bold">Watchlist</h3>
        <span className="text-[12px] text-muted-foreground">
          what the Saturday scan reads: accounts, hashtags and Instagram keyword
          searches
          {rows ? ` · ${rows.length} entries` : ""}
        </span>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className="ml-auto rounded border px-2 py-0.5 text-[12px] font-semibold text-muted-foreground hover:bg-muted"
        >
          {open ? "Hide" : "Open"}
        </button>
      </div>
      {open ? (
        <div className="mt-2 space-y-2">
          <div className="grid gap-2 md:grid-cols-[130px_150px_minmax(0,1fr)_130px_auto]">
            <select
              value={platform}
              onChange={e => setPlatform(e.target.value)}
              className="rounded border bg-transparent px-2 py-1 text-[13px]"
              aria-label="Platform"
            >
              <option value="instagram">Instagram</option>
              <option value="tiktok">TikTok</option>
              <option value="snapchat">Snapchat</option>
            </select>
            <select
              value={kind}
              onChange={e => setKind(e.target.value)}
              className="rounded border bg-transparent px-2 py-1 text-[13px]"
              aria-label="Kind"
            >
              <option value="account">Account</option>
              <option value="hashtag">Hashtag</option>
              <option value="search">Keyword search</option>
            </select>
            <input
              value={value}
              onChange={e => setValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") void submit();
              }}
              placeholder={
                kind === "account"
                  ? "@handle"
                  : kind === "hashtag"
                    ? "#hashtag"
                    : "keyword, e.g. ديكور الكويت"
              }
              dir="auto"
              className="rounded border bg-transparent px-2 py-1 text-[13px]"
            />
            <select
              value={industry}
              onChange={e => setIndustry(e.target.value as "ours" | "other")}
              className="rounded border bg-transparent px-2 py-1 text-[13px]"
              aria-label="Industry"
            >
              <option value="ours">Our industry</option>
              <option value="other">Another industry</option>
            </select>
            <Button
              size="sm"
              onClick={() => void submit()}
              disabled={busy || !value.trim()}
            >
              {busy ? "Adding…" : "Add"}
            </Button>
          </div>
          {rows === undefined ? (
            <p className="text-[12px] text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">
              Nothing watched yet.
            </p>
          ) : (
            <div className="divide-y rounded-md border text-[12px]">
              {rows.map((w: Row) => (
                <div
                  key={w.key}
                  className="flex flex-wrap items-center gap-2 px-2 py-1"
                >
                  <Pill>{platformLabel(w.platform)}</Pill>
                  <span className="text-muted-foreground">
                    {w.kind === "search" ? "keyword" : w.kind}
                  </span>
                  <span className="font-semibold" dir="auto">
                    {w.kind === "hashtag"
                      ? `#${w.value}`
                      : w.kind === "account"
                        ? `@${w.value}`
                        : w.value}
                  </span>
                  {w.industry === "ours" ? <Pill>Our industry</Pill> : null}
                  <span className="text-muted-foreground">
                    {w.source === "search"
                      ? "found by keyword search"
                      : w.source === "cockpit"
                        ? "added here"
                        : ""}
                    {num(w.followers) ? ` · ${n(w.followers)} followers` : ""}
                    {num(w.baseline_views)
                      ? ` · normal ${n(Math.round(num(w.baseline_views) ?? 0))} views`
                      : ""}
                    {w.last_scanned_at
                      ? ` · read ${fmtDay(w.last_scanned_at)}`
                      : " · not read yet"}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      void remove({ key: w.key })
                        .then(async () => {
                          toast.success("Removed from the watchlist.");
                          await load();
                        })
                        .catch(e => toast.error(serverMessage(e)))
                    }
                    className="ml-auto rounded border px-2 py-0.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

/** The Trends tab: one block per trend, its label on top, the posts under it. */
function TrendGroups({
  rows,
  cursor,
  openKeys,
  onToggleOpen,
  onKeep,
  onFocus,
  onChanged,
}: {
  rows: Row[];
  cursor: string | null;
  openKeys: Set<string>;
  onToggleOpen: (key: string) => void;
  onKeep: (key: string) => void;
  onFocus: (key: string) => void;
  onChanged: () => Promise<void>;
}) {
  const groups: { id: string; label: string; n: number | null; rows: Row[] }[] =
    [];
  for (const r of rows) {
    const id = String(r.trend_id ?? "");
    let g = groups.find(x => x.id === id);
    if (!g) {
      g = {
        id,
        label: String(r.trend_label ?? "Trend"),
        n: num(r.trend_n),
        rows: [],
      };
      groups.push(g);
    }
    g.rows.push(r);
  }
  return (
    <div className="space-y-3">
      {groups.map(g => (
        <section key={g.id} className="rounded-lg border">
          <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-1.5 text-[13px]">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <span className="font-semibold" dir="auto">
              {g.label}
            </span>
            <span className="text-[12px] text-muted-foreground">
              {g.n ? `${g.n} accounts` : ""}
              {g.n ? " · " : ""}
              {g.rows.length} post{g.rows.length === 1 ? "" : "s"} here
            </span>
          </div>
          <div className="divide-y">
            {g.rows.map((r: Row) => (
              <IdeaRow
                key={r.key}
                r={r}
                active={cursor === r.key}
                open={openKeys.has(r.key)}
                onToggleOpen={() => onToggleOpen(r.key)}
                onKeep={() => onKeep(r.key)}
                onFocus={() => onFocus(r.key)}
                onChanged={onChanged}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function IdeaRow({
  r,
  active,
  open,
  onToggleOpen,
  onKeep,
  onFocus,
  onChanged,
}: {
  r: Row;
  active: boolean;
  open: boolean;
  onToggleOpen: () => void;
  onKeep: () => void;
  onFocus: () => void;
  onChanged: () => Promise<void>;
}) {
  const dismiss = useAction(api.ideation.dismiss);
  const restore = useAction(api.ideation.restore);
  const retry = useAction(api.ideation.retry);
  const tier = tierLabel(r);
  const running = runningPill(r);
  const title = r.hook?.text || r.caption || r.url;
  const who =
    r.saved_by_name ??
    r.pasted_by_name ??
    (r.saved_by ? String(r.saved_by).split("@")[0] : "");

  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast.success(done);
      await onChanged();
    } catch (e) {
      toast.error(serverMessage(e));
    }
  };

  return (
    <div data-idea={r.key}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard path is the page-level shortcut handler */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a click only moves the keyboard cursor; every action has its own button */}
      <div
        className={`flex items-start gap-3 px-3 py-2 hover:bg-muted/50 ${active ? "ring-1 ring-inset ring-primary/60 bg-muted/40" : ""}`}
        onClick={onFocus}
      >
        <Thumb r={r} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
            <span className="font-semibold">@{r.author_handle || "?"}</span>
            <Pill>{platformLabel(r.platform)}</Pill>
            <TrendPill r={r} />
            {r.industry === "ours" ? (
              <Pill tone="neutral">Our industry</Pill>
            ) : (
              <Pill>Other industry</Pill>
            )}
            {tier ? <Pill tone={tier.tone}>{tier.text}</Pill> : null}
            {running ? (
              <Pill
                tone={running.tone}
                title="How long this ad has been in the library. Weeks of spend on one creative means it works."
              >
                {running.text}
              </Pill>
            ) : null}
            {r.client ? <Pill title="Our client">{r.client}</Pill> : null}
            {r.packaging_only ? (
              <span
                className="text-[11px] text-muted-foreground"
                title="Under 2,000 followers: this proves packaging, not audience."
              >
                tiny account
              </span>
            ) : null}
            {statusPill(r)}
            {who ? (
              <span className="rounded border px-1 text-[10px] font-semibold text-muted-foreground">
                {r.origin === "manual" ? "Pasted by" : "Kept by"} {who}
              </span>
            ) : null}
          </div>
          <div className="truncate text-[13px]" dir="auto" title={title}>
            {title}
          </div>
          {r.format_label ? (
            <div
              className="truncate text-[12px] text-muted-foreground"
              title="How the video is built, as the radar read it"
            >
              {r.format_label}
              {r.hook_kind && r.hook_kind !== "other"
                ? ` · ${r.hook_kind} hook`
                : ""}
            </div>
          ) : null}
          {r.status === "failed" && r.error ? (
            <div className="text-[12px] txt-bad">{r.error}</div>
          ) : null}
          {(r.saved_note || r.note) && (
            <div
              className="whitespace-pre-wrap text-[12px] text-muted-foreground"
              dir="auto"
            >
              Why it works: {r.saved_note ?? r.note}
            </div>
          )}
        </div>
        <div className="shrink-0 text-right text-[12px] text-muted-foreground">
          {isAd(r) ? (
            <>
              <div className="tabular-nums">
                {r.ad_started_at ? `since ${fmtDay(r.ad_started_at)}` : ""}
                {Array.isArray(r.ad_platforms) && r.ad_platforms.length
                  ? ` · ${r.ad_platforms
                      .map((p: string) => String(p).toLowerCase())
                      .join(", ")}`
                  : ""}
              </div>
              <div className="tabular-nums">
                {num(r.spend) !== null
                  ? `$${n(Math.round(num(r.spend) ?? 0))} spent`
                  : ""}
                {num(r.leads) !== null ? ` · ${n(r.leads)} leads` : ""}
                {num(r.cpl) !== null
                  ? ` · $${(num(r.cpl) ?? 0).toFixed(0)} per lead`
                  : ""}
                {r.ad_format ? ` · ${String(r.ad_format)}` : ""}
              </div>
            </>
          ) : (
            <>
              <div className="tabular-nums">
                {n(r.views)} views · {n(r.likes)} likes
              </div>
              <div>
                {r.posted_at ? `posted ${fmtDay(r.posted_at)}` : ""}
                {num(r.author_followers)
                  ? ` · ${n(r.author_followers)} followers`
                  : ""}
              </div>
            </>
          )}
          <div className="mt-1 flex flex-wrap justify-end gap-1">
            {r.status === "proposed" ? (
              <button
                type="button"
                onClick={onKeep}
                className="rounded border px-2 py-0.5 text-[12px] font-semibold text-muted-foreground hover:bg-muted"
              >
                Keep it
              </button>
            ) : null}
            {r.status === "failed" ? (
              <button
                type="button"
                onClick={() =>
                  void act(() => retry({ key: r.key }), "Queued again.")
                }
                className="rounded border px-2 py-0.5 text-[12px] font-semibold text-muted-foreground hover:bg-muted"
              >
                Try again
              </button>
            ) : null}
            {r.status === "dismissed" ? (
              <button
                type="button"
                onClick={() =>
                  void act(() => restore({ key: r.key }), "Back in the list.")
                }
                className="rounded border px-2 py-0.5 text-[12px] font-semibold text-muted-foreground hover:bg-muted"
              >
                Restore
              </button>
            ) : (
              <button
                type="button"
                onClick={() =>
                  void act(() => dismiss({ key: r.key }), "Dismissed.")
                }
                className="rounded border px-2 py-0.5 text-[12px] font-semibold text-muted-foreground hover:bg-muted"
              >
                Dismiss
              </button>
            )}
            <a
              href={r.url}
              target="_blank"
              rel="noreferrer"
              className="rounded border px-2 py-0.5 text-[12px] font-semibold text-muted-foreground hover:bg-muted"
            >
              <ExternalLink className="mr-1 inline h-3 w-3" />
              Open
            </a>
            <button
              type="button"
              onClick={onToggleOpen}
              className="rounded border px-2 py-0.5 text-[12px] font-semibold text-muted-foreground hover:bg-muted"
            >
              {open ? "Hide" : "Read it"}
            </button>
          </div>
        </div>
      </div>
      {open ? <IdeaDetail keyId={r.key} onChanged={onChanged} /> : null}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

function IdeaDetail({
  keyId,
  onChanged,
}: {
  keyId: string;
  onChanged: () => Promise<void>;
}) {
  const detail = useAction(api.ideation.detail);
  const [r, setR] = useState<Row | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    detail({ key: keyId })
      .then(row => {
        if (live) setR(row);
      })
      .catch(e => {
        if (live) {
          setR(null);
          toast.error(serverMessage(e));
        }
      });
    return () => {
      live = false;
    };
  }, [detail, keyId]);
  if (r === undefined)
    return (
      <p className="px-3 py-2 text-[13px] text-muted-foreground">Loading…</p>
    );
  if (!r) return null;
  const osd: { at_sec?: number; text?: string }[] = Array.isArray(
    r.on_screen_text,
  )
    ? r.on_screen_text
    : [];
  const beats: { beat?: string; summary?: string; from_sec?: number }[] =
    Array.isArray(r.beats) ? r.beats : [];
  const conf = r.confidence ?? {};
  const adaptations: string[] = Array.isArray(r.adaptations)
    ? r.adaptations
    : [];
  const warnings: string[] = Array.isArray(r.warnings) ? r.warnings : [];
  const tags: string[] = Array.isArray(r.tags) ? r.tags : [];
  const copy = [
    r.hook?.text ? `HOOK: ${r.hook.text}` : "",
    r.transcript ? `SCRIPT: ${r.transcript}` : "",
    osd.length ? `ON SCREEN: ${osd.map(o => o.text).join(" / ")}` : "",
    r.why_it_works ? `WHY IT WORKS: ${r.why_it_works}` : "",
    r.transferable ? `FOR OUR CLIENTS: ${r.transferable}` : "",
    adaptations.length
      ? `IDEAS: ${adaptations.map((a, i) => `${i + 1}. ${a}`).join(" ")}`
      : "",
    `LINK: ${r.url}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const notCaptured = r.status !== "saved" || !r.captured_at;
  return (
    <div className="space-y-3 border-t bg-muted/30 px-3 py-3 text-[13px]">
      {isStoryboard(r) && r.still_url ? (
        <img
          src={String(r.still_url)}
          alt="Storyboard: start, middle and end of the clip"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="max-h-56 rounded border"
        />
      ) : null}
      {r.trend_id || r.format_label ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <TrendPill r={r} />
          {r.format_label ? (
            <span className="text-[12px] text-muted-foreground">
              {r.format_label}
              {r.topic ? ` · ${r.topic}` : ""}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {[
          r.format,
          r.voice,
          r.language,
          r.dialect,
          r.cta ? `CTA: ${r.cta}` : "",
          ...tags,
        ]
          .filter(
            (x: unknown): x is string => typeof x === "string" && x.length > 0,
          )
          .map((t: string) => (
            <span key={t} className="rounded border px-1.5 py-0.5 text-[11px]">
              {t}
            </span>
          ))}
        {num(r.duration_sec) !== null ? (
          <span className="rounded border px-1.5 py-0.5 text-[11px]">
            {Math.round(num(r.duration_sec) ?? 0)}s
          </span>
        ) : null}
      </div>
      {notCaptured ? (
        <p className="text-muted-foreground">
          {r.status === "proposed"
            ? "Keep it and the radar fetches the video, reads what is said and what is on screen, and writes the breakdown here."
            : r.status === "failed"
              ? `Not read: ${r.error ?? "unknown reason"}.`
              : "The radar is fetching this post. The transcript lands here when it is done."}
        </p>
      ) : null}
      {r.caption ? (
        <Field label="Caption">
          <div className="whitespace-pre-wrap" dir="auto">
            {r.caption}
          </div>
        </Field>
      ) : null}
      {r.hook?.text ? (
        <Field label={`Hook${r.hook.type ? ` (${r.hook.type})` : ""}`}>
          <div dir="auto">{r.hook.text}</div>
        </Field>
      ) : null}
      {r.transcript ? (
        <Field
          label={`What is said${conf.transcript ? ` (${conf.transcript} confidence)` : ""}`}
        >
          <div className="whitespace-pre-wrap" dir="auto">
            {r.transcript}
          </div>
        </Field>
      ) : r.captured_at ? (
        <Field label="What is said">
          <div className="text-muted-foreground">
            Nobody speaks in this one.
          </div>
        </Field>
      ) : null}
      {osd.length ? (
        <Field
          label={`What is on screen${conf.on_screen_text ? ` (${conf.on_screen_text} confidence)` : ""}`}
        >
          <ul className="space-y-0.5">
            {osd.map((o, i) => (
              <li key={`${o.at_sec}-${i}`} dir="auto">
                <span className="tabular-nums text-muted-foreground">
                  {typeof o.at_sec === "number" ? `${o.at_sec}s ` : ""}
                </span>
                {o.text}
              </li>
            ))}
          </ul>
        </Field>
      ) : null}
      {beats.length ? (
        <Field label="Structure">
          <ol className="space-y-0.5">
            {beats.map((b, i) => (
              <li key={`${b.beat}-${i}`}>
                <span className="font-semibold">{b.beat}</span>
                {typeof b.from_sec === "number" ? (
                  <span className="tabular-nums text-muted-foreground">
                    {" "}
                    {b.from_sec}s
                  </span>
                ) : null}
                : {b.summary}
              </li>
            ))}
          </ol>
        </Field>
      ) : null}
      {r.why_it_works ? (
        <Field label="Why it works">
          <div className="whitespace-pre-wrap">{r.why_it_works}</div>
        </Field>
      ) : null}
      {r.transferable ? (
        <Field label="For our clients">
          <div className="whitespace-pre-wrap">{r.transferable}</div>
        </Field>
      ) : null}
      {adaptations.length ? (
        <Field label="Ideas to adapt">
          <ol className="list-decimal space-y-0.5 pl-5">
            {adaptations.map(a => (
              <li key={a}>{a}</li>
            ))}
          </ol>
        </Field>
      ) : null}
      <Field label="Numbers">
        <div className="tabular-nums">
          {n(r.views)} views · {n(r.likes)} likes · {n(r.comments)} comments ·{" "}
          {n(r.shares)} shares
          {num(r.saves) !== null ? ` · ${n(r.saves)} saves` : ""}
          {num(r.baseline_views) !== null
            ? ` · account's normal ${n(Math.round(num(r.baseline_views) ?? 0))} views over ${r.baseline_n ?? "?"} posts${r.baseline_floored ? " (floored)" : ""}`
            : ""}
          {r.scanned_at
            ? ` · counted ${fmtDay(r.scanned_at)}`
            : r.captured_at
              ? ` · counted ${fmtDay(r.captured_at)}`
              : ""}
        </div>
      </Field>
      {warnings.length ? (
        <div className="callout-warn rounded p-2 text-[12px]">
          {warnings.join(" ")}
        </div>
      ) : null}
      <NoteEditor
        keyId={r.key}
        note={r.saved_note ?? r.note ?? ""}
        onSaved={onChanged}
      />
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
        <CopyButton text={copy} label="Copy this idea" />
        {r.saved_at ? <span>Saved {fmtWhen(r.saved_at)}</span> : null}
        {r.method?.breakdown ? (
          <span>Read by {String(r.method.breakdown)}</span>
        ) : null}
      </div>
    </div>
  );
}

function NoteEditor({
  keyId,
  note,
  onSaved,
}: {
  keyId: string;
  note: string;
  onSaved: () => Promise<void>;
}) {
  const setNote = useAction(api.ideation.setNote);
  const [value, setValue] = useState(note);
  const [saved, setSaved] = useState(false);
  return (
    <Field label="Your note">
      <div className="flex flex-col gap-1 md:flex-row md:items-start">
        <Textarea
          value={value}
          onChange={e => setValue(e.target.value)}
          dir="auto"
          maxLength={500}
          rows={2}
          placeholder="What to take from it, which client it fits, the hook to try."
          className="min-h-[44px] text-[13px]"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={value === note}
          onClick={() =>
            void setNote({ key: keyId, note: value })
              .then(async () => {
                setSaved(true);
                setTimeout(() => setSaved(false), 1800);
                await onSaved();
              })
              .catch(e => toast.error(serverMessage(e)))
          }
        >
          {saved ? "Saved" : "Save note"}
        </Button>
      </div>
    </Field>
  );
}

/** Keep a proposal: the radar then fetches the video and writes the breakdown. */
function KeepDialog({
  r,
  onClose,
  onKept,
}: {
  r: Row;
  onClose: () => void;
  onKept: () => Promise<void>;
}) {
  const keep = useAction(api.ideation.keep);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await keep({ key: r.key, note: note.trim() || undefined });
      toast.success("Kept. The radar is fetching the transcript.");
      onClose();
      await onKept();
    } catch (e) {
      toast.error(serverMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle dir="auto">Keep this post</DialogTitle>
          <DialogDescription className="text-xs">
            It moves to Saved ideas, and the radar fetches the video, reads what
            is said and what is on screen, and writes the breakdown. Takes a few
            minutes.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded border bg-muted/30 px-3 py-2 text-[13px]">
          <div className="font-semibold">
            @{r.author_handle} on {platformLabel(r.platform)}
          </div>
          <div className="tabular-nums text-muted-foreground">
            {n(r.views)} views
            {num(r.multiplier) !== null
              ? `, ${(num(r.multiplier) ?? 0).toFixed(1)}x the account's normal of ${n(Math.round(num(r.baseline_views) ?? 0))}`
              : ""}
          </div>
          <div className="mt-1 truncate" dir="auto">
            {r.caption || r.url}
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="keep-note">Why it works (optional)</Label>
          <Textarea
            id="keep-note"
            value={note}
            onChange={e => setNote(e.target.value)}
            dir="auto"
            rows={3}
            maxLength={500}
            placeholder="The hook, the contrast, the way it opens. One or two lines."
          />
          <div className="text-right text-[11px] text-muted-foreground">
            {note.length}/500
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? "Saving…" : "Keep it"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
