import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { readOnboardingKits } from "@/lib/onboardingClient";
import type { OnboardingRow } from "@/lib/onboardingCore";
import { fetchClientProfile } from "@/lib/performance";
import type { Overrides } from "./deckData";
import { type LaunchBlueprint, launchBlueprintOf } from "./launchData";
import {
  type DeckKind,
  type DeckSources,
  type DeckVideos,
  listLaunchAds,
  problem,
  readDeckSources,
  readDeckVideos,
  sourcesSchema,
  VideosNotLive,
} from "./sources";
import type { Loaded } from "./useDeckModel";

/**
 * Everything one client's deck reads, through the signed-in seat's own
 * client (cockpit_csm_client_gate decides): the deck's sources, the
 * onboarding and kickoff answers, and the ads tray with links signed now,
 * when the deck opens (DESIGN 10.6).
 *
 * When the deck's own read is not live yet, the cockpit's existing reads
 * stand in (the onboarding row and the client's profile), so the deck still
 * opens with the client's name, forms, stage and Do's & Don'ts; what that
 * leaves out is said in `problems`, never shown as empty.
 */

const str = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim() : null;

/** The deck's sources, made from the profile and the onboarding row. */
export function fallbackSources(
  taskId: string,
  name: string,
  profile: Record<string, unknown> | null,
  kit: OnboardingRow | null,
): DeckSources {
  const kind = str(profile?.nextCallKind);
  const at = str(profile?.nextCallAt);
  const dosDonts = str(profile?.dosDonts);
  return sourcesSchema.parse({
    taskId,
    clientName: name,
    client: {
      stage: str(profile?.stage) ?? kit?.clickup_status ?? null,
      service: str(profile?.service),
      launchDate: str(profile?.launchDate) ?? kit?.launch_on ?? null,
      bucket: str(profile?.bucket),
    },
    dosDonts: profile ? { text: dosDonts, source: "card" } : null,
    calls: {
      next:
        kind &&
        at &&
        ["blueprint", "launch", "checkin", "onboarding"].includes(kind)
          ? { [kind]: { startsAt: at } }
          : {},
      last: {},
    },
    notes: [
      "The deck's own read is not live yet, so the logo, the Meta ads, the form and saved prep are not read. Typed changes show on the deck but are not saved.",
    ],
  });
}

/**
 * The videos are read beside the sources and never stop the deck. Null is
 * "not read", said in the notes and prep, never "Not recorded yet"; the
 * functions not being live yet is its own sentence (VIDEOS.md 7).
 */
export function videosRead(r: PromiseSettledResult<DeckVideos>): {
  videos: DeckVideos | null;
  problem: string | null;
  line: string | null;
} {
  if (r.status === "fulfilled")
    return { videos: r.value, problem: null, line: null };
  if (r.reason instanceof VideosNotLive)
    return { videos: null, problem: r.reason.message, line: r.reason.message };
  const why = problem(r.reason, "try again");
  return {
    videos: null,
    problem: why,
    line: `The deck's videos could not be read: ${why}`,
  };
}

const blueprintRows = z.object({
  rows: z.array(
    z
      .object({
        taskId: z.string(),
        answers: z.record(z.string(), z.unknown()).optional(),
        parts: z.record(z.string(), z.unknown()).optional(),
      })
      .passthrough(),
  ),
});

/**
 * The launch deck's Brand Blueprint (SPEC 6.2), through cockpit_blueprint_read
 * (a CSM seat reads it). Null when the card has none.
 */
export async function readLaunchBlueprint(
  client: Pick<SupabaseClient, "rpc">,
  taskId: string,
): Promise<LaunchBlueprint | null> {
  const { data, error } = await client.rpc("cockpit_blueprint_read", {
    p_task_ids: [taskId],
  });
  if (error) throw error;
  const page = blueprintRows.safeParse(data);
  if (!page.success)
    throw Error("it came back in a shape this deck does not read");
  return launchBlueprintOf(page.data.rows.find(r => r.taskId === taskId));
}

export async function loadDeck(
  client: SupabaseClient,
  taskId: string,
  deck: DeckKind,
): Promise<Loaded> {
  const problems: string[] = [];
  const [src, kits, ads, videos, bp] = await Promise.allSettled([
    readDeckSources(client, taskId),
    readOnboardingKits(client, [taskId]),
    listLaunchAds(client, taskId),
    readDeckVideos(client, deck),
    deck === "launch"
      ? readLaunchBlueprint(client, taskId)
      : Promise.resolve(null),
  ]);
  // A failed Blueprint read is a notes line; the slides keep their own reads.
  if (bp.status === "rejected")
    problems.push(
      `The Brand Blueprint could not be read, so the offer, the rules and the starter pack from the call are left out: ${problem(bp.reason, "try again")}`,
    );
  const read = videosRead(videos);
  if (read.line) problems.push(read.line);
  const kit =
    kits.status === "fulfilled"
      ? (kits.value.rows.find(r => r.clickup_task_id === taskId) ?? null)
      : null;
  if (kits.status === "rejected")
    problems.push(
      `The onboarding and kickoff answers could not be read: ${problem(kits.reason, "try again")}`,
    );
  let sources: DeckSources | null =
    src.status === "fulfilled" ? src.value : null;
  if (!sources) {
    problems.push(
      problem(
        src.status === "rejected" ? src.reason : null,
        "The deck's sources could not be read.",
      ),
    );
    const name = kit?.client_name;
    if (!name)
      throw Error(
        problems[0] ??
          "This client could not be read. Open the deck from their page again.",
      );
    let profile: Record<string, unknown> | null = null;
    try {
      profile = (await fetchClientProfile(client, name)) as Record<
        string,
        unknown
      > | null;
    } catch (e) {
      problems.push(
        `The client's profile could not be read: ${problem(e, "try again")}`,
      );
    }
    sources = fallbackSources(taskId, name, profile, kit);
  }
  const prep: { onboarding: Overrides; launch: Overrides } = {
    onboarding:
      (sources.prep?.onboarding?.overrides as Overrides | undefined) ?? {},
    launch: (sources.prep?.launch?.overrides as Overrides | undefined) ?? {},
  };
  if (ads.status === "rejected")
    problems.push(
      `The ads tray could not be signed: ${problem(ads.reason, "try again")}`,
    );
  return {
    sources,
    kit,
    ads: ads.status === "fulfilled" ? ads.value : sources.launchAds,
    prep,
    problems,
    videos: read.videos,
    videosProblem: read.problem,
    launchBlueprint: bp.status === "fulfilled" ? bp.value : null,
  };
}
