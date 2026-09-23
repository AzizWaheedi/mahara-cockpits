/** Campaign changes are reviewed against complete Kuwait calendar days. */
export const DAY_MS = 86_400_000;

export function kuwaitDay(at: number): string {
  return new Date(at + 3 * 3_600_000).toISOString().slice(0, 10);
}

export function shiftDay(day: string, offset: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + offset * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export type DailyRow = { date: string; spend: number; leads: number };
export type BookingRow = { date: string; adId?: string };
export type ChangeAt = { id: string; at: number };
export type WindowResult = {
  from: string;
  to: string;
  daysWithData: number;
  spend: number;
  leads: number;
  cpl: number | null;
  attributedBookings: number;
};
export type ObservedResult = {
  state: "too_early" | "inconclusive" | "observed";
  reason: string;
  before: WindowResult;
  after: WindowResult;
};

export function windowResult(
  from: string,
  to: string,
  daily: DailyRow[],
  bookings: BookingRow[],
): WindowResult {
  const rows = daily.filter(row => row.date >= from && row.date <= to);
  const spend = rows.reduce((sum, row) => sum + row.spend, 0);
  const leads = rows.reduce((sum, row) => sum + row.leads, 0);
  return {
    from,
    to,
    daysWithData: new Set(rows.map(row => row.date)).size,
    spend: Math.round(spend * 100) / 100,
    leads,
    cpl: leads > 0 ? Math.round((spend / leads) * 100) / 100 : null,
    // The appointment feed only assigns a booking to this campaign when its
    // source can be matched. This is not a count of every client booking.
    attributedBookings: bookings.filter(
      row => row.date >= from && row.date <= to,
    ).length,
  };
}

/**
 * The change day is excluded. Three complete days either side avoid mixing
 * the partial day of an edit with a complete day. The three-day learning rule
 * is a minimum before the after period can be judged, not a causal claim.
 */
export function compareChange(
  change: ChangeAt,
  otherChanges: ChangeAt[],
  daily: DailyRow[],
  bookings: BookingRow[],
  now: number,
): ObservedResult {
  const day = kuwaitDay(change.at);
  const before = windowResult(
    shiftDay(day, -3),
    shiftDay(day, -1),
    daily,
    bookings,
  );
  const after = windowResult(
    shiftDay(day, 1),
    shiftDay(day, 3),
    daily,
    bookings,
  );
  const report = (
    state: ObservedResult["state"],
    reason: string,
  ): ObservedResult => ({ state, reason, before, after });
  if (kuwaitDay(now) <= after.to) {
    return report(
      "too_early",
      "Wait for three complete days after the change.",
    );
  }
  const latestDay = daily.reduce(
    (latest, row) => (row.date > latest ? row.date : latest),
    "",
  );
  if (latestDay < after.to) {
    return kuwaitDay(now) > shiftDay(after.to, 3)
      ? report(
          "inconclusive",
          "The daily feed does not cover this review period.",
        )
      : report(
          "too_early",
          "The spend and lead feed has not reached the review date.",
        );
  }
  if (before.daysWithData < 3 || after.daysWithData < 3) {
    return report(
      "inconclusive",
      "A complete daily comparison is not available.",
    );
  }
  const overlapping = otherChanges.some(
    other =>
      other.id !== change.id &&
      kuwaitDay(other.at) >= before.from &&
      kuwaitDay(other.at) <= after.to,
  );
  if (overlapping) {
    return report(
      "inconclusive",
      "Other changes happened in the comparison window.",
    );
  }
  if (before.leads < 5 || after.leads < 5) {
    return report("inconclusive", "Fewer than five leads in either period.");
  }
  return report("observed", "Results observed after the change.");
}
