import { useAction } from "convex/react";
import {
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Facebook,
  Images,
  Instagram,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
  Send,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { api } from "../../convex/_generated/api";
import { AccountsPicker } from "../components/social/Accounts";
import { Captions } from "../components/social/Captions";
import { useConfirm } from "../components/social/Confirm";
import {
  ASPECTS,
  type Aspect,
  formatOf,
  itemsOf,
  type Job,
  LOOKS,
  type Look,
  type MediaItem,
  PLATFORMS,
  type Platform,
  REEL,
  useUploader,
} from "../components/social/media";
import { DraftMedia, MediaEditor } from "../components/social/PostMedia";
import { References, useLibrary } from "../components/social/References";
import { ShapePicker } from "../components/social/ShapePicker";

/**
 * Social media: one client's month, as a calendar.
 *
 * The calendar is the plan. There is no mix to set and no plan to approve
 * before anything appears -- Aziz said he did not know what the mix
 * meant, which is a fair verdict on four steps that each asked a question
 * before showing a single post. Now: pick the client, press "Fill the
 * month" and the empty days fill with finished drafts, or click a day and
 * write one. Everything about a post opens beside the calendar.
 *
 * Cells are 4:5, the shape of an Instagram post, so a planned month reads
 * as the client's feed laid onto a calendar. The pictures are the colour;
 * the chrome around them stays quiet on purpose.
 */

type Client = {
  taskId: string;
  name: string;
  active: boolean;
  pillars: string[];
  postsPerMonth: number | null;
  dialect: string | null;
  ghlLocationId: string | null;
  platforms: Platform[];
  look?: Look;
  autoApprove: boolean;
  publishing: boolean;
  publishingSince: string | null;
  page: {
    id: string;
    name: string | null;
    igUserId: string | null;
    igUsername: string | null;
  } | null;
};

type Post = {
  id: string;
  pillar: string;
  topic: string | null;
  slides: number;
  caption: string | null;
  caption_facebook: string | null;
  images: string[] | null;
  media: MediaItem[] | null;
  refs: string[] | null;
  platforms: Platform[] | null;
  aspect: Aspect | null;
  scheduled_at: string | null;
  status: string;
  error: string | null;
  client_status: "sent" | "approved" | "changes" | "changed" | null;
  client_note: string | null;
  client_sent_at: string | null;
  client_decided_at: string | null;
  client_reviewer: string | null;
  review_token: string | null;
  published: {
    instagram?: { id: string; permalink?: string | null; at: string };
    facebook?: { id: string; at: string };
  } | null;
  publish_error: string | null;
  results: {
    instagram?: Record<string, number | null>;
    facebook?: Record<string, number | null>;
  } | null;
};

type Health = { check: string; detail: string | null; at: string };

type Sheet =
  | { mode: "post"; id: string }
  | { mode: "new"; day: string }
  | { mode: "settings" }
  | { mode: "signoff" }
  | null;

/** Mahara's week runs Saturday to Thursday, so the row does too. */
const WEEK = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];

function monthOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function shift(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  return monthOf(new Date(y, m - 1 + by, 1));
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function days(month: string): { day: string; n: number }[] {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => ({
    day: `${month}-${String(i + 1).padStart(2, "0")}`,
    n: i + 1,
  }));
}

/** Blank cells before the 1st, for a Saturday-first row. */
function lead(month: string): number {
  const [y, m] = month.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0 = Sunday
  return (dow + 1) % 7;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

type State =
  | "posted"
  | "approved"
  | "client"
  | "changes"
  | "changed"
  | "attention"
  | "ready"
  | "drafting";

function stateOf(p: Post): State {
  if (p.status === "published") return "posted";
  if (p.client_status === "changes") return "changes";
  if (p.error) return "attention";
  if (p.client_status === "changed") return "changed";
  if (p.client_status === "sent" || p.status === "with_client") return "client";
  if (p.client_status === "approved") return "approved";
  if (p.caption && itemsOf(p).length > 0) return "ready";
  return "drafting";
}

/**
 * Each state's dot, its full name (the post sheet) and a short one (the
 * legend over the calendar and the day's list). The order is the
 * legend's: what needs a hand first, what is out last.
 */
const STATE: Record<State, { label: string; short: string; dot: string }> = {
  attention: {
    label: "Needs attention",
    short: "Needs attention",
    dot: "var(--destructive)",
  },
  changes: {
    label: "Client asked for a change",
    short: "Change asked",
    dot: "var(--warning)",
  },
  changed: {
    label: "Changed after the client approved it",
    short: "Changed since approval",
    dot: "var(--warning)",
  },
  drafting: {
    label: "Drafting",
    short: "Drafting",
    dot: "var(--muted-foreground)",
  },
  ready: { label: "Ready", short: "Ready", dot: "var(--primary)" },
  client: {
    label: "With the client",
    short: "With the client",
    dot: "var(--info)",
  },
  approved: {
    label: "Client approved",
    short: "Approved",
    dot: "var(--success)",
  },
  posted: { label: "Posted", short: "Posted", dot: "var(--success)" },
};

const LEGEND = Object.keys(STATE) as State[];

/** A picked option (a pillar, a platform, a look): teal, never white. */
const CHOSEN = "border-primary bg-primary/10 text-foreground";

/** The picked segment of a two- or three-way switch. */
const SEGMENT_ON =
  "bg-primary/15 text-foreground ring-1 ring-inset ring-primary/40";
const SEGMENT_OFF =
  "text-muted-foreground hover:bg-muted hover:text-foreground";

/** The cover a post shows at a glance: a picture, or a video's cover. */
function stillOf(p: Post): { still: string | null; frame: string | null } {
  const lead = itemsOf(p)[0];
  if (!lead) return { still: null, frame: null };
  if (lead.kind === "image") return { still: lead.url, frame: null };
  return lead.cover
    ? { still: lead.cover, frame: null }
    : { still: null, frame: lead.url };
}

/** Finished enough to show the client: pictures and words, not yet out. */
function showable(p: Post): boolean {
  return (
    itemsOf(p).length > 0 &&
    Boolean(p.caption?.trim()) &&
    p.status !== "published"
  );
}

function message(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  const m = /Uncaught Error: ([^\n]+)/.exec(raw);
  return (
    (m ? m[1] : raw).replace(/\s+at .*$/s, "").trim() || "That did not work."
  );
}

export function SocialCalendarPage() {
  const roster = useAction(api.social.roster);
  const batch = useAction(api.social.batch);
  const fill = useAction(api.social.fillMonth);
  const move = useAction(api.social.schedulePost);
  const activate = useAction(api.social.setActive);

  const [clients, setClients] = useState<Client[] | null>(null);
  const [clientId, setClientId] = useState<string>(() => {
    try {
      return window.localStorage.getItem("social:client") ?? "";
    } catch {
      return "";
    }
  });
  const [month, setMonth] = useState(() => monthOf(new Date()));
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [health, setHealth] = useState<Health[]>([]);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [filling, setFilling] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  // The day a phone lists under the calendar, the way the iPhone's own
  // Calendar does. Nothing here on a tablet or a laptop, where the cells
  // are big enough to show the posts themselves.
  const [picked, setPicked] = useState<string | null>(null);
  const agenda = useRef<HTMLElement>(null);

  const loadClients = useCallback(async () => {
    const out = (await roster({})) as { clients: Client[] };
    const list = out.clients ?? [];
    setClients(list);
    setClientId(cur => {
      if (cur && list.some(c => c.taskId === cur && c.active)) return cur;
      return list.find(c => c.active)?.taskId ?? "";
    });
  }, [roster]);

  const loadMonth = useCallback(async () => {
    if (!clientId) return;
    const out = (await batch({
      clientTaskId: clientId,
      month,
    })) as unknown as { posts: Post[]; jobs?: Job[]; health?: Health[] };
    setPosts(out.posts ?? []);
    setJobs(out.jobs ?? []);
    setHealth(out.health ?? []);
  }, [batch, clientId, month]);

  useEffect(() => {
    void loadClients();
  }, [loadClients]);

  useEffect(() => {
    setPosts(null);
    void loadMonth();
    try {
      if (clientId) window.localStorage.setItem("social:client", clientId);
    } catch {
      // Private browsing: the choice is simply not remembered.
    }
  }, [loadMonth, clientId]);

  // While anything is still being written or drawn, look again, so a fill
  // lands on the calendar in front of whoever pressed it. Every ten
  // seconds and only while the tab is on screen: captions take seconds and
  // pictures minutes, so faster buys nothing, and every look is a paid
  // function call -- on 2026-09-23 Convex disabled the media buyer's
  // deployment for going over its plan, and a background tab polling all
  // afternoon is exactly how that happens. "Anything" is the queue itself
  // now, so a post nobody asked pictures for no longer polls forever.
  const working = filling > Date.now() || jobs.length > 0;
  useEffect(() => {
    if (!working) return;
    const tick = () => {
      if (document.visibilityState === "visible") void loadMonth();
    };
    const t = window.setInterval(tick, 10_000);
    // Coming back to the tab catches up straight away, not a tick later.
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [working, loadMonth]);

  const client = clients?.find(c => c.taskId === clientId) ?? null;
  const byDay = useMemo(() => {
    const m = new Map<string, Post[]>();
    for (const p of posts ?? []) {
      const d = String(p.scheduled_at ?? "").slice(0, 10);
      if (d) m.set(d, [...(m.get(d) ?? []), p]);
    }
    return m;
  }, [posts]);

  // How many posts sit in each state: the legend over the calendar.
  const byState = useMemo(() => {
    const c = Object.fromEntries(LEGEND.map(s => [s, 0])) as Record<
      State,
      number
    >;
    for (const p of posts ?? []) c[stateOf(p)]++;
    return c;
  }, [posts]);

  const want = client?.postsPerMonth ?? 12;
  const open = Math.max(0, want - (posts?.length ?? 0));

  async function fillMonth() {
    if (!clientId) return;
    setBusy(true);
    try {
      const out = (await fill({ clientTaskId: clientId, month })) as {
        filling: number;
      };
      setFilling(Date.now() + 3 * 60_000);
      toast.success(
        `Writing ${out.filling} ${out.filling === 1 ? "post" : "posts"}. They appear on their days as they are ready.`,
      );
      await loadMonth();
    } catch (e) {
      toast.error(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function drop(day: string) {
    const id = dragging;
    setDragging(null);
    if (!id) return;
    const p = posts?.find(x => x.id === id);
    if (!p || String(p.scheduled_at ?? "").slice(0, 10) === day) return;
    if (day < today()) {
      toast.error("That day has already been. Pick one still to come.");
      return;
    }
    setPosts(cur =>
      (cur ?? []).map(x =>
        x.id === id ? { ...x, scheduled_at: `${day}T07:00:00Z` } : x,
      ),
    );
    try {
      await move({ postId: id, when: `${day}T07:00:00Z` });
    } catch (e) {
      toast.error(message(e));
      await loadMonth();
    }
  }

  if (clients === null)
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <LoaderCircle className="h-4 w-4 animate-spin" />
        Loading the calendar
      </div>
    );

  const active = clients.filter(c => c.active);
  const others = clients.filter(c => !c.active);

  // The day listed under the calendar on a phone: the one tapped, else
  // today when it is in this month, else the month's first post, else
  // the 1st.
  const inMonth = (d: string | null): d is string =>
    Boolean(d?.startsWith(`${month}-`));
  const firstPostDay = [...byDay.keys()].filter(inMonth).sort()[0] ?? null;
  const focusDay = inMonth(picked)
    ? picked
    : inMonth(today())
      ? today()
      : (firstPostDay ?? `${month}-01`);
  const anyShowable = (posts ?? []).some(showable);

  return (
    <div className="mx-auto w-full max-w-[1180px]">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          {/* biome-ignore lint/a11y/noLabelWithoutControl: The custom control renders a button inside this label. */}
          <label className="relative inline-flex max-w-full items-center">
            <span className="sr-only">Client</span>
            <AnimatedSelect
              value={clientId}
              onChange={async e => {
                const id = e.target.value;
                const c = clients.find(x => x.taskId === id);
                // Picking a client who is not on the package yet puts
                // them on it: that is the only reason to pick them here.
                if (c && !c.active) {
                  try {
                    await activate({ clientTaskId: id, active: true });
                    await loadClients();
                  } catch (err) {
                    toast.error(message(err));
                    return;
                  }
                }
                setClientId(id);
                setSheet(null);
              }}
              className="text-[15px] font-medium"
            >
              {!active.length ? <option value="">Pick a client</option> : null}
              {active.map(c => (
                <option key={c.taskId} value={c.taskId}>
                  {c.name}
                </option>
              ))}
              {others.length ? (
                <optgroup label="Add a client">
                  {others.map(c => (
                    <option key={c.taskId} value={c.taskId}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </AnimatedSelect>
          </label>
          <div className="mt-2 flex items-center gap-1">
            <h1 className="mr-1 text-2xl font-semibold tracking-tight sm:text-[28px] sm:leading-9">
              {monthLabel(month)}
            </h1>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous month"
              onClick={() => setMonth(shift(month, -1))}
              className="size-9 text-muted-foreground"
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next month"
              onClick={() => setMonth(shift(month, 1))}
              className="size-9 text-muted-foreground"
            >
              <ChevronRight />
            </Button>
            {month !== monthOf(new Date()) ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMonth(monthOf(new Date()))}
                className="text-muted-foreground"
              >
                Today
              </Button>
            ) : null}
          </div>
        </div>

        {client ? (
          <div className="flex flex-wrap items-center gap-2">
            {!client.autoApprove ? (
              <Button
                variant="outline"
                size="sm"
                disabled={!anyShowable}
                title={
                  anyShowable
                    ? undefined
                    : "Nothing is finished yet: a post needs its pictures and a caption"
                }
                onClick={() => setSheet({ mode: "signoff" })}
                className="disabled:pointer-events-auto"
              >
                <Send />
                Send to the client
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSheet({ mode: "settings" })}
            >
              <SlidersHorizontal />
              Client setup
            </Button>
            <Button
              size="sm"
              disabled={busy || open === 0}
              onClick={() => void fillMonth()}
              title={
                open === 0
                  ? "The month already has every post it needs"
                  : undefined
              }
              className="disabled:pointer-events-auto"
            >
              {busy ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
              Fill the month
            </Button>
          </div>
        ) : null}
      </header>

      {client && posts ? (
        <div className="mb-4 space-y-2">
          {posts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing planned yet. {client.name} gets {want} posts a month.
            </p>
          ) : (
            // What each dot on the calendar means, with how many posts
            // are in that state. States with nothing in them stay out.
            <ul
              aria-label="Where this month's posts stand"
              className="flex flex-wrap gap-1.5"
            >
              {LEGEND.filter(s => byState[s] > 0).map(s => (
                <li
                  key={s}
                  className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium"
                >
                  <span
                    aria-hidden
                    className="size-1.5 rounded-full"
                    style={{ background: STATE[s].dot }}
                  />
                  {STATE[s].short}
                  <span className="tabular-nums text-muted-foreground">
                    {byState[s]}
                  </span>
                </li>
              ))}
              {open ? (
                <li className="inline-flex items-center rounded-full border border-dashed px-2 py-0.5 text-xs text-muted-foreground">
                  {open} still to plan
                </li>
              ) : null}
            </ul>
          )}
          {health.map(h => (
            <p
              key={h.check}
              className="txt-bad flex items-start gap-1.5 text-xs"
            >
              <TriangleAlert className="mt-px size-3.5 shrink-0" />
              {h.detail}
            </p>
          ))}
          {!client.page ? (
            <p className="txt-warn flex items-start gap-1.5 text-xs">
              <TriangleAlert className="mt-px size-3.5 shrink-0" />
              <span>
                Not linked to its Instagram and Facebook yet.{" "}
                <button
                  type="button"
                  onClick={() => setSheet({ mode: "settings" })}
                  className="no-touch relative font-medium underline underline-offset-2 after:absolute after:-inset-2 after:content-['']"
                >
                  Link it in Client setup
                </button>
              </span>
            </p>
          ) : null}
        </div>
      ) : null}

      {!client ? (
        <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          Pick a client above to open their month.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-7 gap-1 sm:gap-1.5 md:gap-2">
            {WEEK.map(d => (
              <div
                key={d}
                className="pb-1 text-center text-xs font-medium text-muted-foreground sm:text-left"
              >
                {d}
              </div>
            ))}
            {Array.from({ length: lead(month) }, (_, i) => (
              <div key={`b${i}`} />
            ))}
            {days(month).map(({ day, n }) => (
              <DayCell
                key={day}
                day={day}
                n={n}
                posts={byDay.get(day) ?? []}
                past={day < today()}
                isToday={day === today()}
                selected={day === focusDay}
                dragging={dragging}
                loading={posts === null}
                onOpen={id => setSheet({ mode: "post", id })}
                onAdd={() => setSheet({ mode: "new", day })}
                onSelect={() => {
                  setPicked(day);
                  // The list under the calendar can sit just below the
                  // fold on a phone: bring it up by as little as it takes.
                  window.requestAnimationFrame(() => {
                    const el = agenda.current;
                    if (!el || el.offsetParent === null) return;
                    if (
                      el.getBoundingClientRect().top <
                      window.innerHeight - 96
                    )
                      return;
                    el.scrollIntoView({
                      block: "nearest",
                      behavior: window.matchMedia(
                        "(prefers-reduced-motion: reduce)",
                      ).matches
                        ? "auto"
                        : "smooth",
                    });
                  });
                }}
                onDragStart={setDragging}
                onDrop={() => void drop(day)}
              />
            ))}
          </div>

          <DayAgenda
            ref={agenda}
            day={focusDay}
            posts={byDay.get(focusDay) ?? []}
            loading={posts === null}
            onOpen={id => setSheet({ mode: "post", id })}
            onAdd={() => setSheet({ mode: "new", day: focusDay })}
          />
        </>
      )}

      {sheet && client ? (
        <SheetFrame onClose={() => setSheet(null)}>
          {sheet.mode === "settings" ? (
            <SettingsSheet
              client={client}
              onChanged={loadClients}
              onClose={() => setSheet(null)}
            />
          ) : sheet.mode === "signoff" ? (
            <SignoffSheet
              client={client}
              month={month}
              posts={posts ?? []}
              onChanged={loadMonth}
              onClose={() => setSheet(null)}
            />
          ) : sheet.mode === "new" ? (
            <NewPost
              client={client}
              day={sheet.day}
              month={month}
              onCreated={async id => {
                await loadMonth();
                setSheet(id ? { mode: "post", id } : null);
              }}
              onClose={() => setSheet(null)}
            />
          ) : (
            <PostSheet
              post={posts?.find(p => p.id === sheet.id) ?? null}
              client={client}
              jobs={jobs.filter(j => j.post_id === sheet.id)}
              onChanged={loadMonth}
              onClose={() => setSheet(null)}
            />
          )}
        </SheetFrame>
      ) : null}
    </div>
  );
}

/**
 * One day of the month.
 *
 * A phone shows the date and a dot per post, and a tap picks the day so
 * its posts are listed under the calendar: at 390px a day is 48px wide,
 * too small for a picture and words. From the small tablet size up the
 * cell is the post's picture, as before: a tap opens the post, and a day
 * with more than one post lists them all from its "+N".
 */
function DayCell({
  day,
  n,
  posts,
  past,
  isToday,
  selected,
  dragging,
  loading,
  onOpen,
  onAdd,
  onSelect,
  onDragStart,
  onDrop,
}: {
  day: string;
  n: number;
  posts: Post[];
  past: boolean;
  isToday: boolean;
  /** The day listed under the calendar on a phone. */
  selected: boolean;
  dragging: string | null;
  loading: boolean;
  onOpen: (id: string) => void;
  onAdd: () => void;
  onSelect: () => void;
  onDragStart: (id: string | null) => void;
  onDrop: () => void;
}) {
  const [over, setOver] = useState(false);
  const [listing, setListing] = useState(false);
  const first = posts[0];
  const items = first ? itemsOf(first) : [];
  const lead = items[0];
  const { still: cover, frame } = first
    ? stillOf(first)
    : { still: null, frame: null };
  const visual = Boolean(cover || frame);

  // Today is a teal disc behind the date, on the picture or off it.
  const date = (onPicture: boolean) => (
    <span
      className={`inline-flex size-6 items-center justify-center rounded-full text-xs font-medium tabular-nums ${
        isToday
          ? "bg-primary text-primary-foreground"
          : onPicture
            ? "text-white drop-shadow"
            : "text-muted-foreground"
      }`}
    >
      {n}
    </span>
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: dropping here is a pointer shortcut; the keyboard path is the date button in the post sheet
    <div
      onDragOver={e => {
        if (!dragging || past) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={e => {
        e.preventDefault();
        setOver(false);
        onDrop();
      }}
      className={`group relative aspect-square overflow-hidden rounded-lg border bg-card transition sm:aspect-[4/5] sm:rounded-xl ${
        past && !first ? "opacity-45" : ""
      } ${over ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""} ${
        selected ? "max-sm:border-primary max-sm:bg-primary/10" : ""
      }`}
    >
      {/* A phone: the date and a dot per post. */}
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={`${dayLabel(day)}: ${
          posts.length
            ? `${posts.length} ${posts.length === 1 ? "post" : "posts"}`
            : "nothing planned"
        }`}
        className="absolute inset-0 flex flex-col items-center gap-1 pt-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:hidden"
      >
        {date(false)}
        {posts.length ? (
          <span className="flex max-w-full flex-wrap justify-center gap-0.5 px-1">
            {posts.map(p => (
              <StateDot key={p.id} post={p} className="size-1.5" />
            ))}
          </span>
        ) : null}
      </button>

      {/* A tablet or a laptop: the post's picture. */}
      <div className="absolute inset-0 hidden sm:block">
        {first ? (
          <button
            type="button"
            draggable={!past}
            onDragStart={() => onDragStart(first.id)}
            onDragEnd={() => onDragStart(null)}
            onClick={() => onOpen(first.id)}
            className="absolute inset-0 block text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            aria-label={first.topic ?? "Post"}
          >
            {cover ? (
              <img
                src={cover}
                alt=""
                loading="lazy"
                draggable={false}
                className="h-full w-full object-cover"
              />
            ) : frame ? (
              <video
                src={`${frame}#t=0.5`}
                muted
                playsInline
                preload="metadata"
                className="pointer-events-none h-full w-full object-cover"
              />
            ) : (
              <span
                className={`flex h-full w-full flex-col justify-end bg-muted/60 px-2 pt-2 ${
                  posts.length > 1 ? "pb-8" : "pb-2"
                }`}
              >
                <span
                  className="line-clamp-4 text-xs leading-snug text-foreground/80"
                  dir="auto"
                >
                  {first.topic}
                </span>
              </span>
            )}
            {/* A post, whatever its pillar: grey, so it never reads as a state. */}
            <span className="absolute inset-y-0 left-0 w-[3px] bg-muted-foreground/60" />
            {visual ? (
              <span
                className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent pb-1.5 pl-2 pt-6 ${
                  posts.length > 1 ? "pr-9" : "pr-2"
                }`}
              >
                <span
                  className="line-clamp-2 text-xs font-medium leading-snug text-white"
                  dir="auto"
                >
                  {first.topic}
                </span>
              </span>
            ) : null}
            <span className="absolute right-1.5 top-1.5 flex items-center gap-1">
              {(items.length || first.slides) > 1 ? (
                <Images
                  className={`size-3.5 ${visual ? "text-white drop-shadow" : "text-muted-foreground"}`}
                />
              ) : lead?.kind === "video" ? (
                <Play
                  className={`size-3.5 ${visual ? "fill-white text-white drop-shadow" : "text-muted-foreground"}`}
                />
              ) : null}
              <StateDot post={first} halo />
            </span>
          </button>
        ) : !past && !loading ? (
          <button
            type="button"
            onClick={onAdd}
            aria-label={`Add a post on the ${n}`}
            className="absolute inset-0 flex items-center justify-center text-muted-foreground opacity-0 transition hover:bg-muted/50 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none [@media(hover:none)]:opacity-40"
          >
            <Plus className="h-5 w-5" />
          </button>
        ) : null}

        <span className="pointer-events-none absolute left-1.5 top-1.5">
          {date(visual)}
        </span>

        {posts.length > 1 ? (
          <Popover open={listing} onOpenChange={setListing}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`All ${posts.length} posts on the ${n}`}
                className="no-touch absolute bottom-1.5 right-1.5 rounded-full border bg-background/90 px-1.5 py-px text-xs font-medium tabular-nums after:absolute after:-inset-2 after:content-[''] hover:bg-background"
              >
                +{posts.length - 1}
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-72 overflow-hidden rounded-xl p-0 dark:shadow-none"
            >
              <p className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                {dayLabel(day)}
              </p>
              <DayPosts
                posts={posts}
                onOpen={id => {
                  setListing(false);
                  onOpen(id);
                }}
              />
            </PopoverContent>
          </Popover>
        ) : null}
      </div>

      {loading && !first ? (
        <span className="pointer-events-none absolute inset-0 animate-pulse bg-muted/40" />
      ) : null}
      <span className="sr-only">{day}</span>
    </div>
  );
}

/** A day's posts as rows: the picture, the topic, where it stands. */
function DayPosts({
  posts,
  onOpen,
}: {
  posts: Post[];
  onOpen: (id: string) => void;
}) {
  return (
    <ul className="divide-y">
      {posts.map(p => {
        const { still, frame } = stillOf(p);
        const s = stateOf(p);
        const format = formatOf(itemsOf(p));
        return (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onOpen(p.id)}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
            >
              <span className="h-12 w-[38px] shrink-0 overflow-hidden rounded-md bg-muted">
                {still ? (
                  <img
                    src={still}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : frame ? (
                  <video
                    src={`${frame}#t=0.5`}
                    muted
                    playsInline
                    preload="metadata"
                    className="pointer-events-none h-full w-full object-cover"
                  />
                ) : null}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className="line-clamp-2 text-sm font-medium leading-snug"
                  dir="auto"
                >
                  {p.topic ?? "Post"}
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                  <StateDot post={p} />
                  <span>{STATE[s].short}</span>
                  <span aria-hidden>·</span>
                  <span className="capitalize">{p.pillar}</span>
                  {format ? (
                    <>
                      <span aria-hidden>·</span>
                      <span>{format}</span>
                    </>
                  ) : null}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Under the calendar on a phone: the tapped day and its posts. */
function DayAgenda({
  ref,
  day,
  posts,
  loading,
  onOpen,
  onAdd,
}: {
  ref?: React.Ref<HTMLElement>;
  day: string;
  posts: Post[];
  loading: boolean;
  onOpen: (id: string) => void;
  onAdd: () => void;
}) {
  const past = day < today();
  return (
    <section ref={ref} aria-live="polite" className="mt-5 sm:hidden">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold">{dayLabel(day)}</h2>
        {!past ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onAdd}
            className="text-primary"
          >
            <Plus />
            Add a post
          </Button>
        ) : null}
      </div>
      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          Loading the month
        </p>
      ) : posts.length ? (
        <div className="overflow-hidden rounded-2xl border bg-card">
          <DayPosts posts={posts} onOpen={onOpen} />
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          {past ? "Nothing on this day." : "Nothing planned on this day yet."}
        </p>
      )}
    </section>
  );
}

function StateDot({
  post,
  halo = false,
  className = "",
}: {
  post: Post;
  /** A ring that keeps the dot readable on top of a picture. */
  halo?: boolean;
  className?: string;
}) {
  const s = stateOf(post);
  return (
    <span
      title={STATE[s].label}
      className={`block shrink-0 rounded-full ${className || "size-2"} ${
        halo ? "ring-2 ring-background/80" : ""
      } ${s === "drafting" ? "motion-safe:animate-pulse" : ""}`}
      style={{ background: STATE[s].dot }}
    />
  );
}

function SheetFrame({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A dialog or a date picker open on top of the sheet takes the
      // Escape itself (and marks it handled); the sheet stays.
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/30"
      />
      {/* Clear of the status bar and the home bar in the installed app. */}
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full flex-col overscroll-contain border-l bg-background pt-safe pb-safe motion-safe:animate-in motion-safe:slide-in-from-right sm:w-[480px]">
        {children}
      </aside>
    </>
  );
}

function SheetHead({
  title,
  sub,
  extra,
  onClose,
}: {
  title: string;
  /** A muted line under the title. */
  sub?: string;
  /** A control beside the title, before the close button. */
  extra?: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b px-5 py-3">
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[15px] font-semibold">{title}</h2>
        {sub ? (
          <p className="truncate text-xs text-muted-foreground">{sub}</p>
        ) : null}
      </div>
      {extra}
      <Button
        variant="ghost"
        size="icon"
        onClick={onClose}
        aria-label="Close"
        className="-mr-2 size-9 text-muted-foreground"
      >
        <X />
      </Button>
    </div>
  );
}

function dayLabel(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

function PillarPicker({
  choices,
  value,
  onChange,
}: {
  choices: string[];
  value: string;
  onChange: (p: string) => void;
}) {
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium">Pillar</span>
      <div className="flex flex-wrap gap-1.5">
        {choices.map(p => (
          <button
            key={p}
            type="button"
            aria-pressed={value === p}
            onClick={() => onChange(p)}
            className={`inline-flex h-8 items-center rounded-full border px-3 text-sm capitalize ${
              value === p
                ? CHOSEN
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

function NewPost({
  client,
  day,
  month,
  onCreated,
  onClose,
}: {
  client: Client;
  day: string;
  month: string;
  onCreated: (id: string | null) => void;
  onClose: () => void;
}) {
  const add = useAction(api.social.addPost);
  const choices = client.pillars.length
    ? client.pillars
    : ["portfolio", "craft", "education"];
  // Two ways to make a post, and they ask for different things: the AI
  // needs a format and may take references; our own needs the files.
  const [mode, setMode] = useState<"ai" | "own">("ai");
  const [topic, setTopic] = useState("");
  const [pillar, setPillar] = useState(choices[0]);
  const [slides, setSlides] = useState(1);
  const [aspect, setAspect] = useState<Aspect>("4:5");
  const [refs, setRefs] = useState<string[]>([]);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [uploading, setUploading] = useState(0);
  const [busy, setBusy] = useState(false);

  const video = items.some(i => i.kind === "video");
  const reel = items.length === 1 && items[0].kind === "video";
  const ready =
    Boolean(topic.trim()) &&
    !busy &&
    (mode === "ai" || (items.length > 0 && uploading === 0));

  async function create() {
    setBusy(true);
    try {
      const out = (await add({
        clientTaskId: client.taskId,
        month,
        pillar,
        topic: topic.trim(),
        when: `${day}T07:00:00Z`,
        aspect,
        ...(mode === "ai"
          ? { slides, generate: true, refs }
          : { media: items }),
      })) as { id?: string };
      toast.success(
        mode === "ai"
          ? "Added. The captions come in a few seconds, the pictures in a couple of minutes."
          : reel
            ? "Added. The captions are written from what is said in the video, and the cover is being made."
            : video
              ? "Added. The captions are written from what is said in the video."
              : "Added. The captions come in a few seconds.",
      );
      onCreated(out.id ?? null);
    } catch (e) {
      toast.error(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SheetHead title={dayLabel(day)} sub="New post" onClose={onClose} />
      <div className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-5">
        <div
          role="tablist"
          className="grid grid-cols-2 gap-0.5 rounded-lg border p-0.5"
        >
          {(
            [
              ["ai", "Make it with AI", Sparkles],
              ["own", "Use my own", Upload],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={mode === key}
              onClick={() => setMode(key)}
              className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md text-sm font-medium ${
                mode === key ? SEGMENT_ON : SEGMENT_OFF
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {mode === "own" ? (
          <DraftMedia
            clientId={client.taskId}
            aspect={aspect}
            items={items}
            onChange={setItems}
            onUploading={setUploading}
          />
        ) : null}

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">
            What is this post about?
          </span>
          <textarea
            value={topic}
            onChange={e => setTopic(e.target.value)}
            rows={3}
            dir="auto"
            // biome-ignore lint/a11y/noAutofocus: the sheet exists to take this one answer
            autoFocus={mode === "ai"}
            placeholder={
              mode === "ai"
                ? "The corner joint on a window frame, close enough to see the finish"
                : "A line is enough. The captions are written from it, and from what is said in any video."
            }
            className="w-full rounded-lg border bg-background p-3 text-sm leading-relaxed focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>

        {mode === "ai" ? (
          <div>
            <span className="mb-1.5 block text-sm font-medium">Format</span>
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex gap-0.5 rounded-lg border p-0.5">
                {[
                  [1, "Single image"],
                  [3, "Carousel"],
                ].map(([n, label]) => (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={slides > 1 === Number(n) > 1}
                    onClick={() => setSlides(Number(n))}
                    className={`h-8 rounded-md px-3 text-sm ${
                      (slides > 1) === (Number(n) > 1)
                        ? SEGMENT_ON
                        : SEGMENT_OFF
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {slides > 1 ? (
                <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="number"
                    min={2}
                    max={10}
                    value={slides}
                    onChange={e =>
                      setSlides(
                        Math.max(2, Math.min(10, Number(e.target.value))),
                      )
                    }
                    className="h-8 w-16 rounded-md border bg-background px-2 text-sm text-foreground"
                  />
                  slides
                </label>
              ) : null}
            </div>
          </div>
        ) : null}

        {mode === "ai" || !reel ? (
          <div>
            <span className="mb-1.5 block text-sm font-medium">Shape</span>
            <ShapePicker value={aspect} onChange={setAspect} />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            A lone video goes out as a {REEL.label}, {REEL.size}.
          </p>
        )}

        <PillarPicker choices={choices} value={pillar} onChange={setPillar} />

        {mode === "ai" ? (
          <References clientId={client.taskId} refs={refs} onChange={setRefs} />
        ) : null}
      </div>
      <div className="border-t px-5 py-4">
        <Button
          disabled={!ready}
          onClick={() => void create()}
          className="h-10 w-full rounded-lg font-semibold"
        >
          {busy ? (
            <LoaderCircle className="animate-spin" />
          ) : mode === "ai" ? (
            <Sparkles />
          ) : (
            <Plus />
          )}
          Create the post
        </Button>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          {mode === "ai"
            ? "The captions come back in a few seconds, the pictures in a couple of minutes."
            : uploading
              ? "Still uploading. The post can be made once every file is up."
              : !items.length
                ? "Add at least one photo or video."
                : reel
                  ? "Its cover is made from the video."
                  : "The captions are written for Instagram and Facebook."}
        </p>
      </div>
    </>
  );
}

const PLATFORM_ICON = { instagram: Instagram, facebook: Facebook } as const;

/** Where one post goes, within where the client posts at all. */
function PlatformPicker({
  allowed,
  value,
  onChange,
}: {
  allowed: Platform[];
  value: Platform[];
  onChange: (next: Platform[]) => void;
}) {
  const shown = PLATFORMS.filter(p => allowed.includes(p.key));
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium">Goes to</span>
      <div className="flex flex-wrap gap-1.5">
        {shown.map(p => {
          const on = value.includes(p.key);
          const Icon = PLATFORM_ICON[p.key];
          return (
            <button
              key={p.key}
              type="button"
              aria-pressed={on}
              disabled={shown.length === 1}
              onClick={() => {
                const next = on
                  ? value.filter(x => x !== p.key)
                  : [...value, p.key];
                if (!next.length)
                  return void toast.error(
                    "A post goes to at least one platform.",
                  );
                onChange(next);
              }}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm disabled:cursor-default ${
                on
                  ? CHOSEN
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {p.label}
            </button>
          );
        })}
        {shown.length === 1 ? (
          <span className="self-center text-xs text-muted-foreground">
            This client only posts to {shown[0].label}.
          </span>
        ) : null}
      </div>
    </div>
  );
}

function PostSheet({
  post,
  client,
  jobs,
  onChanged,
  onClose,
}: {
  post: Post | null;
  client: Client;
  jobs: Job[];
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const update = useAction(api.social.updatePost);
  const draw = useAction(api.social.generatePost);
  const remove = useAction(api.social.removePost);
  const move = useAction(api.social.schedulePost);
  const saveRefs = useAction(api.social.setRefs);
  const [busy, setBusy] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  if (!post)
    return (
      <>
        <SheetHead title="Post" onClose={onClose} />
        <p className="p-5 text-sm text-muted-foreground">
          That post is no longer here.
        </p>
      </>
    );

  const items = itemsOf(post);
  const s = stateOf(post);
  const day = String(post.scheduled_at ?? "").slice(0, 10);
  const format = formatOf(items);
  const allowed = client.platforms.length
    ? client.platforms
    : (["instagram", "facebook"] as Platform[]);
  const platforms = (post.platforms?.length ? post.platforms : allowed).filter(
    p => allowed.includes(p),
  );
  const drawn = items.some(m => m.source === "ai");
  const drawingAll = jobs.some(
    j =>
      j.kind === "generate" && j.params?.index === undefined && !j.params?.add,
  );

  async function act(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(done);
      await onChanged();
    } catch (e) {
      toast.error(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* The day is said once, as the title; the calendar button beside it
          moves the post, and is the keyboard's way to do what dragging a
          post to another day does. */}
      <SheetHead
        title={day ? dayLabel(day) : "Post"}
        extra={
          <DateInput
            value={day}
            min={today()}
            aria-label="Move to another day"
            title="Move to another day"
            onChange={e => {
              const d = e.target.value;
              if (d)
                void act(
                  () => move({ postId: post.id, when: `${d}T07:00:00Z` }),
                  "Moved.",
                );
            }}
            className="size-9! min-w-0! justify-center! rounded-lg! p-0! [&>span]:sr-only"
          />
        }
        onClose={onClose}
      />
      <div className="flex-1 overflow-y-auto overscroll-contain">
        <MediaEditor
          post={post}
          clientId={client.taskId}
          jobs={jobs}
          onChanged={onChanged}
          look={client.look ?? "bold"}
        />

        <div className="space-y-5 px-5 pb-6 pt-3">
          {items.length === 1 && items[0].kind === "video" ? (
            <p className="text-xs text-muted-foreground">
              A lone video goes out as a {REEL.label}, {REEL.size}.
            </p>
          ) : (
            <ShapePicker
              value={post.aspect ?? "4:5"}
              disabled={busy}
              onChange={next =>
                void act(
                  () => update({ postId: post.id, aspect: next }),
                  drawn
                    ? `${ASPECTS.find(a => a.key === next)?.label}, ${next}. Draw the pictures again to fill it exactly.`
                    : `${ASPECTS.find(a => a.key === next)?.label}, ${next}.`,
                )
              }
            />
          )}
          {post.error ? (
            <p className="callout-bad rounded-lg border p-3 text-sm">
              {post.error}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="inline-flex items-center gap-2">
              <StateDot post={post} />
              <span className="font-medium">{STATE[s].label}</span>
            </span>
            <span aria-hidden className="text-muted-foreground">
              ·
            </span>
            <span className="capitalize text-muted-foreground">
              {post.pillar}
            </span>
            {format ? (
              <>
                <span aria-hidden className="text-muted-foreground">
                  ·
                </span>
                <span className="text-muted-foreground">{format}</span>
              </>
            ) : null}
          </div>

          <ClientSide post={post} client={client} />
          <PostedSide post={post} />

          {post.topic ? (
            <p className="text-sm font-medium leading-snug" dir="auto">
              {post.topic}
            </p>
          ) : null}

          <PlatformPicker
            allowed={allowed}
            value={platforms}
            onChange={next =>
              void act(
                () => update({ postId: post.id, platforms: next }),
                `Goes to ${next
                  .map(p => PLATFORMS.find(x => x.key === p)?.label)
                  .join(" and ")}.`,
              )
            }
          />

          <Captions
            post={post}
            platforms={platforms}
            writing={jobs.some(j => j.kind === "caption")}
            onChanged={onChanged}
          />

          {drawn || !items.length ? (
            <References
              clientId={client.taskId}
              refs={post.refs ?? []}
              onChange={async next => {
                try {
                  await saveRefs({ postId: post.id, refs: next });
                  await onChanged();
                } catch (e) {
                  toast.error(message(e));
                }
              }}
            />
          ) : null}
        </div>
      </div>

      <div className="flex gap-2 border-t px-5 py-4">
        {(drawn || !items.length) && post.status !== "published" ? (
          <Button
            variant="outline"
            disabled={busy || drawingAll}
            onClick={() =>
              void act(
                () => draw({ postId: post.id }),
                drawn
                  ? "Drawing every AI picture again. It takes a couple of minutes."
                  : "Drawing the pictures. It takes a couple of minutes.",
              )
            }
            className="h-10 flex-1 rounded-lg"
          >
            {drawingAll ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <RefreshCw />
            )}
            {drawingAll
              ? "Drawing"
              : drawn
                ? "Draw them all again"
                : "Draw the pictures"}
          </Button>
        ) : (
          <span className="flex-1" />
        )}
        <Button
          variant="outline"
          size="icon"
          disabled={busy}
          onClick={() =>
            void (async () => {
              const ok = await confirm({
                title: "Remove this post from the month?",
                action: "Remove the post",
                destructive: true,
              });
              if (!ok) return;
              void act(async () => {
                await remove({ postId: post.id });
                onClose();
              }, "Removed.");
            })()
          }
          aria-label="Remove the post"
          className="size-10 rounded-lg text-muted-foreground hover:text-destructive"
        >
          <Trash2 />
        </Button>
      </div>
      {confirmDialog}
    </>
  );
}

/** The client's own photos: what references are picked from. */
function PhotoLibrary({ clientId }: { clientId: string }) {
  const { photos, load } = useLibrary(clientId);
  const { pending, upload } = useUploader(clientId);
  const addPhoto = useAction(api.social.addToLibrary);
  const removePhoto = useAction(api.social.removeFromLibrary);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(files: File[]) {
    const got = await upload(files, "image");
    try {
      for (const g of got)
        await addPhoto({ clientTaskId: clientId, url: g.url });
    } catch (e) {
      toast.error(message(e));
    }
    if (got.length) await load();
  }

  return (
    <div>
      <span className="mb-1 block text-sm font-medium">Photo library</span>
      <span className="mb-2 block text-xs text-muted-foreground">
        The client's own photos: projects, team, products. Pick them as
        references when the AI draws, so the pictures look like their work.
      </span>
      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
        {(photos ?? []).map(ph => (
          <span
            key={ph.id}
            className="group relative aspect-[4/5] overflow-hidden rounded-md border"
          >
            <img
              src={ph.url}
              alt={ph.caption ?? ""}
              loading="lazy"
              className="h-full w-full object-cover"
            />
            {/* Shown on hover with a mouse; always shown on a touch screen,
                where a hidden button would still take a stray tap. */}
            <button
              type="button"
              aria-label="Take this photo out of the library"
              onClick={() =>
                void (async () => {
                  try {
                    await removePhoto({ id: ph.id });
                    await load();
                  } catch (e) {
                    toast.error(message(e));
                  }
                })()
              }
              className="no-touch absolute right-1 top-1 flex size-7 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition after:absolute after:-inset-1 after:content-[''] group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
            >
              <X className="size-3.5" />
            </button>
          </span>
        ))}
        {pending.map(p => (
          <span
            key={p.id}
            className="relative flex aspect-[4/5] items-center justify-center overflow-hidden rounded-md border"
          >
            <img
              src={p.preview}
              alt=""
              className="absolute inset-0 h-full w-full object-cover opacity-50"
            />
            <LoaderCircle className="relative h-4 w-4 animate-spin" />
          </span>
        ))}
        <label className="flex aspect-[4/5] cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-within:ring-2 focus-within:ring-ring">
          <Upload className="h-4 w-4" />
          Add
          <input
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={e => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length) void add(files);
            }}
          />
        </label>
      </div>
      {photos === null ? (
        <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          Opening the library
        </p>
      ) : null}
    </div>
  );
}

function SettingsSheet({
  client,
  onChanged,
  onClose,
}: {
  client: Client;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const configure = useAction(api.social.configure);
  const setActive = useAction(api.social.setActive);
  const [perMonth, setPerMonth] = useState(String(client.postsPerMonth ?? 12));
  const [dialect, setDialect] = useState(client.dialect ?? "");
  const [pillars, setPillars] = useState<string[]>(
    client.pillars.length
      ? client.pillars
      : ["portfolio", "craft", "education"],
  );
  const [platforms, setPlatforms] = useState<Platform[]>(
    client.platforms.length ? client.platforms : ["instagram", "facebook"],
  );
  const [autoApprove, setAutoApprove] = useState(client.autoApprove);
  const [look, setLook] = useState<Look>(client.look ?? "bold");
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  async function save() {
    setBusy(true);
    try {
      await configure({
        clientTaskId: client.taskId,
        pillars,
        dialect: dialect.trim(),
        postsPerMonth: Math.max(1, Math.min(60, Number(perMonth) || 12)),
        platforms,
        autoApprove,
        look,
      });
      toast.success("Saved.");
      await onChanged();
      onClose();
    } catch (e) {
      toast.error(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SheetHead title="Client setup" sub={client.name} onClose={onClose} />
      <div className="flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 py-5">
        <SettingsGroup title="Plan">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">
              Posts a month
            </span>
            <input
              type="number"
              min={1}
              max={60}
              value={perMonth}
              onChange={e => setPerMonth(e.target.value)}
              className="h-9 w-24 rounded-lg border bg-background px-3 text-sm"
            />
            <span className="mt-1.5 block text-xs text-muted-foreground">
              What "Fill the month" plans up to.
            </span>
          </label>

          <div>
            <span className="mb-1.5 block text-sm font-medium">Pillars</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {pillars.map(p => (
                <span
                  key={p}
                  className="inline-flex h-8 items-center gap-1 rounded-full border pl-3 pr-1 text-sm capitalize"
                >
                  {p}
                  <button
                    type="button"
                    aria-label={`Remove ${p}`}
                    onClick={() => setPillars(pillars.filter(x => x !== p))}
                    className="no-touch relative flex size-6 items-center justify-center rounded-full text-muted-foreground after:absolute after:-inset-1.5 after:content-[''] hover:bg-muted hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                </span>
              ))}
              <input
                value={adding}
                onChange={e => setAdding(e.target.value)}
                onKeyDown={e => {
                  if (e.key !== "Enter") return;
                  const name = adding.trim().toLowerCase();
                  if (name && !pillars.includes(name))
                    setPillars([...pillars, name]);
                  setAdding("");
                }}
                placeholder="Add one"
                className="h-8 w-28 rounded-full border bg-background px-3 text-sm"
              />
            </div>
            <span className="mt-1.5 block text-xs text-muted-foreground">
              The kinds of post this client gets. A filled month takes them in
              turn.
            </span>
          </div>
        </SettingsGroup>

        <SettingsGroup title="Look">
          <fieldset>
            <legend className="mb-1.5 block text-sm font-medium">
              Words on the pictures
            </legend>
            <div className="space-y-1.5">
              {LOOKS.map(l => (
                <label
                  key={l.key}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 ${
                    look === l.key ? CHOSEN : "hover:bg-muted/50"
                  }`}
                >
                  <input
                    type="radio"
                    name="look"
                    checked={look === l.key}
                    onChange={() => setLook(l.key)}
                    className="mt-0.5 h-4 w-4 accent-[var(--mahara-teal)]"
                  />
                  <span>
                    <span className="block text-sm font-medium">{l.label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {l.note}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <span className="mt-1.5 block text-xs text-muted-foreground">
              New pictures follow it. Pictures already drawn keep their words
              until they are drawn again.
            </span>
          </fieldset>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">
              Caption dialect
            </span>
            <input
              value={dialect}
              onChange={e => setDialect(e.target.value)}
              placeholder="Saudi (Najdi)"
              className="h-9 w-full rounded-lg border bg-background px-3 text-sm"
            />
            <span className="mt-1.5 block text-xs text-muted-foreground">
              The client's own voice. Brand, offer and do's and don'ts come from
              their ClickUp card.
            </span>
          </label>

          <PhotoLibrary clientId={client.taskId} />
        </SettingsGroup>

        <SettingsGroup title="Publishing">
          <div>
            <span className="mb-1.5 block text-sm font-medium">
              Posts go to
            </span>
            <div className="flex flex-wrap gap-1.5">
              {PLATFORMS.map(p => {
                const on = platforms.includes(p.key);
                const Icon = PLATFORM_ICON[p.key];
                return (
                  <button
                    key={p.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      const next = on
                        ? platforms.filter(x => x !== p.key)
                        : [...platforms, p.key];
                      if (!next.length)
                        return void toast.error(
                          "A client posts to at least one platform.",
                        );
                      setPlatforms(next);
                    }}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm ${
                      on
                        ? CHOSEN
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {p.label}
                  </button>
                );
              })}
            </div>
            <span className="mt-1.5 block text-xs text-muted-foreground">
              Take Facebook off for a client who only has Instagram.
            </span>
          </div>

          <AccountsPicker
            clientId={client.taskId}
            wantsInstagram={platforms.includes("instagram")}
            onChanged={onChanged}
          />

          <ReadyToPost client={client} onChanged={onChanged} />

          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={autoApprove}
              onChange={e => setAutoApprove(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--mahara-teal)]"
            />
            <span>
              <span className="block text-sm font-medium">
                Goes out without the client's sign-off
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Nothing is posted yet. Once posting is switched on, this
                client's ready posts go out on their day without waiting for
                them to approve.
              </span>
            </span>
          </label>
        </SettingsGroup>
      </div>
      <div className="flex items-center gap-2 border-t px-5 py-4">
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() =>
            void (async () => {
              const ok = await confirm({
                title: `Take ${client.name} off social media?`,
                action: "Take off the package",
                destructive: true,
              });
              if (!ok) return;
              await setActive({ clientTaskId: client.taskId, active: false });
              await onChanged();
              onClose();
            })()
          }
          className="h-10 rounded-lg px-3 text-muted-foreground hover:bg-muted hover:text-destructive"
        >
          Take off the package
        </Button>
        <Button
          disabled={busy}
          onClick={() => void save()}
          className="ml-auto h-10 rounded-lg px-5 font-semibold"
        >
          Save
        </Button>
      </div>
      {confirmDialog}
    </>
  );
}

/** One of the setup sheet's three parts, under a small heading. */
function SettingsGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-6 border-t pt-5 first:border-t-0 first:pt-0">
      <h3 className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function shortDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kuwait",
  });
}

/** Where the post stands with the client, in one or two plain lines. */
function ClientSide({ post, client }: { post: Post; client: Client }) {
  const who = post.client_reviewer || "The client";
  if (post.client_status === "approved")
    return (
      <p className="callout-good rounded-lg border p-3 text-sm">
        {who} approved it on {shortDate(post.client_decided_at)}.
      </p>
    );
  if (post.client_status === "changes")
    return (
      <div className="callout-warn rounded-lg border p-3 text-sm">
        <p className="font-medium">{who} asked for a change</p>
        {post.client_note ? (
          <p
            className="mt-1 whitespace-pre-wrap text-muted-foreground"
            dir="auto"
          >
            {post.client_note}
          </p>
        ) : null}
        <p className="mt-2 text-xs text-muted-foreground">
          Fix it, then send it again. They can also approve it on the link they
          already have.
        </p>
      </div>
    );
  if (post.client_status === "changed")
    return (
      <p className="callout-warn rounded-lg border p-3 text-sm">
        Changed after {who.toLowerCase() === "the client" ? "the client" : who}{" "}
        approved it. Send it again so they see what will go out.
      </p>
    );
  if (post.client_status === "sent")
    return (
      <p className="text-sm text-muted-foreground">
        With the client since {shortDate(post.client_sent_at)}. Their answer
        lands here.
      </p>
    );
  if (client.autoApprove || post.status === "published") return null;
  return (
    <p className="text-sm text-muted-foreground">Not sent to the client yet.</p>
  );
}

function SignoffSheet({
  client,
  month,
  posts,
  onChanged,
  onClose,
}: {
  client: Client;
  month: string;
  posts: Post[];
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const send = useAction(api.social.sendForSignoff);
  const list = [...posts].sort((a, b) =>
    String(a.scheduled_at ?? "").localeCompare(String(b.scheduled_at ?? "")),
  );
  const [picked, setPicked] = useState<Set<string>>(
    () =>
      new Set(
        list
          .filter(p => showable(p) && p.client_status !== "approved")
          .map(p => p.id),
      ),
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{
    url: string;
    sent: number;
    skipped: number;
  } | null>(null);

  async function make() {
    setBusy(true);
    try {
      const out = (await send({
        clientTaskId: client.taskId,
        month,
        postIds: list.filter(p => picked.has(p.id)).map(p => p.id),
        note: note.trim() || undefined,
      })) as { url: string; sent: number; skipped: number };
      setMade(out);
      await onChanged();
    } catch (e) {
      toast.error(message(e));
    } finally {
      setBusy(false);
    }
  }

  if (made)
    return (
      <>
        <SheetHead title="Send to the client" onClose={onClose} />
        <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-5">
          <p className="text-sm font-medium">
            The link is ready: {made.sent} {made.sent === 1 ? "post" : "posts"}
            {made.skipped
              ? `, ${made.skipped} left out because ${made.skipped === 1 ? "it is" : "they are"} not finished`
              : ""}
            .
          </p>
          <div className="flex gap-2">
            <input
              readOnly
              value={made.url}
              onFocus={e => e.target.select()}
              aria-label="The link for the client"
              className="h-10 min-w-0 flex-1 rounded-lg border bg-muted/40 px-3 text-sm"
            />
            <Button
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(made.url)
                  .then(() => toast.success("Copied."))
              }
              className="h-10 rounded-lg px-4 font-semibold"
            >
              Copy the link
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Send it to {client.name} on WhatsApp. They see each post as it will
            go out, approve it or ask for a change, and their answer lands on
            the post here.
          </p>
        </div>
        <div className="border-t px-5 py-4">
          <Button
            variant="outline"
            onClick={onClose}
            className="h-10 w-full rounded-lg"
          >
            Done
          </Button>
        </div>
      </>
    );

  return (
    <>
      <SheetHead title="Send to the client" onClose={onClose} />
      <div className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-5">
        <p className="text-sm text-muted-foreground">
          {client.name} sees each post on a Mahara page, as it will go out, and
          approves it or asks for a change. Their answers land on the posts
          here.
        </p>

        <ul className="divide-y rounded-xl border">
          {list.map(p => {
            const ok = showable(p);
            const items = itemsOf(p);
            const lead = items[0];
            const still = lead
              ? lead.kind === "image"
                ? lead.url
                : (lead.cover ?? null)
              : null;
            const s = stateOf(p);
            return (
              <li key={p.id}>
                <label
                  className={`flex items-center gap-3 px-3 py-2 ${ok ? "cursor-pointer" : "opacity-50"}`}
                >
                  <input
                    type="checkbox"
                    disabled={!ok}
                    checked={picked.has(p.id)}
                    onChange={e => {
                      const next = new Set(picked);
                      if (e.target.checked) next.add(p.id);
                      else next.delete(p.id);
                      setPicked(next);
                    }}
                    className="h-4 w-4 accent-[var(--mahara-teal)]"
                  />
                  <span className="h-10 w-8 shrink-0 overflow-hidden rounded bg-muted">
                    {still ? (
                      <img
                        src={still}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : lead?.kind === "video" ? (
                      // A video with no cover yet shows its own frame.
                      <video
                        src={`${lead.url}#t=0.5`}
                        muted
                        playsInline
                        preload="metadata"
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm" dir="auto">
                      {p.topic ?? "Post"}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {p.scheduled_at
                        ? dayLabel(p.scheduled_at.slice(0, 10))
                        : "No day yet"}
                      {" · "}
                      {ok ? STATE[s].label : "Not finished"}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">
            A line for the client
          </span>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={3}
            dir="auto"
            placeholder="Here are your posts for the month. Approve the ones you like and tell us what to change."
            className="w-full rounded-lg border bg-background p-3 text-sm leading-relaxed focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            Optional. It shows under each post on their page.
          </span>
        </label>
      </div>
      <div className="border-t px-5 py-4">
        <Button
          disabled={busy || picked.size === 0}
          onClick={() => void make()}
          className="h-10 w-full rounded-lg font-semibold"
        >
          {busy ? <LoaderCircle className="animate-spin" /> : <Send />}
          Make the link for {picked.size} {picked.size === 1 ? "post" : "posts"}
        </Button>
      </div>
    </>
  );
}

const NUMBERS: [string, string][] = [
  ["reach", "reached"],
  ["likes", "likes"],
  ["comments", "comments"],
  ["saved", "saves"],
  ["shares", "shares"],
];

/** Where it went out, the link to it, and how it did once the numbers are in. */
function PostedSide({ post }: { post: Post }) {
  const pub = post.published ?? {};
  const ig = pub.instagram;
  const fb = pub.facebook;
  const res = post.results?.instagram;
  if (!ig && !fb && !post.publish_error) return null;
  return (
    <div className="space-y-2">
      {ig || fb ? (
        <p className="text-sm">
          Posted
          {ig ? " on Instagram" : ""}
          {ig && fb ? " and" : ""}
          {fb ? " on Facebook" : ""} on {shortDate(ig?.at ?? fb?.at ?? null)}.
          {ig?.permalink ? (
            <>
              {" "}
              <a
                href={ig.permalink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
              >
                See it on Instagram
                <ArrowUpRight className="size-3.5" />
              </a>
            </>
          ) : null}
        </p>
      ) : null}
      {res ? (
        <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          {NUMBERS.filter(([k]) => typeof res[k] === "number").map(
            ([k, label]) => (
              <span key={k}>
                <span className="font-semibold tabular-nums text-foreground">
                  {Number(res[k]).toLocaleString("en-GB")}
                </span>{" "}
                {label}
              </span>
            ),
          )}
        </p>
      ) : null}
      {post.publish_error ? (
        <p className="callout-warn rounded-lg border p-3 text-sm">
          {post.publish_error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * What a client needs before posts go out by themselves, and the switch.
 * The switch is the moment a sold client goes live; until then nothing
 * posts, and posts due before it was turned on never go out on their own.
 */
function ReadyToPost({
  client,
  onChanged,
}: {
  client: Client;
  onChanged: () => Promise<void>;
}) {
  const configure = useAction(api.social.configure);
  const [busy, setBusy] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  const wantsIg = client.platforms.includes("instagram");
  const steps: [boolean, string][] = [
    [Boolean(client.page), "Linked to the client's Facebook Page"],
    ...(wantsIg
      ? ([
          [Boolean(client.page?.igUserId), "An Instagram account on that Page"],
        ] as [boolean, string][])
      : []),
    [Boolean(client.dialect?.trim()), "Caption dialect set"],
    [client.pillars.length > 0, "Pillars chosen"],
  ];
  const ready = steps.every(([ok]) => ok);

  async function flip(on: boolean) {
    if (
      on &&
      !(await confirm({
        title: "Post automatically on their day?",
        body: `From now on, ${client.name}'s ${client.autoApprove ? "finished" : "approved"} posts go out on their day by themselves. Posts that were due before now never go out on their own.`,
        action: "Turn it on",
      }))
    )
      return;
    setBusy(true);
    try {
      await configure({ clientTaskId: client.taskId, publishing: on });
      toast.success(on ? "Posting automatically." : "Posting stopped.");
      await onChanged();
    } catch (e) {
      toast.error(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium">Ready to post</span>
      <ul className="space-y-1">
        {steps.map(([ok, label]) => (
          <li key={label} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden
              className={`inline-flex size-4 shrink-0 items-center justify-center rounded-full ${
                ok
                  ? "tone-good"
                  : "border border-dashed border-muted-foreground/60"
              }`}
            >
              {ok ? <Check className="size-3" strokeWidth={3} /> : null}
            </span>
            <span className={ok ? "" : "text-muted-foreground"}>{label}</span>
            <span className="sr-only">{ok ? "done" : "not done yet"}</span>
          </li>
        ))}
        <li className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="h-4 w-4" aria-hidden />
          {client.autoApprove
            ? "Posts go out without the client's sign-off"
            : "Only posts the client approved go out"}
        </li>
      </ul>
      <label
        className={`mt-3 flex items-start gap-3 rounded-lg border p-3 ${
          client.publishing ? "callout-good" : ""
        }`}
      >
        <input
          type="checkbox"
          checked={client.publishing}
          disabled={busy || (!client.publishing && !ready)}
          onChange={e => void flip(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[var(--mahara-teal)]"
        />
        <span>
          <span className="block text-sm font-medium text-foreground">
            Post automatically on their day
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {client.publishing
              ? `On since ${shortDate(client.publishingSince)}. A post that cannot go out says why on the post.`
              : ready
                ? "Off. Turn it on when the client has bought the package and knows we post for them."
                : "Off. Finish the steps above first."}
          </span>
        </span>
      </label>
      {confirmDialog}
    </div>
  );
}
