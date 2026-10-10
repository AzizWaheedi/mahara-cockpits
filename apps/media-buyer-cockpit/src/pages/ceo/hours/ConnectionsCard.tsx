import { KeyRound, Loader2, RefreshCw, Stethoscope } from "lucide-react";
import { useId, useState } from "react";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { count, kuwaitDay, relative, shortDate } from "@/components/ceo/format";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatusChip } from "@/components/ceo/StatusChip";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import type {
  HoursStatus,
  SaveKeyResult,
  SyncResult,
} from "@/lib/ceoHoursClient";
import { api, useAction } from "@/lib/cockpitApi";
import type { Provider, SourceStatus } from "@/types/ceo/hoursContract";
import {
  CONNECTIONS_ID,
  CRON_MISSING,
  NEEDS_KEY,
  PROVIDER_NAME,
  SOURCE_CHIP,
  sourceSentence,
} from "./hoursCopy";

/**
 * Two quiet rows that say plainly what is connected (design 5.2). There is
 * no order between the two keys, so no numbered steps. Once both keys work
 * the card folds to one line, so it never competes with the hours below.
 *
 * A key is pasted, tested by the server before it replaces the old one, and
 * never comes back: the browser only ever sees its last four characters.
 */

const at = (iso: string | null | undefined) => (iso ? Date.parse(iso) : null);

function errorText(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  return raw.split("\n")[0].trim() || fallback;
}

function KeyRow({
  source,
  now,
  me,
  onChanged,
}: {
  source: SourceStatus;
  now: number;
  me: string;
  onChanged: () => Promise<void> | void;
}) {
  const saveKey = useAction(api.ceo.hours.saveKey);
  const keyExpiry = useAction(api.ceo.hours.keyExpiry);
  const id = useId();
  const name = PROVIDER_NAME[source.provider];
  const chip = SOURCE_CHIP[source.state];
  const [replacing, setReplacing] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [dateOpen, setDateOpen] = useState(false);
  const [expires, setExpires] = useState(source.key?.expiresOn ?? "");

  const lastOk = at(source.lastOkAt);
  const sentence = sourceSentence(source, {
    ago: lastOk ? relative(lastOk, now) : undefined,
    expires: source.key?.expiresOn
      ? shortDate(source.key.expiresOn)
      : undefined,
  });
  const showField = replacing || NEEDS_KEY.has(source.state);
  const k = source.key;
  const savedAt = at(k?.savedAt);
  const who = k?.savedBy && me && k.savedBy === me ? " by you" : "";

  const save = async () => {
    setBusy(true);
    setResult(null);
    try {
      const out = (await saveKey({
        provider: source.provider,
        key,
      })) as SaveKeyResult;
      setResult({ ok: out.ok, text: out.text });
      if (out.ok) {
        setKey("");
        setReplacing(false);
        await onChanged();
      }
    } catch (e) {
      setResult({
        ok: false,
        text: errorText(e, `${name} refused this key. Nothing was changed.`),
      });
    } finally {
      setBusy(false);
    }
  };

  const saveDate = async () => {
    setBusy(true);
    setResult(null);
    try {
      await keyExpiry({ provider: source.provider, expiresOn: expires });
      setDateOpen(false);
      setResult({ ok: true, text: "Date saved." });
      await onChanged();
    } catch (e) {
      setResult({ ok: false, text: errorText(e, "The date was not saved.") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-2 py-3 @2xl:grid-cols-[8rem_minmax(0,1fr)] @2xl:gap-x-4">
      <div className="flex items-center gap-2 @2xl:block">
        <p className="text-sm font-semibold">{name}</p>
        <StatusChip
          tone={chip.tone}
          label={chip.label}
          className="@2xl:mt-1.5"
        />
      </div>
      <div className="grid min-w-0 gap-1.5">
        {k ? (
          <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            <span>
              Key ending{" "}
              <span className="font-mono font-medium text-foreground">
                {k.last4}
              </span>
            </span>
            {savedAt ? (
              <span>{`· saved ${shortDate(kuwaitDay(savedAt))}${who}`}</span>
            ) : null}
            {k.expiresOn ? (
              <span>{`· expires about ${shortDate(k.expiresOn)}`}</span>
            ) : k.kind === "hubstaff_org" ? (
              <span>· no expiry date</span>
            ) : null}
            {/* A personal token renews itself on every read: no end date to record. */}
            {source.provider === "hubstaff" &&
            k.kind !== "hubstaff_personal" ? (
              <button
                type="button"
                onClick={() => setDateOpen(v => !v)}
                aria-expanded={dateOpen}
                className="font-medium text-foreground/80 underline-offset-2 hover:underline"
              >
                {dateOpen
                  ? "Close"
                  : k.expiresOn
                    ? "Change date"
                    : "Add an expiry date"}
              </button>
            ) : null}
          </p>
        ) : null}
        {source.lastRunAt || source.accounts ? (
          <p className="text-xs text-muted-foreground">
            {[
              lastOk ? `Last read ${relative(lastOk, now)}` : null,
              source.accounts
                ? `${count(source.accounts)} ${source.provider === "hubstaff" ? (source.accounts === 1 ? "person" : "people") : source.accounts === 1 ? "user" : "users"}`
                : null,
              source.unlinked
                ? `${count(source.unlinked)} not linked yet`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : null}
        {sentence && source.state !== "connected" ? (
          <p className="max-w-prose text-sm leading-6">{sentence}</p>
        ) : null}
        {dateOpen && k?.kind !== "hubstaff_personal" ? (
          <div className="flex flex-wrap items-center gap-2">
            <DateInput
              value={expires}
              onChange={e => setExpires(e.target.value)}
              aria-label={`${name} key expires on`}
              className="ceo-select-sm w-40"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || !expires}
              onClick={saveDate}
            >
              Save date
            </Button>
            <span className="text-xs text-muted-foreground">
              Optional. Only for a token made with an end date in Hubstaff: this
              card reminds you two weeks before.
            </span>
          </div>
        ) : null}
        {showField ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={e => {
              e.preventDefault();
              if (key.trim() && !busy) void save();
            }}
          >
            <label htmlFor={`${id}-key`} className="sr-only">
              {`${name} key`}
            </label>
            <input
              id={`${id}-key`}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={e => setKey(e.target.value)}
              placeholder={
                source.provider === "hubstaff"
                  ? "Paste the Hubstaff token"
                  : "Paste the Timetastic token"
              }
              className="h-9 min-w-0 flex-1 basis-56 rounded-md border bg-background px-3 font-mono text-sm"
            />
            <Button type="submit" size="sm" disabled={busy || !key.trim()}>
              {busy ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden />
                  Checking…
                </>
              ) : (
                <>
                  <KeyRound aria-hidden />
                  Save key
                </>
              )}
            </Button>
            {replacing ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setReplacing(false);
                  setKey("");
                }}
              >
                Cancel
              </Button>
            ) : null}
          </form>
        ) : k ? (
          <div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setResult(null);
                setReplacing(true);
              }}
            >
              Replace key
            </Button>
          </div>
        ) : null}
        <p
          aria-live="polite"
          className={
            result
              ? `text-sm ${result.ok ? "text-foreground" : "text-[var(--ceo-critical)]"}`
              : "sr-only"
          }
        >
          {result?.text ?? ""}
        </p>
      </div>
    </div>
  );
}

export function ConnectionsCard({
  status,
  error,
  now,
  onChanged,
  order = 1,
}: {
  status: HoursStatus | null;
  error: string | null;
  now: number;
  onChanged: () => Promise<void> | void;
  order?: number;
}) {
  const syncNow = useAction(api.ceo.hours.syncNow);
  const { email } = useCockpitAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"doctor" | "recent" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const byProvider = (p: Provider) =>
    status?.sources.find(s => s.provider === p) ?? null;
  const hub = byProvider("hubstaff");
  const tt = byProvider("timetastic");
  const bothWork =
    hub?.state === "connected" && tt?.state === "connected" && !error;
  const folded = bothWork && !open;
  const noKeys =
    !!status && status.sources.every(s => s.state === "missing_key");
  const lastRead = [hub?.lastOkAt, tt?.lastOkAt]
    .map(at)
    .filter((v): v is number => v !== null);
  const oldest = lastRead.length ? Math.min(...lastRead) : null;

  const run = async (mode: "doctor" | "recent") => {
    setBusy(mode);
    setMsg(null);
    try {
      const out = (await syncNow({ mode })) as SyncResult;
      if (out.ok) {
        setMsg({
          ok: true,
          text:
            mode === "doctor"
              ? "Checking both connections. This card updates in a minute."
              : "Reading Hubstaff and Timetastic now. It takes about a minute.",
        });
        window.setTimeout(() => void onChanged(), 4000);
      } else {
        const since = at(out.since);
        setMsg({
          ok: true,
          text: `A read is already running${since ? ` (started ${relative(since, now)})` : ""}. It finishes in about a minute.`,
        });
      }
    } catch (e) {
      setMsg({
        ok: false,
        text: errorText(e, "The read did not start. Try again in a minute."),
      });
    } finally {
      setBusy(null);
    }
  };

  const actions = (
    <>
      {noKeys ? null : folded ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-expanded={false}
          onClick={() => setOpen(true)}
        >
          Show
        </Button>
      ) : (
        <>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy !== null || !status}
            onClick={() => run("doctor")}
          >
            {busy === "doctor" ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Stethoscope aria-hidden />
            )}
            Check connections
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy !== null || !status}
            onClick={() => run("recent")}
          >
            {busy === "recent" ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <RefreshCw aria-hidden />
            )}
            Sync now
          </Button>
          {bothWork ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-expanded
              onClick={() => setOpen(false)}
            >
              Hide
            </Button>
          ) : null}
        </>
      )}
    </>
  );

  return (
    <SectionCard
      id={CONNECTIONS_ID}
      title="Connections"
      description={
        folded
          ? `Hubstaff and Timetastic connected${oldest ? ` · read ${relative(oldest, now)}` : ""}`
          : "Hubstaff for hours, Timetastic for leave and public holidays. Keys are checked before they replace the old one, and only their last four characters ever come back."
      }
      order={order}
      actions={actions}
      bodyClassName={folded ? "mt-0" : undefined}
    >
      {folded ? null : (
        <div className="grid gap-1">
          {error ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <p className="text-sm text-[var(--ceo-critical)]">{error}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void onChanged()}
              >
                <RefreshCw aria-hidden />
                Try again
              </Button>
            </div>
          ) : !status ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Reading the connections
            </p>
          ) : (
            <div className="divide-y">
              {[hub, tt].map(s =>
                s ? (
                  <KeyRow
                    key={s.provider}
                    source={s}
                    now={now}
                    me={email}
                    onChanged={onChanged}
                  />
                ) : null,
              )}
            </div>
          )}
          {status?.cronScheduled === false && !noKeys ? (
            <p className="text-xs text-muted-foreground">{CRON_MISSING}</p>
          ) : null}
          {msg ? (
            <p
              aria-live="polite"
              className={`text-sm ${msg.ok ? "text-muted-foreground" : "text-[var(--ceo-critical)]"}`}
            >
              {msg.text}
            </p>
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}
