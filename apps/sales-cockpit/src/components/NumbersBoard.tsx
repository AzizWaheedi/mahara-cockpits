import { UsersRound } from "lucide-react";
import { pct } from "../lib/format";
import type { BoardRow } from "../lib/types";
import { EmptyState, Failed, SectionCard } from "./kit";

/**
 * Everyone's rates for the window, and nothing else: counts, cash and pay
 * stay with each person and the managers (cockpit_sales_board is a view with
 * the counts left out). A table from sm up; stacked rows on a phone.
 */

const COLUMNS: { key: keyof BoardRow; label: string }[] = [
  { key: "show_rate", label: "Show rate" },
  { key: "qualified_rate", label: "Qualified rate" },
  { key: "close_rate", label: "Close rate" },
  { key: "qualified_close_rate", label: "Qualified close rate" },
];

function sorted(rows: BoardRow[]): BoardRow[] {
  const unknown = (r: BoardRow) =>
    r.person_key === "unattributed" || r.person_key.startsWith("ghl:");
  return [...rows].sort(
    (a, b) =>
      Number(b.has_calls) - Number(a.has_calls) ||
      Number(unknown(a)) - Number(unknown(b)) ||
      String(a.display_name ?? "").localeCompare(String(b.display_name ?? "")),
  );
}

export function NumbersBoard({
  rows,
  error,
  reload,
  loading,
  mine,
}: {
  rows: BoardRow[] | null;
  error: string | null;
  reload: () => void;
  loading: boolean;
  /** The viewer's B2B rep, whose row is highlighted. */
  mine: string | null;
}) {
  const list = sorted(rows ?? []);
  const highlight = {
    background: "color-mix(in oklch, var(--primary) 9%, transparent)",
  };
  const you = (
    <span
      className="rounded-full px-1.5 py-0.5 text-xs font-medium"
      style={{
        background: "color-mix(in oklch, var(--primary) 22%, transparent)",
        color: "var(--foreground)",
      }}
    >
      You
    </span>
  );

  return (
    <SectionCard
      title="Team board"
      side={
        <span className="muted text-xs">Rates only, everyone sees this</span>
      }
      flush
    >
      {error ? (
        <div className="p-4">
          <Failed what="The team board" error={error} retry={reload} />
        </div>
      ) : !list.length ? (
        <EmptyState
          compact
          icon={UsersRound}
          title={
            loading
              ? "Loading the board…"
              : "Nobody has calls in this window yet"
          }
          text={
            loading
              ? undefined
              : "The board fills from B2B's scorecard, read every 15 minutes."
          }
        />
      ) : (
        <>
          {/* Phones: one block per person. */}
          <ul className="divide-y hairline sm:hidden">
            {list.map(r => {
              const own = mine !== null && r.person_key === mine;
              return (
                <li
                  key={r.person_key}
                  className="px-4 py-3"
                  style={own ? highlight : undefined}
                >
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <span className="min-w-0 truncate" dir="auto">
                      {r.display_name ?? "Someone"}
                    </span>
                    {own ? you : null}
                  </p>
                  {r.has_calls ? (
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
                      {COLUMNS.map(c => (
                        <div key={c.key} className="min-w-0">
                          <dt className="muted text-xs">{c.label}</dt>
                          <dd className="tabular-nums text-sm">
                            {pct(r[c.key], 1)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="muted mt-1 text-xs">No calls</p>
                  )}
                </li>
              );
            })}
          </ul>

          {/* From sm up: a table. */}
          <table className="hidden w-full text-sm sm:table">
            <thead>
              <tr className="muted border-b hairline text-left text-xs">
                <th scope="col" className="px-4 py-2 font-medium">
                  Rep
                </th>
                {COLUMNS.map(c => (
                  <th
                    key={c.key}
                    scope="col"
                    className="px-4 py-2 text-right font-medium"
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y hairline">
              {list.map(r => {
                const own = mine !== null && r.person_key === mine;
                return (
                  <tr key={r.person_key} style={own ? highlight : undefined}>
                    <th
                      scope="row"
                      className="px-4 py-2.5 text-left font-medium"
                    >
                      <span className="flex items-center gap-2">
                        <span className="min-w-0 truncate" dir="auto">
                          {r.display_name ?? "Someone"}
                        </span>
                        {own ? you : null}
                      </span>
                    </th>
                    {r.has_calls ? (
                      COLUMNS.map(c => (
                        <td
                          key={c.key}
                          className="tabular-nums px-4 py-2.5 text-right"
                        >
                          {pct(r[c.key], 1)}
                        </td>
                      ))
                    ) : (
                      <td
                        colSpan={COLUMNS.length}
                        className="muted px-4 py-2.5 text-right text-xs"
                      >
                        No calls
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </SectionCard>
  );
}
