import type { Session, SupabaseClient } from "@supabase/supabase-js";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  cockpitAccessError,
  createCockpitSupabaseClient,
  observeSupabaseAccess,
  type SupabaseAccess,
  type SupabaseAccessObserver,
  type SupabaseAccessState,
  signOutCockpitSession,
} from "./supabaseAccess";

export interface CockpitAuthState {
  client: SupabaseClient | null;
  session: Session | null;
  access: SupabaseAccess | null;
  ready: boolean;
  error: string | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isCeo: boolean;
  email: string;
  name: string;
  roles: string[];
  clients: string[];
  cockpits: string[];
  home: string | null;
  signOut: () => Promise<void>;
  refreshAccess: () => Promise<void>;
}

const defaultState: CockpitAuthState = {
  client: null,
  session: null,
  access: null,
  ready: false,
  error: null,
  isAuthenticated: false,
  isAdmin: false,
  isCeo: false,
  email: "",
  name: "",
  roles: [],
  clients: [],
  cockpits: [],
  home: null,
  signOut: async () => {},
  refreshAccess: async () => {},
};

const CockpitAuthContext = createContext<CockpitAuthState>(defaultState);

let cachedClient: SupabaseClient | null = null;
export function getCockpitSupabaseClient(): SupabaseClient {
  if (!cachedClient) {
    cachedClient = createCockpitSupabaseClient();
  }
  return cachedClient;
}

export function SupabaseAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SupabaseAccessState>({
    session: null,
    access: null,
    ready: false,
    error: null,
  });
  const { session, access, ready, error } = state;
  const observer = useRef<SupabaseAccessObserver | null>(null);

  const client = useMemo(() => {
    try {
      return getCockpitSupabaseClient();
    } catch (err) {
      setState({
        session: null,
        access: null,
        ready: true,
        error: cockpitAccessError(err),
      });
      return null;
    }
  }, []);

  useEffect(() => {
    if (!client) return;
    const subscription = observeSupabaseAccess(client, setState);
    observer.current = subscription;
    return () => {
      subscription.unsubscribe();
      observer.current = null;
    };
  }, [client]);

  const signOut = useCallback(async () => {
    if (client) {
      await signOutCockpitSession(client);
    }
  }, [client]);

  const refreshAccess = useCallback(async () => {
    await observer.current?.refresh();
  }, []);

  const value = useMemo<CockpitAuthState>(() => {
    const email = access?.email ?? session?.user?.email ?? "";
    const name = access?.name ?? email.split("@")[0] ?? "";
    const roles = access?.roles ?? [];
    const clients = access?.clients ?? [];
    const cockpits = access?.cockpits ?? [];
    const isAdmin = Boolean(access?.isAdmin);
    const isCeo = Boolean(access?.isCeo);
    const home = access?.home ?? null;
    const isAuthenticated = Boolean(session?.user && access);

    return {
      client,
      session,
      access,
      ready,
      error,
      isAuthenticated,
      isAdmin,
      isCeo,
      email,
      name,
      roles,
      clients,
      cockpits,
      home,
      signOut,
      refreshAccess,
    };
  }, [client, session, access, ready, error, signOut, refreshAccess]);

  return (
    <CockpitAuthContext.Provider value={value}>
      {children}
    </CockpitAuthContext.Provider>
  );
}

export function useCockpitAuth(): CockpitAuthState {
  return useContext(CockpitAuthContext);
}
