import { useAction } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";

type CityOption = { id: string; label: string; color?: string };

let optionsCache: Promise<CityOption[]> | null = null;

/** Dark text on light label colours (Bahrain's yellow), white on the rest. */
function textOn(hex?: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return "#fff";
  const n = Number.parseInt(m[1], 16);
  const lum =
    (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? "#111" : "#fff";
}

/**
 * The campaign card's Advertising Cities on the Ads Management board, shown as
 * tags and edited here; saving writes the whole set to ClickUp. The choices are
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
  const colorOf = (label: string) =>
    options.find(o => o.label === label)?.color ?? "#64748b";

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
    <div className="mt-1 text-[12px]">
      <div className="flex flex-wrap items-center gap-1">
        {current.length ? (
          current.map(c => (
            <span
              key={c}
              className="rounded px-1.5 py-0.5 text-[11px] font-semibold"
              style={{ backgroundColor: colorOf(c), color: textOn(colorOf(c)) }}
            >
              {c}
            </span>
          ))
        ) : (
          <span className="text-muted-foreground">no advertising cities</span>
        )}
        <button
          type="button"
          className="font-semibold text-primary underline"
          onClick={() => setOpen(o => !o)}
        >
          {open ? "Close" : current.length ? "Edit cities" : "Add cities"}
        </button>
      </div>
      {open && (
        <div className="mt-1 w-[min(36rem,85vw)] rounded-md border bg-card p-2 text-foreground shadow-sm">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <input
              className="w-44 rounded border bg-background px-2 py-1"
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
                className="text-muted-foreground underline"
                onClick={() => setPicked([])}
              >
                Clear
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={saveIt}
              className="ml-auto rounded-md border border-teal-400 bg-teal-50 px-2.5 py-1 font-semibold text-teal-800 disabled:opacity-50 dark:bg-teal-950 dark:text-teal-200"
            >
              {busy ? "Saving..." : "Save to ClickUp"}
            </button>
          </div>
          {!options.length ? (
            <p className="text-muted-foreground">
              Loading the board's cities...
            </p>
          ) : (
            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {groups.map(([country, list]) => (
                <div key={country}>
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    {country}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {list.map(o => {
                      const on = picked.includes(o.label);
                      return (
                        <button
                          key={o.id}
                          type="button"
                          onClick={() =>
                            setPicked(p =>
                              on
                                ? p.filter(x => x !== o.label)
                                : [...p, o.label],
                            )
                          }
                          className={`rounded border px-1.5 py-0.5 text-[11px] ${on ? "font-semibold" : "bg-background"}`}
                          style={
                            on
                              ? {
                                  backgroundColor: o.color ?? "#64748b",
                                  borderColor: o.color ?? "#64748b",
                                  color: textOn(o.color),
                                }
                              : undefined
                          }
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
          <p className="mt-2 text-[11px] text-muted-foreground">
            A city that is not in the list: add it as an option on the
            Advertising Cities field in ClickUp and it appears here.
          </p>
        </div>
      )}
    </div>
  );
}
