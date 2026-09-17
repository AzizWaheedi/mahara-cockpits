import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";

/** Fade existing content before a local tab/filter update without remounting forms. */
export function useContentTransition() {
  const ref = useRef<HTMLDivElement>(null);
  const animation = useRef<Animation | null>(null);
  const revision = useRef(0);
  const pending = useRef<(() => void)[]>([]);
  useEffect(
    () => () => {
      revision.current++;
      animation.current?.cancel();
      pending.current = [];
    },
    [],
  );
  const change = (update: () => void) => {
    pending.current.push(update);
    const apply = () =>
      flushSync(() => {
        pending.current.splice(0).forEach(fn => {
          fn();
        });
      });
    const ticket = ++revision.current;
    const element = ref.current;
    const opacity = element ? getComputedStyle(element).opacity : "1";
    animation.current?.cancel();
    if (!element || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      apply();
      return;
    }
    animation.current = element.animate([{ opacity }, { opacity: 0 }], {
      duration: 80,
      fill: "forwards",
    });
    animation.current.finished
      .then(() => {
        if (revision.current !== ticket || !element.isConnected) return;
        apply();
        requestAnimationFrame(() => {
          if (revision.current !== ticket || !element.isConnected) return;
          animation.current?.cancel();
          animation.current = element.animate(
            [
              { opacity: 0, transform: "translateY(3px)" },
              { opacity: 1, transform: "translateY(0)" },
            ],
            { duration: 180, easing: "cubic-bezier(.2,.8,.2,1)" },
          );
        });
      })
      .catch(() => {});
  };
  return { ref, change };
}
