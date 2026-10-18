import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { COMMISSION_SHORT, type CommissionBasis } from "@/types/ceo/commission";

/**
 * The commission bases as option groups, so "Per fully closed deal" (our own
 * closer-form deal) and "Per closed client deal" (a deal our client closes)
 * never read alike (pay_design.md section 4). A plain array of option
 * elements: AnimatedSelect reads options and optgroups, not components.
 */
export const COMMISSION_GROUPS: { label: string; bases: CommissionBasis[] }[] =
  [
    {
      label: "A share of our sales",
      bases: [
        "closed_cash",
        "closed_contract",
        "set_cash",
        "set_contract",
        "mrr_managed",
      ],
    },
    {
      label: "Per event in our sales",
      bases: [
        "per_intro_shown",
        "per_qualified_intro_shown",
        "per_demo_shown",
        "per_signed",
        "per_closed_deal",
      ],
    },
    {
      label: "Per event in our clients' results",
      bases: ["per_client_appt_shown", "per_client_deal_closed"],
    },
  ];

export function commissionOptions(opts: {
  /** "No commission", or "No second line" for line 2; left out for a role plan's line. */
  none?: string;
  /** Offer "Other, see note" (the roster only). */
  other?: boolean;
  /** "+ " before each basis, for line 2. */
  plus?: boolean;
}) {
  const say = (b: CommissionBasis) =>
    `${opts.plus ? "+ " : ""}${COMMISSION_SHORT[b]}`;
  return [
    opts.none ? (
      <option key="none" value="none">
        {opts.none}
      </option>
    ) : null,
    ...COMMISSION_GROUPS.map(g => (
      <optgroup key={g.label} label={g.label}>
        {g.bases.map(b => (
          <option key={b} value={b}>
            {say(b)}
          </option>
        ))}
      </optgroup>
    )),
    opts.other ? (
      <option key="other" value="other">
        {say("other")}
      </option>
    ) : null,
  ].filter(Boolean);
}

/**
 * The pay screens' form fields: the validating field of WatchSettings (h-9,
 * a focus ring, a red border when wrong), a number box that keeps what is
 * typed while it is typed, and the server's sentence without its prefixes.
 */

/** A text or number field in a sheet or dialog. */
export const FIELD =
  "h-9 min-w-0 rounded-md border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

/** A label above its field. */
export const LABEL = "text-xs font-medium text-muted-foreground";

/** A control's name above it on a phone, where a row has no column headings. */
export const PHONE_LABEL = "text-[11px] text-muted-foreground @md:hidden";

/** The server's first line, without Postgres' or the client's prefixes. */
export function errorText(
  e: unknown,
  fallback = "That did not go through.",
): string {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  return (
    raw
      .split("\n")[0]
      .replace(/^(ERROR|error):\s*/, "")
      .replace(/^\[.*?]\s*/, "")
      .trim() || fallback
  );
}

/** Typed text as a number: "1,200", "$12.5" and "10%" read; empty or anything else is NaN. */
export function parseNumber(text: string): number {
  const t = text.replace(/[,\s$%]/g, "");
  if (t === "" || t === "-" || t === "." || t === "−") return Number.NaN;
  const n = Number(t.replace("−", "-"));
  return Number.isFinite(n) ? n : Number.NaN;
}

/** A number as a box shows it: no float noise ("0.30000000000000004" is "0.3"). */
export function numberText(v: number | null | undefined, scale = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "";
  return String(Math.round(v * scale * 10000) / 10000);
}

/**
 * A number box. What is typed stays as typed while it is typed ("1." is not
 * rewritten to "1"); the parent gets the number, or NaN for empty or not a
 * number, so the plan's own check names what is wrong. `scale` shows a
 * fraction as a percent (0.1 is typed as 10). A new value from outside (a
 * suggestion applied) replaces the text.
 */
export function NumberBox({
  value,
  onChange,
  scale = 1,
  label,
  prefix,
  suffix,
  invalid,
  disabled,
  className,
  width = "w-20",
  integer,
}: {
  value: number;
  onChange: (v: number) => void;
  scale?: number;
  /** The control's name for a screen reader, with the person or part in it. */
  label: string;
  prefix?: string;
  suffix?: string;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
  width?: string;
  integer?: boolean;
}) {
  const [text, setText] = useState(() => numberText(value, scale));
  const sent = useRef(value);
  useEffect(() => {
    // Only a change made elsewhere rewrites the box.
    const same =
      Object.is(value, sent.current) ||
      (Number.isNaN(value) && Number.isNaN(sent.current));
    if (!same) {
      sent.current = value;
      setText(numberText(value, scale));
    }
  }, [value, scale]);
  const bad =
    invalid ?? (text.trim() !== "" && Number.isNaN(parseNumber(text)));
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {prefix ? (
        <span className="text-xs text-muted-foreground">{prefix}</span>
      ) : null}
      <input
        inputMode={integer ? "numeric" : "decimal"}
        value={text}
        disabled={disabled}
        aria-label={label}
        aria-invalid={bad || undefined}
        onChange={e => {
          setText(e.target.value);
          const n = parseNumber(e.target.value);
          const v = Number.isNaN(n) ? Number.NaN : n / scale;
          const rounded = Number.isNaN(v) ? v : Math.round(v * 1e8) / 1e8;
          sent.current = rounded;
          onChange(rounded);
        }}
        className={cn(
          FIELD,
          width,
          "text-right tabular-nums",
          bad && "border-[color:var(--ceo-critical)]",
        )}
      />
      {suffix ? (
        <span className="text-xs text-muted-foreground">{suffix}</span>
      ) : null}
    </span>
  );
}

/** A tick box with its words beside it; pressing the words ticks it too. */
export function CheckRow({
  checked,
  onChange,
  disabled,
  children,
  className,
  align = "center",
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
  align?: "center" | "start";
}) {
  const id = useId();
  return (
    <span
      className={cn(
        "flex gap-2",
        align === "start" ? "items-start" : "items-center",
        className,
      )}
    >
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={v => onChange(v === true)}
        className={cn("size-4 shrink-0", align === "start" && "mt-0.5")}
      />
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        {children}
      </label>
    </span>
  );
}
