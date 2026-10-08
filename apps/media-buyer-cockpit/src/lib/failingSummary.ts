/**
 * One line for a cockpit's failing checks: each distinct message once, the
 * most frequent first, with how many checks reported it. The native monitor
 * reports one row per provider receipt, so the same sentence could fill the
 * Admin card dozens of times (8 Oct 2026).
 */
export function summarizeFailing(failing: string[]): string {
  const counts = new Map<string, number>();
  for (const message of failing)
    counts.set(message, (counts.get(message) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([message, n]) => (n > 1 ? `${message} (${n} checks)` : message))
    .join(", ");
}
