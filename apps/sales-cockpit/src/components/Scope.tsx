import { useMemo, useState } from "react";
import { useReps } from "../lib/data";
import type { Me } from "../lib/types";
import { select } from "./kit";

/**
 * Whose calls a page shows. Everyone opens on their own (Aziz, 2026-09-24:
 * "for today, it should only show the calls that are assigned to whoever
 * that person is specifically"). A manager can switch to the whole team or
 * to one rep, to see their day as they see it; the choice is remembered on
 * this device.
 */
const KEY = "sales_scope_v2";

export interface ScopeView {
  kind: "mine" | "team" | "person";
  /** The HighLevel user whose calls to show; null means everyone's. */
  ghl: string | null;
  /** The B2B rep behind the scorecard rows; null means the team. */
  repId: string | null;
  /** "you", "the team" or the rep's name, for sentences. */
  label: string;
}

export function useScope(
  me: Me,
  opts: { people?: boolean; label?: string } = {},
) {
  const reps = useReps();
  const [choice, setChoice] = useState<string>(() => {
    if (!me.manager) return "mine";
    try {
      return localStorage.getItem(KEY) || "mine";
    } catch {
      return "mine";
    }
  });

  // Reps a manager can look through: active, with a HighLevel user to own
  // calls, and not the manager themself.
  const others = useMemo(
    () =>
      (reps.data ?? [])
        .filter(
          r => r.is_active && r.ghl_user_id && r.ghl_user_id !== me.ghl_user_id,
        )
        .sort((a, b) =>
          String(a.display_name).localeCompare(String(b.display_name)),
        ),
    [reps.data, me.ghl_user_id],
  );

  let view: ScopeView = {
    kind: "mine",
    ghl: me.ghl_user_id ?? "__none__",
    repId: me.b2b_rep_id ?? null,
    label: "you",
  };
  if (me.manager && choice === "team")
    view = { kind: "team", ghl: null, repId: null, label: "the team" };
  else if (me.manager && opts.people && choice.startsWith("rep:")) {
    const r = others.find(x => x.id === choice.slice(4));
    if (r)
      view = {
        kind: "person",
        ghl: r.ghl_user_id,
        repId: r.id,
        label: r.display_name ?? "this rep",
      };
  }

  const pick = (v: string) => {
    setChoice(v);
    try {
      localStorage.setItem(KEY, v);
    } catch {
      // it still works, it just forgets
    }
  };

  const current = view.kind === "person" ? `rep:${view.repId}` : view.kind;
  const ScopeSwitch = me.manager ? (
    <label className="inline-flex items-center gap-2 text-sm">
      <span className="muted">{opts.label ?? "Whose calls"}</span>
      <select
        value={current}
        onChange={e => pick(e.target.value)}
        className={select}
      >
        <option value="mine">Mine</option>
        <option value="team">The whole team</option>
        {opts.people && others.length ? (
          <optgroup label="One rep">
            {others.map(r => (
              <option key={r.id} value={`rep:${r.id}`}>
                {r.display_name}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
    </label>
  ) : null;

  return { scope: view.kind, view, ScopeSwitch };
}
