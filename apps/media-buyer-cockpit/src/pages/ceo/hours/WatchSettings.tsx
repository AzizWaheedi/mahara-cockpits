import { ChevronRight, KeyRound, Loader2 } from "lucide-react";
import { type FormEvent, useEffect, useId, useState } from "react";
import { FilterChips } from "@/components/ceo/FilterChips";
import { StatusDot, type StatusTone } from "@/components/ceo/StatusChip";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  type WatchSettings as Settings,
  WATCH_BOUNDS,
  WATCH_CHANNEL,
  WATCH_FIELDS,
  type WatchAiProvider,
  type WatchBoard,
  type WatchKeyResult,
  type WatchNumberKey,
} from "@/types/ceo/hoursWatch";
import { aiName, aiSentence, KEY_PROVIDER_FIRST } from "./watchCopy";

/**
 * Hubstaff watch's settings, in a sheet: the two switches (saved at once),
 * the thresholds with plain labels and the server's bounds, the Slack
 * channel, the AI key for the screenshot check (pasted, never shown back),
 * and who is watched, with the way to Team & payroll to change it.
 */

type Draft = Record<WatchNumberKey, string> & {
  channel: string;
  channelName: string;
};

/** minConfidence is typed as a percentage; the rest as they are stored. */
const shown = (key: WatchNumberKey, v: number) =>
  key === "minConfidence" ? String(Math.round(v * 100)) : String(v);
const stored = (key: WatchNumberKey, raw: string) => {
  const v = Number(raw.trim());
  if (raw.trim() === "" || !Number.isFinite(v)) return null;
  return key === "minConfidence" ? Math.round(v) / 100 : v;
};

function draftOf(s: Settings): Draft {
  const out = { channel: s.channel, channelName: s.channelName } as Draft;
  for (const k of Object.keys(WATCH_BOUNDS) as WatchNumberKey[])
    out[k] = shown(k, s[k]);
  return out;
}

/** The fields that changed, checked against the bounds; errors by field. */
export function settingsPatch(
  s: Settings,
  d: Draft,
): { patch: Partial<Settings>; errors: Partial<Record<keyof Draft, string>> } {
  const patch: Partial<Settings> = {};
  const errors: Partial<Record<keyof Draft, string>> = {};
  for (const k of Object.keys(WATCH_BOUNDS) as WatchNumberKey[]) {
    const v = stored(k, d[k]);
    const { min, max } = WATCH_BOUNDS[k];
    if (
      v === null ||
      v < min ||
      v > max ||
      (k === "nonWorkShots" && !Number.isInteger(v))
    ) {
      errors[k] =
        k === "minConfidence"
          ? `Choose ${Math.round(min * 100)} to ${Math.round(max * 100)}.`
          : `Choose ${min} to ${max}.`;
      continue;
    }
    if (v !== s[k]) patch[k] = v;
  }
  const channel = d.channel.trim();
  if (!WATCH_CHANNEL.test(channel))
    errors.channel = "A channel id starts with C or G, like C0B5TL9H370.";
  else if (channel !== s.channel) patch.channel = channel;
  const name = d.channelName.trim().replace(/^#/, "");
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(name))
    errors.channelName = "Lower case, no spaces, like team-management.";
  else if (name !== s.channelName) patch.channelName = name;
  return { patch, errors };
}

const UNIT: Record<WatchNumberKey, string> = {
  notTrackingMinutes: "minutes",
  graceMinutes: "minutes",
  idleFloorPct: "%",
  idleMinutes: "minutes",
  nonWorkShots: "screenshots",
  windowMinutes: "minutes",
  minConfidence: "% sure",
};

const HELP: Partial<Record<WatchNumberKey, string>> = {
  notTrackingMinutes:
    "On shift and past the grace, with Hubstaff off this long, the alert goes out.",
  idleMinutes:
    "Hubstaff's activity arrives up to 20 minutes late, so this window ends 20 minutes ago.",
  minConfidence: "Unclear screenshots never count, however many there are.",
};

function NumberField({
  k,
  label,
  value,
  error,
  onChange,
  disabled,
}: {
  k: WatchNumberKey;
  label: string;
  value: string;
  error?: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const id = useId();
  const { min, max } = WATCH_BOUNDS[k];
  const pct = k === "minConfidence";
  return (
    <div className="grid gap-1 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <label htmlFor={id} className="min-w-0 text-sm">
          {label}
        </label>
        <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <input
            id={id}
            type="number"
            inputMode="numeric"
            min={pct ? Math.round(min * 100) : min}
            max={pct ? Math.round(max * 100) : max}
            step={1}
            value={value}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={e => onChange(e.target.value)}
            className={cn(
              "h-9 w-20 rounded-md border bg-background px-2 text-right text-sm tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              error && "border-[color:var(--ceo-critical)]",
            )}
          />
          <span className="w-[5.5rem]">{UNIT[k]}</span>
        </span>
      </div>
      {error ? (
        <p id={`${id}-error`} className="text-xs text-[var(--ceo-critical)]">
          {error}
        </p>
      ) : HELP[k] ? (
        <p className="text-xs text-muted-foreground">{HELP[k]}</p>
      ) : null}
    </div>
  );
}

function SwitchRow({
  id,
  label,
  help,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  help: string;
  checked: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm">
          {label}
        </label>
        <p className="text-xs text-muted-foreground">{help}</p>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        aria-label={label}
      />
    </div>
  );
}

const AI_TONE: Record<WatchBoard["sources"]["ai"]["state"], StatusTone> = {
  connected: "good",
  missing: "neutral",
  refused: "warning",
  failing: "warning",
};

/**
 * The AI key: state, provider, a password box that is never filled back in.
 * The provider starts on OpenAI, the one the watch tries first.
 */
export function KeyBox({
  board,
  onKey,
}: {
  board: WatchBoard;
  onKey: (a: {
    provider: WatchAiProvider;
    key: string;
  }) => Promise<WatchKeyResult>;
}) {
  const id = useId();
  const ai = board.sources.ai;
  const [provider, setProvider] = useState<WatchAiProvider>(KEY_PROVIDER_FIRST);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const state = aiSentence(ai, "settings");
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!key.trim() || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const out = await onKey({ provider, key });
      setResult({ ok: out.ok, text: out.text });
    } catch (err) {
      setResult({
        ok: false,
        text: err instanceof Error ? err.message : "The key was not saved.",
      });
    } finally {
      // Never kept on screen, whatever happened.
      setKey("");
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-3">
      <p className="flex items-start gap-2 text-sm">
        <span className="mt-1.5">
          <StatusDot tone={AI_TONE[ai.state]} label={ai.state} />
        </span>
        <span className="min-w-0">{state}</span>
      </p>
      <FilterChips
        ariaLabel="Which AI reads the screenshots"
        value={provider}
        onChange={setProvider}
        options={[
          { key: "openai", label: "OpenAI" },
          { key: "google_ai", label: "Google AI" },
        ]}
      />
      <form className="flex flex-wrap items-center gap-2" onSubmit={save}>
        <label htmlFor={`${id}-key`} className="sr-only">
          {`${aiName(provider)} key`}
        </label>
        <input
          id={`${id}-key`}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={key}
          onChange={e => setKey(e.target.value)}
          placeholder={`Paste the ${aiName(provider)} key`}
          className="h-9 min-w-0 flex-1 basis-48 rounded-md border bg-background px-3 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={busy || !key.trim()}
        >
          {busy ? (
            <>
              <Loader2 className="animate-spin" aria-hidden />
              Checking
            </>
          ) : (
            <>
              <KeyRound aria-hidden />
              {ai.state === "missing" ? "Save key" : "Replace key"}
            </>
          )}
        </Button>
      </form>
      <p
        aria-live="polite"
        className={
          result
            ? cn(
                "text-sm",
                result.ok ? "text-foreground" : "text-[var(--ceo-critical)]",
              )
            : "sr-only"
        }
      >
        {result?.text ?? ""}
      </p>
      <p className="text-xs text-muted-foreground">
        The key is checked with one call, then stored on the server. It is never
        shown again, here or anywhere.
      </p>
    </div>
  );
}

/** What each switch says once the server confirms it. */
const SWITCH_SAID = {
  on: ["Slack alerts are on.", "Slack alerts are off."],
  shots: ["The screenshot check is on.", "The screenshot check is off."],
  mention: [
    "Each new alert mentions you, so Slack sends a push.",
    "Alerts no longer mention you.",
  ],
} as const;

/** The switches, each saved at once: Slack alerts, the mention, the screenshot check. */
export function AlertSwitches({
  settings: s,
  disabled,
  onSwitch,
}: {
  settings: Settings;
  disabled: boolean;
  onSwitch: (
    patch: Partial<Pick<Settings, "on" | "shots" | "mention">>,
    said: string,
  ) => void;
}) {
  const flip =
    (k: keyof typeof SWITCH_SAID) =>
    (v: boolean): void =>
      onSwitch({ [k]: v }, SWITCH_SAID[k][v ? 0 : 1]);
  return (
    <div className="divide-y">
      <SwitchRow
        id="hw-on"
        label="Slack alerts"
        help={`Each alert is posted once to #${s.channelName || s.channel}, and answered in its thread when it clears. Off, alerts are still recorded here.`}
        checked={s.on}
        disabled={disabled}
        onChange={flip("on")}
      />
      <SwitchRow
        id="hw-mention"
        label="Mention me in each alert"
        help={
          s.on
            ? "Each new alert starts with your name, so your phone gets a push. Replies in the thread never mention you."
            : "Applies when Slack alerts are on."
        }
        checked={s.mention}
        disabled={disabled}
        onChange={flip("mention")}
      />
      <SwitchRow
        id="hw-shots"
        label="Screenshot check"
        help="Each new Hubstaff screenshot is read once by the AI. Only the ones judged not work are kept, for 90 days. Screenshots never go to Slack."
        checked={s.shots}
        disabled={disabled}
        onChange={flip("shots")}
      />
    </div>
  );
}

export function WatchSettingsSheet({
  open,
  onOpenChange,
  board,
  onSet,
  onKey,
  onGoTeam,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  board: WatchBoard;
  onSet: (patch: Partial<Settings>) => Promise<void>;
  onKey: (a: {
    provider: WatchAiProvider;
    key: string;
  }) => Promise<WatchKeyResult>;
  onGoTeam: () => void;
}) {
  const s = board.settings;
  const [draft, setDraft] = useState<Draft>(() => draftOf(s));
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  // Opening the sheet starts from what the server holds now.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on open only
  useEffect(() => {
    if (open) {
      setDraft(draftOf(s));
      setSaid(null);
    }
  }, [open]);
  const { patch, errors } = settingsPatch(s, draft);
  const changed = Object.keys(patch).length > 0;
  const set = (k: keyof Draft) => (v: string) =>
    setDraft(d => ({ ...d, [k]: v }));
  const run = async (p: Partial<Settings>, done: string) => {
    setBusy(true);
    setSaid(null);
    try {
      await onSet(p);
      setSaid({ ok: true, text: done });
    } catch (e) {
      setSaid({
        ok: false,
        text: e instanceof Error ? e.message : "The change was not saved.",
      });
    } finally {
      setBusy(false);
    }
  };
  const field = (k: WatchNumberKey, label = WATCH_FIELDS[k].label) => (
    <NumberField
      k={k}
      label={label}
      value={draft[k]}
      error={errors[k]}
      onChange={set(k)}
      disabled={busy}
    />
  );
  const windowMinutes = stored("windowMinutes", draft.windowMinutes);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="ceo-root w-full max-w-none overflow-y-auto p-0 sm:max-w-md"
      >
        <div className="grid gap-6 p-4 pb-8 sm:p-6">
          <SheetHeader className="space-y-1 p-0 pr-8 text-left">
            <SheetTitle className="text-lg font-semibold">
              Watch settings
            </SheetTitle>
            <SheetDescription className="text-xs text-muted-foreground">
              Changes apply from the next check, within 5 minutes.
            </SheetDescription>
          </SheetHeader>

          <section aria-labelledby="hw-alerts" className="grid">
            <h3 id="hw-alerts" className="text-sm font-medium">
              Alerts
            </h3>
            <AlertSwitches
              settings={s}
              disabled={busy}
              onSwitch={(patch, done) => void run(patch, done)}
            />
          </section>

          <form
            aria-labelledby="hw-when"
            className="grid"
            onSubmit={e => {
              e.preventDefault();
              if (changed && !Object.keys(errors).length && !busy)
                void run(patch, "Saved. The next check uses it.");
            }}
          >
            <h3 id="hw-when" className="text-sm font-medium">
              When to alert
            </h3>
            <div className="divide-y">
              {field("notTrackingMinutes")}
              {field("graceMinutes")}
              {field("idleFloorPct")}
              {field("idleMinutes")}
              {field(
                "nonWorkShots",
                `Screenshots off work in ${windowMinutes ?? draft.windowMinutes} minutes`,
              )}
              {field("windowMinutes")}
              {field("minConfidence")}
            </div>
            <h3 className="mt-4 text-sm font-medium">Slack channel</h3>
            <div className="grid gap-3 py-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                Channel id
                <input
                  value={draft.channel}
                  onChange={e => set("channel")(e.target.value)}
                  disabled={busy}
                  spellCheck={false}
                  autoComplete="off"
                  aria-invalid={errors.channel ? true : undefined}
                  className="h-9 rounded-md border bg-background px-3 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                {errors.channel ? (
                  <span className="text-xs text-[var(--ceo-critical)]">
                    {errors.channel}
                  </span>
                ) : null}
              </label>
              <label className="grid gap-1 text-sm">
                Channel name
                <input
                  value={draft.channelName}
                  onChange={e => set("channelName")(e.target.value)}
                  disabled={busy}
                  spellCheck={false}
                  autoComplete="off"
                  aria-invalid={errors.channelName ? true : undefined}
                  className="h-9 rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                {errors.channelName ? (
                  <span className="text-xs text-[var(--ceo-critical)]">
                    {errors.channelName}
                  </span>
                ) : null}
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button
                type="submit"
                disabled={!changed || busy || !!Object.keys(errors).length}
              >
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
                Save changes
              </Button>
              <p
                aria-live="polite"
                className={cn(
                  "min-w-0 text-sm",
                  said
                    ? said.ok
                      ? "text-foreground"
                      : "text-[var(--ceo-critical)]"
                    : "text-muted-foreground",
                )}
              >
                {said?.text ?? (changed ? "Not saved yet." : "")}
              </p>
            </div>
          </form>

          <section aria-labelledby="hw-key" className="grid gap-3">
            <h3 id="hw-key" className="text-sm font-medium">
              Screenshot check key
            </h3>
            <KeyBox board={board} onKey={onKey} />
          </section>

          <section aria-labelledby="hw-who" className="grid gap-2">
            <h3 id="hw-who" className="text-sm font-medium">
              Who is watched
            </h3>
            <p className="text-xs text-muted-foreground">
              Everyone who must track time: call centre agents and the media
              buyer unless their terms say otherwise. Only during their shift,
              never on leave or a holiday.
            </p>
            {board.people.length ? (
              <ul className="divide-y">
                {board.people.map(p => (
                  <li
                    key={p.personId}
                    className="flex items-center justify-between gap-3 py-2 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="block truncate">{p.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {p.role ?? "No role"}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {p.screenshotsOn === true
                        ? "Screenshots on"
                        : p.screenshotsOn === false
                          ? "Screenshots off in Hubstaff"
                          : "Screenshots not read"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm">Nobody is watched yet.</p>
            )}
            <div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="-ml-3"
                onClick={onGoTeam}
              >
                Change who tracks in Team & payroll
                <ChevronRight aria-hidden />
              </Button>
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
