import { useAction } from "convex/react";
import { UserPlus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "@/components/ceo/EmptyState";
import { money, plural, shortDate } from "@/components/ceo/format";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatTile } from "@/components/ceo/StatTile";
import { StatusChip } from "@/components/ceo/StatusChip";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import { api } from "../../../convex/_generated/api";
import { commissionText } from "../../../convex/ceo/commission";
import type { Note } from "../../../convex/ceo/payloads";
import type { Person, Roster } from "../../../convex/ceo/people";
import { usePersonParam } from "./personPage";

/**
 * Who Mahara pays.
 *
 * The one number that decides whether the business looks healthy or underwater
 * is payroll, and it is recorded nowhere. This is the screen that fixes that:
 * a roster kept by hand, staff and freelancers together, because to a margin
 * they are the same money.
 */

type Engagement = Person["engagement"];

/** Why the roster is kept by hand: folded into the card's notes, not printed above the numbers. */
const WHY_BY_HAND: Note = {
  level: "info",
  text: "Nothing in the stack knows who works here: ClickUp time tracking has never recorded an entry, and the bank's salaries line is a label whose rows are mostly card top-ups naming nobody. So this roster is the source, and it is what makes gross margin and a real cost per client possible. Somebody who leaves is marked gone, never deleted, because the months they were paid for still happened.",
};

/**
 * The same roster the Team and payroll tab edits, shown here too. Pausing
 * somebody is done on that tab, where the reason can be typed; this one only
 * has to tell the truth about the state so the two never disagree.
 */
const ENGAGEMENTS: { value: Engagement; label: string }[] = [
  { value: "staff", label: "Staff" },
  { value: "freelancer", label: "Freelancer" },
  { value: "agency", label: "Agency" },
  { value: "bot", label: "Shared account" },
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
  // Pressing a name opens their file: goals, flags, CV and the scorecard.
  const [, setPerson] = usePersonParam();
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
      kicker="Kept by hand"
      title="Who we pay"
      notes={[WHY_BY_HAND]}
      order={order}
    >
      {() => (
        <div className="grid gap-6">
          {data.ready ? null : (
            <p className="callout-warn rounded-lg border px-3 py-2 text-sm">
              The people table does not exist yet. Run{" "}
              <code>supabase/migrations/20260919b_people.sql</code> in the
              Creative Triage SQL editor.
            </p>
          )}

          <div className="grid grid-cols-2 gap-x-6 gap-y-6 @lg:grid-cols-3">
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
              label="Not costed yet"
              value={String(data.missingCost.length)}
              sub={
                data.missingCost.length
                  ? data.missingCost.slice(0, 3).join(", ")
                  : "Everyone has a figure"
              }
              hint="Until these carry a cost, the monthly total above is a floor rather than the payroll."
            />
          </div>

          {live.length ? (
            <div className="ceo-table-scroll relative -mx-1 overflow-x-auto px-1">
              <table
                className="w-full min-w-[40rem] text-sm"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="min-w-40 py-2 pr-3 font-medium">Person</th>
                    <th className="min-w-36 px-3 py-2 font-medium">
                      Engagement
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      Monthly
                    </th>
                    <th className="min-w-56 px-3 py-2 font-medium">
                      Commission
                    </th>
                    <th className="py-2 pl-3 font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {live.map(p => (
                    <tr key={p.id} className="align-top">
                      <td className="py-3 pr-3">
                        <button
                          type="button"
                          onClick={() => setPerson(p.id)}
                          title={`Open ${p.name}'s file`}
                          className="text-left font-medium underline decoration-transparent underline-offset-4 transition-colors hover:decoration-current"
                        >
                          {p.name}
                        </button>
                        <span className="block text-xs text-muted-foreground">
                          {[p.role, p.isSales ? "sells" : null]
                            .filter(Boolean)
                            .join(" · ") || "No role set"}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span>
                          {ENGAGEMENTS.find(e => e.value === p.engagement)
                            ?.label ?? p.engagement}
                        </span>
                        {p.pausedOn ? (
                          <span className="block text-xs text-muted-foreground">
                            Paused since {shortDate(p.pausedOn)}
                            {p.pausedWhy ? `: ${p.pausedWhy}` : ""}. Change it
                            on Team & payroll.
                          </span>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right">
                        {p.monthlyUsd === null ? (
                          <span className="text-muted-foreground">Not set</span>
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
                      <td className="px-3 py-3">
                        {commissionText(
                          p.commission,
                          p.currency,
                          p.commissionNote,
                        ) === null ? (
                          <span className="text-muted-foreground">None</span>
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
                      <td className="whitespace-nowrap py-3 pl-3 text-right">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => edit(p)}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
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
                          className="ml-1 text-muted-foreground"
                        >
                          Gone
                        </Button>
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

          <div className="rounded-xl bg-muted/40 p-4">
            <p className="mb-3 text-sm font-medium text-foreground">
              {editing === null ? "Add somebody" : "Edit somebody"}
            </p>
            <div className="grid gap-3 @md:grid-cols-2 @3xl:grid-cols-4">
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
              <AnimatedSelect
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
              </AnimatedSelect>
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
              <AnimatedSelect
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
              </AnimatedSelect>
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
                className={`${field} @md:col-span-2 @3xl:col-span-3`}
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
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                disabled={busy || !form.name.trim() || !data.ready}
                onClick={submit}
              >
                {editing === null ? "Add" : "Save"}
              </Button>
              {editing === null ? null : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditing(null);
                    setForm({ ...blank });
                  }}
                >
                  Cancel
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
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
                title="Adds Workspace accounts that are not here yet. It never edits or removes anybody, and never sets a cost."
              >
                Add from Workspace
              </Button>
            </div>
            {imported ? (
              <p className="mt-2 text-sm text-muted-foreground">{imported}</p>
            ) : null}
          </div>

          {gone.length ? (
            <div className="border-t pt-4">
              <button
                type="button"
                aria-expanded={showGone}
                onClick={() => setShowGone(v => !v)}
                className="text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                {showGone
                  ? "Hide people who have left"
                  : `${plural(gone.length, "person", "people")} who left`}
              </button>
              {showGone ? (
                <ul className="mt-3 divide-y">
                  {gone.map(p => (
                    <li
                      key={p.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
                    >
                      <button
                        type="button"
                        onClick={() => setPerson(p.id)}
                        title={`Open ${p.name}'s file`}
                        className="min-w-0 text-left underline decoration-transparent underline-offset-4 transition-colors hover:decoration-current"
                      >
                        {p.name}
                      </button>
                      {p.endedOn ? (
                        <span className="text-xs text-muted-foreground">
                          {`Left ${shortDate(p.endedOn)}`}
                        </span>
                      ) : null}
                      <span className="ml-auto flex items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            act(() => setActive({ id: p.id, active: true }))
                          }
                        >
                          Back
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => act(() => remove({ id: p.id }))}
                          className="text-muted-foreground"
                          title="Only works when no payroll month references them: for a row added by mistake."
                        >
                          Delete
                        </Button>
                      </span>
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
