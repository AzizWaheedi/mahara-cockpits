import { CircleCheck, CircleX, Loader2, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { FormChange, FormCheck } from "@/lib/funnelClient";
import { cn } from "@/lib/utils";

type State =
  | { at: "idle" }
  | { at: "checking" }
  | { at: "checked"; check: FormCheck }
  | { at: "applying"; check: FormCheck }
  | { at: "done"; change: FormChange }
  | { at: "failed"; message: string; check?: FormCheck };

/**
 * Check with Meta, then apply: the one way a form change reaches the client's
 * ads. The check rehearses every creative copy and swap (Meta creates nothing),
 * the button names exactly what will happen, and an ad Meta refused is shown
 * with its reason instead of being sent.
 */
export function ChangeReview({
  verb,
  check,
  apply,
  onDone,
  disabled,
  disabledReason,
}: {
  /** The action's name on its button, e.g. "Publish" or "Switch". */
  verb: string;
  check: () => Promise<FormCheck>;
  /** Apply to the ads the check passed. */
  apply: (adIds: string[]) => Promise<FormChange>;
  onDone: (change: FormChange) => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [state, setState] = useState<State>({ at: "idle" });

  const runCheck = async () => {
    setState({ at: "checking" });
    try {
      setState({ at: "checked", check: await check() });
    } catch (error) {
      setState({ at: "failed", message: messageOf(error) });
    }
  };

  const runApply = async (c: FormCheck) => {
    setState({ at: "applying", check: c });
    try {
      const change = await apply(c.ads.filter(a => a.ok).map(a => a.adId));
      setState({ at: "done", change });
      onDone(change);
    } catch (error) {
      setState({ at: "failed", message: messageOf(error), check: c });
    }
  };

  if (state.at === "done")
    return (
      <p className="flex items-start gap-2 text-sm" role="status">
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-[color:var(--mahara-teal)]" />
        <span>
          {state.change.did}{" "}
          <span className="text-muted-foreground">
            Meta reviews each ad again, usually within minutes.
          </span>
        </span>
      </p>
    );

  const c =
    state.at === "checked" || state.at === "applying" ? state.check : undefined;
  const passed = c?.ads.filter(a => a.ok) ?? [];
  const refused = c?.ads.filter(a => !a.ok) ?? [];

  return (
    <div className="space-y-3">
      {c && (
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="text-sm font-medium">
            {refused.length === 0
              ? `Meta accepted the change for ${passed.length === 1 ? "the ad" : `all ${passed.length} ads`}.`
              : passed.length
                ? `Meta accepted ${passed.length} of ${c.ads.length} ads. The others stay as they are.`
                : "Meta refused the change for every ad. Nothing will be sent."}
          </p>
          <ul className="mt-2 space-y-1.5">
            {c.ads.map(ad => (
              <li key={ad.adId} className="flex items-start gap-2 text-xs">
                {ad.ok ? (
                  <CircleCheck className="mt-px size-3.5 shrink-0 text-[color:var(--mahara-teal)]" />
                ) : (
                  <CircleX className="mt-px size-3.5 shrink-0 text-[color:var(--ceo-serious,#f97316)]" />
                )}
                <span className="min-w-0">
                  <span className="font-medium" dir="auto">
                    {ad.name}
                  </span>
                  {ad.status && ad.status !== "ACTIVE" && (
                    <span className="text-muted-foreground">
                      {" "}
                      · {sentenceCase(ad.status)}
                    </span>
                  )}
                  {ad.why && (
                    <span className="mt-0.5 block text-muted-foreground">
                      {ad.why}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Each ad goes back through Meta's review and its learning restarts,
            so judge the new version after a few days. Likes and comments stay
            on the old version.
          </p>
        </div>
      )}
      {state.at === "failed" && (
        <p className="flex items-start gap-2 text-sm" role="alert">
          <CircleX className="mt-0.5 size-4 shrink-0 text-[color:var(--ceo-serious,#f97316)]" />
          <span>{state.message}</span>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {c && passed.length > 0 ? (
          <Button
            onClick={() => runApply(c)}
            disabled={state.at === "applying" || disabled}
          >
            {state.at === "applying" ? (
              <>
                <Loader2 className="mr-1.5 size-4 animate-spin" />
                Working on Meta…
              </>
            ) : (
              `${verb} to ${passed.length === 1 ? "1 ad" : `${passed.length} ads`}`
            )}
          </Button>
        ) : (
          <Button
            variant={c ? "outline" : "default"}
            onClick={runCheck}
            disabled={state.at === "checking" || disabled}
          >
            {state.at === "checking" ? (
              <>
                <Loader2 className="mr-1.5 size-4 animate-spin" />
                Checking with Meta…
              </>
            ) : state.at === "failed" || c ? (
              <>
                <RotateCcw className="mr-1.5 size-4" />
                Check again
              </>
            ) : (
              "Check with Meta"
            )}
          </Button>
        )}
        {c && passed.length > 0 && state.at !== "applying" && (
          <Button variant="ghost" onClick={runCheck} disabled={disabled}>
            Check again
          </Button>
        )}
        {state.at === "checking" && (
          <span className="text-xs text-muted-foreground">
            Meta rehearses the change on every ad. This can take up to a minute.
          </span>
        )}
        {state.at === "applying" && (
          <span className="text-xs text-muted-foreground">
            Meta is changing each ad. Keep this open until it says done.
          </span>
        )}
        {disabled && disabledReason && (
          <span className={cn("text-xs text-muted-foreground")}>
            {disabledReason}
          </span>
        )}
      </div>
    </div>
  );
}

function sentenceCase(s: string) {
  const t = s.toLowerCase().replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function messageOf(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  return raw || "Meta did not answer. Try again.";
}
