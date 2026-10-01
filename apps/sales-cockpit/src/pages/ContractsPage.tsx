import { FileSignature } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { ContractTrail } from "../components/ContractPanel";
import {
  button,
  buttonPrimary,
  EmptyState,
  Failed,
  page,
  Reading,
  SectionCard,
  SourceNote,
} from "../components/kit";
import { api } from "../lib/api";
import {
  CONTRACT_COLUMNS,
  type Contract,
  type ContractField,
  type ContractSetting,
  type ContractTemplate,
  isOpen,
  stepOf,
} from "../lib/contracts";
import { useLeadsById, useQuery, useSetting } from "../lib/data";
import { ago, isArabic } from "../lib/format";
import { supabase } from "../lib/supabase";
import { toast } from "../lib/toast";
import type { Me } from "../lib/types";

/**
 * Every contract made from the cockpit: the ones waiting for a signature
 * first, then drafts nobody sent, then the month's signed ones. Contracts
 * are made on a lead's page; a manager chooses here which HighLevel
 * templates the team can use.
 */

const MONTH = 30 * 86_400_000;

export default function ContractsPage({ me }: { me: Me }) {
  const rows = useQuery<Contract[]>(
    () =>
      supabase
        .from("cockpit_sales_contracts")
        .select(CONTRACT_COLUMNS)
        .order("created_at", { ascending: false })
        .limit(300),
    [],
    60_000,
  );
  const all = rows.data ?? [];
  const leads = useLeadsById(all.map(c => c.contact_id));
  const nameOf = useMemo(
    () => new Map((leads.data ?? []).map(l => [l.contact_id, l.name] as const)),
    [leads.data],
  );

  // Opened and signed are HighLevel's to know: read them back once on open.
  const reloadRows = rows.reload;
  useEffect(() => {
    let gone = false;
    api<{ checked: number }>("contract.refresh", {})
      .then(out => {
        if (!gone && out.checked) reloadRows();
      })
      .catch(() => undefined);
    return () => {
      gone = true;
    };
  }, [reloadRows]);

  const now = Date.now();
  const waiting = all.filter(c => {
    const s = stepOf(c);
    return isOpen(c) && (s === 1 || s === 2);
  });
  const drafts = all.filter(c => isOpen(c) && stepOf(c) === 0);
  const signed = all.filter(
    c =>
      stepOf(c) === 3 && Date.parse(c.signed_at ?? c.updated_at) > now - MONTH,
  );

  return (
    <main className={page}>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Contracts</h1>
        <p className="muted mt-1 text-sm">
          Contracts made from a lead's page, sent through HighLevel. Opened and
          signed come from HighLevel when this page opens.
        </p>
      </header>

      {rows.error ? (
        <Failed what="The contracts" error={rows.error} retry={rows.reload} />
      ) : !rows.data ? (
        <Reading what="the contracts" className="text-sm" />
      ) : !all.length ? (
        <section className="panel">
          <EmptyState
            icon={FileSignature}
            title="No contracts yet"
            text="Make one from a lead's page, under Contract: pick the template, fill in the company and the terms, and the draft is made in HighLevel."
          />
        </section>
      ) : (
        <div className="space-y-4">
          <ContractList
            title="Waiting for a signature"
            rows={waiting}
            nameOf={nameOf}
            empty="Nothing is waiting for a signature."
            when={c =>
              `sent ${ago(c.sent_at)}${c.sent_by ? ` by ${c.sent_by.split("@")[0]}` : ""}`
            }
          />
          <ContractList
            title="Drafts not sent"
            rows={drafts}
            nameOf={nameOf}
            empty="No drafts waiting."
            when={c =>
              `made ${ago(c.created_at)} by ${c.created_by.split("@")[0]}`
            }
          />
          <ContractList
            title="Signed in the last 30 days"
            rows={signed}
            nameOf={nameOf}
            empty="None signed in the last 30 days."
            when={c => `signed ${ago(c.signed_at ?? c.updated_at)}`}
          />
        </div>
      )}

      {me.manager ? <TemplatePicker /> : null}

      <SourceNote label="Where this comes from">
        A contract is a document in HighLevel's Documents &amp; Contracts. The
        cockpit makes it from the template as a draft, with the company name,
        the payment structure and the daily ad spend written to the lead in
        HighLevel first, so the template fills itself. A draft can be changed in
        HighLevel; sending locks it. Contracts sent from HighLevel itself are
        not listed here.
      </SourceNote>
    </main>
  );
}

function ContractList({
  title,
  rows,
  nameOf,
  empty,
  when,
}: {
  title: string;
  rows: Contract[];
  nameOf: Map<string, string | null>;
  empty: string;
  when: (c: Contract) => string;
}) {
  return (
    <SectionCard
      title={title}
      side={<span className="muted text-xs tabular-nums">{rows.length}</span>}
      flush
    >
      {rows.length ? (
        <ul className="divide-y hairline">
          {rows.map(c => {
            const name = nameOf.get(c.contact_id) ?? null;
            return (
              <li
                key={c.document_id}
                className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] sm:items-center sm:px-6"
              >
                <div className="min-w-0">
                  <p className="truncate">
                    <Link
                      to={`/lead/${encodeURIComponent(c.contact_id)}`}
                      className={`font-medium hover:underline ${isArabic(name) ? "ar" : ""}`}
                      dir="auto"
                    >
                      {name ?? "A lead"}
                    </Link>
                  </p>
                  <p className="muted truncate text-xs">
                    {c.template_name} · {when(c)}
                  </p>
                </div>
                <ContractTrail c={c} />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted px-4 py-3 text-sm sm:px-6">{empty}</p>
      )}
    </SectionCard>
  );
}

type TemplatePick = { on: boolean; fields: Set<ContractField> };

/** A manager chooses which HighLevel templates the team can use, and what each one prints. */
function TemplatePicker() {
  const setting = useSetting<ContractSetting>("contracts");
  const [all, setAll] = useState<{ id: string; name: string }[] | null>(null);
  const [picks, setPicks] = useState<Record<string, TemplatePick>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setError(null);
    try {
      const out = await api<{ templates: { id: string; name: string }[] }>(
        "contract.templates",
      );
      const chosen = new Map(
        (setting.data?.templates ?? []).map(t => [t.id, t] as const),
      );
      setAll(out.templates);
      setPicks(
        Object.fromEntries(
          out.templates.map(t => [
            t.id,
            {
              on: chosen.has(t.id),
              fields: new Set<ContractField>(
                chosen.get(t.id)?.fields ?? ["company_name"],
              ),
            },
          ]),
        ),
      );
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!all) return;
    const templates: ContractTemplate[] = all
      .filter(t => picks[t.id]?.on)
      .map(t => ({
        id: t.id,
        name: t.name,
        fields: ["company_name", "payment_structure", "daily_ad_spend"].filter(
          f => picks[t.id]?.fields.has(f as ContractField),
        ) as ContractField[],
      }));
    setBusy(true);
    try {
      await api("contract.templates.save", { templates });
      toast.success("Saved. The team sees these templates.");
      setting.reload();
      setAll(null);
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: string, f: ContractField) =>
    setPicks(p => {
      const cur = p[id] ?? { on: true, fields: new Set<ContractField>() };
      const fields = new Set(cur.fields);
      if (fields.has(f)) fields.delete(f);
      else fields.add(f);
      return { ...p, [id]: { ...cur, fields } };
    });

  return (
    <SectionCard title="Templates the team can use">
      <p className="muted text-sm">
        {(setting.data?.templates ?? []).map(t => t.name).join(", ") ||
          "None chosen yet."}
      </p>
      {all ? (
        <div className="mt-4 space-y-2">
          <p className="muted text-xs">
            Every template fills in the company name. Tick what else it prints,
            so the form asks for it.
          </p>
          <ul className="divide-y hairline rounded-[var(--radius-md)] border hairline">
            {all.map(t => {
              const p = picks[t.id];
              return (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center gap-3 px-3 py-2"
                >
                  <label className="flex min-w-0 flex-1 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={Boolean(p?.on)}
                      onChange={e =>
                        setPicks(cur => ({
                          ...cur,
                          [t.id]: {
                            on: e.target.checked,
                            fields:
                              cur[t.id]?.fields ?? new Set(["company_name"]),
                          },
                        }))
                      }
                    />
                    <span className="truncate text-sm" dir="auto">
                      {t.name}
                    </span>
                  </label>
                  {p?.on ? (
                    <span className="flex flex-wrap gap-3 text-xs">
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={p.fields.has("payment_structure")}
                          onChange={() => toggle(t.id, "payment_structure")}
                        />
                        Payment structure
                      </label>
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={p.fields.has("daily_ad_spend")}
                          onChange={() => toggle(t.id, "daily_ad_spend")}
                        />
                        Daily ad spend
                      </label>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonPrimary}
              disabled={busy}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : "Save the templates"}
            </button>
            <button
              type="button"
              className={button}
              disabled={busy}
              onClick={() => setAll(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <button
            type="button"
            className={button}
            disabled={busy}
            onClick={() => void open()}
          >
            {busy ? "Reading HighLevel…" : "Choose the templates"}
          </button>
          {error ? (
            <p className="callout-bad mt-2 rounded-[var(--radius-md)] border px-2.5 py-1.5 text-xs">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}
