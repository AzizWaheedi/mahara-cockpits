import { useState } from "react";
import { CreativePreview } from "@/components/CreativePreview";

/**
 * The winning ads, word for word.
 *
 * This is deliberately the same view the media buyer has in the media buyer cockpit, on
 * the same rows, so a script starts from an ad that already earned its money
 * instead of a blank page. Every ad here spent at least $100 and stayed under
 * $15 a lead, kept permanently whether it is still switched on or not.
 */

function fmtDay(d: string | null | undefined): string {
  if (!d) return "";
  const t = Date.parse(d);
  if (Number.isNaN(t)) return d;
  return new Date(t).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

export function WinningAds({
  rows,
  title = "The winning ads, word for word",
  sub,
}: {
  // biome-ignore lint/suspicious/noExplicitAny: query payload is untyped
  rows: any[] | undefined;
  title?: string;
  sub?: string;
}) {
  const [open, setOpen] = useState<string | null>(null);

  if (!rows) {
    return <p className="text-[12px] text-muted-foreground">Loading…</p>;
  }
  if (rows.length === 0) {
    return (
      <p className="text-[12.5px] text-muted-foreground">
        Nothing in this service line has cleared the winner bar yet. Widen the
        filter and read the closest thing to it.
      </p>
    );
  }

  return (
    <div>
      <h3 className="text-[13px] font-bold">{title}</h3>
      <p className="mb-2 text-[11.5px] text-muted-foreground">
        {sub ??
          "Click one to read its hook, its copy and, for video, what is actually said and shown on screen."}
      </p>
      <div className="divide-y rounded-lg border">
        {rows.map(r => {
          const isOpen = open === r.adId;
          return (
            <div key={r.adId}>
              <div className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/50">
                <CreativePreview
                  name={r.adName}
                  thumbUrl={r.thumbUrl ?? undefined}
                  previewSrc={r.previewSrc ?? undefined}
                  metaAdId={r.adId}
                />
                <span className="w-14 shrink-0 text-right text-[12.5px] font-bold tabular-nums">
                  ${Number(r.cpl).toFixed(2)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium">
                    {r.client}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {r.hook || r.headline || r.adName}
                  </span>
                </span>
                <span className="shrink-0 text-right text-[10.5px] text-muted-foreground">
                  {r.leads} leads · ${r.spend} · {r.city ?? "Unknown"}
                  <span className="block">
                    {r.wonFrom
                      ? `won ${fmtDay(r.wonFrom)}${r.wonTo && r.wonTo !== r.wonFrom ? `–${fmtDay(r.wonTo)}` : ""}`
                      : ""}
                    {r.stillLive === false ? (
                      <span
                        className="ml-1 rounded bg-muted px-1 font-semibold uppercase"
                        title={
                          r.retiredOn ? `Off since ${r.retiredOn}` : "Not running"
                        }
                      >
                        retired
                      </span>
                    ) : r.stillLive ? (
                      <span className="ml-1 font-semibold txt-good">live</span>
                    ) : null}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : r.adId)}
                  className="shrink-0 rounded border px-2 py-0.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted"
                >
                  {isOpen ? "Hide" : "Read it"}
                </button>
              </div>
              {isOpen && (
                <div className="space-y-3 border-t bg-muted/30 px-3 py-3 text-[12px]">
                  <div className="flex flex-wrap gap-1.5 text-[10.5px]">
                    {[
                      r.serviceLine,
                      r.format,
                      r.cta,
                      r.voice,
                      r.playType,
                      ...(r.copyTraits ?? []),
                    ]
                      .filter(Boolean)
                      .map((t: string) => (
                        <span
                          key={t}
                          className="rounded border px-1.5 py-0.5 text-muted-foreground"
                        >
                          {t}
                        </span>
                      ))}
                  </div>
                  {r.headline && (
                    <Field label="Headline">
                      <span dir="auto">{r.headline}</span>
                    </Field>
                  )}
                  {r.body && (
                    <Field label="Copy">
                      <span dir="auto" className="whitespace-pre-wrap">
                        {r.body}
                      </span>
                    </Field>
                  )}
                  {r.transcript ? (
                    <Field label="What the video says and shows">
                      <span dir="auto" className="whitespace-pre-wrap">
                        {r.transcript}
                      </span>
                    </Field>
                  ) : (
                    r.format === "video" && (
                      <p className="text-muted-foreground">
                        No script read for this one yet.
                      </p>
                    )
                  )}
                  {r.interests?.length > 0 && (
                    <Field label="Targeting">
                      <span dir="auto">{r.interests.join(" · ")}</span>
                    </Field>
                  )}
                  <CopyButton
                    text={[
                      r.hook && `HOOK: ${r.hook}`,
                      r.headline && `HEADLINE: ${r.headline}`,
                      r.body && `COPY:\n${r.body}`,
                      r.transcript && `SCRIPT:\n${r.transcript}`,
                    ]
                      .filter(Boolean)
                      .join("\n\n")}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

/** Lift the whole thing into a doc without retyping it. */
export function CopyButton({
  text,
  label = "Copy this ad",
}: {
  text: string;
  label?: string;
}) {
  const [done, setDone] = useState(false);
  if (!text) return null;
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        });
      }}
      className="rounded border px-2 py-0.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted"
    >
      {done ? "Copied" : label}
    </button>
  );
}
