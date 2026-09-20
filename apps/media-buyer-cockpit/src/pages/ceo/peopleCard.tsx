import { useAction } from "convex/react";
import { UserPlus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "@/components/ceo/EmptyState";
import { money, plural } from "@/components/ceo/format";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatTile } from "@/components/ceo/StatTile";
import { StatusChip } from "@/components/ceo/StatusChip";
import { api } from "../../../convex/_generated/api";
import { commissionText } from "../../../convex/ceo/commission";
import type { Person, Roster } from "../../../convex/ceo/people";

/**
 * Who Mahara pays.
 *
 * The one number that decides whether the business looks healthy or underwater
 * is payroll, and it is recorded nowhere. This is the screen that fixes that:
 * a roster kept by hand, staff and freelancers together, because to a margin
 * they are the same money.
 */

type Engagement = Person["engagement"];

const ENGAGEMENTS: { value: Engagement; label: string }[] = [
  { value: "staff", label: "Staff" },
  { value: "freelancer", label: "Freelancer" },
  { value: "agency", label: "Agency" },
  { value: "intern", label: "Intern" },
];

const blank = {
  name: "",
  role: "",
  email: "",
  engagement: "staff" as Engagement,
  monthlyCost: "",
  currency: "USD",
  commissionPct: "",
  commissionNote: "",
  isSales: false,
  startedOn: "",
};

export function PeopleCard({ order }: { order?: number }) {
  const load = useAction(api.ceo.people.list);
  const save = useAction(api.ceo.people.save);
  const setActive = useAction(api.ceo.people.setActive);
  const remove = useAction(api.ceo.people.remove);
  const importWorkspace = useAction(api.ceo.people.importWorkspace);

  const [data, setData] = useState<Roster | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ ...blank });
  const [editing, setEditing] = useState<number | null>(null);
  const [showGone, setShowGone] = useState(false);
  const [imported, setImported] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setData(await load({}));
      setError(null);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e).slice(0, 240));
    }
  }, [load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function submit() {
    setBusy(true);
    try {
      await save({
        ...(editing === null ? {} : { id: editing }),
        name: form.name,
        role: form.role || undefined,
        email: form.email || undefined,
        engagement: form.engagement,
        monthlyCost:
          form.monthlyCost === "" ? undefined : Number(form.monthlyCost),
        currency: form.currency,
        commissionPct:
          form.commissionPct === ""
            ? undefined
            : Number(form.commissionPct) / 100,
        commissionNote: form.commissionNote || undefined,
        isSales: form.isSales,
        startedOn: form.startedOn || undefined,
      });
      setForm({ ...blank });
      setEditing(null);
      await refresh();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e).slice(0, 240));
    }
    setBusy(false);
  }

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e).slice(0, 240));
    }
    setBusy(false);
  }

  function edit(p: Person) {
    setEditing(p.id);
    setForm({
      name: p.name,
      role: p.role ?? "",
      email: p.email ?? "",
      engagement: p.engagement,
      monthlyCost: p.monthlyCost === null ? "" : String(p.monthlyCost),
      currency: p.currency,
      commissionPct:
        p.commissionPct === null ? "" : String(p.commissionPct * 100),
      commissionNote: p.commissionNote ?? "",
      isSales: p.isSales,
      startedOn: p.startedOn ?? "",
    });
  }

  if (!data) return null;
  const live = data.people.filter(p => p.active);
  const gone = data.people.filter(p => !p.active);

  const field = "rounded-md border bg-background px-2 py-1.5 text-sm";

  return (
    <SectionCard
      id="people"
      kicker="Staff and freelancers, kept by hand"
      title="Who we pay"
      order={order}
    >
      {() => (
        <div className="grid gap-5">
          <p className="text-sm text-muted-foreground">
            Nothing in the stack knows who works here: ClickUp time tracking has
            never recorded an entry, and the bank's salaries line is a label
            whose rows are mostly card top-ups naming nobody. So this roster is
            the source, and it is what makes gross margin and a real cost per
            client possible. Somebody who leaves is marked gone, never deleted,
            because the months they were paid for still happened.
          </p>

          {data.ready ? null : (
            <p className="rounded-md border border-[var(--ceo-warning)] p-3 text-sm">
              The people table does not exist yet. Run{" "}
              <code>supabase/migrations/20260919b_people.sql</code> in the
              Creative Triage SQL editor.
            </p>
          )}

          <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
            <StatTile
              variant="plain"
              label="On the books each month"
              value={money(data.activeMonthlyUsd)}
              sub={plural(data.activeCount, "person", "people")}
              status={
                data.missingCost.length ? (
                  <StatusChip tone="warning" label="A floor" />
                ) : undefined
              }
              hint="Fully loaded monthly cost of everyone still active, converted at the cockpit's fixed rates."
            />
            <StatTile
              variant="plain"
              label="Of that, the people who sell"
              value={money(data.salesMonthlyUsd)}
              hint="Counted separately because CAC today is ad spend only. This is what it would add if that rule ever changes."
            />
            <StatTile
              variant="plain"
              label="Nobody has costed yet"
              value={String(data.missingCost.length)}
              sub={
                data.missingCost.length
                  ? data.missingCost.slice(0, 3).join(", ")
                  : "everyone has a figure"
              }
              hint="Until these carry a cost, the monthly total above is a floor rather than the payroll."
            />
          </div>

          {live.length ? (
            <div className="overflow-x-auto rounded-md border">
              <table
                className="w-full text-sm"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="p-2 font-medium">Person</th>
                    <th className="p-2 font-medium">Engagement</th>
                    <th className="p-2 text-right font-medium">Monthly</th>
                    <th className="p-2 font-medium">Commission</th>
                    <th className="p-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {live.map(p => (
                    <tr key={p.id} className="border-t align-top">
                      <td className="p-2">
                        {p.name}
                        <span className="block text-xs text-muted-foreground">
                          {[p.role, p.isSales ? "sells" : null]
                            .filter(Boolean)
                            .join(" · ") || "no role set"}
                        </span>
                      </td>
                      <td className="p-2 capitalize">{p.engagement}</td>
                      <td className="p-2 text-right">
                        {p.monthlyUsd === null ? (
                          <span className="text-muted-foreground">not set</span>
                        ) : (
                          <>
                            {money(p.monthlyUsd)}
                            {p.currency === "USD" ? null : (
                              <span className="block text-xs text-muted-foreground">
                                {`${p.monthlyCost} ${p.currency}`}
                              </span>
                            )}
                          </>
                        )}
                      </td>
                      <td className="p-2">
                        {commissionText(
                          p.commission,
                          p.currency,
                          p.commissionNote,
                        ) === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <>
                            {commissionText(
                              p.commission,
                              p.currency,
                              p.commissionNote,
                            )}
                            {p.commission.basis !== "other" &&
                            p.commissionNote ? (
                              <span className="block text-xs text-muted-foreground">
                                {p.commissionNote}
                              </span>
                            ) : null}
                          </>
                        )}
                      </td>
                      <td className="p-2 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => edit(p)}
                          className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            act(() =>
                              setActive({
                                id: p.id,
                                active: false,
                                endedOn: new Date().toISOString().slice(0, 10),
                              }),
                            )
                          }
                          className="ml-1 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                        >
                          Gone
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="Nobody on the roster yet"
              text="Add the first person below. About eight rows covers the whole company."
              icon={UserPlus}
              compact
            />
          )}

          <div className="rounded-md border p-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {editing === null ? "Add somebody" : "Edit"}
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <input
                id="person-name"
                className={field}
                placeholder="Name"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
              <input
                id="person-role"
                className={field}
                placeholder="Role"
                value={form.role}
                onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
              />
              <select
                id="person-engagement"
                className={field}
                value={form.engagement}
                onChange={e =>
                  setForm(f => ({
                    ...f,
                    engagement: e.target.value as Engagement,
                  }))
                }
              >
                {ENGAGEMENTS.map(x => (
                  <option key={x.value} value={x.value}>
                    {x.label}
                  </option>
                ))}
              </select>
              <input
                id="person-email"
                className={field}
                placeholder="Work email (optional)"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              />
              <input
                id="person-cost"
                className={field}
                inputMode="decimal"
                placeholder="Monthly cost"
                value={form.monthlyCost}
                onChange={e =>
                  setForm(f => ({ ...f, monthlyCost: e.target.value }))
                }
              />
              <select
                id="person-currency"
                className={field}
                value={form.currency}
                onChange={e =>
                  setForm(f => ({ ...f, currency: e.target.value }))
                }
              >
                {["USD", "KWD", "AED", "SAR", "QAR"].map(c => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <input
                id="person-commission"
                className={field}
                inputMode="decimal"
                placeholder="Commission %"
                value={form.commissionPct}
                onChange={e =>
                  setForm(f => ({ ...f, commissionPct: e.target.value }))
                }
              />
              <input
                id="person-started"
                className={field}
                placeholder="Started 2026-01-15"
                value={form.startedOn}
                onChange={e =>
                  setForm(f => ({ ...f, startedOn: e.target.value }))
                }
              />
              <input
                id="person-commission-note"
                className={`${field} sm:col-span-2 lg:col-span-3`}
                placeholder="Anything the percentage cannot say, e.g. KD 50 per booked demo"
                value={form.commissionNote}
                onChange={e =>
                  setForm(f => ({ ...f, commissionNote: e.target.value }))
                }
              />
              <label
                htmlFor="person-sales"
                className="flex items-center gap-2 text-sm"
              >
                <input
                  id="person-sales"
                  type="checkbox"
                  checked={form.isSales}
                  onChange={e =>
                    setForm(f => ({ ...f, isSales: e.target.checked }))
                  }
                />
                Their job is selling
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy || !form.name.trim() || !data.ready}
                onClick={submit}
                className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
              >
                {editing === null ? "Add" : "Save"}
              </button>
              {editing === null ? null : (
                <button
                  type="button"
                  onClick={() => {
                    setEditing(null);
                    setForm({ ...blank });
                  }}
                  className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
                >
                  Cancel
                </button>
              )}
              <button
                type="button"
                disabled={busy || !data.ready}
                onClick={() =>
                  act(async () => {
                    const r = await importWorkspace({});
                    setImported(
                      r.problem
                        ? r.problem
                        : r.added.length
                          ? `Added ${plural(r.added.length, "person", "people")} from Workspace. Give them a monthly cost and they leave the uncosted list.`
                          : "Everyone in Workspace is already on the roster.",
                    );
                  })
                }
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
                title="Adds Workspace accounts that are not here yet. It never edits or removes anybody, and never sets a cost."
              >
                Add from Workspace
              </button>
            </div>
            {imported ? (
              <p className="mt-2 text-sm text-muted-foreground">{imported}</p>
            ) : null}
          </div>

          {gone.length ? (
            <div className="border-t pt-4">
              <button
                type="button"
                onClick={() => setShowGone(v => !v)}
                className="text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                {showGone
                  ? "Hide people who have left"
                  : `${plural(gone.length, "person", "people")} who left`}
              </button>
              {showGone ? (
                <ul className="mt-3 grid gap-1 sm:grid-cols-2">
                  {gone.map(p => (
                    <li key={p.id} className="text-sm">
                      {p.name}
                      <span className="text-muted-foreground">
                        {p.endedOn ? ` · left ${p.endedOn}` : ""}
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          act(() => setActive({ id: p.id, active: true }))
                        }
                        className="ml-2 rounded-md border px-1.5 py-0.5 text-xs hover:bg-muted"
                      >
                        Back
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => act(() => remove({ id: p.id }))}
                        className="ml-1 rounded-md border px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
                        title="Only works when no payroll month references them: for a row added by mistake."
                      >
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <p className="text-sm text-[var(--ceo-critical)]">{error}</p>
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}
