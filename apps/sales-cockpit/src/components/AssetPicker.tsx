import { Check, Copy, ExternalLink, FileVideo, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import {
  type Asset,
  assetMessage,
  durationWords,
  shortlist,
} from "../lib/assets";
import {
  type AssetWord,
  useAssetSends,
  useAssets,
  useAssetVocab,
} from "../lib/data";
import { ago } from "../lib/format";
import { toast } from "../lib/toast";
import { button, EmptyState, Failed, field } from "./kit";

/**
 * The sales assets in the cockpit: B2B's library (Muhammed's, copied every
 * hour), every asset tagged with the stages and objections it answers and a
 * message ready to paste in Arabic and English. For a lead, the three that
 * answer what they said on the calls; in Links, the whole library.
 */

function labelOf(words: AssetWord[] | null, facet: string, value: string) {
  return (
    words?.find(w => w.facet === facet && w.value === value)?.label ??
    value.replace(/_/g, " ")
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="muted inline-flex items-center gap-1 text-xs hover:underline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          window.setTimeout(() => setDone(false), 1500);
        } catch {
          toast.error("The browser would not copy. Select the text instead.");
        }
      }}
    >
      {done ? (
        <Check className="size-3" aria-hidden />
      ) : (
        <Copy className="size-3" aria-hidden />
      )}
      {done ? "Copied" : label}
    </button>
  );
}

/** The proof that answers this lead: their objections, their stage, their language. */
export function ProofToSend({
  contactId,
  language,
  stage,
  objections,
  onUse,
}: {
  contactId: string;
  language: "ar" | "en";
  stage: string | null;
  objections: string[];
  /** Put the asset's message in the conversation box. */
  onUse?: (text: string, asset: Asset) => void;
}) {
  const assets = useAssets();
  const vocab = useAssetVocab();
  const sends = useAssetSends(contactId);
  const picks = useMemo(
    () => shortlist(assets.data ?? [], { objections, stage, language }, 3),
    [assets.data, objections, stage, language],
  );
  const sentAt = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sends.data ?? [])
      if (!m.has(s.asset_id)) m.set(s.asset_id, s.sent_at);
    return m;
  }, [sends.data]);

  if (assets.error)
    return (
      <Failed
        what="The sales assets"
        error={assets.error}
        retry={assets.reload}
      />
    );
  if (assets.loading && !assets.data)
    return <p className="muted text-sm">Reading the library…</p>;
  if (!assets.data?.length)
    return (
      <p className="muted text-sm">
        The library has not been copied from B2B yet. It comes over every hour.
      </p>
    );
  const words = vocab.data ?? null;
  return (
    <div className="space-y-3">
      <p className="muted text-xs">
        {objections.length
          ? `For what they raised: ${objections.map(o => labelOf(words, "objection", o)).join(", ")}`
          : "No objection in their call notes yet, so this is proof for where they are"}
        {stage ? ` · ${labelOf(words, "stage", stage)}` : ""}.
      </p>
      {picks.length ? (
        <ul className="space-y-3">
          {picks.map(({ asset: a, answers, why }) => {
            const sent = sentAt.get(a.id);
            return (
              <li key={a.id} className="space-y-1">
                <p className="text-sm font-medium" dir="auto">
                  {a.title}
                </p>
                <p className="muted text-xs">
                  {labelOf(words, "asset_type", a.asset_type)}
                  {a.duration_seconds
                    ? ` · ${durationWords(a.duration_seconds)}`
                    : ""}
                  {` · ${why}`}
                  {answers.length
                    ? ` · answers ${answers.map(o => labelOf(words, "objection", o)).join(", ")}`
                    : ""}
                  {sent ? ` · sent to them ${ago(sent)}` : ""}
                </p>
                {a.what_it_proves ? (
                  <p className="muted line-clamp-2 text-xs" dir="auto">
                    {a.what_it_proves}
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center gap-3 pt-0.5">
                  {onUse ? (
                    <button
                      type="button"
                      onClick={() => onUse(assetMessage(a, language), a)}
                      className={`${button} h-7 text-xs`}
                    >
                      Put in the message
                    </button>
                  ) : null}
                  {a.url ? <CopyButton text={a.url} label="Copy link" /> : null}
                  {a.url ? (
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="muted inline-flex items-center gap-1 text-xs hover:underline"
                    >
                      <ExternalLink className="size-3" aria-hidden /> Open
                    </a>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted text-sm">
          Nothing in the library matches yet. Browse all of it in Links.
        </p>
      )}
      <Link to="/links#assets" className="muted text-xs hover:underline">
        The whole library
      </Link>
    </div>
  );
}

/** The whole library, for Links: filter by stage, objection, kind and language. */
export function AssetLibrary() {
  const assets = useAssets();
  const vocab = useAssetVocab();
  const [stage, setStage] = useState("");
  const [objection, setObjection] = useState("");
  const [kind, setKind] = useState("");
  const [language, setLanguage] = useState<"ar" | "en">("ar");
  const [term, setTerm] = useState("");
  const [copies, setCopies] = useState(false);
  const words = vocab.data ?? [];
  const of = (facet: string) =>
    words
      .filter(w => w.facet === facet)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const list = useMemo(() => {
    const t = term.trim().toLowerCase();
    return (assets.data ?? [])
      .filter(
        a =>
          (copies || a.is_canonical) &&
          (!stage || a.stages.includes(stage)) &&
          (!objection || a.objections.includes(objection)) &&
          (!kind || a.asset_type === kind) &&
          (!a.language || a.language === language || a.language === "mixed") &&
          (!t ||
            `${a.title} ${a.what_it_proves ?? ""} ${a.send_when ?? ""}`
              .toLowerCase()
              .includes(t)),
      )
      .sort(
        (a, b) =>
          (b.send_count ?? 0) - (a.send_count ?? 0) ||
          a.title.localeCompare(b.title),
      );
  }, [assets.data, stage, objection, kind, language, term, copies]);

  const select = (
    value: string,
    set: (v: string) => void,
    facet: string,
    all: string,
  ) => (
    <select
      value={value}
      onChange={e => set(e.target.value)}
      className={`${field} w-auto`}
      aria-label={all}
    >
      <option value="">{all}</option>
      {of(facet).map(w => (
        <option key={w.value} value={w.value}>
          {w.label ?? w.value}
        </option>
      ))}
    </select>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative">
          <Search
            className="muted pointer-events-none absolute start-2.5 top-2.5 size-4"
            aria-hidden
          />
          <input
            value={term}
            onChange={e => setTerm(e.target.value)}
            placeholder="Search the library"
            className={`${field} w-56 ps-8`}
          />
        </label>
        {select(stage, setStage, "stage", "Any stage")}
        {select(objection, setObjection, "objection", "Any objection")}
        {select(kind, setKind, "asset_type", "Any kind")}
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
              aria-pressed={language === k}
              onClick={() => setLanguage(k)}
              className={`rounded-[calc(var(--radius-md)-2px)] px-2 py-1 ${language === k ? "bg-[color:var(--card)] font-medium shadow-sm" : "muted"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="muted inline-flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={copies}
            onChange={e => setCopies(e.target.checked)}
          />
          Show other cuts of the same asset
        </label>
      </div>
      {assets.error ? (
        <Failed what="The library" error={assets.error} retry={assets.reload} />
      ) : assets.loading && !assets.data ? (
        <p className="muted text-sm">Reading the library…</p>
      ) : !list.length ? (
        <EmptyState
          icon={FileVideo}
          title={
            assets.data?.length
              ? "Nothing matches"
              : "The library is not here yet"
          }
          text={
            assets.data?.length
              ? "Loosen a filter or search for another word."
              : "It is copied from B2B every hour."
          }
        />
      ) : (
        <ul className="divide-y hairline">
          {list.map(a => (
            <li key={a.id} className="space-y-1 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium" dir="auto">
                  {a.title}
                </p>
                <p className="muted text-xs">
                  {labelOf(words, "asset_type", a.asset_type)}
                  {a.duration_seconds
                    ? ` · ${durationWords(a.duration_seconds)}`
                    : ""}
                  {a.send_count ? ` · sent ${a.send_count}×` : ""}
                </p>
              </div>
              {a.what_it_proves ? (
                <p className="muted text-xs" dir="auto">
                  {a.what_it_proves}
                </p>
              ) : null}
              {a.send_when ? (
                <p className="text-xs" dir="auto">
                  <span className="muted">When: </span>
                  {a.send_when}
                </p>
              ) : null}
              <p className="muted text-[11px]">
                {a.stages.map(s => labelOf(words, "stage", s)).join(", ")}
                {a.objections.length
                  ? ` · answers ${a.objections.map(o => labelOf(words, "objection", o)).join(", ")}`
                  : ""}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <CopyButton
                  text={assetMessage(a, language)}
                  label="Copy the message"
                />
                {a.url ? <CopyButton text={a.url} label="Copy link" /> : null}
                {a.url ? (
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="muted inline-flex items-center gap-1 text-xs hover:underline"
                  >
                    <ExternalLink className="size-3" aria-hidden /> Open
                  </a>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="muted text-[11px]">
        From the B2B asset library (Muhammed's), copied every hour. Only what
        B2B allows to be sent is here: links that work, claims that have not
        expired, no YouTube video from before 19 July.
      </p>
    </div>
  );
}
