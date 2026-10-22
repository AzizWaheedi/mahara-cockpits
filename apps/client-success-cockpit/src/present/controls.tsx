import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  EXAMPLE,
  fill,
  GROUP_LINKS,
  type L,
  O,
  SERVICES,
  SHARED,
} from "./content";
import type { AccessStatus, CallKind, DeckData, Overrides } from "./deckData";
import {
  choiceOf,
  feedUrl,
  isTheme,
  parseChoice,
  pickableScenes,
  SCENES,
} from "./examples";
import {
  isMain,
  MAIN,
  type MainKey,
  sameWords,
  serviceOfText,
} from "./services";
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

/**
 * The example ad (DESIGN 22.14): match their service, or a service and then
 * one of its pictures. Native selects, the picture beside them as the
 * preview. Saved on the onboarding row (`example_theme`: a service's key
 * for its lead picture, else the scene; `choiceOf`) and read by both decks.
 */
export function ExampleSwitch({
  d,
  prep,
  setPrep,
}: {
  d: DeckData;
  prep: Overrides;
  setPrep: ControlsProps["setPrep"];
}) {
  const ex = d.example;
  const choice = parseChoice(prep.example_theme);
  // The service whose pictures the second select lists: the one chosen in
  // the first select this session, else the one the deck reads (a saved
  // scene shared by two services reads as the client's own, else the
  // first that has it).
  const [picked, setPicked] = useState<MainKey | null>(null);
  const shown: MainKey =
    picked && (!choice || SCENES[picked].includes(choice.scene))
      ? picked
      : ex.service;
  const save = (v: string | null) =>
    setPrep("onboarding", { example_theme: v }, true);
  const name = EXAMPLE.names[ex.theme];
  const svcName = SERVICES[ex.service].name.en;
  return (
    <Field
      label="Example ad"
      hint="Shown only until they have ads of their own, and labelled Example ad on the slide. Choose a service, then one of its pictures."
    >
      <div className="flex items-start gap-3">
        <img
          src={feedUrl(ex.theme)}
          alt=""
          className="h-[120px] w-[96px] shrink-0 rounded-md border object-cover"
        />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="text-xs">
            {ex.from === "prep"
              ? `${svcName}: ${name}, chosen here`
              : ex.from === "service"
                ? `${svcName}: ${name}, their service`
                : `${svcName}: ${name}. No service on file yet, so interior design's`}
          </div>
          <select
            className="h-8 w-full rounded-md border bg-background px-2 text-sm"
            value={choice ? shown : ""}
            aria-label="Example ad, service"
            onChange={e => {
              const v = e.target.value;
              setPicked(isMain(v) ? v : null);
              save(isMain(v) ? v : null);
            }}
          >
            <option value="">Match their service</option>
            {MAIN.map(k => (
              <option key={k} value={k}>
                {SERVICES[k].name.en}
              </option>
            ))}
          </select>
          <select
            className="h-8 w-full rounded-md border bg-background px-2 text-sm"
            value={choice ? choice.scene : ""}
            aria-label="Example ad, picture"
            onChange={e => {
              const v = e.target.value;
              setPicked(shown);
              save(isTheme(v) ? choiceOf(shown, v) : null);
            }}
          >
            <option value="">
              {choice
                ? "Their service's pictures"
                : "Their service's lead picture"}
            </option>
            {/* A kitchen or a bathroom saved before (fixer round 2) is
                listed only while it is the choice, so the select says
                what the deck shows; it is never offered. */}
            {choice && !pickableScenes(shown).includes(choice.scene) ? (
              <option value={choice.scene}>
                {EXAMPLE.names[choice.scene]}, a room, not the service
              </option>
            ) : null}
            {pickableScenes(shown).map(x => (
              <option key={x} value={x}>
                {EXAMPLE.names[x]}
              </option>
            ))}
          </select>
        </div>
      </div>
    </Field>
  );
}

/**
 * The starter pack is made for one service (fixer round 2): the tick saves
 * that service's key ("other" for their own words), so a different choice
 * on slide 4 leaves slide 7 without the pack until it is ticked for the
 * new one. With no service on file yet it saves a plain yes, read as the
 * kickoff's service.
 */
function StarterPackToggle({
  d,
  setPrep,
}: {
  d: DeckData;
  setPrep: ControlsProps["setPrep"];
}) {
  const key = d.service.key;
  const was = d.starterPack ? null : d.starterPackFor;
  const other = was
    ? isMain(was)
      ? SERVICES[was].mid.en
      : "their own service"
    : null;
  return (
    <Toggle
      checked={d.starterPack}
      onChange={v =>
        setPrep("onboarding", { starter_pack: v ? (key ?? true) : null }, true)
      }
    >
      A ready starter pack exists for {d.serviceMid ?? "the launch service"}
      <span className="block text-xs text-muted-foreground">
        {other
          ? `Ticked for ${other}, so slide 7 leaves the pack out while the service is ${d.serviceMid ?? "not chosen"}. Tick it again if the pack fits this one.`
          : "Only then does slide 7 name the service and show the starter ads."}
      </span>
    </Toggle>
  );
}

/** The launch service in prep: one of the five, or Other in their words. */
function ServicePicker({ d, prep, setPrep }: ControlsProps) {
  const p = prep.onboarding;
  const typed = typeof p.service_focus === "string" ? p.service_focus : "";
  const typedKey = serviceOfText(typed);
  const [other, setOther] = useState(Boolean(typed) && !typedKey);
  // Once Other is picked here it stays open while their words are typed,
  // even when the words turn out to belong to one of the five.
  const value = other ? "other" : (typedKey ?? (typed ? "other" : ""));
  return (
    <div className="space-y-1.5">
      <select
        className="h-8 w-full rounded-md border bg-background px-2 text-sm"
        value={value}
        aria-label="Launch service"
        onChange={e => {
          const v = e.target.value;
          if (v === "other") {
            setOther(true);
            setPrep("onboarding", {
              service_focus: typedKey ? null : typed || null,
              service_focus_ar: null,
            });
            return;
          }
          setOther(false);
          setPrep(
            "onboarding",
            isMain(v)
              ? {
                  service_focus: SERVICES[v].name.en,
                  service_focus_ar: SERVICES[v].name.ar,
                }
              : { service_focus: null, service_focus_ar: null },
            true,
          );
        }}
      >
        <option value="">
          {d.service.key &&
          d.service.from !== "prep" &&
          d.service.from !== "chosen"
            ? `From the ${d.service.from === "kickoff" ? "kickoff form" : "onboarding form"}`
            : "Not set"}
        </option>
        {MAIN.map(k => (
          <option key={k} value={k}>
            {SERVICES[k].name.en}
          </option>
        ))}
        <option value="other">Other, in their words</option>
      </select>
      {value === "other" ? (
        <>
          <PrepText
            label="Their service, in their words"
            value={typed}
            placeholder="Their service, in their words"
            onChange={v => setPrep("onboarding", { service_focus: v })}
          />
          <PrepText
            label="Their service, Arabic"
            value={
              typeof p.service_focus_ar === "string" ? p.service_focus_ar : ""
            }
            placeholder="الخدمة بكلامهم"
            rtl
            onChange={v => setPrep("onboarding", { service_focus_ar: v })}
          />
        </>
      ) : null}
    </div>
  );
}

function ServiceControls({ d, prep, setPrep, ...rest }: ControlsProps) {
  const p = prep.onboarding;
  const named = d.service.key
    ? d.service.key === "other"
      ? `Other: "${d.service.words.en ?? d.service.words.ar ?? "their words"}"`
      : SERVICES[d.service.key].name.en
    : null;
  return (
    <div className="space-y-4">
      <Field
        label="Launch service"
        hint={
          d.today.service ? (
            <span className="flex flex-wrap items-center gap-2">
              Chosen on the call with Launch with this.
              {/* Undo clears the stamp: the checklist's item opens again. */}
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={() =>
                  setPrep("onboarding", { service_chosen_at: null }, true)
                }
              >
                Undo the choice
              </button>
            </span>
          ) : d.service.from === "prep" ? (
            "Suggested here. Slide 4 starts on it; the client chooses with Launch with this, and until then the checklist keeps it open."
          ) : named ? (
            `Not chosen yet. Slide 4 starts on ${named}, from the ${d.service.from === "kickoff" ? "kickoff form" : "onboarding form"}${d.service.text && !sameWords(d.service.text, named) ? ` ("${d.service.text}")` : ""}.`
          ) : (
            "Not chosen yet, and neither form names one. The client picks one of the five on slide 4."
          )
        }
      >
        <ServicePicker d={d} prep={prep} setPrep={setPrep} {...rest} />
      </Field>
      <Field
        label="Their services, one per line"
        hint={
          d.servicesFrom === "form"
            ? "From the onboarding form, prices taken out. Each shows quietly under the main service it belongs to on slide 4."
            : d.servicesFrom === "kickoff"
              ? "Only the kickoff's advertised service. Add the others here."
              : d.servicesFrom === "prep"
                ? "Edited here. Each shows quietly under the main service it belongs to on slide 4."
                : "None in the forms. Type them here, in their words."
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
      <Field
        label="The same, in Arabic"
        hint="For the Arabic deck: slide 4's quiet lines and the call queue. Blank, it shows their words as written."
      >
        <PrepText
          label="Their services in Arabic"
          rows={4}
          rtl
          value={strings(p.services_ar).join("\n")}
          onChange={v =>
            setPrep("onboarding", {
              services_ar: v
                .split("\n")
                .map(x => x.trim())
                .filter(Boolean),
            })
          }
        />
      </Field>
      <ExampleSwitch d={d} prep={p} setPrep={setPrep} />
      <StarterPackToggle d={d} setPrep={setPrep} />
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
