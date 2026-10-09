import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router";
import type { Ym } from "@/types/ceo/hoursContract";

/** The four views of the Hours and pay card, as they read in the address. */
export const HOURS_VIEWS = ["month", "people", "links", "leave"] as const;
export type HoursViewKey = (typeof HOURS_VIEWS)[number];

export type HoursPlace = {
  month: Ym;
  view: HoursViewKey;
  person: number | null;
};

const PATTERN =
  /^#team\/hours\/(\d{4}-(?:0[1-9]|1[0-2]))\/(month|people|links|leave)(?:\/(\d+))?$/;

/** "#team/hours/2026-10/month/12" → the place, or null for anything else. */
export function parseHoursHash(hash: string): HoursPlace | null {
  const m = PATTERN.exec(hash);
  if (!m) return null;
  return {
    month: m[1],
    view: m[2] as HoursViewKey,
    person: m[3] ? Number(m[3]) : null,
  };
}

export function hoursHash(p: HoursPlace): string {
  return `#team/hours/${p.month}/${p.view}${p.person ? `/${p.person}` : ""}`;
}

/**
 * The month, the view and the open person, kept in the address hash so a
 * link (and the person page's "Open in Team & payroll") lands on the same
 * place: `#team/hours/2026-10/month`. The tab itself stays in `?tab=team`.
 */
export function useHoursHash(
  defaultMonth: Ym,
): [HoursPlace, (patch: Partial<HoursPlace>) => void] {
  const location = useLocation();
  const navigate = useNavigate();
  const place = parseHoursHash(location.hash) ?? {
    month: defaultMonth,
    view: "month" as const,
    person: null,
  };
  const set = useCallback(
    (patch: Partial<HoursPlace>) => {
      const next = { ...place, ...patch };
      navigate(
        { search: location.search, hash: hoursHash(next) },
        { replace: true, preventScrollReset: true },
      );
    },
    [place, location.search, navigate],
  );
  return [place, set];
}
