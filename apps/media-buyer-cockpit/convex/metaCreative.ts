/**
 * Reading a Meta ad creative well enough to make another one from it.
 *
 * Aziz, 2026-09-22, from a client account: "Meta 100/2061015: Invalid
 * parameter — The link field is required."
 *
 * That error is what the cockpit produced when it tried to copy an
 * Advantage+ ad. Meta has two shapes for a creative and they do not look
 * alike:
 *
 *   - a plain story: `object_story_spec.video_data` (or `link_data`) holding
 *     the video, the copy, and the destination inside `call_to_action`;
 *   - a flexible, Advantage+ one: `object_story_spec` carries the page and
 *     the Instagram account and *nothing else*, and every real asset —
 *     several videos, several bodies, several titles, the call to action and
 *     the link — sits in `asset_feed_spec`.
 *
 * The old guard asked "is there an object_story_spec?" and an Advantage+ ad
 * answers yes. So the copy went out with a page id, no media and no link, and
 * Meta refused it with a message about a field that was never on the screen.
 * One client ad in thirty on the account is this shape.
 *
 * The rule here is: ask what the creative *is*, not whether a field exists.
 * A flexible creative is flattened onto its first video and its first link,
 * which is a real decision and is reported so the person knows the copy is
 * one of several.
 */

// biome-ignore lint/suspicious/noExplicitAny: Graph API payloads are untyped
export type Any = Record<string, any>;

export type StoryKind = "video" | "link" | "photo";

/** The part of a story spec that holds the ad, or null when there is none. */
export function storyOf(
  spec: Any | undefined | null,
): { kind: StoryKind; data: Any } | null {
  if (!spec || typeof spec !== "object") return null;
  if (spec.video_data) return { kind: "video", data: spec.video_data };
  if (spec.link_data) return { kind: "link", data: spec.link_data };
  if (spec.photo_data) return { kind: "photo", data: spec.photo_data };
  return null;
}

/**
 * Where the ad sends people, wherever Meta happens to be keeping it. An
 * instant-form ad carries the placeholder `http://fb.me/` here and the real
 * destination in `lead_gen_form_id`; both have to survive a copy.
 */
export function destinationLink(creative: Any | undefined): string | null {
  if (!creative) return null;
  const spec = creative.object_story_spec ?? {};
  const story = storyOf(spec);
  const fromStory =
    story?.data?.call_to_action?.value?.link ??
    (story?.kind === "link" ? story.data.link : undefined);
  const feed = creative.asset_feed_spec ?? {};
  const fromFeed =
    feed.link_urls?.[0]?.website_url ??
    feed.call_to_actions?.[0]?.value?.link ??
    undefined;
  const link = fromStory ?? fromFeed ?? creative.link_url ?? null;
  return typeof link === "string" && link.trim() ? link : null;
}

/**
 * Meta reads a creative back with more on it than it will accept.
 *
 * A video story comes back carrying both `image_hash` and `image_url` for its
 * thumbnail, and posting both is refused: "Only one of image_url and
 * image_hash should be specified" (100/1443051). Twenty-nine of the thirty
 * client ads on the account are this shape, so every copy test on a video ad
 * failed on it. The hash is kept, because it is the asset already in the ad
 * account; the url is a signed CDN link that expires.
 */
function dropRedundant(spec: Any): void {
  const story = storyOf(spec);
  if (!story) return;
  const d = story.data;
  if (d.image_hash && d.image_url) delete d.image_url;
  if (d.image_hash && d.picture) delete d.picture;
}

/** What was left behind when a flexible creative was flattened to one ad. */
export type Flattened = {
  videos: number;
  images: number;
  bodies: number;
  titles: number;
};

export type Copyable =
  | { ok: true; spec: Any; kind: StoryKind; flattened: Flattened | null }
  | { ok: false; why: string };

const first = <T>(x: T[] | undefined): T | undefined =>
  Array.isArray(x) && x.length ? x[0] : undefined;

/**
 * A story spec that can be posted back to Meta, built from whatever the
 * source ad actually is. Refuses with a sentence a person can act on rather
 * than letting Meta answer with a code.
 */
export function copyableSpec(creative: Any | undefined): Copyable {
  if (!creative)
    return { ok: false, why: "Meta returned no creative for that ad." };
  const spec = creative.object_story_spec;
  const story = storyOf(spec);

  // The ordinary case: copy the story whole, so the video, the form and the
  // call to action all come across untouched.
  if (story) {
    if (!destinationLink(creative))
      return {
        ok: false,
        why: "That ad has no destination on it, so a copy of it would have nowhere to send people. Meta refuses a creative with no link. Pick another ad in the campaign as the template.",
      };
    const copy = JSON.parse(JSON.stringify(spec));
    dropRedundant(copy);
    return { ok: true, spec: copy, kind: story.kind, flattened: null };
  }

  // The Advantage+ case: everything real is in the asset feed.
  const feed = creative.asset_feed_spec;
  if (!feed || typeof feed !== "object")
    return {
      ok: false,
      why: "That ad's creative is a format the cockpit cannot rebuild. Duplicate it in Ads Manager instead.",
    };

  const link = destinationLink(creative);
  if (!link)
    return {
      ok: false,
      why: "That ad is an Advantage+ creative with no link on it, so there is nothing to send people to. Duplicate it in Ads Manager instead.",
    };

  const video = first<Any>(feed.videos);
  const image = first<Any>(feed.images);
  const cta = first<Any>(feed.call_to_actions) ?? {
    type: first<string>(feed.call_to_action_types) ?? "LEARN_MORE",
    value: { link },
  };
  // Keep whatever the call to action carries (the lead form id lives here)
  // and make sure the link is on it, because Meta requires it on a create.
  const callToAction = {
    ...cta,
    value: { ...(cta.value ?? {}), link: cta.value?.link ?? link },
  };
  const flattened: Flattened = {
    videos: feed.videos?.length ?? 0,
    images: feed.images?.length ?? 0,
    bodies: feed.bodies?.length ?? 0,
    titles: feed.titles?.length ?? 0,
  };
  const base = {
    ...(spec?.page_id ? { page_id: spec.page_id } : {}),
    ...(spec?.instagram_user_id
      ? { instagram_user_id: spec.instagram_user_id }
      : {}),
  };
  const message = first<Any>(feed.bodies)?.text ?? "";
  const title = first<Any>(feed.titles)?.text ?? "";

  if (video?.video_id)
    return {
      ok: true,
      kind: "video",
      flattened,
      spec: {
        ...base,
        video_data: {
          video_id: String(video.video_id),
          ...(video.thumbnail_url
            ? { image_url: String(video.thumbnail_url) }
            : {}),
          message,
          title,
          call_to_action: callToAction,
        },
      },
    };

  if (image?.hash)
    return {
      ok: true,
      kind: "link",
      flattened,
      spec: {
        ...base,
        link_data: {
          image_hash: String(image.hash),
          link,
          message,
          name: title,
          call_to_action: callToAction,
        },
      },
    };

  return {
    ok: false,
    why: "That ad's creative has no video or image the cockpit can reuse. Duplicate it in Ads Manager instead.",
  };
}

/** The text of a spec, whichever shape it is in. */
export function setCopy(
  spec: Any,
  copy: { message?: string; headline?: string },
): void {
  const story = storyOf(spec);
  if (!story) return;
  const d = story.data;
  if (copy.message) d.message = copy.message;
  if (copy.headline) {
    // A video creative calls it `title`, a link creative calls it `name`.
    if (story.kind === "video") d.title = copy.headline;
    else d.name = copy.headline;
  }
}

/** One sentence about what a flatten left behind, or null when nothing did. */
export function flattenNote(f: Flattened | null): string | null {
  if (!f) return null;
  const extras: string[] = [];
  if (f.videos > 1) extras.push(`${f.videos} videos`);
  if (f.images > 1) extras.push(`${f.images} images`);
  if (f.bodies > 1) extras.push(`${f.bodies} versions of the copy`);
  if (f.titles > 1) extras.push(`${f.titles} headlines`);
  if (!extras.length) return null;
  return `That ad is an Advantage+ creative holding ${extras.join(", ")}; the copy uses the first of each.`;
}

/** The fields a read needs before any of this can answer. */
export const CREATIVE_FIELDS =
  "creative{id,object_story_spec,asset_feed_spec,link_url,object_type}";

/**
 * Meta's refusals, in words.
 *
 * The codes are for us; the person reading the screen needs to know what to
 * go and do. Validating a copy of every client ad on the account on
 * 2026-09-22 turned up four refusals worth naming, and three of them are a
 * permission somebody has to grant rather than anything the cockpit can fix.
 * Anything not listed is passed through unchanged, because a message we have
 * not seen before is better read raw than guessed at.
 */
export function explainMeta(raw: string): string {
  const page = /Page (\d{5,})/.exec(raw)?.[1];
  if (raw.includes("3858749"))
    return `Meta will not let the cockpit post to that client's Facebook Page${page ? ` (${page})` : ""}. The app needs the Advertiser role or higher on the Page: add it in the client's Business Settings under Pages, then try again. Until then the ad has to be made in Ads Manager.`;
  if (raw.includes("1815199"))
    return "The ad account is not linked to the Instagram account that ad runs on, so Meta will not create a copy of it. Connect them in Business Settings, or make the ad in Ads Manager.";
  if (raw.includes("1487194"))
    return "Meta will not show that Page or Instagram account to the cockpit. It has usually not been shared with Mahara's Business Manager. Share it, or make the ad in Ads Manager.";
  if (raw.includes("2061015"))
    return "The creative went up without a destination, which Meta refuses. Tell Aziz: this is a cockpit bug, not a setting.";
  if (raw.includes("1443051"))
    return "Meta refused the thumbnail on the copied creative. Tell Aziz: this is a cockpit bug, not a setting.";
  if (raw.includes("2490592"))
    return "The ad account is not in good standing, so Meta refuses every change on it. Settle the balance in Ads Manager first.";
  return raw;
}
