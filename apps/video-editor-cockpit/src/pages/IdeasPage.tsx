import { Play } from "lucide-react";
import { useMemo, useState } from "react";
import { Empty, Fold, Out, Problem, Prose, Spinner } from "../components/bits";
import { useWho } from "../lib/auth";
import { saveIdea, useIdeas, useStills } from "../lib/data";
import { clock, moment } from "../lib/format";
import { IDEA_STILLS_BUCKET } from "../lib/supabase";
import type { Idea } from "../lib/types";

/**
 * The ideation board, shared with the creative director.
 *
 * Not a copy. These are the same rows the creative cockpit shows, so an
 * editor who keeps something has kept it for the whole team and the creative
 * director sees it as saved (Aziz, 2026-09-19). The scan's own numbers are
 * not writable from here: Postgres grants the browser exactly the columns a
 * save touches and nothing else.
 */
const TIERS: Record<string, string> = {
  outlier: "var(--success)",
  strong: "var(--primary)",
  steady: "var(--muted-foreground)",
};

function IdeaCard({
  idea,
  still,
  onToggle,
  busy,
}: {
  idea: Idea;
  still?: string;
  onToggle: () => void;
  busy: boolean;
}) {
  const kept = idea.status === "saved";
  const hook = typeof idea.hook === "object" && idea.hook ? idea.hook.line : null;
  // Seven of thirty-seven posts have a playable file; the rest are a frame
  // and a link out. Nothing here pretends to embed TikTok.
  const [playing, setPlaying] = useState(false);
  const frame = still ?? idea.thumb_url ?? "";
  return (
    <li className="panel overflow-hidden">
      <div className="flex gap-3 p-3">
        <div className="raised relative h-28 w-20 shrink-0 overflow-hidden rounded-[var(--radius-sm)]">
          {playing && idea.media_url ? (
            // biome-ignore lint/a11y/useMediaCaption: a scraped clip has none
            <video
              src={idea.media_url}
              controls
              autoPlay
              playsInline
              className="size-full object-cover"
            />
          ) : (
            <>
              {frame ? (
                <img src={frame} alt="" loading="lazy" className="size-full object-cover" />
              ) : (
                <span className="muted absolute inset-0 grid place-items-center text-[10px]">
                  no frame
                </span>
              )}
              {idea.media_url ? (
                <button
                  type="button"
                  onClick={() => setPlaying(true)}
                  aria-label="Play this clip"
                  className="absolute inset-0 grid place-items-center"
                >
                  <Play className="size-6 text-white drop-shadow" strokeWidth={2} />
                </button>
              ) : null}
            </>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {idea.author_name || idea.author_handle || "unknown"}
              </p>
              <p className="muted truncate text-xs">
                {idea.platform}
                {idea.industry ? ` · ${idea.industry}` : ""}
                {idea.duration_sec ? ` · ${clock(idea.duration_sec)}` : ""}
              </p>
            </div>
            {/* A saved ad has no radar score, so it says how long it ran
                instead. Where it came from is always visible: something a
                person kept is not the same as something the radar found. */}
            {idea.origin === "foreplay" ? (
              <span
                className="shrink-0 text-[11px] font-medium"
                style={{ color: "var(--primary)" }}
                title="saved by someone on the team, through Foreplay"
              >
                saved
                {idea.running_days ? ` · ${idea.running_days}d on air` : ""}
              </span>
            ) : idea.tier ? (
              <span
                className="shrink-0 text-[11px] font-medium"
                style={{ color: TIERS[idea.tier] ?? "var(--muted-foreground)" }}
              >
                {idea.tier}
                {idea.multiplier ? ` ${idea.multiplier.toFixed(1)}×` : ""}
              </span>
            ) : null}
          </div>

          {hook ? (
            <p dir="auto" className="rtl-safe mt-1.5 text-sm">
              {hook}
            </p>
          ) : idea.caption ? (
            <p dir="auto" className="rtl-safe muted mt-1.5 line-clamp-2 text-xs">
              {idea.caption}
            </p>
          ) : null}

          <div className="muted mt-1.5 flex flex-wrap gap-x-3 text-[11px] tabular-nums">
            {idea.views ? <span>{idea.views.toLocaleString()} views</span> : null}
            {idea.likes && idea.likes > 0 ? <span>{idea.likes.toLocaleString()} likes</span> : null}
            <Out href={idea.url}>Open</Out>
          </div>

          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={onToggle}
              className={`rounded-full px-3 py-1 text-xs font-medium disabled:opacity-50 ${
                kept
                  ? "bg-[color:var(--primary)] text-[color:var(--primary-foreground)]"
                  : "raised muted"
              }`}
            >
              {kept ? "Kept" : "Keep this"}
            </button>
            {kept && idea.saved_by_name ? (
              <span className="muted text-[11px]">
                by {idea.saved_by_name}
                {idea.saved_at ? ` · ${moment(idea.saved_at)}` : ""}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {idea.why_it_works || idea.transcript ? (
        <div className="px-3 pb-1">
          {idea.why_it_works ? (
            <Fold title="Why it works">
              <Prose text={idea.why_it_works} />
            </Fold>
          ) : null}
          {idea.transcript ? (
            <Fold title="What is said in it" hint={`${idea.transcript.length} characters`}>
              <Prose text={idea.transcript} />
            </Fold>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export default function IdeasPage() {
  const ideas = useIdeas();
  const { email, name } = useWho();
  const [tab, setTab] = useState<"all" | "kept">("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const shown = useMemo(() => {
    const rows = ideas.data ?? [];
    return tab === "kept" ? rows.filter((i) => i.status === "saved") : rows;
  }, [ideas.data, tab]);

  const stills = useStills(
    shown.map((i) => i.still_path),
    IDEA_STILLS_BUCKET,
  );
  const keptCount = (ideas.data ?? []).filter((i) => i.status === "saved").length;

  async function toggle(idea: Idea) {
    setBusy(idea.key);
    setProblem(null);
    const err = await saveIdea(idea.key, idea.status !== "saved", { email, name });
    setBusy(null);
    if (err) setProblem(err);
    else ideas.reload();
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Ideas</h1>
        <p className="muted mt-1 text-sm">
          The same board the creative director works from. Keeping something here keeps it for both
          of you.
        </p>
      </header>

      <div className="mb-5 flex flex-wrap gap-1.5">
        {(
          [
            ["all", `Everything ${ideas.data?.length ? `(${ideas.data.length})` : ""}`],
            ["kept", `Kept ${keptCount ? `(${keptCount})` : ""}`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${
              tab === key
                ? "bg-[color:var(--primary)] text-[color:var(--primary-foreground)]"
                : "raised muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {(ideas.error || problem) && <Problem>{ideas.error ?? problem}</Problem>}
      {ideas.loading && <Spinner what="Reading the board" />}
      {!ideas.loading && !shown.length && (
        <Empty>
          {tab === "kept" ? "Nothing kept yet." : "The radar has not put anything here yet."}
        </Empty>
      )}

      <ul className="space-y-3">
        {shown.map((idea) => (
          <IdeaCard
            key={idea.key}
            idea={idea}
            still={idea.still_path ? stills[idea.still_path] : undefined}
            onToggle={() => toggle(idea)}
            busy={busy === idea.key}
          />
        ))}
      </ul>
    </div>
  );
}
