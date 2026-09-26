import { useAction } from "convex/react";
import { useState } from "react";
import { dateTime } from "@/components/ceo/format";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "../../../convex/_generated/api";
import type { WebinarRound } from "../../../convex/ceo/payloads";
import {
  inputsToTargets,
  TARGET_FIELDS,
  type TargetEditorState,
  type TargetSelection,
  targetsToInputs,
  type WebinarTargets,
} from "../../../convex/ceo/webinarTargetsModel";

export function WebinarTargetsEditor({
  round,
  onSaved,
}: {
  round: WebinarRound | null;
  onSaved: (scope: string, selection: TargetSelection) => void;
}) {
  const get = useAction(api.ceo.webinarTargets.get);
  const save = useAction(api.ceo.webinarTargets.save);
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState("defaults");
  const [state, setState] = useState<TargetEditorState | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [request, setRequest] = useState<{
    id: string;
    signature: string;
  } | null>(null);
  const canEditRound = round && !["next", "untagged"].includes(round.key);
  async function load(nextScope: string) {
    setScope(nextScope);
    setBusy(true);
    setState(null);
    setError(null);
    setMessage(null);
    setConflict(false);
    setRequest(null);
    try {
      const next = (await get({ scope: nextScope })) as TargetEditorState;
      if (!next?.selection) throw new Error("Unavailable");
      setState(next);
      setInputs(targetsToInputs(next.selection.values));
    } catch {
      setError(
        "Targets could not be loaded. Refresh targets or check the database connection.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!state || busy || conflict) return;
    setError(null);
    setMessage(null);
    let values: WebinarTargets;
    try {
      values = inputsToTargets(inputs);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    const signature = JSON.stringify([scope, state.selection.revision, values]);
    const nextRequest =
      request?.signature === signature
        ? request
        : { id: crypto.randomUUID(), signature };
    setRequest(nextRequest);
    setBusy(true);
    try {
      const result = (await save({
        scope,
        expectedRevision: state.selection.revision,
        values,
        requestId: nextRequest.id,
      })) as TargetEditorState | { conflict: true };
      if ("conflict" in result) {
        setConflict(true);
        setError(
          "Targets changed in another window. Copy any edits you need, then reload the latest targets before saving.",
        );
        return;
      }
      if (!result?.selection) throw new Error("No save receipt");
      setState({
        ...result,
        history: [...result.history, ...state.history].slice(0, 10),
      });
      setInputs(targetsToInputs(result.selection.values));
      setRequest(null);
      onSaved(scope, result.selection);
      setMessage(
        "Targets saved. Campaign budgets and workflows stay unchanged.",
      );
    } catch {
      setError(
        "Save could not be confirmed. Retry the same save, or reload targets to check the saved values.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setOpen(true);
          void load(canEditRound ? `round:${round.key}` : "defaults");
        }}
      >
        Edit targets
      </Button>
      <Dialog
        open={open}
        onOpenChange={next => {
          if (!busy) setOpen(next);
        }}
      >
        <DialogContent
          className="sm:max-w-2xl max-h-[90dvh] flex flex-col overflow-hidden"
          showCloseButton={!busy}
        >
          <DialogHeader>
            <DialogTitle>Edit webinar targets</DialogTitle>
            <DialogDescription>
              Set the plan you want to measure against. Percentages use 0–100;
              money is in USD.
            </DialogDescription>
          </DialogHeader>
          <label className="grid gap-1.5 text-sm font-medium">
            Apply to
            <select
              className="h-10 rounded-md border bg-background px-3 font-normal"
              value={scope}
              disabled={busy}
              onChange={e => void load(e.target.value)}
            >
              {canEditRound && (
                <option value={`round:${round.key}`}>{round.label} only</option>
              )}
              <option value="defaults">Future rounds · defaults</option>
            </select>
          </label>
          <p className="text-xs text-muted-foreground">
            {scope === "defaults"
              ? "Used by rounds that begin collecting data after you save. Earlier rounds keep their original targets."
              : "Changes only this round. Earlier revisions remain in the history below."}
          </p>
          {busy && !state && <p role="status">Loading targets…</p>}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {message && (
            <p role="status" className="text-sm text-primary">
              {message}
            </p>
          )}
          {!state ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void load(scope)}
            >
              Refresh targets
            </Button>
          ) : (
            <form onSubmit={submit} className="flex min-h-0 flex-col gap-3">
              <div className="grid min-h-0 gap-5 overflow-y-auto pr-1">
                {(
                  [
                    "Acquisition",
                    "Conversion",
                    "Sales",
                    "Review thresholds",
                  ] as const
                ).map(group => (
                  <fieldset
                    key={group}
                    disabled={busy}
                    className="grid grid-cols-1 gap-3 border-t pt-4 sm:grid-cols-2"
                  >
                    <legend className="px-1 text-sm font-semibold">
                      {group}
                    </legend>
                    {TARGET_FIELDS.filter(f => f[3] === group).map(
                      ([path, label, unit]) => (
                        <label
                          key={path}
                          htmlFor={`webinar-target-${path}`}
                          className="grid gap-1 text-xs text-muted-foreground"
                        >
                          {label} ({unit})
                          <Input
                            id={`webinar-target-${path}`}
                            inputMode={
                              unit === "people" ? "numeric" : "decimal"
                            }
                            value={inputs[path] ?? ""}
                            onChange={e =>
                              setInputs(prev => ({
                                ...prev,
                                [path]: e.target.value,
                              }))
                            }
                            className="text-foreground tabular-nums"
                          />
                        </label>
                      ),
                    )}
                  </fieldset>
                ))}
                <p className="text-xs text-muted-foreground">
                  Review thresholds only flag performance for review; they never
                  stop an ad automatically.
                </p>
                <details className="text-xs">
                  <summary className="cursor-pointer">
                    Change history{" "}
                    {state.history.length
                      ? `· revision ${state.selection.revision}`
                      : "· no saved changes"}
                  </summary>
                  <ul className="mt-2 grid gap-3">
                    {state.history.map(v => (
                      <li key={v.revision}>
                        <strong>Revision {v.revision}</strong> ·{" "}
                        {dateTime(Date.parse(v.changed_at))} · {v.changed_by}
                        <details className="mt-1">
                          <summary className="cursor-pointer text-muted-foreground">
                            View saved values
                          </summary>
                          <dl className="mt-2 grid gap-1">
                            {TARGET_FIELDS.map(([path, label, unit]) => (
                              <div
                                key={path}
                                className="flex justify-between gap-3"
                              >
                                <dt>{label}</dt>
                                <dd>
                                  {targetsToInputs(v.values)[path]} {unit}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </details>
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t bg-background pt-3">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void load(scope)}
                >
                  {conflict ? "Reload latest targets" : "Reload targets"}
                </Button>
                <Button type="submit" disabled={busy || conflict}>
                  {busy ? "Saving…" : "Save targets"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
