/** Numeric conversion shared by adapters and their offline arithmetic tests. */
export function num(x: unknown): number {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : 0;
}
