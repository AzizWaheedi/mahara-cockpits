import { Check, CircleHelp, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { count } from "@/components/ceo/format";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import type {
  HoursAccount,
  HoursStatus,
  HoursView,
} from "@/lib/ceoHoursClient";
import { api, useAction } from "@/lib/cockpitApi";
import { cn } from "@/lib/utils";
import type { Provider } from "@/types/ceo/hoursContract";
import { PROVIDER_NAME } from "./hoursCopy";

/**
 * Link accounts (design 5.6). Timetastic users link themselves by payroll id
 * and Hubstaff members by email; this view is for what is left: pick a
 * person, or say the account is not on the roster. The cockpit never invites
 * anyone and never buys a seat.
 */

const METHOD: Record<NonNullable<HoursAccount["linkMethod"]>, string> = {
  payroll_id: "linked by payroll id",
  email: "linked by email",
  manual: "linked by you",
};

function errorText(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  return raw.split("\n")[0].trim() || fallback;
}

/** The accounts to show: the server's list, or the linked ones the month already carries. */
export function accountsOf(
  view: HoursView,
  status: HoursStatus | null,
): { list: HoursAccount[]; complete: boolean } {
  if (status?.accounts) return { list: status.accounts, complete: true };
  const list: HoursAccount[] = [];
  for (const p of view.inputs.people)
    for (const a of p.accounts)
      list.push({
        provider: a.provider,
        externalId: a.externalId,
        email: a.email,
        name: a.name,
        status: a.status,
        membershipRole: null,
        personId: p.personId,
        linkMethod: a.linkMethod,
        ignored: false,
        emailDiffers: a.emailDiffers,
      });
  return { list, complete: false };
}

function AccountRow({
  a,
  view,
  takenBy,
  onChanged,
}: {
  a: HoursAccount;
  view: HoursView;
  /** People who already have an account with this provider. */
  takenBy: Set<number>;
  onChanged: () => Promise<void> | void;
}) {
  const link = useAction(api.ceo.hours.link);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const person = view.inputs.people.find(p => p.personId === a.personId);
  const ceo = view.notCounted.some(
    n => n.personId === a.personId && n.why === "ceo",
  );
  const who = a.email ?? a.name ?? `Account ${a.externalId}`;
  const choices = view.inputs.people
    .filter(
      p =>
        p.active &&
        p.engagement !== "bot" &&
        !takenBy.has(p.personId) &&
        !view.notCounted.some(
          n => n.personId === p.personId && n.why === "ceo",
        ),
    )
    .sort((x, y) => x.name.localeCompare(y.name));

  const run = async (args: Record<string, unknown>, done: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await link({ provider: a.provider, externalId: a.externalId, ...args });
      setMsg({ ok: true, text: done });
      await onChanged();
    } catch (e) {
      setMsg({ ok: false, text: errorText(e, "The link was not saved.") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="grid gap-1.5 py-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {a.personId ? (
          <Check
            className="size-4 shrink-0 text-[var(--ceo-good)]"
            aria-label="Linked"
          />
        ) : a.ignored ? (
          <span className="size-4 shrink-0" aria-hidden />
        ) : (
          <CircleHelp
            className="size-4 shrink-0 text-[var(--ceo-warning)]"
            aria-label="Not linked"
          />
        )}
        <span className="min-w-0 truncate font-mono text-xs">{who}</span>
        {a.name && a.email ? (
          <span className="truncate text-xs text-muted-foreground">{`"${a.name}"`}</span>
        ) : null}
        {busy ? (
          <Loader2
            className="size-3.5 animate-spin text-muted-foreground"
            aria-hidden
          />
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-6 text-xs text-muted-foreground">
        {a.personId ? (
          <>
            <span>
              {ceo
                ? "The CEO (not counted)"
                : `${a.linkMethod ? METHOD[a.linkMethod] : "linked"} → ${person?.name ?? `person ${a.personId}`}${person?.role ? ` · ${person.role}` : ""}`}
            </span>
            {a.emailDiffers ? (
              <span>· the email differs from the roster</span>
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={() => void run({ personId: null }, "Unlinked.")}
              className="font-medium text-foreground/80 underline-offset-4 hover:underline"
            >
              Unlink
            </button>
          </>
        ) : a.ignored ? (
          <>
            <span>Not on the roster</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run({ ignored: false }, "Back in the list.")}
              className="font-medium text-foreground/80 underline-offset-4 hover:underline"
            >
              Undo
            </button>
          </>
        ) : (
          <>
            <span>No matching email.</span>
            <AnimatedSelect
              aria-label={`Who ${who} is`}
              value=""
              disabled={busy}
              onChange={e =>
                e.target.value
                  ? void run({ personId: Number(e.target.value) }, "Linked.")
                  : undefined
              }
              className="ceo-select-sm"
            >
              <option value="">Pick a person</option>
              {choices.map(p => (
                <option key={p.personId} value={String(p.personId)}>
                  {`${p.name}${p.role ? ` · ${p.role}` : ""}`}
                </option>
              ))}
            </AnimatedSelect>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void run({ ignored: true }, "Set aside.")}
            >
              Not on the roster
            </Button>
          </>
        )}
      </div>
      {msg ? (
        <p
          aria-live="polite"
          className={cn(
            "pl-6 text-xs",
            msg.ok ? "text-muted-foreground" : "text-[var(--ceo-critical)]",
          )}
        >
          {msg.text}
        </p>
      ) : null}
    </li>
  );
}

export function LinkAccounts({
  view,
  status,
  onChanged,
}: {
  view: HoursView;
  status: HoursStatus | null;
  onChanged: () => Promise<void> | void;
}) {
  const { list, complete } = useMemo(
    () => accountsOf(view, status),
    [view, status],
  );
  const missingHubstaff = view.people.filter(p => {
    const inputs = view.inputs.people.find(x => x.personId === p.personId);
    return (
      p.tracking.value === "required" &&
      inputs?.active === true &&
      !inputs.accounts.some(a => a.provider === "hubstaff")
    );
  });

  const column = (provider: Provider) => {
    const rows = list
      .filter(a => a.provider === provider)
      .sort(
        (x, y) =>
          Number(Boolean(x.personId) || x.ignored) -
            Number(Boolean(y.personId) || y.ignored) ||
          (x.email ?? x.name ?? "").localeCompare(y.email ?? y.name ?? ""),
      );
    const taken = new Set(
      rows.map(a => a.personId).filter((v): v is number => v !== null),
    );
    const source = view.sources.find(s => s.provider === provider);
    const total = source?.accounts ?? rows.length;
    return (
      <section className="min-w-0">
        <h3 className="text-sm font-semibold">
          {`${PROVIDER_NAME[provider]} · ${count(total)} ${provider === "hubstaff" ? (total === 1 ? "person" : "people") : total === 1 ? "user" : "users"}`}
        </h3>
        {rows.length ? (
          <ul className="divide-y">
            {rows.map(a => (
              <AccountRow
                key={a.externalId}
                a={a}
                view={view}
                takenBy={taken}
                onChanged={onChanged}
              />
            ))}
          </ul>
        ) : (
          <p className="py-3 text-sm text-muted-foreground">
            {source?.state === "connected"
              ? "Nobody has been read yet. Press Sync now in Connections."
              : `Connect ${PROVIDER_NAME[provider]} in Connections to see its accounts.`}
          </p>
        )}
        {!complete && source?.unlinked ? (
          <p className="text-xs text-muted-foreground">
            {`${count(source.unlinked)} more not linked yet. They show here once the server lists unlinked accounts.`}
          </p>
        ) : null}
      </section>
    );
  };

  return (
    <div className="grid gap-6">
      <div className="grid gap-6 @3xl:grid-cols-2 @3xl:gap-8">
        {column("hubstaff")}
        {column("timetastic")}
      </div>
      {missingHubstaff.length ? (
        <p className="text-sm">
          {`Required, without a Hubstaff account: ${missingHubstaff.map(p => `${p.name} · ${p.role ?? "no role"}`).join(", ")}. `}
          <span className="text-muted-foreground">
            Hubstaff seats and invitations are handled in Hubstaff. The cockpit
            never invites anyone.
          </span>
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Timetastic users link by the payroll id on their profile, then by email;
        Hubstaff members by email. Links are never removed by themselves.
      </p>
    </div>
  );
}
