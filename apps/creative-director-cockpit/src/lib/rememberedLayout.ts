export type LayoutItem =
  | [0, number, number, number, number, number, string, string, string]
  | [1, number, number, number, number, number]
  | [2, number, number, number, number]
  | [3, number, number, number, number, string];

export type RememberedLayout = {
  v: 1;
  at: number;
  vw: number;
  dark: boolean;
  mainX: number;
  mainW: number;
  h: number;
  items: LayoutItem[];
};

export const LAYOUT_PREFIX = "mahara-layout:";
export const LAYOUT_INDEX = "mahara-layout-index";
export const LAYOUT_MAX_PAGES = 24;
export const LAYOUT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const LAYOUT_MAX_ITEMS = 900;
export const LAYOUT_QUIET_MS = 1500;

type IndexEntry = { k: string; t: number };
type Offset = { x: number; y: number };

function fallbackStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function readIndex(storage: Storage): IndexEntry[] {
  try {
    const raw = storage.getItem(LAYOUT_INDEX);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is IndexEntry =>
        !!entry && typeof entry.k === "string" && typeof entry.t === "number",
    );
  } catch {
    return [];
  }
}

export function sessionUserId(
  storage: Storage | undefined = fallbackStorage(),
): string | null {
  try {
    if (!storage) return null;
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (!key || !/^sb-[a-z0-9]+-auth-token$/.test(key)) continue;
      try {
        const raw = storage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        const id = parsed?.user?.id;
        if (typeof id === "string") return id;
      } catch {
        // A bad value on one key does not stop the search.
      }
    }
  } catch {
    // Storage may be unavailable or blocked.
  }
  return null;
}

export function layoutKey(userId: string, path: string): string {
  return `${LAYOUT_PREFIX}${userId}:${path}`;
}

export function readLayout(
  path: string,
  now: number = Date.now(),
  storage: Storage | undefined = fallbackStorage(),
): RememberedLayout | null {
  try {
    if (!storage) return null;
    const userId = sessionUserId(storage);
    if (!userId) return null;
    const raw = storage.getItem(layoutKey(userId, path));
    if (!raw) return null;
    const record = JSON.parse(raw) as RememberedLayout;
    if (record?.v !== 1) return null;
    if (!Array.isArray(record.items)) return null;
    if (typeof record.at !== "number") return null;
    if (now - record.at > LAYOUT_MAX_AGE_MS) return null;
    return record;
  } catch {
    return null;
  }
}

export function writeLayout(
  path: string,
  layout: RememberedLayout,
  storage: Storage | undefined = fallbackStorage(),
): void {
  try {
    if (!storage) return;
    const userId = sessionUserId(storage);
    if (!userId) return;
    const key = layoutKey(userId, path);
    const index = readIndex(storage).filter(entry => entry.k !== key);
    index.push({ k: key, t: layout.at });
    while (index.length > LAYOUT_MAX_PAGES) {
      const oldest = index.shift();
      if (oldest) {
        try {
          storage.removeItem(oldest.k);
        } catch {
          // A record that cannot be removed is left in place.
        }
      }
    }
    try {
      storage.setItem(key, JSON.stringify(layout));
      storage.setItem(LAYOUT_INDEX, JSON.stringify(index));
      return;
    } catch {
      // Quota or a blocked write: drop the oldest half, then try once.
      const drop = Math.max(1, Math.ceil(index.length / 2));
      for (const entry of index.slice(0, drop)) {
        try {
          storage.removeItem(entry.k);
        } catch {
          // Ignore a record that cannot be removed.
        }
      }
      try {
        storage.setItem(key, JSON.stringify(layout));
        storage.setItem(LAYOUT_INDEX, JSON.stringify(index.slice(drop)));
      } catch {
        // Give up silently.
      }
    }
  } catch {
    // Never throws to the caller.
  }
}

const SKIP_SELECTOR =
  "script, style, template, noscript, .sr-only, [data-no-replay], " +
  "[data-page-skeleton]";

function colorAlpha(color: string | undefined): number {
  if (!color) return 0;
  const value = color.trim().toLowerCase();
  if (value === "transparent") return 0;
  const rgb = value.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length >= 4) {
      const alpha = Number.parseFloat(parts[3]);
      return Number.isFinite(alpha) ? alpha : 1;
    }
    return 1;
  }
  const slash = value.match(/^[a-z-]+\(.*\/([^/()]+)\)$/);
  if (slash) {
    const raw = slash[1].trim();
    const alpha = Number.parseFloat(raw);
    if (!Number.isFinite(alpha)) return 1;
    return raw.endsWith("%") ? alpha / 100 : alpha;
  }
  return 1;
}

function radiusOf(style: CSSStyleDeclaration, w: number, h: number): number {
  const raw = Number.parseFloat(style.borderTopLeftRadius);
  const radius = Number.isFinite(raw) ? raw : 0;
  return Math.round(Math.min(radius, Math.min(w, h) / 2));
}

type Clip = { left: number; top: number; right: number; bottom: number };

const UNBOUNDED_CLIP: Clip = {
  left: Number.NEGATIVE_INFINITY,
  top: Number.NEGATIVE_INFINITY,
  right: Number.POSITIVE_INFINITY,
  bottom: Number.POSITIVE_INFINITY,
};

function intersectClip(a: Clip, b: Clip): Clip {
  return {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
}

function clipBox(
  x: number,
  y: number,
  w: number,
  h: number,
  clip: Clip,
): [number, number, number, number] | null {
  const left = Math.round(Math.max(x, clip.left));
  const top = Math.round(Math.max(y, clip.top));
  const right = Math.round(Math.min(x + w, clip.right));
  const bottom = Math.round(Math.min(y + h, clip.bottom));
  const width = right - left;
  const height = bottom - top;
  if (width < 2 || height < 2) return null;
  return [left, top, width, height];
}

export function snapshotLayout(
  main: HTMLElement,
  win: Window = window,
): RememberedLayout | null {
  const doc = main.ownerDocument;
  const mr = main.getBoundingClientRect();
  const limitY = Math.max(win.innerHeight * 2.5, 1600);
  const items: LayoutItem[] = [];

  const full = () => items.length >= LAYOUT_MAX_ITEMS;
  const push = (item: LayoutItem) => {
    if (!full()) items.push(item);
  };

  const visitText = (node: Text, parent: Element | null, clip: Clip) => {
    if (full()) return;
    if (!node.textContent?.trim()) return;
    const range = doc.createRange();
    range.selectNodeContents(node);
    if (typeof range.getClientRects !== "function") return;
    let textClip = clip;
    if (parent) {
      const pr = parent.getBoundingClientRect();
      textClip = {
        left: Math.max(clip.left, pr.left - mr.left),
        top: clip.top,
        right: Math.min(clip.right, pr.right - mr.left),
        bottom: clip.bottom,
      };
    }
    const rects = range.getClientRects();
    for (const rect of Array.from(rects)) {
      if (full()) return;
      const x = Math.round(rect.left - mr.left);
      const y = Math.round(rect.top - mr.top);
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      if (w < 2 || h < 2) continue;
      const box = clipBox(x, y, w, h, textClip);
      if (!box) continue;
      const [cx, cy, cw, ch] = box;
      const prev = items[items.length - 1];
      if (
        prev &&
        prev[0] === 2 &&
        Math.abs(prev[2] - cy) <= 2 &&
        Math.abs(prev[4] - ch) <= 2 &&
        prev[1] <= cx &&
        cx - (prev[1] + prev[3]) <= 6
      ) {
        prev[3] = Math.max(prev[1] + prev[3], cx + cw) - prev[1];
        prev[4] = Math.max(prev[4], ch);
        continue;
      }
      push([2, cx, cy, cw, ch]);
    }
  };

  const visitChildren = (parent: Element, clip: Clip) => {
    for (const child of Array.from(parent.childNodes)) {
      if (full()) return;
      if (child.nodeType === 1) visitElement(child as Element, clip);
      else if (child.nodeType === 3) visitText(child as Text, parent, clip);
    }
  };

  const visitElement = (el: Element, clip: Clip) => {
    if (full()) return;
    if (el.matches(SKIP_SELECTOR)) return;
    const style = win.getComputedStyle(el);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0" ||
      style.position === "fixed" ||
      style.position === "sticky"
    )
      return;
    const r = el.getBoundingClientRect();
    const x = Math.round(r.left - mr.left);
    const y = Math.round(r.top - mr.top);
    const w = Math.round(r.width);
    const h = Math.round(r.height);
    if (y > limitY) return;
    const childClip =
      style.overflowX !== "visible" || style.overflowY !== "visible"
        ? intersectClip(clip, {
            left: r.left - mr.left,
            top: r.top - mr.top,
            right: r.right - mr.left,
            bottom: r.bottom - mr.top,
          })
        : clip;
    if (w >= 2 && h >= 2) {
      const radius = radiusOf(style, w, h);
      const background = style.backgroundColor;
      const widths = [
        Number.parseFloat(style.borderTopWidth) || 0,
        Number.parseFloat(style.borderRightWidth) || 0,
        Number.parseFloat(style.borderBottomWidth) || 0,
        Number.parseFloat(style.borderLeftWidth) || 0,
      ];
      const colors = [
        style.borderTopColor,
        style.borderRightColor,
        style.borderBottomColor,
        style.borderLeftColor,
      ];
      let borderColor = "transparent";
      let borderVisible = false;
      let seen = false;
      for (let i = 0; i < 4; i += 1) {
        if (widths[i] > 0) {
          if (!seen) {
            borderColor = colors[i] || "transparent";
            seen = true;
          }
          if (colorAlpha(colors[i]) > 0.02) borderVisible = true;
        }
      }
      const backgroundVisible = colorAlpha(background) > 0.02;
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute("role");
      const media =
        tag === "img" ||
        tag === "video" ||
        tag === "canvas" ||
        tag === "svg" ||
        role === "img";
      const control =
        tag === "button" ||
        tag === "input" ||
        tag === "select" ||
        tag === "textarea" ||
        role === "button" ||
        role === "tab" ||
        role === "switch" ||
        role === "checkbox" ||
        (tag === "a" &&
          style.display !== "inline" &&
          (backgroundVisible || borderVisible));

      if (el.hasAttribute("data-section")) {
        push([3, x, y, w, h, el.getAttribute("data-section") || ""]);
      }
      if (media) {
        const box = clipBox(x, y, w, h, clip);
        if (box) push([1, box[0], box[1], box[2], box[3], radius]);
        return;
      }
      if (control && w <= 480 && h <= 56) {
        const box = clipBox(x, y, w, h, clip);
        if (box) push([1, box[0], box[1], box[2], box[3], radius]);
        return;
      }
      if ((backgroundVisible || borderVisible) && w >= 24 && h >= 16) {
        const widthText = widths.map(value => Math.round(value)).join(" ");
        const box = clipBox(x, y, w, h, clip);
        if (box)
          push([
            0,
            box[0],
            box[1],
            box[2],
            box[3],
            radius,
            background,
            borderColor,
            widthText,
          ]);
      }
    }
    visitChildren(el, childClip);
  };

  visitChildren(main, UNBOUNDED_CLIP);
  if (items.length === 0) return null;
  let height = 0;
  for (const item of items) {
    height = Math.max(height, item[2] + item[4]);
  }
  return {
    v: 1,
    at: Date.now(),
    vw: win.innerWidth,
    dark: doc.documentElement.classList.contains("dark"),
    mainX: Math.round(mr.left),
    mainW: Math.round(mr.width),
    h: Math.round(height),
    items,
  };
}

export type PlaceEnv = {
  main: { left: number; top: number; width: number } | null;
  root: { left: number; top: number; width: number };
  vw: number;
  dark: boolean;
};

export function placeLayout(
  layout: RememberedLayout,
  env: PlaceEnv,
): Offset | null {
  if (env.dark !== layout.dark || env.vw !== layout.vw) return null;
  if (env.main) {
    if (
      Math.abs(env.main.left - layout.mainX) > 2 ||
      Math.abs(env.main.width - layout.mainW) > 2
    )
      return null;
    return {
      x: Math.round(env.root.left - env.main.left),
      y: Math.round(env.root.top - env.main.top),
    };
  }
  if (
    Math.abs(env.root.left - layout.mainX) > 2 ||
    Math.abs(env.root.width - layout.mainW) > 2
  )
    return null;
  return { x: 0, y: 0 };
}

export function visibleItems(
  layout: RememberedLayout,
  off: Offset,
): LayoutItem[] {
  return layout.items.filter(item => item[2] >= off.y - 1);
}

export function contentHeight(layout: RememberedLayout, off: Offset): number {
  let height = 0;
  for (const item of visibleItems(layout, off)) {
    height = Math.max(height, item[2] + item[4] - off.y);
  }
  return height;
}
