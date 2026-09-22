import { useAction } from "convex/react";
import {
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "@/components/ceo/EmptyState";
import { SectionCard } from "@/components/ceo/SectionCard";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { api } from "../../../convex/_generated/api";

/**
 * The scorecard behind every role, editable.
 *
 * Aziz, 2026-09-22: "I'll give you the scorecard I have for each role. But
 * also give me the ability to edit them if I want to."
 *
 * Six came from his own documents. A role with no scorecard yet — a closer, a
 * B2B setter — gets one written here, and every one-to-one for that role from
 * then on starts from it. Changing a template never touches a month that has
 * already been graded: a scorecard keeps its own copy of what it was graded
 * on.
 */

type Item = {
  key: string;
  accountability: string;
  lookingAt: string[];
  scale: { a: string; b: string; c: string; d: string };
  prompts: string[];
};

type Template = {
  roleKey: string;
  title: string;
  mission: string;
  items: Item[];
  competencies: string[];
  bonus: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
};

const field =
  "w-full rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ceo-emphasis)]";
const label = "text-xs font-medium text-muted-foreground";
const primary =
  "rounded-md bg-[var(--ceo-emphasis)] px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50";
const quiet =
  "rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50";

const blank = (n: number): Item => ({
  key: `item-${n}-${Math.random().toString(36).slice(2, 7)}`,
  accountability: "",
  lookingAt: [],
  scale: { a: "", b: "", c: "", d: "" },
  prompts: [],
});

function Editor({
  template,
  onClose,
  onSaved,
}: {
  template: Template | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const save = useAction(api.ceo.profiles.saveTemplate);
  const [roleKey, setRoleKey] = useState(template?.roleKey ?? "");
  const [title, setTitle] = useState(template?.title ?? "");
  const [mission, setMission] = useState(template?.mission ?? "");
  const [items, setItems] = useState<Item[]>(template?.items ?? [blank(1)]);
  const [bonus, setBonus] = useState(template?.bonus ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = (i: number, next: Partial<Item>) =>
    setItems(x => x.map((y, n) => (n === i ? { ...y, ...next } : y)));
  const move = (i: number, by: number) =>
    setItems(x => {
      const n = i + by;
      if (n < 0 || n >= x.length) return x;
      const out = [...x];
      [out[i], out[n]] = [out[n], out[i]];
      return out;
    });

  return (
    <Sheet open onOpenChange={v => !v && onClose()}>
      <SheetContent
        side="right"
        // The sheet renders in a portal at the end of the body, outside the
        // .ceo-root that defines every --ceo-* token, so a grade button styled
        // with one came out transparent. The class comes with it.
        className="ceo-root w-full gap-0 overflow-y-auto p-0 sm:max-w-2xl"
      >
        <SheetHeader className="border-b p-5 pt-safe">
          <SheetTitle>
            {template ? template.title : "A new role scorecard"}
          </SheetTitle>
          <SheetDescription>
            What gets graded in this role's one-to-one, and what A, B, C and D
            mean for each of them.
          </SheetDescription>
        </SheetHeader>
        <div className="grid gap-5 p-5 pb-16">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1">
              <span className={label}>Role</span>
              <input
                className={field}
                value={title}
                onChange={e => {
                  setTitle(e.target.value);
                  if (!template) setRoleKey(e.target.value);
                }}
                placeholder="Closer"
              />
            </label>
            <label className="grid gap-1">
              <span className={label}>Key</span>
              <input
                className={field}
                value={roleKey}
                disabled={Boolean(template)}
                onChange={e => setRoleKey(e.target.value)}
                placeholder="closer"
              />
            </label>
          </div>
          <label className="grid gap-1">
            <span className={label}>Mission</span>
            <textarea
              className={`${field} min-h-[72px]`}
              value={mission}
              onChange={e => setMission(e.target.value)}
              placeholder="The one paragraph that says what this role is for."
            />
          </label>

          <div className="grid gap-3">
            <p className={label}>{`${items.length} accountabilities`}</p>
            {items.map((it, i) => (
              <div key={it.key} className="grid gap-2 rounded-md border p-3">
                <div className="flex items-start gap-2">
                  <input
                    className={field}
                    aria-label={`Accountability ${i + 1}`}
                    value={it.accountability}
                    onChange={e => patch(i, { accountability: e.target.value })}
                    placeholder="Under 7% client churn in the month"
                  />
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      className={quiet}
                      aria-label="Move up"
                      onClick={() => move(i, -1)}
                    >
                      <ChevronUp className="size-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      className={quiet}
                      aria-label="Move down"
                      onClick={() => move(i, 1)}
                    >
                      <ChevronDown className="size-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      className={quiet}
                      aria-label="Remove"
                      onClick={() => setItems(x => x.filter((_, n) => n !== i))}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  </div>
                </div>
                <label className="grid gap-1">
                  <span className={label}>What we look at, one per line</span>
                  <textarea
                    className={`${field} min-h-[56px]`}
                    value={it.lookingAt.join("\n")}
                    onChange={e =>
                      patch(i, {
                        lookingAt: e.target.value
                          .split("\n")
                          .map(x => x.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(["a", "b", "c", "d"] as const).map(g => (
                    <label key={g} className="grid gap-1">
                      <span className={label}>{g.toUpperCase()}</span>
                      <input
                        className={field}
                        value={it.scale[g]}
                        onChange={e =>
                          patch(i, {
                            scale: { ...it.scale, [g]: e.target.value },
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
                <label className="grid gap-1">
                  <span className={label}>
                    What to collect before the call, one per line
                  </span>
                  <textarea
                    className={`${field} min-h-[56px]`}
                    value={it.prompts.join("\n")}
                    onChange={e =>
                      patch(i, {
                        prompts: e.target.value
                          .split("\n")
                          .map(x => x.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </label>
              </div>
            ))}
            <div>
              <button
                type="button"
                className={quiet}
                onClick={() => setItems(x => [...x, blank(x.length + 1)])}
              >
                <span className="flex items-center gap-1.5">
                  <Plus className="size-3.5" aria-hidden />
                  Add an accountability
                </span>
              </button>
            </div>
          </div>

          <label className="grid gap-1">
            <span className={label}>What qualifies for a bonus</span>
            <input
              className={field}
              value={bonus}
              onChange={e => setBonus(e.target.value)}
              placeholder="To qualify, be managing at least 20 clients."
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={primary}
              disabled={busy || !title.trim() || !roleKey.trim()}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await save({
                    roleKey,
                    title,
                    mission,
                    items: items.filter(i => i.accountability.trim()),
                    competencies: template?.competencies ?? [],
                    bonus,
                  });
                  onSaved();
                  onClose();
                } catch (e) {
                  setError(
                    String(e instanceof Error ? e.message : e).slice(0, 300),
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  Saving
                </span>
              ) : (
                "Save the scorecard"
              )}
            </button>
            <button type="button" className={quiet} onClick={onClose}>
              Close
            </button>
          </div>
          {error ? (
            <p className="text-sm text-[var(--ceo-critical)]">{error}</p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function ScorecardTemplates({ order }: { order?: number }) {
  const read = useAction(api.ceo.profiles.templates);
  const [rows, setRows] = useState<Template[] | null>(null);
  const [open, setOpen] = useState<Template | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows((await read({})) as Template[]);
      setError(null);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e).slice(0, 240));
    }
  }, [read]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SectionCard
      kicker="What gets graded in each role's monthly one-to-one"
      title="Role scorecards"
      order={order}
      actions={
        <button
          type="button"
          className={quiet}
          onClick={() => {
            setOpen(null);
            setAdding(true);
          }}
        >
          <span className="flex items-center gap-1.5">
            <Plus className="size-3.5" aria-hidden />
            New role
          </span>
        </button>
      }
    >
      <div className="grid gap-2">
        {error ? (
          <p className="text-sm text-[var(--ceo-critical)]">{error}</p>
        ) : null}
        {rows === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Reading them
          </p>
        ) : rows.length ? (
          rows.map(t => (
            <button
              key={t.roleKey}
              type="button"
              onClick={() => {
                setAdding(false);
                setOpen(t);
              }}
              className="grid gap-0.5 rounded-md border p-3 text-left hover:bg-muted/40"
            >
              <span className="text-sm font-medium">{t.title}</span>
              <span className="text-xs text-muted-foreground">
                {`${t.items.length} accountabilities${t.updatedAt ? ` · last changed ${t.updatedAt.slice(0, 10)}` : ""}`}
              </span>
              {t.mission ? (
                <span className="line-clamp-2 text-xs text-muted-foreground">
                  {t.mission}
                </span>
              ) : null}
            </button>
          ))
        ) : (
          <EmptyState
            title="No scorecards yet"
            text="Write one per role: what gets graded, and what A, B, C and D mean."
            icon={ClipboardList}
            compact
          />
        )}
      </div>
      {open || adding ? (
        <Editor
          template={open}
          onClose={() => {
            setOpen(null);
            setAdding(false);
          }}
          onSaved={() => void load()}
        />
      ) : null}
    </SectionCard>
  );
}
