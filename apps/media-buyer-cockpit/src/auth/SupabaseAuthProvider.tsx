import type { Session, SupabaseClient } from "@supabase/supabase-js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  createCockpitSupabaseClient,
  loadSupabaseAccess,
  type SupabaseAccess,
} from "./supabaseAccess";

export interface CockpitAuthState {
  client: SupabaseClient | null;
  session: Session | null;
  access: SupabaseAccess | null;
  ready: boolean;
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
  const [session, setSession] = useState<Session | null>(null);
  const [access, setAccess] = useState<SupabaseAccess | null>(null);
  const [ready, setReady] = useState(false);

  const client = useMemo(() => {
    try {
      return getCockpitSupabaseClient();
    } catch (err) {
      console.error("Failed to initialize Supabase client:", err);
      return null;
    }
  }, []);

  const reloadAccess = useCallback(
    async (targetClient: SupabaseClient, targetSession: Session | null) => {
      if (!targetSession?.user || !targetSession.user.email_confirmed_at) {
        setAccess(null);
        return;
      }
      try {
        const loaded = await loadSupabaseAccess(targetClient);
        setAccess(loaded);
      } catch (err) {
        console.error("Failed to load cockpit access:", err);
        setAccess(null);
      }
    },
    [],
  );

  useEffect(() => {
    if (!client) {
      setReady(true);
      return;
    }

    client.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await reloadAccess(client, data.session);
      setReady(true);
    });

    const { data: sub } = client.auth.onAuthStateChange(
      async (_event, nextSession) => {
        setSession(nextSession);
        await reloadAccess(client, nextSession);
        setReady(true);
      },
    );

    return () => {
      sub.subscription.unsubscribe();
    };
  }, [client, reloadAccess]);

  const signOut = useCallback(async () => {
    if (client) {
      await client.auth.signOut();
    }
    setSession(null);
    setAccess(null);
  }, [client]);

  const refreshAccess = useCallback(async () => {
    if (client && session) {
      await reloadAccess(client, session);
    }
  }, [client, session, reloadAccess]);

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
  }, [client, session, access, ready, signOut, refreshAccess]);

  return (
    <CockpitAuthContext.Provider value={value}>
      {children}
    </CockpitAuthContext.Provider>
  );
}

export function useCockpitAuth(): CockpitAuthState {
  return useContext(CockpitAuthContext);
}
