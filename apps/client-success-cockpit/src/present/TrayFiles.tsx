import { Film, ImageIcon, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { timeLabel } from "./driveView";
import type { LaunchAd } from "./sources";

/**
 * Prep's list of the client's saved files (DRIVE-IMPORT.md 12): each one's
 * name and kind, and on a file that came from a Drive link a quiet line,
 * "From Drive · pasted by {first name} · {when}", so a link pasted under the
 * wrong client is seen and the file deleted (launchAds.remove, which also
 * deletes its bytes). Prep only, in English: the deck and the notes window
 * never show where a file came from.
 */

/** Rows shown before "Show all {n}". */
export const TRAY_SHOWN = 6;

const KIND: Record<LaunchAd["kind"], string> = {
  custom: "their own",
  starter: "starter template",
  logo: "logo",
  page: "page screenshot",
};

/**
 * "From Drive · pasted by Sara · yesterday, 19:40", or "today, 08:15" for
 * today's paste (beside yesterday's, a bare time read as a clock, not a
 * day); null for a hand upload. The Drive box keeps its own wording.
 */
export function provenanceLine(ad: LaunchAd, now: Date): string | null {
  if (ad.source !== "drive") return null;
  const who = ad.importedBy?.trim();
  // "today, 08:15", "yesterday, 17:40": the box's own clock.
  const when = ad.importedAt ? timeLabel(ad.importedAt, now, "en") : "";
  return ["From Drive", who ? `pasted by ${who}` : null, when || null]
    .filter(Boolean)
    .join(" · ");
}

const nameOf = (ad: LaunchAd) =>
  ad.fileName?.trim() ||
  (ad.mime.startsWith("video/") ? "A video" : "A picture");

type Said = { tone: "good" | "bad"; text: string };

export function TrayFiles({
  ads,
  now,
  remove,
  onRemoved,
}: {
  /** The tray as read (launchAds.list), oldest first. */
  ads: LaunchAd[];
  now: Date;
  /** Delete one file for good; left out where nothing can be deleted. */
  remove?: (id: string) => Promise<unknown>;
  /** After a delete: read the tray again in every window. */
  onRemoved?: (id: string) => void;
}) {
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [gone, setGone] = useState<string[]>([]);
  const [said, setSaid] = useState<Said | null>(null);
  const [all, setAll] = useState(false);
  // Newest first: a link just pasted under the wrong client is on top. The
  // read is oldest first already; the made time decides when two disagree
  // (a file added on this page joins at the end).
  const made = (a: LaunchAd) => Date.parse(a.createdAt ?? "") || 0;
  const files = ads
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => a.status !== "removed" && !gone.includes(a.id))
    .sort((x, y) => made(y.a) - made(x.a) || y.i - x.i)
    .map(({ a }) => a);
  const shown = all ? files : files.slice(0, TRAY_SHOWN);

  const del = async (ad: LaunchAd) => {
    if (!remove) return;
    const name = nameOf(ad);
    setBusy(ad.id);
    setSaid(null);
    try {
      await remove(ad.id);
      setGone(g => [...g, ad.id]);
      setSaid({ tone: "good", text: `Deleted ${name}.` });
      onRemoved?.(ad.id);
    } catch (e) {
      const why = (e instanceof Error ? e.message : String(e)).trim();
      setSaid({
        tone: "bad",
        text: `${name} wasn't deleted. ${why ? why.replace(/([^.?])$/, "$1.") : "Try again."}`,
      });
    } finally {
      setBusy(null);
      setAsking(null);
    }
  };

  return (
    <section className="space-y-2 border-t pt-3" data-tray-files>
      <h3 className="text-xs font-medium text-muted-foreground">
        Their files{files.length ? ` (${files.length})` : ""}
      </h3>
      {files.length ? (
        <div className="text-xs text-muted-foreground">
          Saved for this client, newest first. Delete takes a file out of the
          tray for good.
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">
          Nothing saved for this client yet. Paste a Drive link or add a file
          above.
        </div>
      )}
      {shown.length ? (
        <ul className="space-y-1.5">
          {shown.map(ad => {
            const name = nameOf(ad);
            const video = ad.mime.startsWith("video/");
            const thumb = video ? ad.posterUrl : ad.url;
            const from = provenanceLine(ad, now);
            return (
              <li
                key={ad.id}
                className="flex items-start gap-2.5 rounded-lg border bg-background/60 p-2"
                data-tray-file={ad.source === "drive" ? "drive" : "upload"}
              >
                <div className="flex h-11 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground">
                  {thumb ? (
                    <img
                      src={thumb}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="size-full object-cover"
                    />
                  ) : video ? (
                    <Film aria-hidden className="size-4" />
                  ) : (
                    <ImageIcon aria-hidden className="size-4" />
                  )}
                </div>
                <div className="min-w-0 flex-1 text-xs">
                  {/* The name shares its line with Delete, so the lines under
                      it have the row's full width. */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 truncate font-medium" title={name}>
                      <bdi>{name}</bdi>
                    </div>
                    {remove && asking !== ad.id ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="-my-1 h-6 shrink-0 gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground [&_svg]:size-3.5"
                        aria-label={`Delete ${name}`}
                        disabled={busy !== null}
                        onClick={() => {
                          setSaid(null);
                          setAsking(ad.id);
                        }}
                      >
                        <Trash2 aria-hidden />
                        Delete
                      </Button>
                    ) : null}
                  </div>
                  <div className="text-muted-foreground">
                    {video ? "Video" : "Picture"} · {KIND[ad.kind]}
                    {ad.hidden ? " · hidden from the deck" : ""}
                  </div>
                  {from ? (
                    <div className="text-[11px] text-muted-foreground">
                      {/* A narrow panel breaks the line between its parts only. */}
                      {from.split(" · ").map((part, i) => (
                        <span key={part}>
                          {i ? " · " : ""}
                          <span className="whitespace-nowrap">{part}</span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {asking === ad.id ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <span className="txt-warn">Delete it for good?</span>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-7 px-2.5 text-xs"
                        disabled={busy === ad.id}
                        onClick={() => void del(ad)}
                      >
                        {busy === ad.id ? "Deleting…" : "Delete"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2.5 text-xs"
                        disabled={busy === ad.id}
                        onClick={() => setAsking(null)}
                      >
                        Keep it
                      </Button>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {files.length > TRAY_SHOWN ? (
        <button
          type="button"
          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          aria-expanded={all}
          onClick={() => setAll(v => !v)}
        >
          {all ? "Show the newest only" : `Show all ${files.length}`}
        </button>
      ) : null}
      {/* Always in the page, so a screen reader hears what a delete did. */}
      <div
        role="status"
        className={cn(
          "text-xs empty:hidden",
          said?.tone === "bad" ? "txt-bad" : "txt-good",
        )}
      >
        {said ? said.text : null}
      </div>
    </section>
  );
}
