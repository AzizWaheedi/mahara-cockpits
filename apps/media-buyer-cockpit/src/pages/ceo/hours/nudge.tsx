import { useCallback, useEffect, useState } from "react";
import { relative } from "@/components/ceo/format";
import { useNow } from "@/components/ceo/useCeo";
import { Switch } from "@/components/ui/switch";
import type { NudgeState } from "@/lib/ceoHoursClient";
import { api, useAction } from "@/lib/cockpitApi";
import { cn } from "@/lib/utils";

/**
 * The morning Slack note (A372, the CEO 2026-10-09: "i need to make sure
 * everyone uses them now"): one message to the CEO each morning at 09:05
 * Kuwait listing who was required to track yesterday and did not, by the
 * same rule as "Not tracking now". It ships off; the CEO switches it here.
 * Nobody on the list is messaged.
 */

type Read =
  | { kind: "loading" }
  | { kind: "error"; text: string }
  | { kind: "ok"; state: NudgeState };

function errorText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  return raw.split("\n")[0].trim().replace(/\.+$/, "") || "No answer";
}

/** The switch and its last run, read once and after each change. */
export function useNudge(): {
  read: Read;
  busy: boolean;
  set: (on: boolean) => Promise<void>;
} {
  const get = useAction(api.ceo.hours.nudge);
  const put = useAction(api.ceo.hours.setNudge);
  const [read, setRead] = useState<Read>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setRead({ kind: "ok", state: (await get({})) as NudgeState });
    } catch (e) {
      setRead({ kind: "error", text: errorText(e) });
    }
  }, [get]);
  useEffect(() => {
    void load();
  }, [load]);
  const set = useCallback(
    async (on: boolean) => {
      setBusy(true);
      try {
        setRead({ kind: "ok", state: (await put({ on })) as NudgeState });
      } catch (e) {
        setRead({ kind: "error", text: errorText(e) });
      } finally {
        setBusy(false);
      }
    },
    [put],
  );
  return { read, busy, set };
}

/** The last run in one line: when, and what it said. */
export function lastRunLine(s: NudgeState, now: number): string {
  const last = s.last;
  if (!last?.runAt)
    return s.on ? "No run yet: the first is at 09:05." : "Never run.";
  const when = relative(Date.parse(last.runAt), now);
  if (last.ok === false)
    return `Last run ${when} failed${last.note ? `: ${last.note.replace(/\.+$/, "")}` : ""}.`;
  const said =
    last.note?.replace(/\.+$/, "") ??
    (last.listed === null
      ? null
      : last.listed === 0
        ? "everyone required tracked"
        : `${last.listed} listed`);
  return `Last run ${when}${said ? `: ${said}` : ""}.`;
}

/** What the month view says under "Not tracking now". */
export function sentLine(read: Read): string {
  if (read.kind === "ok" && read.state.on)
    return "Each morning at 09:05 you get a Slack note listing who should have tracked the day before and did not. Nobody on it is messaged.";
  if (read.kind === "ok")
    return "Nothing is sent to anyone. The morning Slack note to you is off; switch it on in People and rules.";
  return "Nothing is sent to anyone.";
}

/** The switch, for People and rules. */
export function MorningNoteSetting() {
  const now = useNow();
  const { read, busy, set } = useNudge();
  const on = read.kind === "ok" && read.state.on;
  return (
    <div className="grid gap-1 rounded-lg border px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <label htmlFor="hours-nudge" className="text-sm">
            Send me a Slack note each morning listing who should track and did
            not
          </label>
          <p className="text-xs text-muted-foreground">
            At 09:05 Kuwait, for the day before: people required to track on a
            working day, not on leave or a holiday, with no Hubstaff time. Only
            you get it.
          </p>
        </div>
        <Switch
          id="hours-nudge"
          checked={on}
          disabled={busy || read.kind !== "ok"}
          onCheckedChange={v => void set(v)}
          aria-label="Send me a Slack note each morning listing who should track and did not"
        />
      </div>
      <p
        aria-live="polite"
        className={cn(
          "text-xs",
          read.kind === "error"
            ? "text-[var(--ceo-critical)]"
            : "text-muted-foreground",
        )}
      >
        {read.kind === "loading"
          ? "Reading the setting"
          : read.kind === "error"
            ? `The setting could not be read: ${read.text}. Nothing is sent while it cannot be read.`
            : `${on ? "On" : "Off"}${read.state.updatedAt && read.state.updatedBy?.includes("@") ? `, switched ${relative(Date.parse(read.state.updatedAt), now)} by ${read.state.updatedBy}` : ""}. ${lastRunLine(read.state, now)}`}
      </p>
    </div>
  );
}
