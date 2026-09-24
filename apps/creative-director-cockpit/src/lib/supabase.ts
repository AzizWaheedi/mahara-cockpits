import { getCockpitSupabaseClient } from "@/auth/SupabaseAuthProvider";

export const supabase = getCockpitSupabaseClient();
export const STILLS_BUCKET = "editor-stills";
export const IDEA_STILLS_BUCKET = "ideation-stills";
export const AD_VIDEOS_BUCKET = "ad-videos";
