import { Play } from "lucide-react";
import { useMemo, useState } from "react";
import { useStills } from "../lib/data";
import { clock, drivePreview, minutes, shape } from "../lib/format";
import type { Asset } from "../lib/types";
import { Empty, FIELD, KICKER, Out } from "./bits";

/** Shot changes shown before "+N more": a line of them, not a wall. */
const SHOTS = 8;

interface Found {
  asset: Asset;
  at: number;
  text: string;
}

/** Search every transcript at once and return the second each hit starts at.
 * A plain substring match over the word stream: an editor can see why it hit. */
function search(assets: Asset[], term: string): Found[] {
  const needle = term.trim().toLowerCase();
  if (needle.length < 2) return [];
  const out: Found[] = [];
  for (const a of assets) {
    const words = a.words ?? [];
    if (!words.length) continue;
    for (let i = 0; i < words.length; i++) {
      const window = words
        .slice(i, i + 12)
        .map(w => w.w)
        .join(" ");
      if (!window.toLowerCase().includes(needle)) continue;
      const at = words[i].t;
      if (out.some(f => f.asset.id === a.id && Math.abs(f.at - at) < 2))
        continue;
      out.push({ asset: a, at, text: window });
      if (out.length >= 60) return out;
    }
  }
  return out;
}

export default function Footage({ assets }: { assets: Asset[] }) {
  const [openId, setOpenId] = useState<string | null>(assets[0]?.id ?? null);
  // The Drive frame is the expensive thing on this page: it is a whole
  // embedded player, and mounting one for every job opened costs more than
  // everything else here put together. So the still stands in for it until
  // somebody actually wants to watch, and picking another file puts the
  // still back.
  const [playing, setPlaying] = useState<string | null>(null);
  // The file whose shot changes are all showing, if any.
  const [allShots, setAllShots] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const stills = useStills(assets.map(a => a.still_path));
  const hits = useMemo(() => search(assets, term), [assets, term]);
  const open = assets.find(a => a.id === openId) ?? null;
  const openStill = open?.still_path ? stills[open.still_path] : undefined;
  const anyWords = assets.some(a => (a.words ?? []).length > 0);

  if (!assets.length) {
    return <Empty>No footage has been read for this job yet.</Empty>;
  }

  // Sized by the card it sits in, not by the screen.
  return (
    <div className="@container space-y-4">
      {anyWords && (
        <div>
          <input
            id="transcript-search"
            value={term}
            onChange={e => setTerm(e.target.value)}
            aria-label="Search the transcripts"
            placeholder="Search everything that was said"
            className={`${FIELD} h-10`}
          />
          {term.trim().length >= 2 && (
            <div className="mt-2 max-h-56 overflow-y-auto">
              {hits.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">
                  Nothing said matches that.
                </p>
              ) : (
                <ul className="space-y-1">
                  {hits.map(h => (
                    <li key={`${h.asset.id}-${h.at}`}>
                      <button
                        type="button"
                        onClick={() => {
                          setOpenId(h.asset.id);
                          setPlaying(null);
                        }}
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                      >
                        <span className="font-mono text-xs text-primary">
                          {clock(h.at)}
                        </span>
                        <span
                          dir="auto"
                          className="rtl-safe min-w-0 flex-1 truncate"
                        >
                          {h.text}
                        </span>
                        <span className="max-w-[40%] shrink-0 truncate text-xs text-muted-foreground">
                          {h.asset.name}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      <ul className="grid grid-cols-2 gap-3 @md:grid-cols-3">
        {assets.map(a => {
          const still = a.still_path ? stills[a.still_path] : undefined;
          const active = a.id === openId;
          return (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => {
                  setOpenId(a.id);
                  setPlaying(null);
                }}
                aria-pressed={active}
                className={`w-full overflow-hidden rounded-xl border text-left transition-colors ${
                  active ? "border-primary" : "hover:border-primary/50"
                }`}
              >
                <div className="relative aspect-video w-full overflow-hidden bg-muted">
                  {still ? (
                    <img
                      src={still}
                      alt=""
                      className="size-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <span className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">
                      {a.error ? "Not read" : "No frame"}
                    </span>
                  )}
                  {a.seconds ? (
                    <span className="absolute right-1.5 bottom-1.5 rounded bg-black/70 px-1.5 py-0.5 font-mono text-xs text-white">
                      {clock(a.seconds)}
                    </span>
                  ) : null}
                </div>
                <div className="px-3 py-2">
                  <p className="truncate text-xs font-medium">{a.name}</p>
                  <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                    {shape(a.width, a.height) && (
                      <span>{shape(a.width, a.height)}</span>
                    )}
                    {a.has_audio === false && <span>Silent</span>}
                    {a.scenes?.length ? (
                      <span>{a.scenes.length} shots</span>
                    ) : null}
                  </p>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      {/* A quiet panel, not a card: it already sits inside one. */}
      {open && (
        <div className="rounded-xl bg-muted/40">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 pt-3">
            <p className="min-w-0 truncate text-sm font-medium">{open.name}</p>
            <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
              <span>{minutes(open.seconds)}</span>
              {open.width && open.height ? (
                <span>
                  {open.width}×{open.height}
                </span>
              ) : null}
              {open.fps ? <span>{Math.round(open.fps)} fps</span> : null}
              {open.preview_url ? (
                <Out href={open.preview_url}>Open in Drive</Out>
              ) : null}
            </p>
          </div>

          {open.error ? (
            <p className="txt-bad px-4 py-3 text-sm">{open.error}</p>
          ) : (
            <div className="grid gap-4 p-4 @xl:grid-cols-2">
              <div className="relative aspect-video overflow-hidden rounded-lg bg-muted">
                {playing === open.id && drivePreview(open.drive_id) ? (
                  <iframe
                    key={open.id}
                    src={drivePreview(open.drive_id) ?? ""}
                    title={open.name ?? "footage"}
                    allow="autoplay"
                    className="size-full border-0"
                  />
                ) : (
                  // Plays here, in Drive's own player. "Open in Drive" above
                  // is the one way out to Drive.
                  <button
                    type="button"
                    onClick={() => setPlaying(open.id)}
                    disabled={!open.drive_id}
                    aria-label={
                      open.drive_id
                        ? `Play ${open.name ?? "this file"}`
                        : undefined
                    }
                    className="group absolute inset-0 grid place-items-center"
                  >
                    {openStill ? (
                      <img
                        src={openStill}
                        alt=""
                        className="absolute inset-0 size-full object-cover"
                      />
                    ) : null}
                    {open.drive_id ? (
                      <span className="relative grid size-12 place-items-center rounded-full bg-black/70 text-white transition-transform group-hover:scale-105">
                        <Play
                          aria-hidden
                          className="ml-0.5 size-5"
                          fill="currentColor"
                        />
                      </span>
                    ) : (
                      <span className="relative rounded-full bg-black/70 px-3 py-1.5 text-xs font-medium text-white">
                        No preview
                      </span>
                    )}
                  </button>
                )}
              </div>

              <div className="min-w-0 space-y-3">
                {open.scenes?.length ? (
                  <div>
                    <p className={`${KICKER} mb-2`}>
                      Shot changes · {open.scenes.length}
                    </p>
                    <div className="flex flex-wrap items-center gap-1">
                      {(allShots === open.id
                        ? open.scenes
                        : open.scenes.slice(0, SHOTS)
                      ).map(s => (
                        <span
                          key={s}
                          className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs"
                        >
                          {clock(s)}
                        </span>
                      ))}
                      {open.scenes.length > SHOTS && allShots !== open.id ? (
                        <button
                          type="button"
                          onClick={() => setAllShots(open.id)}
                          className="no-touch relative rounded px-1.5 py-0.5 text-xs font-medium text-primary after:absolute after:-inset-2 after:content-[''] hover:underline"
                        >
                          +{open.scenes.length - SHOTS} more
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <div>
                  <p className={`${KICKER} mb-2`}>What was said</p>
                  {open.has_audio === false ? (
                    <p className="text-sm text-muted-foreground">
                      This file has no audio track, so there is nothing to
                      search.
                    </p>
                  ) : open.transcript ? (
                    <p
                      dir="auto"
                      className="rtl-safe dim max-h-64 overflow-y-auto whitespace-pre-wrap text-sm"
                    >
                      {open.transcript}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No speech was found. That is normal for b-roll and
                      animation over music.
                    </p>
                  )}
                </div>

                {open.script_hits?.length ? (
                  <div>
                    <p className={`${KICKER} mb-2`}>Script lines heard</p>
                    <ul className="space-y-1">
                      {open.script_hits.map(h => (
                        <li key={h.line} className="flex gap-2 text-sm">
                          <span className="font-mono text-xs text-primary">
                            {clock(h.at_sec)}
                          </span>
                          <span dir="auto" className="rtl-safe min-w-0 flex-1">
                            {h.line}
                          </span>
                          {h.confidence === "partial" && (
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {h.matched}/{h.of} words
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
