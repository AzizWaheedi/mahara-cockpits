import { useAction, useMutation, useQuery } from "convex/react";
import { useCallback, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { AskResult } from "../../../convex/chat";
import type { Retrieval } from "../../../convex/search";

/**
 * The one place the screen talks to the backend.
 *
 * Two ideas run through all of it:
 *   — the access code lives in this browser only, and every call carries it,
 *     because the server checks it on every read and write;
 *   — a subscription keeps its last good answer while it refetches, so a
 *     refresh never flashes the screen back to a loading state.
 */

const CODE_KEY = "memory-core-code";

export function useAccessCode() {
  const [code, setCode] = useState<string>(() => {
    try {
      return localStorage.getItem(CODE_KEY) ?? "";
    } catch {
      return "";
    }
  });

  const save = useCallback((next: string) => {
    try {
      if (next) localStorage.setItem(CODE_KEY, next);
      else localStorage.removeItem(CODE_KEY);
    } catch {
      // A browser that blocks storage still works for this session.
    }
    setCode(next);
  }, []);

  return { code, save };
}

/** Is the door open? Never throws — the unlock screen shows the sentence. */
export function useGate(code: string) {
  const access = useQuery(api.memory.checkAccess, code ? { code } : "skip");
  return {
    loading: access === undefined,
    ok: access?.ok === true,
    configured: access?.configured !== false,
    message: access?.message ?? "",
  };
}

export type Overview = {
  sources: {
    key: string;
    label: string;
    connected: boolean;
    note: string;
    lastSyncAt: number | null;
    lastOkAt: number | null;
    lastCount: number | null;
    itemCount: number;
    lastError: string | null;
    neverSynced: boolean;
  }[];
  systems: {
    source: string;
    label: string;
    alertAfter: number;
    recent: { ok: boolean; at: number; detail: string | null }[];
  }[];
  trouble: string[];
  audit: { at: number; actor: string; action: string; detail: string }[];
  totals: { items: number; memories: number; lastSyncAt: number | null };
  answerModel: string;
  serverNow: number;
};

/** Sources, totals, the health tail and the audit tail, in one subscription. */
export function useOverview(code: string) {
  const data = useQuery(api.memory.overview, code ? { code } : "skip") as
    | Overview
    | undefined;
  const last = useRef<Overview | undefined>(undefined);
  if (data !== undefined) last.current = data;
  return {
    /** True only before the very first answer arrives. */
    loading: data === undefined && last.current === undefined,
    overview: (data ?? last.current ?? null) as Overview | null,
    /** True while a refetch is in flight over an existing answer. */
    revalidating: data === undefined && last.current !== undefined,
  };
}

export function useRecentItems(code: string, limit = 8) {
  return useQuery(api.memory.recentItems, code ? { code, limit } : "skip") as
    | {
        id: string;
        source: string;
        title: string;
        snippet: string;
        url: string | null;
        occurredAt: number;
      }[]
    | undefined;
}

export function useMemories(code: string, limit = 60) {
  return useQuery(api.memory.memories, code ? { code, limit } : "skip") as
    | {
        id: string;
        title: string;
        snippet: string;
        occurredAt: number;
        tags: string[];
      }[]
    | undefined;
}

export function useChats(code: string) {
  return useQuery(api.memory.chats, code ? { code, limit: 25 } : "skip") as
    | {
        id: string;
        title: string;
        lastMessageAt: number;
        groundedBy: number | null;
      }[]
    | undefined;
}

export function useChatMessages(code: string, chatId: string | null) {
  return useQuery(
    api.memory.chatMessages,
    code && chatId ? { code, chatId: chatId as never } : "skip",
  ) as
    | {
        id: string;
        role: "asker" | "memory";
        text: string;
        citations: {
          n: number;
          source: string;
          title: string;
          externalId: string;
          url?: string;
          snippet: string;
        }[];
        grounded: boolean;
        model: string | null;
        at: number;
      }[]
    | undefined;
}

/** Save a memory, and know whether it landed. */
export function useSaveMemory() {
  const save = useMutation(api.memory.saveMemory);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (code: string, text: string, tags?: string[]) => {
      setBusy(true);
      setError(null);
      try {
        await save({ code, text, tags });
        return true;
      } catch (e) {
        setError(cleanError(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [save],
  );
  return { run, busy, error, clearError: () => setError(null) };
}

export function useForgetMemory() {
  const forget = useMutation(api.memory.forgetMemory);
  const run = useCallback(
    async (code: string, id: string) => {
      await forget({ code, id: id as never });
    },
    [forget],
  );
  return run;
}

/** One search, with the state a screen needs to show what just happened. */
export function useSearch() {
  const search = useAction(api.search.search);
  const [state, setState] = useState<{
    busy: boolean;
    result: Retrieval | null;
    error: string | null;
  }>({ busy: false, result: null, error: null });

  const run = useCallback(
    async (code: string, query: string, live = true) => {
      setState(previous => ({ ...previous, busy: true, error: null }));
      try {
        const result = (await search({ code, query, live })) as Retrieval;
        setState({ busy: false, result, error: null });
        return result;
      } catch (e) {
        setState(previous => ({
          busy: false,
          result: previous.result,
          error: cleanError(e),
        }));
        return null;
      }
    },
    [search],
  );

  return { ...state, run };
}

/** Read a Notion page's text into the index. */
export function useReadNotionPage() {
  const read = useAction(api.search.readNotionPageIntoMemory);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (
      code: string,
      pageId: string,
      title?: string,
      url?: string | null,
    ) => {
      setBusyId(pageId);
      setError(null);
      try {
        const result = await read({
          code,
          pageId,
          title,
          url: url ?? undefined,
        });
        return result;
      } catch (e) {
        setError(cleanError(e));
        return null;
      } finally {
        setBusyId(null);
      }
    },
    [read],
  );
  return { run, busyId, error, clearError: () => setError(null) };
}

/** One question, and the grounded answer that comes back. */
export function useAsk() {
  const ask = useAction(api.chat.ask);
  const [state, setState] = useState<{
    busy: boolean;
    answer: AskResult | null;
    error: string | null;
  }>({ busy: false, answer: null, error: null });

  const run = useCallback(
    async (
      code: string,
      question: string,
      chatId: string | null,
      live = true,
    ) => {
      setState(previous => ({ ...previous, busy: true, error: null }));
      try {
        const answer = (await ask({
          code,
          question,
          chatId: (chatId ?? undefined) as never,
          live,
        })) as AskResult;
        setState({ busy: false, answer, error: null });
        return answer;
      } catch (e) {
        setState(previous => ({
          busy: false,
          answer: previous.answer,
          error: cleanError(e),
        }));
        return null;
      }
    },
    [ask],
  );

  return { ...state, run };
}

/** Sync all three sources now. */
export function useSync() {
  const syncAll = useAction(api.sync.syncAll);
  const [state, setState] = useState<{
    busy: boolean;
    note: string | null;
    error: string | null;
  }>({ busy: false, note: null, error: null });

  const run = useCallback(
    async (code: string) => {
      setState({ busy: true, note: null, error: null });
      try {
        const result = (await syncAll({ code })) as {
          inserted: number;
          results: {
            source: string;
            ok: boolean;
            count: number;
            note: string;
          }[];
        };
        const failed = result.results.filter(row => !row.ok);
        setState({
          busy: false,
          note:
            result.inserted === 0
              ? "Synced — nothing new since last time."
              : `Synced ${result.inserted} new item${result.inserted === 1 ? "" : "s"}.`,
          error:
            failed.length > 0
              ? `${failed.map(row => row.source).join(", ")} did not answer. Open Sources for what to do.`
              : null,
        });
        return result;
      } catch (e) {
        setState({ busy: false, note: null, error: cleanError(e) });
        return null;
      }
    },
    [syncAll],
  );

  return { ...state, run };
}

/** Convex wraps thrown errors; the screen wants the sentence inside. */
export function cleanError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const uncaught = raw.match(/Uncaught Error:\s*([\s\S]*)/);
  return (
    (uncaught ? uncaught[1] : raw).split("\n")[0]?.trim() ||
    "Something went wrong."
  );
}
