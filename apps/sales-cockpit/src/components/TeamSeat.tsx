import { useState } from "react";
import { api } from "../lib/api";
import { money, num } from "../lib/format";
import {
  CLOSER_PLAN,
  CURRENCIES,
  GOAL_FIELDS,
  type GoalsForm,
  goalsFromForm,
  goalsToForm,
  type PayForm,
  payFromForm,
  payToForm,
  payWords,
} from "../lib/pay";
import { toast } from "../lib/toast";
import type { Goals, Person, Rep, SalesRole } from "../lib/types";
import { Avatar, button, buttonPrimary, field, StatusChip } from "./kit";
import { TeamDisclosure, TeamField, TeamSwitch } from "./TeamControls";

/**
 * One seat on the Team page: who it is, what it is linked to, whether it
 * may open the cockpit, and (folded) the pay rule and the goals. Every save
 * goes through the sales-api function's person.save, which checks that the
 * person asking is a manager and writes the audit row.
 */

export interface GhlUser {
  id: string;
  name: string | null;
  email: string | null;
}

const ROLE_WORDS: Record<SalesRole, string> = {
  setter: "Setter",
  closer: "Closer",
  both: "Setter and closer",
  manager: "Sales manager",
};

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function fail(e: unknown) {
  toast.error(String((e as Error)?.message ?? e));
}

export function TeamSeat({
  person,
  me,
  users,
  usersError,
  reps,
  onSaved,
}: {
  person: Person;
  /** The manager looking, who cannot pause their own seat. */
  me: string | undefined;
  users: GhlUser[] | null;
  usersError: string | null;
  reps: Rep[];
  onSaved: () => void;
}) {
  const [openPay, setOpenPay] = useState(false);
  const [openGoals, setOpenGoals] = useState(false);
  const [busy, setBusy] = useState(false);
  const who = person.name || person.email;
  const own = me === person.email;

  async function setActive(on: boolean) {
    setBusy(true);
    try {
      await api("person.save", { email: person.email, active: on });
      toast.success(
        on
          ? `Saved. ${who} can open the cockpit again.`
          : `Saved. ${who} is paused and cannot open the cockpit.`,
      );
      onSaved();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  const linkKey = [
    person.ghl_user_id,
    person.maqsam_email,
    person.fathom_email,
    person.slack_user_id,
  ].join("|");
  const words = payWords(person.pay, "their");
  const payLine = words
    ? `${words.charAt(0).toUpperCase()}${words.slice(1)}.`
    : "No pay rule set yet";

  return (
    <section className="panel min-w-0 overflow-hidden" aria-label={who}>
      <header className="flex items-start gap-3 border-b hairline px-4 py-3">
        <Avatar name={person.name || person.email} size={32} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" dir="auto">
            {who}
            {own ? <span className="muted font-normal"> · you</span> : null}
          </p>
          <p className="muted truncate text-xs">
            {person.name ? `${person.email} · ` : ""}
            {ROLE_WORDS[person.role] ?? person.role}
          </p>
        </div>
        <StatusChip
          tone={person.active ? "good" : "neutral"}
          label={person.active ? "Active" : "Paused"}
        />
      </header>

      {person.via_portal ? null : (
        <p className="callout-warn border-b px-4 py-2 text-xs">
          No longer has the Sales cockpit on the portal
        </p>
      )}

      <div className="space-y-4 p-4">
        <LinksForm
          key={linkKey}
          person={person}
          users={users}
          usersError={usersError}
          reps={reps}
          onSaved={onSaved}
        />

        <div className="grid gap-4 border-t hairline pt-4 sm:grid-cols-2">
          <TeamField
            label="Role"
            help="The role is changed on the portal's Admin page."
          >
            <p className="text-sm">{ROLE_WORDS[person.role] ?? person.role}</p>
          </TeamField>
          <TeamField
            label="Active"
            help={
              own
                ? "You cannot pause your own seat."
                : "Paused seats keep their history but cannot open the cockpit."
            }
          >
            <div className="flex items-center gap-2">
              <TeamSwitch
                on={person.active}
                label={`${who} may open the cockpit`}
                disabled={busy || own}
                onChange={setActive}
              />
              <span className="text-sm">
                {person.active ? "Active" : "Paused"}
              </span>
            </div>
          </TeamField>
        </div>
      </div>

      <TeamDisclosure
        title="Pay rule"
        summary={payLine}
        open={openPay}
        onToggle={() => setOpenPay(o => !o)}
      >
        <PayEditor
          key={JSON.stringify(person.pay ?? {})}
          person={person}
          onSaved={onSaved}
        />
      </TeamDisclosure>

      <TeamDisclosure
        title="Goals"
        summary={goalsSummary(person.goals)}
        open={openGoals}
        onToggle={() => setOpenGoals(o => !o)}
      >
        <GoalsEditor
          key={JSON.stringify(person.goals ?? {})}
          person={person}
          onSaved={onSaved}
        />
      </TeamDisclosure>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Links: HighLevel, Maqsam, Fathom, Slack
// ---------------------------------------------------------------------------

function LinksForm({
  person,
  users,
  usersError,
  reps,
  onSaved,
}: {
  person: Person;
  users: GhlUser[] | null;
  usersError: string | null;
  reps: Rep[];
  onSaved: () => void;
}) {
  const initial = {
    ghl: person.ghl_user_id ?? "",
    maqsam: person.maqsam_email ?? "",
    fathom: person.fathom_email ?? "",
    slack: person.slack_user_id ?? "",
  };
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const id = person.email.replace(/[^a-z0-9]/gi, "-");
  const rep = reps.find(r => r.id === person.b2b_rep_id) ?? null;

  const bad = {
    maqsam:
      f.maqsam.trim() && !EMAIL.test(f.maqsam.trim())
        ? "That is not an email address."
        : null,
    fathom:
      f.fathom.trim() && !EMAIL.test(f.fathom.trim())
        ? "That is not an email address."
        : null,
  };
  const changed = (Object.keys(initial) as (keyof typeof initial)[]).filter(
    k => f[k].trim() !== initial[k],
  );

  // HighLevel's users, the one whose address matches the seat first.
  const options = [...(users ?? [])].sort(
    (a, b) =>
      Number((b.email ?? "").toLowerCase() === person.email) -
        Number((a.email ?? "").toLowerCase() === person.email) ||
      String(a.name ?? "").localeCompare(String(b.name ?? "")),
  );
  const unlisted = f.ghl && !options.some(u => u.id === f.ghl);

  async function save() {
    const body: Record<string, unknown> = { email: person.email };
    if (changed.includes("ghl")) body.ghl_user_id = f.ghl;
    if (changed.includes("maqsam")) body.maqsam_email = f.maqsam.trim();
    if (changed.includes("fathom")) body.fathom_email = f.fathom.trim();
    if (changed.includes("slack")) body.slack_user_id = f.slack.trim();
    setBusy(true);
    try {
      const out = await api<{ person?: Person }>("person.save", body);
      // Linking a HighLevel user links the B2B rep that has it, when B2B has one.
      const linked = reps.find(r => r.id === out.person?.b2b_rep_id) ?? null;
      toast.success(
        !body.ghl_user_id
          ? "Saved."
          : !out.person?.b2b_rep_id
            ? "Saved. B2B has no rep with this HighLevel user yet, so the numbers stay unlinked."
            : linked && linked.ghl_user_id !== body.ghl_user_id
              ? `Saved. B2B has no rep with this HighLevel user, so the numbers still come from ${linked.display_name ?? "the rep linked before"}.`
              : `Saved. The numbers come from B2B rep ${linked?.display_name ?? "linked to this user"}.`,
      );
      onSaved();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  const fromB2b = (k: "maqsam" | "fathom", v: string | null) =>
    !f[k].trim() && v ? (
      <button
        type="button"
        onClick={() => setF(x => ({ ...x, [k]: v }))}
        className="no-touch underline underline-offset-2"
      >
        Use B2B's: {v}
      </button>
    ) : undefined;

  return (
    <form
      className="space-y-4"
      onSubmit={e => {
        e.preventDefault();
        if (changed.length && !bad.maqsam && !bad.fathom) void save();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TeamField
          label="HighLevel user"
          htmlFor={`${id}-ghl`}
          help={
            usersError
              ? `HighLevel's users could not be read: ${usersError}`
              : users
                ? "Linking it links the B2B rep too, which is how the numbers know whose they are."
                : "Reading HighLevel's users…"
          }
        >
          <select
            id={`${id}-ghl`}
            value={f.ghl}
            onChange={e => setF(x => ({ ...x, ghl: e.target.value }))}
            className={field}
          >
            <option value="">Not linked</option>
            {unlisted ? (
              <option value={f.ghl}>
                {users
                  ? `${f.ghl} (not in HighLevel's list)`
                  : `Linked to ${f.ghl}`}
              </option>
            ) : null}
            {options.map(u => (
              <option key={u.id} value={u.id}>
                {u.name || "Unnamed user"}
                {u.email ? ` · ${u.email}` : ""}
              </option>
            ))}
          </select>
        </TeamField>
        <TeamField label="Numbers">
          <p className="text-sm">
            {rep ? (
              <>
                From B2B rep{" "}
                <span className="font-medium">
                  {rep.display_name ?? rep.id}
                </span>
                {rep.ghl_user_id &&
                person.ghl_user_id &&
                rep.ghl_user_id !== person.ghl_user_id ? (
                  <span className="muted">
                    {" "}
                    (B2B has a different HighLevel user on that rep)
                  </span>
                ) : null}
              </>
            ) : person.b2b_rep_id ? (
              "Linked to a B2B rep the cockpit has not copied yet"
            ) : (
              <span className="muted">
                Not linked. Linking the HighLevel user links them once B2B has a
                rep with that user.
              </span>
            )}
          </p>
        </TeamField>
        <TeamField
          label="Maqsam email"
          htmlFor={`${id}-maqsam`}
          error={bad.maqsam}
          help={
            fromB2b("maqsam", rep?.maqsam_email ?? null) ??
            "The address Maqsam keeps this person's calls under."
          }
        >
          <input
            id={`${id}-maqsam`}
            type="email"
            autoComplete="off"
            value={f.maqsam}
            onChange={e => setF(x => ({ ...x, maqsam: e.target.value }))}
            placeholder="name@maharamedia.com"
            className={field}
          />
        </TeamField>
        <TeamField
          label="Fathom email"
          htmlFor={`${id}-fathom`}
          error={bad.fathom}
          help={
            fromB2b("fathom", rep?.fathom_email ?? null) ??
            "The address their call recordings are under."
          }
        >
          <input
            id={`${id}-fathom`}
            type="email"
            autoComplete="off"
            value={f.fathom}
            onChange={e => setF(x => ({ ...x, fathom: e.target.value }))}
            placeholder="name@maharamedia.com"
            className={field}
          />
        </TeamField>
        <TeamField
          label="Slack user id"
          htmlFor={`${id}-slack`}
          help="Starts with U, from their Slack profile."
        >
          <input
            id={`${id}-slack`}
            type="text"
            autoComplete="off"
            value={f.slack}
            onChange={e => setF(x => ({ ...x, slack: e.target.value }))}
            placeholder="U0123ABCD"
            className={field}
          />
        </TeamField>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={
            busy || !changed.length || Boolean(bad.maqsam || bad.fathom)
          }
          className={buttonPrimary}
        >
          {busy ? "Saving…" : "Save links"}
        </button>
        {changed.length ? (
          <button
            type="button"
            onClick={() => setF(initial)}
            className="muted text-sm underline-offset-2 hover:underline"
          >
            Undo changes
          </button>
        ) : null}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Pay rule
// ---------------------------------------------------------------------------

function PayEditor({
  person,
  onSaved,
}: {
  person: Person;
  onSaved: () => void;
}) {
  const initial = payToForm(person.pay);
  const [f, setF] = useState<PayForm>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = `${person.email.replace(/[^a-z0-9]/gi, "-")}-pay`;
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const parsed = payFromForm(f);
  const preview = parsed.ok ? payWords(parsed.pay, "your") : null;
  const set = (k: keyof PayForm) => (v: string) => {
    setError(null);
    setF(x => ({ ...x, [k]: v }));
  };

  async function save() {
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    try {
      await api("person.save", { email: person.email, pay: parsed.pay });
      toast.success("Saved.");
      onSaved();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  const amountField = (k: keyof PayForm, label: string, help?: string) => (
    <TeamField
      label={`${label} (${f.currency})`}
      htmlFor={`${id}-${k}`}
      help={help}
    >
      <input
        id={`${id}-${k}`}
        type="text"
        inputMode="decimal"
        value={f[k]}
        onChange={e => set(k)(e.target.value)}
        placeholder="None"
        className={field}
      />
    </TeamField>
  );

  return (
    <form
      className="space-y-4"
      onSubmit={e => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TeamField
          label="Share of cash collected (%)"
          htmlFor={`${id}-cashPct`}
          help="Earned as each payment on their contracts clears. 10 means 10%."
        >
          <input
            id={`${id}-cashPct`}
            type="text"
            inputMode="decimal"
            value={f.cashPct}
            onChange={e => set("cashPct")(e.target.value)}
            placeholder="None"
            className={field}
          />
        </TeamField>
        {amountField(
          "pif",
          "Paid-in-full bonus",
          "When a client pays the whole contract.",
        )}
        {amountField(
          "perIntro",
          "Per intro shown",
          "For each intro they set that shows.",
        )}
        {amountField("perDemo", "Per demo shown")}
        {amountField("perSigned", "Per signed client")}
        <TeamField
          label="Currency"
          htmlFor={`${id}-currency`}
          help="The deals themselves are in dollars."
        >
          <select
            id={`${id}-currency`}
            value={f.currency}
            onChange={e => set("currency")(e.target.value)}
            className={field}
          >
            {CURRENCIES.map(c => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </TeamField>
        <TeamField
          label="Note"
          htmlFor={`${id}-note`}
          className="sm:col-span-2"
          help="The plan in words, as agreed with them."
        >
          <textarea
            id={`${id}-note`}
            value={f.note}
            maxLength={500}
            rows={2}
            dir="auto"
            onChange={e => set("note")(e.target.value)}
            className={`${field} h-auto py-2`}
          />
        </TeamField>
      </div>

      <p className="muted text-xs">
        {parsed.ok
          ? preview
            ? `They read: ${preview.charAt(0).toUpperCase()}${preview.slice(1)}.`
            : "With every amount blank, they read: No pay rule set yet."
          : null}
      </p>
      {error ? (
        <p className="text-xs" style={{ color: "var(--destructive)" }}>
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={busy || !dirty}
          className={buttonPrimary}
        >
          {busy ? "Saving…" : "Save pay rule"}
        </button>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setF(x => ({
              ...x,
              cashPct: String(CLOSER_PLAN.cash_rate * 100),
              pif: String(CLOSER_PLAN.pif_bonus),
              currency: CLOSER_PLAN.currency,
            }));
          }}
          className={button}
        >
          Use the closer plan
        </button>
        <span className="muted text-xs">
          10% of cash collected and {money(CLOSER_PLAN.pif_bonus)} when a client
          pays in full
        </span>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

function goalsSummary(goals: Goals | null | undefined): string {
  const part = (kind: "weekly" | "monthly") => {
    const set = goals?.[kind] ?? {};
    const bits = GOAL_FIELDS.filter(g => (num(set[g.key]) ?? 0) > 0).map(g =>
      g.money
        ? `${money(set[g.key])} cash`
        : `${Number(set[g.key]).toLocaleString("en-US")} ${g.label.toLowerCase()}`,
    );
    return bits.length
      ? `${kind === "weekly" ? "Weekly" : "Monthly"}: ${bits.join(", ")}`
      : null;
  };
  const parts = [part("weekly"), part("monthly")].filter(Boolean);
  return parts.length ? parts.join(" · ") : "No goals set yet";
}

function GoalsEditor({
  person,
  onSaved,
}: {
  person: Person;
  onSaved: () => void;
}) {
  const initial = goalsToForm(person.goals);
  const [f, setF] = useState<GoalsForm>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = `${person.email.replace(/[^a-z0-9]/gi, "-")}-goals`;
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);

  async function save() {
    const out = goalsFromForm(f, person.goals);
    if (!out.ok) {
      setError(out.error);
      return;
    }
    setBusy(true);
    try {
      await api("person.save", { email: person.email, goals: out.goals });
      toast.success("Saved.");
      onSaved();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-3"
      onSubmit={e => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] items-center gap-x-2 gap-y-2 sm:grid-cols-[minmax(0,1fr)_8rem_8rem] sm:gap-x-3">
        <span />
        <span className="muted text-xs font-medium">Weekly</span>
        <span className="muted text-xs font-medium">Monthly</span>
        {GOAL_FIELDS.map(g => (
          <div key={g.key} className="contents">
            <span className="text-sm">
              {g.label}
              {g.money ? <span className="muted"> ($)</span> : null}
            </span>
            {(["weekly", "monthly"] as const).map(kind => (
              <input
                key={kind}
                id={`${id}-${kind}-${g.key}`}
                aria-label={`${kind === "weekly" ? "Weekly" : "Monthly"} ${g.label.toLowerCase()} goal`}
                type="text"
                inputMode="decimal"
                value={f[kind][g.key] ?? ""}
                placeholder="None"
                onChange={e => {
                  const v = e.target.value;
                  setError(null);
                  setF(x => ({ ...x, [kind]: { ...x[kind], [g.key]: v } }));
                }}
                className={`${field} px-2`}
              />
            ))}
          </div>
        ))}
      </div>
      <p className="muted text-xs">
        A blank box is no goal. The week runs Saturday to Thursday; the month is
        the calendar month.
      </p>
      {error ? (
        <p className="text-xs" style={{ color: "var(--destructive)" }}>
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={busy || !dirty} className={buttonPrimary}>
        {busy ? "Saving…" : "Save goals"}
      </button>
    </form>
  );
}
