/**
 * Microsoft Clarity: where people click, get stuck or click again and again
 * (the simplification audit, approved by Aziz on 2026-10-06). Off until the
 * project's id is set below. Every word on screen is masked before the tag
 * loads, so a recording shows the layout and the clicks, never a client's
 * name, a number or anything typed. The same file sits in each of the five
 * apps (scripts/check-shared.sh).
 */
export const CLARITY_PROJECT_ID: string | null = null;

type Clarity = ((...args: unknown[]) => void) & { q?: unknown[][] };

export function startClarity(cockpit: string): void {
  if (!CLARITY_PROJECT_ID || typeof window === "undefined") return;
  // A local preview or a harness is not the team at work.
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname))
    return;
  document.documentElement.setAttribute("data-clarity-mask", "true");
  const w = window as unknown as { clarity?: Clarity };
  if (!w.clarity) {
    const queue: Clarity = (...args: unknown[]) => {
      queue.q = queue.q ?? [];
      queue.q.push(args);
    };
    w.clarity = queue;
  }
  const tag = document.createElement("script");
  tag.async = true;
  tag.src = `https://www.clarity.ms/tag/${CLARITY_PROJECT_ID}`;
  document.head.appendChild(tag);
  // Which cockpit a recording came from, to filter by in Clarity.
  w.clarity("set", "cockpit", cockpit);
}
