import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  MessageSquareText,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Kicker } from "@/components/ceo/Kicker";
import {
  AUTOFILLED,
  type LeadFormQuestion,
  type LeadFormSpec,
  questionLabel,
} from "@/lib/leadForm";
import { cn } from "@/lib/utils";

/** The screens a lead steps through, in the order Meta shows them. */
export type FormScreen = "intro" | "questions" | "review" | "sms" | "thankYou";

const SCREEN_NAME: Record<FormScreen, string> = {
  intro: "Greeting",
  questions: "Questions",
  review: "Review step",
  sms: "SMS code",
  thankYou: "Thank you",
};

export function formScreens(spec: LeadFormSpec): FormScreen[] {
  const s: FormScreen[] = [];
  if (spec.intro) s.push("intro");
  s.push("questions");
  if (spec.higherIntent) s.push("review");
  if (spec.smsVerify) s.push("sms");
  s.push("thankYou");
  return s;
}

const BUTTON_WORDS: Record<string, string> = {
  VIEW_WEBSITE: "View website",
  CALL_BUSINESS: "Call business",
  WHATSAPP: "Message on WhatsApp",
  MESSAGE_BUSINESS: "Send message",
  DOWNLOAD: "Download",
};

/** What an autofilled field shows before the person touches it. */
const SAMPLE: Record<string, string> = {
  FULL_NAME: "Sara Al-Ahmad",
  FIRST_NAME: "Sara",
  LAST_NAME: "Al-Ahmad",
  EMAIL: "sara@example.com",
  PHONE: "+965 •••• ••12",
  WHATSAPP_NUMBER: "+965 •••• ••12",
  CITY: "Kuwait City",
  COMPANY_NAME: "Al-Ahmad Trading",
  JOB_TITLE: "Owner",
};

/**
 * A form exactly as a lead steps through it on their phone: the greeting,
 * the questions with what Meta fills in for them, the review step, the SMS
 * code and the thank-you screen. Pass `screen` to hold it on one screen (the
 * editor does, to follow the part being edited).
 */
export function FormPreview({
  spec,
  pageName,
  screen,
  onScreenChange,
  className,
}: {
  spec: LeadFormSpec;
  /** The client's Facebook Page, shown where Meta shows it. */
  pageName?: string;
  screen?: FormScreen;
  onScreenChange?: (s: FormScreen) => void;
  className?: string;
}) {
  const screens = useMemo(() => formScreens(spec), [spec]);
  const [own, setOwn] = useState<FormScreen>(screens[0] ?? "questions");
  const current = screen && screens.includes(screen) ? screen : own;
  const index = Math.max(0, screens.indexOf(current));
  const reduce = useReducedMotion();

  // A screen the draft no longer has (the greeting was switched off) falls back to the first.
  useEffect(() => {
    if (!screens.includes(own)) setOwn(screens[0] ?? "questions");
  }, [screens, own]);

  const go = (by: number) => {
    const next = screens[Math.min(screens.length - 1, Math.max(0, index + by))];
    if (!next) return;
    setOwn(next);
    onScreenChange?.(next);
  };

  return (
    <figure
      className={cn("flex shrink-0 flex-col items-center gap-3", className)}
    >
      <div className="relative w-[272px] rounded-[2.4rem] border border-white/10 bg-[#05070d] p-2 shadow-[0_24px_60px_-20px_rgb(0_0_0/0.65)]">
        <div className="relative h-[540px] overflow-hidden rounded-[1.95rem] bg-[#f0f2f5] text-[#1c1e21]">
          <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-2 border-b border-black/5 bg-white px-3 pb-2 pt-5">
            <span className="grid size-7 place-items-center rounded-full bg-[#091333] text-[11px] font-semibold text-[#00cfc8]">
              {(pageName ?? "M").trim().charAt(0).toUpperCase()}
            </span>
            <span
              className="min-w-0 flex-1 truncate text-[12px] font-semibold"
              dir="auto"
            >
              {pageName ?? "The client's Page"}
            </span>
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={current}
              initial={reduce ? false : { opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, x: -12 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="absolute inset-0 overflow-y-auto px-3 pb-4 pt-16"
            >
              {current === "intro" && <Intro spec={spec} />}
              {current === "questions" && (
                <Questions
                  spec={spec}
                  pageName={pageName}
                  last={screens.at(-2) === "questions"}
                />
              )}
              {current === "review" && <Review spec={spec} />}
              {current === "sms" && <Sms />}
              {current === "thankYou" && <ThankYou spec={spec} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
      <figcaption className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => go(-1)}
          disabled={index === 0}
          className="grid size-7 place-items-center rounded-full border text-muted-foreground transition hover:text-foreground disabled:opacity-30"
          aria-label="Previous screen"
        >
          <ChevronLeft className="size-4" />
        </button>
        <div className="min-w-32 text-center">
          <Kicker as="span">{SCREEN_NAME[current]}</Kicker>
          <span className="block font-mono text-[11px] text-muted-foreground/70">
            {index + 1} of {screens.length}
          </span>
        </div>
        <button
          type="button"
          onClick={() => go(1)}
          disabled={index === screens.length - 1}
          className="grid size-7 place-items-center rounded-full border text-muted-foreground transition hover:text-foreground disabled:opacity-30"
          aria-label="Next screen"
        >
          <ChevronRight className="size-4" />
        </button>
      </figcaption>
    </figure>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white p-3 shadow-[0_1px_2px_rgb(0_0_0/0.08)]">
      {children}
    </div>
  );
}

function MetaButton({
  children,
  muted,
}: {
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "mt-3 rounded-lg py-2 text-center text-[13px] font-semibold",
        muted ? "bg-[#e4e6eb] text-[#1c1e21]" : "bg-[#0866ff] text-white",
      )}
      dir="auto"
    >
      {children}
    </div>
  );
}

function Intro({ spec }: { spec: LeadFormSpec }) {
  const intro = spec.intro;
  if (!intro) return null;
  return (
    <Card>
      <p className="text-[15px] font-bold leading-snug" dir="auto">
        {intro.title || "Headline"}
      </p>
      {intro.style === "LIST_STYLE" ? (
        <ul className="mt-2 space-y-1.5 text-[12.5px] leading-snug" dir="auto">
          {intro.content.filter(Boolean).map((line, i) => (
            <li key={`${i}-${line}`} className="flex gap-2">
              <span className="mt-[7px] size-1 shrink-0 rounded-full bg-[#65676b]" />
              <span dir="auto">{line}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p
          className="mt-2 whitespace-pre-line text-[12.5px] leading-snug"
          dir="auto"
        >
          {intro.content[0]}
        </p>
      )}
      <MetaButton>{intro.buttonText || "Continue"}</MetaButton>
    </Card>
  );
}

function Field({ q }: { q: LeadFormQuestion }) {
  const autofilled = AUTOFILLED.has(q.type);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11.5px] font-semibold text-[#65676b]" dir="auto">
          {questionLabel(q)}
        </span>
        {autofilled && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#fff4d6] px-1.5 py-px text-[9.5px] font-semibold text-[#8a5a00]">
            <Sparkles className="size-2.5" />
            Autofilled
          </span>
        )}
      </div>
      {q.type === "CUSTOM" && q.options?.length ? (
        <div className="space-y-1">
          {q.options.map(o => (
            <div
              key={o.key}
              className="flex items-center gap-2 rounded-md border border-[#ced0d4] px-2 py-1.5 text-[12px]"
              dir="auto"
            >
              <span className="size-3 shrink-0 rounded-full border border-[#8a8d91]" />
              <span className="min-w-0 truncate">{o.value || "Answer"}</span>
            </div>
          ))}
        </div>
      ) : (
        <div
          className={cn(
            "rounded-md border px-2 py-1.5 text-[12px]",
            autofilled
              ? "border-[#ced0d4] text-[#1c1e21]"
              : "border-[#ced0d4] text-[#8a8d91]",
          )}
          dir="auto"
        >
          {autofilled
            ? (SAMPLE[q.type] ?? "Filled in from their profile")
            : "Their answer"}
        </div>
      )}
    </div>
  );
}

function Questions({
  spec,
  pageName,
  last,
}: {
  spec: LeadFormSpec;
  pageName?: string;
  last: boolean;
}) {
  return (
    <Card>
      <p className="text-[14px] font-bold leading-snug" dir="auto">
        {spec.headline || "Contact information"}
      </p>
      <div className="mt-3 space-y-3">
        {spec.questions.map(q => (
          <Field key={q.key} q={q} />
        ))}
      </div>
      <p className="mt-3 text-[10px] leading-snug text-[#65676b]" dir="auto">
        By tapping {last ? "Submit" : "Next"}, you agree to send your info to{" "}
        {pageName ?? "the business"}
        {spec.privacy?.url ? (
          <>
            , who agrees to use it according to their{" "}
            <span className="font-semibold text-[#0866ff]">
              {spec.privacy.linkText || "privacy policy"}
            </span>
          </>
        ) : null}
        .
      </p>
      <MetaButton>{last ? "Submit" : "Next"}</MetaButton>
    </Card>
  );
}

function Review({ spec }: { spec: LeadFormSpec }) {
  return (
    <Card>
      <p className="text-[14px] font-bold">Review your info</p>
      <p className="mt-1 text-[11px] text-[#65676b]">
        Check that everything is right before you submit.
      </p>
      <dl className="mt-3 space-y-2">
        {spec.questions.map(q => (
          <div key={q.key} className="border-b border-black/5 pb-1.5">
            <dt className="text-[10.5px] text-[#65676b]" dir="auto">
              {questionLabel(q)}
            </dt>
            <dd className="text-[12px]" dir="auto">
              {AUTOFILLED.has(q.type)
                ? (SAMPLE[q.type] ?? "From their profile")
                : q.options?.[0]?.value || "Their answer"}
            </dd>
          </div>
        ))}
      </dl>
      <MetaButton>Submit</MetaButton>
      <MetaButton muted>Edit</MetaButton>
    </Card>
  );
}

function Sms() {
  return (
    <Card>
      <MessageSquareText className="size-6 text-[#0866ff]" />
      <p className="mt-2 text-[14px] font-bold">Confirm your phone number</p>
      <p className="mt-1 text-[11.5px] leading-snug text-[#65676b]">
        Enter the code sent to +965 •••• ••12. The form only submits once the
        code matches.
      </p>
      <div className="mt-3 flex justify-between gap-1">
        {[0, 1, 2, 3, 4, 5].map(i => (
          <span
            key={i}
            className="h-9 flex-1 rounded-md border border-[#ced0d4] bg-white"
          />
        ))}
      </div>
      <MetaButton>Verify</MetaButton>
    </Card>
  );
}

function ThankYou({ spec }: { spec: LeadFormSpec }) {
  const t = spec.thankYou;
  return (
    <Card>
      <CircleCheck className="size-7 text-[#31a24c]" />
      <p className="mt-2 text-[15px] font-bold leading-snug" dir="auto">
        {t?.title || "Thanks, you're all set."}
      </p>
      {(t?.body || !t) && (
        <p
          className="mt-1 whitespace-pre-line text-[12px] leading-snug text-[#65676b]"
          dir="auto"
        >
          {t?.body ||
            "Meta's own thank-you screen: no next step for the lead to take."}
        </p>
      )}
      {t && t.buttonType !== "NONE" && (
        <MetaButton>
          {t.buttonText || BUTTON_WORDS[t.buttonType] || "Continue"}
        </MetaButton>
      )}
    </Card>
  );
}
