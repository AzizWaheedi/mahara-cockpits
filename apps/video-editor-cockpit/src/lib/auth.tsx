import type { Session } from "@supabase/supabase-js";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";

interface Who {
  session: Session | null;
  email: string;
  name: string;
  ready: boolean;
  signOut: () => Promise<void>;
}

const Ctx = createContext<Who>({
  session: null,
  email: "",
  name: "",
  ready: false,
  signOut: async () => {},
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => sub.subscription.unsubscribe();
  }, []);

  const value = useMemo<Who>(() => {
    const email = session?.user?.email ?? "";
    const meta = session?.user?.user_metadata as { name?: string; full_name?: string } | undefined;
    return {
      session,
      email,
      name: meta?.name || meta?.full_name || email.split("@")[0] || "",
      ready,
      signOut: async () => {
        await supabase.auth.signOut();
      },
    };
  }, [session, ready]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWho(): Who {
  return useContext(Ctx);
}
