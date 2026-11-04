/**
 * The agreed daily budget against the budget now, on a client's page
 * (20261103e, DEL-13 "Budget vs contract"). The words are the database's
 * (cockpit_board_agreed_note on the Budget/day cell): "Agreed $40 a day
 * (kickoff, 150 SAR). Set now: $25 a day." Display only: never judged, no
 * status dot, never on a slide.
 */
import { z } from "zod";
import type { Cell } from "@/lib/boardClient";

const AgreedSchema = z
  .object({
    usd: z.number().nullable().optional(),
    key: z.string().nullable().optional(),
    from: z.string().nullable().optional(),
    /** "Agreed $40 a day (kickoff, 150 SAR)." or "No agreed budget yet." */
    head: z.string().nullable().optional(),
    /** "Set now: $25 a day.", or none when the budget now was not read. */
    now: z.string().nullable().optional(),
    words: z.string(),
    /** Why a source found is not the default ("The sale's figure, $1,200 a day, ..."). */
    notes: z.array(z.string()).nullable().optional(),
  })
  .passthrough();
export type AgreedNote = z.output<typeof AgreedSchema>;

/** The cell's agreed note, or null before 20261103e or on another shape. */
export function agreedOf(cell: Cell | null | undefined): AgreedNote | null {
  const parsed = AgreedSchema.safeParse(
    (cell as { agreed?: unknown } | null | undefined)?.agreed,
  );
  return parsed.success ? parsed.data : null;
}

/** The help line: the words, then why any source is not the default. */
export function agreedHelp(cell: Cell | null | undefined): string | null {
  const a = agreedOf(cell);
  return a ? [a.words, ...(a.notes ?? [])].join(" ") : null;
}

/** Under "Daily budget now" in Numbers against targets: the agreed figure alone. */
export function AgreedSubline({ cell }: { cell: Cell | null | undefined }) {
  const a = agreedOf(cell);
  if (!a?.head) return null;
  return (
    <span
      className="block text-[11px] leading-4 text-muted-foreground tabular-nums"
      data-agreed-line
    >
      {a.head}
    </span>
  );
}

/** At the top of Budget and spend: the agreed figure against the budget set now. */
export function AgreedAgainstNow({ cell }: { cell: Cell | null | undefined }) {
  const a = agreedOf(cell);
  if (!a) return null;
  return (
    <div className="space-y-1" data-agreed-now>
      <p className="text-[13px] tabular-nums">
        {a.head ? (
          <span className="font-medium text-foreground">{a.head}</span>
        ) : (
          <span className="text-foreground">{a.words}</span>
        )}
        {a.head && a.now ? (
          <span className="text-muted-foreground"> {a.now}</span>
        ) : null}
      </p>
      {a.notes?.length ? (
        <p className="text-xs text-muted-foreground">{a.notes.join(" ")}</p>
      ) : null}
    </div>
  );
}
