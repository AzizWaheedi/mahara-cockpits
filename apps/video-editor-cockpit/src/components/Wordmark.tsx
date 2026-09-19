/**
 * The Mahara Media wordmark, set in Geist (brand guidelines §2, §3): tight
 * tracking, "MEDIA" spaced out in mono, teal only on the mark, never as a
 * fill. Copied from the other cockpits so the family reads as one product.
 */
export function Wordmark({
  size = "md",
  className = "",
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const scale =
    size === "lg"
      ? { word: "text-3xl", sub: "text-[11px]", mark: "size-2.5" }
      : size === "sm"
        ? { word: "text-base", sub: "text-[8px]", mark: "size-1.5" }
        : { word: "text-xl", sub: "text-[9px]", mark: "size-2" };
  return (
    <span
      className={`inline-flex select-none flex-col items-start leading-none ${className}`}
      role="img"
      aria-label="Mahara Media"
    >
      <span
        className={`${scale.word} inline-flex items-center gap-1.5 font-semibold tracking-[-0.04em] text-[color:var(--foreground)]`}
      >
        MAHARA
        <span
          className={`${scale.mark} rounded-full bg-[color:var(--mahara-teal)] shadow-[0_0_10px_var(--mahara-teal)]`}
          aria-hidden
        />
      </span>
      <span
        className={`${scale.sub} muted mt-1 font-mono font-medium tracking-[0.32em] uppercase`}
      >
        Media
      </span>
    </span>
  );
}
