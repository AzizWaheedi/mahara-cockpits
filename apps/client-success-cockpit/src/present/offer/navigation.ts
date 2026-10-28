import type { Pos } from "../engine";

/** A clicker moves chapters. Arrow keys can still explore a chapter's details. */
export function offerSlideDirection(key: string, shift = false): 1 | -1 | null {
  if (key === " " || key === "Spacebar") return shift ? -1 : 1;
  if (key === "PageDown") return 1;
  if (key === "PageUp") return -1;
  return null;
}

export function offerSlideFrom(
  pos: Pos,
  direction: 1 | -1,
  count: number,
): Pos | null {
  const index = pos.index + direction;
  return index >= 0 && index < count ? { index, tour: 0 } : null;
}

export const OFFER_KEYS_HINT = {
  en: "Space: next slide · Shift + Space: back · Arrow keys: details · F: full screen",
  ar: "Space: الشريحة التالية · Shift + Space: السابقة · الأسهم: التفاصيل · F: ملء الشاشة",
};
