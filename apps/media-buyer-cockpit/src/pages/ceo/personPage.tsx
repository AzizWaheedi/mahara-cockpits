import { useAction } from "convex/react";
import { ArrowLeft, FileText, Loader2, Paperclip, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { CeoTabs } from "@/components/ceo/CeoTabs";
import {
  humanize,
  money,
  month as monthName,
  shortDate,
} from "@/components/ceo/format";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatusChip } from "@/components/ceo/StatusChip";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import { api } from "../../../convex/_generated/api";
import type {
  PersonFile as FileRow,
  Profile,
  Scorecard,
} from "../../../convex/ceo/profiles";
import { Dial } from "./goalsKit";
import { ScorecardPanel } from "./personScorecard";

/**
 * One person, fullscreen.
 *
 * Aziz, 2026-09-22: "I want to be able to open it in full view, the same way
 * in the client's view in the creative director cockpit, where I can open up
 * the whole thing... for every single employee."
 *
 * So it is a page, not a panel: the address carries `?person=7`, the browser's
 * back button works, and the link can be sent to somebody. It lives under
 * Management, which is where the people are, and the payroll roster links into
 * it so a question that starts at a pay line ends on the person.
 *
 * The three grades sit above the tabs because they are the summary. High skill
 * and low will is a different problem from the reverse, and the shape of the
 * three bars says which one this is before a word is read.
 */

// biome-ignore lint/suspicious/noExplicitAny: the roster row as Supabase has it
type Any = Record<string, any>;

const field =
  "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ceo-emphasis)]";
const label = "text-xs font-medium text-muted-foreground";

const PANELS = ["Who they are", "This month", "Every month", "Files"] as const;
type Panel = (typeof PANELS)[number];

/** The person in the address bar, so back works and a link can be shared. */
export function usePersonParam(): [number | null, (id: number | null) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get("person");
  const id = raw && /^\d+$/.test(raw) ? Number(raw) : null;
  const set = useCallback(
    (next: number | null) => {
      setParams(
        prev => {
          const p = new URLSearchParams(prev);
          if (next === null) p.delete("person");
          else p.set("person", String(next));
          return p;
        },
        // Not replace: opening somebody is a place you can come back from.
        { preventScrollReset: false },
      );
    },
    [setParams],
  );
  return [id, set];
}

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
    <label className="grid gap-1.5">
      <span className={label}>{title}</span>
      <textarea
        className={field}
        style={{ minHeight: `${rows * 22 + 20}px` }}
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
    <div className="grid gap-2">
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
      <p className="text-xs text-muted-foreground">{hint}</p>
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
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <AnimatedSelect
          aria-label="What kind of file"
          className="rounded-md border bg-background px-2.5 py-1.5 text-sm"
          value={kind}
          onChange={e => setKind(e.target.value as typeof kind)}
        >
          <option value="cv">CV</option>
          <option value="contract">Contract</option>
          <option value="other">Something else</option>
        </AnimatedSelect>
        <Button asChild variant="outline">
          <label className="relative cursor-pointer">
            {busy ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Paperclip aria-hidden />
            )}
            {busy ? "Saving" : "Add a file"}
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
        </Button>
        <span className="text-xs text-muted-foreground">
          Kept privately. A link you open stops working ten minutes later.
        </span>
      </div>
      {files.length ? (
        <ul className="divide-y">
          {files.map(f => (
            <li
              key={f.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
            >
              <FileText
                className="size-4 shrink-0 text-muted-foreground"
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
                <Trash2 className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          No CV or contract saved yet.
        </p>
      )}
      {error ? (
        <p className="text-sm text-[var(--ceo-critical)]">{error}</p>
      ) : null}
    </div>
  );
}

export function PersonPage({
  personId,
  onBack,
}: {
  personId: number;
  onBack: () => void;
}) {
  const read = useAction(api.ceo.profiles.page);
  const saveProfile = useAction(api.ceo.profiles.saveProfile);
  const [month, setMonth] = useState<string | undefined>(undefined);
  const [panel, setPanel] = useState<Panel>("Who they are");
  const [data, setData] = useState<{
    person: Any | null;
    profile: Profile;
    files: FileRow[];
    scorecard: Scorecard | null;
    months: { month: string; overall: string | null; status: string }[];
  } | null>(null);
  const [form, setForm] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = (await read({ personId, month })) as NonNullable<typeof data>;
      if (!res?.profile)
        throw new Error("That person's file could not be read.");
      setData({ ...res, files: res.files ?? [], months: res.months ?? [] });
      setForm(res.profile);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e).slice(0, 300));
    } finally {
      setBusy(false);
    }
    // The action identity changes every render; the person and the month are
    // what decide whether this has to run again.
  }, [personId, month, read]);

  useEffect(() => {
    void load();
  }, [load]);

  const person = data?.person ?? null;
  const name = String(person?.name ?? "");
  const set = (patch: Partial<Profile>) =>
    setForm(f => (f ? { ...f, ...patch } : f));
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  const cost =
    person?.monthly_cost === null || person?.monthly_cost === undefined
      ? null
      : Number(person.monthly_cost);

  const save = async () => {
    if (!form) return;
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
      setError(String(e instanceof Error ? e.message : e).slice(0, 300));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="@container grid gap-4 lg:gap-6">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All people
      </button>

      <SectionCard
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--ceo-emphasis-wash)] text-base font-semibold text-[var(--ceo-emphasis)]"
              aria-hidden
            >
              {initial}
            </span>
            <span>{name || "This person"}</span>
            {person?.paused_on ? (
              <StatusChip tone="neutral" label="Paused" />
            ) : person?.active === false ? (
              <StatusChip tone="neutral" label="Off the team" />
            ) : null}
            {busy ? (
              <Loader2
                className="size-4 animate-spin text-muted-foreground"
                aria-hidden
              />
            ) : null}
          </span>
        }
        description={[
          person?.role ? String(person.role) : null,
          person?.engagement
            ? person.engagement === "bot"
              ? "Shared account"
              : humanize(String(person.engagement))
            : null,
          cost !== null ? `${money(cost)} a month` : null,
          person?.started_on
            ? `since ${shortDate(String(person.started_on))}`
            : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        order={0}
      >
        <div className="grid gap-6">
          <div className="grid gap-6 @2xl:grid-cols-3">
            <Grade
              name="Skill"
              value={form?.skill ?? null}
              onChange={skill => set({ skill })}
              hint="Can they do the job to the standard, today?"
            />
            <Grade
              name="Will"
              value={form?.will ?? null}
              onChange={will => set({ will })}
              hint="Do they want to, without being pushed?"
            />
            <Grade
              name="Culture fit"
              value={form?.culture ?? null}
              onChange={culture => set({ culture })}
              hint="Would the team be better with more people like them?"
            />
          </div>
          {form ? (
            <Box
              title="Why those three numbers"
              hint="The evidence, so the number means the same thing next month."
              value={form.gradesNote}
              onChange={gradesNote => set({ gradesNote })}
              rows={2}
            />
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" disabled={saving || !form} onClick={save}>
              {saving ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden />
                  Saving
                </>
              ) : (
                "Save the profile"
              )}
            </Button>
            {msg ? <span className="text-sm">{msg}</span> : null}
            {error ? (
              <span className="text-sm text-[var(--ceo-critical)]">
                {error}
              </span>
            ) : null}
            {form?.updatedAt ? (
              <span className="text-xs text-muted-foreground">
                {`Last written ${shortDate(form.updatedAt.slice(0, 10))}${form.updatedBy ? ` by ${form.updatedBy}` : ""}`}
              </span>
            ) : null}
          </div>
        </div>
      </SectionCard>

      <CeoTabs
        tabs={PANELS.map(p => ({ key: p, label: p }))}
        value={panel}
        onChange={setPanel}
        ariaLabel="What to look at for this person"
      />

      {panel === "Who they are" && form ? (
        <SectionCard
          kicker="Private"
          title="Who they are"
          description="Written by Aziz, read by nobody else."
          order={1}
        >
          <div className="grid gap-6">
            <div className="grid gap-6 @3xl:grid-cols-2">
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
            </div>
            <Box
              title="Notes"
              hint="Anything else worth remembering before the next one-to-one."
              value={form.notes}
              onChange={notes => set({ notes })}
              rows={5}
            />
            <div>
              <Button type="button" disabled={saving} onClick={save}>
                {saving ? "Saving" : "Save the profile"}
              </Button>
            </div>
          </div>
        </SectionCard>
      ) : null}

      {panel === "This month" ? (
        <SectionCard
          title="The monthly scorecard"
          description="The working document of the one-to-one."
          order={1}
        >
          <ScorecardPanel
            personId={personId}
            personName={name}
            card={data?.scorecard ?? null}
            months={data?.months ?? []}
            onMonth={setMonth}
            onSaved={() => void load()}
          />
        </SectionCard>
      ) : null}

      {panel === "Every month" ? (
        <SectionCard kicker="Newest first" title="Their months" order={1}>
          {data?.months.length ? (
            <ul className="-mx-2 divide-y">
              {data.months.map(m => (
                <li key={m.month}>
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-center gap-3 rounded-lg px-2 py-3 text-left text-sm hover:bg-muted/40"
                    onClick={() => {
                      setMonth(m.month);
                      setPanel("This month");
                    }}
                  >
                    <span className="font-medium">
                      {monthName(m.month, { long: true, year: true })}
                    </span>
                    {m.overall ? (
                      <StatusChip
                        tone={
                          m.overall === "A"
                            ? "good"
                            : m.overall === "B"
                              ? "warning"
                              : m.overall === "C"
                                ? "serious"
                                : "critical"
                        }
                        label={`Overall ${m.overall}`}
                      />
                    ) : null}
                    <span className="text-xs text-muted-foreground">
                      {m.status === "final" ? "Signed off" : "Draft"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No review has been saved yet. Start this month's on the tab before
              this one.
            </p>
          )}
        </SectionCard>
      ) : null}

      {panel === "Files" ? (
        <SectionCard kicker="Private" title="CV and contract" order={1}>
          <Files
            personId={personId}
            files={data?.files ?? []}
            onChanged={() => void load()}
          />
        </SectionCard>
      ) : null}
    </div>
  );
}
