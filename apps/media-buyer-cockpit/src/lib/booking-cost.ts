type AdCost = {
  key: string;
  adIds?: string[];
  spend: number;
  bookings: number;
  costPerBooking?: number;
};

/** Never divide a zero-spend week into a booking bought in a prior week. */
export function bookingCostCell(
  row: AdCost,
  trailing30: AdCost[],
): { value?: number; label?: "30d" | "n/a" } {
  if (row.costPerBooking !== undefined) return { value: row.costPerBooking };
  if (row.spend > 0 || row.bookings === 0) return { label: "n/a" };
  const ref = trailing30.find(
    r => r.adIds?.length === 1 && row.adIds?.some(id => r.adIds?.includes(id)),
  );
  return ref?.costPerBooking !== undefined
    ? { value: ref.costPerBooking, label: "30d" }
    : { label: "n/a" };
}
