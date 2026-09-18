import { useMemo, useState } from "react";
import { useStills } from "../lib/data";
import { clock, drivePreview, minutes, shape } from "../lib/format";
import type { Asset } from "../lib/types";
import { Empty, Out } from "./bits";

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
        .map((w) => w.w)
        .join(" ");
      if (!window.toLowerCase().includes(needle)) continue;
      const at = words[i].t;
      if (out.some((f) => f.asset.id === a.id && Math.abs(f.at - at) < 2)) continue;
      out.push({ asset: a, at, text: window });
      if (out.length >= 60) return out;
    }
  }
  return out;
}

export default function Footage({ assets }: { assets: Asset[] }) {
  const [openId, setOpenId] = useState<string | null>(assets[0]?.id ?? null);
  const [term, setTerm] = useState("");
  const stills = useStills(assets.map((a) => a.still_path));
  const hits = useMemo(() => search(assets, term), [assets, term]);
  const open = assets.find((a) => a.id === openId) ?? null;
  const anyWords = assets.some((a) => (a.words ?? []).length > 0);

  if (!assets.length) {
    return <Empty>No footage has been read for this job yet.</Empty>;
  }

  return (
    <div className="space-y-4">
      {anyWords && (
        <div>
          <input
            id="transcript-search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search everything that was said"
            className="raised w-full rounded-md border hairline px-3 py-2 text-sm"
          />
          {term.trim().length >= 2 && (
            <div className="mt-2 max-h-56 overflow-y-auto">
              {hits.length === 0 ? (
                <p className="muted py-2 text-sm">Nothing said matches that.</p>
              ) : (
                <ul className="space-y-1">
                  {hits.map((h) => (
                    <li key={`${h.asset.id}-${h.at}`}>
                      <button
                        type="button"
                        onClick={() => setOpenId(h.asset.id)}
                        className="raised flex w-full gap-3 rounded-md px-3 py-2 text-left text-sm"
                      >
                        <span className="font-mono text-xs" style={{ color: "var(--primary)" }}>
                          {clock(h.at)}
                        </span>
                        <span dir="auto" className="rtl-safe min-w-0 flex-1 truncate">
                          {h.text}
                        </span>
                        <span className="muted shrink-0 truncate text-xs">{h.asset.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {assets.map((a) => {
          const still = a.still_path ? stills[a.still_path] : undefined;
          const active = a.id === openId;
          return (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => setOpenId(a.id)}
                className={`w-full overflow-hidden rounded-lg border text-left ${
                  active ? "border-[color:var(--primary)]" : "hairline"
                }`}
              >
                <div className="raised relative aspect-video w-full overflow-hidden">
                  {still ? (
                    <img src={still} alt="" className="size-full object-cover" loading="lazy" />
                  ) : (
                    <span className="muted absolute inset-0 grid place-items-center text-xs">
                      {a.error ? "not read" : "no frame"}
                    </span>
                  )}
                  {a.seconds ? (
                    <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white">
                      {clock(a.seconds)}
                    </span>
                  ) : null}
                </div>
                <div className="px-2 py-1.5">
                  <p className="truncate text-xs font-medium">{a.name}</p>
                  <p className="muted mt-0.5 flex flex-wrap gap-x-2 text-[11px]">
                    {shape(a.width, a.height) && <span>{shape(a.width, a.height)}</span>}
                    {a.has_audio === false && <span>silent</span>}
                    {a.scenes?.length ? <span>{a.scenes.length} shots</span> : null}
                  </p>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      {open && (
        <div className="panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b hairline px-4 py-2.5">
            <p className="truncate text-sm font-medium">{open.name}</p>
            <p className="muted flex flex-wrap gap-x-3 text-xs">
              <span>{minutes(open.seconds)}</span>
              {open.width && open.height ? (
                <span>
                  {open.width}×{open.height}
                </span>
              ) : null}
              {open.fps ? <span>{Math.round(open.fps)} fps</span> : null}
              <Out href={open.preview_url}>Open in Drive</Out>
            </p>
          </div>

          {open.error ? (
            <p className="px-4 py-3 text-sm" style={{ color: "var(--destructive)" }}>
              {open.error}
            </p>
          ) : (
            <div className="grid gap-4 p-4 lg:grid-cols-2">
              <div className="raised aspect-video overflow-hidden rounded-md">
                {drivePreview(open.drive_id) ? (
                  <iframe
                    key={open.id}
                    src={drivePreview(open.drive_id) ?? ""}
                    title={open.name ?? "footage"}
                    allow="autoplay"
                    className="size-full border-0"
                  />
                ) : null}
              </div>

              <div className="min-w-0 space-y-3">
                {open.scenes?.length ? (
                  <div>
                    <p className="muted mb-1 text-xs uppercase tracking-wide">
                      Shot changes ({open.scenes.length})
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {open.scenes.slice(0, 40).map((s) => (
                        <span
                          key={s}
                          className="raised rounded px-1.5 py-0.5 font-mono text-[11px]"
                        >
                          {clock(s)}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div>
                  <p className="muted mb-1 text-xs uppercase tracking-wide">What was said</p>
                  {open.has_audio === false ? (
                    <p className="muted text-sm">
                      This file has no audio track, so there is nothing to search.
                    </p>
                  ) : open.transcript ? (
                    <p
                      dir="auto"
                      className="rtl-safe dim max-h-64 overflow-y-auto whitespace-pre-wrap text-sm"
                    >
                      {open.transcript}
                    </p>
                  ) : (
                    <p className="muted text-sm">
                      No speech was found. That is normal for b-roll and animation over music.
                    </p>
                  )}
                </div>

                {open.script_hits?.length ? (
                  <div>
                    <p className="muted mb-1 text-xs uppercase tracking-wide">
                      Script lines heard here
                    </p>
                    <ul className="space-y-1">
                      {open.script_hits.map((h) => (
                        <li key={h.line} className="flex gap-2 text-sm">
                          <span className="font-mono text-xs" style={{ color: "var(--primary)" }}>
                            {clock(h.at_sec)}
                          </span>
                          <span dir="auto" className="rtl-safe min-w-0 flex-1">
                            {h.line}
                          </span>
                          {h.confidence === "partial" && (
                            <span className="muted shrink-0 text-xs">
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
