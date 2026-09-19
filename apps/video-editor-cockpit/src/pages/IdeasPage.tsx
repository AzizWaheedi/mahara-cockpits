import { Play, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Fold, Out, Problem, Prose, Spinner } from "../components/bits";
import { useWho } from "../lib/auth";
import { saveIdea, useIdeas, useStills } from "../lib/data";
import { clock, moment } from "../lib/format";
import { IDEA_STILLS_BUCKET } from "../lib/supabase";
import type { Idea } from "../lib/types";

/**
 * The ideation board, laid out the way the creative director's is.
 *
 * Same rows, same tabs, same chips, same search. It is literally the same
 * table, so two different-looking screens over it would make one board feel
 * like two (Aziz, 2026-09-19).
 */
type Tab = "saved" | "proposed" | "dismissed";

const TABS: { key: Tab; label: string }[] = [
  { key: "saved", label: "Saved" },
  { key: "proposed", label: "Proposed" },
  { key: "dismissed", label: "Dismissed" },
];

const PLATFORMS: [string, string][] = [
  ["", "All"],
  ["instagram", "Instagram"],
  ["tiktok", "TikTok"],
  ["snapchat", "Snapchat"],
  ["youtube", "YouTube"],
  ["facebook", "Facebook"],
  ["meta_ads", "Meta ads"],
  ["google_ads", "Google ads"],
];

function hookOf(idea: Idea): string {
  const h = idea.hook;
  if (h && typeof h === "object" && h.line) return h.line;
  return idea.caption ?? "";
}

function haystack(idea: Idea): string {
  return [hookOf(idea), idea.caption, idea.transcript, idea.why_it_works, idea.author_name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function Row({
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
  const [playing, setPlaying] = useState(false);
  const kept = idea.status === "saved";
  const frame = still ?? idea.thumb_url ?? "";
  const hook = hookOf(idea);

  return (
    <li className="flex gap-3 p-3">
      <div className="raised relative h-24 w-16 shrink-0 overflow-hidden rounded-[var(--radius-sm)]">
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
                <Play className="size-5 text-white drop-shadow" strokeWidth={2} />
              </button>
            ) : null}
          </>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium">
              {idea.author_name || idea.author_handle || "unknown"}
            </p>
            <p className="muted truncate text-[11px]">
              {idea.platform}
              {idea.industry ? ` · ${idea.industry}` : ""}
              {idea.duration_sec ? ` · ${clock(idea.duration_sec)}` : ""}
              {idea.views ? ` · ${idea.views.toLocaleString()} views` : ""}
            </p>
          </div>
          {idea.origin === "foreplay" ? (
            <span
              className="shrink-0 text-[11px] font-semibold"
              style={{ color: "var(--primary)" }}
              title="saved by the team through Foreplay"
            >
              saved{idea.running_days ? ` · ${idea.running_days}d` : ""}
            </span>
          ) : idea.multiplier ? (
            <span
              className="shrink-0 text-[11px] font-semibold"
              style={{ color: "var(--success)" }}
            >
              {idea.multiplier.toFixed(1)}×
            </span>
          ) : null}
        </div>

        {hook ? (
          <p dir="auto" className="rtl-safe mt-1.5 line-clamp-2 text-[13px]">
            {hook}
          </p>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={onToggle}
            className={`rounded-full border px-2.5 py-0.5 text-[12px] font-semibold disabled:opacity-50 ${
              kept
                ? "border-transparent bg-[color:var(--primary)] text-[color:var(--primary-foreground)]"
                : "hairline muted hover:text-[color:var(--foreground)]"
            }`}
          >
            {kept ? "Kept" : "Keep"}
          </button>
          <span className="muted text-[11px]">
            <Out href={idea.url}>Open</Out>
          </span>
          {kept && idea.saved_by_name ? (
            <span className="muted text-[11px]">
              {idea.saved_by_name}
              {idea.saved_at ? ` · ${moment(idea.saved_at)}` : ""}
            </span>
          ) : null}
        </div>

        {idea.why_it_works || idea.transcript ? (
          <div className="mt-1">
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
      </div>
    </li>
  );
}

export default function IdeasPage() {
  const ideas = useIdeas();
  const { email, name } = useWho();
  const [tab, setTab] = useState<Tab>("saved");
  const [platform, setPlatform] = useState("");
  const [sort, setSort] = useState<"newest" | "multiplier">("newest");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const all = ideas.data ?? [];
  const countOf = (t: Tab) => all.filter((i) => (i.status ?? "proposed") === t).length;

  const shown = useMemo(() => {
    let rows = all.filter((i) => (i.status ?? "proposed") === tab);
    if (platform) rows = rows.filter((i) => (i.platform ?? "") === platform);
    const term = q.trim().toLowerCase();
    if (term.length >= 2) rows = rows.filter((i) => haystack(i).includes(term));
    if (sort === "multiplier")
      rows = [...rows].sort((a, b) => (b.multiplier ?? 0) - (a.multiplier ?? 0));
    else
      rows = [...rows].sort((a, b) =>
        String(b.saved_at ?? b.posted_at ?? "").localeCompare(
          String(a.saved_at ?? a.posted_at ?? ""),
        ),
      );
    return rows;
  }, [all, tab, platform, q, sort]);

  const stills = useStills(
    shown.map((i) => i.still_path),
    IDEA_STILLS_BUCKET,
  );

  async function toggle(idea: Idea) {
    setBusy(idea.key);
    setProblem(null);
    const err = await saveIdea(idea.key, idea.status !== "saved", { email, name });
    setBusy(null);
    if (err) setProblem(err);
    else ideas.reload();
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Ideation</h1>
      <p className="muted mt-1 mb-4 text-[13px]">
        The same board the creative director works from: posts that ran far above their account's
        normal, from our industry and from others, with what they say and why they work. Anything
        the team saves into the Foreplay drop box lands here on its own. The winning ads we ran
        ourselves stay on What works.
      </p>

      {(ideas.error || problem) && <Problem>{ideas.error ?? problem}</Problem>}

      <div className="mb-3 flex flex-wrap gap-1 border-b hairline">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-2.5 py-1.5 text-[13px] font-semibold transition ${
              tab === t.key
                ? "border-[color:var(--primary)] text-[color:var(--foreground)]"
                : "muted border-transparent hover:text-[color:var(--foreground)]"
            }`}
          >
            {t.label}
            {countOf(t.key) ? (
              <span className="muted ml-1 text-[11px] font-normal">{countOf(t.key)}</span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {PLATFORMS.map(([k, label]) => (
            <button
              key={k || "all"}
              type="button"
              onClick={() => setPlatform(k)}
              aria-pressed={platform === k}
              className={`rounded-full border px-2.5 py-0.5 text-[12px] font-semibold ${
                platform === k
                  ? "border-transparent bg-[color:var(--foreground)] text-[color:var(--background)]"
                  : "hairline muted hover:bg-[color:var(--secondary)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as "newest" | "multiplier")}
          aria-label="Sort"
          className="h-7 rounded-[var(--radius-sm)] border hairline bg-[color:var(--background)] px-2 text-[12px]"
        >
          <option value="newest">Newest first</option>
          <option value="multiplier">Biggest outliers first</option>
        </select>
        <div className="ml-auto flex items-center gap-1.5 rounded-[var(--radius-sm)] border hairline px-2 py-1">
          <Search className="muted size-3.5" strokeWidth={2} />
          <input
            id="idea-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search hooks, captions, transcripts"
            className="w-56 bg-transparent text-[13px] outline-none"
          />
        </div>
      </div>

      {ideas.loading ? (
        <Spinner what="Reading the board" />
      ) : !shown.length ? (
        <p className="muted text-[13px]">
          {q.trim()
            ? "No idea here matches that search."
            : tab === "saved"
              ? "Nothing kept yet. Keep one of the scan's proposals, or drop an ad into the Foreplay board."
              : tab === "dismissed"
                ? "Nothing dismissed."
                : "Nothing proposed yet. The radar proposes posts doing three times an account's usual views or more."}
        </p>
      ) : (
        <ul className="divide-y divide-[color:var(--border)] rounded-[var(--radius-lg)] border hairline">
          {shown.map((idea) => (
            <Row
              key={idea.key}
              idea={idea}
              still={idea.still_path ? stills[idea.still_path] : undefined}
              onToggle={() => toggle(idea)}
              busy={busy === idea.key}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
