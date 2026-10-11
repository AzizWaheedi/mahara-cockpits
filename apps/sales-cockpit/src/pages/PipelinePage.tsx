import { Flame, KanbanSquare, RefreshCw } from "lucide-react";
import {
  type DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useNavigate, useSearchParams } from "react-router";
import { HotSheet } from "../components/HotSheet";
import {
  AnimatedSelect,
  EmptyState,
  Failed,
  Parts,
  StatusChip,
  type Tone,
} from "../components/kit";
import { Segmented } from "../components/ScriptParts";
import { api } from "../lib/api";
import { CLIENT_NOTE } from "../lib/clients";
import { useLatest, useNow } from "../lib/data";
import {
  ago,
  classLabel,
  day,
  isArabic,
  money,
  plainStage,
  when,
} from "../lib/format";
import { toast } from "../lib/toast";
import type { Me } from "../lib/types";

/**
 * The sales pipeline as a board: HighLevel's own stages in order, one card
 * per open lead with its heat, its last touch and its next step. Dragging a
 * card (or picking a stage from its menu) moves the lead in HighLevel; the
 * dialer moves leads by itself after each outcome. A lead with nothing in 60
 * days is quiet: counted under its stage, shown only when asked, so the
 * board stays about the leads being worked.
 *
 * Signed clients stay on it (the CEO, 2026-10-11): an active client (tagged
 * client, or a signed deal) sits in the pipeline's Closed column with the
 * date they signed, the value and who closed them, newest first. Their card
 * cannot be dragged or moved, because a HighLevel stage's workflows could
 * message a client; it opens the lead page. The column's header counts
 * signed clients apart from open leads.
 */

export interface Stage {
  id: string;
  name: string;
  position: number;
  role: string | null;
}

export interface Card {
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
  /** An active client: tagged client, or a signed deal. Never moved. */
  client?: boolean;
  /** Placed in the Closed column (a client, a won opportunity, a won stage). */
  closed?: boolean;
  /** The newest live deal's date, value, closer and setter; null when unknown. */
  signed_at?: string | null;
  value?: number | null;
  closer?: string | null;
  setter?: string | null;
  /** HighLevel's real stage, when the card sits in Closed. */
  crm_stage?: string | null;
}

export interface Board {
  pipeline: { id: string; name: string; stages: Stage[] };
  pipelines: { id: string; name: string }[];
  cards: Card[];
  quiet: Record<string, number>;
  loose: number;
  /** Where signed and closed leads sit; synthetic when the pipeline has no won stage. */
  closed_stage?: { id: string; name: string; synthetic: boolean } | null;
  /** The Closed column's header: open leads apart from signed clients. */
  counts?: { open: number; signed: number };
}

/**
 * The answer, checked before it is drawn: a board without its pipeline's
 * stages or its cards is a failed read, said as one, never a blank page.
 */
export function boardProblem(out: unknown): string | null {
  const b = out as Partial<Board> | null;
  if (!b || typeof b !== "object") return "the answer was empty";
  if (!b.pipeline || !Array.isArray(b.pipeline.stages))
    return "the answer had no pipeline stages in it";
  if (!Array.isArray(b.cards)) return "the answer had no cards in it";
  if (!Array.isArray(b.pipelines)) return "the answer had no pipelines in it";
  return null;
}

/** "6 open · 69 signed": the Closed column's header, the zeros left out. */
export function closedHeader(counts: { open: number; signed: number }): string {
  const parts = [
    counts.open ? `${counts.open} open` : null,
    counts.signed ? `${counts.signed} signed` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "0";
}

/** The Closed column keeps the server's order (newest signing first); the rest go by next step, then heat. */
export function columnOrder(cards: readonly Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const closed = Number(Boolean(b.closed)) - Number(Boolean(a.closed));
    if (closed || (a.closed && b.closed)) return closed;
    return (
      (a.next_at ? Date.parse(a.next_at) : Number.POSITIVE_INFINITY) -
        (b.next_at ? Date.parse(b.next_at) : Number.POSITIVE_INFINITY) ||
      b.heat - a.heat
    );
  });
}

/** A card that cannot be moved from the board: an active client. */
export const fixed = (c: Pick<Card, "client">) => c.client === true;

/** The chip on a client's card: the day they signed, or the tag alone. */
export function signedLabel(c: Pick<Card, "signed_at">): string {
  return c.signed_at ? `Signed ${day(c.signed_at)}` : "Active client";
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
  // The view sits in the address (?view=hot), so the hot list can be linked
  // to and stays open across a reload.
  const [params, setParams] = useSearchParams();
  const view: "board" | "hot" = params.get("view") === "hot" ? "hot" : "board";
  const setView = (v: "board" | "hot") =>
    setParams(
      p => {
        const next = new URLSearchParams(p);
        if (v === "hot") next.set("view", "hot");
        else next.delete("view");
        return next;
      },
      { replace: true },
    );
  // Bumped by the refresh button while the hot list is open.
  const [hotNonce, setHotNonce] = useState(0);
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
      const problem = boardProblem(out);
      if (problem) throw new Error(problem);
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

  // The board is read while it is the view; the hot list reads its own rows.
  useEffect(() => {
    if (view !== "board") return;
    void load();
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60_000);
    return () => window.clearInterval(t);
  }, [load, view]);

  async function move(contactId: string, stageId: string) {
    if (!board || stageId === NO_STAGE) return;
    const card = board.cards.find(c => c.contact_id === contactId);
    // Dropped back on its own column: nothing to move.
    if (!card || card.stage_id === stageId) return;
    // A client stays in Closed; the server refuses it too.
    if (fixed(card)) {
      toast.error(
        "This client is signed, so they stay in Closed. Client success looks after them.",
      );
      return;
    }
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
  const closedStage = board?.closed_stage ?? null;
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
      // A pipeline with no won stage: the cockpit's own column for its clients.
      ...(closedStage?.synthetic
        ? [
            {
              id: closedStage.id,
              name: closedStage.name,
              position: Number.MAX_SAFE_INTEGER,
              role: "won",
            } as Stage,
          ]
        : []),
    ],
    [stages, hasLoose, closedStage],
  );
  const byStage = useMemo(() => {
    const m = new Map<string, Card[]>();
    for (const c of board?.cards ?? []) {
      const k = c.stage_id ?? NO_STAGE;
      m.set(k, [...(m.get(k) ?? []), c]);
    }
    for (const [k, list] of m) m.set(k, columnOrder(list));
    return m;
  }, [board]);
  // Leads being worked: the cards that are not clients.
  const working = (board?.cards ?? []).filter(c => !c.client).length;
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
            {view === "hot"
              ? "The leads closest to signing. Click a cell to change it; it saves when you press Enter or click away."
              : board && fresh
                ? `${working} ${all ? "" : "active "}lead${working === 1 ? "" : "s"}${
                    !all && quietTotal
                      ? ` · ${quietTotal} quiet for 60 days`
                      : ""
                  }${
                    board.counts?.signed
                      ? ` · ${board.counts.signed} signed${closedStage && !closedStage.synthetic ? ` in ${plainStage(closedStage.name)}` : ""}`
                      : ""
                  }. Drag a card to move it in HighLevel.`
                : error
                  ? null
                  : "Reading the pipeline…"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {view === "board" && board && board.pipelines.length > 1 ? (
            <AnimatedSelect
              aria-label="Pipeline"
              value={pipelineId}
              onChange={e => setPipelineId(e.target.value)}
              className="h-8 rounded-[12px] border border-white/10 bg-[color:var(--background)] px-2.5 text-sm"
            >
              {board.pipelines.map(p => (
                <option key={p.id} value={p.id}>
                  {plainStage(p.name)}
                </option>
              ))}
            </AnimatedSelect>
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
          {view === "board" ? (
            <button
              type="button"
              onClick={() => setAll(a => !a)}
              aria-pressed={all}
              className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] border hairline px-3 text-sm"
            >
              {all ? "Hide quiet leads" : "Show quiet leads"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() =>
              view === "hot" ? setHotNonce(n => n + 1) : void load()
            }
            disabled={view === "board" && busy}
            className="muted inline-flex h-8 items-center gap-1 px-1 text-xs"
            aria-label={
              view === "hot"
                ? "Read the hot list again"
                : "Read the pipeline again"
            }
          >
            <RefreshCw
              className={`size-3.5 ${view === "board" && busy ? "animate-spin" : ""}`}
              aria-hidden
            />
          </button>
        </div>
      </header>

      {view === "board" && error ? (
        <Failed what="The pipeline" error={error} retry={() => void load()} />
      ) : null}

      {view === "hot" ? (
        <HotSheet me={me} scope={scope} nonce={hotNonce} />
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
                counts={
                  closedStage && col.id === closedStage.id
                    ? (board.counts ?? null)
                    : null
                }
                droppable={
                  col.id !== NO_STAGE &&
                  !(closedStage?.synthetic && col.id === closedStage.id)
                }
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
  counts,
  droppable,
  onMove,
  onShowQuiet,
}: {
  stage: Stage;
  stages: Stage[];
  cards: Card[];
  quiet: number;
  /** The Closed column's own header counts; null for any other column. */
  counts: { open: number; signed: number } | null;
  droppable: boolean;
  onMove: (contactId: string, stageId: string) => void;
  onShowQuiet: () => void;
}) {
  const [over, setOver] = useState(false);
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
        <span
          className="muted ms-auto shrink-0 text-xs tabular-nums"
          title={
            counts
              ? "Signed clients (tagged client, or a signed deal) apart from leads still open in this stage."
              : undefined
          }
        >
          {counts ? closedHeader(counts) : cards.length}
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
  if (fixed(c)) return <ClientCard c={c} stages={stages} />;
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

/**
 * A signed client's card in Closed: when they signed (or "Active client"
 * for the tag alone), the value and who closed it, and HighLevel's own
 * stage when it differs. Not draggable and no "Move to…": it opens the
 * lead page.
 */
export function ClientCard({ c, stages }: { c: Card; stages: Stage[] }) {
  const navigate = useNavigate();
  const crm = plainStage(c.crm_stage);
  const column = plainStage(stages.find(s => s.id === c.stage_id)?.name);
  const first = (n: string | null | undefined) =>
    n ? (n.trim().split(/\s+/)[0] ?? null) : null;
  return (
    <li className="rounded-[var(--radius-md)] border hairline bg-[color:var(--background)] p-2.5 text-sm">
      <button
        type="button"
        onClick={() => navigate(`/lead/${c.contact_id}`)}
        className="block w-full min-w-0 text-left"
        title={CLIENT_NOTE}
      >
        <span className="flex items-start gap-1.5">
          <span
            className={`min-w-0 flex-1 truncate font-medium ${isArabic(c.name) ? "ar" : ""}`}
            dir="auto"
          >
            {c.name ?? "Unnamed lead"}
          </span>
          <StatusChip tone="good" label={signedLabel(c)} />
        </span>
        {(c.value !== null && c.value !== undefined) || c.closer ? (
          <span className="muted mt-1 block truncate text-xs">
            <Parts
              items={[
                c.value !== null && c.value !== undefined
                  ? money(c.value)
                  : null,
                c.closer ? `closed by ${first(c.closer)}` : null,
              ]}
            />
          </span>
        ) : null}
        {crm && crm !== column ? (
          <span className="muted mt-0.5 block truncate text-[11px]">
            In HighLevel: {crm}
          </span>
        ) : null}
      </button>
      {c.owner ? (
        <div className="mt-1.5">
          <span className="muted truncate text-[11px]">
            {c.owner.split(/\s+/)[0]}
          </span>
        </div>
      ) : null}
    </li>
  );
}
