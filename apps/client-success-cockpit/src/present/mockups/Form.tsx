import {
  ArrowLeft,
  Camera,
  ChevronLeft,
  Mic,
  Paperclip,
  Phone as PhoneIcon,
  Play,
  Video,
  X,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { FORM_APP, type L, LAUNCH, type Lang, t } from "../content";
import type { Creative } from "../creative";
import type { FormQuestion, LaunchForm } from "../launchData";
import { Avatar, type Identity } from "./Identity";

/**
 * Where the ad leads, on the customer's phone (DESIGN 7.5): Meta's instant
 * form in its dark colours, drawn from the form the CSM confirmed in prep
 * (never another client's screenshot, never a name match), or the drawn
 * example form, tagged on the slide. A WhatsApp destination opens a chat;
 * a landing page shows the screenshot prep uploaded. No phone number is
 * ever drawn: contact fields are empty, "Filled in by Meta".
 */

export type FormScreen = "intro" | "questions" | "thanks";

const ARABIC = /[؀-ۿ]/;

/** The example form's questions, in the deck's words (CONTENT-AR L5). */
export function exampleQuestions(
  service: string | null,
  lang: Lang,
): FormQuestion[] {
  const E = LAUNCH.form.example;
  const tt = (l: L) => t(l, lang);
  return [
    {
      label: tt(E.q1),
      options: [service ?? tt(E.q1other), ...(service ? [tt(E.q1other)] : [])],
      isGate: false,
      note: null,
      type: "choice",
    },
    {
      label: tt(E.q2),
      options: E.q2options.map(tt),
      isGate: true,
      note: null,
      type: "choice",
    },
    {
      label: tt(E.q3),
      options: E.q3options.map(tt),
      isGate: false,
      note: null,
      type: "choice",
    },
    { label: "", options: [], isGate: false, note: null, type: "name" },
    { label: "", options: [], isGate: false, note: null, type: "phone" },
  ];
}

const contactLabel = (q: FormQuestion, app: Lang): string =>
  q.type === "name"
    ? t(FORM_APP.fullName, app)
    : q.type === "phone"
      ? t(FORM_APP.phone, app)
      : q.type === "email"
        ? t(FORM_APP.email, app)
        : q.type === "city"
          ? t(FORM_APP.city, app)
          : q.label;

export const isContact = (q: FormQuestion) =>
  q.type === "name" ||
  q.type === "phone" ||
  q.type === "email" ||
  q.type === "city";

function Top({ back }: { back?: boolean }) {
  return (
    <div className="dkc-form-top" aria-hidden>
      {back ? <ChevronLeft className="dkc-flip" /> : <span />}
      <X />
    </div>
  );
}

/** The instant form, one screen at a time; on questions, `focus` is lit. */
export function InstantForm({
  who,
  pageName,
  app,
  form,
  questions,
  screen,
  focus,
  thanks,
  video,
}: {
  who: Identity;
  pageName: string;
  /** The form's own language (its questions), else the deck's. */
  app: Lang;
  form: LaunchForm;
  questions: FormQuestion[];
  screen: FormScreen;
  /** The question lit on the questions screen (its index in `questions`). */
  focus?: number | null;
  /** The thank-you words. */
  thanks: string;
  video?: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  // Bring the lit question near the top, as a customer scrolls to it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: measured again when the questions change
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || screen !== "questions" || focus == null) {
      setShift(0);
      return;
    }
    const el = list.querySelector<HTMLElement>(`[data-q="${focus}"]`);
    if (!el) return;
    const room = list.parentElement?.clientHeight ?? 0;
    const max = Math.max(0, list.scrollHeight - room + 24);
    setShift(Math.min(max, Math.max(0, el.offsetTop - 12)));
  }, [screen, focus, questions]);
  const greeting =
    form.source === "example" ? t(LAUNCH.form.example.greeting, app) : null;
  return (
    <div className="dkc-app" data-app="form" dir={app === "ar" ? "rtl" : "ltr"}>
      <div className="dkc-status-bar" aria-hidden>
        <span>10:24</span>
        <i className="dkc-battery" />
      </div>
      {screen === "intro" ? (
        <div className="dkc-form-screen" data-screen="intro">
          <Top />
          <div className="dkc-form-intro">
            <Avatar who={who} size="calc(var(--u) * 64)" />
            <b dir="auto">{pageName}</b>
            {form.headline ? (
              <h4 dir="auto">{form.headline}</h4>
            ) : greeting ? null : (
              <div className="dkc-bars" aria-hidden>
                <i style={{ width: "80%" }} />
                <i style={{ width: "56%" }} />
              </div>
            )}
            {greeting ? <p dir="auto">{greeting}</p> : null}
          </div>
          <div className="dkc-form-next">{t(FORM_APP.next, app)}</div>
        </div>
      ) : screen === "questions" ? (
        <div className="dkc-form-screen" data-screen="questions">
          <Top back />
          <div className="dkc-form-scroll">
            <div
              ref={listRef}
              className="dkc-form-list"
              style={{ transform: `translateY(${-shift}px)` }}
            >
              {questions.map((q, i) => (
                <div
                  key={`${q.type}-${q.label}-${String(i)}`}
                  className="dkc-form-q"
                  data-q={i}
                  data-part={i === focus ? "question" : undefined}
                  data-dim={focus != null && i !== focus ? "" : undefined}
                >
                  {isContact(q) ? (
                    <>
                      <span className="dkc-form-label">
                        {contactLabel(q, app)}
                      </span>
                      <span className="dkc-form-field">
                        <span>{t(FORM_APP.byMeta, app)}</span>
                      </span>
                    </>
                  ) : (
                    <>
                      <b dir="auto">{q.label}</b>
                      {q.options.map(o => (
                        <span
                          key={o}
                          className="dkc-form-opt"
                          dir={ARABIC.test(o) ? "rtl" : "ltr"}
                        >
                          <span>{o}</span>
                          <i aria-hidden />
                        </span>
                      ))}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="dkc-form-next">{t(FORM_APP.next, app)}</div>
        </div>
      ) : (
        <div className="dkc-form-screen" data-screen="thanks">
          <Top />
          <div className="dkc-form-intro dkc-form-thanks">
            <Avatar who={who} size="calc(var(--u) * 64)" />
            <b dir="auto">{pageName}</b>
            <p dir="auto">{thanks}</p>
            {video ? (
              <span className="dkc-form-video" aria-hidden>
                <Play />
              </span>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

/** A WhatsApp chat opening from the ad, the message waiting to be sent. */
export function WhatsAppChat({
  who,
  pageName,
  app,
}: {
  who: Identity;
  pageName: string;
  app: Lang;
}) {
  return (
    <div className="dkc-app" data-app="wa" dir={app === "ar" ? "rtl" : "ltr"}>
      <div className="dkc-status-bar" aria-hidden>
        <span>10:24</span>
        <i className="dkc-battery" />
      </div>
      <div className="dkc-wa-head">
        <ArrowLeft className="dkc-flip" aria-hidden />
        <Avatar who={who} size="calc(var(--u) * 36)" />
        <b dir="auto">{pageName}</b>
        <Video aria-hidden />
        <PhoneIcon aria-hidden />
      </div>
      <div className="dkc-wa-body" />
      <div className="dkc-wa-compose" aria-hidden>
        <Paperclip />
        <div className="dkc-wa-input">
          <i style={{ width: "72%" }} />
        </div>
        <Camera />
        <Mic />
      </div>
    </div>
  );
}

/** Their landing page: the phone screenshot prep uploaded, or a quiet frame. */
export function PageShot({
  shot,
  deck,
}: {
  shot: Creative | null;
  deck: Lang;
}) {
  return (
    <div className="dkc-app" data-app="page">
      {shot?.url ? (
        <img
          className="dkc-page-shot"
          src={shot.url}
          alt=""
          draggable={false}
        />
      ) : (
        <span className="dkc-media-empty" dir={deck === "ar" ? "rtl" : "ltr"}>
          {t(LAUNCH.form.page, deck)}
        </span>
      )}
    </div>
  );
}
