import type { Session } from "@supabase/supabase-js";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
} from "react";
import { supabase } from "./supabase";
import { observeSupabaseAccess, type SupabaseAccessObserver, type SupabaseAccessState } from "../auth/supabaseAccess";

interface Who {
  session: Session | null;
  email: string;
  name: string;
  /** Current confirmed directory roles; profile metadata never grants access. */
  roles: string[];
  /** The other cockpits this person may open. */
  cockpits: string[];
  isAdmin: boolean;
  isCeo: boolean;
  ready: boolean;
  error: string | null;
  refreshAccess: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<Who>({
  session: null,
  email: "",
  name: "",
  roles: [],
  cockpits: [],
  isAdmin: false,
  isCeo: false,
  ready: false,
  error: null,
  refreshAccess: async () => {},
  signOut: async () => {},
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SupabaseAccessState>({ session: null, access: null, ready: false, error: null });
  const { session, access, ready, error } = state;
  const observer = useRef<SupabaseAccessObserver | null>(null);

  useEffect(() => {
    const subscription = observeSupabaseAccess(supabase, setState);
    observer.current = subscription;
    return () => { subscription.unsubscribe(); observer.current = null; };
  }, []);

  const value = useMemo<Who>(() => {
    const email = session?.user?.email ?? "";
    const meta = session?.user?.user_metadata as
      | { name?: string; full_name?: string }
      | undefined;
    const roles = access?.roles ?? [];
    return {
      session,
      email,
      name: meta?.name || meta?.full_name || email.split("@")[0] || "",
      roles,
      cockpits: access?.cockpits ?? [],
      isAdmin: access?.isAdmin ?? false,
      isCeo: access?.isCeo ?? false,
      ready,
      error,
      refreshAccess: async () => { await observer.current?.refresh(); },
      signOut: async () => {
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) throw signOutError;
      },
    };
  }, [session, access, ready, error]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWho(): Who {
  return useContext(Ctx);
}
