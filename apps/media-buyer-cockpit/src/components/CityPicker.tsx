import { useAction } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import { Button } from "./ui/button";

type CityOption = { id: string; label: string; color?: string };

let optionsCache: Promise<CityOption[]> | null = null;

/** A picked city: the cockpit's own selected chip, not ClickUp's label colours. */
const PICKED = "border-primary/40 bg-primary/15 text-foreground";

/**
 * The campaign card's Advertising Cities on the Ads Management board, shown as
 * neutral chips and edited here; saving writes the whole set to ClickUp. The choices are
 * the field's own labels ("KW - Hawalli"), so a new city is added once on the
 * field in ClickUp and appears here. [Aziz, 2026-09-14]
 */
export function CityPicker({
  campaignName,
  cities,
  hasCard,
  taskId,
  clientTag,
}: {
  campaignName: string;
  cities?: string[];
  hasCard: boolean;
  /** For a board card with no campaign row. */
  taskId?: string;
  clientTag?: string;
}) {
  const load = useAction(api.board.advertisingCityOptions);
  const save = useAction(api.board.setAdvertisingCities);
  const [options, setOptions] = useState<CityOption[]>([]);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>(cities ?? []);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!hasCard) return;
    if (!optionsCache)
      optionsCache = load({}).catch(e => {
        optionsCache = null;
        throw e;
      });
    optionsCache.then(setOptions).catch(() => setOptions([]));
  }, [hasCard, load]);

  useEffect(() => {
    if (!open) setPicked(cities ?? []);
  }, [cities, open]);

  const groups = useMemo(() => {
    const out = new Map<string, CityOption[]>();
    const needle = q.trim().toLowerCase();
    for (const o of options) {
      if (needle && !o.label.toLowerCase().includes(needle)) continue;
      const country = o.label.split(" - ")[0] || "Other";
      out.set(country, [...(out.get(country) ?? []), o]);
    }
    return [...out.entries()];
  }, [options, q]);

  if (!hasCard) return null;
  const current = cities ?? [];

  const saveIt = async () => {
    setBusy(true);
    const ordered = options
      .map(o => o.label)
      .filter(label => picked.includes(label));
    try {
      const r = await save({
        campaignName,
        cities: ordered,
        ...(taskId ? { taskId, clientTag } : {}),
      });
      if (r.ok) {
        toast.success(
          ordered.length
            ? `Advertising cities saved on ClickUp: ${ordered.join(", ")}`
            : "Advertising cities cleared on ClickUp.",
        );
        setOpen(false);
      } else toast.error(r.error ?? "ClickUp refused that.");
    } catch (err) {
      toast.error(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted-foreground">Cities</span>
        {current.length ? (
          current.map(c => (
            <span
              key={c}
              className="rounded-full border px-2 py-0.5 text-xs text-foreground"
            >
              {c}
            </span>
          ))
        ) : (
          <span className="text-muted-foreground">none set</span>
        )}
        <button
          type="button"
          className="font-medium text-primary hover:underline"
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
        >
          {open ? "Close" : current.length ? "Edit cities" : "Add cities"}
        </button>
      </div>
      {open && (
        <div className="mt-2 w-full max-w-xl rounded-xl border bg-card p-3 text-foreground">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              className="h-8 w-44 rounded-lg border bg-background px-2 text-sm"
              placeholder="Find a city"
              value={q}
              onChange={e => setQ(e.target.value)}
            />
            <span className="text-muted-foreground">
              {picked.length} picked
            </span>
            {picked.length > 0 && (
              <button
                type="button"
                className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                onClick={() => setPicked([])}
              >
                Clear
              </button>
            )}
            <Button
              size="sm"
              variant="teal"
              disabled={busy}
              onClick={saveIt}
              className="ml-auto text-xs"
            >
              {busy ? "Saving…" : "Save to ClickUp"}
            </Button>
          </div>
          {!options.length ? (
            <p className="text-muted-foreground">Loading the board's cities…</p>
          ) : (
            <div className="max-h-64 space-y-3 overflow-y-auto pr-1">
              {groups.map(([country, list]) => (
                <div key={country}>
                  <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                    {country}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {list.map(o => {
                      const on = picked.includes(o.label);
                      return (
                        <button
                          key={o.id}
                          type="button"
                          aria-pressed={on}
                          onClick={() =>
                            setPicked(p =>
                              on
                                ? p.filter(x => x !== o.label)
                                : [...p, o.label],
                            )
                          }
                          className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${on ? PICKED : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                        >
                          {o.label.split(" - ").slice(1).join(" - ") || o.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            A city that is not in the list: add it as an option on the
            Advertising Cities field in ClickUp and it appears here.
          </p>
        </div>
      )}
    </div>
  );
}
