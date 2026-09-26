import { useAction } from "convex/react";
import { Lightbulb, Star } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  CreativePreview,
  type LocalStill,
  stillPropsFor,
  useLocalStills,
} from "@/components/CreativePreview";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import { api } from "../../convex/_generated/api";

/**
 * The winning ads, word for word.
 *
 * This is deliberately the same view the media buyer has in the media buyer cockpit, on
 * the same rows, so a script starts from an ad that already earned its money
 * instead of a blank page. Ads found by the weekly check spent at least $100
 * and stayed under $15 a lead; ads marked Saved were picked by the team in
 * the media buyer cockpit, with their numbers from the day they were saved.
 * Both are kept permanently whether the ad is still switched on or not.
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

function fmtDate(ms: number | null | undefined): string {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function dollars(n: unknown, digits = 0): string {
  return typeof n === "number" && Number.isFinite(n)
    ? `$${n.toLocaleString("en-US", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })}`
    : "n/a";
}

/**
 * "Numbers when saved (Last 10 days, 1 Sep to 10 Sep): $420.00 spent, 38
 * leads, $11.05 a lead", worded as in the media buyer's What works.
 */
function savedNumbers(r: any): string | null {
  const st = r.savedStats;
  if (!st) return null;
  const range = r.savedRange
    ? `${fmtDay(r.savedRange.start)} to ${fmtDay(r.savedRange.end)}`
    : "";
  const rangeText = r.savedRange?.label
    ? `${r.savedRange.label}, ${range}`
    : range;
  return `Numbers when saved${rangeText ? ` (${rangeText})` : ""}: ${dollars(st.spend, 2)} spent, ${st.leads} lead${st.leads === 1 ? "" : "s"}, ${dollars(st.cpl, 2)} a lead`;
}

/** Who saved it, as the media buyer's badge names them. */
function saverName(r: any): string {
  return r.savedByName ?? "the team";
}

export type WinnerOrigin = "all" | "saved" | "auto";

/**
 * "All", "Saved by the team", "Found by the weekly check", and a "Saved by"
 * pick when anyone has saved something. People seen once stay in the pick
 * while the list is narrowed to one of them.
 */
export function WinnerFilter({
  rows,
  origin,
  onOrigin,
  savedBy,
  onSavedBy,
}: {
  rows: any[] | undefined;
  origin: WinnerOrigin;
  onOrigin: (o: WinnerOrigin) => void;
  savedBy: string;
  onSavedBy: (email: string) => void;
}) {
  const people = useRef(new Map<string, string>());
  for (const r of rows ?? []) {
    if (r.isSaved && r.savedBy)
      people.current.set(
        String(r.savedBy).toLowerCase(),
        r.savedByName ?? String(r.savedBy).split("@")[0],
      );
  }
  const names = [...people.current.entries()].sort((a, b) =>
    a[1].localeCompare(b[1]),
  );
  const chips: { key: WinnerOrigin; label: string }[] = [
    { key: "all", label: "All" },
    { key: "saved", label: "Saved by the team" },
    { key: "auto", label: "Found by the weekly check" },
  ];
  return (
    // One row that scrolls sideways on a phone rather than wrapping.
    <div className="-mx-4 flex flex-nowrap items-center gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 [&::-webkit-scrollbar]:hidden">
      {chips.map(c => (
        <button
          key={c.key}
          type="button"
          onClick={() => {
            onOrigin(c.key);
            if (c.key === "auto") onSavedBy("");
          }}
          aria-pressed={origin === c.key}
          // 32px to the eye, a 40px target to a finger.
          className={`no-touch relative h-8 shrink-0 whitespace-nowrap rounded-full px-3 text-xs font-medium transition-colors after:absolute after:inset-x-0 after:-inset-y-1 after:content-[''] ${
            origin === c.key
              ? "bg-primary/15 text-foreground ring-1 ring-inset ring-primary/40"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          {c.label}
        </button>
      ))}
      {names.length > 0 && origin !== "auto" && (
        <AnimatedSelect
          value={savedBy}
          onChange={e => onSavedBy(e.target.value)}
          aria-label="Saved by"
          className="ml-1 h-8 shrink-0 rounded-full border bg-background px-3 text-xs"
        >
          <option value="">Saved by anyone</option>
          {names.map(([email, name]) => (
            <option key={email} value={email}>
              Saved by {name}
            </option>
          ))}
        </AnimatedSelect>
      )}
    </div>
  );
}

export function WinningAds({
  rows,
  title = "The winning ads, word for word",
  sub,
  empty,
  local,
}: {
  rows: any[] | undefined;
  title?: string;
  sub?: string;
  /** What to say when nothing matches. */
  empty?: string;
  /** Saved stills the page already looked up; otherwise this looks them up. */
  local?: Record<string, LocalStill>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const own = useLocalStills(local ? [] : (rows ?? []).map(r => r.stillKey));
  const stills = local ?? own;

  if (!rows) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {empty ??
          "Nothing in this service line has cleared the winner bar yet. Widen the filter and read the closest thing to it."}
      </p>
    );
  }

  const about =
    sub ??
    "Click one to read its hook, its copy and, for video, what is actually said and shown on screen.";
  return (
    <div>
      {title && <h3 className="text-[15px] font-semibold">{title}</h3>}
      {/* A long explanation folds away; a short one stays in view. */}
      {about.length > 120 ? (
        <details className="mb-3 text-xs text-muted-foreground">
          <summary className="w-fit">About this list</summary>
          <p className="mt-1">{about}</p>
        </details>
      ) : (
        <p className="mb-3 text-xs text-muted-foreground">{about}</p>
      )}
      <div className="divide-y rounded-xl border">
        {rows.map(r => {
          const isOpen = open === r.adId;
          const numbersWhenSaved = r.isSaved ? savedNumbers(r) : null;
          return (
            <div key={r.adId}>
              <div className="flex items-start gap-3 px-3 py-3 hover:bg-muted/40 sm:items-center">
                <CreativePreview
                  name={r.adName}
                  metaAdId={r.adId}
                  accountId={r.accountId ?? undefined}
                  campaignName={r.campaignName ?? undefined}
                  thumbUrl={r.thumbUrl ?? undefined}
                  {...stillPropsFor(r, stills)}
                />
                {/* The numbers drop under the words on a phone rather than
                    squeezing the client and the hook to nothing. */}
                <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
                  {/* The cost per lead leads the row from the small tablet
                      size up; on a phone it opens the numbers line below,
                      so the client and the hook get the width. */}
                  <span className="hidden w-14 shrink-0 text-sm font-semibold tabular-nums sm:block">
                    {typeof r.cpl === "number" ? `$${r.cpl.toFixed(2)}` : "n/a"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="min-w-0 truncate text-sm font-medium">
                        {r.client}
                      </span>
                      {r.isSaved && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium"
                          title={
                            r.savedAt
                              ? `Saved to What works by ${saverName(r)} on ${fmtDate(r.savedAt)}`
                              : undefined
                          }
                        >
                          <Star className="size-3 fill-current text-primary" />
                          Saved by {saverName(r)}
                        </span>
                      )}
                      {r.isSaved && r.isAuto && (
                        <span
                          className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
                          title="The weekly check also picked this ad"
                        >
                          Weekly check
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {r.hook || r.headline || r.adName}
                    </span>
                    {r.isSaved && r.savedNote && (
                      <span
                        className="block whitespace-pre-wrap text-xs"
                        dir="auto"
                      >
                        <span className="font-semibold">Why it works: </span>
                        {r.savedNote}
                      </span>
                    )}
                    {numbersWhenSaved && (
                      <span className="block text-xs text-muted-foreground">
                        {numbersWhenSaved}
                      </span>
                    )}
                  </span>
                  <span className="basis-full text-xs text-muted-foreground sm:basis-auto sm:text-right">
                    <span className="font-semibold tabular-nums text-foreground sm:hidden">
                      {typeof r.cpl === "number"
                        ? `$${r.cpl.toFixed(2)} a lead`
                        : "n/a"}
                      {" · "}
                    </span>
                    {r.leads} leads · ${r.spend} · {r.city ?? "Unknown"}
                    <span className="block">
                      {r.wonFrom
                        ? `won ${fmtDay(r.wonFrom)}${r.wonTo && r.wonTo !== r.wonFrom ? ` to ${fmtDay(r.wonTo)}` : ""}`
                        : ""}
                      {r.stillLive === false ? (
                        <span
                          className="ml-1.5 font-mono text-[11px] uppercase tracking-[0.08em]"
                          title={
                            r.retiredOn
                              ? `Off since ${r.retiredOn}`
                              : "Not running"
                          }
                        >
                          Retired
                        </span>
                      ) : r.stillLive ? (
                        <span className="txt-good ml-1.5 font-mono text-[11px] uppercase tracking-[0.08em]">
                          Live
                        </span>
                      ) : null}
                    </span>
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : r.adId)}
                >
                  {isOpen ? "Hide" : "Read it"}
                </Button>
              </div>
              {isOpen && (
                <div className="space-y-3 border-t bg-muted/30 px-3 py-3 text-sm">
                  <div className="flex flex-wrap gap-1.5 text-xs">
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
                          className="rounded-full border px-2 py-0.5 text-muted-foreground"
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
                  <div className="flex flex-wrap items-center gap-2">
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
                    <SaveToIdeation adId={String(r.adId)} />
                  </div>
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
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/** One click puts this ad, script and all, on the Ideation board (Aziz, 2026-09-18). */
export function SaveToIdeation({ adId }: { adId: string }) {
  const save = useAction(api.ideation.saveFromWinner);
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={state !== "idle"}
      onClick={() => {
        setState("busy");
        void save({ adId })
          .then(() => {
            setState("done");
            toast.success("On the Ideation board, under Saved ideas.");
            setTimeout(() => setState("idle"), 2500);
          })
          .catch(e => {
            setState("idle");
            toast.error(String((e as Error)?.message ?? e).split("\n")[0]);
          });
      }}
      title="Save this ad to the Ideation board"
    >
      <Lightbulb />
      {state === "busy"
        ? "Saving…"
        : state === "done"
          ? "Saved"
          : "Save to Ideation"}
    </Button>
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
    <Button
      size="sm"
      variant="outline"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        });
      }}
    >
      {done ? "Copied" : label}
    </Button>
  );
}
