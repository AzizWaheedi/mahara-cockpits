import { Search } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useQuery } from "../lib/data";
import { isArabic } from "../lib/format";
import { TOKEN_LABELS } from "../lib/funnel";
import {
  type Block,
  type Fill,
  firstSentence,
  lineParts,
  type PlaybookEntry,
  personaliseMarked,
  type ScriptRow,
} from "../lib/script";
import { supabase } from "../lib/supabase";
import { field, Segmented as KitSegmented, SectionCard } from "./kit";

/**
 * The call scripts as the cockpit draws them, shared by the guided call
 * (/call) and the dialer's Script tab: the rep's language and "word for word
 * or bullets" choice, the lines with the lead's details filled in, the
 * branches folded, and the objections and questions playbook.
 */

export type Key = "intro" | "demo";
export type Mode = "words" | "bullets";

const PREF = "sales_call_prefs";

export function readPrefs(): { lang: "en" | "ar"; mode: Mode } {
  try {
    const p = JSON.parse(localStorage.getItem(PREF) ?? "{}");
    return {
      lang: p.lang === "en" ? "en" : "ar",
      mode: p.mode === "bullets" ? "bullets" : "words",
    };
  } catch {
    return { lang: "ar", mode: "words" };
  }
}

export function writePrefs(p: { lang: "en" | "ar"; mode: Mode }) {
  try {
    localStorage.setItem(PREF, JSON.stringify(p));
  } catch {
    // it still works, it just forgets
  }
}

export function useScript(key: Key, lang: "en" | "ar") {
  return useQuery<ScriptRow>(
    () =>
      supabase
        .from("cockpit_sales_scripts")
        .select("*")
        .eq("key", key)
        .eq("lang", lang)
        .eq("active", true)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle(),
    [key, lang],
  );
}

const COUNTRIES: Record<string, [string, string]> = {
  KW: ["Kuwait", "الكويت"],
  SA: ["Saudi Arabia", "السعودية"],
  AE: ["the UAE", "الإمارات"],
  QA: ["Qatar", "قطر"],
  BH: ["Bahrain", "البحرين"],
  OM: ["Oman", "عُمان"],
};

/** The lead's country as the script says it; the CRM only has the code. */
export function countryName(
  code: string | null | undefined,
  lang: "en" | "ar",
): string | null {
  const c = COUNTRIES[String(code ?? "").toUpperCase()];
  return c ? (lang === "ar" ? c[1] : c[0]) : null;
}

/** The kit's segmented control (teal when chosen), under its old name here. */
export function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <KitSegmented
      label={label}
      value={value}
      options={options}
      onChange={onChange}
    />
  );
}

/**
 * A line with what the notes filled in set apart (a teal tint: said from the
 * prospect's own numbers) and each number the notes still need shown as a
 * dashed blank with what to ask for, so a rep never reads out a bracket.
 */
export function Line({ text }: { text: string }) {
  const parts = lineParts(text);
  if (parts.length === 1 && parts[0].kind === "text")
    return <>{parts[0].text}</>;
  const lang = isArabic(text) ? "ar" : "en";
  return (
    <>
      {parts.map((p, i) =>
        p.kind === "text" ? (
          <span key={i}>{p.text}</span>
        ) : p.kind === "filled" ? (
          <span
            key={i}
            title="From the notes"
            className="rounded-[3px] px-[0.2em] font-medium [box-decoration-break:clone]"
            style={{
              background:
                "color-mix(in oklab, var(--primary) 16%, transparent)",
            }}
          >
            {p.text}
          </span>
        ) : (
          <span
            key={i}
            title="Not in the notes yet. Ask for it before you say this line."
            className="muted mx-[0.1em] inline-block rounded-[3px] border border-dashed px-[0.35em] align-baseline text-[0.8em] leading-snug"
            style={{ borderColor: "var(--muted-foreground)" }}
          >
            {TOKEN_LABELS[p.token]?.[lang] ?? p.token}
          </span>
        ),
      )}
    </>
  );
}

export function Blocks({
  blocks,
  fill,
  mode,
}: {
  blocks: Block[];
  fill: Fill;
  mode: Mode;
}) {
  return (
    <div className="space-y-2.5">
      {blocks.map((b, i) => {
        const text = b.text ? personaliseMarked(b.text, fill) : "";
        const shown = mode === "bullets" ? firstSentence(text) : text;
        if (b.type === "say")
          return (
            <p
              key={i}
              dir="auto"
              className={`border-s-2 py-1 ps-3 leading-relaxed ${
                mode === "bullets" ? "text-[15px]" : "text-[17px]"
              }`}
              style={{ borderColor: "var(--primary)" }}
            >
              <Line text={shown} />
            </p>
          );
        if (b.type === "adapt")
          return (
            <p
              key={i}
              dir="auto"
              className={`leading-relaxed ${mode === "bullets" ? "text-sm" : "text-[15px]"}`}
            >
              <Line text={shown} />
            </p>
          );
        if (b.type === "step")
          return (
            <p
              key={i}
              className="pt-1 text-[13px] font-semibold"
              style={{ color: "var(--primary)" }}
            >
              <Line text={text} />
            </p>
          );
        if (b.type === "list")
          return (
            <ul key={i} className="list-disc space-y-1 pl-5 text-sm" dir="auto">
              {(b.items ?? []).map((it, j) => (
                <li key={j}>
                  <Line text={personaliseMarked(it, fill)} />
                </li>
              ))}
            </ul>
          );
        if (mode === "bullets") return null;
        return (
          <p
            key={i}
            dir="auto"
            className="muted text-[13px] italic leading-relaxed"
          >
            <Line text={text} />
          </p>
        );
      })}
    </div>
  );
}

export function BranchGroup({
  label,
  children,
  open: openNow = false,
  badge,
}: {
  label: string;
  children: ReactNode;
  /** Opens the branch by itself, as when it matches the prospect's numbers. */
  open?: boolean;
  badge?: ReactNode;
}) {
  const [open, setOpen] = useState(openNow);
  useEffect(() => {
    if (openNow) setOpen(true);
  }, [openNow]);
  return (
    <div
      className={`rounded-[18px] border transition-all ${
        open
          ? "border-[color:color-mix(in_oklch,var(--primary)_35%,transparent)] bg-[color:var(--card)]/90 shadow-sm"
          : "border-white/10 bg-white/[0.02] hover:border-white/20"
      }`}
      style={badge ? { borderColor: "var(--primary)" } : undefined}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left text-sm font-medium transition-colors hover:bg-white/[0.04]"
        dir="auto"
      >
        <span className="min-w-0 flex-1">{label}</span>
        <div className="flex items-center gap-2">
          {badge}
          <span
            className={`flex size-5 items-center justify-center rounded-full border transition-all ${
              open
                ? "border-[color:var(--primary)] bg-[color:color-mix(in_oklch,var(--primary)_15%,transparent)] text-[color:var(--primary)]"
                : "border-border text-muted-foreground"
            }`}
          >
            <span className="text-xs font-bold leading-none">
              {open ? "−" : "+"}
            </span>
          </span>
        </div>
      </button>
      {open ? (
        <div className="border-t border-white/5 px-3.5 py-3">{children}</div>
      ) : null}
    </div>
  );
}

export function Playbook({
  objections,
  faqs,
  fill,
}: {
  objections: PlaybookEntry[];
  faqs: PlaybookEntry[];
  fill: Fill;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const match = (e: PlaybookEntry) =>
    !q.trim() ||
    e.title.toLowerCase().includes(q.toLowerCase()) ||
    e.blocks.some(b => (b.text ?? "").toLowerCase().includes(q.toLowerCase()));
  const sections: [string, PlaybookEntry[]][] = [
    ["Objections", objections.filter(match)],
    ["Questions they ask", faqs.filter(match)],
  ];
  return (
    <SectionCard title="Objections and questions" flush>
      <div className="border-b hairline p-3">
        <label className="relative block">
          <span className="sr-only">Search</span>
          <Search
            className="muted pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
            aria-hidden
          />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Too expensive, partner, think about it…"
            className={`${field} pl-8`}
          />
        </label>
      </div>
      <div className="max-h-[60vh] overflow-y-auto">
        {sections.map(([title, list]) =>
          list.length ? (
            <div key={title}>
              <p className="muted px-4 pt-3 pb-1 text-xs font-medium">
                {title}
              </p>
              <ul>
                {list.map(e => {
                  const id = `${title}:${e.title}`;
                  const isOpen = open === id;
                  return (
                    <li
                      key={id}
                      className="border-t border-white/5 first:border-t-0"
                    >
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={() => setOpen(isOpen ? null : id)}
                        className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm font-medium transition-colors ${
                          isOpen
                            ? "bg-foreground/[0.04] text-foreground font-semibold"
                            : "hover:bg-foreground/[0.03] text-foreground"
                        }`}
                        dir="auto"
                      >
                        <span className="min-w-0 flex-1">{e.title}</span>
                        <span
                          className={`flex size-5 shrink-0 items-center justify-center rounded-full border transition-all ${
                            isOpen
                              ? "border-[color:var(--primary)] bg-[color:color-mix(in_oklch,var(--primary)_15%,transparent)] text-[color:var(--primary)]"
                              : "border-border text-muted-foreground"
                          }`}
                        >
                          <span className="text-xs font-bold leading-none">
                            {isOpen ? "−" : "+"}
                          </span>
                        </span>
                      </button>
                      {isOpen ? (
                        <div className="border-t border-white/5 bg-black/10 px-4 py-3">
                          <Blocks blocks={e.blocks} fill={fill} mode="words" />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null,
        )}
      </div>
    </SectionCard>
  );
}
