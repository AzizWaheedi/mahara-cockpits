import { Copy, ExternalLink, MessageCircle, Send } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import {
  CONTRACT_COLUMNS,
  type Contract,
  type ContractSetting,
  endedNote,
  isOpen,
  madeFrom,
  STEPS,
  sentHow,
  shareLine,
  stepOf,
  stepTimes,
  uses,
} from "../lib/contracts";
import { useQuery, useSetting } from "../lib/data";
import { ago, day } from "../lib/format";
import { planFor } from "../lib/plans";
import { supabase } from "../lib/supabase";
import { toast } from "../lib/toast";
import type { Me } from "../lib/types";
import { button, buttonPrimary, Failed, field, Reading, select } from "./kit";

/**
 * A lead's contracts, made in HighLevel's Documents & Contracts from the
 * main templates (Aziz, 2026-10-01). The rep fills what the template prints,
 * the draft is made in HighLevel, anything else is changed there, and the
 * rep sends it by email or as a link for WhatsApp. HighLevel locks a
 * contract once it is sent.
 *
 * Since 2026-10-03 HighLevel's workflow "3. WhatsApp the Contract Link
 * (Arabic)" also sends the client the signing link on WhatsApp, in Arabic,
 * whenever one of its templates is sent either way (the setting's
 * `whatsapp.template_ids`). The buttons say so only when it is true: the
 * template is one of those and the lead has a number.
 */

/** Closers and managers make and send contracts; everyone else reads them. */
export function canContract(me: Me): boolean {
  return Boolean(me.manager) || me.role === "closer" || me.role === "both";
}

/** Draft, Sent, Opened, Signed: the contract's way to a signature, with the day each step was reached. */
export function ContractTrail({ c }: { c: Contract }) {
  const step = stepOf(c);
  const times = stepTimes(c);
  const ended = endedNote(c) !== null;
  return (
    <ol className="grid grid-cols-4 gap-x-1" aria-label="Where the contract is">
      {STEPS.map((label, i) => {
        const reached = i <= step;
        const done = step === 3;
        const tone = ended
          ? "var(--muted-foreground)"
          : done
            ? "var(--success)"
            : "var(--primary)";
        return (
          <li
            key={label}
            className="min-w-0"
            aria-current={i === step ? "step" : undefined}
          >
            <div className="flex items-center">
              <span
                className="size-2.5 shrink-0 rounded-full border"
                style={{
                  background: reached ? tone : "transparent",
                  borderColor: reached ? tone : "var(--border)",
                }}
                aria-hidden
              />
              {i < STEPS.length - 1 ? (
                <span
                  className="h-px flex-1"
                  style={{ background: i < step ? tone : "var(--border)" }}
                  aria-hidden
                />
              ) : null}
            </div>
            <p
              className={`mt-1 truncate text-xs ${reached ? "font-medium" : "muted"}`}
            >
              {label}
            </p>
            <p className="muted truncate text-[11px] tabular-nums">
              {reached && times[i] ? day(times[i]) : " "}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

/** A lead's contracts, newest first. */
export function useContracts(contactId: string) {
  return useQuery<Contract[]>(
    () =>
      supabase
        .from("cockpit_sales_contracts")
        .select(CONTRACT_COLUMNS)
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false })
        .limit(20),
    [contactId],
  );
}

export function ContractPanel({
  me,
  contactId,
  company,
  hasEmail,
  hasPhone,
  language,
  onShare,
}: {
  me: Me;
  contactId: string;
  /** The company name on file, to start the contract with. */
  company: string | null;
  hasEmail: boolean;
  hasPhone: boolean;
  language: "ar" | "en";
  /** Puts words in the lead's WhatsApp box. */
  onShare: (text: string) => void;
}) {
  const rows = useContracts(contactId);
  const setting = useSetting<ContractSetting>("contracts");
  const actor = canContract(me);
  const [making, setMaking] = useState(false);

  // HighLevel knows when a contract was opened or signed: read it back once
  // the panel opens, if anything is still on its way.
  const anyOpen = (rows.data ?? []).some(isOpen);
  const reloadRows = rows.reload;
  useEffect(() => {
    if (!anyOpen) return;
    let gone = false;
    api<{ checked: number }>("contract.refresh", { contact_id: contactId })
      .then(out => {
        if (!gone && out.checked) reloadRows();
      })
      .catch(() => undefined);
    return () => {
      gone = true;
    };
  }, [anyOpen, contactId, reloadRows]);

  if (rows.error)
    return (
      <Failed what="The contracts" error={rows.error} retry={rows.reload} />
    );
  if (!rows.data || (!setting.data && setting.loading))
    return <Reading what="the contracts" className="text-sm" />;

  const list = rows.data;
  const templates = setting.data?.templates ?? [];
  const showForm = actor && (making || !list.some(isOpen));

  return (
    <div className="space-y-4">
      {list.map(c => (
        <ContractCard
          key={c.document_id}
          c={c}
          actor={actor}
          hasEmail={hasEmail}
          whatsapp={
            hasPhone &&
            Boolean(
              c.template_id &&
                setting.data?.whatsapp?.template_ids?.includes(c.template_id),
            )
          }
          language={language}
          editorUrl={setting.data?.editor_url ?? null}
          onChange={rows.reload}
          onShare={onShare}
        />
      ))}
      {!list.length && !actor ? (
        <p className="muted text-sm">
          No contract yet. Closers and managers make and send them here.
        </p>
      ) : null}
      {actor && !showForm ? (
        <button
          type="button"
          className={button}
          onClick={() => setMaking(true)}
        >
          Make another contract
        </button>
      ) : null}
      {showForm ? (
        templates.length ? (
          <NewContract
            contactId={contactId}
            company={list[0]?.fields.company_name ?? company ?? ""}
            last={list[0] ?? null}
            setting={setting.data ?? {}}
            onMade={() => {
              setMaking(false);
              rows.reload();
            }}
            onCancel={list.some(isOpen) ? () => setMaking(false) : null}
          />
        ) : (
          <p className="muted text-sm">
            No contract templates are chosen yet. A manager chooses them on the
            Contracts page.
          </p>
        )
      ) : null}
    </div>
  );
}

function ContractCard({
  c,
  actor,
  hasEmail,
  whatsapp,
  language,
  editorUrl,
  onChange,
  onShare,
}: {
  c: Contract;
  actor: boolean;
  hasEmail: boolean;
  /** HighLevel also sends the client the link on WhatsApp, in Arabic, once it is sent. */
  whatsapp: boolean;
  language: "ar" | "en";
  editorUrl: string | null;
  onChange: () => void;
  onShare: (text: string) => void;
}) {
  const step = stepOf(c);
  const ended = endedNote(c);
  const [confirm, setConfirm] = useState<"email" | "link" | null>(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  async function send(via: "email" | "link") {
    setBusy(true);
    try {
      const out = await api<{ link: string | null }>("contract.send", {
        document_id: c.document_id,
        via,
      });
      if (via === "link" && out.link) {
        setLink(out.link);
        await copy(
          out.link,
          whatsapp
            ? "Sent. The client gets the link on WhatsApp in a minute; it is copied for you too."
            : "Sent. The link is copied: share it with the lead.",
        );
      } else
        toast.success(
          whatsapp ? "Sent by email and on WhatsApp." : "Sent by email.",
        );
      setConfirm(null);
      onChange();
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function getLink(): Promise<string | null> {
    if (link) return link;
    try {
      const out = await api<{ link: string }>("contract.link", {
        document_id: c.document_id,
      });
      setLink(out.link);
      return out.link;
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
      return null;
    }
  }

  return (
    <div className="rounded-[var(--radius-md)] border hairline p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 truncate font-medium" dir="auto">
          {step === 0
            ? (c.fields.company_name ?? c.name ?? madeFrom(c))
            : (c.name ?? madeFrom(c))}
        </p>
        <p className="muted text-xs">
          {madeFrom(c)}
          {c.sent_at && step < 3
            ? ` · sent ${ago(c.sent_at)} ${sentHow(c)}`
            : ""}
        </p>
      </div>
      <div className="mt-3">
        <ContractTrail c={c} />
      </div>
      {ended ? <p className="muted mt-2 text-xs">{ended}</p> : null}
      {step === 0 && !ended && c.source === "highlevel" ? (
        <p className="muted mt-2 text-xs">
          Made in HighLevel. Change it there before sending; sending locks it.
        </p>
      ) : null}
      {step === 0 && !ended && c.source !== "highlevel" ? (
        <p className="muted mt-2 text-xs">
          Filled in: <bdi>{c.fields.company_name}</bdi>
          {c.fields.payment_structure ? `, ${c.fields.payment_structure}` : ""}
          {c.fields.daily_ad_spend ? `, $${c.fields.daily_ad_spend} a day` : ""}
          . Change anything else in HighLevel before sending; sending locks it.
        </p>
      ) : null}

      {actor && step === 0 && !ended ? (
        confirm ? (
          <div
            className="callout-warn mt-3 rounded-[var(--radius-md)] border px-3 py-2 text-sm"
            role="alertdialog"
            aria-label="Send the contract"
          >
            <p>
              {confirm === "email"
                ? whatsapp
                  ? "HighLevel emails the contract and locks it, and the client gets the link on WhatsApp in Arabic from the company number. Send it now?"
                  : "HighLevel emails the contract to the lead and locks it. Send it now?"
                : whatsapp
                  ? "HighLevel locks it and the client gets the link on WhatsApp in Arabic from the company number. You get the link too. Send it now?"
                  : "HighLevel marks it sent and locks it, and you get the link to share. Send it now?"}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className={buttonPrimary}
                disabled={busy}
                onClick={() => void send(confirm)}
              >
                <Send className="size-3.5" aria-hidden />
                {busy
                  ? "Sending…"
                  : confirm === "email"
                    ? whatsapp
                      ? "Send by email and WhatsApp"
                      : "Send by email"
                    : whatsapp
                      ? "Send on WhatsApp only"
                      : "Send as a link"}
              </button>
              <button
                type="button"
                className={button}
                disabled={busy}
                onClick={() => setConfirm(null)}
              >
                Not yet
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {editorUrl ? (
              <a
                href={editorUrl}
                target="_blank"
                rel="noreferrer"
                className={button}
                title={
                  c.template_name
                    ? `In HighLevel it is the newest ${c.template_name} for this lead.`
                    : `In HighLevel it is called ${c.name ?? "this lead's contract"}.`
                }
              >
                <ExternalLink className="size-3.5" aria-hidden />
                Edit in HighLevel
              </a>
            ) : null}
            <button
              type="button"
              className={buttonPrimary}
              disabled={!hasEmail}
              title={
                hasEmail
                  ? undefined
                  : whatsapp
                    ? "This lead has no email address. Send it on WhatsApp only."
                    : "This lead has no email address. Send it as a link."
              }
              onClick={() => setConfirm("email")}
            >
              <Send className="size-3.5" aria-hidden />
              {whatsapp ? "Send by email and WhatsApp" : "Send by email"}
            </button>
            <button
              type="button"
              className={button}
              onClick={() => setConfirm("link")}
            >
              {whatsapp ? "Send on WhatsApp only" : "Send as a link"}
            </button>
          </div>
        )
      ) : null}

      {actor && (step === 1 || step === 2) && !ended ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className={button}
            onClick={async () => {
              const l = await getLink();
              if (l) await copy(l, "The link is copied.");
            }}
          >
            <Copy className="size-3.5" aria-hidden />
            Copy the link
          </button>
          <button
            type="button"
            className={button}
            onClick={async () => {
              const l = await getLink();
              if (l) onShare(shareLine(l, language));
            }}
          >
            <MessageCircle className="size-3.5" aria-hidden />
            Put it in WhatsApp
          </button>
        </div>
      ) : null}
    </div>
  );
}

async function copy(text: string, said: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(said);
  } catch {
    toast.error("The link could not be copied here. Use Put it in WhatsApp.");
  }
}

function NewContract({
  contactId,
  company: start,
  last,
  setting,
  onMade,
  onCancel,
}: {
  contactId: string;
  company: string;
  last: Contract | null;
  setting: ContractSetting;
  onMade: () => void;
  onCancel: (() => void) | null;
}) {
  const templates = setting.templates ?? [];
  const options = setting.fields?.payment_structure?.options ?? [];
  const [templateId, setTemplateId] = useState(
    templates.find(t => t.id === last?.template_id)?.id ??
      templates[0]?.id ??
      "",
  );
  const template = useMemo(
    () => templates.find(t => t.id === templateId) ?? null,
    [templates, templateId],
  );
  const [company, setCompany] = useState(start);
  const [payment, setPayment] = useState(last?.fields.payment_structure ?? "");
  const [spend, setSpend] = useState(
    last?.fields.daily_ad_spend ? String(last.fields.daily_ad_spend) : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function make(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const out = await api<{ reused?: boolean }>("contract.create", {
        contact_id: contactId,
        template_id: templateId,
        company_name: company,
        payment_structure: uses(template, "payment_structure")
          ? payment
          : undefined,
        // Asked for every contract, printed or not (Aziz, 2026-10-02).
        daily_ad_spend: spend,
      });
      toast.success(
        out.reused
          ? "The draft in HighLevel now has these details."
          : "Draft made in HighLevel.",
      );
      onMade();
    } catch (err) {
      setError(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={make} className="space-y-3" aria-label="New contract">
      <label className="block">
        <span className="muted mb-1 block text-xs">Template</span>
        <select
          className={`${select} w-full`}
          value={templateId}
          onChange={e => setTemplateId(e.target.value)}
        >
          {templates.map(t => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="muted mb-1 block text-xs">
          Company, as it should appear on the contract
        </span>
        <input
          className={`${field} w-full`}
          value={company}
          onChange={e => setCompany(e.target.value)}
          dir="auto"
          required
          minLength={2}
          maxLength={150}
        />
      </label>
      {uses(template, "payment_structure") ? (
        <label className="block">
          <span className="muted mb-1 block text-xs">How they pay</span>
          <select
            className={`${select} w-full`}
            value={payment}
            onChange={e => setPayment(e.target.value)}
            required
          >
            <option value="" disabled>
              Pick one
            </option>
            {options.map(o => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          {planFor(payment) ? (
            <span className="muted mt-1 block text-xs">
              {planFor(payment)?.schedule}
            </span>
          ) : null}
        </label>
      ) : null}
      <label className="block">
        <span className="muted mb-1 block text-xs">
          Daily ad spend, in dollars
        </span>
        <input
          className={`${field} w-40 tabular-nums`}
          value={spend}
          onChange={e => setSpend(e.target.value)}
          inputMode="decimal"
          placeholder="For example 40"
          dir="ltr"
          required
        />
        {template && !uses(template, "daily_ad_spend") ? (
          <span className="muted mt-1 block text-xs">
            This contract does not print it. It goes on the lead's record for
            the onboarding and the New Client Form.
          </span>
        ) : null}
      </label>
      {error ? (
        <p className="callout-bad rounded-[var(--radius-md)] border px-2.5 py-1.5 text-xs">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          className={buttonPrimary}
          disabled={busy || !templateId}
        >
          {busy ? "Making the draft…" : "Create the draft"}
        </button>
        {onCancel ? (
          <button type="button" className={button} onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
      <p className="muted text-xs">
        The draft is made in HighLevel with these filled in. Nothing goes to the
        lead until you send it.
      </p>
    </form>
  );
}
