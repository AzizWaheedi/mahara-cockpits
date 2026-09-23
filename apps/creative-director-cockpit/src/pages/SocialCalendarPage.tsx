import { useAction } from "convex/react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Images,
  LoaderCircle,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import { pillarColor } from "../components/SocialMonth";

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
};

type Post = {
  id: string;
  pillar: string;
  topic: string | null;
  slides: number;
  caption: string | null;
  images: string[] | null;
  scheduled_at: string | null;
  status: string;
  error: string | null;
};

type Sheet =
  | { mode: "post"; id: string }
  | { mode: "new"; day: string }
  | { mode: "settings" }
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

type State = "posted" | "client" | "attention" | "ready" | "drafting";

function stateOf(p: Post): State {
  if (p.status === "published") return "posted";
  if (p.status === "with_client") return "client";
  if (p.error) return "attention";
  if (p.caption && (p.images?.length ?? 0) > 0) return "ready";
  return "drafting";
}

const STATE: Record<State, { label: string; dot: string }> = {
  posted: { label: "Posted", dot: "var(--success)" },
  client: { label: "With the client", dot: "var(--info)" },
  attention: { label: "Needs attention", dot: "var(--destructive)" },
  ready: { label: "Ready", dot: "var(--primary)" },
  drafting: { label: "Drafting", dot: "var(--muted-foreground)" },
};

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
  const [sheet, setSheet] = useState<Sheet>(null);
  const [filling, setFilling] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);

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
    })) as unknown as { posts: Post[] };
    setPosts(out.posts ?? []);
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

  // While anything is still being written or drawn, look again every few
  // seconds, so a fill lands on the calendar in front of whoever pressed it.
  const working =
    filling > Date.now() || (posts ?? []).some(p => stateOf(p) === "drafting");
  useEffect(() => {
    if (!working) return;
    const t = window.setInterval(() => void loadMonth(), 4000);
    return () => window.clearInterval(t);
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

  const counts = useMemo(() => {
    const c = { ready: 0, drafting: 0, attention: 0, total: 0 };
    for (const p of posts ?? []) {
      const s = stateOf(p);
      c.total++;
      if (s === "ready" || s === "client" || s === "posted") c.ready++;
      if (s === "drafting") c.drafting++;
      if (s === "attention") c.attention++;
    }
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
      <div className="flex items-center gap-2 p-8 text-[13px] text-muted-foreground">
        <LoaderCircle className="h-4 w-4 animate-spin" />
        Loading the calendar
      </div>
    );

  const active = clients.filter(c => c.active);
  const others = clients.filter(c => !c.active);

  return (
    <div className="p-5 md:p-8">
      <div className="mx-auto max-w-[1180px]">
        <header className="mb-5 flex flex-wrap items-end gap-x-4 gap-y-3">
          <div className="min-w-0">
            <label className="relative inline-flex items-center">
              <span className="sr-only">Client</span>
              <select
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
                className="cursor-pointer appearance-none bg-transparent pr-6 text-[15px] font-medium focus:outline-none focus-visible:underline"
              >
                {!active.length ? (
                  <option value="">Pick a client</option>
                ) : null}
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
              </select>
              <ChevronDown className="pointer-events-none absolute right-0 h-4 w-4 text-muted-foreground" />
            </label>
            <div className="mt-1 flex items-center gap-2">
              <h1 className="text-[30px] font-semibold leading-none tracking-tight md:text-[36px]">
                {monthLabel(month)}
              </h1>
              <div className="ml-1 flex items-center">
                <button
                  type="button"
                  aria-label="Previous month"
                  onClick={() => setMonth(shift(month, -1))}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  aria-label="Next month"
                  onClick={() => setMonth(shift(month, 1))}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
                {month !== monthOf(new Date()) ? (
                  <button
                    type="button"
                    onClick={() => setMonth(monthOf(new Date()))}
                    className="ml-1 rounded-md px-2 py-1 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    Today
                  </button>
                ) : null}
              </div>
            </div>
            {client && posts ? (
              <p className="mt-2 text-[13px] text-muted-foreground">
                {counts.total === 0
                  ? `Nothing planned yet. ${client.name} gets ${want} posts a month.`
                  : `${counts.ready} of ${counts.total} ready` +
                    (counts.drafting
                      ? `, ${counts.drafting} being written`
                      : "") +
                    (counts.attention
                      ? `, ${counts.attention} ${counts.attention === 1 ? "needs" : "need"} attention`
                      : "") +
                    "." +
                    (open ? ` ${open} still to plan.` : "")}
              </p>
            ) : null}
          </div>

          {client ? (
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSheet({ mode: "settings" })}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium hover:bg-muted"
              >
                <SlidersHorizontal className="h-4 w-4" />
                Settings
              </button>
              <button
                type="button"
                disabled={busy || open === 0}
                onClick={() => void fillMonth()}
                title={
                  open === 0
                    ? "The month already has every post it needs"
                    : undefined
                }
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[13px] font-semibold text-primary-foreground disabled:opacity-50"
              >
                {busy ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Fill the month
              </button>
            </div>
          ) : null}
        </header>

        {!client ? (
          <div className="rounded-xl border border-dashed p-10 text-center text-[13px] text-muted-foreground">
            Pick a client above to open their month.
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-1.5 md:gap-2">
            {WEEK.map(d => (
              <div
                key={d}
                className="pb-1 text-[12px] font-medium text-muted-foreground"
              >
                {d}
              </div>
            ))}
            {Array.from({ length: lead(month) }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: blanks before the 1st
              <div key={`b${i}`} />
            ))}
            {days(month).map(({ day, n }) => {
              const here = byDay.get(day) ?? [];
              const past = day < today();
              const isToday = day === today();
              return (
                <DayCell
                  key={day}
                  day={day}
                  n={n}
                  posts={here}
                  past={past}
                  isToday={isToday}
                  pillars={client.pillars}
                  dragging={dragging}
                  loading={posts === null}
                  onOpen={id => setSheet({ mode: "post", id })}
                  onAdd={() => setSheet({ mode: "new", day })}
                  onDragStart={setDragging}
                  onDrop={() => void drop(day)}
                />
              );
            })}
          </div>
        )}
      </div>

      {sheet && client ? (
        <SheetFrame onClose={() => setSheet(null)}>
          {sheet.mode === "settings" ? (
            <SettingsSheet
              client={client}
              onChanged={loadClients}
              onClose={() => setSheet(null)}
            />
          ) : sheet.mode === "new" ? (
            <NewPost
              clientId={client.taskId}
              pillars={client.pillars}
              day={sheet.day}
              month={month}
              onCreated={async id => {
                setFilling(Date.now() + 3 * 60_000);
                await loadMonth();
                setSheet(id ? { mode: "post", id } : null);
              }}
              onClose={() => setSheet(null)}
            />
          ) : (
            <PostSheet
              post={posts?.find(p => p.id === sheet.id) ?? null}
              pillars={client.pillars}
              onChanged={loadMonth}
              onClose={() => setSheet(null)}
            />
          )}
        </SheetFrame>
      ) : null}
    </div>
  );
}

function DayCell({
  day,
  n,
  posts,
  past,
  isToday,
  pillars,
  dragging,
  loading,
  onOpen,
  onAdd,
  onDragStart,
  onDrop,
}: {
  day: string;
  n: number;
  posts: Post[];
  past: boolean;
  isToday: boolean;
  pillars: string[];
  dragging: string | null;
  loading: boolean;
  onOpen: (id: string) => void;
  onAdd: () => void;
  onDragStart: (id: string | null) => void;
  onDrop: () => void;
}) {
  const [over, setOver] = useState(false);
  const first = posts[0];
  const cover = first?.images?.[0];

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: dropping here is a pointer shortcut; the keyboard path is the date field in the post sheet
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
      className={`group relative aspect-[4/5] overflow-hidden rounded-xl border transition ${
        past && !first ? "opacity-45" : ""
      } ${over ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""} ${
        isToday ? "border-foreground/60" : ""
      } ${first ? "" : "bg-card"}`}
    >
      {first ? (
        <button
          type="button"
          draggable={!past}
          onDragStart={() => onDragStart(first.id)}
          onDragEnd={() => onDragStart(null)}
          onClick={() => onOpen(first.id)}
          className="absolute inset-0 block text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          ) : (
            <span className="flex h-full w-full flex-col justify-end bg-muted/60 p-2">
              <span className="line-clamp-4 text-[11px] leading-snug text-foreground/80">
                {first.topic}
              </span>
            </span>
          )}
          <span
            className="absolute inset-y-0 left-0 w-[3px]"
            style={{ background: pillarColor(first.pillar, pillars) }}
          />
          {cover ? (
            <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent px-2 pb-1.5 pt-6">
              <span className="line-clamp-2 text-[11px] font-medium leading-snug text-white">
                {first.topic}
              </span>
            </span>
          ) : null}
          <StateDot post={first} className="absolute right-1.5 top-1.5" />
          {(first.images?.length ?? first.slides) > 1 ? (
            <Images
              className={`absolute right-5 top-1 h-3.5 w-3.5 ${cover ? "text-white drop-shadow" : "text-muted-foreground"}`}
            />
          ) : null}
        </button>
      ) : loading ? (
        <span className="absolute inset-0 animate-pulse bg-muted/40" />
      ) : !past ? (
        <button
          type="button"
          onClick={onAdd}
          aria-label={`Add a post on the ${n}`}
          className="absolute inset-0 flex items-center justify-center text-muted-foreground opacity-0 transition hover:bg-muted/50 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
        >
          <Plus className="h-5 w-5" />
        </button>
      ) : null}

      <span
        className={`pointer-events-none absolute left-2 top-1.5 text-[12px] font-medium tabular-nums ${
          cover ? "text-white drop-shadow" : "text-muted-foreground"
        } ${isToday && !cover ? "text-foreground" : ""}`}
      >
        {n}
      </span>
      {posts.length > 1 ? (
        <button
          type="button"
          onClick={() => onOpen(posts[1].id)}
          className="absolute bottom-1.5 right-1.5 rounded-full bg-background/90 px-1.5 text-[11px] font-medium shadow-sm"
        >
          +{posts.length - 1}
        </button>
      ) : null}
      <span className="sr-only">{day}</span>
    </div>
  );
}

function StateDot({
  post,
  className = "",
}: {
  post: Post;
  className?: string;
}) {
  const s = stateOf(post);
  return (
    <span
      title={STATE[s].label}
      className={`block h-2 w-2 rounded-full ring-2 ring-background/80 ${
        s === "drafting" ? "motion-safe:animate-pulse" : ""
      } ${className}`}
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
      if (e.key === "Escape") onClose();
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
        className="fixed inset-0 z-40 bg-black/20 sm:bg-black/10"
      />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l bg-background shadow-2xl motion-safe:animate-in motion-safe:slide-in-from-right sm:w-[440px]">
        {children}
      </aside>
    </>
  );
}

function SheetHead({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center gap-2 border-b px-5 py-3.5">
      <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">
        {title}
      </h2>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
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

function NewPost({
  clientId,
  pillars,
  day,
  month,
  onCreated,
  onClose,
}: {
  clientId: string;
  pillars: string[];
  day: string;
  month: string;
  onCreated: (id: string | null) => void;
  onClose: () => void;
}) {
  const add = useAction(api.social.addPost);
  const choices = pillars.length
    ? pillars
    : ["portfolio", "craft", "education"];
  const [topic, setTopic] = useState("");
  const [pillar, setPillar] = useState(choices[0]);
  const [slides, setSlides] = useState(1);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const out = (await add({
        clientTaskId: clientId,
        month,
        pillar,
        topic: topic.trim(),
        slides,
        when: `${day}T07:00:00Z`,
        generate: true,
      })) as { id?: string };
      toast.success("Added. The caption and picture are on their way.");
      onCreated(out.id ?? null);
    } catch (e) {
      toast.error(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SheetHead title={dayLabel(day)} onClose={onClose} />
      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium">
            What is this post about?
          </span>
          <textarea
            value={topic}
            onChange={e => setTopic(e.target.value)}
            rows={3}
            dir="auto"
            // biome-ignore lint/a11y/noAutofocus: the sheet exists to take this one answer
            autoFocus
            placeholder="The corner joint on a window frame, close enough to see the finish"
            className="w-full rounded-lg border bg-background p-3 text-[14px] leading-relaxed focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>

        <div>
          <span className="mb-1.5 block text-[13px] font-medium">Format</span>
          <div className="inline-flex rounded-lg border p-0.5">
            {[
              [1, "Single image"],
              [3, "Carousel"],
            ].map(([n, label]) => (
              <button
                key={label}
                type="button"
                onClick={() => setSlides(Number(n))}
                className={`rounded-md px-3 py-1.5 text-[13px] ${
                  (slides > 1) === (Number(n) > 1)
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {slides > 1 ? (
            <label className="ml-3 inline-flex items-center gap-2 text-[13px] text-muted-foreground">
              <input
                type="number"
                min={2}
                max={10}
                value={slides}
                onChange={e =>
                  setSlides(Math.max(2, Math.min(10, Number(e.target.value))))
                }
                className="h-8 w-14 rounded-md border bg-background px-2 text-[13px] text-foreground"
              />
              slides
            </label>
          ) : null}
        </div>

        <div>
          <span className="mb-1.5 block text-[13px] font-medium">Pillar</span>
          <div className="flex flex-wrap gap-1.5">
            {choices.map(p => (
              <button
                key={p}
                type="button"
                onClick={() => setPillar(p)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] capitalize ${
                  pillar === p
                    ? "border-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: pillarColor(p, choices) }}
                />
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="border-t px-5 py-4">
        <button
          type="button"
          disabled={busy || !topic.trim()}
          onClick={() => void create()}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-[14px] font-semibold text-primary-foreground disabled:opacity-50"
        >
          {busy ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          Create the post
        </button>
        <p className="mt-2 text-center text-[12px] text-muted-foreground">
          The caption comes back in a few seconds, the picture in a couple of
          minutes.
        </p>
      </div>
    </>
  );
}

function PostSheet({
  post,
  pillars,
  onChanged,
  onClose,
}: {
  post: Post | null;
  pillars: string[];
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const update = useAction(api.social.updatePost);
  const regenerate = useAction(api.social.generatePost);
  const remove = useAction(api.social.removePost);
  const move = useAction(api.social.schedulePost);

  const [slide, setSlide] = useState(0);
  const [caption, setCaption] = useState(post?.caption ?? "");
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(false);
  const lastId = useRef(post?.id);

  // A different post, or its caption arriving from Salma: refresh the
  // editor -- but never over words somebody is in the middle of typing.
  useEffect(() => {
    if (!post) return;
    if (lastId.current !== post.id) {
      lastId.current = post.id;
      setSlide(0);
      setCaption(post.caption ?? "");
      setSaved("idle");
    } else if (saved === "idle" && !caption && post.caption) {
      setCaption(post.caption);
    }
  }, [post, caption, saved]);

  if (!post)
    return (
      <>
        <SheetHead title="Post" onClose={onClose} />
        <p className="p-5 text-[13px] text-muted-foreground">
          That post is no longer here.
        </p>
      </>
    );

  const images = post.images ?? [];
  const s = stateOf(post);
  const day = String(post.scheduled_at ?? "").slice(0, 10);

  async function saveCaption() {
    if (!post || caption === (post.caption ?? "")) return;
    setSaved("saving");
    try {
      await update({ postId: post.id, caption });
      setSaved("saved");
      await onChanged();
    } catch (e) {
      setSaved("idle");
      toast.error(message(e));
    }
  }

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
      <SheetHead title={day ? dayLabel(day) : "Post"} onClose={onClose} />
      <div className="flex-1 overflow-y-auto">
        <div className="relative aspect-[4/5] w-full bg-muted">
          {images.length ? (
            <button
              type="button"
              onClick={() => setZoom(true)}
              className="block h-full w-full"
              aria-label="See it full size"
            >
              <img
                src={images[slide]}
                alt=""
                className="h-full w-full object-cover"
              />
            </button>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
              {s === "attention" ? (
                <p className="text-[13px] text-destructive">{post.error}</p>
              ) : (
                <>
                  <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
                  <p className="text-[13px] text-muted-foreground">
                    The picture is being made. It takes a couple of minutes.
                  </p>
                </>
              )}
            </div>
          )}
          {images.length > 1 ? (
            <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
              {images.map((u, i) => (
                <button
                  key={u}
                  type="button"
                  aria-label={`Slide ${i + 1}`}
                  onClick={() => setSlide(i)}
                  className={`h-1.5 rounded-full transition-all ${
                    i === slide ? "w-5 bg-white" : "w-1.5 bg-white/60"
                  }`}
                />
              ))}
            </div>
          ) : null}
        </div>

        <div className="space-y-5 px-5 py-5">
          <div className="flex items-center gap-2 text-[13px]">
            <StateDot post={post} />
            <span className="font-medium">{STATE[s].label}</span>
            <span className="text-muted-foreground">
              <span
                className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
                style={{ background: pillarColor(post.pillar, pillars) }}
              />
              <span className="capitalize">{post.pillar}</span>
            </span>
          </div>

          {post.topic ? (
            <p className="text-[14px] font-medium leading-snug" dir="auto">
              {post.topic}
            </p>
          ) : null}

          <div>
            <label
              htmlFor={`caption-${post.id}`}
              className="mb-1.5 flex items-center text-[13px] font-medium"
            >
              Caption
              <span className="ml-auto text-[12px] font-normal text-muted-foreground">
                {saved === "saving"
                  ? "Saving"
                  : saved === "saved"
                    ? "Saved"
                    : ""}
              </span>
            </label>
            {post.caption || caption ? (
              <textarea
                id={`caption-${post.id}`}
                value={caption}
                onChange={e => {
                  setCaption(e.target.value);
                  setSaved("idle");
                }}
                onBlur={() => void saveCaption()}
                rows={7}
                dir="auto"
                className="w-full rounded-lg border bg-background p-3 text-[14px] leading-relaxed focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            ) : (
              <p className="rounded-lg border border-dashed p-3 text-[13px] text-muted-foreground">
                The caption is being written.
              </p>
            )}
          </div>

          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium">
              Goes out on
            </span>
            <input
              type="date"
              value={day}
              min={today()}
              onChange={e => {
                const d = e.target.value;
                if (d)
                  void act(
                    () => move({ postId: post.id, when: `${d}T07:00:00Z` }),
                    "Moved.",
                  );
              }}
              className="h-9 rounded-lg border bg-background px-3 text-[13px]"
            />
          </label>
        </div>
      </div>

      <div className="flex gap-2 border-t px-5 py-4">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void act(
              () => regenerate({ postId: post.id }),
              "A new picture is on its way.",
            )
          }
          className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg border text-[13px] font-medium hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className="h-4 w-4" />
          {images.length ? "New picture" : "Make the picture"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (!window.confirm("Remove this post from the month?")) return;
            void act(async () => {
              await remove({ postId: post.id });
              onClose();
            }, "Removed.");
          }}
          aria-label="Remove the post"
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {zoom && images.length ? (
        <button
          type="button"
          aria-label="Close the picture"
          onClick={() => setZoom(false)}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-6"
        >
          <img
            src={images[slide]}
            alt=""
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        </button>
      ) : null}
    </>
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
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await configure({
        clientTaskId: client.taskId,
        pillars,
        dialect: dialect.trim(),
        postsPerMonth: Math.max(1, Math.min(60, Number(perMonth) || 12)),
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
      <SheetHead title={`${client.name} settings`} onClose={onClose} />
      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium">
            Posts a month
          </span>
          <input
            type="number"
            min={1}
            max={60}
            value={perMonth}
            onChange={e => setPerMonth(e.target.value)}
            className="h-9 w-24 rounded-lg border bg-background px-3 text-[14px]"
          />
          <span className="mt-1.5 block text-[12px] text-muted-foreground">
            What "Fill the month" plans up to.
          </span>
        </label>

        <div>
          <span className="mb-1.5 block text-[13px] font-medium">Pillars</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {pillars.map(p => (
              <span
                key={p}
                className="inline-flex items-center gap-1.5 rounded-full border py-1 pl-2.5 pr-1 text-[13px] capitalize"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: pillarColor(p, pillars) }}
                />
                {p}
                <button
                  type="button"
                  aria-label={`Remove ${p}`}
                  onClick={() => setPillars(pillars.filter(x => x !== p))}
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3 w-3" />
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
              className="h-8 w-28 rounded-full border bg-background px-3 text-[13px]"
            />
          </div>
          <span className="mt-1.5 block text-[12px] text-muted-foreground">
            The kinds of post this client gets. A filled month takes them in
            turn.
          </span>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium">
            Caption dialect
          </span>
          <input
            value={dialect}
            onChange={e => setDialect(e.target.value)}
            placeholder="Saudi (Najdi)"
            className="h-9 w-full rounded-lg border bg-background px-3 text-[14px]"
          />
          <span className="mt-1.5 block text-[12px] text-muted-foreground">
            The client's own voice. Brand, offer and do's and don'ts come from
            their ClickUp card.
          </span>
        </label>
      </div>
      <div className="flex items-center gap-2 border-t px-5 py-4">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void (async () => {
              if (!window.confirm(`Take ${client.name} off social media?`))
                return;
              await setActive({ clientTaskId: client.taskId, active: false });
              await onChanged();
              onClose();
            })()
          }
          className="h-10 rounded-lg px-3 text-[13px] text-muted-foreground hover:bg-muted hover:text-destructive"
        >
          Take off the package
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="ml-auto h-10 rounded-lg bg-primary px-5 text-[14px] font-semibold text-primary-foreground disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </>
  );
}
