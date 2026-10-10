import {
  AUTOFILLED,
  isFiltering,
  type LeadFormSpec,
  questionLabel,
} from "@/lib/leadForm";
import { cn } from "@/lib/utils";
import type { FormScreen } from "./FormPreview";

const BUTTON: Record<string, string> = {
  VIEW_WEBSITE: "a button to the website",
  CALL_BUSINESS: "a button to call the business",
  WHATSAPP: "a WhatsApp button",
  MESSAGE_BUSINESS: "a Messenger button",
  DOWNLOAD: "a download button",
  NONE: "no button",
};

function host(url?: string): string {
  if (!url) return "";
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** The questions in one line: what filters, and what Meta fills in for them. */
export function questionsLine(spec: LeadFormSpec): string {
  const filters = spec.questions.filter(isFiltering);
  const filled = spec.questions.filter(q => AUTOFILLED.has(q.type));
  const parts = [
    `${spec.questions.length} question${spec.questions.length === 1 ? "" : "s"}`,
    filters.length
      ? `${filters.length} filter${filters.length === 1 ? "s" : ""} the lead (${filters.map(questionLabel).join(", ")})`
      : "none filters the lead",
    filled.length
      ? `Meta fills in ${filled.length} from their profile`
      : "nothing filled in for them",
  ];
  return `${parts[0]}: ${parts.slice(1).join("; ")}.`;
}

export type JourneyStep = {
  screen: FormScreen;
  name: string;
  on: boolean;
  detail: string;
};

/** Every screen a lead can pass through, in Meta's order, on or off. */
export function journey(spec: LeadFormSpec): JourneyStep[] {
  const t = spec.thankYou;
  return [
    {
      screen: "intro",
      name: "Greeting",
      on: Boolean(spec.intro),
      detail: spec.intro
        ? `Opens on “${spec.intro.title}” before any question.`
        : "Off. The form opens straight on the questions.",
    },
    {
      screen: "questions",
      name: "Questions",
      on: true,
      detail: questionsLine(spec),
    },
    {
      screen: "review",
      name: "Review step",
      on: spec.higherIntent,
      detail: spec.higherIntent
        ? "The lead reads their answers back and taps Submit (Meta's Higher intent form)."
        : "Off. One tap sends whatever Meta filled in.",
    },
    {
      screen: "sms",
      name: "SMS code",
      on: spec.smsVerify,
      detail: spec.smsVerify
        ? "The lead types a code Meta texts to their phone. A wrong number cannot submit."
        : "Off. The phone number is never checked.",
    },
    {
      screen: "thankYou",
      name: "Thank you",
      on: Boolean(t),
      detail: t
        ? `“${t.title}”, with ${BUTTON[t.buttonType] ?? "a button"}${t.buttonType === "VIEW_WEBSITE" && t.websiteUrl ? ` (${host(t.websiteUrl)})` : ""}.`
        : "Off. Meta shows its own short thank-you, with no next step.",
    },
  ];
}

/**
 * The lead's way through the form as a rail of screens. Each switched-on
 * screen moves the phone preview to it, so the list and the phone always
 * show the same place.
 */
export function JourneyRail({
  spec,
  screen,
  onScreen,
  className,
}: {
  spec: LeadFormSpec;
  screen?: FormScreen;
  onScreen?: (s: FormScreen) => void;
  className?: string;
}) {
  const steps = journey(spec);
  return (
    <ol
      className={cn("relative", className)}
      aria-label="What a lead goes through"
    >
      {steps.map((step, i) => {
        const active = step.on && screen === step.screen;
        const last = i === steps.length - 1;
        return (
          <li key={step.screen} className="relative flex gap-3 pb-4 last:pb-0">
            {!last && (
              <span
                aria-hidden
                className="absolute left-[7px] top-5 bottom-0 w-px bg-border"
              />
            )}
            <span
              aria-hidden
              className={cn(
                "relative z-[1] mt-1 grid size-[15px] shrink-0 place-items-center rounded-full border-2",
                step.on
                  ? "border-[color:var(--mahara-teal)] bg-[color:var(--mahara-teal)]"
                  : "border-muted-foreground/40 bg-background",
              )}
            >
              {step.on && (
                <span className="size-1.5 rounded-full bg-background" />
              )}
            </span>
            <button
              type="button"
              disabled={!step.on || !onScreen}
              onClick={() => onScreen?.(step.screen)}
              aria-current={active ? "step" : undefined}
              className={cn(
                "-mx-2 -my-1 min-w-0 flex-1 rounded-md px-2 py-1 text-left transition",
                step.on && onScreen ? "hover:bg-muted/50" : "cursor-default",
                active && "bg-muted/60",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <span className="flex items-baseline gap-2">
                <span
                  className={cn(
                    "text-sm font-medium",
                    !step.on && "text-muted-foreground",
                  )}
                >
                  {step.name}
                </span>
                <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">
                  {step.on ? "On" : "Off"}
                </span>
              </span>
              <span
                className="mt-0.5 block text-xs leading-relaxed text-muted-foreground"
                dir="auto"
              >
                {step.detail}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
