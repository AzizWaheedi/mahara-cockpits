import { useMutation, useQuery } from "convex/react";
import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type {
  AssetsPayload,
  CallsPayload,
  ClientsPayload,
  DeliveryPayload,
  ExpensesPayload,
  GrowthPayload,
  MachinePayload,
  MoneyPayload,
  PortalPayload,
  TeamPayload,
} from "../../../convex/ceo/payloads";
import type { SourceStamp } from "../../../convex/ceo/types";

export const SECTION_KEYS = [
  "money",
  "expenses",
  "growth",
  "delivery",
  "calls",
  "clients",
  "team",
  "portal",
  "assets",
  "machine",
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

export type PayloadMap = {
  money: MoneyPayload;
  expenses: ExpensesPayload;
  growth: GrowthPayload;
  delivery: DeliveryPayload;
  calls: CallsPayload;
  clients: ClientsPayload;
  team: TeamPayload;
  portal: PortalPayload;
  assets: AssetsPayload;
  machine: MachinePayload;
};

/** One section as the screen reads it. `payload` keeps the last good numbers when `ok` is false. */
export type CeoSection<K extends SectionKey = SectionKey> = {
  key: K;
  label: string;
  ok: boolean;
  error: string | null;
  /** When the last attempt ran (good or not), epoch ms. */
  computedAt: number;
  /** When the payload was last computed without an error, epoch ms. */
  lastOkAt: number | null;
  sources: SourceStamp[];
  payload: PayloadMap[K] | null;
};

export type AnyCeoSection = { [K in SectionKey]: CeoSection<K> }[SectionKey];

/** Every key is present; null means the section has not been computed yet. */
export type CeoSections = { [K in SectionKey]: CeoSection<K> | null };

/** A section is treated as stale when its last attempt is older than this. */
export const STALE_AFTER_MS = 45 * 60_000;

function normalize(raw: unknown): CeoSections {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    Record<string, unknown> | undefined
  >;
  const out = {} as Record<SectionKey, CeoSection | null>;
  for (const key of SECTION_KEYS) {
    const r = src[key];
    if (!r || typeof r !== "object") {
      out[key] = null;
      continue;
    }
    out[key] = {
      key,
      label: typeof r.label === "string" ? r.label : key,
      ok: r.ok === true,
      error: typeof r.error === "string" ? r.error : null,
      computedAt: typeof r.computedAt === "number" ? r.computedAt : 0,
      lastOkAt: typeof r.lastOkAt === "number" ? r.lastOkAt : null,
      sources: Array.isArray(r.sources) ? (r.sources as SourceStamp[]) : [],
      payload: (r.payload ?? null) as CeoSection["payload"],
    } as CeoSection;
  }
  return out as CeoSections;
}

type TodayResult = { sections?: unknown; day?: string; now?: number };

/**
 * The CEO data in one subscription. Holds the previous result while Convex
 * refetches, so the screen never flashes back to a loading state.
 */
export function useCeo(enabled = true): {
  /** True only before the very first result arrives. */
  loading: boolean;
  sections: CeoSections;
  /** Kuwait day on the server, "YYYY-MM-DD". */
  day: string | null;
  /** Server clock at query time, epoch ms. */
  serverNow: number | null;
} {
  const data = useQuery(api.ceo.queries.today, enabled ? {} : "skip") as
    | TodayResult
    | undefined;
  const last = useRef<TodayResult | undefined>(undefined);
  if (data !== undefined) last.current = data;
  const current = data ?? last.current;
  const raw = current?.sections;
  const sections = useMemo(() => normalize(raw), [raw]);
  return {
    loading: current === undefined,
    sections,
    day: current?.day ?? null,
    serverNow: current?.now ?? null,
  };
}

// --- A shared clock, so relative times across the page tick together ---

const clock = {
  now: Date.now(),
  listeners: new Set<() => void>(),
  timer: undefined as ReturnType<typeof setInterval> | undefined,
};

function subscribeClock(listener: () => void) {
  clock.listeners.add(listener);
  if (!clock.timer) {
    clock.now = Date.now();
    clock.timer = setInterval(() => {
      clock.now = Date.now();
      for (const l of clock.listeners) l();
    }, 30_000);
  }
  return () => {
    clock.listeners.delete(listener);
    if (clock.listeners.size === 0 && clock.timer) {
      clearInterval(clock.timer);
      clock.timer = undefined;
    }
  };
}

/** Current time, refreshed every 30 seconds for every caller at once. */
export function useNow(): number {
  return useSyncExternalStore(
    subscribeClock,
    () => clock.now,
    () => clock.now,
  );
}

// --- Refresh: one busy state shared by the header button and every empty state ---

const REFRESH_BUSY_MS = 20_000;

const refreshState = {
  busy: false,
  listeners: new Set<() => void>(),
  timer: undefined as ReturnType<typeof setTimeout> | undefined,
};

function setRefreshBusy(busy: boolean) {
  refreshState.busy = busy;
  if (refreshState.timer) clearTimeout(refreshState.timer);
  refreshState.timer = busy
    ? setTimeout(() => setRefreshBusy(false), REFRESH_BUSY_MS)
    : undefined;
  for (const l of refreshState.listeners) l();
}

function subscribeRefresh(listener: () => void) {
  refreshState.listeners.add(listener);
  return () => {
    refreshState.listeners.delete(listener);
  };
}

/**
 * Recompute sections in the background. `busy` stays true for 20 seconds after
 * a click (the recompute is not observable from here), shared across the page.
 */
export function useRefresh(): {
  refresh: (only?: SectionKey[]) => Promise<void>;
  busy: boolean;
} {
  const mutate = useMutation(api.ceo.queries.refreshNow);
  const busy = useSyncExternalStore(
    subscribeRefresh,
    () => refreshState.busy,
    () => refreshState.busy,
  );
  const refresh = useCallback(
    async (only?: SectionKey[]) => {
      if (refreshState.busy) return;
      setRefreshBusy(true);
      try {
        await mutate(only?.length ? { only } : {});
      } catch {
        setRefreshBusy(false);
        toast.error("Could not start a refresh. Try again in a minute.");
      }
    },
    [mutate],
  );
  return { refresh, busy };
}

// --- Trust across the page ---

export type TrustSummary = {
  /** Oldest last attempt across computed sections, epoch ms. */
  asOf: number | null;
  /** Names of sections that errored or are older than 45 minutes, plus outside feeds that are not ok. */
  stale: string[];
  /** Labels of sections not computed yet. */
  missing: SectionKey[];
  hermes: { queued: number; failed: number } | null;
};

/** Data age, stale sources and the Hermes queue, for the header pills. */
export function trustSummary(sections: CeoSections, now: number): TrustSummary {
  let asOf: number | null = null;
  const stale: string[] = [];
  const missing: SectionKey[] = [];
  for (const key of SECTION_KEYS) {
    const s = sections[key];
    if (!s) {
      missing.push(key);
      continue;
    }
    if (s.computedAt && (asOf === null || s.computedAt < asOf))
      asOf = s.computedAt;
    if (!s.ok || now - s.computedAt > STALE_AFTER_MS) stale.push(s.label);
  }
  const machine = sections.machine?.payload;
  for (const f of machine?.feeds ?? []) if (!f.ok) stale.push(f.name);
  return {
    asOf,
    stale,
    missing,
    hermes: machine
      ? { queued: machine.hermes.queued, failed: machine.hermes.failed }
      : null,
  };
}
