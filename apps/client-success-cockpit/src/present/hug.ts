import { type RefObject, useLayoutEffect } from "react";

/**
 * Shrinks a block of the client's words to its longest line, so a box set
 * against its label's edge reads as one paragraph: an English answer in the
 * Arabic deck (or the other way round) keeps its lines aligned to their own
 * start, and the box's other edge lines up with the label instead of
 * leaving a ragged gap. CSS cannot shrink-wrap wrapped or balanced text, so
 * the lines are measured once laid out (and again once the fonts are in).
 * Canvas pixels: the canvas is scaled to the window, so rects are divided
 * by its scale.
 */
export function useHug(ref: RefObject<HTMLElement | null>, key: unknown) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: key is the text being hugged
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let live = true;
    const fit = () => {
      if (!live) return;
      el.style.width = "";
      // The text's own line boxes only (a range over the element would
      // also return each fully selected child's whole box).
      const rects: DOMRect[] = [];
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) if (r.width > 0) rects.push(r);
      }
      if (!rects.length) return;
      const canvas = el.closest(".dk-canvas");
      const k = canvas ? canvas.getBoundingClientRect().width / 1920 || 1 : 1;
      const left = Math.min(...rects.map(r => r.left));
      const right = Math.max(...rects.map(r => r.right));
      el.style.width = `${Math.ceil((right - left) / k) + 2}px`;
    };
    fit();
    document.fonts?.ready.then(fit);
    return () => {
      live = false;
    };
  }, [ref, key]);
}
