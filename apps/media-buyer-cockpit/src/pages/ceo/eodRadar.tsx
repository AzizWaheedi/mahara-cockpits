import { useMemo } from "react";
import { useNow } from "@/components/ceo/useCeo";
import { api, useQueryState } from "@/lib/cockpitApi";
import type { EodRadarBoard } from "@/types/ceo/eodRadar";
import { EodRadarCard } from "./eodRadarCard";
import { gridWindow, radarToday } from "./eodRadarCopy";

/** The Management tab's EOD Radar: the last 15 working days, re-read every 30 seconds. */
export function EodRadar({ order = 0 }: { order?: number }) {
  const now = useNow();
  const today = radarToday(now);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the window moves only when the working day does
  const window = useMemo(() => gridWindow(now), [today]);
  const { data, error } = useQueryState<EodRadarBoard>(
    api.ceo.eodRadar.read,
    window,
  );
  return (
    <EodRadarCard
      board={data ?? null}
      error={error ? error.message : null}
      now={now}
      order={order}
    />
  );
}
