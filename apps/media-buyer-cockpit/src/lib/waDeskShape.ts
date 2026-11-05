/**
 * The shape last seen for a desk's WhatsApp: one quiet line when the desk has
 * no WhatsApp of its own, the list when conversations wait on a reply. Kept
 * per desk so the next load draws the same shape instead of jumping.
 */

const key = (desk: string) => `mahara-wa-desk-shape:${desk}`;

export function readWaDeskShape(desk: string): "line" | "list" {
  try {
    const stored = localStorage.getItem(key(desk));
    return stored === "list" ? "list" : "line";
  } catch {
    return "line";
  }
}

export function writeWaDeskShape(desk: string, shape: "line" | "list"): void {
  try {
    localStorage.setItem(key(desk), shape);
  } catch {
    // Storage is off. The desk shows the line next time.
  }
}
