import { useAction } from "convex/react";
import { Check, UserPlus, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/ceo/EmptyState";
import { count, money, pct, plural } from "@/components/ceo/format";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatTile } from "@/components/ceo/StatTile";
import { StatusChip } from "@/components/ceo/StatusChip";
import { api } from "../../../convex/_generated/api";
import type { Person, Roster } from "../../../convex/ceo/people";
import type { CeoTabProps } from "./types";

/**
 * The team and what it costs, on one screen and nothing else.
 *
 * Two lists: on the team, and not any more. Every row is the person, what
 * they do, what they are paid a month and whether they earn commission, with
 * the pay editable in place and one switch to take somebody off the team
 * (they are never deleted: the months they were paid for still happened).
 * Payroll at the top is the sum of the people on the team, in dollars.
 */

const ENGAGEMENTS: { value: Person["engagement"]; label: string }[] = [
  { value: "staff", label: "Staff" },
  { value: "freelancer", label: "Freelancer" },
  { value: "agency", label: "Agency" },
  { value: "intern", label: "Intern" },
];
const CURRENCIES = ["USD", "KWD", "EGP", "SAR", "AED"];

function serverMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  return (
    raw
      .split("\n")[0]
      .replace(/^\[.*?]\s*/, "")
      .trim() || "That did not go through."
  );
}

const field = "rounded-md border bg-background px-2 py-1 text-sm";

type Draft = {
  monthlyCost: string;
  currency: string;
  commissionPct: string;
  role: string;
};

const draftOf = (p: Person): Draft => ({
  monthlyCost: p.monthlyCost === null ? "" : String(p.monthlyCost),
  currency: p.currency || "USD",
  commissionPct: p.commissionPct === null ? "" : String(p.commissionPct * 100),
  role: p.role ?? "",
});

function Row({ p, onChanged }: { p: Person; onChanged: () => Promise<void> }) {
  const save = useAction(api.ceo.people.save);
  const setActive = useAction(api.ceo.people.setActive);
  const [d, setD] = useState<Draft>(() => draftOf(p));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const base = draftOf(p);
  const dirty =
    d.monthlyCost !== base.monthlyCost ||
    d.currency !== base.currency ||
    d.commissionPct !== base.commissionPct ||
    d.role !== base.role;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setMsg(serverMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const initial = (p.name || p.email || "?").trim().charAt(0).toUpperCase();

  return (
    <div className="grid gap-2 py-3 @3xl:grid-cols-[minmax(0,1.4fr)_15rem_13rem_auto] @3xl:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={`flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${p.active ? "bg-[var(--ceo-emphasis-wash)] text-[var(--ceo-emphasis)]" : "bg-muted text-muted-foreground"}`}
          aria-hidden
        >
          {initial}
        </span>
        <div className="min-w-0">
          <div className="truncate font-medium">{p.name}</div>
          <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <input
              value={d.role}
              onChange={e => setD({ ...d, role: e.target.value })}
              placeholder="what they do"
              aria-label={`${p.name}'s role`}
              className="w-40 rounded border-0 border-b border-transparent bg-transparent px-0 py-0 text-xs focus:border-b-foreground focus:outline-none"
            />
            <span>
              {ENGAGEMENTS.find(e => e.value === p.engagement)?.label ??
                p.engagement}
            </span>
            {p.email ? <span className="truncate">{p.email}</span> : null}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 @3xl:contents">
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <input
            inputMode="decimal"
            value={d.monthlyCost}
            onChange={e => setD({ ...d, monthlyCost: e.target.value })}
            placeholder="pay a month"
            aria-label={`${p.name}'s monthly pay`}
            className={`${field} w-24 text-right`}
            style={{ fontVariantNumeric: "tabular-nums" }}
          />
          <select
            value={d.currency}
            onChange={e => setD({ ...d, currency: e.target.value })}
            aria-label="Currency"
            className={`${field} w-20`}
          >
            {CURRENCIES.map(c => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {p.monthlyUsd !== null && d.currency !== "USD" ? (
            <span className="text-xs text-muted-foreground">{`≈ ${money(p.monthlyUsd)}`}</span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <input
            inputMode="decimal"
            value={d.commissionPct}
            onChange={e => setD({ ...d, commissionPct: e.target.value })}
            placeholder="–"
            aria-label={`${p.name}'s commission percent`}
            className={`${field} w-16 text-right`}
            style={{ fontVariantNumeric: "tabular-nums" }}
          />
          <span className="text-xs text-muted-foreground">% commission</span>
          {p.isSales ? <StatusChip tone="neutral" label="sales" /> : null}
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        {dirty ? (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              act(() =>
                save({
                  id: p.id,
                  name: p.name,
                  email: p.email ?? undefined,
                  role: d.role.trim() || undefined,
                  engagement: p.engagement,
                  monthlyCost:
                    d.monthlyCost.trim() === ""
                      ? undefined
                      : Number(d.monthlyCost),
                  currency: d.currency,
                  commissionPct:
                    d.commissionPct.trim() === ""
                      ? undefined
                      : Number(d.commissionPct) / 100,
                  commissionNote: p.commissionNote ?? undefined,
                  isSales: p.isSales,
                  startedOn: p.startedOn ?? undefined,
                }),
              )
            }
            className="inline-flex items-center gap-1 rounded-md bg-foreground px-2.5 py-1 text-xs font-medium text-background disabled:opacity-50"
          >
            <Check className="size-3.5" aria-hidden /> Save
          </button>
        ) : null}
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <span className="text-muted-foreground">
            {p.active ? "on the team" : "off the team"}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={p.active}
            aria-label={`${p.name} ${p.active ? "is on the team" : "is off the team"}`}
            disabled={busy}
            onClick={() =>
              act(() =>
                setActive({
                  id: p.id,
                  active: !p.active,
                  endedOn: p.active
                    ? new Date().toISOString().slice(0, 10)
                    : undefined,
                }),
              )
            }
            className={`relative h-5 w-9 rounded-full transition-colors ${p.active ? "bg-[var(--ceo-emphasis)]" : "bg-muted-foreground/40"} disabled:opacity-50`}
          >
            <span
              className={`absolute top-0.5 size-4 rounded-full bg-background transition-[left] ${p.active ? "left-[18px]" : "left-0.5"}`}
            />
          </button>
        </label>
      </div>
      {msg ? (
        <p className="text-xs text-[var(--ceo-critical)] @3xl:col-span-4">
          {msg}
        </p>
      ) : null}
    </div>
  );
}

function AddPerson({ onAdded }: { onAdded: () => Promise<void> }) {
  const save = useAction(api.ceo.people.save);
  const importWorkspace = useAction(api.ceo.people.importWorkspace);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [engagement, setEngagement] = useState<Person["engagement"]>("staff");
  const [pay, setPay] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg(done);
      await onAdded();
    } catch (e) {
      setMsg(serverMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"
        >
          <UserPlus className="size-4" aria-hidden /> Add someone
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            act(async () => {
              const out = (await importWorkspace({})) as {
                added: string[];
                alreadyThere: number;
                problem?: string;
              };
              setMsg(
                `Workspace read: ${out.added.length} added, ${out.alreadyThere} already here${out.problem ? ` · ${out.problem}` : ""}.`,
              );
            }, "")
          }
          className="rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50"
        >
          Add from Google Workspace
        </button>
        {msg ? (
          <span className="text-sm text-muted-foreground">{msg}</span>
        ) : null}
      </div>
      {open ? (
        <div className="grid gap-2 rounded-md border p-3 @md:grid-cols-2 @3xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_8rem_7rem_5.5rem_auto]">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Name"
            aria-label="Name"
            className={field}
          />
          <input
            value={role}
            onChange={e => setRole(e.target.value)}
            placeholder="What they do"
            aria-label="Role"
            className={field}
          />
          <select
            value={engagement}
            onChange={e =>
              setEngagement(e.target.value as Person["engagement"])
            }
            aria-label="Engagement"
            className={field}
          >
            {ENGAGEMENTS.map(e => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </select>
          <input
            inputMode="decimal"
            value={pay}
            onChange={e => setPay(e.target.value)}
            placeholder="Pay a month"
            aria-label="Monthly pay"
            className={field}
          />
          <select
            value={currency}
            onChange={e => setCurrency(e.target.value)}
            aria-label="Currency"
            className={field}
          >
            {CURRENCIES.map(c => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !name.trim()}
            onClick={() =>
              act(async () => {
                await save({
                  name: name.trim(),
                  role: role.trim() || undefined,
                  engagement,
                  monthlyCost: pay.trim() === "" ? undefined : Number(pay),
                  currency,
                });
                setName("");
                setRole("");
                setPay("");
                setOpen(false);
              }, "Added.")
            }
            className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
          >
            Add
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function TeamTab(_props: CeoTabProps) {
  const load = useAction(api.ceo.people.list);
  const [data, setData] = useState<Roster | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showGone, setShowGone] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setData((await load({})) as Roster);
      setError(null);
    } catch (e) {
      setError(serverMessage(e));
    }
  }, [load]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const live = useMemo(
    () => (data?.people ?? []).filter(p => p.active),
    [data],
  );
  const gone = useMemo(
    () => (data?.people ?? []).filter(p => !p.active),
    [data],
  );
  const uncosted = live.filter(p => p.monthlyCost === null).length;
  const external = live.filter(p => p.engagement !== "staff").length;
  const onCommission = live.filter(
    p => p.commissionPct !== null || p.commissionNote,
  ).length;

  return (
    <div className="@container grid gap-4 lg:gap-6">
      <SectionCard
        kicker="Who Mahara pays, and what it costs a month"
        title="Team & payroll"
        order={0}
      >
        {() => (
          <div className="grid gap-5">
            <div className="grid grid-cols-2 gap-x-6 gap-y-5 @lg:grid-cols-4">
              <StatTile
                variant="plain"
                label="On the team"
                value={data ? count(live.length) : "—"}
                sub={
                  data ? `${count(external)} freelance or agency` : undefined
                }
              />
              <StatTile
                variant="plain"
                label="Payroll a month"
                value={data ? money(data.activeMonthlyUsd) : "—"}
                sub={
                  uncosted
                    ? `${plural(uncosted, "person", "people")} not costed yet`
                    : "everyone costed"
                }
                hint="The sum of monthly pay for everyone on the team, converted to dollars at the cockpit's fixed rates. People without a pay figure are missing from it, not zero."
              />
              <StatTile
                variant="plain"
                label="On commission"
                value={data ? count(onCommission) : "—"}
              />
              <StatTile
                variant="plain"
                label="Off the team"
                value={data ? count(gone.length) : "—"}
                sub="kept for the months they were paid"
              />
            </div>
            <AddPerson onAdded={refresh} />
            {error ? (
              <p className="text-sm text-[var(--ceo-critical)]">{error}</p>
            ) : null}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="On the team"
        kicker="pay and commission edit in place; the switch takes somebody off"
        order={1}
      >
        {() =>
          data === null ? null : live.length ? (
            <div className="divide-y">
              <div className="hidden pb-1 text-xs text-muted-foreground @3xl:grid @3xl:grid-cols-[minmax(0,1.4fr)_15rem_13rem_auto]">
                <span>Person</span>
                <span>Pay a month</span>
                <span>Commission</span>
                <span />
              </div>
              {live.map(p => (
                <Row key={p.id} p={p} onChanged={refresh} />
              ))}
            </div>
          ) : (
            <EmptyState
              title="Nobody on the team yet"
              text="Add someone above, or pull the Google Workspace directory in."
              icon={Users}
              compact
            />
          )
        }
      </SectionCard>

      {gone.length ? (
        <SectionCard
          title="Off the team"
          kicker={`${plural(gone.length, "person", "people")}`}
          order={2}
          actions={
            <button
              type="button"
              onClick={() => setShowGone(v => !v)}
              className="rounded border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
            >
              {showGone ? "Hide" : "Show"}
            </button>
          }
        >
          {() =>
            showGone ? (
              <div className="divide-y">
                {gone.map(p => (
                  <Row key={p.id} p={p} onChanged={refresh} />
                ))}
              </div>
            ) : null
          }
        </SectionCard>
      ) : null}
      {data && data.people.some(p => p.commissionPct !== null) ? (
        <p className="text-xs text-muted-foreground">
          {`Commission is a share of what the person closes or sets; the rate is kept here, the payout is worked out on the Sales tab against the deals of the month. ${pct(0.1)} means ten percent.`}
        </p>
      ) : null}
    </div>
  );
}
