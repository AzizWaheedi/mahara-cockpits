import type { SupabaseClient } from "@supabase/supabase-js";
import { KeyRound, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { dateTime, shortDate } from "@/components/ceo/format";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatusChip, type StatusTone } from "@/components/ceo/StatusChip";
import { Button } from "@/components/ui/button";
import {
  type FormsKeyProvider,
  type FormsKeyRow,
  type FormsKeysStatus,
  readFormsKeys,
  saveFormsKey,
} from "@/lib/formsKeysClient";

/**
 * "Connections for 1-1 notes" on the CEO's Client success tab (docs/forms/
 * STAGE2-CONTRACT.md 8.7): Fathom for the calls, its webhook, DeepSeek and
 * Anthropic for the drafts. Quiet rows that say what is connected, on the
 * hours card's pattern. A pasted key is checked by the server before it
 * replaces the old one and is kept in the vault; it never comes back, and
 * the paste box never holds it in the page's state: only its last four
 * characters are ever shown.
 */

const CHIP: Record<FormsKeyRow["state"], { tone: StatusTone; label: string }> =
  {
    connected: { tone: "good", label: "Connected" },
    unchecked: { tone: "warning", label: "Saved, not checked" },
    refused: { tone: "critical", label: "Refused" },
    missing: { tone: "neutral", label: "Not connected" },
  };

/** What each key does, before its state. */
const DOES: Partial<Record<FormsKeyRow["provider"], string>> = {
  deepseek: "Drafts the client notes.",
  anthropic:
    "Suggests DEFCON and priority, grades the call and drafts the client's recap.",
};

const ORDER: FormsKeyProvider[] = ["fathom", "deepseek", "anthropic"];
const DAY_MS = 86_400_000;

const clause = (s: string) => s.trim().replace(/\.$/, "");

function errorText(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  return raw.split("\n")[0].trim() || fallback;
}

/** The state in a sentence: the card's own words where 8.7 gives them. */
function sentenceOf(row: FormsKeyRow): string {
  if (row.provider === "anthropic" && row.state === "missing")
    return "Not connected: these drafts are off until a key is pasted here.";
  return row.sentence;
}

function KeyRow({
  row,
  client,
  onChanged,
}: {
  row: FormsKeyRow;
  client: SupabaseClient | null;
  onChanged: () => Promise<void> | void;
}) {
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // Focus follows the control that replaces the one pressed, never the page:
  // Add key opens the paste box at its field; Cancel and a saved key give it
  // back to Add key (Replace key), whose result line below is read out; a
  // refused key keeps it in the field for another paste.
  const [focusTo, setFocusTo] = useState<"field" | "toggle" | null>(null);
  useEffect(() => {
    if (!focusTo) return;
    setFocusTo(null);
    (focusTo === "field" ? field.current : toggle.current)?.focus();
  }, [focusTo]);
  const [has, setHas] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const chip = CHIP[row.state];
  const provider = row.provider as FormsKeyProvider;
  const saved = row.savedAt ? Date.parse(row.savedAt) : null;

  const save = async () => {
    // Read from the field only now; it never sits in the page's state.
    const key = field.current?.value.trim() ?? "";
    if (!key || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const out = await saveFormsKey(client, provider, key);
      setResult({ ok: out.ok, text: out.text });
      if (out.ok) setOpen(false);
      setFocusTo(out.ok ? "toggle" : "field");
    } catch (e) {
      setResult({
        ok: false,
        text: errorText(
          e,
          `${row.label} refused this key. Nothing was changed.`,
        ),
      });
      setFocusTo("field");
    } finally {
      if (field.current) field.current.value = "";
      setHas(false);
      setBusy(false);
      await onChanged();
    }
  };

  return (
    <div className="grid gap-2 py-3 @2xl:grid-cols-[9rem_minmax(0,1fr)] @2xl:gap-x-4">
      <div className="flex items-center gap-2 @2xl:block">
        <p className="text-sm font-semibold">{row.label}</p>
        <StatusChip
          tone={chip.tone}
          label={chip.label}
          className="@2xl:mt-1.5"
        />
      </div>
      <div className="grid min-w-0 gap-1.5">
        {DOES[row.provider] || row.state !== "connected" ? (
          <p className="max-w-prose text-sm leading-6">
            {[
              DOES[row.provider],
              row.state !== "connected" ? sentenceOf(row) : null,
            ]
              .filter(Boolean)
              .join(" ")}
          </p>
        ) : null}
        {row.last4 ? (
          <p className="text-xs text-muted-foreground">
            Key ending{" "}
            <span className="font-mono font-medium text-foreground">
              ····{row.last4}
            </span>
            {saved
              ? `, saved by ${row.savedBy ?? "the server"} on ${shortDate(saved)}.`
              : "."}
          </p>
        ) : null}
        {open ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={e => {
              e.preventDefault();
              void save();
            }}
          >
            <label htmlFor={`${id}-key`} className="sr-only">
              {`${row.label} key`}
            </label>
            <input
              ref={field}
              id={`${id}-key`}
              type="password"
              autoComplete="off"
              spellCheck={false}
              onInput={e => setHas(Boolean(e.currentTarget.value.trim()))}
              placeholder={`Paste the ${row.label} key`}
              className="h-9 min-w-0 flex-1 basis-56 rounded-md border bg-background px-3 font-mono text-sm"
            />
            <Button
              type="submit"
              size="sm"
              // The teal fill hides a teal ring: it sits 2px off, in the
              // teal that holds 3:1 on white.
              className="focus-visible:ring-teal-600 focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-disabled:opacity-50"
              // While it checks it stays focusable (and does nothing), so
              // focus is not dropped before the answer moves it.
              disabled={!busy && !has}
              aria-disabled={busy || undefined}
            >
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
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                if (field.current) field.current.value = "";
                setHas(false);
                setOpen(false);
                setFocusTo("toggle");
              }}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <div>
            <Button
              ref={toggle}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setResult(null);
                setOpen(true);
                setFocusTo("field");
              }}
            >
              {row.last4 ? "Replace key" : "Add key"}
            </Button>
          </div>
        )}
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

/**
 * The webhook, status only: Fathom registers it; nothing to paste here. Not
 * registered, calls still come from the worker's 15-minute read, and from
 * the pull when the notes open only while a Fathom key is saved here (with
 * none, the notes read the store and pull nothing), so the row never says
 * more than the Fathom row above it.
 */
function WebhookRow({ status, now }: { status: FormsKeysStatus; now: number }) {
  const w = status.webhook;
  const last = w.lastDeliveryAt ? Date.parse(w.lastDeliveryAt) : null;
  const recent = last !== null && now - last < DAY_MS;
  const fathom = status.keys.find(k => k.provider === "fathom")?.state;
  const pulls = fathom !== undefined && fathom !== "missing";
  const [tone, label, sentence]: [StatusTone, string, string] = !w.registered
    ? [
        "neutral",
        "Not registered",
        pulls
          ? "Not registered: calls arrive by the 15-minute read and when the notes open."
          : "Not registered: calls arrive by the 15-minute read.",
      ]
    : recent
      ? [
          "good",
          "Delivering",
          `Calls arrive by webhook. Last one ${dateTime(last, now)}.`,
        ]
      : [
          "neutral",
          "Registered",
          "Registered. Nothing delivered in the last day.",
        ];
  const label4 =
    status.keys.find(k => k.provider === "fathom_webhook")?.label ??
    "Fathom webhook";
  return (
    <div className="grid gap-2 py-3 @2xl:grid-cols-[9rem_minmax(0,1fr)] @2xl:gap-x-4">
      <div className="flex items-center gap-2 @2xl:block">
        <p className="text-sm font-semibold">{label4}</p>
        <StatusChip tone={tone} label={label} className="@2xl:mt-1.5" />
      </div>
      <p className="max-w-prose text-sm leading-6">{sentence}</p>
    </div>
  );
}

export function FormsConnections({
  order = 1,
  client: given,
}: {
  order?: number;
  /** The seat's own client; a test passes a stand-in. */
  client?: SupabaseClient | null;
}) {
  const auth = useCockpitAuth();
  const client = given === undefined ? auth.client : given;
  const [status, setStatus] = useState<FormsKeysStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  const load = useCallback(async () => {
    setReading(true);
    try {
      const s = await readFormsKeys(client);
      setStatus(s);
      setError(null);
    } catch (e) {
      setError(errorText(e, "the server did not answer"));
    } finally {
      setReading(false);
    }
  }, [client]);
  useEffect(() => {
    void load();
  }, [load]);

  const now = status ? Date.parse(status.now) : Date.now();
  const rows = ORDER.map(p => status?.keys.find(k => k.provider === p)).filter(
    (r): r is FormsKeyRow => Boolean(r),
  );

  return (
    <SectionCard
      title="Connections for 1-1 notes"
      description="The keys the 1-1 notes use: Fathom for the calls, DeepSeek and Anthropic for the drafts. A key is checked before it replaces the old one, and only its last four characters come back."
      order={order}
    >
      {error ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="text-sm text-[var(--ceo-critical)]">
            {`The connections could not be read: ${clause(error)}.`}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={reading}
            onClick={() => void load()}
          >
            <RefreshCw
              className={reading ? "animate-spin" : undefined}
              aria-hidden
            />
            Read them again
          </Button>
        </div>
      ) : !status ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Reading the connections
        </p>
      ) : (
        <div className="divide-y">
          {rows.slice(0, 1).map(r => (
            <KeyRow key={r.provider} row={r} client={client} onChanged={load} />
          ))}
          <WebhookRow status={status} now={now} />
          {rows.slice(1).map(r => (
            <KeyRow key={r.provider} row={r} client={client} onChanged={load} />
          ))}
        </div>
      )}
    </SectionCard>
  );
}
