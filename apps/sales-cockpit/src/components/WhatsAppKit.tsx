import { ChevronDown, MessageSquareText, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useSnippets } from "../lib/data";
import { toast } from "../lib/toast";
import {
  fillSnippet,
  MOMENTS,
  type Moment,
  renderTemplate,
  type SnippetValues,
  snippetLine,
  type TemplateRoute,
} from "../lib/whatsapp";
import { button, buttonPrimary, field } from "./kit";

/**
 * The team's ready-made WhatsApp messages, filled in for this lead, one click
 * to put in the box. As a template's line they lose the greeting and the
 * who-I-am, which the template already says.
 */
export function SnippetPicker({
  language,
  values,
  asLine = false,
  first,
  onPick,
}: {
  language: "ar" | "en";
  values: SnippetValues;
  asLine?: boolean;
  /** Open on these moments first (a missed call, a confirmation). */
  first?: Moment[];
  onPick: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState(language);
  useEffect(() => setLang(language), [language]);
  const snippets = useSnippets();
  const groups = useMemo(() => {
    const of = (snippets.data ?? []).filter(s => s.language === lang);
    const order = [
      ...(first ?? []),
      ...MOMENTS.map(([m]) => m).filter(m => !first?.includes(m)),
    ];
    return order
      .map(m => ({
        moment: m,
        label: MOMENTS.find(([k]) => k === m)?.[1] ?? m,
        items: of.filter(s => s.moment === m),
      }))
      .filter(g => g.items.length);
  }, [snippets.data, lang, first]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className={button}
      >
        <MessageSquareText className="size-3.5" aria-hidden />
        Ready-made
        <ChevronDown className="size-3" aria-hidden />
      </button>
      {open ? (
        <div className="panel absolute bottom-10 start-0 z-30 max-h-80 w-[min(26rem,calc(100vw-2rem))] overflow-y-auto p-2 shadow-lg">
          <div className="mb-2 flex items-center justify-between gap-2 px-1">
            <p className="muted text-xs">
              {asLine
                ? "Goes in as the template's line"
                : "Fills the box; edit before sending"}
            </p>
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
          </div>
          {snippets.error ? (
            <p className="px-1 text-xs">The messages could not be read.</p>
          ) : !groups.length ? (
            <p className="muted px-1 text-xs">
              {snippets.loading
                ? "Reading…"
                : "No ready-made messages in this language yet. A manager adds them under Follow-ups, WhatsApp library."}
            </p>
          ) : (
            groups.map(g => (
              <div key={g.moment} className="mb-2">
                <p className="muted px-1 pb-1 text-[11px]">{g.label}</p>
                <ul className="space-y-1">
                  {g.items.map(s => {
                    const text = asLine
                      ? fillSnippet(snippetLine(s.body), values)
                      : fillSnippet(s.body, values);
                    return (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => {
                            onPick(text);
                            setOpen(false);
                          }}
                          className="w-full rounded-[var(--radius-md)] px-2 py-1.5 text-start text-sm hover:bg-[color:var(--secondary)]"
                          dir="auto"
                        >
                          {text}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * WhatsApp to a lead whose 24-hour window is closed: an approved template
 * with one line written for them, sent through its HighLevel workflow.
 */
export function TemplateComposer({
  contactId,
  firstName,
  language,
  templates,
  values,
  prefill,
  onSent,
}: {
  contactId: string;
  firstName: string;
  language: "ar" | "en";
  templates: TemplateRoute[];
  values: SnippetValues;
  /** A line to start from (the dialer's missed-call message, an asset's message). */
  prefill?: {
    text: string;
    nonce: number;
    asset?: { id: string; url: string | null } | null;
  } | null;
  onSent: () => void;
}) {
  const live = useMemo(
    () => templates.filter(t => t.active && t.workflow_id),
    [templates],
  );
  const [key, setKey] = useState<string>("");
  useEffect(() => {
    if (!live.some(t => t.key === key))
      setKey((live.find(t => t.language === language) ?? live[0])?.key ?? "");
  }, [live, key, language]);
  const t = live.find(x => x.key === key) ?? null;
  const [line, setLine] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const takesLine = Boolean(t?.variables.includes("line"));
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new request (nonce) with the same words fills the box again
  useEffect(() => {
    if (!prefill?.text) return;
    const words = prefill.text.replace(/[\r\n]+/g, " ");
    setLine(l => (l.trim() ? `${l.trim()} ${words}` : words));
  }, [prefill?.nonce, prefill?.text]);

  if (!live.length)
    return (
      <p className="text-xs">
        No WhatsApp template is set up yet, so a lead whose window is closed can
        only be emailed. A manager connects the templates under Follow-ups,
        WhatsApp library.
      </p>
    );

  async function send() {
    if (!t || busy || (takesLine && line.trim().length < 2)) return;
    setBusy(true);
    try {
      const out = await api<{
        message: {
          state: string;
          error: string | null;
          provider_status: string | null;
        };
        repeated?: boolean;
      }>("wa.template.send", {
        contact_id: contactId,
        template_key: t.key,
        line,
        request_id: requestId,
        asset_id:
          prefill?.asset &&
          (!prefill.asset.url || line.includes(prefill.asset.url))
            ? prefill.asset.id
            : undefined,
      });
      if (out.message.state === "failed")
        toast.error(
          `WhatsApp did not deliver it: ${out.message.error ?? "no reason given"}.`,
        );
      else
        toast.success(
          out.repeated
            ? "That template was already sent."
            : out.message.provider_status === "enrolled"
              ? "HighLevel is sending the template; it shows in the thread in a moment."
              : "Sent by WhatsApp template.",
        );
      setLine("");
      setRequestId(crypto.randomUUID());
      onSent();
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  const preview = t
    ? renderTemplate(t, {
        first_name: firstName || undefined,
        line: line.trim() || undefined,
      })
    : "";
  return (
    <div className="space-y-2">
      {live.length > 1 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {live.map(x => (
            <button
              key={x.key}
              type="button"
              aria-pressed={x.key === key}
              onClick={() => setKey(x.key)}
              className={`inline-flex h-7 items-center rounded-full border hairline px-2.5 text-xs ${x.key === key ? "bg-[color:var(--secondary)] font-medium" : "muted"}`}
              title={x.purpose}
            >
              {x.language === "ar" ? "عربي" : "English"} · {x.name}
            </button>
          ))}
        </div>
      ) : null}
      {takesLine ? (
        <textarea
          value={line}
          onChange={e => setLine(e.target.value.replace(/[\r\n]+/g, " "))}
          rows={2}
          maxLength={700}
          placeholder={
            t?.language === "ar"
              ? "السطر اللي يوصلهم، بدون تحية"
              : "The line they read, no greeting"
          }
          className={`${field} h-auto py-2 leading-relaxed`}
          dir="auto"
          aria-label="The template's line"
        />
      ) : null}
      <p
        className="whitespace-pre-wrap rounded-[var(--radius-md)] border-s-2 px-3 py-2 text-sm"
        style={{
          borderColor: "var(--primary)",
          background: "color-mix(in oklch, var(--primary) 7%, transparent)",
        }}
        dir="auto"
      >
        {preview}
      </p>
      <p className="muted text-[11px]">
        {"{{2}}"} is signed with the lead's rep (their Arabic name in an Arabic
        template, when set on their seat), else the sales team. One line: line
        breaks are taken out.
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {takesLine ? (
          <SnippetPicker
            language={t?.language ?? language}
            values={values}
            asLine
            onPick={setLine}
          />
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={() => void send()}
          disabled={busy || !t || (takesLine && line.trim().length < 2)}
          className={buttonPrimary}
        >
          <Send className="size-3.5" aria-hidden />
          {busy ? "Sending…" : "Send the template"}
        </button>
      </div>
    </div>
  );
}
