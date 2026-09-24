import { useState } from "react";
import type { Me } from "../lib/types";

/**
 * Mine or the team's. A rep only ever sees their own calls; a manager
 * chooses, and the choice is remembered on this device.
 */
const KEY = "sales_scope";

export function useScope(me: Me) {
  const [scope, setScope] = useState<"mine" | "team">(() => {
    if (!me.manager) return "mine";
    try {
      const s = localStorage.getItem(KEY);
      if (s === "mine" || s === "team") return s;
    } catch {
      // storage off: fall through to the default
    }
    return "team";
  });
  const effective = me.manager ? scope : "mine";
  const pick = (s: "mine" | "team") => {
    setScope(s);
    try {
      localStorage.setItem(KEY, s);
    } catch {
      // it still works, it just forgets
    }
  };
  const ScopeSwitch = me.manager ? (
    <div
      className="raised inline-flex rounded-[var(--radius-md)] p-0.5 text-sm"
      role="group"
      aria-label="Whose calls"
    >
      {(["mine", "team"] as const).map(s => (
        <button
          key={s}
          type="button"
          aria-pressed={effective === s}
          onClick={() => pick(s)}
          className={`rounded-[calc(var(--radius-md)-2px)] px-3 py-1 ${
            effective === s
              ? "bg-[color:var(--card)] font-medium shadow-sm"
              : "muted"
          }`}
        >
          {s === "mine" ? "Mine" : "Team"}
        </button>
      ))}
    </div>
  ) : null;
  return { scope: effective, ScopeSwitch };
}
