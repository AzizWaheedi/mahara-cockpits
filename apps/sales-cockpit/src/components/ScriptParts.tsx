import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useQuery } from "../lib/data";
import {
  type Block,
  type Fill,
  firstSentence,
  type PlaybookEntry,
  personalise,
  type ScriptRow,
} from "../lib/script";
import { supabase } from "../lib/supabase";
import { field, SectionCard } from "./kit";

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
    <div
      className="raised inline-flex rounded-[var(--radius-md)] p-0.5 text-[13px]"
      role="group"
      aria-label={label}
    >
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`rounded-[calc(var(--radius-md)-2px)] px-2.5 py-1 ${
            value === v
              ? "bg-[color:var(--card)] font-medium shadow-sm"
              : "muted"
          }`}
        >
          {text}
        </button>
      ))}
    </div>
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
        const text = b.text ? personalise(b.text, fill) : "";
        if (b.type === "say")
          return (
            <p
              key={i}
              dir="auto"
              className={`rounded-e-[var(--radius-md)] border-s-2 py-1 ps-3 leading-relaxed ${
                mode === "bullets" ? "text-[15px]" : "text-[17px]"
              }`}
              style={{
                borderColor: "var(--primary)",
                background:
                  "color-mix(in oklch, var(--primary) 7%, transparent)",
              }}
            >
              {mode === "bullets" ? firstSentence(text) : text}
            </p>
          );
        if (b.type === "adapt")
          return (
            <p
              key={i}
              dir="auto"
              className={`leading-relaxed ${mode === "bullets" ? "text-sm" : "text-[15px]"}`}
            >
              {mode === "bullets" ? firstSentence(text) : text}
            </p>
          );
        if (b.type === "step")
          return (
            <p
              key={i}
              className="pt-1 text-[13px] font-semibold"
              style={{ color: "var(--primary)" }}
            >
              {text}
            </p>
          );
        if (b.type === "list")
          return (
            <ul key={i} className="list-disc space-y-1 pl-5 text-sm" dir="auto">
              {(b.items ?? []).map((it, j) => (
                <li key={j}>{personalise(it, fill)}</li>
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
            {text}
          </p>
        );
      })}
    </div>
  );
}

export function BranchGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-[var(--radius-md)] border hairline">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium hover:bg-[color:var(--secondary)]"
        dir="auto"
      >
        {open ? (
          <ChevronDown className="size-4 shrink-0" aria-hidden />
        ) : (
          <ChevronRight className="size-4 shrink-0" aria-hidden />
        )}
        {label}
      </button>
      {open ? (
        <div className="border-t hairline px-3 py-3">{children}</div>
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
                    <li key={id} className="border-t hairline first:border-t-0">
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={() => setOpen(isOpen ? null : id)}
                        className="flex w-full items-start gap-2 px-4 py-2 text-left text-sm hover:bg-[color:var(--secondary)]"
                        dir="auto"
                      >
                        {isOpen ? (
                          <ChevronDown
                            className="mt-0.5 size-3.5 shrink-0"
                            aria-hidden
                          />
                        ) : (
                          <ChevronRight
                            className="mt-0.5 size-3.5 shrink-0"
                            aria-hidden
                          />
                        )}
                        {e.title}
                      </button>
                      {isOpen ? (
                        <div className="px-4 pb-3">
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
