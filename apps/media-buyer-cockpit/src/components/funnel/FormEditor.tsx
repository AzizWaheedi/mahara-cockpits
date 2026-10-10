import {
  ArrowDown,
  ArrowUp,
  Plus,
  Sparkles,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { Kicker } from "@/components/ceo/Kicker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  checkPublish,
  type FormChange,
  type FunnelForm,
  publishForm,
} from "@/lib/funnelClient";
import {
  AUTOFILLED,
  CONTACT_TYPES,
  type LeadFormQuestion,
  type LeadFormSpec,
  newKey,
  problems,
  questionLabel,
  type ThankYouButton,
} from "@/lib/leadForm";
import { cn } from "@/lib/utils";
import { ChangeReview } from "./ChangeReview";
import { FormPreview, type FormScreen } from "./FormPreview";

const BUTTONS: { value: ThankYouButton; label: string }[] = [
  { value: "NONE", label: "No button" },
  { value: "VIEW_WEBSITE", label: "View website" },
  { value: "WHATSAPP", label: "Message on WhatsApp" },
  { value: "CALL_BUSINESS", label: "Call the business" },
  { value: "DOWNLOAD", label: "Download" },
];

/**
 * The lead form editor. Everything a lead sees, from the greeting to the
 * thank-you screen, with the phone preview following the part being edited.
 * Publishing makes a new version on the client's Page and moves this
 * campaign's ads onto it; the version they use now is kept.
 */
export function FormEditor({
  open,
  onOpenChange,
  campaignName,
  form,
  pageName,
  adCount,
  onPublished,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignName: string;
  form: FunnelForm;
  pageName?: string | null;
  adCount: number;
  onPublished: (change: FormChange) => void;
}) {
  const [draft, setDraft] = useState<LeadFormSpec>(() =>
    structuredClone(form.spec),
  );
  const [screen, setScreen] = useState<FormScreen>("questions");
  const [published, setPublished] = useState<FormChange | null>(null);
  const draftJson = JSON.stringify(draft);
  const dirty = draftJson !== JSON.stringify(form.spec);
  const issues = useMemo(() => problems(draft), [draft]);

  const edit = (fn: (d: LeadFormSpec) => void) =>
    setDraft(d => {
      const next = structuredClone(d);
      fn(next);
      return next;
    });

  const close = (next: boolean) => {
    if (
      !next &&
      dirty &&
      !published &&
      !window.confirm(
        "Close the editor? The changes you have not published will be lost.",
      )
    )
      return;
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="ceo-root grid h-[min(92vh,940px)] max-w-[calc(100%-1rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-[1120px]">
        <header className="border-b px-5 py-4 pr-12">
          <Kicker>Lead form</Kicker>
          <DialogTitle className="mt-1 text-lg font-semibold tracking-tight">
            Edit the form
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">
            Publishing makes a new version on {pageName || "the client's Page"}{" "}
            and moves {adCount === 1 ? "the ad" : `the ${adCount} ads`} in this
            campaign onto it. The version they use now stays, so you can switch
            back.
          </DialogDescription>
        </header>

        <div className="grid min-h-0 md:grid-cols-[minmax(0,1fr)_330px]">
          <div className="min-h-0 space-y-4 overflow-y-auto px-5 py-5">
            {!form.full && (
              <p className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                <TriangleAlert className="mt-px size-3.5 shrink-0" />
                Meta did not share this form's greeting, review step and
                thank-you screen, so they start switched off here. Set them
                below before you publish.
              </p>
            )}

            <Section
              title="Greeting"
              about="A first screen before any question. It slows the tap-through, so people who carry on meant to."
              on={Boolean(draft.intro)}
              onToggle={on =>
                edit(d => {
                  d.intro = on
                    ? {
                        title: "",
                        style: "LIST_STYLE",
                        content: ["", ""],
                        buttonText: "",
                      }
                    : null;
                })
              }
              onFocus={() => setScreen("intro")}
            >
              {draft.intro && (
                <div className="space-y-3">
                  <Field label="Headline">
                    <Input
                      dir="auto"
                      value={draft.intro.title}
                      placeholder="Free design consultation"
                      onChange={e =>
                        edit(d => {
                          if (d.intro) d.intro.title = e.target.value;
                        })
                      }
                    />
                  </Field>
                  <Field label="Shown as">
                    <ToggleGroup
                      type="single"
                      variant="outline"
                      size="sm"
                      value={draft.intro.style}
                      onValueChange={v =>
                        v &&
                        edit(d => {
                          if (!d.intro) return;
                          d.intro.style = v as "LIST_STYLE" | "PARAGRAPH_STYLE";
                          if (v === "PARAGRAPH_STYLE")
                            d.intro.content = [
                              d.intro.content.filter(Boolean).join("\n"),
                            ];
                        })
                      }
                    >
                      <ToggleGroupItem value="LIST_STYLE">
                        Bullet points
                      </ToggleGroupItem>
                      <ToggleGroupItem value="PARAGRAPH_STYLE">
                        Paragraph
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </Field>
                  {draft.intro.style === "LIST_STYLE" ? (
                    <Field label="Points">
                      <div className="space-y-2">
                        {draft.intro.content.map((line, i) => (
                          <div key={`intro-${i}`} className="flex gap-2">
                            <Input
                              dir="auto"
                              value={line}
                              placeholder={
                                i === 0
                                  ? "Plans ready in 48 hours"
                                  : "Another reason to carry on"
                              }
                              onChange={e =>
                                edit(d => {
                                  if (d.intro)
                                    d.intro.content[i] = e.target.value;
                                })
                              }
                            />
                            <IconButton
                              label="Remove this point"
                              onClick={() =>
                                edit(d => void d.intro?.content.splice(i, 1))
                              }
                              disabled={draft.intro?.content.length === 1}
                            >
                              <Trash2 className="size-4" />
                            </IconButton>
                          </div>
                        ))}
                        {draft.intro.content.length < 5 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              edit(d => void d.intro?.content.push(""))
                            }
                          >
                            <Plus className="mr-1 size-4" />
                            Add a point
                          </Button>
                        )}
                      </div>
                    </Field>
                  ) : (
                    <Field label="Text">
                      <Textarea
                        dir="auto"
                        rows={4}
                        value={draft.intro.content[0] ?? ""}
                        onChange={e =>
                          edit(d => {
                            if (d.intro) d.intro.content = [e.target.value];
                          })
                        }
                      />
                    </Field>
                  )}
                  <Field label="Button">
                    <Input
                      dir="auto"
                      value={draft.intro.buttonText ?? ""}
                      placeholder="Continue"
                      onChange={e =>
                        edit(d => {
                          if (d.intro) d.intro.buttonText = e.target.value;
                        })
                      }
                    />
                  </Field>
                </div>
              )}
            </Section>

            <Section
              title="Questions"
              about="Custom questions are the only ones that filter a lead. Meta fills in contact details from the person's profile."
              onFocus={() => setScreen("questions")}
            >
              <div className="space-y-3">
                <Field label="Line above the questions">
                  <Input
                    dir="auto"
                    value={draft.headline ?? ""}
                    placeholder="Contact information"
                    onChange={e =>
                      edit(d => {
                        d.headline = e.target.value;
                      })
                    }
                  />
                </Field>
                <ol className="space-y-2">
                  {draft.questions.map((q, i) => (
                    <QuestionRow
                      key={q.key}
                      q={q}
                      first={i === 0}
                      last={i === draft.questions.length - 1}
                      onChange={next =>
                        edit(d => {
                          d.questions[i] = next;
                        })
                      }
                      onMove={by =>
                        edit(d => {
                          const [moved] = d.questions.splice(i, 1);
                          if (moved) d.questions.splice(i + by, 0, moved);
                        })
                      }
                      onRemove={() =>
                        edit(d => {
                          d.questions.splice(i, 1);
                          if (q.type === "PHONE") d.smsVerify = false;
                        })
                      }
                    />
                  ))}
                </ol>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      edit(
                        d =>
                          void d.questions.push({
                            key: newKey(d),
                            type: "CUSTOM",
                            label: "",
                            options: [
                              { key: "answer_1", value: "" },
                              { key: "answer_2", value: "" },
                            ],
                          }),
                      )
                    }
                  >
                    <Plus className="mr-1 size-4" />
                    Add a filtering question
                  </Button>
                  <Select
                    value=""
                    onValueChange={type =>
                      edit(d => {
                        const stem = type.toLowerCase();
                        const key = d.questions.some(x => x.key === stem)
                          ? newKey(d, stem)
                          : stem;
                        d.questions.push({ key, type });
                      })
                    }
                  >
                    <SelectTrigger className="h-8 w-auto gap-1 text-xs">
                      <SelectValue placeholder="Add a contact detail" />
                    </SelectTrigger>
                    <SelectContent>
                      {CONTACT_TYPES.filter(
                        c => !draft.questions.some(q => q.type === c.type),
                      ).map(c => (
                        <SelectItem key={c.type} value={c.type}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </Section>

            <Section
              title="Quality filters"
              about="Each one costs some volume and keeps out the people who never meant to leave their details."
              onFocus={() =>
                setScreen(
                  draft.higherIntent
                    ? "review"
                    : draft.smsVerify
                      ? "sms"
                      : "questions",
                )
              }
            >
              <div className="divide-y">
                <Toggle
                  title="Review step"
                  about="Meta's Higher intent form. The lead sees their answers, autofilled ones included, and confirms them before the form sends."
                  checked={draft.higherIntent}
                  onChange={on => {
                    edit(d => {
                      d.higherIntent = on;
                    });
                    if (on) setScreen("review");
                  }}
                />
                <Toggle
                  title="SMS code"
                  about={
                    draft.questions.some(q => q.type === "PHONE")
                      ? "Meta texts a code to the phone number, and the form sends only once it matches. Stops wrong and autofilled numbers. Meta offers it in some countries only; checking with Meta tells you whether this Page has it."
                      : "Needs the phone number question. Add it under Questions first."
                  }
                  checked={draft.smsVerify}
                  disabled={!draft.questions.some(q => q.type === "PHONE")}
                  onChange={on => {
                    edit(d => {
                      d.smsVerify = on;
                    });
                    if (on) setScreen("sms");
                  }}
                />
              </div>
            </Section>

            <Section
              title="Thank-you screen"
              about="What the lead reads after sending, and the one next step you give them."
              on={Boolean(draft.thankYou)}
              onToggle={on =>
                edit(d => {
                  d.thankYou = on
                    ? { title: "", body: "", buttonType: "NONE" }
                    : null;
                })
              }
              onFocus={() => setScreen("thankYou")}
            >
              {draft.thankYou && (
                <div className="space-y-3">
                  <Field label="Headline">
                    <Input
                      dir="auto"
                      value={draft.thankYou.title}
                      placeholder="Thanks, we'll call you within a day"
                      onChange={e =>
                        edit(d => {
                          if (d.thankYou) d.thankYou.title = e.target.value;
                        })
                      }
                    />
                  </Field>
                  <Field label="Message">
                    <Textarea
                      dir="auto"
                      rows={3}
                      value={draft.thankYou.body ?? ""}
                      placeholder="Keep your phone near you: our engineer calls from a Kuwaiti number."
                      onChange={e =>
                        edit(d => {
                          if (d.thankYou) d.thankYou.body = e.target.value;
                        })
                      }
                    />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Button">
                      <Select
                        value={draft.thankYou.buttonType}
                        onValueChange={v =>
                          edit(d => {
                            if (d.thankYou)
                              d.thankYou.buttonType = v as ThankYouButton;
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {BUTTONS.map(b => (
                            <SelectItem key={b.value} value={b.value}>
                              {b.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    {draft.thankYou.buttonType !== "NONE" && (
                      <Field label="Button words">
                        <Input
                          dir="auto"
                          value={draft.thankYou.buttonText ?? ""}
                          placeholder={
                            BUTTONS.find(
                              b => b.value === draft.thankYou?.buttonType,
                            )?.label
                          }
                          onChange={e =>
                            edit(d => {
                              if (d.thankYou)
                                d.thankYou.buttonText = e.target.value;
                            })
                          }
                        />
                      </Field>
                    )}
                  </div>
                  {(draft.thankYou.buttonType === "VIEW_WEBSITE" ||
                    draft.thankYou.buttonType === "DOWNLOAD") && (
                    <Field label="Link">
                      <Input
                        type="url"
                        value={draft.thankYou.websiteUrl ?? ""}
                        placeholder="https://"
                        onChange={e =>
                          edit(d => {
                            if (d.thankYou)
                              d.thankYou.websiteUrl = e.target.value;
                          })
                        }
                      />
                    </Field>
                  )}
                  {(draft.thankYou.buttonType === "CALL_BUSINESS" ||
                    draft.thankYou.buttonType === "WHATSAPP") && (
                    <Field label="The client's number, with country code">
                      <Input
                        type="tel"
                        value={draft.thankYou.phone ?? ""}
                        placeholder="+965 5000 0000"
                        onChange={e =>
                          edit(d => {
                            if (d.thankYou) d.thankYou.phone = e.target.value;
                          })
                        }
                      />
                    </Field>
                  )}
                </div>
              )}
            </Section>

            <details className="group rounded-xl border px-4 py-3">
              <summary className="cursor-pointer select-none text-sm font-medium">
                Name and privacy policy
              </summary>
              <div className="mt-3 space-y-3">
                <Field
                  label="Form name"
                  hint="The version number and time are added when it publishes."
                >
                  <Input
                    dir="auto"
                    value={draft.name}
                    onChange={e =>
                      edit(d => {
                        d.name = e.target.value;
                      })
                    }
                  />
                </Field>
                <Field label="Privacy policy link">
                  <Input
                    type="url"
                    value={draft.privacy?.url ?? ""}
                    placeholder="https://"
                    onChange={e =>
                      edit(d => {
                        d.privacy = {
                          ...(d.privacy ?? {}),
                          url: e.target.value,
                        };
                      })
                    }
                  />
                </Field>
                <Field label="Link words (optional)">
                  <Input
                    dir="auto"
                    value={draft.privacy?.linkText ?? ""}
                    placeholder="Privacy policy"
                    onChange={e =>
                      edit(d => {
                        d.privacy = {
                          url: d.privacy?.url ?? "",
                          linkText: e.target.value,
                        };
                      })
                    }
                  />
                </Field>
              </div>
            </details>
            <div className="flex flex-col items-center border-t pt-6 md:hidden">
              <Kicker className="mb-3">What a lead sees</Kicker>
              <FormPreview
                spec={draft}
                pageName={pageName ?? undefined}
                screen={screen}
                onScreenChange={setScreen}
              />
            </div>
          </div>

          <aside className="hidden min-h-0 flex-col items-center overflow-y-auto border-l bg-muted/20 px-4 py-6 md:flex">
            <FormPreview
              spec={draft}
              pageName={pageName ?? undefined}
              screen={screen}
              onScreenChange={setScreen}
            />
            <p className="mt-4 max-w-[260px] shrink-0 text-center text-xs leading-relaxed text-muted-foreground">
              What a lead sees on their phone. It follows the part you are
              editing.
            </p>
          </aside>
        </div>

        <footer className="border-t bg-background px-5 py-4">
          {published ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm">{published.did}</p>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </div>
          ) : (
            <ChangeReview
              key={draftJson}
              verb="Publish"
              disabled={!dirty || issues.length > 0}
              disabledReason={
                issues.length
                  ? `Fix this first: ${issues[0]?.message}`
                  : !dirty
                    ? "Change something to publish a new version."
                    : undefined
              }
              check={() =>
                checkPublish({ campaignName, fromFormId: form.id, spec: draft })
              }
              apply={adIds =>
                publishForm({
                  campaignName,
                  fromFormId: form.id,
                  spec: draft,
                  adIds,
                })
              }
              onDone={change => {
                setPublished(change);
                onPublished(change);
              }}
            />
          )}
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  title,
  about,
  on,
  onToggle,
  onFocus,
  children,
}: {
  title: string;
  about: string;
  /** With onToggle: the section can be switched off as a whole. */
  on?: boolean;
  onToggle?: (on: boolean) => void;
  onFocus?: () => void;
  children?: ReactNode;
}) {
  return (
    <section
      className="rounded-xl border bg-card px-4 py-4"
      onFocusCapture={onFocus}
      onPointerDownCapture={onFocus}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {about}
          </p>
        </div>
        {onToggle && (
          <Switch
            checked={Boolean(on)}
            onCheckedChange={onToggle}
            aria-label={`${on ? "Turn off" : "Turn on"} ${title}`}
          />
        )}
      </div>
      {children && (onToggle ? on : true) ? (
        <div className="mt-4">{children}</div>
      ) : null}
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is the child
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && (
        <span className="block text-[11px] text-muted-foreground/80">
          {hint}
        </span>
      )}
    </label>
  );
}

function Toggle({
  title,
  about,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  about: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p
          className={cn(
            "text-sm font-medium",
            disabled && "text-muted-foreground",
          )}
        >
          {title}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {about}
        </p>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        aria-label={`${checked ? "Turn off" : "Turn on"} ${title}`}
      />
    </div>
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
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-9 shrink-0 text-muted-foreground"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      {children}
    </Button>
  );
}

function QuestionRow({
  q,
  first,
  last,
  onChange,
  onMove,
  onRemove,
}: {
  q: LeadFormQuestion;
  first: boolean;
  last: boolean;
  onChange: (q: LeadFormQuestion) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const custom = q.type === "CUSTOM";
  const options = q.options ?? [];
  return (
    <li className="rounded-lg border bg-background/60 p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {custom ? (
            <Input
              dir="auto"
              value={q.label ?? ""}
              placeholder="What kind of project is it?"
              aria-label="The question"
              onChange={e => onChange({ ...q, label: e.target.value })}
            />
          ) : (
            <p className="flex h-9 items-center gap-2 text-sm">
              {questionLabel(q)}
              {AUTOFILLED.has(q.type) && (
                <span className="inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10.5px] text-muted-foreground">
                  <Sparkles className="size-3" />
                  Meta fills this in
                </span>
              )}
            </p>
          )}
        </div>
        <IconButton label="Move up" onClick={() => onMove(-1)} disabled={first}>
          <ArrowUp className="size-4" />
        </IconButton>
        <IconButton label="Move down" onClick={() => onMove(1)} disabled={last}>
          <ArrowDown className="size-4" />
        </IconButton>
        <IconButton label="Remove this question" onClick={onRemove}>
          <Trash2 className="size-4" />
        </IconButton>
      </div>
      {custom && (
        <div className="mt-3 space-y-2 border-l-2 pl-3">
          {options.length === 0 && (
            <p className="text-xs text-muted-foreground">
              A short answer the lead types. Add answers to make it multiple
              choice.
            </p>
          )}
          {options.map((o, i) => (
            <div key={o.key} className="flex gap-2">
              <Input
                dir="auto"
                value={o.value}
                placeholder={`Answer ${i + 1}`}
                aria-label={`Answer ${i + 1}`}
                onChange={e => {
                  const next = options.map((x, j) =>
                    j === i ? { ...x, value: e.target.value } : x,
                  );
                  onChange({ ...q, options: next });
                }}
              />
              <IconButton
                label="Remove this answer"
                onClick={() => {
                  const next = options.filter((_, j) => j !== i);
                  onChange({
                    ...q,
                    ...(next.length
                      ? { options: next }
                      : { options: undefined }),
                  });
                }}
              >
                <Trash2 className="size-4" />
              </IconButton>
            </div>
          ))}
          {options.length < 12 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const taken = new Set(options.map(o => o.key));
                let n = options.length + 1;
                while (taken.has(`answer_${n}`)) n++;
                onChange({
                  ...q,
                  options: [...options, { key: `answer_${n}`, value: "" }],
                });
              }}
            >
              <Plus className="mr-1 size-4" />
              Add an answer
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
