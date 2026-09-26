import { ArrowUpRight, ChevronDown, Link2, Plus } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { AssetLibrary } from "../components/AssetPicker";
import {
  button,
  buttonPrimary,
  EmptyState,
  Failed,
  field,
  page,
  SectionCard,
} from "../components/kit";
import { ReferenceAsks, ReferenceList } from "../components/References";
import { api } from "../lib/api";
import { useLinks } from "../lib/data";
import { toast } from "../lib/toast";
import type { Me, SalesLink } from "../lib/types";

/**
 * The kit a rep opens on calls: the deck, the forms, the calculators. Each
 * link opens in a new tab so the cockpit stays where it was. Managers add,
 * edit and hide links; a hidden link is kept, folded away, and can come back.
 */

type Kind = SalesLink["kind"];

const KINDS: { kind: Kind; one: string; heading: string }[] = [
  { kind: "deck", one: "Deck", heading: "Deck" },
  { kind: "form", one: "Form", heading: "Forms" },
  { kind: "calculator", one: "Calculator", heading: "Calculators" },
  { kind: "proof", one: "Proof", heading: "Proof" },
  { kind: "library", one: "Library", heading: "Library" },
  { kind: "script", one: "Script", heading: "Scripts" },
  { kind: "other", one: "Other", heading: "Other" },
];

/** The same rule the server applies (sales-api lib.ts checkLink). */
const HTTPS = /^https:\/\/[^\s]+$/;

const small =
  "inline-flex h-7 items-center justify-center rounded-[var(--radius-md)] border hairline px-2 text-xs font-medium hover:bg-[color:var(--secondary)] disabled:opacity-50";

function kindOf(l: SalesLink): Kind {
  return KINDS.some(k => k.kind === l.kind) ? l.kind : "other";
}

function kindName(kind: Kind): string {
  return KINDS.find(k => k.kind === kind)?.one ?? "Other";
}

function host(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function isHttps(url: string): boolean {
  if (!HTTPS.test(url)) return false;
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

interface Draft {
  label: string;
  url: string;
  kind: Kind;
  note: string;
  sort: string;
}

interface Saved {
  label: string;
  url: string;
  kind: Kind;
  note: string;
  sort: number;
}

const BLANK: Draft = {
  label: "",
  url: "",
  kind: "deck",
  note: "",
  sort: "100",
};

function draftOf(l: SalesLink): Draft {
  return {
    label: l.label,
    url: l.url,
    kind: kindOf(l),
    note: l.note ?? "",
    sort: String(l.sort),
  };
}

export default function LinksPage({ me }: { me: Me }) {
  // "The whole library" from a lead lands here on the assets.
  useEffect(() => {
    if (window.location.hash !== "#assets") return;
    const t = window.setTimeout(
      () =>
        document.getElementById("assets")?.scrollIntoView({ block: "start" }),
      300,
    );
    return () => window.clearTimeout(t);
  }, []);
  const links = useLinks();
  const manager = Boolean(me.manager);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const all = links.data ?? [];
  const live = all.filter(l => l.active);
  const hidden = all.filter(l => !l.active);
  const groups = KINDS.map(k => ({
    ...k,
    items: live.filter(l => kindOf(l) === k.kind),
  })).filter(g => g.items.length);

  async function save(body: Record<string, unknown>, said: string) {
    await api("link.save", body);
    toast.success(said);
    links.reload();
  }

  // Hide and Show send the whole link back: the server reads a missing
  // `active` as true, and checks the name and address on every save.
  async function setActive(l: SalesLink, active: boolean) {
    setBusy(l.id);
    try {
      await save(
        {
          id: l.id,
          label: l.label,
          url: l.url,
          kind: l.kind,
          note: l.note ?? "",
          sort: l.sort,
          active,
        },
        active
          ? `${l.label} is back on the list.`
          : `${l.label} is hidden. Show it again from Hidden links.`,
      );
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
    } finally {
      setBusy(null);
    }
  }

  const addButton = (
    <button
      type="button"
      className={buttonPrimary}
      onClick={() => setAdding(true)}
    >
      <Plus className="size-4" aria-hidden />
      Add a link
    </button>
  );

  let body: ReactNode;
  if (links.error)
    body = <Failed what="The links" error={links.error} retry={links.reload} />;
  else if (!links.data)
    body = <p className="muted text-sm">Reading the links…</p>;
  else if (groups.length)
    body = (
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 lg:gap-6">
        {groups.map(g => (
          <SectionCard key={g.kind} title={g.heading} flush>
            <ul className="divide-y hairline">
              {g.items.map(l =>
                editing === l.id ? (
                  <li key={l.id} className="p-4">
                    <LinkForm
                      initial={draftOf(l)}
                      submit="Save link"
                      onCancel={() => setEditing(null)}
                      onSave={async d => {
                        await save(
                          { id: l.id, ...d, active: l.active },
                          `${d.label} saved.`,
                        );
                        setEditing(null);
                      }}
                    />
                  </li>
                ) : (
                  <LinkRow
                    key={l.id}
                    link={l}
                    manager={manager}
                    busy={busy === l.id}
                    onEdit={() => setEditing(l.id)}
                    onHide={() => setActive(l, false)}
                  />
                ),
              )}
            </ul>
          </SectionCard>
        ))}
      </div>
    );
  else
    body = (
      <section className="panel">
        <EmptyState
          icon={Link2}
          title="No links yet"
          text={
            manager
              ? "Add the deck, the forms and the calculators the team opens on calls."
              : "A sales manager adds the deck, the forms and the calculators here."
          }
          action={manager && !adding ? addButton : undefined}
        />
      </section>
    );

  return (
    <main className={page}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Links</h1>
          <p className="muted mt-1 text-sm">
            The deck, forms and calculators for your calls, and the proof to
            send after them.
          </p>
        </div>
        {manager && !adding ? addButton : null}
      </header>

      {manager && adding ? (
        <SectionCard title="Add a link">
          <LinkForm
            initial={BLANK}
            submit="Add link"
            onCancel={() => setAdding(false)}
            onSave={async d => {
              await save({ ...d }, `${d.label} added.`);
              setAdding(false);
            }}
          />
        </SectionCard>
      ) : null}

      {body}

      {manager && hidden.length ? (
        <HiddenLinks
          links={hidden}
          busy={busy}
          onShow={l => setActive(l, true)}
        />
      ) : null}

      <SectionCard id="assets" title="Sales assets: proof to send">
        <AssetLibrary />
      </SectionCard>

      {manager ? (
        <SectionCard id="reference-asks" title="Reference calls asked for">
          <ReferenceAsks />
        </SectionCard>
      ) : null}

      <SectionCard id="references" title="Client references">
        <ReferenceList manager={Boolean(manager)} />
      </SectionCard>
    </main>
  );
}

function LinkRow({
  link: l,
  manager,
  busy,
  onEdit,
  onHide,
}: {
  link: SalesLink;
  manager: boolean;
  busy: boolean;
  onEdit: () => void;
  onHide: () => void;
}) {
  return (
    <li className="flex items-center">
      <a
        href={l.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex min-w-0 flex-1 flex-col gap-0.5 px-4 py-3 hover:bg-[color:var(--secondary)]"
      >
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
          <span className="truncate" dir="auto">
            {l.label}
          </span>
          <ArrowUpRight className="muted size-3.5 shrink-0" aria-hidden />
          <span className="sr-only"> (opens in a new tab)</span>
        </span>
        {l.note ? (
          <span
            className="muted text-xs leading-relaxed [overflow-wrap:anywhere]"
            dir="auto"
          >
            {l.note}
          </span>
        ) : null}
        <span className="muted truncate text-xs">{host(l.url)}</span>
      </a>
      {manager ? (
        <div className="flex shrink-0 items-center gap-1.5 pr-4">
          <button
            type="button"
            className={small}
            onClick={onEdit}
            disabled={busy}
            aria-label={`Edit ${l.label}`}
          >
            Edit
          </button>
          <button
            type="button"
            className={small}
            onClick={onHide}
            disabled={busy}
            aria-label={`Hide ${l.label}`}
          >
            {busy ? "Hiding…" : "Hide"}
          </button>
        </div>
      ) : null}
    </li>
  );
}

function HiddenLinks({
  links,
  busy,
  onShow,
}: {
  links: SalesLink[];
  busy: string | null;
  onShow: (l: SalesLink) => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <section className="panel min-w-0 overflow-hidden">
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(o => !o)}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-[15px] font-semibold tracking-tight hover:bg-[color:var(--secondary)]"
        >
          <span>
            Hidden links{" "}
            <span className="muted font-normal tabular-nums">
              {links.length}
            </span>
          </span>
          <ChevronDown
            className={`muted size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden
          />
        </button>
      </h2>
      {open ? (
        <div id={id} className="border-t hairline">
          <p className="muted border-b hairline px-4 py-2 text-xs">
            Only managers see these. Show one to put it back on the list.
          </p>
          <ul className="divide-y hairline">
            {links.map(l => (
              <li key={l.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" dir="auto">
                    {l.label}
                  </p>
                  <p className="muted truncate text-xs">
                    {kindName(kindOf(l))} · {host(l.url)}
                  </p>
                </div>
                <button
                  type="button"
                  className={small}
                  disabled={busy === l.id}
                  onClick={() => onShow(l)}
                  aria-label={`Show ${l.label}`}
                >
                  {busy === l.id ? "Showing…" : "Show"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function Field({
  id,
  label,
  hint,
  wide = false,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <label htmlFor={id} className="font-medium">
          {label}
        </label>
        {/* Read after the field's name, not glued onto it. */}
        {hint ? (
          <span id={`${id}-hint`} className="muted">
            {hint}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function LinkForm({
  initial,
  submit,
  onSave,
  onCancel,
}: {
  initial: Draft;
  submit: string;
  onSave: (d: Saved) => Promise<void>;
  onCancel: () => void;
}) {
  const id = useId();
  const [d, setD] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function send() {
    const label = d.label.trim();
    const url = d.url.trim();
    const sort = d.sort.trim();
    const why = !label
      ? "Give the link a name."
      : !isHttps(url)
        ? "A link must start with https://."
        : sort && !/^-?\d+$/.test(sort)
          ? "The order is a whole number, such as 10."
          : null;
    setProblem(why);
    if (why) return;
    setSaving(true);
    try {
      await onSave({
        label,
        url,
        kind: d.kind,
        note: d.note.trim(),
        sort: sort ? Number(sort) : 100,
      });
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={e => {
        e.preventDefault();
        void send();
      }}
      className="space-y-3"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id={`${id}-label`} label="Name">
          <input
            id={`${id}-label`}
            value={d.label}
            onChange={e => setD({ ...d, label: e.target.value })}
            className={field}
            placeholder="Pitch deck"
            maxLength={120}
            dir="auto"
          />
        </Field>
        <Field id={`${id}-url`} label="Link" hint="starts with https://">
          <input
            id={`${id}-url`}
            aria-describedby={`${id}-url-hint`}
            type="url"
            inputMode="url"
            value={d.url}
            onChange={e => setD({ ...d, url: e.target.value })}
            className={field}
            placeholder="https://"
            maxLength={2000}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Field id={`${id}-kind`} label="Kind">
          <select
            id={`${id}-kind`}
            value={d.kind}
            onChange={e => setD({ ...d, kind: e.target.value as Kind })}
            className={field}
          >
            {KINDS.map(k => (
              <option key={k.kind} value={k.kind}>
                {k.one}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`${id}-sort`} label="Order" hint="lower comes first">
          <input
            id={`${id}-sort`}
            aria-describedby={`${id}-sort-hint`}
            type="number"
            inputMode="numeric"
            step={1}
            value={d.sort}
            onChange={e => setD({ ...d, sort: e.target.value })}
            className={field}
            placeholder="100"
          />
        </Field>
        <Field id={`${id}-note`} label="Note" hint="when to use it" wide>
          <input
            id={`${id}-note`}
            aria-describedby={`${id}-note-hint`}
            value={d.note}
            onChange={e => setD({ ...d, note: e.target.value })}
            className={field}
            placeholder="Open it on the demo, after the questions."
            maxLength={500}
            dir="auto"
          />
        </Field>
      </div>
      {problem ? (
        <p
          role="alert"
          className="callout-bad rounded-[var(--radius-md)] border px-3 py-2 text-sm"
        >
          {problem}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={buttonPrimary} disabled={saving}>
          {saving ? "Saving…" : submit}
        </button>
        <button
          type="button"
          className={button}
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
