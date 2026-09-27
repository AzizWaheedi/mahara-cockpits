import { Pencil, Users } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { Link } from "react-router";
import { api } from "../lib/api";
import { useAssets, useLeadsById, useQuery } from "../lib/data";
import { ago } from "../lib/format";
import { supabase } from "../lib/supabase";
import { toast } from "../lib/toast";
import {
  button,
  buttonPrimary,
  EmptyState,
  Failed,
  field,
  Parts,
  partsText,
  Reading,
  StatusChip,
  type Tone,
} from "./kit";

/**
 * Client references: who a prospect can speak to, what a rep may say about
 * them, and whether they agreed. Consent was recorded nowhere before
 * 2026-09-26, so every reference starts as "not asked yet" until Aziz or
 * the client's CSM asks them. A rep asks for a reference call from the
 * lead; a manager arranges it here.
 */

export interface Reference {
  id: string;
  client_name: string;
  trade: string | null;
  city: string | null;
  country: string | null;
  active: boolean | null;
  result_line: string | null;
  asset_slugs: string[];
  consent: "yes" | "no" | "unknown";
  consent_by: string | null;
  consent_at: string | null;
  route: string | null;
  last_used_at: string | null;
  notes: string | null;
}

export interface ReferenceAsk {
  id: string;
  contact_id: string;
  reference_id: string | null;
  note: string | null;
  asked_by: string;
  asked_at: string;
  state: "asked" | "arranged" | "done" | "declined";
  decided_by: string | null;
  decided_at: string | null;
  answer: string | null;
}

export function useReferences() {
  return useQuery<Reference[]>(
    () =>
      supabase
        .from("cockpit_sales_references")
        .select("*")
        .order("consent", { ascending: false })
        .order("client_name"),
    [],
  );
}

export function useReferenceAsks(contactId?: string) {
  return useQuery<ReferenceAsk[]>(() => {
    let q = supabase
      .from("cockpit_sales_reference_asks")
      .select("*")
      .order("asked_at", { ascending: false })
      .limit(100);
    if (contactId) q = q.eq("contact_id", contactId);
    return q;
  }, [contactId]);
}

const CONSENT: Record<Reference["consent"], { label: string; tone: Tone }> = {
  yes: { label: "Agreed to calls", tone: "good" },
  unknown: { label: "Not asked yet", tone: "warning" },
  no: { label: "Said no", tone: "critical" },
};

const ASK_STATE: Record<ReferenceAsk["state"], { label: string; tone: Tone }> =
  {
    asked: { label: "Asked", tone: "warning" },
    arranged: { label: "Arranged", tone: "good" },
    done: { label: "Done", tone: "neutral" },
    declined: { label: "Not possible", tone: "critical" },
  };

/** Where a client is, as parts: the trade, then the city and country. */
function where(r: Reference): (string | null)[] {
  return [r.trade, [r.city, r.country].filter(Boolean).join(", ") || null];
}

/** The references, for Links. Managers edit them. */
export function ReferenceList({ manager }: { manager: boolean }) {
  const refs = useReferences();
  const assets = useAssets();
  const titleOf = useMemo(
    () => new Map((assets.data ?? []).map(a => [a.slug, a] as const)),
    [assets.data],
  );
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  if (refs.error)
    return (
      <Failed what="The references" error={refs.error} retry={refs.reload} />
    );
  if (refs.loading && !refs.data)
    return <p className="muted text-sm">Reading the references…</p>;
  const list = refs.data ?? [];
  return (
    <div className="space-y-3">
      <p className="muted text-sm">
        Consent to be a reference was not written down anywhere, so every client
        starts as not asked yet. A rep asks for a reference call from the lead's
        page; the client is only called once they have agreed.
      </p>
      {manager ? (
        adding ? (
          <ReferenceForm
            r={null}
            onDone={() => {
              setAdding(false);
              refs.reload();
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className={button}
          >
            Add a reference
          </button>
        )
      ) : null}
      {!list.length ? (
        <EmptyState
          icon={Users}
          title="No references yet"
          text="A manager adds the clients a prospect may speak to."
        />
      ) : (
        <ul className="divide-y hairline">
          {list.map(r =>
            editing === r.id ? (
              <li key={r.id} className="py-3">
                <ReferenceForm
                  r={r}
                  onDone={() => {
                    setEditing(null);
                    refs.reload();
                  }}
                />
              </li>
            ) : (
              <li key={r.id} className="space-y-1 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold" dir="auto">
                    {r.client_name}
                  </p>
                  <StatusChip
                    tone={CONSENT[r.consent].tone}
                    label={CONSENT[r.consent].label}
                  />
                  {r.active === false ? (
                    <StatusChip tone="neutral" label="No longer a client" />
                  ) : null}
                  {manager ? (
                    <button
                      type="button"
                      onClick={() => setEditing(r.id)}
                      className="muted ms-auto inline-flex items-center gap-1 text-xs hover:underline"
                    >
                      <Pencil className="size-3" aria-hidden /> Edit
                    </button>
                  ) : null}
                </div>
                {where(r).some(Boolean) ? (
                  <p className="muted text-xs">
                    <Parts items={where(r)} />
                  </p>
                ) : null}
                {r.result_line ? (
                  <p className="text-sm" dir="auto">
                    {r.result_line}
                  </p>
                ) : (
                  <p className="muted text-xs">No approved result line yet.</p>
                )}
                {r.asset_slugs.length ? (
                  <p className="text-xs">
                    <span className="muted">Proof: </span>
                    {r.asset_slugs.map((s, i) => {
                      const a = titleOf.get(s);
                      return (
                        <span key={s}>
                          {i ? ", " : ""}
                          {a?.url ? (
                            <a
                              href={a.url}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="underline underline-offset-2"
                            >
                              {a.title}
                            </a>
                          ) : (
                            s
                          )}
                        </span>
                      );
                    })}
                  </p>
                ) : null}
                <p className="muted text-[11px]">
                  {r.route ? `Arranged ${r.route}. ` : ""}
                  {r.consent !== "unknown" && r.consent_by
                    ? `Consent recorded by ${r.consent_by.split("@")[0]}${
                        r.consent_at ? ` ${ago(r.consent_at)}` : ""
                      }. `
                    : ""}
                  {r.last_used_at
                    ? `Last reference call ${ago(r.last_used_at)}.`
                    : ""}
                </p>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

function ReferenceForm({
  r,
  onDone,
}: {
  r: Reference | null;
  onDone: () => void;
}) {
  const [v, setV] = useState({
    client_name: r?.client_name ?? "",
    trade: r?.trade ?? "",
    city: r?.city ?? "",
    country: r?.country ?? "",
    active: r?.active ?? true,
    result_line: r?.result_line ?? "",
    asset_slugs: (r?.asset_slugs ?? []).join(", "),
    consent: r?.consent ?? "unknown",
    route: r?.route ?? "",
    notes: r?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("reference.save", { id: r?.id, ...v });
      toast.success("Saved.");
      onDone();
    } catch (err) {
      toast.error(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  }
  const text = (k: keyof typeof v, label: string, wide = false) => (
    <label className={`block space-y-1 text-sm ${wide ? "sm:col-span-2" : ""}`}>
      <span className="muted block text-xs">{label}</span>
      <input
        value={String(v[k] ?? "")}
        onChange={e => setV({ ...v, [k]: e.target.value })}
        className={field}
        dir="auto"
      />
    </label>
  );
  return (
    <form
      onSubmit={save}
      className="grid gap-3 rounded-xl bg-muted/40 p-4 sm:grid-cols-2"
    >
      {text("client_name", "Client")}
      {text("trade", "Trade")}
      {text("city", "City")}
      {text("country", "Country")}
      {text("result_line", "The result line a rep may say (as approved)", true)}
      {text(
        "asset_slugs",
        "Their proof in the library (asset slugs, comma between)",
        true,
      )}
      {text(
        "route",
        "How a call is arranged (for example: through their CSM, Maher)",
        true,
      )}
      <label className="block space-y-1 text-sm">
        <span className="muted block text-xs">
          Agreed to take reference calls?
        </span>
        <select
          value={v.consent}
          onChange={e =>
            setV({ ...v, consent: e.target.value as Reference["consent"] })
          }
          className={field}
        >
          <option value="unknown">Not asked yet</option>
          <option value="yes">Yes, they agreed</option>
          <option value="no">No</option>
        </select>
      </label>
      <label className="flex items-center gap-2 self-end text-sm">
        <input
          type="checkbox"
          checked={v.active}
          onChange={e => setV({ ...v, active: e.target.checked })}
        />
        Still a client
      </label>
      {text("notes", "Notes", true)}
      <div className="flex gap-2 sm:col-span-2">
        <button
          type="submit"
          disabled={busy || v.client_name.trim().length < 2}
          className={buttonPrimary}
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onDone} className={button}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** The reference calls reps asked for, for a manager to arrange. */
export function ReferenceAsks() {
  const asks = useReferenceAsks();
  const refs = useReferences();
  const leads = useLeadsById([
    ...new Set((asks.data ?? []).map(a => a.contact_id)),
  ]);
  const nameOf = new Map(
    (leads.data ?? []).map(l => [l.contact_id, l.name] as const),
  );
  const refOf = new Map((refs.data ?? []).map(r => [r.id, r] as const));
  const [busy, setBusy] = useState<string | null>(null);
  async function answer(a: ReferenceAsk, state: ReferenceAsk["state"]) {
    setBusy(a.id);
    try {
      await api("reference.answer", { id: a.id, state });
      toast.success(`Marked ${ASK_STATE[state].label.toLowerCase()}.`);
      asks.reload();
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
    } finally {
      setBusy(null);
    }
  }
  if (asks.error)
    return <Failed what="The asks" error={asks.error} retry={asks.reload} />;
  if (!asks.data) return <Reading what="the asks" />;
  const list = asks.data;
  if (!list.length)
    return (
      <p className="muted text-sm">No reference call has been asked for yet.</p>
    );
  return (
    <ul className="divide-y hairline">
      {list.map(a => (
        <li
          key={a.id}
          className="flex flex-wrap items-start gap-3 py-2.5 text-sm"
        >
          <div className="min-w-0 flex-1">
            <p dir="auto">
              <Link
                to={`/lead/${a.contact_id}`}
                className="font-medium hover:underline"
              >
                {nameOf.get(a.contact_id) ?? "A lead"}
              </Link>
              <span className="muted">
                {" · "}
                <Parts
                  items={[
                    a.reference_id
                      ? (refOf.get(a.reference_id)?.client_name ??
                        "a reference")
                      : "any reference",
                    `asked by ${a.asked_by.split("@")[0]} ${ago(a.asked_at)}`,
                  ]}
                />
              </span>
            </p>
            {a.note ? (
              <p className="muted text-xs" dir="auto">
                {a.note}
              </p>
            ) : null}
          </div>
          <StatusChip
            tone={ASK_STATE[a.state].tone}
            label={ASK_STATE[a.state].label}
          />
          {a.state === "asked" || a.state === "arranged" ? (
            <span className="flex gap-1.5">
              {a.state === "asked" ? (
                <button
                  type="button"
                  disabled={busy === a.id}
                  onClick={() => answer(a, "arranged")}
                  className={`${button} h-7 text-xs`}
                >
                  Arranged
                </button>
              ) : null}
              <button
                type="button"
                disabled={busy === a.id}
                onClick={() => answer(a, "done")}
                className={`${button} h-7 text-xs`}
              >
                Done
              </button>
              <button
                type="button"
                disabled={busy === a.id}
                onClick={() => answer(a, "declined")}
                className={`${button} h-7 text-xs`}
              >
                Not possible
              </button>
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** On the lead: ask for a reference call, and see the ask's answer. */
export function AskReference({ contactId }: { contactId: string }) {
  const refs = useReferences();
  const asks = useReferenceAsks(contactId);
  const [open, setOpen] = useState(false);
  const [refId, setRefId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const latest = asks.data?.[0] ?? null;
  const usable = (refs.data ?? []).filter(r => r.consent !== "no");
  async function ask(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("reference.ask", {
        contact_id: contactId,
        reference_id: refId || undefined,
        note,
      });
      toast.success("Asked. A manager arranges it and marks it here.");
      setOpen(false);
      setNote("");
      asks.reload();
    } catch (err) {
      toast.error(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  }
  // Until this lead's asks are read, an open ask cannot be seen, so the
  // button to ask again waits for the read.
  if (asks.error)
    return (
      <div className="border-t hairline pt-3">
        <Failed
          what="This lead's reference calls"
          error={asks.error}
          retry={asks.reload}
        />
      </div>
    );
  if (!asks.data)
    return (
      <div className="border-t hairline pt-3">
        <Reading what="the reference calls" className="text-xs" />
      </div>
    );
  return (
    <div className="space-y-2 border-t hairline pt-3">
      {latest ? (
        <p className="text-xs">
          Reference call:{" "}
          <StatusChip
            tone={ASK_STATE[latest.state].tone}
            label={ASK_STATE[latest.state].label}
          />{" "}
          <span className="muted">
            <Parts items={[`asked ${ago(latest.asked_at)}`, latest.answer]} />
          </span>
        </p>
      ) : null}
      {open ? (
        <form onSubmit={ask} className="space-y-2">
          <select
            value={refId}
            onChange={e => setRefId(e.target.value)}
            className={field}
            aria-label="Which client"
          >
            <option value="">Whoever fits best (the manager picks)</option>
            {usable.map(r => (
              <option key={r.id} value={r.id}>
                {partsText([r.client_name])}
                {r.consent === "yes" ? "" : " (not asked yet)"}
                {where(r).some(Boolean) ? ` · ${partsText(where(r))}` : ""}
              </option>
            ))}
          </select>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={2}
            placeholder="What they want to hear (for example: a fit-out firm in Riyadh, about lead quality)"
            className={`${field} h-auto py-2`}
            dir="auto"
          />
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className={buttonPrimary}>
              {busy ? "Asking…" : "Ask for the call"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className={button}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : latest &&
        (latest.state === "asked" || latest.state === "arranged") ? null : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`${button} h-7 text-xs`}
        >
          Ask for a reference call
        </button>
      )}
    </div>
  );
}
