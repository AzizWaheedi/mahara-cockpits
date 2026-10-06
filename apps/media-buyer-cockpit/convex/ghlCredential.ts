/** A format check, not authorization. HighLevel verifies scope and expiry.
 * Client Data can hold a private integration token or a managed OAuth token.
 * Do not use a PIT prefix to decide whether a location exists.
 */
export function hasGhlCredential(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 20 &&
    value.length <= 8192 &&
    /^[A-Za-z0-9._~+/-]+={0,2}$/.test(value)
  );
}

/** A source-owned location link remains useful while credentials renew. */
export function sourceGhlLink(
  row: { clickupId: string; ghlLocationId: string } | undefined,
  taskId: string,
): string | undefined {
  if (
    !taskId ||
    row?.clickupId !== taskId ||
    !/^[A-Za-z0-9]{10,40}$/.test(row.ghlLocationId)
  )
    return undefined;
  return `https://app.maharamedia.com/v2/location/${row.ghlLocationId}/dashboard`;
}
