/**
 * A saved Foreplay ad as a row on the shared ideation board.
 *
 * There are two ways an ad gets here: the worker forwards everything in the
 * Foreplay drop box every twenty minutes, and anybody can press "Send to
 * ideation" on the swipe file. Both write the same key, `foreplay:<id>`, and
 * both upsert -- so if the two disagreed about any field, whichever ran last
 * would quietly overwrite the other's version of the row. They must not
 * disagree.
 *
 * This is a port of `as_idea()` in `hermes/editor-desk/desk/foreplay.py`,
 * field for field. `scripts/check-shared.sh` fails the ship if the two drift.
 *
 * Copied into `convex/` for the two Convex cockpits and `src/lib/` for the
 * editor, because a Convex function cannot import from the app's source.
 */
// biome-ignore lint/suspicious/noExplicitAny: a row straight out of Supabase
type Ad = Record<string, any>;

export function adAsIdea(
  ad: Ad,
  opts: { by?: string; byName?: string; note?: string } = {},
): Ad {
  const platforms = ad.publisher_platform;
  const platform =
    (Array.isArray(platforms) && platforms.length ? platforms[0] : null) ??
    "meta";
  const url = ad.link_url || ad.foreplay_url || "";
  if (!url) throw new Error("That ad has no link to save.");
  const caption = ad.headline || ad.description || ad.name || "";
  const days =
    typeof ad.running_duration === "number" ? ad.running_duration : null;
  const by = opts.by ?? "";
  const byName = opts.byName ?? "";
  const note = opts.note ?? "";
  return {
    key: `foreplay:${ad.id}`,
    platform: String(platform).toLowerCase(),
    url,
    origin: "foreplay",
    status: "saved",
    author_name: ad.name ?? null,
    caption: caption.slice(0, 2000) || null,
    thumb_url: ad.thumbnail ?? ad.image ?? null,
    media_url: ad.video ?? null,
    transcript: String(ad.full_transcription ?? "") || null,
    duration_sec: ad.video_duration ?? null,
    why_it_works:
      days && days > 0
        ? `Still running after ${days} days, which is why it was kept.`
        : null,
    running_days: days,
    saved_by: by || null,
    saved_by_name: byName || null,
    saved_note: note.slice(0, 1000) || null,
    pasted_by: by || null,
    pasted_by_name: byName || null,
  };
}

/**
 * The field list, pinned. The Python side asserts the same list against its
 * own output, so adding a field in one place and not the other is caught by
 * a test rather than by a row that loses data on the next sync.
 */
export const IDEA_FIELDS = [
  "author_name",
  "caption",
  "duration_sec",
  "key",
  "media_url",
  "origin",
  "pasted_by",
  "pasted_by_name",
  "platform",
  "running_days",
  "saved_by",
  "saved_by_name",
  "saved_note",
  "status",
  "thumb_url",
  "transcript",
  "url",
  "why_it_works",
] as const;
