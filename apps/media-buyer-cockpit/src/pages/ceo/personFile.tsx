import { useAction } from "convex/react";
import { FileText, Loader2, Paperclip, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { shortDate } from "@/components/ceo/format";
import { StatusChip } from "@/components/ceo/StatusChip";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { api } from "../../../convex/_generated/api";
import type {
  PersonFile as FileRow,
  Profile,
  Scorecard,
} from "../../../convex/ceo/profiles";
import { Dial } from "./goalsKit";
import { ScorecardPanel } from "./personScorecard";

/**
 * One person's file, opened by pressing their name on the roster.
 *
 * Aziz, 2026-09-22: "a profile on each team member. Where I can open it up
 * when I press their name, and I can have their personal goals, professional
 * goals, their red flags and green flags, things to do, things to not do
 * based on their personality, extra notes, a place to save their CV and
 * contract as well... grade them from 1 to 10 on skill, will and culture fit."
 *
 * It opens beside the roster rather than replacing it, so the payroll line a
 * question started from is still on screen. The three grades sit at the top
 * because they are the summary: high skill and low will is a different
 * problem from the reverse, and the shape of the three bars says which one
 * this is before a word is read.
 */

// biome-ignore lint/suspicious/noExplicitAny: the person row is the roster's
type Any = Record<string, any>;

const field =
  "w-full rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ceo-emphasis)]";
const label = "text-xs font-medium text-muted-foreground";
const primary =
  "rounded-md bg-[var(--ceo-emphasis)] px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50";
const quiet =
  "rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50";

function Box({
  title,
  hint,
  value,
  onChange,
  rows = 3,
}: {
  title: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <label className="grid gap-1">
      <span className={label}>{title}</span>
      <textarea
        className={field}
        style={{ minHeight: `${rows * 22 + 16}px` }}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={hint}
      />
    </label>
  );
}

function Grade({
  name,
  value,
  onChange,
  hint,
}: {
  name: string;
  value: number | null;
  onChange: (v: number | null) => void;
  hint: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Dial label={name} value={value} hint={hint} />
      <input
        type="range"
        min={0}
        max={10}
        step={1}
        aria-label={`${name} out of ten`}
        value={value ?? 0}
        onChange={e => {
          const n = Number(e.target.value);
          onChange(n === 0 ? null : n);
        }}
        className="w-full accent-[var(--ceo-emphasis)]"
      />
    </div>
  );
}

function Files({
  personId,
  files,
  onChanged,
}: {
  personId: number;
  files: FileRow[];
  onChanged: () => void;
}) {
  const upload = useAction(api.ceo.profiles.uploadFile);
  const open = useAction(api.ceo.profiles.fileUrl);
  const remove = useAction(api.ceo.profiles.removeFile);
  const [kind, setKind] = useState<"cv" | "contract" | "other">("cv");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onerror = () => reject(new Error("The file could not be read."));
        r.onload = () => resolve(String(r.result ?? "").split(",")[1] ?? "");
        r.readAsDataURL(file);
      });
      await upload({
        personId,
        kind,
        name: file.name,
        mime: file.type || "application/octet-stream",
        base64,
      });
      onChanged();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e).slice(0, 240));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="What kind of file"
          className="rounded-md border bg-background px-2 py-1 text-sm"
          value={kind}
          onChange={e => setKind(e.target.value as typeof kind)}
        >
          <option value="cv">CV</option>
          <option value="contract">Contract</option>
          <option value="other">Something else</option>
        </select>
        <label className={`${quiet} cursor-pointer`}>
          <span className="flex items-center gap-1.5">
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Paperclip className="size-3.5" aria-hidden />
            )}
            {busy ? "Saving" : "Add a file"}
          </span>
          <input
            type="file"
            className="sr-only"
            disabled={busy}
            onChange={e => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void pick(f);
            }}
          />
        </label>
        <span className="text-xs text-muted-foreground">
          Kept privately. Links expire ten minutes after you open one.
        </span>
      </div>
      {files.length ? (
        <ul className="grid gap-1">
          {files.map(f => (
            <li
              key={f.id}
              className="flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5 text-sm"
            >
              <FileText
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left underline underline-offset-2"
                onClick={async () => {
                  try {
                    const { url } = await open({ id: f.id });
                    window.open(url, "_blank", "noopener,noreferrer");
                  } catch (e) {
                    setError(
                      String(e instanceof Error ? e.message : e).slice(0, 200),
                    );
                  }
                }}
              >
                {f.name}
              </button>
              <span className="shrink-0 text-xs text-muted-foreground">
                {`${f.kind === "cv" ? "CV" : f.kind === "contract" ? "Contract" : "File"} · ${shortDate(f.uploadedAt.slice(0, 10))}`}
              </span>
              <button
                type="button"
                aria-label={`Delete ${f.name}`}
                className="text-muted-foreground hover:text-foreground"
                onClick={async () => {
                  await remove({ id: f.id });
                  onChanged();
                }}
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">
          No CV or contract saved yet.
        </p>
      )}
      {error ? (
        <p className="text-sm text-[var(--ceo-critical)]">{error}</p>
      ) : null}
    </div>
  );
}

export function PersonFile({
  personId,
  name,
  onClose,
}: {
  personId: number | null;
  name: string;
  onClose: () => void;
}) {
  const read = useAction(api.ceo.profiles.page);
  const saveProfile = useAction(api.ceo.profiles.saveProfile);
  const [month, setMonth] = useState<string | undefined>(undefined);
  const [data, setData] = useState<{
    person: Any | null;
    profile: Profile;
    files: FileRow[];
    scorecard: Scorecard | null;
    months: { month: string; overall: string | null; status: string }[];
  } | null>(null);
  const [form, setForm] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!personId) return;
    setBusy(true);
    setError(null);
    try {
      const res = (await read({ personId, month })) as NonNullable<typeof data>;
      setData(res);
      setForm(res.profile);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e).slice(0, 300));
    } finally {
      setBusy(false);
    }
    // The action identity changes every render; the person and month are what
    // decide whether this has to run again.
  }, [personId, month, read]);

  useEffect(() => {
    void load();
  }, [load]);

  const person = data?.person ?? null;
  const set = (patch: Partial<Profile>) =>
    setForm(f => (f ? { ...f, ...patch } : f));

  return (
    <Sheet open={personId !== null} onOpenChange={v => !v && onClose()}>
      <SheetContent
        side="right"
        // The sheet renders in a portal at the end of the body, outside the
        // .ceo-root that defines every --ceo-* token, so a grade button styled
        // with one came out transparent. The class comes with it.
        className="ceo-root w-full gap-0 overflow-y-auto p-0 sm:max-w-2xl"
      >
        <SheetHeader className="border-b p-5 pt-safe">
          <SheetTitle className="text-xl">{name}</SheetTitle>
          <SheetDescription asChild>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {person?.role ? <span>{String(person.role)}</span> : null}
              {person?.engagement ? (
                <span>{String(person.engagement)}</span>
              ) : null}
              {person?.started_on ? (
                <span>{`since ${shortDate(String(person.started_on))}`}</span>
              ) : null}
              {person?.paused_on ? (
                <StatusChip tone="neutral" label="Paused" />
              ) : null}
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : null}
            </div>
          </SheetDescription>
        </SheetHeader>

        <div className="grid gap-6 p-5 pb-16">
          {error ? (
            <p className="text-sm text-[var(--ceo-critical)]">{error}</p>
          ) : null}

          {form ? (
            <>
              <section className="grid gap-3">
                <h3 className="text-sm font-semibold">Where they stand</h3>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Grade
                    name="Skill"
                    value={form.skill}
                    onChange={skill => set({ skill })}
                    hint="Can they do the job to the standard, today?"
                  />
                  <Grade
                    name="Will"
                    value={form.will}
                    onChange={will => set({ will })}
                    hint="Do they want to, without being pushed?"
                  />
                  <Grade
                    name="Culture fit"
                    value={form.culture}
                    onChange={culture => set({ culture })}
                    hint="Would the team be better or worse with more people like them?"
                  />
                </div>
                <Box
                  title="Why those three numbers"
                  hint="The evidence, so the number means the same thing next month."
                  value={form.gradesNote}
                  onChange={gradesNote => set({ gradesNote })}
                  rows={2}
                />
              </section>

              <section className="grid gap-3 sm:grid-cols-2">
                <Box
                  title="Personal goals"
                  hint="What they want out of the next year, in their own words."
                  value={form.personalGoals}
                  onChange={personalGoals => set({ personalGoals })}
                />
                <Box
                  title="Professional goals"
                  hint="The role or the skill they are working towards."
                  value={form.professionalGoals}
                  onChange={professionalGoals => set({ professionalGoals })}
                />
                <Box
                  title="Green flags"
                  hint="What they do that you want more of."
                  value={form.greenFlags}
                  onChange={greenFlags => set({ greenFlags })}
                />
                <Box
                  title="Red flags"
                  hint="What you are watching, and what it would mean if it continued."
                  value={form.redFlags}
                  onChange={redFlags => set({ redFlags })}
                />
                <Box
                  title="Do this with them"
                  hint="How to brief, praise and correct this particular person."
                  value={form.doThis}
                  onChange={doThis => set({ doThis })}
                />
                <Box
                  title="Do not do this"
                  hint="What backfires with them, and why."
                  value={form.dontDoThis}
                  onChange={dontDoThis => set({ dontDoThis })}
                />
              </section>

              <Box
                title="Notes"
                hint="Anything else worth remembering before the next one-to-one."
                value={form.notes}
                onChange={notes => set({ notes })}
                rows={4}
              />

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={primary}
                  disabled={saving || !personId}
                  onClick={async () => {
                    if (!personId || !form) return;
                    setSaving(true);
                    setMsg(null);
                    setError(null);
                    try {
                      await saveProfile({
                        personId,
                        personalGoals: form.personalGoals,
                        professionalGoals: form.professionalGoals,
                        greenFlags: form.greenFlags,
                        redFlags: form.redFlags,
                        doThis: form.doThis,
                        dontDoThis: form.dontDoThis,
                        notes: form.notes,
                        skill: form.skill ?? undefined,
                        will: form.will ?? undefined,
                        culture: form.culture ?? undefined,
                        gradesNote: form.gradesNote,
                      });
                      setMsg("Saved.");
                      void load();
                    } catch (e) {
                      setError(
                        String(e instanceof Error ? e.message : e).slice(
                          0,
                          300,
                        ),
                      );
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  {saving ? (
                    <span className="flex items-center gap-1.5">
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      Saving
                    </span>
                  ) : (
                    "Save the profile"
                  )}
                </button>
                {msg ? <span className="text-sm">{msg}</span> : null}
                {form.updatedAt ? (
                  <span className="text-xs text-muted-foreground">
                    {`Last written ${shortDate(form.updatedAt.slice(0, 10))}${form.updatedBy ? ` by ${form.updatedBy}` : ""}`}
                  </span>
                ) : null}
              </div>

              <section className="grid gap-3 border-t pt-5">
                <h3 className="text-sm font-semibold">CV and contract</h3>
                {personId ? (
                  <Files
                    personId={personId}
                    files={data?.files ?? []}
                    onChanged={() => void load()}
                  />
                ) : null}
              </section>

              <section className="grid gap-3 border-t pt-5">
                <h3 className="text-sm font-semibold">
                  The monthly one-to-one
                </h3>
                {personId ? (
                  <ScorecardPanel
                    personId={personId}
                    personName={name}
                    card={data?.scorecard ?? null}
                    months={data?.months ?? []}
                    onMonth={setMonth}
                    onSaved={() => void load()}
                  />
                ) : null}
              </section>
            </>
          ) : busy ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Opening the file
            </p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
