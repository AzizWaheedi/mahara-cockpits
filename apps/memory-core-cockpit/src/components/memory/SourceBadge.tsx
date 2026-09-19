import { sourceColor, sourceLabel } from "./format";

/**
 * Where an item lives: a small mark plus the name of the source.
 *
 * The colour is the second signal, never the only one — the label is always
 * beside it, so the row still reads correctly in greyscale or to a screen
 * reader.
 */
export function SourceBadge({
  source,
  when,
  className,
}: {
  source: string;
  /** A date line to sit after the name, already formatted. */
  when?: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground ${className ?? ""}`}
    >
      <span
        className="mc-source-mark size-1.5 shrink-0 rounded-full"
        style={{
          backgroundColor: sourceColor(source),
          color: sourceColor(source),
        }}
        aria-hidden
      />
      {sourceLabel(source)}
      {when ? (
        <>
          <span aria-hidden className="text-muted-foreground/50">
            ·
          </span>
          <span className="font-normal normal-case tracking-normal text-muted-foreground">
            {when}
          </span>
        </>
      ) : null}
    </span>
  );
}
