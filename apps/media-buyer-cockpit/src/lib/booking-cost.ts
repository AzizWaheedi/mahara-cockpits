type AdCost = {
  key: string;
  adIds?: string[];
  spend: number;
  bookings: number;
  costPerBooking?: number;
};

export function bookingCostTone(
  value: number | undefined,
  gate: number,
): string {
  return value === undefined ? "" : value > gate ? "txt-bad" : "txt-good";
}

/** Never divide a zero-spend week into a booking bought in a prior week. */
export function bookingCostCell(
  row: AdCost,
  trailing30: AdCost[],
): { value?: number; label?: "30d" | "n/a"; selectedValue?: number } {
  const ref =
    row.adIds?.length === 1
      ? trailing30.find(
          r => r.adIds?.length === 1 && r.adIds[0] === row.adIds?.[0],
        )
      : undefined;
  // If this ad paid for most of its delivery before the selected window,
  // a tiny residual spend / recent booking looks like a cheap acquisition.
  // Use a clearly labeled matching-ID 30d reference, and keep the selected
  // quotient visible alongside it. Neither window borrows spend from the other.
  if (
    row.bookings > 0 &&
    ref?.costPerBooking !== undefined &&
    ref.spend > row.spend + 0.001
  ) {
    return {
      value: ref.costPerBooking,
      label: "30d",
      selectedValue: row.costPerBooking,
    };
  }
  if (row.costPerBooking !== undefined) return { value: row.costPerBooking };
  if (row.spend > 0 || row.bookings === 0) return { label: "n/a" };
  return ref?.costPerBooking !== undefined
    ? { value: ref.costPerBooking, label: "30d" }
    : { label: "n/a" };
}
