import {
  ArrowDown,
  ArrowUp,
  CircleAlert,
  History,
  LoaderCircle,
  Plus,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useMemo, useState } from "react";
import {
  StatusChip,
  StatusDot,
  type StatusTone,
} from "@/components/ceo/StatusChip";
import { TaskPanel } from "@/components/tasks/TaskPanel";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  type ClickupPerson,
  OWNER_RULE_WORDS,
  readRequestPeople,
  readTypeVersions,
  restoreRequestType,
  saveRequestType,
  type TypePatch,
  type TypeVersion,
} from "@/lib/requestsAdmin";
import { errorWords } from "@/lib/requestsClient";
import {
  type CatalogField,
  type FieldKind,
  type FieldSpec,
  PRIORITIES,
  type Priority,
  stampWords,
  TARGET_LISTS,
  type TargetSpec,
  type TemplateOption,
  type TypePartView,
  type TypesRead,
  type TypeView,
} from "@/lib/requestsCore";
import { useTaskSeat } from "@/lib/taskSeat";
import { cn } from "@/lib/utils";

/*
 * Hallmark · component: request type rows and their editor · genre:
 * modern-minimal (the cockpit's) · theme: the portal's own tokens
 * states: default · hover · focus · active · disabled · loading · error · success
 * pre-emit critique: P4 H4 E4 S4 R3 V4
 *
 * Design plan (CONTRACT.md 6.4, D17): what ClickUp's 26 folder rules used
 * to decide, one row per type an editor can read in a line: the type, then
 * per task "{list}, {owner}" and its SOP chip, the due rule, and an On/Off
 * switch. A press opens the editor in the shared panel, in the order a
 * request travels: name, where each task goes and who owns it, the
 * questions, the SOP, due and priority, Request Type. Save is the one teal
 * button; Versions brings back any earlier save.
 */

const RT_LINE =
  "Off until the rehearsal ticket for this list shows ClickUp does not move it. The writer turns it off by itself if ClickUp moves a task.";
const SAVED = "Saved. The next request uses it.";
const FIELDS_LOCKED =
  "Questions can be reworded, reordered or added here once the database sends each question's ClickUp link with this read. Until then they show as they are.";
const LIMIT = { label: 80, step: 300, steps: 40, url: 500, help: 140 };

const KIND_WORDS: Record<FieldKind, string> = {
  client: "Client card",
  details: "Details",
  text: "Short text",
  longtext: "Long text",
  url: "Link",
  number: "Number",
  select: "Choice",
  deadline: "Due day",
  priority: "Priority",
};

/** "Due in 2 days", working days (Sunday to Thursday). */
export function dueRuleWords(days: number): string {
  if (days <= 0) return "Due the same day";
  return `Due in ${days} day${days === 1 ? "" : "s"}`;
}

/** A part's SOP chip (6.4): Template, n SOP steps, n draft steps, none. */
export function sopChip(part: TypePartView): {
  label: string;
  tone: StatusTone;
} {
  if (part.templateName) return { label: "Template", tone: "good" };
  if (part.stepCount)
    return part.stepsDraft
      ? { label: `${part.stepCount} draft steps`, tone: "warning" }
      : { label: `${part.stepCount} SOP steps`, tone: "good" };
  return { label: "No SOP steps", tone: "warning" };
}

/**
 * A part's "runs when" in words, from the stored targets (editors read
 * them): "when Platform is Meta or TikTok". Null for a part that always
 * runs. Two parts that differ only by this or by their template must not
 * read the same on the type row (D11).
 */
export function partWhenWords(type: TypeView, part: string): string | null {
  const when = type.targets?.find(t => t.part === part)?.when;
  if (!when?.field_key || !when.options?.length) return null;
  const field =
    type.fieldSpecs?.find(f => f.key === when.field_key) ??
    type.fields.find(f => f.key === when.field_key);
  const names = when.options.map(
    id => field?.options?.find(o => o.id === id)?.name ?? id,
  );
  return `when ${field?.label ?? when.field_key} is ${orWords(names)}`;
}

/** "a", "a or b", "a, b or c". */
function orWords(list: string[]): string {
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} or ${list.at(-1)}`;
}

/**
 * Request types (editors): one row per type; the On/Off switch saves at
 * once, a press on the row opens the editor.
 */
export function RequestTypes({
  read,
  onRead,
  reload,
}: {
  read: TypesRead;
  onRead: (data: TypesRead) => void;
  reload: () => Promise<void>;
}) {
  const seat = useTaskSeat();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  // The type and version the editor saved last, so its button says Saved.
  const [saved, setSaved] = useState<{ key: string; version: number } | null>(
    null,
  );
  const open = read.types.find(t => t.key === openKey) ?? null;

  const replace = (next: TypeView) =>
    onRead({
      ...read,
      types: read.types.map(t => (t.key === next.key ? next : t)),
    });

  async function toggle(t: TypeView, on: boolean) {
    if (!seat.client || switching) return;
    setSwitching(t.key);
    try {
      // The switch itself shows the change; only a refusal is said.
      replace(
        await saveRequestType(
          seat.client,
          t.key,
          { enabled: on },
          t.version ?? 1,
        ),
      );
    } catch (e) {
      seat.toast.error(errorWords(e));
      await reload();
    } finally {
      setSwitching(null);
    }
  }

  return (
    <section className="rounded-2xl border bg-card">
      <header className="px-4 pt-4 pb-3 sm:px-6 sm:pt-6">
        <h2 className="text-[15px] font-semibold">Request types</h2>
        <p className="mt-1 max-w-prose text-xs leading-5 text-muted-foreground">
          The {read.types.length} kinds of request the team can raise. Each
          makes its tasks on these lists with these owners. A type that is off
          leaves the form.
        </p>
      </header>
      <ul className="divide-y border-t">
        {read.types.map(t => (
          <li key={t.key} className="flex items-start gap-3 px-4 py-3 sm:px-6">
            <button
              type="button"
              onClick={() => setOpenKey(t.key)}
              className="-mx-2 -my-1 min-w-0 flex-1 rounded-lg px-2 py-1 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-accent"
            >
              <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="font-medium">{t.label}</span>
                <span className="text-[13px] text-muted-foreground">
                  {dueRuleWords(t.dueDays)}
                </span>
              </p>
              <ul className="mt-1 space-y-1">
                {t.parts.map(p => {
                  const chip = sopChip(p);
                  const when = partWhenWords(t, p.part);
                  return (
                    <li
                      key={p.part}
                      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground"
                    >
                      <span className="min-w-0">
                        {p.listName}, {p.ruleLabel}
                        {when ? `, ${when}` : null}
                      </span>
                      <StatusChip tone={chip.tone} label={chip.label} />
                      {p.templateName ? (
                        <bdi dir="auto" className="min-w-0 break-words">
                          {p.templateName}
                        </bdi>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </button>
            <div className="flex shrink-0 items-center gap-2 pt-0.5">
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {t.enabled ? "On" : "Off"}
              </span>
              <Switch
                checked={t.enabled}
                disabled={switching === t.key}
                aria-label={`${t.label}: ${t.enabled ? "on" : "off"}`}
                onCheckedChange={on => void toggle(t, on)}
              />
            </div>
          </li>
        ))}
      </ul>
      {open ? (
        <TypeEditor
          key={`${open.key}:${open.version ?? 0}`}
          type={open}
          read={read}
          justSaved={
            saved?.key === open.key && saved.version === (open.version ?? 0)
          }
          onSaved={next => {
            setSaved({ key: next.key, version: next.version ?? 0 });
            replace(next);
          }}
          onClose={() => setOpenKey(null)}
          reload={reload}
        />
      ) : null}
    </section>
  );
}

type Draft = {
  label: string;
  enabled: boolean;
  targets: TargetSpec[];
  fields: FieldSpec[] | null;
  steps: string[];
  sopUrl: string;
  dueDays: string;
  priority: Priority;
  setRequestType: boolean;
};

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function draftOf(t: TypeView): Draft {
  return {
    label: t.label,
    enabled: t.enabled,
    targets: clone(t.targets ?? []),
    fields: t.fieldSpecs ? clone(t.fieldSpecs) : null,
    steps: [...(t.sopSteps ?? [])],
    sopUrl: t.sopUrl ?? "",
    dueDays: String(t.dueDays),
    priority: t.priority,
    setRequestType: Boolean(t.setRequestType),
  };
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Only the keys that changed (the save refuses any other key). */
export function patchOf(t: TypeView, d: Draft): TypePatch {
  const p: TypePatch = {};
  if (d.label.trim() !== t.label) p.label = d.label.trim();
  if (d.enabled !== t.enabled) p.enabled = d.enabled;
  if (t.targets && !same(d.targets, t.targets)) p.targets = d.targets;
  if (d.fields && t.fieldSpecs && !same(d.fields, t.fieldSpecs))
    p.fields = d.fields;
  const steps = d.steps.map(s => s.trim()).filter(Boolean);
  if (!same(steps, t.sopSteps ?? [])) p.sop_steps = steps.length ? steps : null;
  const url = d.sopUrl.trim() || null;
  if (url !== (t.sopUrl ?? null)) p.sop_url = url;
  if (Number(d.dueDays) !== t.dueDays) p.due_days = Number(d.dueDays);
  if (d.priority !== t.priority) p.priority = d.priority;
  if (d.setRequestType !== Boolean(t.setRequestType))
    p.set_request_type = d.setRequestType;
  return p;
}

/** What the server would refuse, said before it is asked (2.2). */
export function draftProblems(d: Draft): string[] {
  const out: string[] = [];
  const label = d.label.trim();
  if (label.length < 3 || label.length > LIMIT.label)
    out.push("Name: use 3 to 80 characters.");
  const due = Number(d.dueDays);
  if (!/^\d+$/.test(d.dueDays.trim()) || due > 60)
    out.push("Due: a whole number of working days, 0 to 60.");
  const url = d.sopUrl.trim();
  if (url && (!/^https:\/\//.test(url) || url.length > LIMIT.url))
    out.push("SOP link: start it with https:// and keep it to 500 characters.");
  const steps = d.steps.map(s => s.trim()).filter(Boolean);
  if (steps.length > LIMIT.steps) out.push("SOP steps: 40 at most.");
  if (steps.some(s => s.length > LIMIT.step))
    out.push("SOP steps: keep each one to 300 characters.");
  for (const t of d.targets) {
    const list = TARGET_LISTS.find(l => l.listId === t.list_id)?.name ?? t.part;
    if (t.owner_rule === "person" && !t.owner_clickup_id)
      out.push(`${list}: pick the person who owns it.`);
    if (t.when && !t.when.options.length)
      out.push(`${list}: pick at least one answer it runs for.`);
  }
  for (const f of d.fields ?? []) {
    if (!f.label.trim()) out.push("Questions: every question needs words.");
    if ((f.help ?? "").length > LIMIT.help)
      out.push(`${f.label}: keep the hint to 140 characters.`);
    if (f.kind === "select" && !f.clickup_field_id && !(f.options ?? []).length)
      out.push(`${f.label}: give the choice at least one answer.`);
  }
  return [...new Set(out)];
}

/** Every template an editor may pick: the cache, else the ones in use. */
export function templateChoices(read: TypesRead): TemplateOption[] {
  const seen = new Map<string, TemplateOption>();
  for (const t of read.templates ?? [])
    if (t.state !== "missing") seen.set(t.id, t);
  for (const type of read.types)
    for (const p of type.targets ?? [])
      if (p.template_id && p.template_name && !seen.has(p.template_id))
        seen.set(p.template_id, { id: p.template_id, name: p.template_name });
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "q_$1")
    .slice(0, 36) || "question";

/** A cockpit-only choice's answers, with ids the guard accepts. */
export function choiceOptions(names: string[]): { id: string; name: string }[] {
  const taken: string[] = [];
  return names.map(name => {
    const id = uniqueKey(slug(name), taken);
    taken.push(id);
    return { id, name };
  });
}

function uniqueKey(base: string, taken: string[]): string {
  let key = /^[a-z]/.test(base) ? base : `q_${base}`;
  let n = 2;
  while (taken.includes(key)) key = `${base.slice(0, 33)}_${n++}`;
  return key;
}

function TypeEditor({
  type,
  read,
  justSaved,
  onSaved,
  onClose,
  reload,
}: {
  type: TypeView;
  read: TypesRead;
  /** This version was saved from this editor a moment ago. */
  justSaved: boolean;
  onSaved: (t: TypeView) => void;
  onClose: () => void;
  reload: () => Promise<void>;
}) {
  const seat = useTaskSeat();
  const client = seat.client;
  const [draft, setDraft] = useState<Draft>(() => draftOf(type));
  const [people, setPeople] = useState<
    | { status: "loading" }
    | { status: "ready"; people: ClickupPerson[] }
    | { status: "error"; error: string }
  >({ status: "loading" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [versions, setVersions] = useState<
    | null
    | { status: "loading" }
    | { status: "ready"; versions: TypeVersion[] }
    | { status: "error"; error: string }
  >(null);
  const [restoring, setRestoring] = useState<number | null>(null);
  const ids = useId();

  useEffect(() => {
    if (!client) return;
    let live = true;
    readRequestPeople(client)
      .then(r => live && setPeople({ status: "ready", people: r.people }))
      .catch(e => live && setPeople({ status: "error", error: errorWords(e) }));
    return () => {
      live = false;
    };
  }, [client]);

  const patch = useMemo(() => patchOf(type, draft), [type, draft]);
  const dirty = Object.keys(patch).length > 0;
  const problems = useMemo(() => draftProblems(draft), [draft]);
  const templates = useMemo(() => templateChoices(read), [read]);
  const set = (p: Partial<Draft>) => setDraft(d => ({ ...d, ...p }));
  const setTarget = (i: number, p: Partial<TargetSpec>) =>
    setDraft(d => ({
      ...d,
      targets: d.targets.map((t, j) => (j === i ? { ...t, ...p } : t)),
    }));

  async function save() {
    if (!client || saving) return;
    setTried(true);
    setSaveError(null);
    if (problems.length || !dirty) return;
    setSaving(true);
    try {
      const next = await saveRequestType(
        client,
        type.key,
        patch,
        type.version ?? 1,
      );
      seat.toast.success(SAVED);
      onSaved(next);
    } catch (e) {
      setSaveError(errorWords(e));
    } finally {
      setSaving(false);
    }
  }

  async function showVersions() {
    if (!client) return;
    setVersions({ status: "loading" });
    try {
      const r = await readTypeVersions(client, type.key);
      setVersions({ status: "ready", versions: r.versions });
    } catch (e) {
      setVersions({ status: "error", error: errorWords(e) });
    }
  }

  async function restore(v: number) {
    if (!client || restoring) return;
    setRestoring(v);
    setSaveError(null);
    try {
      const next = await restoreRequestType(
        client,
        type.key,
        v,
        type.version ?? 1,
      );
      seat.toast.success(`Back to version ${v}. The next request uses it.`);
      onSaved(next);
    } catch (e) {
      setSaveError(errorWords(e));
    } finally {
      setRestoring(null);
    }
  }

  const peopleList = people.status === "ready" ? people.people : [];
  const personName = (id: number | null) =>
    id
      ? (peopleList.find(p => p.clickupUserId === id)?.label ??
        `ClickUp user ${id}`)
      : null;
  const clash = saveError !== null && /reload/i.test(saveError);

  const footer = (
    <div className="w-full min-w-0 space-y-2">
      {tried && problems.length ? (
        <ul className="space-y-0.5 text-[13px] text-destructive" role="alert">
          {problems.map(p => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
      {saveError ? (
        <div
          className="flex flex-wrap items-center gap-2 text-[13px] text-destructive"
          role="alert"
        >
          <CircleAlert aria-hidden className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">{saveError}</span>
          {clash ? (
            <Button size="sm" variant="outline" onClick={() => void reload()}>
              Reload
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => void (versions ? setVersions(null) : showVersions())}
        >
          <History aria-hidden />
          {versions ? "Hide versions" : "Versions"}
        </Button>
        <Button
          disabled={saving || !dirty}
          aria-busy={saving || undefined}
          onClick={() => void save()}
        >
          {saving ? (
            <LoaderCircle aria-hidden className="animate-spin" />
          ) : null}
          {saving ? "Saving" : !dirty && justSaved ? "Saved" : "Save"}
        </Button>
      </div>
    </div>
  );

  return (
    <TaskPanel
      open
      wide
      onClose={onClose}
      title={type.label}
      subtitle={`${type.teamLabel} · version ${type.version ?? 1}${
        type.updatedByLabel ? ` · saved by ${type.updatedByLabel}` : ""
      }`}
      footer={footer}
    >
      {/* The panel sits outside the page (a portal), so it carries its own
          ceo-root for the status colours. */}
      <div className="ceo-root space-y-8 text-sm">
        {versions ? (
          <Part title="Versions">
            {versions.status === "loading" ? (
              <Waiting text="Reading the versions" />
            ) : versions.status === "error" ? (
              <p className="text-[13px] text-destructive">{versions.error}</p>
            ) : (
              <ul className="divide-y rounded-xl border">
                {versions.versions.map(v => (
                  <li
                    key={v.version}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                  >
                    <div className="min-w-0 text-[13px]">
                      <p className="font-medium">
                        Version {v.version}
                        {v.version === type.version ? (
                          <span className="font-normal text-muted-foreground">
                            {" "}
                            (this one)
                          </span>
                        ) : null}
                      </p>
                      <p className="text-muted-foreground">
                        <span className="font-mono text-xs tabular-nums">
                          {stampWords(v.savedAt)}
                        </span>{" "}
                        by {v.savedByLabel}
                        {v.note ? `. ${v.note}` : ""}
                      </p>
                    </div>
                    {v.version !== type.version ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={restoring !== null}
                        aria-busy={restoring === v.version || undefined}
                        onClick={() => void restore(v.version)}
                      >
                        {restoring === v.version ? (
                          <LoaderCircle aria-hidden className="animate-spin" />
                        ) : null}
                        Go back to version {v.version}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Part>
        ) : null}

        <Part title="Name">
          <Field id={`${ids}-label`} label="Name in the cockpit">
            <input
              id={`${ids}-label`}
              className={INPUT}
              value={draft.label}
              maxLength={LIMIT.label}
              onChange={e => set({ label: e.target.value })}
            />
          </Field>
          {type.clickupOptionName ? (
            <p className="text-[13px] text-muted-foreground">
              In ClickUp: <bdi dir="auto">{type.clickupOptionName.trim()}</bdi>
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-3 text-[13px]">
            <label htmlFor={`${ids}-enabled`}>On the form</label>
            <Switch
              id={`${ids}-enabled`}
              checked={draft.enabled}
              onCheckedChange={on => set({ enabled: on })}
            />
          </div>
        </Part>

        <Part
          title={
            draft.targets.length === 1
              ? "Where it goes"
              : `Where its ${draft.targets.length} tasks go`
          }
        >
          {people.status === "error" ? (
            <p className="text-[13px] text-destructive">{people.error}</p>
          ) : null}
          <ul className="space-y-4">
            {draft.targets.map((t, i) => {
              const whenField = t.when
                ? type.fields.find(f => f.key === t.when?.field_key)
                : null;
              const named = personName(t.owner_clickup_id);
              return (
                <li
                  key={t.part}
                  className="space-y-3 rounded-xl bg-muted/40 p-4"
                >
                  <p className="text-[13px] font-semibold">
                    {type.parts[i]?.listName ??
                      TARGET_LISTS.find(l => l.listId === t.list_id)?.name}
                    {t.name_suffix.trim() ? (
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        ({t.name_suffix.trim().replace(/^\(|\)$/g, "")} task)
                      </span>
                    ) : null}
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field id={`${ids}-list-${i}`} label="List">
                      <select
                        id={`${ids}-list-${i}`}
                        className={INPUT}
                        value={t.list_id}
                        onChange={e => {
                          const l = TARGET_LISTS.find(
                            x => x.listId === e.target.value,
                          );
                          if (l)
                            setTarget(i, { list_id: l.listId, team: l.team });
                        }}
                      >
                        {TARGET_LISTS.map(l => (
                          <option key={l.listId} value={l.listId}>
                            {l.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field id={`${ids}-tpl-${i}`} label="ClickUp template">
                      <select
                        id={`${ids}-tpl-${i}`}
                        className={INPUT}
                        value={t.template_id ?? ""}
                        onChange={e => {
                          const tpl = templates.find(
                            x => x.id === e.target.value,
                          );
                          setTarget(i, {
                            template_id: tpl?.id ?? null,
                            template_name: tpl?.name ?? null,
                          });
                        }}
                      >
                        <option value="">
                          None, add the SOP steps instead
                        </option>
                        {templates.map(x => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field id={`${ids}-rule-${i}`} label="Who owns it">
                      <select
                        id={`${ids}-rule-${i}`}
                        className={INPUT}
                        value={t.owner_rule}
                        onChange={e =>
                          setTarget(i, {
                            owner_rule: e.target
                              .value as TargetSpec["owner_rule"],
                          })
                        }
                      >
                        {(
                          Object.keys(
                            OWNER_RULE_WORDS,
                          ) as TargetSpec["owner_rule"][]
                        ).map(r => (
                          <option key={r} value={r}>
                            {OWNER_RULE_WORDS[r]}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field
                      id={`${ids}-who-${i}`}
                      label={
                        t.owner_rule === "person"
                          ? "The person"
                          : "Named person"
                      }
                    >
                      <select
                        id={`${ids}-who-${i}`}
                        className={INPUT}
                        value={
                          t.owner_clickup_id ? String(t.owner_clickup_id) : ""
                        }
                        disabled={people.status !== "ready"}
                        aria-invalid={
                          tried &&
                          t.owner_rule === "person" &&
                          !t.owner_clickup_id
                            ? true
                            : undefined
                        }
                        onChange={e =>
                          setTarget(i, {
                            owner_clickup_id: e.target.value
                              ? Number(e.target.value)
                              : null,
                          })
                        }
                      >
                        <option value="">
                          {people.status === "loading"
                            ? "Reading the team"
                            : "Nobody named"}
                        </option>
                        {t.owner_clickup_id &&
                        !peopleList.some(
                          p => p.clickupUserId === t.owner_clickup_id,
                        ) ? (
                          <option value={String(t.owner_clickup_id)}>
                            {named}
                          </option>
                        ) : null}
                        {peopleList.map(p => (
                          <option
                            key={p.clickupUserId}
                            value={String(p.clickupUserId)}
                          >
                            {/* The seat's "first name, role" when the person
                                has one, else their ClickUp name. */}
                            {p.seat?.label ?? p.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <p className="text-[13px] text-muted-foreground">
                    {ownerExplain(t, named)}
                  </p>
                  {t.when && whenField ? (
                    <fieldset className="space-y-1.5">
                      <legend className="text-[13px] font-medium">
                        Runs when {whenField.label} is
                      </legend>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {(whenField.options ?? []).map(o => {
                          const on = t.when?.options.includes(o.id) ?? false;
                          return (
                            <label
                              key={o.id}
                              className="flex min-h-8 items-center gap-2 text-[13px]"
                            >
                              <input
                                type="checkbox"
                                className="size-4 accent-[var(--primary)]"
                                checked={on}
                                onChange={e =>
                                  setTarget(i, {
                                    when: {
                                      field_key:
                                        t.when?.field_key ?? whenField.key,
                                      options: e.target.checked
                                        ? [...(t.when?.options ?? []), o.id]
                                        : (t.when?.options ?? []).filter(
                                            x => x !== o.id,
                                          ),
                                    },
                                  })
                                }
                              />
                              {o.name}
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Part>

        <Part title="Questions">
          <Questions
            type={type}
            draft={draft}
            catalog={read.catalog ?? null}
            onChange={fields => set({ fields })}
          />
        </Part>

        <Part title="SOP">
          {type.sopStepsState === "draft" ? (
            <p className="flex items-center gap-2 text-[13px]">
              <StatusDot tone="warning" label="Draft" />
              Draft: check with the systems manager.
            </p>
          ) : null}
          {/* One explanation: where these steps came from, when known, and
              when they are added. */}
          <p className="text-[13px] text-muted-foreground">
            {type.sopStepsState === "source"
              ? "From the template's source task. "
              : ""}
            Added as a checklist to a task made without a template, or when the
            template has no checklist.
          </p>
          <Steps steps={draft.steps} onChange={steps => set({ steps })} />
          <Field
            id={`${ids}-sop`}
            label="SOP link"
            help="Linked in every task's description."
          >
            <input
              id={`${ids}-sop`}
              type="url"
              className={INPUT}
              placeholder="https://"
              value={draft.sopUrl}
              maxLength={LIMIT.url}
              onChange={e => set({ sopUrl: e.target.value })}
            />
          </Field>
        </Part>

        <Part title="Due and priority">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              id={`${ids}-due`}
              label="Due in, working days"
              help="Sunday to Thursday. 0 is the same day."
            >
              <input
                id={`${ids}-due`}
                type="number"
                inputMode="numeric"
                min={0}
                max={60}
                step={1}
                className={cn(INPUT, "tabular-nums")}
                value={draft.dueDays}
                onChange={e => set({ dueDays: e.target.value })}
              />
            </Field>
            <Field id={`${ids}-prio`} label="Priority">
              <select
                id={`${ids}-prio`}
                className={INPUT}
                value={draft.priority}
                onChange={e => set({ priority: e.target.value as Priority })}
              >
                {PRIORITIES.map(p => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Part>

        <Part title="Request Type in ClickUp">
          <div className="flex items-start justify-between gap-3">
            <label htmlFor={`${ids}-rt`} className="min-w-0">
              <span className="block text-[13px] font-medium">
                Set Request Type in ClickUp
              </span>
              <span
                id={`${ids}-rt-line`}
                className="mt-0.5 block text-[13px] text-muted-foreground"
              >
                {RT_LINE}
              </span>
            </label>
            <Switch
              id={`${ids}-rt`}
              checked={draft.setRequestType}
              aria-describedby={`${ids}-rt-line`}
              onCheckedChange={on => set({ setRequestType: on })}
            />
          </div>
        </Part>
      </div>
    </TaskPanel>
  );
}

/** Who gets the task under this rule, in words, with the named person. */
export function ownerExplain(t: TargetSpec, named: string | null): string {
  switch (t.owner_rule) {
    case "person":
      return named
        ? `${named} owns every one.`
        : "Pick the person who owns it.";
    case "systems_manager":
      return named
        ? `${named} first, then whoever holds the systems manager role.`
        : "Whoever holds the systems manager role.";
    case "creative_strategist":
      return named
        ? `${named} first, then whoever holds the creative strategist role.`
        : "Whoever holds the creative strategist role.";
    case "csm_of_card":
      return named
        ? `The CSM named on the client card, then ${named}, then the client success manager.`
        : "The CSM named on the client card, then the client success manager.";
    case "media_buyer_of_record":
      return named
        ? `${named}, the media buyer of record.`
        : "No media buyer of record is set, so the systems manager gets it. Name one here.";
  }
  return "";
}

const INPUT =
  "block h-10 w-full min-w-0 rounded-lg border bg-background px-3 text-sm outline-none transition-colors hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-55 aria-[invalid=true]:border-destructive";

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-[13px] font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function Field({
  id,
  label,
  help,
  children,
}: {
  id: string;
  label: string;
  help?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <label htmlFor={id} className="block text-[13px] font-medium">
        {label}
      </label>
      {children}
      {help ? <p className="text-xs text-muted-foreground">{help}</p> : null}
    </div>
  );
}

function Waiting({ text }: { text: string }) {
  return (
    <p
      className="flex items-center gap-2 text-[13px] text-muted-foreground"
      role="status"
    >
      <LoaderCircle aria-hidden className="size-4 animate-spin" />
      {text}
    </p>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-accent disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4"
    >
      {children}
    </button>
  );
}

const move = <T,>(list: T[], i: number, by: number): T[] => {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

/** SOP steps: one line each; add, reorder, remove. */
function Steps({
  steps,
  onChange,
}: {
  steps: string[];
  onChange: (s: string[]) => void;
}) {
  const base = useId();
  return (
    <div className="space-y-2">
      {steps.length ? (
        <ol className="space-y-1.5">
          {steps.map((s, i) => (
            <li key={`${base}-${i}`} className="flex items-center gap-1.5">
              <span className="w-6 shrink-0 text-right font-mono text-xs text-muted-foreground tabular-nums">
                {i + 1}
              </span>
              <input
                aria-label={`Step ${i + 1}`}
                dir="auto"
                className={INPUT}
                value={s}
                maxLength={LIMIT.step}
                onChange={e =>
                  onChange(steps.map((x, j) => (j === i ? e.target.value : x)))
                }
              />
              <IconButton
                label={`Move step ${i + 1} up`}
                disabled={i === 0}
                onClick={() => onChange(move(steps, i, -1))}
              >
                <ArrowUp aria-hidden />
              </IconButton>
              <IconButton
                label={`Move step ${i + 1} down`}
                disabled={i === steps.length - 1}
                onClick={() => onChange(move(steps, i, 1))}
              >
                <ArrowDown aria-hidden />
              </IconButton>
              <IconButton
                label={`Remove step ${i + 1}`}
                onClick={() => onChange(steps.filter((_, j) => j !== i))}
              >
                <X aria-hidden />
              </IconButton>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-[13px] text-muted-foreground">No SOP steps.</p>
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={steps.length >= LIMIT.steps}
        onClick={() => onChange([...steps, ""])}
      >
        <Plus aria-hidden />
        Add a step
      </Button>
    </div>
  );
}

const OWN_KINDS: { kind: FieldKind; label: string }[] = [
  { kind: "text", label: "Short text" },
  { kind: "longtext", label: "Long text" },
  { kind: "url", label: "Link" },
  { kind: "number", label: "Number" },
  { kind: "select", label: "Choice" },
];

/** The questions: reword, require, reorder, add, remove (6.4). */
function Questions({
  type,
  draft,
  catalog,
  onChange,
}: {
  type: TypeView;
  draft: Draft;
  catalog: CatalogField[] | null;
  onChange: (fields: FieldSpec[]) => void;
}) {
  const base = useId();
  const [adding, setAdding] = useState<string>("");
  const [ownLabel, setOwnLabel] = useState("");
  const [ownKind, setOwnKind] = useState<FieldKind>("text");
  const [ownChoices, setOwnChoices] = useState("");
  const fields = draft.fields;
  const whenKeys = draft.targets.map(t => t.when?.field_key).filter(Boolean);

  if (!fields)
    return (
      <div className="space-y-2">
        <p className="text-[13px] text-muted-foreground">{FIELDS_LOCKED}</p>
        <ul className="divide-y rounded-xl border text-[13px]">
          {type.fields.map(f => (
            <li
              key={f.key}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <span className="min-w-0 break-words">{f.label}</span>
              <span className="shrink-0 text-muted-foreground">
                {KIND_WORDS[f.kind]}
                {f.required ? "" : ", optional"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );

  const used = fields.map(f => f.clickup_field_id).filter(Boolean);
  const addable = (catalog ?? []).filter(
    c => c.state === "ok" && !used.includes(c.clickupFieldId),
  );
  const has = (k: FieldKind) => fields.some(f => f.kind === k);
  const insert = (f: FieldSpec) => {
    const at = fields.findIndex(x => x.kind === "deadline");
    const next = [...fields];
    next.splice(at < 0 ? next.length : at, 0, f);
    onChange(next);
    setAdding("");
    setOwnLabel("");
    setOwnChoices("");
  };
  const keys = fields.map(f => f.key);
  const addPicked = () => {
    if (adding === "client" || adding === "details") {
      insert({
        key: uniqueKey(adding, keys),
        label: adding === "client" ? "Client" : "What is needed?",
        kind: adding,
        clickup_field_id: null,
        required: adding === "client",
        options: null,
        help: null,
      });
      return;
    }
    if (adding === "own") {
      const label = ownLabel.trim();
      if (!label) return;
      const choices = ownChoices
        .split("\n")
        .map(s => s.trim())
        .filter(Boolean);
      insert({
        key: uniqueKey(slug(label), keys),
        label,
        kind: ownKind,
        clickup_field_id: null,
        required: false,
        options: ownKind === "select" ? choiceOptions(choices) : null,
        help: null,
      });
      return;
    }
    const c = addable.find(x => x.clickupFieldId === adding);
    if (!c) return;
    insert({
      key: uniqueKey(slug(c.label), keys),
      label: c.label,
      kind: c.kind,
      clickup_field_id: c.clickupFieldId,
      required: false,
      options: null,
      help: null,
    });
  };

  return (
    <div className="space-y-3">
      <ol className="divide-y rounded-xl border">
        {fields.map((f, i) => {
          const fixed = f.kind === "deadline" || f.kind === "priority";
          const drives = whenKeys.includes(f.key);
          const from = f.clickup_field_id
            ? (catalog?.find(c => c.clickupFieldId === f.clickup_field_id)
                ?.clickupName ?? "ClickUp")
            : null;
          return (
            <li key={f.key} className="space-y-2 p-3">
              <div className="flex items-center gap-1.5">
                <input
                  aria-label={`Question ${i + 1}`}
                  dir="auto"
                  className={INPUT}
                  value={f.label}
                  maxLength={LIMIT.label}
                  onChange={e =>
                    onChange(
                      fields.map((x, j) =>
                        j === i ? { ...x, label: e.target.value } : x,
                      ),
                    )
                  }
                />
                <IconButton
                  label={`Move ${f.label} up`}
                  disabled={i === 0}
                  onClick={() => onChange(move(fields, i, -1))}
                >
                  <ArrowUp aria-hidden />
                </IconButton>
                <IconButton
                  label={`Move ${f.label} down`}
                  disabled={i === fields.length - 1}
                  onClick={() => onChange(move(fields, i, 1))}
                >
                  <ArrowDown aria-hidden />
                </IconButton>
                <IconButton
                  label={`Remove ${f.label}`}
                  disabled={fixed || drives}
                  onClick={() => onChange(fields.filter((_, j) => j !== i))}
                >
                  <X aria-hidden />
                </IconButton>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>
                  {KIND_WORDS[f.kind]}
                  {from
                    ? `, saved to ${from} in ClickUp`
                    : f.kind === "client" || fixed
                      ? ""
                      : ", in the description only"}
                </span>
                {fixed ? null : (
                  <label className="flex min-h-8 items-center gap-1.5 text-foreground">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--primary)]"
                      checked={f.required}
                      onChange={e =>
                        onChange(
                          fields.map((x, j) =>
                            j === i ? { ...x, required: e.target.checked } : x,
                          ),
                        )
                      }
                    />
                    Required
                  </label>
                )}
                {drives ? (
                  <span>Decides which tasks run, so it stays.</span>
                ) : null}
              </div>
              {fixed || f.kind === "client" ? null : (
                <input
                  aria-label={`Hint for ${f.label}`}
                  dir="auto"
                  className={cn(INPUT, "h-9 text-[13px]")}
                  placeholder="A hint under the question (optional)"
                  value={f.help ?? ""}
                  maxLength={LIMIT.help}
                  onChange={e =>
                    onChange(
                      fields.map((x, j) =>
                        j === i
                          ? {
                              ...x,
                              help: e.target.value.trim()
                                ? e.target.value
                                : null,
                            }
                          : x,
                      ),
                    )
                  }
                />
              )}
            </li>
          );
        })}
      </ol>
      <div className="space-y-2 rounded-xl bg-muted/40 p-3">
        <label
          htmlFor={`${base}-add`}
          className="block text-[13px] font-medium"
        >
          Add a question
        </label>
        <select
          id={`${base}-add`}
          className={INPUT}
          value={adding}
          onChange={e => setAdding(e.target.value)}
        >
          <option value="">Pick one</option>
          {has("client") ? null : (
            <option value="client">The client card</option>
          )}
          {has("details") ? null : (
            <option value="details">What is needed (details)</option>
          )}
          {addable.length ? (
            <optgroup label="From the ClickUp fields">
              {addable.map(c => (
                <option key={c.clickupFieldId} value={c.clickupFieldId}>
                  {c.clickupName}
                </option>
              ))}
            </optgroup>
          ) : null}
          <option value="own">A question only the cockpit asks</option>
        </select>
        {catalog === null ? (
          <p className="text-xs text-muted-foreground">
            The ClickUp field list is not in this read, so only cockpit
            questions can be added.
          </p>
        ) : null}
        {adding === "own" ? (
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <input
              aria-label="The question"
              dir="auto"
              className={INPUT}
              placeholder="The question"
              value={ownLabel}
              maxLength={LIMIT.label}
              onChange={e => setOwnLabel(e.target.value)}
            />
            <select
              aria-label="Kind of answer"
              className={INPUT}
              value={ownKind}
              onChange={e => setOwnKind(e.target.value as FieldKind)}
            >
              {OWN_KINDS.map(k => (
                <option key={k.kind} value={k.kind}>
                  {k.label}
                </option>
              ))}
            </select>
            {ownKind === "select" ? (
              <textarea
                aria-label="Choices, one per line"
                dir="auto"
                rows={3}
                placeholder="Choices, one per line"
                className="block w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:col-span-2"
                value={ownChoices}
                onChange={e => setOwnChoices(e.target.value)}
              />
            ) : null}
          </div>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          disabled={!adding || (adding === "own" && !ownLabel.trim())}
          onClick={addPicked}
        >
          <Plus aria-hidden />
          Add it
        </Button>
      </div>
    </div>
  );
}
