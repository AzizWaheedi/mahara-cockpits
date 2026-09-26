import { Flame, KanbanSquare, RefreshCw } from "lucide-react";
import {
  type DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Link, useNavigate } from "react-router";
import {
  EmptyState,
  Failed,
  Parts,
  StatusChip,
  type Tone,
} from "../components/kit";
import { Segmented } from "../components/ScriptParts";
import { api } from "../lib/api";
import { useLatest, useNow, useQuery } from "../lib/data";
import { ago, classLabel, isArabic, plainStage, when } from "../lib/format";
import { supabase } from "../lib/supabase";
import { toast } from "../lib/toast";
import type { Me } from "../lib/types";

/**
 * The sales pipeline as a board: HighLevel's own stages in order, one card
 * per open lead with its heat, its last touch and its next step. Dragging a
 * card (or picking a stage from its menu) moves the lead in HighLevel; the
 * dialer moves leads by itself after each outcome. A lead with nothing in 60
 * days is quiet: counted under its stage, shown only when asked, so the
 * board stays about the leads being worked.
 */

interface Stage {
  id: string;
  name: string;
  position: number;
  role: string | null;
}

interface Card {
  contact_id: string;
  name: string | null;
  lead_class: string | null;
  stage_id: string | null;
  heat: number;
  reasons: string[];
  hot: boolean;
  last_objection: string | null;
  last_touch_at: string | null;
  wrote_at: string | null;
  next_at: string | null;
  next_what: string | null;
  owner: string | null;
  dnd: boolean;
  quiet: boolean;
}

interface Board {
  pipeline: { id: string; name: string; stages: Stage[] };
  pipelines: { id: string; name: string }[];
  cards: Card[];
  quiet: Record<string, number>;
  loose: number;
}

const ROLE_TONE: Record<string, Tone> = {
  new: "critical",
  hot: "critical",
  intro_booked: "warning",
  intro_confirmed: "good",
  demo_booked: "good",
  deposit: "good",
  intro_noshow: "serious",
  demo_noshow: "serious",
  intro_cancelled: "serious",
  demo_cancelled: "serious",
  no_progress: "neutral",
  nurture_short: "neutral",
  nurture_long: "neutral",
  paused: "neutral",
  disqualified: "neutral",
  lost: "neutral",
  won: "good",
};

const NO_STAGE = "none";

export default function PipelinePage({ me }: { me: Me }) {
  const [pipelineId, setPipelineId] = useState<string>("");
  const [scope, setScope] = useState<"mine" | "team">(
    me.manager ? "team" : "mine",
  );
  const [view, setView] = useState<"board" | "hot">("board");
  const [all, setAll] = useState(false);
  const [board, setBoard] = useState<Board | null>(null);
  // Which choice (pipeline, whose, quiet or not) the board on screen was read for.
  const [boardFor, setBoardFor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const choice = `${pipelineId}|${scope}|${all}`;
  const chosen = useLatest(choice);

  const load = useCallback(async () => {
    const asked = `${pipelineId}|${scope}|${all}`;
    setBusy(true);
    try {
      const out = await api<Board>("pipeline.board", {
        pipeline_id: pipelineId || null,
        scope,
        all,
      });
      // A slow read for a choice no longer on screen (the team's board
      // landing after "Mine" was picked) is dropped, not drawn.
      if (chosen.current !== asked) return;
      setBoard(out);
      // With no pipeline picked yet, the server's pick becomes the choice.
      setBoardFor(pipelineId ? asked : `${out.pipeline.id}|${scope}|${all}`);
      setError(null);
      if (!pipelineId) setPipelineId(out.pipeline.id);
    } catch (e) {
      if (chosen.current !== asked) return;
      setError(String((e as Error).message ?? e));
    } finally {
      if (chosen.current === asked) setBusy(false);
    }
  }, [pipelineId, scope, all, chosen]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60_000);
    return () => window.clearInterval(t);
  }, [load]);

  async function move(contactId: string, stageId: string) {
    if (!board || stageId === NO_STAGE) return;
    const card = board.cards.find(c => c.contact_id === contactId);
    // Dropped back on its own column: nothing to move.
    if (!card || card.stage_id === stageId) return;
    const from = card.stage_id;
    const put = (at: string | null, only?: string | null) =>
      setBoard(b =>
        b
          ? {
              ...b,
              cards: b.cards.map(c =>
                c.contact_id === contactId &&
                (only === undefined || c.stage_id === only)
                  ? { ...c, stage_id: at }
                  : c,
              ),
            }
          : b,
      );
    put(stageId);
    const to = plainStage(
      board.pipeline.stages.find(s => s.id === stageId)?.name,
    );
    try {
      const out = await api<{ move?: { state?: string } }>("pipeline.move", {
        contact_id: contactId,
        stage_id: stageId,
        pipeline_id: board.pipeline.id,
      });
      toast.success(
        out.move?.state === "skipped"
          ? `Already in ${to || "that stage"} in HighLevel, so nothing moved.`
          : `Moved to ${to || "the stage"} in HighLevel.`,
      );
    } catch (e) {
      // Only this card goes back, and only if nothing has moved it since;
      // other moves made meanwhile stay.
      put(from, stageId);
      toast.error(String((e as Error).message ?? e));
    }
  }

  const stages = board?.pipeline.stages ?? [];
  const hasLoose = (board?.cards ?? []).some(c => !c.stage_id);
  const columns = useMemo(
    () => [
      ...(hasLoose
        ? [
            {
              id: NO_STAGE,
              name: "No stage yet",
              position: -1,
              role: "new",
            } as Stage,
          ]
        : []),
      ...stages,
    ],
    [stages, hasLoose],
  );
  const byStage = useMemo(() => {
    const m = new Map<string, Card[]>();
    for (const c of board?.cards ?? []) {
      const k = c.stage_id ?? NO_STAGE;
      m.set(k, [...(m.get(k) ?? []), c]);
    }
    for (const list of m.values())
      list.sort(
        (a, b) =>
          (a.next_at ? Date.parse(a.next_at) : Number.POSITIVE_INFINITY) -
            (b.next_at ? Date.parse(b.next_at) : Number.POSITIVE_INFINITY) ||
          b.heat - a.heat,
      );
    return m;
  }, [board]);
  const quietTotal = Object.values(board?.quiet ?? {}).reduce(
    (a, b) => a + b,
    0,
  );
  // The board on screen was read for what is picked now. Until then its
  // counts and its "no leads" belong to the previous choice, so they wait
  // (the header says it is reading), and after a failed read it goes.
  const fresh = boardFor === choice;
  const empty = !board?.cards.length && !quietTotal;
  const hidden = !board || (!fresh && (Boolean(error) || empty));

  return (
    <main className="mx-auto w-full max-w-[1800px] space-y-4 px-4 py-5 md:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Pipeline</h1>
          <p className="muted text-sm">
            {board && fresh
              ? `${board.cards.length} ${all ? "" : "active "}lead${board.cards.length === 1 ? "" : "s"}${
                  !all && quietTotal ? ` · ${quietTotal} quiet for 60 days` : ""
                }. Drag a card to move it in HighLevel.`
              : error
                ? null
                : "Reading the pipeline…"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {board && board.pipelines.length > 1 ? (
            <select
              aria-label="Pipeline"
              value={pipelineId}
              onChange={e => setPipelineId(e.target.value)}
              className="h-8 rounded-[var(--radius-md)] border hairline bg-[color:var(--background)] px-2 text-sm"
            >
              {board.pipelines.map(p => (
                <option key={p.id} value={p.id}>
                  {plainStage(p.name)}
                </option>
              ))}
            </select>
          ) : null}
          <Segmented
            label="Whose"
            value={scope}
            options={[
              ["mine", "Mine"],
              ["team", "Team"],
            ]}
            onChange={v => setScope(v as "mine" | "team")}
          />
          <Segmented
            label="View"
            value={view}
            options={[
              ["board", "Board"],
              ["hot", "Hot list"],
            ]}
            onChange={v => setView(v as "board" | "hot")}
          />
          <button
            type="button"
            onClick={() => setAll(a => !a)}
            aria-pressed={all}
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] border hairline px-3 text-sm"
          >
            {all ? "Hide quiet leads" : "Show quiet leads"}
          </button>
          <button
            type="button"
            onClick={() => void load()}
            disabled={busy}
            className="muted inline-flex h-8 items-center gap-1 px-1 text-xs"
            aria-label="Read the pipeline again"
          >
            <RefreshCw
              className={`size-3.5 ${busy ? "animate-spin" : ""}`}
              aria-hidden
            />
          </button>
        </div>
      </header>

      {error ? (
        <Failed what="The pipeline" error={error} retry={() => void load()} />
      ) : null}

      {view === "hot" ? (
        <HotList me={me} scope={scope} />
      ) : hidden || !board ? null : empty ? (
        <div className="panel">
          <EmptyState
            icon={KanbanSquare}
            title={
              scope === "mine"
                ? "No leads of yours in this pipeline"
                : "No open leads in this pipeline"
            }
            text={
              scope === "mine"
                ? "Switch to Team to see everyone's."
                : "New leads land here as they come in."
            }
          />
        </div>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4 pb-2 md:-mx-6 md:px-6">
          <div className="flex min-w-max items-start gap-3">
            {columns.map(col => (
              <Column
                key={col.id}
                stage={col}
                stages={stages}
                cards={byStage.get(col.id) ?? []}
                quiet={all ? 0 : (board.quiet[col.id] ?? 0)}
                onMove={move}
                onShowQuiet={() => setAll(true)}
              />
            ))}
          </div>
        </div>
      )}
    </main>
  );
}

function Column({
  stage,
  stages,
  cards,
  quiet,
  onMove,
  onShowQuiet,
}: {
  stage: Stage;
  stages: Stage[];
  cards: Card[];
  quiet: number;
  onMove: (contactId: string, stageId: string) => void;
  onShowQuiet: () => void;
}) {
  const [over, setOver] = useState(false);
  const droppable = stage.id !== NO_STAGE;
  return (
    <section
      aria-label={plainStage(stage.name)}
      onDragOver={e => {
        if (!droppable) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e: DragEvent) => {
        setOver(false);
        const id = e.dataTransfer.getData("text/contact");
        if (id && droppable) onMove(id, stage.id);
      }}
      className={`panel flex w-72 shrink-0 flex-col overflow-hidden ${over ? "ring-2 ring-[color:var(--primary)]" : ""}`}
    >
      <header className="flex items-center gap-2 border-b hairline px-3 py-2">
        <StatusChip
          tone={ROLE_TONE[stage.role ?? ""] ?? "neutral"}
          label={plainStage(stage.name)}
        />
        <span className="muted ms-auto text-xs tabular-nums">
          {cards.length}
        </span>
      </header>
      <ul className="max-h-[calc(100dvh-12.5rem)] min-h-16 space-y-2 overflow-y-auto p-2">
        {cards.map(c => (
          <CardItem key={c.contact_id} c={c} stages={stages} onMove={onMove} />
        ))}
        {!cards.length ? (
          <li className="muted px-1 py-2 text-xs">Nobody here right now.</li>
        ) : null}
      </ul>
      {quiet ? (
        <button
          type="button"
          onClick={onShowQuiet}
          className="muted border-t hairline px-3 py-1.5 text-left text-xs hover:underline"
        >
          {quiet} quiet for 60 days
        </button>
      ) : null}
    </section>
  );
}

function CardItem({
  c,
  stages,
  onMove,
}: {
  c: Card;
  stages: Stage[];
  onMove: (contactId: string, stageId: string) => void;
}) {
  const navigate = useNavigate();
  const now = useNow(60_000);
  return (
    <li
      draggable
      onDragStart={e => {
        e.dataTransfer.setData("text/contact", c.contact_id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className={`group rounded-[var(--radius-md)] border hairline bg-[color:var(--background)] p-2.5 text-sm ${c.quiet ? "opacity-60" : ""}`}
    >
      <button
        type="button"
        onClick={() => navigate(`/lead/${c.contact_id}`)}
        className="block w-full min-w-0 text-left"
      >
        <span className="flex items-start gap-1.5">
          <span
            className={`min-w-0 flex-1 truncate font-medium ${isArabic(c.name) ? "ar" : ""}`}
            dir="auto"
          >
            {c.name ?? "Unnamed lead"}
          </span>
          {c.hot ? (
            <Flame
              className="size-3.5 shrink-0"
              style={{ color: "var(--primary)" }}
              aria-label="On the hot list"
            />
          ) : null}
        </span>
        <span className="muted mt-0.5 block truncate text-xs">
          <Parts
            items={[
              classLabel(c.lead_class),
              c.reasons.find(r => r !== "Qualified"),
              c.wrote_at ? `wrote ${ago(c.wrote_at, now)}` : null,
            ]}
          />
        </span>
        {c.next_at ? (
          <span className="mt-1 block truncate text-xs">
            {c.next_what}: {when(c.next_at)}
          </span>
        ) : c.last_touch_at ? (
          <span className="muted mt-1 block truncate text-xs">
            Last touched {ago(c.last_touch_at, now)}
          </span>
        ) : null}
        {c.last_objection ? (
          <span className="muted mt-0.5 block truncate text-xs" dir="auto">
            Objection: {c.last_objection}
          </span>
        ) : null}
      </button>
      <div className="mt-1.5 flex items-center gap-2">
        {c.owner ? (
          <span className="muted truncate text-[11px]">
            {c.owner.split(/\s+/)[0]}
          </span>
        ) : null}
        <select
          aria-label={`Move ${c.name ?? "this lead"} to`}
          value=""
          onChange={e => e.target.value && onMove(c.contact_id, e.target.value)}
          className="muted ms-auto h-6 max-w-32 rounded border hairline bg-transparent px-1 text-[11px]"
        >
          <option value="">Move to…</option>
          {stages
            .filter(s => s.id !== c.stage_id)
            .map(s => (
              <option key={s.id} value={s.id}>
                {plainStage(s.name)}
              </option>
            ))}
        </select>
      </div>
    </li>
  );
}

interface HotRow {
  contact_id: string;
  owner_email: string;
  next_at: string | null;
  next_how: string | null;
  last_objection: string | null;
  note: string | null;
  updated_at: string;
}

/** Every hot lead, the soonest follow-up first. */
function HotList({ me, scope }: { me: Me; scope: "mine" | "team" }) {
  const hot = useQuery<HotRow[]>(() => {
    let q = supabase
      .from("cockpit_sales_hot")
      .select("*")
      .is("removed_at", null)
      .order("next_at", { ascending: true, nullsFirst: false })
      .limit(500);
    if (scope === "mine") q = q.eq("owner_email", String(me.email ?? ""));
    return q;
  }, [scope, me.email]);
  const ids = (hot.data ?? []).map(h => h.contact_id);
  const names = useQuery<{ contact_id: string; name: string | null }[]>(
    () =>
      ids.length
        ? supabase
            .from("cockpit_sales_leads")
            .select("contact_id,name")
            .in("contact_id", ids.slice(0, 500))
        : Promise.resolve({ data: [], error: null }),
    [ids.join(",")],
  );
  const nameOf = new Map(
    (names.data ?? []).map(n => [n.contact_id, n.name] as const),
  );
  const now = useNow(60_000);
  if (hot.error)
    return <Failed what="The hot list" error={hot.error} retry={hot.reload} />;
  if (!hot.data) return <p className="muted text-sm">Reading the hot list…</p>;
  if (!hot.data.length)
    return (
      <div className="panel">
        <EmptyState
          icon={Flame}
          title="Nobody on the hot list"
          text="Put a lead on it from their page or the dialer: when to follow up, how, and their last objection. They are called first."
        />
      </div>
    );
  return (
    <ul className="panel divide-y hairline overflow-hidden">
      {hot.data.map(h => {
        const due = h.next_at && Date.parse(h.next_at) <= now;
        return (
          <li
            key={h.contact_id}
            className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3"
          >
            <Link
              to={`/lead/${h.contact_id}`}
              className={`min-w-0 flex-1 truncate text-sm font-medium hover:underline ${isArabic(nameOf.get(h.contact_id)) ? "ar" : ""}`}
              dir="auto"
            >
              {nameOf.get(h.contact_id) ?? "A lead"}
            </Link>
            <span
              className="text-sm tabular-nums"
              style={{ color: due ? "var(--destructive)" : undefined }}
            >
              {h.next_at
                ? `${due ? "Due " : ""}${when(h.next_at)}`
                : "No follow-up set"}
              {h.next_how ? ` · ${h.next_how}` : ""}
            </span>
            <span className="muted w-full text-xs">
              {h.last_objection || h.note?.trim() || scope === "team" ? (
                <Parts
                  items={[
                    h.last_objection ? `Objection: ${h.last_objection}` : null,
                    h.note,
                    scope === "team" ? h.owner_email.split("@")[0] : null,
                  ]}
                />
              ) : (
                "No notes"
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
