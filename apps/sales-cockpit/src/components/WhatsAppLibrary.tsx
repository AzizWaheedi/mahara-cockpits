import {
  Check,
  Copy,
  MessageSquareText,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useQuery, useSnippets, useTemplates } from "../lib/data";
import { ago } from "../lib/format";
import { toast } from "../lib/toast";
import {
  MOMENTS,
  type Moment,
  type Snippet,
  type TemplateRoute,
} from "../lib/whatsapp";
import {
  button,
  buttonPrimary,
  EmptyState,
  Failed,
  field,
  SectionCard,
  StatusChip,
} from "./kit";

/**
 * The WhatsApp library: the approved templates that reach a lead whose
 * 24-hour window is closed (each sent by its HighLevel workflow), and the
 * team's ready-made messages. Everyone reads it; a manager sets it up.
 */

export interface Workflow {
  id: string;
  name: string;
  status: string;
}

export function useWorkflows(enabled: boolean) {
  return useQuery<Workflow[]>(async () => {
    if (!enabled) return { data: [], error: null };
    try {
      const out = await api<{ workflows: Workflow[] }>("ghl.workflows");
      return { data: out.workflows, error: null };
    } catch (e) {
      return {
        data: null,
        error: { message: String((e as Error).message ?? e) },
      };
    }
  }, [enabled]);
}

const AR_TEMPLATE =
  "هلا {{1}}، معاك {{2}} من مهارة ميديا.\n{{3}}\nإذا حاب نكمل، رد علي هني.";
const EN_TEMPLATE =
  "Hi {{1}}, it's {{2}} from Mahara Media.\n{{3}}\nJust reply here if you'd like to continue.";

export function WhatsAppLibrary({ manager }: { manager: boolean }) {
  const templates = useTemplates();
  const workflows = useWorkflows(manager);
  return (
    <div className="space-y-5">
      <SectionCard title="Templates, for a lead whose window is closed">
        <p className="muted mb-3 text-sm">
          WhatsApp takes a free message only within 24 hours of the lead's own
          last message. After that it takes only a template Meta has approved,
          and HighLevel sends those through a workflow. The cockpit writes the
          line for the lead into their contact, then puts them in the workflow.
          While no template is live here, those leads get email.
        </p>
        {templates.error ? (
          <Failed
            what="The templates"
            error={templates.error}
            retry={templates.reload}
          />
        ) : (
          <ul className="space-y-3">
            {(templates.data ?? []).map(t => (
              <TemplateRow
                key={t.key}
                t={t}
                manager={manager}
                workflows={workflows.data ?? []}
                workflowsError={workflows.error}
                onSaved={templates.reload}
              />
            ))}
          </ul>
        )}
        {manager ? <SetupSteps /> : null}
      </SectionCard>
      <SnippetLibrary manager={manager} />
    </div>
  );
}

function TemplateRow({
  t,
  manager,
  workflows,
  workflowsError,
  onSaved,
}: {
  t: TemplateRoute;
  manager: boolean;
  workflows: Workflow[];
  workflowsError: string | null;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(t);
  const [busy, setBusy] = useState(false);
  const flow = workflows.find(w => w.id === t.workflow_id) ?? null;
  const live = t.active && Boolean(t.workflow_id);

  async function save(next: TemplateRoute) {
    setBusy(true);
    try {
      await api("wa.template.save", { ...next });
      toast.success(next.active ? "Saved. The template is live." : "Saved.");
      setEditing(false);
      onSaved();
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-[var(--radius-md)] border hairline p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            <span dir="ltr">{t.name}</span>
            <StatusChip
              tone={live ? "good" : t.workflow_id ? "neutral" : "warning"}
              label={
                live
                  ? "Live"
                  : t.workflow_id
                    ? "Off"
                    : "Waiting for its workflow"
              }
            />
            <span className="muted text-xs font-normal">
              {t.language === "ar" ? "Arabic" : "English"}
            </span>
          </p>
          <p className="muted mt-0.5 text-xs">{t.purpose}</p>
        </div>
        {manager && !editing ? (
          <button
            type="button"
            onClick={() => {
              setV(t);
              setEditing(true);
            }}
            className={button}
          >
            <Pencil className="size-3.5" aria-hidden /> Set up
          </button>
        ) : null}
      </div>
      <p
        className="mt-2 whitespace-pre-wrap rounded-[var(--radius-md)] bg-[color:var(--secondary)] px-3 py-2 text-sm"
        dir="auto"
      >
        {t.preview}
      </p>
      <p className="muted mt-1 text-[11px]">
        {t.variables
          .map(
            (x, i) =>
              `{{${i + 1}}} ${x === "first_name" ? "their first name" : x === "rep_name" ? "the rep's name" : "the line written for them"}`,
          )
          .join(" · ")}
        {t.workflow_id
          ? ` · sent by ${flow ? `"${flow.name}"${flow.status === "published" ? "" : " (a draft)"}` : "a workflow the cockpit could not read"}`
          : ""}
        {` · changed ${ago(t.updated_at)}`}
      </p>
      {editing ? (
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void save(v);
          }}
          className="mt-3 grid gap-3 border-t hairline pt-3 sm:grid-cols-2"
        >
          <label className="block space-y-1 text-sm sm:col-span-2">
            <span className="muted block text-xs">
              The HighLevel workflow that sends it
            </span>
            {workflowsError ? (
              <span className="block text-xs">
                The workflows could not be read: {workflowsError}
              </span>
            ) : null}
            <select
              value={v.workflow_id ?? ""}
              onChange={e =>
                setV({
                  ...v,
                  workflow_id: e.target.value || null,
                  active: e.target.value ? v.active : false,
                })
              }
              className={field}
            >
              <option value="">Not chosen yet</option>
              {workflows.map(w => (
                <option key={w.id} value={w.id}>
                  {w.name}
                  {w.status === "published" ? "" : " (draft)"}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1 text-sm sm:col-span-2">
            <span className="muted block text-xs">
              The approved text, exactly as HighLevel shows it
            </span>
            <textarea
              value={v.preview}
              onChange={e => setV({ ...v, preview: e.target.value })}
              rows={4}
              className={`${field} h-auto py-2`}
              dir="auto"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="muted block text-xs">Template name</span>
            <input
              value={v.name}
              onChange={e => setV({ ...v, name: e.target.value.trim() })}
              className={field}
              dir="ltr"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="muted block text-xs">What it is for</span>
            <input
              value={v.purpose}
              onChange={e => setV({ ...v, purpose: e.target.value })}
              className={field}
            />
          </label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={v.active}
              disabled={!v.workflow_id}
              onChange={e => setV({ ...v, active: e.target.checked })}
            />
            Live: reps and the follow-up agent send it
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <button type="submit" disabled={busy} className={buttonPrimary}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className={button}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </li>
  );
}

function CopyText({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          window.setTimeout(() => setDone(false), 1500);
        } catch {
          toast.error("The browser would not copy. Select the text instead.");
        }
      }}
      className="muted inline-flex items-center gap-1 text-xs hover:underline"
    >
      {done ? (
        <Check className="size-3" aria-hidden />
      ) : (
        <Copy className="size-3" aria-hidden />
      )}
      {done ? "Copied" : "Copy"}
    </button>
  );
}

/** What a manager does once in HighLevel so the templates can go. */
function SetupSteps() {
  return (
    <div className="mt-4 space-y-3 rounded-[var(--radius-md)] border hairline p-3 text-sm">
      <p className="font-semibold">Setting them up in HighLevel, once</p>
      <ol className="list-decimal space-y-3 ps-5">
        <li>
          Settings, WhatsApp, Templates, New template. Name{" "}
          <code dir="ltr">cockpit_line_ar</code>, category Marketing, language
          Arabic, this text (the sample values Meta asks for: أحمد, سارة, and a
          line such as حبيت أتابع معاك بخصوص طلبك، متى يناسبك نتكلم؟):
          <span className="mt-1 flex items-start gap-2">
            <span
              className="flex-1 whitespace-pre-wrap rounded-[var(--radius-md)] bg-[color:var(--secondary)] px-3 py-2"
              dir="rtl"
            >
              {AR_TEMPLATE}
            </span>
            <CopyText text={AR_TEMPLATE} />
          </span>
          Then <code dir="ltr">cockpit_line_en</code> in English:
          <span className="mt-1 flex items-start gap-2">
            <span className="flex-1 whitespace-pre-wrap rounded-[var(--radius-md)] bg-[color:var(--secondary)] px-3 py-2">
              {EN_TEMPLATE}
            </span>
            <CopyText text={EN_TEMPLATE} />
          </span>
          Meta approves most within the hour.
        </li>
        <li>
          Automation, Workflows, New workflow, named "Cockpit · WhatsApp line
          (Arabic)". No trigger is needed: the cockpit adds the lead. In the
          workflow's settings, turn on Allow re-entry. Add one action: WhatsApp,
          Template, <code dir="ltr">cockpit_line_ar</code>, and fill
          {" {{1}}"} with Contact First Name, {"{{2}}"} with the contact field
          Cockpit rep name, {"{{3}}"} with the contact field Cockpit WhatsApp
          line (the cockpit made both fields). Publish. Then the same for
          English.
        </li>
        <li>
          Here: Set up on each template, pick its workflow, tick Live, Save.
        </li>
      </ol>
      <p className="muted text-xs">
        Until then, a lead whose window is closed gets an email, or nothing
        where email is off for that kind.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ready-made messages
// ---------------------------------------------------------------------------

function SnippetLibrary({ manager }: { manager: boolean }) {
  const snippets = useSnippets();
  const [lang, setLang] = useState<"ar" | "en">("ar");
  const [adding, setAdding] = useState(false);
  const groups = useMemo(
    () =>
      MOMENTS.map(([m, label]) => ({
        moment: m,
        label,
        items: (snippets.data ?? []).filter(
          s => s.moment === m && s.language === lang,
        ),
      })).filter(g => g.items.length),
    [snippets.data, lang],
  );
  return (
    <SectionCard
      title="Ready-made messages"
      side={
        <div className="flex items-center gap-2">
          <div
            className="raised inline-flex rounded-[var(--radius-md)] p-0.5 text-xs"
            role="group"
            aria-label="Language"
          >
            {(
              [
                ["ar", "عربي"],
                ["en", "English"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={lang === k}
                onClick={() => setLang(k)}
                className={`rounded-[calc(var(--radius-md)-2px)] px-2 py-0.5 ${lang === k ? "bg-[color:var(--card)] font-medium shadow-sm" : "muted"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {manager ? (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className={button}
            >
              <Plus className="size-3.5" aria-hidden /> Add
            </button>
          ) : null}
        </div>
      }
    >
      <p className="muted mb-3 text-sm">
        The team's words for the usual moments. In a lead's conversation and the
        dialer, Ready-made puts one in the box with the lead's name and the
        call's day and time filled in. {"{name}"}, {"{rep}"}, {"{day}"} and{" "}
        {"{time}"} are filled in; anything unknown stays for the rep.
      </p>
      {adding ? (
        <SnippetForm
          s={{ moment: "other", language: lang, body: "", sort: 100 }}
          onDone={() => {
            setAdding(false);
            snippets.reload();
          }}
        />
      ) : null}
      {snippets.error ? (
        <Failed
          what="The messages"
          error={snippets.error}
          retry={snippets.reload}
        />
      ) : !groups.length ? (
        <EmptyState
          icon={MessageSquareText}
          title="No messages in this language yet"
          text={
            manager
              ? "Add the ones the team sends most."
              : "A manager adds them here."
          }
        />
      ) : (
        <div className="space-y-4">
          {groups.map(g => (
            <div key={g.moment}>
              <p className="muted mb-1 text-xs">{g.label}</p>
              <ul className="space-y-1.5">
                {g.items.map(s => (
                  <SnippetRow
                    key={s.id}
                    s={s}
                    manager={manager}
                    onChanged={snippets.reload}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function SnippetRow({
  s,
  manager,
  onChanged,
}: {
  s: Snippet;
  manager: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  if (editing)
    return (
      <li>
        <SnippetForm
          s={s}
          onDone={() => {
            setEditing(false);
            onChanged();
          }}
        />
      </li>
    );
  return (
    <li className="flex items-start gap-2 rounded-[var(--radius-md)] border hairline px-3 py-2">
      <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm" dir="auto">
        {s.body}
      </p>
      <CopyText text={s.body} />
      {manager ? (
        <>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="muted text-xs hover:underline"
            aria-label="Edit"
          >
            <Pencil className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api("snippet.delete", { id: s.id });
                toast.success("Removed.");
                onChanged();
              } catch (e) {
                toast.error(String((e as Error).message ?? e));
              } finally {
                setBusy(false);
              }
            }}
            className="muted text-xs hover:underline"
            aria-label="Remove"
          >
            <Trash2 className="size-3.5" aria-hidden />
          </button>
        </>
      ) : null}
    </li>
  );
}

function SnippetForm({
  s,
  onDone,
}: {
  s: Partial<Snippet> & { moment: Moment; language: "ar" | "en" };
  onDone: () => void;
}) {
  const [v, setV] = useState(s);
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("snippet.save", {
        id: v.id,
        moment: v.moment,
        language: v.language,
        body: v.body,
        sort: v.sort ?? 100,
      });
      toast.success("Saved.");
      onDone();
    } catch (err) {
      toast.error(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={save}
      className="mb-3 space-y-2 rounded-[var(--radius-md)] border hairline p-3"
    >
      <div className="flex flex-wrap gap-2">
        <select
          value={v.moment}
          onChange={e => setV({ ...v, moment: e.target.value as Moment })}
          className={`${field} w-auto`}
          aria-label="When it is for"
        >
          {MOMENTS.map(([m, label]) => (
            <option key={m} value={m}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={v.language}
          onChange={e =>
            setV({ ...v, language: e.target.value as "ar" | "en" })
          }
          className={`${field} w-auto`}
          aria-label="Language"
        >
          <option value="ar">Arabic</option>
          <option value="en">English</option>
        </select>
      </div>
      <textarea
        value={v.body ?? ""}
        onChange={e => setV({ ...v, body: e.target.value })}
        rows={3}
        placeholder="هلا {name}، ..."
        className={`${field} h-auto py-2 leading-relaxed`}
        dir="auto"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy || !(v.body ?? "").trim()}
          className={buttonPrimary}
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onDone} className={button}>
          Cancel
        </button>
      </div>
    </form>
  );
}
