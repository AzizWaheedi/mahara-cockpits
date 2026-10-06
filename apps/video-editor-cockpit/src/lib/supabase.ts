import { createCockpitSupabaseClient } from "../auth/supabaseAccess";

// Use the same project, Auth storage key and session settings as the portal.
export const supabase = createCockpitSupabaseClient();

export const STILLS_BUCKET = "editor-stills";
/** The ideation radar keeps its frames in its own bucket. */
export const IDEA_STILLS_BUCKET = "ideation-stills";
/** Our own copy of the ads we ran, downloaded from Meta while we still can. */
export const AD_VIDEOS_BUCKET = "ad-videos";
