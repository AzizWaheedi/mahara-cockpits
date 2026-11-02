import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { readRequestTypes } from "@/lib/requestsClient";
import { requestsOpen, type WriterMode } from "@/lib/requestsCore";

/**
 * Whether the request form replaces the client page's old "Ask a team"
 * (review F6). The old path (a decision-log ticket, live since 2026-10-12)
 * and AddTask's team choices stay until requests are open for this client:
 * the writer is "apply", or "apply_limited" and the card is the test card.
 * While the writer's mode is being read, or the read fails, the answer is
 * false, so the CSM keeps the path that works today.
 */

/** A read is kept a minute, so a page left open sees requests open. */
const KEEP_MS = 60_000;
const modes = new WeakMap<
  SupabaseClient,
  { at: number; read: Promise<WriterMode | null> }
>();

/** The requests writer's mode, read at most once a minute per client. */
export function writerMode(client: SupabaseClient): Promise<WriterMode | null> {
  const kept = modes.get(client);
  if (kept && Date.now() - kept.at < KEEP_MS) return kept.read;
  const read = readRequestTypes(client)
    .then(t => t.writer?.mode ?? null)
    .catch(() => {
      // A failed read is tried again next time, and keeps the old path.
      modes.delete(client);
      return null;
    });
  modes.set(client, { at: Date.now(), read });
  return read;
}

/** Forgets the kept read (the tests, which change the mode between them). */
export function forgetWriterMode(client: SupabaseClient): void {
  modes.delete(client);
}

/** The writer's mode; null while it is read or when the read failed. */
export function useWriterMode(): WriterMode | null {
  const { client } = useCockpitAuth();
  const [mode, setMode] = useState<WriterMode | null>(null);
  useEffect(() => {
    if (!client) return;
    let live = true;
    void writerMode(client).then(m => {
      if (live) setMode(m);
    });
    return () => {
      live = false;
    };
  }, [client]);
  return mode;
}

/** True once requests are open for this client card; false until then. */
export function useRequestsOpen(clientTaskId: string | null): boolean {
  const mode = useWriterMode();
  return requestsOpen(mode ? { mode } : null, clientTaskId);
}
