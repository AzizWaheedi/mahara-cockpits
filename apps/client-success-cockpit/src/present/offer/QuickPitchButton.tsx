import { Presentation } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { QuickPitchDialog } from "./CatalogDeckPreview";
import { type OfferKey, offerDeckUrl } from "./kinds";
import {
  type CatalogRow,
  copyOf,
  type OfferClient,
  readCatalog,
} from "./sources";

/** Reads only the catalogue. Task identity is used solely for the separate preparation link. */
export function QuickPitchButton({
  offer,
  taskId,
  client,
  row,
  hold,
}: {
  offer: OfferKey;
  taskId?: string;
  client?: OfferClient | null;
  row?: CatalogRow;
  hold?: string | null;
}) {
  const scope = `${taskId ?? "catalog"}:${offer}`;
  const latest = useRef(scope);
  latest.current = scope;
  const request = useRef(0);
  const [result, setResult] = useState<{
    scope: string;
    row: CatalogRow;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [open, setOpen] = useState(false);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: invalidate requests and UI when the exact preview source changes.
  useEffect(() => {
    request.current++;
    setBusy(false);
    setOpen(false);
    setResult(null);
    setError(null);
  }, [scope, client, row]);
  const show = async () => {
    const id = ++request.current;
    setBusy(true);
    setError(null);
    try {
      const found =
        row ??
        (client
          ? (await readCatalog(client)).rows.find(r => r.offerKey === offer)
          : null);
      if (id !== request.current || scope !== latest.current) return;
      if (
        !found ||
        found.offerKey !== offer ||
        !copyOf(found, "en") ||
        !copyOf(found, "ar")
      )
        throw Error(
          "This deck's approved copy is unavailable. Try again or open preparation.",
        );
      setResult({ scope, row: found });
      setOpen(true);
    } catch (e) {
      if (id === request.current && scope === latest.current)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === request.current && scope === latest.current) setBusy(false);
    }
  };
  return (
    <div className="dkq-quick-action">
      <Button
        variant="outline"
        size="sm"
        disabled={busy || (!row && !client)}
        onClick={() => void show()}
      >
        <Presentation aria-hidden />
        {busy ? "Opening…" : "Quick pitch"}
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {result?.scope === scope ? (
        <QuickPitchDialog
          key={scope}
          row={result.row}
          open={open}
          onOpenChange={setOpen}
          prepareHref={taskId ? offerDeckUrl(taskId, offer, "prep") : undefined}
          hold={hold}
        />
      ) : null}
    </div>
  );
}
