/** Numeric conversion shared by adapters and their offline arithmetic tests. */
export function num(x) {
    const n = typeof x === "number" ? x : Number(x);
    return Number.isFinite(n) ? n : 0;
}
