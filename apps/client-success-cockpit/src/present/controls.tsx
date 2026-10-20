import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { fill, GROUP_LINKS, type L, O, SHARED } from "./content";
import type { AccessStatus, CallKind, DeckData, Overrides } from "./deckData";
import type { DeckKind } from "./sources";
import { recapVideos, slotCovered } from "./videos";

/**
 * The presenter's own controls for a slide, in cockpit UI: the notes window
 * shows them during the call, the prep view before it. Never on the canvas.
 * Every change goes through the same prep save as the canvas (gated,
 * merged, audited), so what is typed here shows on the shared deck at once.
 */

export interface ControlsProps {
  slideId: string;
  d: DeckData;
  deck: DeckKind;
  prep: { onboarding: Overrides; launch: Overrides };
  setPrep: (deck: DeckKind, patch: Overrides, now?: boolean) => void;
  /** A booking button (the cockpit's BookCallButton, or the harness's stand-in). */
  book?: (kind: CallKind, label: string) => ReactNode;
  /** The prep view also shows what is only set up before the call. */
  full?: boolean;
}

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {children}
      {hint ? (
        <div className="text-xs text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}

/** A text box that keeps its own value while typed into (no caret jumps). */
export function PrepText({
  value,
  onChange,
  placeholder,
  rows = 1,
  rtl,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  rtl?: boolean;
  label: string;
}) {
  const [own, setOwn] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setOwn(value);
  }, [value]);
  const cls =
    "w-full rounded-lg border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/50";
  const props = {
    value: own,
    "aria-label": label,
    placeholder,
    dir: rtl ? ("rtl" as const) : ("auto" as const),
    onFocus: () => {
      focused.current = true;
    },
    onBlur: () => {
      focused.current = false;
    },
  };
  return rows > 1 ? (
    <textarea
      {...props}
      rows={rows}
      className={cls}
      onChange={e => {
        setOwn(e.target.value);
        onChange(e.target.value);
      }}
    />
  ) : (
    <input
      {...props}
      className={cls}
      onChange={e => {
        setOwn(e.target.value);
        onChange(e.target.value);
      }}
    />
  );
}

export function Toggle({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm">
      <input
        type="checkbox"
        className="mt-0.5 size-4 accent-[var(--mahara-teal)]"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
      />
      <span>{children}</span>
    </label>
  );
}

/** Done, To do, Not checked yet: the three a status can be (missing is never zero). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-lg border p-0.5"
    >
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md px-2 py-1 text-xs font-medium transition-colors",
            value === o.value
              ? "bg-primary/15 text-foreground ring-1 ring-inset ring-primary/40"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const STATUS: { value: AccessStatus; label: string }[] = [
  { value: "done", label: SHARED.status.done.en },
  { value: "todo", label: SHARED.status.todo.en },
  { value: "unchecked", label: SHARED.status.unchecked.en },
];

function GoalsControls({ d, prep, setPrep }: ControlsProps) {
  const goals = record(prep.onboarding.goals);
  const goalsAr = record(prep.onboarding.goals_ar);
  const put = (key: "goals" | "goals_ar", k: string, v: string) => {
    const base = key === "goals" ? goals : goalsAr;
    setPrep("onboarding", { [key]: { ...base, [k]: v.trim() || null } });
  };
  return (
    <div className="space-y-4">
      {d.goals.map(g => (
        <Field
          key={g.key}
          label={g.label.en}
          hint={
            g.held ? (
              <span className="txt-warn">
                Held back from the slide:{" "}
                {g.held === "count"
                  ? "it counts enquiries or appointments"
                  : "it mentions a guarantee or a refund"}
                . Write it here without that to show it.
              </span>
            ) : g.form ? (
              `From the onboarding form: ${g.form}`
            ) : (
              "Not answered in the onboarding form."
            )
          }
        >
          <PrepText
            label={`${g.label.en}, edit`}
            value={typeof goals[g.key] === "string" ? String(goals[g.key]) : ""}
            placeholder={
              g.form
                ? "Edit their words (blank keeps the form's)"
                : "Type their answer"
            }
            rows={2}
            onChange={v => put("goals", g.key, v)}
          />
          <PrepText
            label={`${g.label.en}, Arabic`}
            value={
              typeof goalsAr[g.key] === "string" ? String(goalsAr[g.key]) : ""
            }
            placeholder="بالعربي، للعرض العربي"
            rtl
            onChange={v => put("goals_ar", g.key, v)}
          />
        </Field>
      ))}
    </div>
  );
}

function ServiceControls({ d, prep, setPrep }: ControlsProps) {
  const p = prep.onboarding;
  return (
    <div className="space-y-4">
      <Field
        label="Launch service"
        hint={
          d.serviceChosen
            ? "Chosen on the call."
            : d.serviceFocus
              ? `Not chosen yet. Until it is, the deck uses "${d.serviceFocus}" from the ${d.serviceFocusFrom === "kickoff" ? "kickoff form" : "onboarding form"}.`
              : "Not chosen yet, and neither form names one."
        }
      >
        <PrepText
          label="Launch service"
          value={typeof p.service_focus === "string" ? p.service_focus : ""}
          onChange={v => setPrep("onboarding", { service_focus: v })}
        />
        <PrepText
          label="Launch service, Arabic"
          value={
            typeof p.service_focus_ar === "string" ? p.service_focus_ar : ""
          }
          placeholder="اسم الخدمة بالعربي"
          rtl
          onChange={v => setPrep("onboarding", { service_focus_ar: v })}
        />
      </Field>
      <Field
        label="Their services, one per line"
        hint={
          d.servicesFrom === "form"
            ? "From the onboarding form, prices taken out. Edit to change the chips."
            : d.servicesFrom === "kickoff"
              ? "Only the kickoff's advertised service. Add the others here or on the slide."
              : d.servicesFrom === "prep"
                ? "Edited here."
                : "None in the forms. Type them here or on the slide."
        }
      >
        <PrepText
          label="Their services"
          rows={4}
          value={(strings(p.services).length
            ? strings(p.services)
            : d.services
          ).join("\n")}
          onChange={v =>
            setPrep("onboarding", {
              services: v
                .split("\n")
                .map(x => x.trim())
                .filter(Boolean),
            })
          }
        />
      </Field>
      <Toggle
        checked={p.starter_pack === true}
        onChange={v => setPrep("onboarding", { starter_pack: v || null }, true)}
      >
        A ready starter pack exists for {d.serviceFocus ?? "the launch service"}
        <span className="block text-xs text-muted-foreground">
          Only then does slide 7 name the service and show the starter ads.
        </span>
      </Toggle>
    </div>
  );
}

function AccessControls({ d, prep, setPrep }: ControlsProps) {
  const access = record(prep.onboarding.access);
  return (
    <div className="space-y-3">
      {d.access.map(row => (
        <div key={row.key} className="space-y-1.5 rounded-lg border p-2.5">
          <div className="text-sm font-medium">{row.name.en}</div>
          {row.ticks.map(k => (
            <div
              key={k.key}
              className="flex flex-wrap items-center justify-between gap-2"
            >
              <div className="min-w-0 text-xs text-muted-foreground">
                {row.ticks.length > 1 ? `${k.label.en}. ` : ""}
                {k.answer
                  ? `Kickoff: ${k.answer}`
                  : k.from === "prep"
                    ? "Set on this call."
                    : "No answer yet."}
              </div>
              <Segmented
                label={`${row.name.en} ${k.label.en}`}
                value={k.status}
                options={STATUS}
                onChange={v =>
                  setPrep(
                    "onboarding",
                    { access: { ...access, [k.key]: v } },
                    true,
                  )
                }
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function RedLineControls({ d, prep, setPrep }: ControlsProps) {
  const p = prep.onboarding;
  return (
    <div className="space-y-3">
      <Field
        label="Red lines, one per line, in their words"
        hint="They come back on the launch deck. After the call, copy them to the card's Do's & Don'ts."
      >
        <PrepText
          label="Red lines"
          rows={4}
          value={strings(p.red_lines).join("\n")}
          onChange={v =>
            setPrep("onboarding", {
              red_lines: v
                .split("\n")
                .map(x => x.trim())
                .filter(Boolean),
            })
          }
        />
      </Field>
      {d.dosDonts.do.length || d.dosDonts.dont.length ? (
        <div className="text-xs text-muted-foreground">
          The card's Do's & Don'ts already has{" "}
          {d.dosDonts.do.length + d.dosDonts.dont.length} item
          {d.dosDonts.do.length + d.dosDonts.dont.length === 1 ? "" : "s"}.
        </div>
      ) : null}
    </div>
  );
}

/** The controls for one slide (the onboarding deck; the launch deck adds its own). */
export function SlideControls(props: ControlsProps) {
  const { slideId, d, book, full } = props;
  switch (slideId) {
    case "goals":
      return <GoalsControls {...props} />;
    case "one-service":
      return <ServiceControls {...props} />;
    case "this-week":
      return <AccessControls {...props} />;
    case "road":
      return book ? (
        <div className="flex flex-wrap gap-2">
          {book(
            "blueprint",
            d.next.blueprint
              ? "Book the Blueprint again"
              : "Book the Brand Blueprint call",
          )}
          {full
            ? book(
                "launch",
                d.next.launch
                  ? "Book the launch call again"
                  : "Book the launch call",
              )
            : null}
        </div>
      ) : null;
    case "next":
      return (
        <div className="space-y-4">
          <RedLineControls {...props} />
          <ServiceControls {...props} />
          {book ? (
            <div className="flex flex-wrap gap-2">
              {book(
                "blueprint",
                d.next.blueprint
                  ? "Book the Blueprint again"
                  : "Book the Brand Blueprint call",
              )}
            </div>
          ) : null}
        </div>
      );
    default:
      return null;
  }
}

/** The group's links, as the CSM pastes them, in the deck's language (CONTENT O6). */
export function groupLinks(d: DeckData): { text: string; missing: string[] } {
  const missing: string[] = [];
  const G = GROUP_LINKS;
  const line = (l: L, url: string) => fill(l[d.lang], { url });
  const lines = [
    line(G.meta, d.links.leadsie),
    d.links.drive ? line(G.drive, d.links.drive) : null,
    line(G.academy, d.links.academy),
    line(G.portal, d.links.portal),
    line(G.install, d.links.portalInstall),
  ].filter((x): x is string => Boolean(x));
  if (!d.links.drive)
    missing.push("No Drive folder link on the card, so it is left out.");
  // O7's testing plant in writing while its video is not recorded (score
  // round 2), then the onboarding deck's recorded videos (CONTENT O6).
  const testing = slotCovered(d, "testing") ? null : G.testingShort[d.lang];
  const videos = recapVideos(d);
  return {
    text: [
      lines.join("\n"),
      ...(testing ? ["", testing] : []),
      ...(videos ? ["", videos] : []),
    ].join("\n"),
    missing,
  };
}

export const BLUEPRINT_LINE = `${O.next.bandHead.en} · ${O.next.bandRest.en}`;
