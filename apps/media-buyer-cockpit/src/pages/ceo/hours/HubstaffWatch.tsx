import { useCallback, useEffect, useMemo, useState } from "react";
import { time } from "@/components/ceo/format";
import { useNow } from "@/components/ceo/useCeo";
import { api, useAction, useQueryState } from "@/lib/cockpitApi";
import type {
  WatchAiProvider,
  WatchBoard,
  WatchKeyResult,
  WatchNowResult,
  WatchSettings,
} from "@/types/ceo/hoursWatch";
import type { CeoTabKey } from "../types";
import { WatchCard } from "./WatchCard";

/**
 * Hubstaff watch on the Management tab: the board, read every 30 seconds
 * (`cockpit_ceo_hours_watch_board`), and the CEO's actions on it. A change
 * the server confirms re-reads the board; until it does, the switch shows
 * what was asked, and a refusal puts it back and says why.
 */

function errorText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  return raw.split("\n")[0].trim().replace(/\.+$/, "") || "No answer";
}

/** Signed links last 10 minutes; one is reused for 8, so a strip does not re-sign on every read. */
const signed = new Map<string, { url: string; at: number }>();
const SIGN_REUSE_MS = 8 * 60_000;

export function HubstaffWatch({
  order = 0,
  goTab,
}: {
  order?: number;
  goTab: (tab: CeoTabKey) => void;
}) {
  const now = useNow();
  const { data, error } = useQueryState<WatchBoard>(
    api.ceo.hours.watchBoard,
    {},
  );
  const put = useAction(api.ceo.hours.watchSet);
  const review = useAction(api.ceo.hours.watchReview);
  const check = useAction(api.ceo.hours.watchNow);
  const saveKey = useAction(api.ceo.hours.watchKey);

  const [asked, setAsked] = useState<Partial<WatchSettings>>({});
  const [reviewed, setReviewed] = useState<Map<number, string>>(new Map());
  const [checking, setChecking] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [reviewing, setReviewing] = useState<Set<number>>(new Set());
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);

  // A fresh board is the truth: what was asked for is now in it, or refused.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on each read
  useEffect(() => {
    setAsked({});
    setReviewed(new Map());
  }, [data]);

  const board = useMemo<WatchBoard | null>(() => {
    if (!data) return null;
    return {
      ...data,
      settings: { ...data.settings, ...asked },
      open: data.open.map(i =>
        reviewed.has(i.id) && !i.reviewedAt
          ? { ...i, reviewedAt: reviewed.get(i.id) ?? null }
          : i,
      ),
    };
  }, [data, asked, reviewed]);

  const onSet = useCallback(
    async (patch: Partial<WatchSettings>) => {
      await put(patch);
      setAsked(a => ({ ...a, ...patch }));
    },
    [put],
  );

  const onSetAlerts = useCallback(
    async (on: boolean) => {
      setSwitching(true);
      setAsked(a => ({ ...a, on }));
      setSaid(null);
      try {
        await put({ on });
        setSaid({
          ok: true,
          text: on
            ? "Slack alerts are on. New alerts are posted once each."
            : "Slack alerts are off. Alerts are still recorded here.",
        });
      } catch (e) {
        setAsked(({ on: _was, ...rest }) => rest);
        setSaid({
          ok: false,
          text: `Slack alerts were not switched: ${errorText(e)}.`,
        });
      } finally {
        setSwitching(false);
      }
    },
    [put],
  );

  const onCheckNow = useCallback(async () => {
    setChecking(true);
    setSaid(null);
    try {
      const out = (await check({})) as WatchNowResult;
      setSaid(
        out.ok
          ? {
              ok: true,
              text: "Checking now. This card updates within a minute.",
            }
          : {
              ok: true,
              text: `A check is already running${out.since ? ` since ${time(Date.parse(out.since))}` : ""}. This card updates when it ends.`,
            },
      );
    } catch (e) {
      setSaid({ ok: false, text: `The check did not start: ${errorText(e)}.` });
    } finally {
      setChecking(false);
    }
  }, [check]);

  const onReview = useCallback(
    async (incidentId: number) => {
      setReviewing(s => new Set(s).add(incidentId));
      setSaid(null);
      try {
        const out = (await review({ incidentId })) as {
          reviewedAt: string | null;
        };
        setReviewed(m =>
          new Map(m).set(
            incidentId,
            out.reviewedAt ?? new Date().toISOString(),
          ),
        );
      } catch (e) {
        setSaid({
          ok: false,
          text: `The alert was not marked reviewed: ${errorText(e)}.`,
        });
      } finally {
        setReviewing(s => {
          const next = new Set(s);
          next.delete(incidentId);
          return next;
        });
      }
    },
    [review],
  );

  const onKey = useCallback(
    async (a: { provider: WatchAiProvider; key: string }) =>
      (await saveKey(a)) as WatchKeyResult,
    [saveKey],
  );

  // Signing changes nothing, so it skips useAction's page-wide refresh.
  const sign = useCallback(async (path: string) => {
    const hit = signed.get(path);
    if (hit && Date.now() - hit.at < SIGN_REUSE_MS) return hit.url;
    const out = (await api.ceo.hours.watchShotUrl({ path })) as {
      url: string;
    };
    signed.set(path, { url: out.url, at: Date.now() });
    return out.url;
  }, []);

  const onGoTeam = useCallback(() => goTab("team"), [goTab]);

  return (
    <WatchCard
      board={board}
      error={error ? error.message : null}
      now={now}
      order={order}
      busy={{ checking, switching, reviewing, said }}
      actions={{
        onCheckNow: () => void onCheckNow(),
        onSetAlerts: on => void onSetAlerts(on),
        onSet,
        onKey,
        onReview: id => void onReview(id),
        onGoTeam,
        sign,
      }}
    />
  );
}
