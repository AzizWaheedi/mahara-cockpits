/**
 * The mark: three short rules of the core beam, then the name. It is the same
 * hairline motif as the beam under the header, at wordmark scale.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ""}`}>
      <span className="flex flex-col gap-[3px]" aria-hidden>
        <span
          className="h-[2px] w-6 rounded-full"
          style={{ backgroundColor: "var(--mahara-teal)" }}
        />
        <span
          className="h-[2px] w-4 rounded-full"
          style={{
            backgroundColor:
              "color-mix(in srgb, var(--royal-blue) 70%, transparent)",
          }}
        />
        <span
          className="h-[2px] w-2 rounded-full"
          style={{ backgroundColor: "var(--mc-deemphasis)" }}
        />
      </span>
      <span className="text-sm font-semibold tracking-tight text-foreground">
        Memory Core
      </span>
    </span>
  );
}
