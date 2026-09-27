import { ExternalLink, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useQuery } from "../lib/data";
import { ago } from "../lib/format";
import { supabase } from "../lib/supabase";
import { toast } from "../lib/toast";
import type { Me } from "../lib/types";
import { button, Failed, Parts, Reading } from "./kit";

/**
 * Who this lead is, from the web, on a rep's request. Every claim carries the
 * page it came from; a page the search never opened is marked, and what could
 * not be found is said rather than guessed.
 */

interface Fact {
  text: string;
  source: string;
  verified: boolean;
}

interface Brief {
  identified?: boolean;
  confidence?: "high" | "medium" | "low";
  person?: {
    summary?: string;
    role?: string | null;
    linkedin?: string | null;
    facts?: Fact[];
  };
  company?: {
    name?: string | null;
    website?: string | null;
    summary?: string;
    size?: string | null;
    locations?: string | null;
    social?: {
      instagram?: string | null;
      linkedin?: string | null;
      other?: string[];
    };
    facts?: Fact[];
  };
  signals?: Fact[];
  talking_points?: string[];
  cautions?: string[];
  not_found?: string[];
}

interface Research {
  id: string;
  status: "queued" | "running" | "ready" | "failed";
  brief: Brief | null;
  sources: { pages?: { url: string }[] } | null;
  model: string | null;
  error: string | null;
  requested_by: string | null;
  requested_at: string;
  finished_at: string | null;
}

function host(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
}

function Facts({ facts }: { facts?: Fact[] }) {
  if (!facts?.length) return null;
  return (
    <ul className="space-y-1 text-sm">
      {facts.map(f => (
        <li key={`${f.text}|${f.source}`} dir="auto">
          {f.text}{" "}
          <a
            href={f.source}
            target="_blank"
            rel="noreferrer noopener"
            className="muted inline-flex items-center gap-0.5 text-xs underline underline-offset-2"
            title={
              f.verified
                ? "The search opened this page"
                : "The search did not open this page; check it"
            }
          >
            {host(f.source)}
            <ExternalLink className="size-3" aria-hidden />
          </a>
          {f.verified ? null : (
            <span className="muted text-[11px]"> (not checked)</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function Link2({ href, label }: { href?: string | null; label: string }) {
  if (!href || !/^https?:\/\//.test(href)) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1 text-xs underline underline-offset-2"
    >
      {label} <ExternalLink className="size-3" aria-hidden />
    </a>
  );
}

export function ResearchPanel({
  contactId,
  me,
}: {
  contactId: string;
  me: Me;
}) {
  const [tick, setTick] = useState(0);
  const research = useQuery<Research[]>(
    () =>
      supabase
        .from("cockpit_sales_research")
        .select("*")
        .eq("contact_id", contactId)
        .order("requested_at", { ascending: false })
        .limit(1),
    [contactId, tick],
  );
  const r = research.data?.[0] ?? null;
  const working = r?.status === "queued" || r?.status === "running";
  useEffect(() => {
    if (!working) return;
    const t = window.setInterval(() => setTick(n => n + 1), 10_000);
    return () => window.clearInterval(t);
  }, [working]);

  const [busy, setBusy] = useState(false);
  async function ask() {
    setBusy(true);
    try {
      await api("research.request", { contact_id: contactId });
      toast.success(
        "Researching. It takes a minute or two; this updates by itself.",
      );
      setTick(n => n + 1);
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  const b = r?.status === "ready" ? r.brief : null;
  const stale =
    r?.finished_at && Date.now() - Date.parse(r.finished_at) > 6 * 3_600_000;
  const pages = r?.sources?.pages;

  // Until the read is in, nobody is said not to have looked, and no
  // "Research this lead" is offered on top of one already running.
  if (research.error)
    return (
      <Failed
        what="The research"
        error={research.error}
        retry={research.reload}
      />
    );
  if (!research.data) return <Reading what="the research" />;

  return (
    <div className="space-y-3">
      {!r ? (
        <p className="muted text-sm">
          Nobody has looked this lead up yet. The researcher searches Google and
          the web for them and their company, and keeps the page behind every
          claim.
        </p>
      ) : working ? (
        <p className="muted text-sm">
          Researching, asked {ago(r.requested_at)}…
        </p>
      ) : r.status === "failed" ? (
        <p className="callout-bad rounded-[var(--radius-md)] border px-3 py-2 text-sm">
          The research did not finish: {r.error ?? "no reason given"}
        </p>
      ) : null}

      {b ? (
        <div className="space-y-3">
          <p className="muted text-xs">
            {b.identified === false
              ? "Could not tell for sure who this is"
              : `Identified, ${b.confidence ?? "unknown"} confidence`}
            {r?.finished_at ? ` · researched ${ago(r.finished_at)}` : ""}
          </p>
          {b.person?.summary || b.person?.facts?.length ? (
            <div className="space-y-1">
              <p className="text-sm font-semibold">
                <Parts items={["The person", b.person?.role]} />
              </p>
              {b.person?.summary ? (
                <p className="text-sm" dir="auto">
                  {b.person.summary}
                </p>
              ) : null}
              <Facts facts={b.person?.facts} />
              <Link2 href={b.person?.linkedin} label="LinkedIn" />
            </div>
          ) : null}
          {b.company?.summary || b.company?.facts?.length ? (
            <div className="space-y-1">
              <p className="text-sm font-semibold" dir="auto">
                {b.company?.name ?? "The company"}
              </p>
              {b.company?.summary ? (
                <p className="text-sm" dir="auto">
                  {b.company.summary}
                </p>
              ) : null}
              {b.company?.size || b.company?.locations ? (
                <p className="muted text-xs">
                  <Parts items={[b.company?.size, b.company?.locations]} />
                </p>
              ) : null}
              <Facts facts={b.company?.facts} />
              <div className="flex flex-wrap gap-3">
                <Link2 href={b.company?.website} label="Website" />
                <Link2 href={b.company?.social?.instagram} label="Instagram" />
                <Link2
                  href={b.company?.social?.linkedin}
                  label="LinkedIn page"
                />
              </div>
            </div>
          ) : null}
          {b.signals?.length ? (
            <div className="space-y-1">
              <p className="text-sm font-semibold">Worth knowing</p>
              <Facts facts={b.signals} />
            </div>
          ) : null}
          {b.talking_points?.length ? (
            <div className="space-y-1">
              <p className="text-sm font-semibold">For the call</p>
              <ul className="list-disc space-y-0.5 ps-5 text-sm">
                {b.talking_points.map(t => (
                  <li key={t} dir="auto">
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {b.cautions?.length || b.not_found?.length ? (
            <div className="muted space-y-0.5 text-xs">
              {[...(b.cautions ?? []), ...(b.not_found ?? [])].map(t => (
                <p key={t} dir="auto">
                  {t}
                </p>
              ))}
            </div>
          ) : null}
          <p className="muted text-xs">
            {Array.isArray(pages)
              ? `${pages.length} ${pages.length === 1 ? "page" : "pages"} consulted · drafted by the assistant`
              : "Drafted by the assistant"}
          </p>
        </div>
      ) : null}

      {!working && (r?.status !== "ready" || stale || me.manager) ? (
        <button type="button" onClick={ask} disabled={busy} className={button}>
          <Search className="size-3.5" aria-hidden />
          {busy
            ? "Asking…"
            : r?.status === "ready"
              ? "Research again"
              : "Research this lead"}
        </button>
      ) : null}
    </div>
  );
}
