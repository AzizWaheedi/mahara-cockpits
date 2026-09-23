import logoOnDark from "../assets/mahara-logo-dark.png";
import logoOnLight from "../assets/mahara-logo-light.png";

/**
 * The Mahara Media logo: the real wordmark from Brand Guidelines v1.0
 * (page 6), not a typeset imitation of it. MAHARA in teal; MEDIA in white
 * on dark surfaces, as the guidelines' primary lockup, and in the official
 * colour file's near-black on light ones. The two files swap with the
 * theme, so the mark never disappears into its background.
 *
 * Kept identical in all four cockpits, so the family reads as one product.
 */
const HEIGHT = { sm: "h-6", md: "h-7", lg: "h-10" } as const;

export function Wordmark({
  size = "md",
  className = "",
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const h = HEIGHT[size];
  return (
    <span
      className={`inline-flex shrink-0 select-none items-center ${className}`}
      role="img"
      aria-label="Mahara Media"
    >
      <img
        src={logoOnLight}
        alt=""
        draggable={false}
        className={`${h} w-auto dark:hidden`}
      />
      <img
        src={logoOnDark}
        alt=""
        draggable={false}
        className={`${h} hidden w-auto dark:block`}
      />
    </span>
  );
}
