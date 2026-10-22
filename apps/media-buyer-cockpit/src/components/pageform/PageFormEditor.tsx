import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Plus,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";
import { Kicker } from "@/components/ceo/Kicker";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  clean,
  describeChange,
  LIMITS,
  newQuestionKey,
  type PageFormSpec,
  type PageQuestion,
  problems,
} from "@/lib/pageForm";
import {
  type PageFormChange,
  type PageFormPage,
  publishPageForm,
} from "@/lib/pageFormClient";
import { cn } from "@/lib/utils";
import { IconPicker, PagePreview, PhotoPicker } from "./PageFormParts";

/**
 * The questions on a client's form page, with the real page beside them in a
 * phone frame, following the question being edited. Publish changes the live
 * page (within a minute, the public file's cache); every version is kept on
 * the client page, so a change can be switched back.
 */
export function PageFormEditor({
  open,
  onOpenChange,
  page,
  onPublished,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  page: PageFormPage;
  onPublished: (change: PageFormChange) => void;
}) {
  const start = useMemo<PageFormSpec>(
    () => ({ questions: structuredClone(page.current?.questions ?? []) }),
    [page],
  );
  const [draft, setDraft] = useState<PageFormSpec>(() =>
    structuredClone(start),
  );
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const issues = useMemo(
    () => problems(draft, { photos: page.photos, retired: page.retired }),
    [draft, page],
  );
  const change = useMemo(
    () =>
      describeChange(clean(start, page.bindings), clean(draft, page.bindings)),
    [draft, start, page.bindings],
  );
  const dirty = change !== "No change to the questions";
  const openIndex = draft.questions.findIndex(q => q.key === openKey);
  // The preview follows the open question; the first screen otherwise.
  const screen = openIndex >= 0 ? openIndex + 1 : 0;

  const edit = (fn: (d: PageFormSpec) => void) =>
    setDraft(d => {
      const next = structuredClone(d);
      fn(next);
      return next;
    });
  const editQuestion = (key: string, fn: (q: PageQuestion) => void) =>
    edit(d => {
      const q = d.questions.find(x => x.key === key);
      if (q) fn(q);
    });

  const close = (next: boolean) => {
    if (
      !next &&
      dirty &&
      !busy &&
      !window.confirm(
        "Close the editor? The changes you have not published will be lost.",
      )
    )
      return;
    onOpenChange(next);
  };

  const addQuestion = () => {
    const key = newQuestionKey([
      ...draft.questions.map(q => q.key),
      ...page.retired,
    ]);
    edit(d => {
      d.questions.push({
        key,
        name: "",
        label: "",
        style: "list",
        options: [{ value: "" }, { value: "" }],
      });
    });
    setOpenKey(key);
  };

  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      const done = await publishPageForm({
        slug: page.slug,
        base: page.liveVersion,
        spec: draft,
      });
      toast.success(`Published ${done.label}`, {
        description: "Visitors see it within a minute.",
      });
      setConfirm(false);
      onPublished(done);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  };

  const liveLabel = page.liveVersion ? `v${page.liveVersion}` : "v1";

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="ceo-root grid h-[min(92vh,940px)] max-w-[calc(100%-1rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-[1080px]">
        <header className="border-b px-5 py-4 pr-12">
          <Kicker>Lead page</Kicker>
          <DialogTitle className="mt-1 text-lg font-semibold tracking-tight">
            Edit the questions
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">
            {page.title}. Add, remove, reorder or reword questions. The first
            screen, the contact step and the design stay as they are.
          </DialogDescription>
        </header>

        <div className="grid min-h-0 md:grid-cols-[minmax(0,1fr)_330px]">
          <div className="min-h-0 space-y-3 overflow-y-auto px-5 py-5">
            <ol className="space-y-2">
              {draft.questions.map((q, i) => (
                <QuestionItem
                  key={q.key}
                  q={q}
                  index={i}
                  count={draft.questions.length}
                  open={q.key === openKey}
                  ownField={Boolean(page.bindings[q.key])}
                  siteUrl={page.siteUrl}
                  photos={page.photos}
                  onToggle={() => setOpenKey(k => (k === q.key ? null : q.key))}
                  onEdit={fn => editQuestion(q.key, fn)}
                  onMove={dir =>
                    edit(d => {
                      const [moved] = d.questions.splice(i, 1);
                      d.questions.splice(i + dir, 0, moved);
                    })
                  }
                  onRemove={() => {
                    if (
                      page.bindings[q.key] &&
                      !window.confirm(
                        `Remove "${q.name || q.label}"? It has its own CRM field, which stops filling. Switching back to ${liveLabel} brings it back.`,
                      )
                    )
                      return;
                    edit(d => {
                      d.questions.splice(i, 1);
                    });
                  }}
                />
              ))}
            </ol>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addQuestion}
              disabled={draft.questions.length >= LIMITS.questions[1]}
            >
              <Plus className="mr-1 size-4" aria-hidden />
              Add a question
            </Button>
            {draft.questions.length >= LIMITS.questions[1] && (
              <p className="text-xs text-muted-foreground">
                {LIMITS.questions[1]} questions is the most a page takes.
              </p>
            )}

            <div className="flex flex-col items-center border-t pt-6 md:hidden">
              <Kicker className="mb-3">What a visitor sees</Kicker>
              <PagePreview
                siteUrl={page.siteUrl}
                spec={draft}
                screen={screen}
              />
            </div>
          </div>
          <aside className="hidden min-h-0 flex-col items-center overflow-y-auto border-l bg-muted/20 px-4 py-6 md:flex">
            <Kicker className="mb-3">What a visitor sees</Kicker>
            <PagePreview siteUrl={page.siteUrl} spec={draft} screen={screen} />
            <p className="mt-4 max-w-[260px] shrink-0 text-center text-xs leading-relaxed text-muted-foreground">
              The real page with this draft. Open a question to see its screen.
            </p>
          </aside>
        </div>

        <footer className="border-t bg-background px-5 py-4">
          {error && (
            <p className="callout-warn mb-3 rounded-lg border px-3 py-2 text-xs">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 text-sm">
              {issues.length ? (
                <p className="flex items-start gap-2 text-muted-foreground">
                  <TriangleAlert
                    className="mt-0.5 size-4 shrink-0"
                    style={{ color: "var(--warning)" }}
                    aria-hidden
                  />
                  <span>
                    {issues[0]}
                    {issues.length > 1
                      ? ` (and ${issues.length - 1} more)`
                      : ""}
                  </span>
                </p>
              ) : (
                <p className="text-muted-foreground" dir="auto">
                  {dirty ? change : `No changes yet. ${liveLabel} is live.`}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={!dirty || busy}
                onClick={() => {
                  setDraft(structuredClone(start));
                  setError(null);
                }}
              >
                Discard changes
              </Button>
              <Button
                type="button"
                disabled={!dirty || issues.length > 0 || busy}
                onClick={() => setConfirm(true)}
              >
                Publish
              </Button>
            </div>
          </div>
        </footer>

        <AlertDialog open={confirm} onOpenChange={o => !busy && setConfirm(o)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Publish to the live page?</AlertDialogTitle>
              <AlertDialogDescription dir="auto">
                {change}. Visitors see it within a minute. Anyone already
                answering keeps the questions they started with. You can switch
                back to {liveLabel} from the client page.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>
                Keep editing
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={busy}
                onClick={e => {
                  e.preventDefault();
                  void publish();
                }}
              >
                {busy ? "Publishing…" : "Publish"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

function QuestionItem({
  q,
  index,
  count,
  open,
  ownField,
  siteUrl,
  photos,
  onToggle,
  onEdit,
  onMove,
  onRemove,
}: {
  q: PageQuestion;
  index: number;
  count: number;
  open: boolean;
  ownField: boolean;
  siteUrl: string;
  photos: string[];
  onToggle: () => void;
  onEdit: (fn: (q: PageQuestion) => void) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const photo = q.style === "photo";
  return (
    <li className="rounded-xl border bg-card">
      <div className="flex items-center gap-2 p-2 pl-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg py-1 text-left"
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium tabular-nums">
            {index + 1}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium" dir="auto">
              {q.label || "New question"}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {photo ? "Photo cards" : "List"} · {q.options.length} answers ·{" "}
              {ownField ? "Own CRM field" : "Answers field only"}
            </span>
          </span>
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground"
          aria-label="Move up"
          disabled={index === 0}
          onClick={() => onMove(-1)}
        >
          <ArrowUp className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground"
          aria-label="Move down"
          disabled={index === count - 1}
          onClick={() => onMove(1)}
        >
          <ArrowDown className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground"
          aria-label="Remove this question"
          disabled={count <= 1}
          onClick={onRemove}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>

      {open && (
        <div className="space-y-4 border-t px-4 py-4">
          <Field label="The question">
            <Input
              dir="rtl"
              value={q.label}
              maxLength={LIMITS.label}
              placeholder="شنو نوع مشروعك؟"
              onChange={e => onEdit(x => (x.label = e.target.value))}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Hint under it (optional)">
              <Input
                dir="rtl"
                value={q.hint ?? ""}
                maxLength={LIMITS.hint}
                onChange={e => onEdit(x => (x.hint = e.target.value))}
              />
            </Field>
            <Field
              label="Short name for the CRM"
              help="Written before the answer in the Answers field."
            >
              <Input
                dir="rtl"
                value={q.name}
                maxLength={LIMITS.name}
                placeholder="نوع المشروع"
                onChange={e => onEdit(x => (x.name = e.target.value))}
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <Field group label="Show the answers as">
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                className="w-56"
                value={q.style}
                onValueChange={v =>
                  v && onEdit(x => (x.style = v as PageQuestion["style"]))
                }
              >
                <ToggleGroupItem value="photo">Photo cards</ToggleGroupItem>
                <ToggleGroupItem value="list">List</ToggleGroupItem>
              </ToggleGroup>
            </Field>
            {!photo && (
              <Field group label="Photo with the question">
                <PhotoPicker
                  siteUrl={siteUrl}
                  photos={photos}
                  value={q.image}
                  optional
                  label="Question photo"
                  onChange={v => onEdit(x => (x.image = v))}
                />
              </Field>
            )}
          </div>

          <Field group label="Answers">
            <ol className="space-y-2">
              {q.options.map((o, k) => (
                <li
                  // Answers have no key of their own; their place is the identity.
                  key={k}
                  className="rounded-lg bg-muted/40 p-2"
                >
                  <div className="flex items-center gap-2">
                    {photo && (
                      <PhotoPicker
                        siteUrl={siteUrl}
                        photos={photos}
                        value={o.image}
                        label="Answer photo"
                        onChange={v => onEdit(x => (x.options[k].image = v))}
                      />
                    )}
                    <IconPicker
                      value={o.icon}
                      onChange={v => onEdit(x => (x.options[k].icon = v))}
                    />
                    <Input
                      dir="rtl"
                      value={o.value}
                      maxLength={LIMITS.value}
                      aria-label={`Answer ${k + 1}`}
                      placeholder={`Answer ${k + 1}`}
                      onChange={e =>
                        onEdit(x => (x.options[k].value = e.target.value))
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0 text-muted-foreground"
                      aria-label="Move answer up"
                      disabled={k === 0}
                      onClick={() =>
                        onEdit(x => {
                          const [m] = x.options.splice(k, 1);
                          x.options.splice(k - 1, 0, m);
                        })
                      }
                    >
                      <ArrowUp className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0 text-muted-foreground"
                      aria-label="Remove this answer"
                      disabled={q.options.length <= LIMITS.options[0]}
                      onClick={() => onEdit(x => x.options.splice(k, 1))}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  {photo && (
                    <Input
                      dir="rtl"
                      className="mt-2 h-8 text-xs"
                      value={o.desc ?? ""}
                      maxLength={LIMITS.desc}
                      placeholder="A short line under the answer (optional)"
                      onChange={e =>
                        onEdit(x => (x.options[k].desc = e.target.value))
                      }
                    />
                  )}
                  <details className="mt-1" open={Boolean(o.note)}>
                    <summary className="cursor-pointer py-1 text-xs text-muted-foreground">
                      Note when this answer is picked
                    </summary>
                    <Input
                      dir="rtl"
                      className="mt-1 h-8 text-xs"
                      value={o.note ?? ""}
                      maxLength={LIMITS.note}
                      placeholder="The visitor reads it, then taps Next"
                      onChange={e =>
                        onEdit(x => (x.options[k].note = e.target.value))
                      }
                    />
                  </details>
                </li>
              ))}
            </ol>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2"
              disabled={q.options.length >= LIMITS.options[1]}
              onClick={() => onEdit(x => x.options.push({ value: "" }))}
            >
              <Plus className="mr-1 size-4" aria-hidden />
              Add an answer
            </Button>
          </Field>
          {!ownField && (
            <p className="text-xs text-muted-foreground">
              This question has no CRM field of its own. Its answer reaches the
              CRM in the Answers field, after its short name.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/** A labelled control. `group` for controls that are not one input (toggles, pickers, lists). */
function Field({
  label,
  help,
  group,
  children,
}: {
  label: string;
  help?: string;
  group?: boolean;
  children: ReactNode;
}) {
  const Tag = group ? "div" : "label";
  return (
    <Tag className="block space-y-1.5">
      <span className="block text-xs font-medium text-muted-foreground">
        {label}
      </span>
      {children}
      {help && (
        <span className="block text-[11px] text-muted-foreground/80">
          {help}
        </span>
      )}
    </Tag>
  );
}
