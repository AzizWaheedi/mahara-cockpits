import { createWidget } from "@typeform/embed";
import "@typeform/embed/build/css/widget.css";
import { ArrowUpRight, Check, Copy, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api";
import {
  CLIENT_FORM_ID,
  type ClientFormSent,
  type ClientFormSetting,
  type FormContext,
  formLink,
  type RailRow,
  railFor,
  readyCount,
} from "../lib/clientForm";
import { loadTranscript } from "../lib/data";
import { ago } from "../lib/format";
import { toast } from "../lib/toast";
import type { Deal } from "../lib/types";
import { button, buttonPrimary, StatusChip } from "./kit";

/**
 * The New Client Form on a lead's page: Typeform's own form, embedded with
 * its hidden fields set from the lead, beside what the cockpit already
 * knows for each question, ready to copy (Typeform fills hidden fields in
 * advance, never a visible answer). Typeform saves the response and starts
 * the onboarding as it always has; the cockpit then notes it on the lead.
 *
 * Closing the sheet only hides it, so a form half filled keeps its answers
 * while the closer looks something up on the page.
 */
export function ClientFormSheet({
  open,
  onClose,
  setting,
  ctx,
  hidden,
  already,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  /** The form's questions, from the setting the sales desk keeps; null until it arrives. */
  setting: ClientFormSetting | null;
  ctx: FormContext;
  /** contact_id, closer and setter, for Typeform's hidden fields. */
  hidden: Record<string, string>;
  /** A form already sent for this lead: when and by whom. */
  already: { at: string; by: string | null } | null;
  /** The cockpit noted the response on the lead. */
  onSent: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);
  const rail = useMemo(() => railFor(setting, ctx), [setting, ctx]);
  const counts = readyCount(rail);
  const link = formLink(setting, hidden);

  // Focus moves into the sheet when it opens and back to the button that
  // opened it when it closes; Escape closes it.
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, [open, onClose]);

  // On the page body, so no card or scrolling pane can put the phone's tab
  // bar over it.
  return createPortal(
    <div
      className="fixed inset-0 z-[60]"
      hidden={!open}
      role="dialog"
      aria-modal="true"
      aria-labelledby="client-form-title"
    >
      <button
        type="button"
        aria-label="Close the new client form"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />
      <div className="pt-safe absolute inset-y-0 right-0 flex w-full max-w-[1280px] flex-col border-l hairline bg-[color:var(--background)] shadow-2xl">
        <header className="flex items-start gap-3 border-b hairline px-4 py-3 md:px-6">
          <div className="min-w-0 flex-1">
            <h2
              id="client-form-title"
              className="truncate text-lg font-semibold"
            >
              New client form ·{" "}
              <bdi dir="auto">{ctx.lead.name ?? "this lead"}</bdi>
            </h2>
            <p className="muted hidden text-xs sm:block">
              Typeform's own form: sending it starts the onboarding, as it
              always has. The answers beside it are what the cockpit already
              knows.
            </p>
          </div>
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className={`${button} shrink-0`}
            title="The same form, with the same lead, closer and setter, in its own tab"
          >
            <span className="hidden sm:inline">Open in a new tab</span>
            <span className="sm:hidden">New tab</span>
            <ArrowUpRight className="size-3.5" aria-hidden />
          </a>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className={button}
            aria-label="Close"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        {already ? (
          <p
            className="callout-warn border-b px-4 py-2 text-sm md:px-6"
            role="note"
          >
            A New Client Form for this lead went in {ago(already.at)}
            {already.by ? (
              <>
                {" "}
                from <bdi>{already.by}</bdi>
              </>
            ) : null}
            . Sending another starts the onboarding again: a second sub-account
            and a second welcome message. Fix a wrong answer in Typeform's
            results instead.
          </p>
        ) : null}

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px]">
          <Embed
            open={open}
            formId={setting?.form_id || CLIENT_FORM_ID}
            hidden={hidden}
            link={link}
            onSent={onSent}
          />
          <aside
            className="order-first max-h-[38dvh] min-h-0 overflow-y-auto border-b hairline bg-[color:var(--card)] lg:order-none lg:max-h-none lg:border-b-0 lg:border-l"
            aria-label="Answers the cockpit already has"
          >
            <Rail
              rail={rail}
              ready={counts.ready}
              total={counts.total}
              setting={setting}
            />
          </aside>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Embed({
  open,
  formId,
  hidden,
  link,
  onSent,
}: {
  open: boolean;
  formId: string;
  hidden: Record<string, string>;
  link: string;
  onSent: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const [ready, setReady] = useState(false);
  const [slow, setSlow] = useState(false);
  const [saved, setSaved] = useState<{
    responseId: string;
    error: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const key = JSON.stringify(hidden);

  // Loaded the first time the sheet opens, and kept while the page lives.
  useEffect(() => {
    if (open) setShown(true);
  }, [open]);

  async function note(responseId: string) {
    setBusy(true);
    try {
      await api("client_form.sent", {
        ...JSON.parse(key),
        response_id: responseId,
      });
      setSaved({ responseId, error: null });
      toast.success("New client form sent. The onboarding has started.");
      onSent();
    } catch (e) {
      setSaved({ responseId, error: String((e as Error).message ?? e) });
    } finally {
      setBusy(false);
    }
  }
  const noteRef = useRef(note);
  noteRef.current = note;

  useEffect(() => {
    if (!shown || !box.current) return;
    setReady(false);
    setSlow(false);
    const w = createWidget(formId, {
      container: box.current,
      hidden: JSON.parse(key) as Record<string, string>,
      inlineOnMobile: true,
      medium: "mahara-sales-cockpit",
      onReady: () => setReady(true),
      onSubmit: ({ responseId }) => void noteRef.current(responseId),
    });
    const t = window.setTimeout(() => setSlow(true), 20_000);
    return () => {
      window.clearTimeout(t);
      w.unmount();
    };
  }, [shown, formId, key]);

  return (
    <div className="relative flex min-h-[60dvh] flex-col lg:min-h-0">
      {saved ? (
        <div
          className={`border-b px-4 py-2 text-sm md:px-6 ${saved.error ? "callout-bad" : "callout-good"}`}
          role="status"
        >
          {saved.error ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1">
                Typeform has the form and the onboarding has started, but the
                cockpit could not note it on this lead: {saved.error}
              </p>
              <button
                type="button"
                className={button}
                disabled={busy}
                onClick={() => void note(saved.responseId)}
              >
                {busy ? "Noting it…" : "Try again"}
              </button>
            </div>
          ) : (
            <p>
              Sent. Typeform has it and the onboarding has started; the deal
              reaches the numbers when B2B next reads Typeform (every 15
              minutes).
            </p>
          )}
        </div>
      ) : null}
      <div ref={box} className="min-h-0 flex-1" />
      {!ready ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
          <p className="muted pointer-events-auto max-w-sm text-center text-sm">
            {slow ? (
              <>
                The form has not loaded here.{" "}
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  Open it in a new tab
                </a>
                : it carries the same lead, closer and setter.
              </>
            ) : (
              "Loading the form…"
            )}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Rail({
  rail,
  ready,
  total,
  setting,
}: {
  rail: ReturnType<typeof railFor>;
  ready: number;
  total: number;
  setting: ClientFormSetting | null;
}) {
  const [copied, setCopied] = useState<Set<string>>(new Set());
  const mark = (ref: string) => setCopied(s => new Set(s).add(ref));

  if (!rail.length)
    return (
      <p className="muted p-4 text-sm">
        The list of the form's questions has not reached the cockpit yet (the
        sales desk copies it from Typeform every ten minutes). The form on the
        left works without it.
      </p>
    );

  return (
    <div className="space-y-5 p-4">
      <div>
        <p className="text-sm font-semibold">What the cockpit already has</p>
        <p className="muted text-xs">
          {ready} of {total} answers ready, in the form's order. Copy one, then
          paste it into the question with the same name.
          {setting?.synced_at
            ? ` Questions read from Typeform ${ago(setting.synced_at)}.`
            : ""}
        </p>
      </div>
      {rail.map((screen, i) => (
        <section
          key={`${screen.title}-${i}`}
          aria-label={screen.title || "More questions"}
        >
          {screen.title ? (
            <h3 className="muted mb-1.5 text-[11px] font-semibold uppercase tracking-wider">
              {screen.title}
            </h3>
          ) : null}
          <ul className="divide-y hairline rounded-[var(--radius-md)] border hairline bg-[color:var(--background)]">
            {screen.rows.map(row => (
              <RailItem
                key={row.ref}
                row={row}
                done={copied.has(row.ref)}
                onCopied={() => mark(row.ref)}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function RailItem({
  row,
  done,
  onCopied,
}: {
  row: RailRow;
  done: boolean;
  onCopied: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState<string | null>(null);
  const f = row.fill;

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      onCopied();
      toast.success(`${what} copied.`);
      return true;
    } catch {
      return false;
    }
  }

  async function copyTranscript(path: string) {
    setBusy(true);
    try {
      const text = await loadTranscript(path);
      if (!(await copy(text, "The transcript"))) {
        setManual(text);
        toast.error(
          "The browser would not copy it. Select the transcript below instead.",
        );
      }
    } catch (e) {
      toast.error(
        `The transcript could not be read: ${String((e as Error).message ?? e)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  const label = (
    <p className="muted flex items-center gap-1 text-xs">
      <span className="min-w-0 truncate">{row.label}</span>
      {row.required ? (
        <>
          <span aria-hidden title="Required in the form">
            *
          </span>
          <span className="sr-only">(required)</span>
        </>
      ) : null}
    </p>
  );

  if (f.kind === "type")
    return (
      <li className="px-3 py-2">
        {label}
        <p className="muted text-xs italic">
          {f.hint ?? "Type it in the form."}
        </p>
      </li>
    );

  if (f.kind === "transcript")
    return (
      <li className="px-3 py-2">
        {label}
        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            className={done ? button : buttonPrimary}
            disabled={busy}
            onClick={() => void copyTranscript(f.path)}
          >
            {done ? (
              <Check className="size-3.5" aria-hidden />
            ) : (
              <Copy className="size-3.5" aria-hidden />
            )}
            {busy ? "Reading it…" : done ? "Copied" : "Copy the transcript"}
          </button>
          {f.chars ? (
            <span className="muted text-xs tabular-nums">
              {Math.round(f.chars / 1000)}k characters
            </span>
          ) : null}
        </div>
        {manual ? (
          <textarea
            readOnly
            value={manual}
            className="mt-2 h-32 w-full rounded-[var(--radius-md)] border hairline bg-[color:var(--card)] p-2 text-xs"
            onFocus={e => e.currentTarget.select()}
            aria-label="The transcript, to select and copy"
          />
        ) : null}
      </li>
    );

  return (
    <li className="flex items-center gap-2 px-3 py-2">
      <div className="min-w-0 flex-1">
        {label}
        <p className="flex min-w-0 items-center gap-1.5 text-sm">
          {f.kind === "pick" ? (
            <span className="muted shrink-0 text-[11px] font-medium uppercase tracking-wide">
              Pick
            </span>
          ) : null}
          <bdi className="min-w-0 truncate" dir="auto" title={f.value}>
            {f.value}
          </bdi>
        </p>
        {f.kind === "copy" && f.note ? (
          <p className="muted text-[11px]">{f.note}</p>
        ) : null}
      </div>
      <button
        type="button"
        className={`${button} shrink-0 px-2`}
        onClick={() =>
          void copy(f.value, row.label).then(
            ok =>
              ok ||
              toast.error(
                "The browser would not copy. Select the text instead.",
              ),
          )
        }
        aria-label={`Copy ${row.label}: ${f.value}`}
        title="Copy"
      >
        {done ? (
          <Check className="size-3.5 text-[color:var(--success)]" aria-hidden />
        ) : (
          <Copy className="size-3.5" aria-hidden />
        )}
      </button>
    </li>
  );
}

/**
 * Whether this lead's New Client Form went in, and whether its deal has
 * reached the B2B numbers (B2B reads Typeform every 15 minutes, and the
 * deal comes back to the cockpit by its response id): the second source
 * that Typeform kept it.
 */
export function ClientFormStatus({
  sent,
  deals,
  signedAt,
  canFill,
  onFill,
}: {
  sent: ClientFormSent[] | null;
  deals: Deal[];
  /** When the newest contract was signed, if it was. */
  signedAt: string | null;
  canFill: boolean;
  onFill: () => void;
}) {
  if (!sent)
    return <p className="muted text-sm">Reading the form's history…</p>;
  const last = sent[0];
  if (last) {
    const arrived = deals.find(d => d.response_id === last.response_id);
    return (
      <div className="space-y-2 text-sm">
        <p>
          Sent {ago(last.sent_at)}
          {last.sent_by_name ? (
            <>
              {" "}
              by <bdi>{last.sent_by_name}</bdi>
            </>
          ) : null}
          . The onboarding started then.
        </p>
        {arrived ? (
          <StatusChip tone="good" label="In the B2B numbers" />
        ) : (
          <p className="muted text-xs">
            Not in the B2B numbers yet. B2B reads Typeform every 15 minutes; if
            it is still missing after an hour, look for it in Typeform's
            results.
          </p>
        )}
      </div>
    );
  }
  const outside = deals.find(d => !d.voided);
  if (outside)
    return (
      <p className="text-sm">
        The New Client Form reached B2B{" "}
        {outside.submitted_at ? ago(outside.submitted_at) : ""}
        {outside.closer ? (
          <>
            {" "}
            from <bdi>{outside.closer}</bdi>
          </>
        ) : null}
        , filled outside the cockpit. The onboarding started then.
      </p>
    );
  return (
    <div className="space-y-2">
      <p className="text-sm">
        {signedAt
          ? `Signed ${ago(signedAt)}. Next: the New Client Form, which starts the onboarding.`
          : "Not filled yet. Fill it once the client signs: it starts the onboarding."}
      </p>
      {canFill ? (
        <button
          type="button"
          className={signedAt ? buttonPrimary : button}
          onClick={onFill}
        >
          Fill the new client form
        </button>
      ) : (
        <p className="muted text-xs">The closer fills it from this page.</p>
      )}
    </div>
  );
}
