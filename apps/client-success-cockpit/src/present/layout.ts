/** One picture's place in a layout: which picture, and its size. */
export interface Placed {
  i: number;
  w: number;
  h: number;
}

/**
 * Fits pictures of the given shapes (width over height) into a w × h box in
 * rows, the way a photo book is laid out: every way to cut the list into
 * rows is tried, each row fills the width, the rows shrink together until
 * they fit the height, and the cut whose smallest picture is largest wins,
 * so no screenshot ends up too small to read. The order never changes,
 * and given their widths, no picture is drawn larger than it is.
 */
export function justify(
  ratios: number[],
  w: number,
  h: number,
  gap: number,
  /** Each picture's own width: a row never draws one larger, so it stays sharp. */
  widths?: number[],
): Placed[][] {
  const n = ratios.length;
  if (n === 0 || w <= 0 || h <= 0) return [];
  let best: Placed[][] = [];
  let bestScore = -1;
  for (let cut = 0; cut < 1 << (n - 1); cut++) {
    const rows: number[][] = [[0]];
    for (let i = 1; i < n; i++) {
      if (cut & (1 << (i - 1))) rows.push([i]);
      else rows[rows.length - 1].push(i);
    }
    const full = rows.map(
      r => (w - gap * (r.length - 1)) / r.reduce((s, i) => s + ratios[i], 0),
    );
    const room = h - gap * (rows.length - 1);
    if (room <= 0) continue;
    const k = Math.min(1, room / full.reduce((a, b) => a + b, 0));
    const placed = rows.map((r, j) => {
      const sharp = widths
        ? Math.min(...r.map(i => widths[i] / (ratios[i] * full[j])))
        : 1;
      const kj = Math.min(k, sharp);
      return r.map(i => ({ i, w: ratios[i] * full[j] * kj, h: full[j] * kj }));
    });
    const score = Math.min(...placed.flat().map(p => p.w * p.h));
    if (score > bestScore) {
      bestScore = score;
      best = placed;
    }
  }
  return best;
}
