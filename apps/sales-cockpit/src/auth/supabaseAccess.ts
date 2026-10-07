import {
  createClient,
  type Session,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";

const PROJECT_HOST = "bldgtotkfmhoxmlzowdx.supabase.co";
const FOUNDER_EMAILS: Record<string, true> = {
  "aziz@maharamedia.com": true,
  "awaheedi2008@gmail.com": true,
};
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
export function createCockpitSupabaseClient(temporary = false): SupabaseClient {
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
      persistSession: !temporary,
      autoRefreshToken: !temporary,
      detectSessionInUrl: !temporary,
      ...(temporary
        ? { storageKey: `cockpit-verification-${crypto.randomUUID()}` }
        : {}),
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
  const isCeo = FOUNDER_EMAILS[email] === true;
  const cockpits = isAdmin
    ? [...COCKPITS]
    : COCKPITS.filter(cockpit => roles.includes(cockpit));
  const firstRole = roles.find(role => Object.hasOwn(HOME, role));

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

/** Bind an awaited result or password operation to the same confirmed Auth actor. */
export async function assertSupabaseActor(
  client: SupabaseClient,
  expected: User,
): Promise<User> {
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  const user = data.user;
  if (
    !user ||
    user.id !== expected.id ||
    !user.email_confirmed_at ||
    user.email?.trim().toLowerCase() !== expected.email?.trim().toLowerCase()
  ) {
    throw new Error("The signed-in account changed. Try again.");
  }
  // getUser is a network request. Check local Auth state again after that await.
  const { data: current, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  if (
    current.session?.user.id !== user.id ||
    current.session.user.email?.trim().toLowerCase() !==
      user.email?.trim().toLowerCase()
  ) {
    throw new Error("The signed-in account changed. Try again.");
  }
  return user;
}

export async function loadSupabaseAccess(
  client: SupabaseClient,
  expectedUserId?: string,
): Promise<SupabaseAccess | null> {
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError) throw authError;
  if (!authData.user || !authData.user.email_confirmed_at) return null;
  if (expectedUserId && authData.user.id !== expectedUserId) {
    throw new Error("The signed-in account changed. Try again.");
  }

  const { data: adopted, error: adoptError } = await client.rpc(
    "cockpit_adopt_member",
  );
  if (adoptError) throw adoptError;
  if (typeof adopted !== "boolean")
    throw new Error("Malformed cockpit adoption response");
  if (!adopted) {
    await assertSupabaseActor(client, authData.user);
    return null;
  }

  const { data: rpcAccess, error: rpcError } = await client.rpc(
    "cockpit_get_my_access",
  );
  if (rpcError) throw rpcError;
  const currentUser = await assertSupabaseActor(client, authData.user);
  if (rpcAccess === null) return null;

  if (typeof rpcAccess !== "object" || Array.isArray(rpcAccess)) {
    throw new Error("Malformed cockpit access response");
  }

  const raw = rpcAccess as Record<string, unknown>;
  if (
    typeof raw.email !== "string" ||
    raw.email !== authData.user.email?.trim().toLowerCase() ||
    !(raw.name === null || typeof raw.name === "string") ||
    typeof raw.is_admin !== "boolean" ||
    typeof raw.is_ceo !== "boolean" ||
    !(raw.home === null || typeof raw.home === "string") ||
    !Array.isArray(raw.cockpits) ||
    !raw.cockpits.every(c => typeof c === "string") ||
    !Array.isArray(raw.roles) ||
    !Array.isArray(raw.clients) ||
    !raw.roles.every(r => typeof r === "string") ||
    !raw.clients.every(c => typeof c === "string")
  ) {
    throw new Error("Malformed cockpit access response");
  }

  const member: SupabaseMember = {
    auth_user_id: authData.user.id,
    email: raw.email,
    name: raw.name as string | null,
    roles: raw.roles,
    clients: raw.clients,
    active: true,
  };

  return accessFromSupabaseMember(currentUser, member);
}

export interface SupabaseAccessState {
  session: Session | null;
  access: SupabaseAccess | null;
  ready: boolean;
  error: string | null;
}

export interface SupabaseAccessObserver {
  refresh: () => Promise<void>;
  unsubscribe: () => void;
}

export function cockpitAccessError(error: unknown): string {
  const message =
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
      ? error.message
      : "Cockpit access could not be loaded.";
  return `${message} Try again. If it continues, ask an admin to check the sign-in service.`;
}

/** Keep the complete token, including when the provider's code length changes. */
export function normalizeCockpitCode(code: string): string {
  const token = code.trim().replace(/[\s-]/g, "");
  if (!/^\d{6,10}$/.test(token)) {
    throw new Error("Enter the full code from your newest email.");
  }
  return token;
}

export function cockpitAuthError(error: unknown): string {
  const value =
    error && typeof error === "object"
      ? (error as { code?: string; message?: string })
      : {};
  const message =
    typeof value.message === "string"
      ? value.message
      : "Sign-in could not be completed. Try again.";
  if (
    /rate_limit|over_request_rate_limit/.test(value.code ?? "") ||
    /rate limit|too many requests|security purposes/i.test(message)
  ) {
    return "Please wait before requesting another code. Check your inbox for the newest email.";
  }
  if (
    value.code === "otp_expired" ||
    /token.*(expired|invalid)/i.test(message)
  ) {
    return "That code did not match or expired. Use the newest email or request a fresh code.";
  }
  if (/Signups not allowed for otp/i.test(message)) {
    return "Account setup is unavailable. Ask an admin to check the sign-in service.";
  }
  return message;
}

/** New Auth identities remain unprivileged until confirmed directory adoption. */
export async function requestCockpitCode(
  client: SupabaseClient,
  email: string,
): Promise<void> {
  const { error } = await client.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { shouldCreateUser: true },
  });
  if (error) throw error;
}

/** A normal sign-out clears this browser session, not other devices. */
export async function signOutCockpitSession(
  client: SupabaseClient,
): Promise<void> {
  const { error } = await client.auth.signOut({ scope: "local" });
  if (error) throw error;
}

/** React Router destinations must stay on this origin, including encoded paths. */
export function safeCockpitNext(next: string | null): string {
  if (!next) return "/";
  try {
    const decoded = decodeURIComponent(next);
    if (
      !/^\/(?!\/)/.test(next) ||
      !/^\/(?!\/)/.test(decoded) ||
      /[\s\\]/.test(next + decoded)
    )
      return "/";
    return next;
  } catch {
    return "/";
  }
}

export async function requestCockpitPasswordReset(
  client: SupabaseClient,
  expected: User,
): Promise<void> {
  const user = await assertSupabaseActor(client, expected);
  const { error } = await client.auth.resetPasswordForEmail(user.email!);
  if (error) throw error;
}

export async function completeCockpitPasswordReset(
  client: SupabaseClient,
  expected: User,
  code: string,
  password: string,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  const guard = () => {
    if (!isCurrent())
      throw new Error("The signed-in account changed. Try again.");
  };
  guard();
  const token = normalizeCockpitCode(code);
  if (password.length < 8)
    throw new Error("Use a password with at least eight characters.");
  await assertSupabaseActor(client, expected);
  guard();
  // verifyOtp saves its returned session. Keep that side effect out of the main login.
  const verification = createCockpitSupabaseClient(true);
  try {
    const { data, error } = await verification.auth.verifyOtp({
      email: expected.email!,
      token,
      type: "recovery",
    });
    if (error) throw error;
    guard();
    if (
      data.user?.id !== expected.id ||
      data.user.email?.trim().toLowerCase() !==
        expected.email?.trim().toLowerCase()
    ) {
      throw new Error("The signed-in account changed. Try again.");
    }
    await assertSupabaseActor(client, expected);
    guard();
    const { error: updateError } = await verification.auth.updateUser({
      password,
    });
    if (updateError) throw updateError;
  } finally {
    await verification.auth.stopAutoRefresh();
  }
}

/** All five providers share cancellation and defer network calls past the Auth lock. */
export function observeSupabaseAccess(
  client: SupabaseClient,
  receive: (state: SupabaseAccessState) => void,
): SupabaseAccessObserver {
  let active = true;
  let generation = 0;
  let session: Session | null = null;
  let state: SupabaseAccessState = {
    session: null,
    access: null,
    ready: false,
    error: null,
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const current = (version: number) => active && version === generation;
  function publish(next: SupabaseAccessState) {
    state = next;
    receive(next);
  }

  async function load(version: number, target: Session | null): Promise<void> {
    if (!current(version)) return;
    try {
      const access = target
        ? await loadSupabaseAccess(client, target.user.id)
        : null;
      if (current(version))
        publish({ session: target, access, ready: true, error: null });
    } catch (error) {
      if (!current(version)) return;
      publish({
        session: target,
        access: null,
        ready: true,
        error: cockpitAccessError(error),
      });
      throw error;
    }
  }

  function begin(next: Session | null) {
    clearTimeout(timer);
    const sameVerifiedActor = Boolean(
      state.ready &&
        state.access &&
        next?.user.email_confirmed_at &&
        state.session?.user.id === next.user.id &&
        state.access.email === next.user.email?.trim().toLowerCase(),
    );
    session = next;
    const version = ++generation;
    // Token refresh must not unmount a verified actor's unsaved page state.
    // A changed subject loses access immediately; denial/fault also clears it.
    publish(
      sameVerifiedActor
        ? { ...state, session: next }
        : { session: next, access: null, ready: false, error: null },
    );
    return version;
  }

  function changed(next: Session | null) {
    if (!active) return;
    const version = begin(next);
    timer = setTimeout(() => {
      void load(version, next).catch(() => {});
    }, 0);
  }

  const initial = generation;
  void client.auth
    .getSession()
    .then(({ data, error }) => {
      if (!current(initial)) return;
      if (error) throw error;
      changed(data.session);
    })
    .catch(error => {
      if (current(initial))
        publish({
          session: null,
          access: null,
          ready: true,
          error: cockpitAccessError(error),
        });
    });
  const { data: subscription } = client.auth.onAuthStateChange((_event, next) =>
    changed(next),
  );

  return {
    async refresh() {
      if (!active) return;
      let version = begin(session);
      try {
        const { data, error } = await client.auth.getSession();
        if (!current(version)) return;
        if (error) throw error;
        version = begin(data.session);
      } catch (error) {
        if (!current(version)) return;
        publish({
          session,
          access: null,
          ready: true,
          error: cockpitAccessError(error),
        });
        throw error;
      }
      await load(version, session);
    },
    unsubscribe() {
      active = false;
      ++generation;
      clearTimeout(timer);
      subscription.subscription.unsubscribe();
    },
  };
}
