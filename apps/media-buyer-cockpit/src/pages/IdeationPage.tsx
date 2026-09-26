import { useAction } from "convex/react";
import {
  ArrowUpRight,
  Ellipsis,
  Eye,
  ImageOff,
  Keyboard,
  Link2,
  LoaderCircle,
  Radar,
  RefreshCw,
  Search,
  Star,
  TrendingUp,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AnimatedSelect } from "@/components/ui/animated-select";
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
import ForeplayLinks from "../components/Foreplay";

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
type Industry = "" | "ours" | "other" | "mahara";
/** The three boards that share the tables; "" on the filter means every client board. */
type Board = "ours" | "other" | "mahara";
const BOARD_LABEL: Record<Board, string> = {
  ours: "Our industry",
  other: "Another industry",
  mahara: "Mahara B2B",
};
/**
 * The three boards as options. Called, not rendered as a component: the
 * cockpit's select reads its options straight off its children, and a
 * component in between left the choice blank.
 */
function boardOptions() {
  return (
    <>
      <option value="ours">{BOARD_LABEL.ours}</option>
      <option value="other">{BOARD_LABEL.other}</option>
      <option value="mahara">{BOARD_LABEL.mahara}</option>
    </>
  );
}

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
      className={`tone-${tone} inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium`}
    >
      {children}
    </span>
  );
}

/** The quiet button rows and panels use; a form keeps one teal primary. */
const QUIET =
  "inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50";
/** The same, for the one action a row is waiting on (keep, retry, restore). */
const QUIET_STRONG =
  "inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50";
/** A square icon button; 40px on a touch screen. */
const ICON_BUTTON =
  "inline-flex size-8 items-center justify-center rounded-lg border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground pointer-coarse:size-10";
/** Filter chips: teal when on, quiet when off. */
const CHIP =
  "inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors";
const chipTone = (on: boolean) =>
  on
    ? "border-primary/40 bg-primary/15 text-foreground"
    : "text-muted-foreground hover:bg-muted hover:text-foreground";
/** A chip row that scrolls sideways on a phone instead of wrapping. */
const SCROLL_ROW =
  "flex flex-nowrap items-center gap-1.5 overflow-x-auto [scrollbar-width:none] sm:flex-wrap [&::-webkit-scrollbar]:hidden";
/** Text fields in the add-ideas panel. */
const FIELD =
  "h-9 w-full min-w-0 rounded-lg border bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const MENU_ITEM =
  "flex h-9 w-full items-center gap-2 whitespace-nowrap rounded-lg px-3 text-left text-sm text-foreground hover:bg-muted pointer-coarse:h-10";

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
      return <Pill>Queued</Pill>;
    case "fetching":
      return (
        <Pill>
          <LoaderCircle className="size-3 animate-spin" aria-hidden />
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
          <Star className="size-3" aria-hidden />
          Saved
        </Pill>
      );
    default:
      return <Pill>Proposed</Pill>;
  }
}

/** The status each tab already says, so its rows do not repeat it. */
const TAB_STATUS: Partial<Record<Tab, string>> = {
  saved: "saved",
  proposed: "proposed",
  failed: "failed",
  dismissed: "dismissed",
};

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
        <ImageOff className="size-4" aria-hidden />
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
      className={QUIET}
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

export function IdeationPage({
  board,
  embedded = false,
}: {
  /** Pin the page to one board (the CEO cockpit pins "mahara"): the industry choice disappears and every form defaults to it. */
  board?: Board;
  /** Inside another screen: no title, no watchlist panel; the host shows its own. */
  embedded?: boolean;
} = {}) {
  const [tab, setTab] = useState<Tab>("saved");
  const [platform, setPlatform] = useState<Platform>("");
  const [industry, setIndustry] = useState<Industry>(board ?? "");
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
        countIdeas({ industry: industry || undefined }),
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
      <header
        className={`${embedded ? "mb-4" : "mb-6"} flex flex-wrap items-end justify-between gap-3`}
      >
        <div className="min-w-0">
          {embedded ? null : (
            <h1 className="text-2xl font-semibold tracking-tight">Ideation</h1>
          )}
          <p
            className={`${embedded ? "" : "mt-1 "}text-sm text-muted-foreground`}
          >
            {counts
              ? `${countOf("saved")} saved, ${countOf("proposed")} proposed by the scan`
              : "Loading…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            className={QUIET}
            title="Read the latest from the radar"
          >
            <RefreshCw
              className={`size-3.5 ${busy ? "animate-spin" : ""}`}
              aria-hidden
            />
            Refresh
          </button>
          {/* Shortcuts need a keyboard: no button for them on a touch screen. */}
          <button
            type="button"
            onClick={() => setShowKeys(v => !v)}
            aria-pressed={showKeys}
            className={`${QUIET} pointer-coarse:hidden`}
            title="Keyboard shortcuts (?)"
          >
            <Keyboard className="size-3.5" aria-hidden />
            Keys
          </button>
        </div>
      </header>
      {showKeys ? (
        <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1 rounded-xl bg-muted/40 p-4 text-xs md:grid-cols-4">
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

      {error ? (
        <div className="callout-bad mb-4 rounded-xl border px-4 py-3 text-sm">
          {error}
        </div>
      ) : null}

      {/* Every way into the board in one panel, so the list comes first. */}
      <AddIdeas
        hint={
          embedded
            ? "Paste a link, scrape a page or an ad library, or look in Foreplay"
            : "Paste a link, scrape a page or an ad library, the watchlist, Foreplay"
        }
      >
        <p className="px-4 py-4 text-sm text-muted-foreground sm:px-6">
          {board === "mahara"
            ? "Posts from the people Mahara competes with and learns from that ran far above their account's normal, with what they say, what is on screen and why they work. Paste a link to add your own; the Saturday scan proposes the rest, and anything saved to the #mahara_b2b board on Foreplay lands here too."
            : "Posts that ran far above their account's normal, from our industry and from others, with what they say, what is on screen and why they work. Paste a link to add your own; the scan proposes the rest. The winning ads we ran ourselves stay on What works."}
        </p>
        <PasteBox onDone={refresh} board={board} />
        <ScrapeBox onDone={refresh} board={board} />
        {embedded ? null : <WatchlistPanel />}
        <div className="px-4 py-4 sm:px-6">
          <ForeplayLinks flat />
        </div>
      </AddIdeas>

      <div className="mb-4 border-b">
        <div className="flex flex-nowrap gap-1 overflow-x-auto [scrollbar-width:none] sm:flex-wrap [&::-webkit-scrollbar]:hidden">
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-pressed={tab === t.key}
              className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                tab === t.key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
              {countOf(t.key) ? (
                <span className="ml-1.5 text-xs font-normal tabular-nums text-muted-foreground">
                  {countOf(t.key)}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 grid gap-3">
        <div role="group" aria-label="Platform" className={SCROLL_ROW}>
          {PLATFORM_CHIPS.map(([k, label]) => (
            <button
              key={k || "all"}
              type="button"
              onClick={() => setPlatform(k)}
              aria-pressed={platform === k}
              className={`${CHIP} ${chipTone(platform === k)}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {board ? null : (
            <AnimatedSelect
              value={industry}
              onChange={e => setIndustry(e.target.value as Industry)}
              aria-label="Industry"
            >
              <option value="">Every client industry</option>
              <option value="ours">Our industry</option>
              <option value="other">Other industries</option>
              <option value="mahara">Mahara B2B</option>
            </AnimatedSelect>
          )}
          <AnimatedSelect
            value={sort}
            onChange={e => setSort(e.target.value as "newest" | "multiplier")}
            aria-label="Sort"
          >
            <option value="newest">Newest first</option>
            <option value="multiplier">Biggest outliers first</option>
          </AnimatedSelect>
          <div className="flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border px-3 sm:ml-auto sm:w-[22rem]">
            <Search
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <input
              ref={searchRef}
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search hooks, captions, transcripts, notes"
              aria-label="Search ideas"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </div>
        </div>
      </div>

      {rows === undefined ? (
        <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
          Reading the board
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          {emptyText(tab, q)}
        </p>
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
        <div className="divide-y rounded-2xl border bg-card [&>div:first-child]:rounded-t-2xl [&>div:last-child]:rounded-b-2xl">
          {rows.map((r: Row) => (
            <IdeaRow
              key={r.key}
              r={r}
              tab={tab}
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
        <p className="mt-3 text-xs text-muted-foreground">
          Showing the newest 150. Narrow the filter or search to find older
          ones.
        </p>
      ) : null}
    </div>
  );
}

const ADD_IDEAS_KEY = "ideation-add-ideas";

/**
 * Pasting, scraping, the watchlist and Foreplay, folded into one panel above
 * the list. Open or closed is remembered on this device.
 */
function AddIdeas({
  hint,
  children,
}: {
  hint: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(ADD_IDEAS_KEY) === "open";
    } catch {
      return false;
    }
  });
  return (
    <details
      open={open}
      onToggle={e => {
        const next = e.currentTarget.open;
        setOpen(next);
        try {
          localStorage.setItem(ADD_IDEAS_KEY, next ? "open" : "closed");
        } catch {
          /* Storage may be off: the panel just starts closed next time. */
        }
      }}
      className="mb-6 rounded-2xl border bg-card"
    >
      <summary className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-4 py-3 sm:px-6">
        <span className="text-[15px] font-semibold">Add ideas</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </summary>
      <div className="divide-y border-t">{children}</div>
    </details>
  );
}

function emptyText(tab: Tab, q: string): string {
  if (q.trim()) return "No idea here matches that search.";
  switch (tab) {
    case "saved":
      return "Nothing saved yet. Paste an Instagram, TikTok, Snapchat, YouTube or Facebook link above, or keep one of the scan's proposals.";
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

function PasteBox({
  onDone,
  board,
}: {
  onDone: () => Promise<void>;
  board?: Board;
}) {
  const paste = useAction(api.ideation.paste);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [industry, setIndustry] = useState<Board>(board ?? "other");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "good" | "bad";
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
        tone: "good",
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
    <section className="px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <Link2 className="size-4 text-muted-foreground" aria-hidden />
        <h3 className="text-sm font-semibold">Add a post</h3>
        <span className="text-xs text-muted-foreground">
          paste a link from Instagram, TikTok, Snapchat, YouTube or Facebook
        </span>
      </div>
      <div
        className={`mt-3 grid gap-2 text-sm ${board ? "md:grid-cols-[minmax(0,1fr)_auto]" : "md:grid-cols-[minmax(0,1fr)_170px_auto]"}`}
      >
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") void submit();
          }}
          placeholder="https://www.instagram.com/reel/…"
          aria-label="Link to the post"
          dir="ltr"
          className={FIELD}
        />
        {board ? null : (
          <AnimatedSelect
            value={industry}
            onChange={e => setIndustry(e.target.value as Board)}
            aria-label="Which board it goes on"
            className="w-full"
          >
            {boardOptions()}
          </AnimatedSelect>
        )}
        <Button onClick={() => void submit()} disabled={busy || !url.trim()}>
          {busy ? "Queuing…" : "Fetch and save"}
        </Button>
      </div>
      <Textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        dir="auto"
        maxLength={500}
        placeholder="Why it caught your eye (optional). It stays on the idea."
        className="mt-2 min-h-[44px] text-sm"
      />
      {feedback ? (
        <div
          className={`callout-${feedback.tone} mt-3 rounded-xl border px-3 py-2 text-sm`}
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
function ScrapeBox({
  onDone,
  board,
}: {
  onDone: () => Promise<void>;
  board?: Board;
}) {
  const request = useAction(api.ideation.requestScrape);
  const listRequests = useAction(api.ideation.requestsList);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ScrapeKind>("profile");
  const [input, setInput] = useState("");
  const [platform, setPlatform] = useState("");
  const [country, setCountry] = useState("KW");
  const [industry, setIndustry] = useState<Board>(board ?? "other");
  const [client, setClient] = useState("");
  const [watch, setWatch] = useState(true);
  const [ads, setAds] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "good" | "bad";
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
        tone: "good",
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
    <section className="px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Radar className="size-4 text-muted-foreground" aria-hidden />
        <h3 className="text-sm font-semibold">
          Scrape a page or an ad library
        </h3>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className={`${QUIET} ml-auto`}
        >
          {open ? "Hide" : "Open"}
        </button>
        <p className="basis-full text-xs text-muted-foreground">
          Any creator or brand page, or the Meta and Google ad libraries, where
          an ad still running after weeks is a proven one.
        </p>
      </div>
      {open ? (
        <div className="mt-3 space-y-3">
          <div role="group" aria-label="What to scrape" className={SCROLL_ROW}>
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
                className={`${CHIP} ${chipTone(kind === k)}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="grid gap-2 text-sm md:grid-cols-[minmax(0,1fr)_170px_150px_auto]">
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
              aria-label="What to scrape"
              dir="auto"
              className={FIELD}
            />
            {kind === "profile" ? (
              <AnimatedSelect
                value={platform}
                onChange={e => setPlatform(e.target.value)}
                aria-label="Platform for a bare handle"
                className="w-full"
              >
                <option value="">Platform (from the link)</option>
                <option value="instagram">Instagram</option>
                <option value="tiktok">TikTok</option>
                <option value="youtube">YouTube</option>
                <option value="facebook">Facebook</option>
                <option value="snapchat">Snapchat</option>
              </AnimatedSelect>
            ) : (
              <input
                value={country}
                onChange={e =>
                  setCountry(e.target.value.toUpperCase().slice(0, 2))
                }
                aria-label="Country"
                placeholder="Country (KW)"
                className={FIELD}
              />
            )}
            {board ? null : (
              <AnimatedSelect
                value={industry}
                onChange={e => setIndustry(e.target.value as Board)}
                aria-label="Which board it goes on"
                className="w-full"
              >
                {boardOptions()}
              </AnimatedSelect>
            )}
            <Button
              variant="outline"
              onClick={() => void submit()}
              disabled={busy || !input.trim()}
            >
              {busy ? "Queuing…" : "Scrape"}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            <input
              value={client}
              onChange={e => setClient(e.target.value)}
              placeholder="Client it is for (optional)"
              aria-label="Client it is for"
              dir="auto"
              className="h-8 w-full min-w-0 rounded-lg border bg-transparent px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-56"
            />
            {kind === "profile" ? (
              <>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={watch}
                    onChange={e => setWatch(e.target.checked)}
                  />
                  Watch this account every week
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={ads}
                    onChange={e => setAds(e.target.checked)}
                  />
                  Pull its current Meta ads too
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
              className={`callout-${feedback.tone} rounded-xl border px-3 py-2 text-sm`}
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
      return { text: "Running", tone: "neutral" };
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
    return <p className="text-xs text-muted-foreground">No scrapes yet.</p>;
  return (
    <div className="divide-y rounded-xl bg-muted/40 text-xs">
      {rows.map((r: Row) => {
        const st = requestStatus(r);
        const summary = requestSummary(r);
        return (
          <div
            key={r.id}
            className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2"
          >
            <Pill tone={st.tone}>{st.text}</Pill>
            <span className="font-medium">
              {r.kind === "profile"
                ? "Page"
                : r.platform === "google"
                  ? "Google ads"
                  : "Meta ads"}
            </span>
            <span className="min-w-0 truncate" dir="auto" title={r.input}>
              {r.input}
            </span>
            <span className="text-muted-foreground">
              {r.requested_by_name ? `by ${r.requested_by_name} · ` : ""}
              {fmtWhen(r.created_at)}
            </span>
            {summary ? (
              <span className="basis-full text-muted-foreground" dir="auto">
                {summary}
              </span>
            ) : null}
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
  const [industry, setIndustry] = useState<Board>("ours");
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
    <section className="px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Eye className="size-4 text-muted-foreground" aria-hidden />
        <h3 className="text-sm font-semibold">Watchlist</h3>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className={`${QUIET} ml-auto`}
        >
          {open ? "Hide" : "Open"}
        </button>
        <p className="basis-full text-xs text-muted-foreground">
          What the Saturday scan reads: accounts, hashtags and Instagram keyword
          searches{rows ? `, ${rows.length} entries` : ""}.
        </p>
      </div>
      {open ? (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2 text-sm md:grid-cols-[140px_160px_minmax(0,1fr)_150px_auto]">
            <AnimatedSelect
              value={platform}
              onChange={e => setPlatform(e.target.value)}
              className="w-full"
              aria-label="Platform"
            >
              <option value="instagram">Instagram</option>
              <option value="tiktok">TikTok</option>
              <option value="snapchat">Snapchat</option>
              <option value="youtube">YouTube channel</option>
            </AnimatedSelect>
            <AnimatedSelect
              value={kind}
              onChange={e => setKind(e.target.value)}
              className="w-full"
              aria-label="Kind"
            >
              <option value="account">Account</option>
              <option value="hashtag">Hashtag</option>
              <option value="search">Keyword search</option>
            </AnimatedSelect>
            <input
              value={value}
              onChange={e => setValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") void submit();
              }}
              placeholder={
                kind === "account"
                  ? platform === "youtube"
                    ? "@handle or channel link"
                    : "@handle"
                  : kind === "hashtag"
                    ? "#hashtag"
                    : "keyword, e.g. ديكور الكويت"
              }
              aria-label="Account, hashtag or keyword"
              dir="auto"
              className={FIELD}
            />
            <AnimatedSelect
              value={industry}
              onChange={e => setIndustry(e.target.value as Board)}
              className="w-full"
              aria-label="Industry"
            >
              {boardOptions()}
            </AnimatedSelect>
            <Button
              variant="outline"
              onClick={() => void submit()}
              disabled={busy || !value.trim()}
            >
              {busy ? "Adding…" : "Add"}
            </Button>
          </div>
          {rows === undefined ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
              Reading the watchlist
            </p>
          ) : rows.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nothing watched yet.
            </p>
          ) : (
            <div className="divide-y rounded-xl bg-muted/40 text-xs">
              {rows.map((w: Row) => (
                <div
                  key={w.key}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2"
                >
                  <Pill>{platformLabel(w.platform)}</Pill>
                  <span className="text-muted-foreground">
                    {w.kind === "search" ? "keyword" : w.kind}
                  </span>
                  <span className="font-medium" dir="auto">
                    {w.kind === "hashtag"
                      ? `#${w.value}`
                      : w.kind === "account"
                        ? `@${w.value}`
                        : w.value}
                  </span>
                  {w.industry === "ours" ? (
                    <Pill>Our industry</Pill>
                  ) : w.industry === "mahara" ? (
                    <Pill>Mahara B2B</Pill>
                  ) : null}
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
                    className={`${QUIET} ml-auto`}
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
    <div className="space-y-4">
      {groups.map(g => (
        <section key={g.id} className="rounded-2xl border bg-card">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-t-2xl border-b bg-muted/30 px-4 py-2.5 text-sm">
            <TrendingUp
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span className="font-semibold" dir="auto">
              {g.label}
            </span>
            <span className="text-xs text-muted-foreground">
              {g.n ? `${g.n} accounts` : ""}
              {g.n ? " · " : ""}
              {g.rows.length} post{g.rows.length === 1 ? "" : "s"} here
            </span>
          </div>
          <div className="divide-y [&>div:last-child]:rounded-b-2xl">
            {g.rows.map((r: Row) => (
              <IdeaRow
                key={r.key}
                r={r}
                tab="trends"
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

/** Who posted it, where, and whose it is, as one quiet line of text. */
function metaParts(r: Row, who: string): { text: string; title?: string }[] {
  return [
    { text: platformLabel(r.platform) },
    {
      text:
        r.industry === "ours"
          ? "Our industry"
          : r.industry === "mahara"
            ? "Mahara B2B"
            : "Other industry",
    },
    ...(r.client ? [{ text: `for ${r.client}`, title: "Our client" }] : []),
    ...(r.packaging_only
      ? [
          {
            text: "tiny account",
            title:
              "Under 2,000 followers: this proves packaging, not audience.",
          },
        ]
      : []),
    ...(who
      ? [{ text: `${r.origin === "manual" ? "Pasted by" : "Kept by"} ${who}` }]
      : []),
  ];
}

/** A small menu for a row's less used actions. Closes on a pick, a click outside or Escape. */
function RowMenu({
  label,
  children,
}: {
  label: string;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className={ICON_BUTTON}
      >
        <Ellipsis className="size-4" aria-hidden />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute top-full left-0 z-10 mt-1 grid min-w-44 gap-0.5 rounded-xl border bg-card p-1 text-left sm:right-0 sm:left-auto"
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

function IdeaRow({
  r,
  tab,
  active,
  open,
  onToggleOpen,
  onKeep,
  onFocus,
  onChanged,
}: {
  r: Row;
  tab: Tab;
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
  // Ads are judged by how long they ran, posts by the multiplier: one chip.
  const score = running ?? tier;
  // The tab already says saved, proposed, failed or dismissed.
  const showStatus = TAB_STATUS[tab] !== r.status;
  // On the Trends tab the group above already names the trend.
  const showTrend = Boolean(r.trend_id) && tab !== "trends";
  const title = r.hook?.text || r.caption || r.url;
  const who =
    r.saved_by_name ??
    r.pasted_by_name ??
    (r.saved_by ? String(r.saved_by).split("@")[0] : "");
  const meta = metaParts(r, who);

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
        className={`flex flex-wrap items-start gap-3 rounded-t-[inherit] px-4 py-3 last:rounded-b-[inherit] hover:bg-muted/40 sm:flex-nowrap ${active ? "bg-muted/40 ring-1 ring-inset ring-primary/60" : ""}`}
        onClick={onFocus}
      >
        <Thumb r={r} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">
              @{r.author_handle || "?"}
            </span>
            <span className="min-w-0 text-xs text-muted-foreground">
              {meta.map((m, i) => (
                <span key={m.text} title={m.title}>
                  {i ? " · " : ""}
                  {m.text}
                </span>
              ))}
            </span>
          </div>
          <div
            className="mt-0.5 line-clamp-2 break-words text-sm"
            dir="auto"
            title={title}
          >
            {title}
          </div>
          {showStatus || score || showTrend ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {showStatus ? statusPill(r) : null}
              {score ? (
                <Pill
                  tone={score.tone}
                  title={
                    running
                      ? "How long this ad has been in the library. Weeks of spend on one creative means it works."
                      : undefined
                  }
                >
                  {score.text}
                </Pill>
              ) : null}
              {showTrend ? <TrendPill r={r} /> : null}
            </div>
          ) : null}
          {r.format_label ? (
            <div
              className="mt-1 truncate text-xs text-muted-foreground"
              title="How the video is built, as the radar read it"
            >
              {r.format_label}
              {r.hook_kind && r.hook_kind !== "other"
                ? ` · ${r.hook_kind} hook`
                : ""}
            </div>
          ) : null}
          {r.status === "failed" && r.error ? (
            <div className="mt-1 text-xs txt-bad">{r.error}</div>
          ) : null}
          {(r.saved_note || r.note) && (
            <div
              className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground"
              dir="auto"
            >
              Why it works: {r.saved_note ?? r.note}
            </div>
          )}
        </div>
        <div className="flex basis-full flex-col gap-2 text-xs text-muted-foreground sm:max-w-[45%] sm:shrink-0 sm:basis-auto sm:items-end sm:text-right">
          <div className="space-y-0.5">
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
          </div>
          <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
            {r.status === "proposed" ? (
              <button type="button" onClick={onKeep} className={QUIET_STRONG}>
                Keep it
              </button>
            ) : null}
            {r.status === "failed" ? (
              <button
                type="button"
                onClick={() =>
                  void act(() => retry({ key: r.key }), "Queued again.")
                }
                className={QUIET_STRONG}
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
                className={QUIET_STRONG}
              >
                Restore
              </button>
            ) : null}
            <button
              type="button"
              onClick={onToggleOpen}
              aria-expanded={open}
              className={QUIET}
            >
              {open ? "Hide" : "Read it"}
            </button>
            <RowMenu label={`More for @${r.author_handle || "this post"}`}>
              {close => (
                <>
                  {r.status === "dismissed" ? null : (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        close();
                        void act(() => dismiss({ key: r.key }), "Dismissed.");
                      }}
                      className={MENU_ITEM}
                    >
                      Dismiss
                    </button>
                  )}
                  <a
                    role="menuitem"
                    href={r.url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={close}
                    className={MENU_ITEM}
                  >
                    Open the post
                    <ArrowUpRight className="ml-auto size-3.5" aria-hidden />
                  </a>
                </>
              )}
            </RowMenu>
          </div>
        </div>
      </div>
      {open ? <IdeaDetail keyId={r.key} onChanged={onChanged} /> : null}
    </div>
  );
}

function Field({
  label,
  note,
  children,
}: {
  label: string;
  /** A qualifier after the label, in plain case: "high confidence". */
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
        {label}
        {note ? (
          <span className="ml-1.5 font-sans normal-case tracking-normal">
            {note}
          </span>
        ) : null}
      </div>
      <div className="mt-1">{children}</div>
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
      <p className="flex items-center gap-2 border-t px-4 py-3 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" aria-hidden />
        Reading the breakdown
      </p>
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
  // How it is made, as one quiet line rather than a wall of chips.
  const traits = [
    r.format,
    r.voice,
    r.language,
    r.dialect,
    r.cta ? `CTA: ${r.cta}` : "",
    ...tags,
    num(r.duration_sec) !== null
      ? `${Math.round(num(r.duration_sec) ?? 0)}s`
      : "",
  ].filter((x: unknown): x is string => typeof x === "string" && x.length > 0);
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
    <div className="space-y-4 rounded-b-[inherit] border-t bg-muted/30 px-4 py-4 text-sm">
      {isStoryboard(r) && r.still_url ? (
        <img
          src={String(r.still_url)}
          alt="Storyboard: start, middle and end of the clip"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="max-h-56 rounded-lg border"
        />
      ) : null}
      {/* The row above already shows the trend and the format. */}
      {r.topic || traits.length ? (
        <p className="text-xs text-muted-foreground">
          {[r.topic ? `Topic: ${r.topic}` : "", ...traits]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}
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
        <Field label="Hook" note={r.hook.type || undefined}>
          <div dir="auto">{r.hook.text}</div>
        </Field>
      ) : null}
      {r.transcript ? (
        <Field
          label="What is said"
          note={conf.transcript ? `${conf.transcript} confidence` : undefined}
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
          label="On screen"
          note={
            conf.on_screen_text
              ? `${conf.on_screen_text} confidence`
              : undefined
          }
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
        <div className="callout-warn rounded-xl border px-3 py-2 text-xs">
          {warnings.join(" ")}
        </div>
      ) : null}
      <NoteEditor
        keyId={r.key}
        note={r.saved_note ?? r.note ?? ""}
        onSaved={onChanged}
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
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
      <div className="flex flex-col gap-2 md:flex-row md:items-start">
        <Textarea
          value={value}
          onChange={e => setValue(e.target.value)}
          dir="auto"
          maxLength={500}
          rows={2}
          placeholder="What to take from it, which client it fits, the hook to try."
          className="min-h-[44px] text-sm"
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
        <div className="rounded-xl bg-muted/40 p-3 text-sm">
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
          <div className="text-right text-xs tabular-nums text-muted-foreground">
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
