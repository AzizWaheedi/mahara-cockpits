/* Hallmark · component: win ribbon · genre: modern-minimal · theme: the cockpit's own (Geist, --mahara-teal)
 * states: done · waiting · todo · declined · voided · focus-visible (row links)
 * contrast: pass (40–41): stop words use --wr-ink / --wr-wait mixes; edges 3:1 on the card
 * Hallmark · pre-emit critique: P5 H4 E4 S5 R5 V4
 *
 * Design plan (docs/forms/WAVE56-CONTRACT.md 5.0), written before the code:
 * - Subject: the money a client success manager earns the company after the
 *   sale, and the proof behind it. Audience: the CSM and the CEO, at a desk or
 *   on the phone app. Job: see where each win stands in one glance.
 * - Tokens: the cockpit's own. --mahara-teal for done, amber (--warning) for
 *   waiting, the muted ink for not yet, the destructive red never here (only
 *   on Void and Revoke buttons). Geist for words, Geist Mono for the track,
 *   money, dates and stage names. Client names in <bdi>.
 * - Layout: one row per win. The kind and the client on the first line, the
 *   track under it, the money at the right end; at phone width the money
 *   drops under the track instead of squeezing it.
 * - Signature: the track itself. Offered → Accepted → Paid → Pay for an
 *   upsell, Logged → Pay for the rest; a voided win cuts the track with a short
 *   muted dash and its reason, and its money is struck. Under 30rem the track
 *   runs down a rule, one stop a line. Links are underlined at rest (no hover
 *   on a phone). The only motion is a stop filling (150 ms, none
 *   under reduced motion).
 * - Against the template: no progress bar with a percentage, no badge soup;
 *   the stops are words with dates, and a missing amount reads "not known".
 */

import "@/forms/staff/formSheet.css";
import type { ReactNode } from "react";
import { ribbonOf, type WinRow } from "@/lib/winsCore";

export function WinRibbon({
  win,
  client,
  actions,
}: {
  win: WinRow;
  /** The client's name, on the Money tab where rows come from many clients. */
  client?: string | null;
  actions?: ReactNode;
}) {
  const r = ribbonOf(win);
  return (
    <div
      className="wr-root"
      data-win={win.id}
      data-stage={win.stage}
      data-voided={r.voided ? true : undefined}
    >
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="min-w-0 text-sm font-medium">
          {win.kindLabel}
          {client ? (
            <span className="font-normal text-muted-foreground">
              {" · "}
              <bdi>{client}</bdi>
            </span>
          ) : null}
          {win.offerName && win.offerName !== win.kindLabel ? (
            <span className="font-normal text-muted-foreground">
              {" · "}
              {win.offerName}
            </span>
          ) : null}
        </span>
        {r.money ? <span className="wr-money">{r.money}</span> : null}
      </div>
      <ol className="wr-track" aria-label={`${win.kindLabel}: where it stands`}>
        {r.stops.map(s => (
          <li
            key={s.key}
            className="wr-stop"
            data-state={s.state}
            data-stop={s.key}
          >
            <span className="wr-dot" aria-hidden />
            <span>{s.label}</span>
            {s.state === "done" && s.date ? (
              <span className="wr-date">{s.date}</span>
            ) : null}
            {s.sentence ? <span className="wr-said">{s.sentence}</span> : null}
            <span className="sr-only">
              {s.state === "done"
                ? ", done"
                : s.state === "waiting"
                  ? ", waiting"
                  : s.state === "declined"
                    ? ", declined"
                    : ", not yet"}
            </span>
          </li>
        ))}
        {r.voided ? (
          <li className="wr-cut" data-cut>
            Voided: {r.voided.reason}
          </li>
        ) : null}
      </ol>
      {win.proofUrl || win.agreementUrl ? (
        <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          {win.proofUrl ? (
            <a
              href={win.proofUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-sm text-foreground/80 underline decoration-1 underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Open the proof ↗
            </a>
          ) : null}
          {win.agreementUrl ? (
            <a
              href={win.agreementUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-sm text-foreground/80 underline decoration-1 underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Open the agreement ↗
            </a>
          ) : null}
        </p>
      ) : null}
      {actions ? (
        <div className="flex flex-wrap gap-2 pt-1">{actions}</div>
      ) : null}
    </div>
  );
}
