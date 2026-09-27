import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/WinningAds";
import { fill, type Template } from "@/lib/creativeTemplates";

/**
 * One SOP template, in Arabic or English, ready to paste into the group.
 *
 * `client` swaps the SOP's NAME placeholder for their first word. Everything
 * else is the SOP's wording, untouched.
 *
 * A row, not a card: the caller lists them in one divided group, so the
 * library reads as one list rather than a stack of boxes.
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
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="min-w-0 text-left text-sm font-medium hover:underline"
        >
          {t.label}
        </button>
        <span className="text-xs text-muted-foreground">{t.when}</span>
        <span className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setLang(lang === "ar" ? "en" : "ar")}
          >
            {lang === "ar" ? "English" : "العربية"}
          </Button>
          <CopyButton text={text} label="Copy" />
        </span>
      </div>
      {open && (
        <div className="space-y-2 px-3 pb-3">
          {t.internal && (
            <p className="callout-warn rounded-lg px-3 py-2 text-xs">
              <strong>Before you send it:</strong> {t.internal}
            </p>
          )}
          <p dir="auto" className="whitespace-pre-wrap text-sm">
            {text}
          </p>
        </div>
      )}
    </div>
  );
}
