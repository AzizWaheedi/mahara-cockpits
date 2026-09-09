import { useState } from "react";
import { CopyButton } from "@/components/WinningAds";
import { fill, type Template } from "@/lib/creativeTemplates";

/**
 * One SOP template, in Arabic or English, ready to paste into the group.
 *
 * `client` swaps the SOP's NAME placeholder for their first word. Everything
 * else is the SOP's wording, untouched.
 */
export function TemplateCard({
  t,
  client,
  defaultLang = "ar",
}: {
  t: Template;
  client?: string;
  defaultLang?: "ar" | "en";
}) {
  const [lang, setLang] = useState<"ar" | "en">(defaultLang);
  const [open, setOpen] = useState(false);
  const text = fill(lang === "ar" ? t.ar : t.en, client);

  return (
    <div className="rounded-lg border">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="text-left text-[13px] font-semibold hover:underline"
        >
          {t.label}
        </button>
        <span className="text-[12px] text-muted-foreground">{t.when}</span>
        <span className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setLang(lang === "ar" ? "en" : "ar")}
            className="rounded border px-1.5 py-0.5 text-[12px] text-muted-foreground hover:bg-muted"
          >
            {lang === "ar" ? "English" : "العربية"}
          </button>
          <CopyButton text={text} label="Copy" />
        </span>
      </div>
      {open && (
        <div className="space-y-2 border-t px-3 py-2.5">
          {t.internal && (
            <p className="callout-warn text-[12px]">
              <strong>Before you send it:</strong> {t.internal}
            </p>
          )}
          <p dir="auto" className="whitespace-pre-wrap text-[13px]">
            {text}
          </p>
        </div>
      )}
    </div>
  );
}
