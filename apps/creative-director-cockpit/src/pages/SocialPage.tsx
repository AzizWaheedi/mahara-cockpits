import { useAction } from "convex/react";
import {
  CalendarClock,
  Check,
  ChevronRight,
  LoaderCircle,
  PlugZap,
  Plus,
  Share2,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";

/**
 * Social media management.
 *
 * The workflow locked on 2026-09-18: three pillars, a monthly batch, a
 * written plan approved before anything is generated, an internal review by
 * somebody who did not generate it, then the client approves in GoHighLevel
 * and GHL publishes natively.
 *
 * The roster is grouped by batch day and pillar mix rather than
 * alphabetically, and that is not a display preference -- it is the whole
 * time-leverage mechanic. One reviewer does every client's Craft work in
 * one sitting instead of taking each client end to end, which is what
 * makes twenty minutes a client a month possible at twelve clients.
 */
const PILLARS = ["portfolio", "craft", "education"] as const;
type Pillar = (typeof PILLARS)[number];

const PILLAR_LABEL: Record<Pillar, string> = {
  portfolio: "Portfolio",
  craft: "Craft",
  education: "Education",
};

const PILLAR_WHY: Record<Pillar, string> = {
  portfolio: "Project and spec showcase. Needs live project photos this cycle.",
  craft: "Tactile, detail-framed product and material work.",
  education:
    "Question-led hooks, from what this client's audience actually asks.",
};

type Client = {
  taskId: string;
  name: string;
  clientStatus: string | null;
  active: boolean;
  pillars: string[];
  postsPerMonth: number | null;
  batchDay: number | null;
  dialect: string | null;
  ghlLocationId: string | null;
  onboarding: {
    socials: boolean;
    tested: boolean;
    slots: boolean;
    bank: boolean;
  };
  batch: { id: string; status: string; mix: Record<string, number> } | null;
};

/** The three waits, kept apart on purpose: a plan nobody has approved is
 *  ours to act on, a batch sitting with the client is theirs, and mixing
 *  them makes the second look like a backlog when it is not. */
type Waiting = { id: string; client: string; month: string; status: string };

function queues(pending: {
  awaitingPlanApproval?: Waiting[];
  awaitingInternalReview?: Waiting[];
  withClient?: Waiting[];
}): { label: string; clients: string[] }[] {
  return [
    { label: "Plan to approve", list: pending.awaitingPlanApproval },
    { label: "Internal review", list: pending.awaitingInternalReview },
    { label: "With the client", list: pending.withClient },
  ]
    .filter(q => q.list?.length)
    .map(q => ({ label: q.label, clients: (q.list ?? []).map(b => b.client) }));
}

type BankItem = {
  id: string;
  kind: string;
  text: string;
  pillar: string | null;
  source: string | null;
  active: boolean;
  at: string;
};

function serverMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  return (
    raw
      .split("\n")[0]
      .replace(/^\[.*?]\s*/, "")
      .trim() || "That did not go through."
  );
}

/** "Batch day 3" groups; clients with no day set come last, together. */
function byBatchDay(clients: Client[]): [string, Client[]][] {
  const groups = new Map<string, Client[]>();
  for (const c of clients) {
    const key = c.batchDay ? `Batch day ${c.batchDay}` : "No batch day yet";
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups.entries()].sort((a, b) => {
    if (a[0].startsWith("No")) return 1;
    if (b[0].startsWith("No")) return -1;
    return Number(a[0].replace(/\D/g, "")) - Number(b[0].replace(/\D/g, ""));
  });
}

function Pill({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
        on
          ? "border-transparent bg-foreground text-background"
          : "text-muted-foreground"
      }`}
    >
      {children}
    </span>
  );
}

/** Onboarding is four things, and the screen says which are missing rather
 *  than showing one tick that hides three gaps. */
function Onboarding({ c }: { c: Client }) {
  const steps: [keyof Client["onboarding"], string][] = [
    ["socials", "socials connected"],
    ["tested", "test post"],
    ["slots", "calendar slots"],
    ["bank", "content bank"],
  ];
  const missing = steps.filter(([k]) => !c.onboarding[k]);
  if (!missing.length)
    return (
      <span
        className="flex items-center gap-1 text-[11px]"
        style={{ color: "var(--success)" }}
      >
        <Check className="h-3 w-3" /> onboarded
      </span>
    );
  return (
    <span className="text-[11px] text-muted-foreground">
      waiting on {missing.map(([, label]) => label).join(", ")}
    </span>
  );
}

function ClientRow({
  c,
  onToggle,
  onOpen,
  busy,
}: {
  c: Client;
  onToggle: () => void;
  onOpen: () => void;
  busy: boolean;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-3 py-2 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        aria-pressed={c.active}
        title={c.active ? "On social media management" : "Not on the package"}
        className={`h-4 w-8 shrink-0 rounded-full transition disabled:opacity-50 ${
          c.active ? "bg-foreground" : "bg-muted"
        }`}
      >
        <span
          className={`block h-3 w-3 rounded-full bg-background transition ${
            c.active ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>

      <button
        type="button"
        onClick={onOpen}
        className="text-[13px] font-semibold hover:underline"
      >
        {c.name}
      </button>

      {c.active ? (
        <>
          <span className="flex flex-wrap gap-1">
            {PILLARS.map(p => (
              <Pill key={p} on={c.pillars.includes(p)}>
                {PILLAR_LABEL[p]}
              </Pill>
            ))}
          </span>
          <span className="text-[12px] text-muted-foreground tabular-nums">
            {c.postsPerMonth ?? "—"}/mo
          </span>
          <Onboarding c={c} />
          <span className="ml-auto flex items-center gap-2">
            {c.batch ? (
              <span className="rounded-full border px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                {c.batch.status.replace(/_/g, " ")}
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground">
                no batch this month
              </span>
            )}
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          </span>
        </>
      ) : (
        <span className="ml-auto text-[12px] text-muted-foreground">
          not on the package
        </span>
      )}
    </li>
  );
}

/** The Content Bank for one client: what their audience asks, and every
 *  correction anybody has made. */
function Bank({ clientTaskId }: { clientTaskId: string }) {
  const read = useAction(api.social.bank);
  const add = useAction(api.social.bankAdd);
  const retire = useAction(api.social.bankRetire);
  const alive = useRef(true);
  const [items, setItems] = useState<BankItem[] | null>(null);
  const [text, setText] = useState("");
  const [kind, setKind] = useState("question");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const out = await read({ clientTaskId });
      if (alive.current) setItems(out as BankItem[]);
    } catch (e) {
      toast.error(serverMessage(e));
    }
  }, [read, clientTaskId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await add({ clientTaskId, text, kind });
      setText("");
      await load();
    } catch (e) {
      toast.error(serverMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const live = (items ?? []).filter(i => i.active);
  const retired = (items ?? []).filter(i => !i.active);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <select
          value={kind}
          onChange={e => setKind(e.target.value)}
          aria-label="Kind"
          className="h-8 rounded-md border bg-background px-2 text-[12px]"
        >
          <option value="question">Question</option>
          <option value="objection">Objection</option>
          <option value="correction">Correction</option>
        </select>
        <input
          id="bank-text"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") void submit();
          }}
          dir="auto"
          placeholder="What they actually ask, or what somebody said was wrong"
          className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-[13px]"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !text.trim()}
          className="flex h-8 items-center gap-1 rounded-md border px-2.5 text-[12px] font-semibold hover:bg-muted disabled:opacity-50"
        >
          <Plus className="h-3 w-3" />
          Add
        </button>
      </div>

      {items === null ? (
        <p className="flex items-center gap-2 py-3 text-[13px] text-muted-foreground">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Reading the bank
        </p>
      ) : !live.length ? (
        <p className="py-3 text-[13px] text-muted-foreground">
          Nothing here yet. This is the raw material for the Education pillar,
          so it is worth filling from real comments and real objections rather
          than inventing questions each cycle.
        </p>
      ) : (
        <ul className="space-y-1">
          {live.map(i => (
            <li key={i.id} className="flex items-start gap-2 py-1">
              <span
                className="mt-0.5 shrink-0 rounded-full border px-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground"
                title={i.source ?? undefined}
              >
                {i.kind}
              </span>
              <p dir="auto" className="min-w-0 flex-1 text-[13px]">
                {i.text}
              </p>
              <button
                type="button"
                onClick={async () => {
                  await retire({ id: i.id });
                  await load();
                }}
                className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground"
              >
                retire
              </button>
            </li>
          ))}
        </ul>
      )}
      {retired.length ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {retired.length} retired, kept as a record of what was asked once.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Ask GoHighLevel what it actually holds for this client.
 *
 * Worth a button rather than a stored tick: GHL keeps an account row
 * after the OAuth behind it has lapsed, so the only honest answer comes
 * from asking. Run it at onboarding and again whenever a post fails.
 */
function Connection({ clientTaskId }: { clientTaskId: string }) {
  const check = useAction(api.social.checkConnection);
  const [state, setState] = useState<"idle" | "checking">("idle");
  const [said, setSaid] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={state === "checking"}
        onClick={async () => {
          setState("checking");
          setSaid(null);
          try {
            const out = (await check({ clientTaskId })) as {
              connected: number;
              platforms: string[];
            };
            setSaid(
              out.connected
                ? `${out.platforms.join(", ")} connected`
                : "GoHighLevel holds no social account for this client yet.",
            );
          } catch (e) {
            setSaid(serverMessage(e));
          } finally {
            setState("idle");
          }
        }}
        className="flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-semibold hover:bg-muted disabled:opacity-50"
      >
        <PlugZap className="h-3 w-3" />
        {state === "checking" ? "Asking GoHighLevel" : "Check the connection"}
      </button>
      {said ? (
        <span className="text-[12px] text-muted-foreground">{said}</span>
      ) : null}
    </div>
  );
}

type Post = {
  id: string;
  n: number;
  pillar: string;
  topic: string | null;
  slides: number;
  caption_direction: string | null;
  caption: string | null;
  status: string;
};

/**
 * One client's month: the mix, the plan, and the two decisions.
 *
 * The plan is the cheap checkpoint the whole cost model rests on -- a
 * wrong direction caught here costs nothing and caught after generation
 * costs money. So the topics are shown in full and the approve button is
 * below all of them, not above.
 */
function Month({ c, onChanged }: { c: Client; onChanged: () => void }) {
  const read = useAction(api.social.batch);
  const setMix = useAction(api.social.setMix);
  const writePlan = useAction(api.social.writePlan);
  const approve = useAction(api.social.approvePlan);
  const generate = useAction(api.social.generateBatch);
  const pass = useAction(api.social.passReview);

  const alive = useRef(true);
  // biome-ignore lint/suspicious/noExplicitAny: the batch row as GHL/Supabase give it
  const [batch, setBatch] = useState<any>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [month, setMonth] = useState("");
  const [busy, setBusy] = useState(false);
  const [mix, setLocalMix] = useState<Record<string, number>>({
    portfolio: 4,
    craft: 4,
    education: 4,
  });

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const out = (await read({ clientTaskId: c.taskId })) as {
        month: string;
        // biome-ignore lint/suspicious/noExplicitAny: same
        batch: any;
        posts: Post[];
      };
      if (!alive.current) return;
      setMonth(out.month);
      setBatch(out.batch);
      setPosts(out.posts ?? []);
      if (out.batch?.mix) setLocalMix({ ...mix, ...out.batch.mix });
    } catch (e) {
      toast.error(serverMessage(e));
    }
    // biome-ignore lint/correctness/useExhaustiveDependencies: mix is seeded, not tracked
  }, [read, c.taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(what: () => Promise<unknown>, said: string) {
    setBusy(true);
    try {
      await what();
      toast.success(said);
      await load();
      onChanged();
    } catch (e) {
      toast.error(serverMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const status = String(batch?.status ?? "");
  const total = PILLARS.reduce((n, p) => n + (mix[p] ?? 0), 0);
  const withCaption = posts.filter(p => p.caption).length;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="text-[12px] font-semibold">This month</p>
        <span className="text-[12px] text-muted-foreground">{month}</span>
        {status ? (
          <span className="rounded-full border px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
            {status.replace(/_/g, " ")}
          </span>
        ) : null}
      </div>

      {/* Phase 1: how many of each, on what material exists this cycle. */}
      <div className="mb-2 flex flex-wrap items-end gap-3">
        {PILLARS.map(p => (
          <label
            key={p}
            htmlFor={`mix-${c.taskId}-${p}`}
            className="text-[12px] font-semibold"
          >
            {PILLAR_LABEL[p]}
            <input
              id={`mix-${c.taskId}-${p}`}
              type="number"
              min={0}
              max={30}
              value={mix[p] ?? 0}
              disabled={busy || !["", "planning", "planned"].includes(status)}
              onChange={e =>
                setLocalMix({ ...mix, [p]: Number(e.target.value) })
              }
              className="mt-1 block h-8 w-16 rounded-md border bg-background px-2 text-[13px] font-normal tabular-nums disabled:opacity-50"
            />
          </label>
        ))}
        <span className="pb-1.5 text-[12px] text-muted-foreground tabular-nums">
          {total} posts
        </span>
        {["", "planning", "planned"].includes(status) ? (
          <button
            type="button"
            disabled={busy || !total}
            onClick={() =>
              run(
                () => setMix({ clientTaskId: c.taskId, mix }),
                "Mix saved for the month.",
              )
            }
            className="mb-0.5 h-8 rounded-md border px-2.5 text-[12px] font-semibold hover:bg-muted disabled:opacity-50"
          >
            Save the mix
          </button>
        ) : null}
      </div>

      {!batch ? (
        <p className="text-[12px] text-muted-foreground">
          No batch yet for {month}. Set the mix and save it to start one.
        </p>
      ) : null}

      {status === "planning" ? (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            run(
              () => writePlan({ clientTaskId: c.taskId }),
              "Queued. Salma writes the plan within five minutes.",
            )
          }
          className="h-8 rounded-md border px-2.5 text-[12px] font-semibold hover:bg-muted disabled:opacity-50"
        >
          Write the plan
        </button>
      ) : null}

      {posts.length ? (
        <>
          <ol className="my-2 space-y-1.5 border-t pt-2">
            {posts.map(p => (
              <li key={p.id} className="text-[13px]">
                <span className="mr-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  {p.pillar}
                </span>
                <span dir="auto">{p.topic}</span>
                <span className="ml-1.5 text-[11px] text-muted-foreground tabular-nums">
                  {p.slides} {p.slides === 1 ? "slide" : "slides"}
                </span>
                {p.caption_direction ? (
                  <p className="text-[12px] text-muted-foreground" dir="auto">
                    {p.caption_direction}
                  </p>
                ) : null}
                {p.caption ? (
                  <p
                    className="mt-0.5 rounded bg-muted/40 px-2 py-1 text-[12px]"
                    dir="auto"
                  >
                    {p.caption}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>

          <div className="flex flex-wrap items-center gap-2">
            {status === "planned" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(
                    () => approve({ batchId: String(batch.id) }),
                    "Approved. Nothing is generated until you press the next one.",
                  )
                }
                className="h-8 rounded-md border border-transparent bg-foreground px-2.5 text-[12px] font-semibold text-background disabled:opacity-50"
              >
                The plan is right
              </button>
            ) : null}
            {status === "approved" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(
                    () => generate({ batchId: String(batch.id) }),
                    "Queued. Captions come back first, then images.",
                  )
                }
                className="h-8 rounded-md border border-transparent bg-foreground px-2.5 text-[12px] font-semibold text-background disabled:opacity-50"
              >
                Generate the batch
              </button>
            ) : null}
            {status === "generating" ? (
              <>
                <span className="text-[12px] text-muted-foreground tabular-nums">
                  {withCaption} of {posts.length} written
                </span>
                <button
                  type="button"
                  disabled={busy || withCaption < posts.length}
                  onClick={() =>
                    run(
                      () => pass({ batchId: String(batch.id) }),
                      "Marked reviewed. It can go to the client now.",
                    )
                  }
                  className="h-8 rounded-md border px-2.5 text-[12px] font-semibold hover:bg-muted disabled:opacity-50"
                >
                  I have read it all
                </button>
              </>
            ) : null}
            {batch?.error ? (
              <span
                className="text-[12px]"
                style={{ color: "var(--destructive)" }}
              >
                {String(batch.error).slice(0, 160)}
              </span>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function ClientPanel({
  c,
  onChanged,
  onClose,
}: {
  c: Client;
  onChanged: () => void;
  onClose: () => void;
}) {
  const configure = useAction(api.social.configure);
  const step = useAction(api.social.onboardingStep);
  const [busy, setBusy] = useState(false);

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    try {
      await configure({ clientTaskId: c.taskId, ...patch });
      onChanged();
    } catch (e) {
      toast.error(serverMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <h3 className="text-[13px] font-bold">{c.name}</h3>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto text-[12px] text-muted-foreground hover:text-foreground"
        >
          Close
        </button>
      </div>

      <div className="space-y-4 p-3">
        <div>
          <p className="mb-1.5 text-[12px] font-semibold">Pillars</p>
          <div className="flex flex-wrap gap-1.5">
            {PILLARS.map(p => {
              const on = c.pillars.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  disabled={busy}
                  title={PILLAR_WHY[p]}
                  onClick={() =>
                    save({
                      pillars: on
                        ? c.pillars.filter(x => x !== p)
                        : [...c.pillars, p],
                    })
                  }
                  className={`rounded-full border px-2.5 py-0.5 text-[12px] font-semibold disabled:opacity-50 ${
                    on
                      ? "border-transparent bg-foreground text-background"
                      : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {PILLAR_LABEL[p]}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            A client with no live project photos this cycle should drop
            Portfolio rather than post something stale.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label
            htmlFor={`ppm-${c.taskId}`}
            className="text-[12px] font-semibold"
          >
            Posts a month
            <input
              id={`ppm-${c.taskId}`}
              type="number"
              min={1}
              max={60}
              defaultValue={c.postsPerMonth ?? 12}
              onBlur={e => save({ postsPerMonth: Number(e.target.value) })}
              className="mt-1 block h-8 w-20 rounded-md border bg-background px-2 text-[13px] font-normal tabular-nums"
            />
          </label>
          <label
            htmlFor={`day-${c.taskId}`}
            className="text-[12px] font-semibold"
          >
            Batch day
            <input
              id={`day-${c.taskId}`}
              type="number"
              min={1}
              max={28}
              defaultValue={c.batchDay ?? 1}
              onBlur={e => save({ batchDay: Number(e.target.value) })}
              className="mt-1 block h-8 w-20 rounded-md border bg-background px-2 text-[13px] font-normal tabular-nums"
            />
          </label>
          <label
            htmlFor={`dia-${c.taskId}`}
            className="text-[12px] font-semibold"
          >
            Dialect
            <input
              id={`dia-${c.taskId}`}
              defaultValue={c.dialect ?? ""}
              onBlur={e => save({ dialect: e.target.value })}
              placeholder="e.g. Khaleeji, Egyptian"
              className="mt-1 block h-8 w-40 rounded-md border bg-background px-2 text-[13px] font-normal"
            />
          </label>
          <label
            htmlFor={`ghl-${c.taskId}`}
            className="text-[12px] font-semibold"
          >
            GHL sub-account
            <input
              id={`ghl-${c.taskId}`}
              defaultValue={c.ghlLocationId ?? ""}
              onBlur={e => save({ ghlLocationId: e.target.value })}
              placeholder="location id"
              className="mt-1 block h-8 w-56 rounded-md border bg-background px-2 font-mono text-[12px] font-normal"
            />
          </label>
        </div>
        <p className="text-[11px] text-muted-foreground">
          The client's own voice, never Aziz's Kuwaiti one. Captions run through
          the humanizer stack, no em-dashes.
        </p>

        <div>
          <p className="mb-1.5 text-[12px] font-semibold">Onboarding</p>
          <div className="flex flex-wrap gap-3">
            {(
              [
                ["socials", "Socials connected in GHL"],
                ["tested", "Test post as a private draft"],
                ["slots", "Calendar slots pre-blocked"],
                ["bank", "Content Bank has 10-15 items"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex items-center gap-1.5 text-[12px]">
                <input
                  type="checkbox"
                  checked={c.onboarding[k]}
                  onChange={async e => {
                    await step({
                      clientTaskId: c.taskId,
                      step: k,
                      done: e.target.checked,
                    });
                    onChanged();
                  }}
                />
                {label}
              </label>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Their Instagram has to be a Business or Creator account linked to a
            Facebook Page or the connection blocks. Test-post as a private draft
            the moment it is connected, so broken auth shows up now and not
            three weeks later.
          </p>
          <div className="mt-2">
            <Connection clientTaskId={c.taskId} />
          </div>
        </div>

        <div>
          <Month c={c} onChanged={onChanged} />
        </div>

        <div>
          <p className="mb-1.5 text-[12px] font-semibold">Content Bank</p>
          <Bank clientTaskId={c.taskId} />
        </div>
      </div>
    </div>
  );
}

export function SocialPage() {
  const readRoster = useAction(api.social.roster);
  const readPending = useAction(api.social.pending);
  const setActive = useAction(api.social.setActive);

  const alive = useRef(true);
  const [month, setMonth] = useState("");
  const [clients, setClients] = useState<Client[] | null>(null);
  // biome-ignore lint/suspicious/noExplicitAny: the dashboard's own shape
  const [pending, setPending] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [onlyActive, setOnlyActive] = useState(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const [r, p] = await Promise.all([readRoster({}), readPending({})]);
      if (!alive.current) return;
      setMonth((r as { month: string }).month);
      setClients((r as { clients: Client[] }).clients);
      setPending(p);
      setError(null);
    } catch (e) {
      if (alive.current) setError(serverMessage(e));
    }
  }, [readRoster, readPending]);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(
    () => (clients ?? []).filter(c => (onlyActive ? c.active : true)),
    [clients, onlyActive],
  );
  const groups = useMemo(() => byBatchDay(shown), [shown]);
  const on = (clients ?? []).filter(c => c.active).length;
  const chosen = (clients ?? []).find(c => c.taskId === open) ?? null;

  const waiting =
    (pending?.awaitingPlanApproval?.length ?? 0) +
    (pending?.awaitingInternalReview?.length ?? 0);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Share2 className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-[15px] font-bold tracking-tight">Social media</h2>
        <span className="text-[13px] text-muted-foreground">
          {clients ? `${on} on the package · ${month}` : "Loading…"}
        </span>
        <button
          type="button"
          onClick={() => setOnlyActive(v => !v)}
          aria-pressed={!onlyActive}
          className="ml-auto rounded border px-2 py-0.5 text-[12px] font-semibold text-muted-foreground hover:bg-muted"
        >
          {onlyActive ? "Show every client" : "Only clients on the package"}
        </button>
      </div>
      <p className="mb-3 text-[13px] text-muted-foreground">
        Three pillars, a batch a month, and a written plan approved before
        anything is generated. Grouped by batch day so one sitting covers every
        client on the same day rather than one client end to end.
      </p>

      {error ? (
        <div className="callout-bad mb-3 rounded-md border p-2 text-[13px]">
          {error}
        </div>
      ) : null}

      {pending ? (
        <div className="mb-4 rounded-md border p-3">
          <div className="mb-2 flex items-center gap-2">
            <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-[13px] font-semibold">Waiting</p>
            <span className="text-[12px] text-muted-foreground">
              {waiting ? `${waiting} on us` : "nothing on us"}
              {pending.withClient?.length
                ? ` · ${pending.withClient.length} with the client`
                : ""}
            </span>
          </div>
          {waiting || pending.withClient?.length ? (
            <ul className="space-y-1 text-[13px]">
              {queues(pending).map(q => (
                <li key={q.label}>
                  <span className="text-muted-foreground">{q.label}: </span>
                  {q.clients.join(", ")}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              Nothing is sitting unnoticed.
            </p>
          )}
        </div>
      ) : null}

      {chosen ? (
        <div className="mb-4">
          <ClientPanel
            c={chosen}
            onChanged={load}
            onClose={() => setOpen(null)}
          />
        </div>
      ) : null}

      {clients === null && !error ? (
        <p className="flex items-center gap-2 py-8 text-[13px] text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin" /> Reading the roster
        </p>
      ) : null}

      {clients && !shown.length ? (
        <p className="py-8 text-center text-[13px] text-muted-foreground">
          {onlyActive
            ? "No client is on social media management yet. Show every client to turn one on."
            : "No clients on the board."}
        </p>
      ) : null}

      <div className="space-y-4">
        {groups.map(([label, list]) => (
          <div key={label} className="rounded-md border">
            <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-1.5">
              <p className="text-[12px] font-bold">{label}</p>
              <span className="text-[11px] text-muted-foreground">
                {list.length} {list.length === 1 ? "client" : "clients"}
              </span>
            </div>
            <ul>
              {list.map(c => (
                <ClientRow
                  key={c.taskId}
                  c={c}
                  busy={busy === c.taskId}
                  onOpen={() => setOpen(open === c.taskId ? null : c.taskId)}
                  onToggle={async () => {
                    setBusy(c.taskId);
                    try {
                      await setActive({
                        clientTaskId: c.taskId,
                        active: !c.active,
                      });
                      await load();
                    } catch (e) {
                      toast.error(serverMessage(e));
                    } finally {
                      setBusy(null);
                    }
                  }}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export default SocialPage;
