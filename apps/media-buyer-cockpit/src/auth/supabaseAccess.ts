import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";

const PROJECT_HOST = "bldgtotkfmhoxmlzowdx.supabase.co";
const FOUNDER_EMAILS = new Set([
  "aziz@maharamedia.com",
  "awaheedi2008@gmail.com",
]);
const COCKPITS = ["media_buyer", "csm", "creative", "editor", "sales"] as const;
const HOME: Record<string, string> = {
  admin: "/admin",
  media_buyer: "/dashboard",
  csm: "/go/csm",
  creative: "/go/creative",
  editor: "/go/editor",
  sales: "/go/sales",
};

export interface SupabaseMember {
  auth_user_id: string | null;
  email: string;
  name: string | null;
  roles: string[];
  clients: string[];
  active: boolean;
}

export interface SupabaseAccess {
  email: string;
  name: string | null;
  roles: string[];
  clients: string[];
  isAdmin: boolean;
  isCeo: boolean;
  cockpits: string[];
  home: string | null;
}

/** The public client exists only when the Supabase login path is enabled. */
export function createCockpitSupabaseClient(): SupabaseClient {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
  let origin: string | null = null;
  try {
    origin = url ? new URL(url).origin : null;
  } catch {
    // A malformed or unexpected URL fails closed below.
  }
  if (origin !== `https://${PROJECT_HOST}` || !anon) {
    throw new Error("Cockpit sign-in is not configured for Creative Triage.");
  }
  return createClient(url!, anon, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

/** Use a verified Auth user and its exact active directory link, never email alone. */
export function accessFromSupabaseMember(
  user: User,
  member: SupabaseMember | null,
): SupabaseAccess | null {
  const email = user.email?.trim().toLowerCase();
  if (
    !email ||
    !user.email_confirmed_at ||
    !member?.active ||
    member.auth_user_id !== user.id ||
    member.email !== email
  ) {
    return null;
  }

  const roles = member.roles ?? [];
  const isAdmin = roles.includes("admin");
  const isCeo = FOUNDER_EMAILS.has(email);
  const cockpits = isAdmin
    ? [...COCKPITS]
    : COCKPITS.filter(cockpit => roles.includes(cockpit));
  const firstRole = roles.find(role => HOME[role]);

  return {
    email,
    name: member.name,
    roles,
    clients: member.clients ?? [],
    isAdmin,
    isCeo,
    cockpits,
    home: isCeo
      ? "/ceo"
      : isAdmin
        ? "/admin"
        : firstRole
          ? HOME[firstRole]
          : null,
  };
}

/** Fail closed on failed Auth or directory reads; no legacy static-role fallback. */
export async function loadSupabaseAccess(
  client: SupabaseClient,
): Promise<SupabaseAccess | null> {
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError) throw authError;
  if (!authData.user) return null;

  const { data: member, error: memberError } = await client
    .from("cockpit_members")
    .select("auth_user_id,email,name,roles,clients,active")
    .eq("auth_user_id", authData.user.id)
    .eq("active", true)
    .maybeSingle();
  if (memberError) throw memberError;
  return accessFromSupabaseMember(authData.user, member);
}
