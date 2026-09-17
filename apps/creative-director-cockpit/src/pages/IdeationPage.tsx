import { useMutation, useQuery } from "convex/react";
import {
  ExternalLink,
  ImageOff,
  Lightbulb,
  LoaderCircle,
  Search,
  Star,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CopyButton } from "@/components/WinningAds";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

/**
 * Ideation.
 *
 * His own library, next to the winning ads. Two ways in: paste a link to any
 * Instagram, TikTok or Snapchat post and the radar fetches it, watches it
 * (speech and on-screen text) and writes the breakdown; or the radar's scan
 * proposes posts that ran far above their account's normal, from our
 * industry and from others, and he keeps or dismisses them. Nothing here is
 * client-private, so the list is not cut by client access, like What works.
 *
 * The radar is a scheduled script on the VPS (hermes/ideation-radar). This
 * page never pretends a fetch already happened: a pasted link shows as
 * "Fetching" until the transcript is in, or "Failed" with the reason.
 */

type Tab = "saved" | "proposed" | "working" | "failed" | "dismissed";
const TABS: { key: Tab; label: string }[] = [
  { key: "saved", label: "Saved ideas" },
  { key: "proposed", label: "Proposed by the scan" },
  { key: "working", label: "Fetching" },
  { key: "failed", label: "Failed" },
  { key: "dismissed", label: "Dismissed" },
];

type Platform = "" | "instagram" | "tiktok" | "snapchat";
type Industry = "" | "ours" | "other";

// biome-ignore lint/suspicious/noExplicitAny: query rows are untyped
type Row = any;

function Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "good" | "warn" | "bad" | "neutral";
}) {
  return (
    <span
      className={`tone-${tone} rounded-full px-2 py-0.5 text-[11px] font-medium`}
    >
      {children}
    </span>
  );
}

function n(x: unknown): string {
  return typeof x === "number" && Number.isFinite(x)
    ? x.toLocaleString("en-US")
    : "?";
}

function fmtDay(s: string | null | undefined): string {
  if (!s) return "";
  const t = Date.parse(s);
  return Number.isNaN(t)
    ? s
    : new Date(t).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
      });
}

function fmtWhen(ms: number | null | undefined): string {
  return ms
    ? new Date(ms).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "";
}

function platformLabel(p: string): string {
  return p === "instagram"
    ? "Instagram"
    : p === "tiktok"
      ? "TikTok"
      : p === "snapchat"
        ? "Snapchat"
        : p;
}

function tierLabel(
  r: Row,
): { text: string; tone: "good" | "warn" | "neutral" } | null {
  if (typeof r.multiplier !== "number") return null;
  const x = `${r.multiplier.toFixed(1)}x the account's normal`;
  if (r.tier === "reverse_engineer") return { text: x, tone: "good" };
  if (r.tier === "study") return { text: x, tone: "warn" };
  return { text: x, tone: "neutral" };
}

function statusPill(r: Row) {
  switch (r.status) {
    case "queued":
      return <Pill tone="warn">Queued</Pill>;
    case "fetching":
      return (
        <Pill tone="warn">
          <LoaderCircle className="mr-1 inline h-3 w-3 animate-spin" />
          Fetching
        </Pill>
      );
    case "failed":
      return <Pill tone="bad">Failed</Pill>;
    case "dismissed":
      return <Pill>Dismissed</Pill>;
    case "saved":
      return (
        <Pill tone="good">
          <Star className="mr-1 inline h-3 w-3" />
          Saved
        </Pill>
      );
    default:
      return <Pill>Proposed</Pill>;
  }
}

/** The post's picture, or a grey box that says why there is none. */
function Thumb({ r }: { r: Row }) {
  const [failed, setFailed] = useState(false);
  const src = !failed && r.thumbUrl ? String(r.thumbUrl) : "";
  if (!src) {
    return (
      <div
        className="flex h-14 w-10 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground"
        title={
          r.thumbUrl
            ? "The platform's picture link has expired."
            : "No picture for this post."
        }
      >
        <ImageOff className="h-4 w-4" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="h-14 w-10 shrink-0 rounded object-cover"
    />
  );
}

// ---------------------------------------------------------------------------

export function IdeationPage() {
  const [tab, setTab] = useState<Tab>("saved");
  const [platform, setPlatform] = useState<Platform>("");
  const [industry, setIndustry] = useState<Industry>("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"newest" | "multiplier">("newest");
  const latest = useQuery(api.ideation.list, {
    tab,
    platform: platform || undefined,
    industry: industry || undefined,
    limit: 150,
  });
  const kept = useRef(latest);
  if (latest !== undefined) kept.current = latest;
  const data = latest ?? kept.current;
  const counts = useQuery(api.ideation.counts, {});

  const rows = useMemo(() => {
    if (!data) return undefined;
    const needle = q.trim().toLowerCase();
    let out: Row[] = data.rows;
    if (needle)
      out = out.filter((r: Row) =>
        [
          r.authorHandle,
          r.authorName,
          r.caption,
          r.hook?.text,
          r.whyItWorks,
          r.transferable,
          r.note,
          ...(r.tags ?? []),
          ...(r.adaptations ?? []),
        ]
          .filter(Boolean)
          .some((x: string) => String(x).toLowerCase().includes(needle)),
      );
    if (sort === "multiplier")
      out = [...out].sort((a, b) => (b.multiplier ?? 0) - (a.multiplier ?? 0));
    return out;
  }, [data, q, sort]);

  const countOf = (t: Tab) => {
    if (!counts) return "";
    const c = (counts as Record<string, number>)[t];
    return typeof c === "number"
      ? c >= counts.cap
        ? `${counts.cap}+`
        : String(c)
      : "";
  };

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Lightbulb className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-[15px] font-bold tracking-tight">Ideation</h2>
        <span className="text-[13px] text-muted-foreground">
          {counts
            ? `${countOf("saved")} saved, ${countOf("proposed")} proposed by the scan`
            : "Loading…"}
        </span>
      </div>
      <p className="mb-3 text-[13px] text-muted-foreground">
        Posts that ran far above their account's normal, from our industry and
        from others, with what they say, what is on screen and why they work.
        Paste a link to add your own; the scan proposes the rest. The winning
        ads we ran ourselves stay on What works.
      </p>

      <PasteBox />

      <div className="mb-3 flex flex-wrap gap-1 border-b">
        {TABS.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-2.5 py-1.5 text-[13px] font-semibold transition ${
              tab === t.key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
            {countOf(t.key) ? (
              <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                {countOf(t.key)}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ["", "All platforms"],
              ["instagram", "Instagram"],
              ["tiktok", "TikTok"],
              ["snapchat", "Snapchat"],
            ] as [Platform, string][]
          ).map(([k, label]) => (
            <button
              key={k || "all"}
              type="button"
              onClick={() => setPlatform(k)}
              aria-pressed={platform === k}
              className={`rounded-full border px-2.5 py-0.5 text-[12px] font-semibold ${
                platform === k
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          value={industry}
          onChange={e => setIndustry(e.target.value as Industry)}
          aria-label="Industry"
          className="h-7 rounded-md border bg-background px-2 text-[12px]"
        >
          <option value="">Every industry</option>
          <option value="ours">Our industry</option>
          <option value="other">Other industries</option>
        </select>
        <select
          value={sort}
          onChange={e => setSort(e.target.value as "newest" | "multiplier")}
          aria-label="Sort"
          className="h-7 rounded-md border bg-background px-2 text-[12px]"
        >
          <option value="newest">Newest first</option>
          <option value="multiplier">Biggest outliers first</option>
        </select>
        <div className="ml-auto flex items-center gap-1.5 rounded-md border px-2 py-1">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search hooks, captions, notes"
            className="w-52 bg-transparent text-[13px] outline-none"
          />
        </div>
      </div>

      {rows === undefined ? (
        <p className="text-[13px] text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{emptyText(tab, q)}</p>
      ) : (
        <div className="divide-y rounded-lg border">
          {rows.map((r: Row) => (
            <IdeaRow key={r._id} r={r} />
          ))}
        </div>
      )}
      {data?.capped ? (
        <p className="mt-2 text-[12px] text-muted-foreground">
          Showing the newest 150. Narrow the filter or search to find older
          ones.
        </p>
      ) : null}
    </div>
  );
}

function emptyText(tab: Tab, q: string): string {
  if (q.trim()) return "No idea here matches that search.";
  switch (tab) {
    case "saved":
      return "Nothing saved yet. Paste an Instagram, TikTok or Snapchat link above, or keep one of the scan's proposals.";
    case "proposed":
      return "The scan has not proposed anything yet. It proposes posts doing three times an account's usual views or more.";
    case "working":
      return "Nothing is being fetched right now.";
    case "failed":
      return "Nothing has failed.";
    default:
      return "Nothing dismissed.";
  }
}

// ---------------------------------------------------------------------------

function PasteBox() {
  const paste = useMutation(api.ideation.paste);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [industry, setIndustry] = useState<"ours" | "other">("other");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "warn" | "bad";
    text: string;
  } | null>(null);

  const submit = async () => {
    const u = url.trim();
    if (!u) return;
    setBusy(true);
    setFeedback(null);
    try {
      await paste({ url: u, note: note.trim() || undefined, industry });
      setUrl("");
      setNote("");
      setFeedback({
        tone: "warn",
        text: "Queued. The radar fetches it and reads it within a few minutes; it shows under Fetching until the transcript is in.",
      });
    } catch (e) {
      setFeedback({ tone: "bad", text: `Not queued: ${serverMessage(e)}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mb-4 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <Lightbulb className="h-4 w-4" />
        <h3 className="text-[14px] font-bold">Add a post</h3>
        <span className="text-[12px] text-muted-foreground">
          paste the link from Instagram, TikTok or Snapchat
        </span>
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-[minmax(0,1fr)_150px_auto]">
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") void submit();
          }}
          placeholder="https://www.instagram.com/reel/…"
          dir="ltr"
          className="rounded border bg-transparent px-2 py-1 text-[13px]"
        />
        <select
          value={industry}
          onChange={e => setIndustry(e.target.value as "ours" | "other")}
          className="rounded border bg-transparent px-2 py-1 text-[13px]"
        >
          <option value="ours">Our industry</option>
          <option value="other">Another industry</option>
        </select>
        <Button
          size="sm"
          onClick={() => void submit()}
          disabled={busy || !url.trim()}
        >
          {busy ? "Queuing…" : "Fetch and save"}
        </Button>
      </div>
      <Textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        dir="auto"
        maxLength={500}
        placeholder="Why it caught your eye (optional). It stays on the idea."
        className="mt-2 min-h-[44px] text-[13px]"
      />
      {feedback ? (
        <div
          className={`callout-${feedback.tone} mt-2 rounded-md border p-2 text-[13px]`}
        >
          {feedback.text}
        </div>
      ) : null}
    </section>
  );
}

function serverMessage(e: unknown): string {
  // biome-ignore lint/suspicious/noExplicitAny: ConvexError data is untyped
  const data = (e as any)?.data;
  if (typeof data === "string") return data;
  const msg = String((e as Error)?.message ?? e);
  return msg.replace(/^.*Uncaught Error: /, "").split("\n")[0];
}

// ---------------------------------------------------------------------------

function IdeaRow({ r }: { r: Row }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const dismiss = useMutation(api.ideation.dismiss);
  const restore = useMutation(api.ideation.restore);
  const retry = useMutation(api.ideation.retry);
  const tier = tierLabel(r);
  const title = r.hook?.text || r.caption || r.url;
  const who =
    r.savedByName ??
    r.pastedByName ??
    (r.savedBy ? String(r.savedBy).split("@")[0] : "");

  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast.success(done);
    } catch (e) {
      toast.error(serverMessage(e));
    }
  };

  return (
    <div>
      <div className="flex items-start gap-3 px-3 py-2 hover:bg-muted/50">
        <Thumb r={r} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
            <span className="font-semibold">@{r.authorHandle || "?"}</span>
            <Pill>{platformLabel(r.platform)}</Pill>
            {r.industry === "ours" ? (
              <Pill tone="neutral">Our industry</Pill>
            ) : (
              <Pill>Other industry</Pill>
            )}
            {tier ? <Pill tone={tier.tone}>{tier.text}</Pill> : null}
            {r.packagingOnly ? (
              <span
                className="text-[11px] text-muted-foreground"
                title="Under 2,000 followers: this proves packaging, not audience."
              >
                tiny account
              </span>
            ) : null}
            {statusPill(r)}
            {who ? (
              <span className="rounded border px-1 text-[10px] font-semibold text-muted-foreground">
                {r.origin === "manual" ? "Pasted by" : "Kept by"} {who}
              </span>
            ) : null}
          </div>
          <div className="truncate text-[13px]" dir="auto" title={title}>
            {title}
          </div>
          {r.status === "failed" && r.error ? (
            <div className="text-[12px] txt-bad">{r.error}</div>
          ) : null}
          {(r.savedNote || r.note) && (
            <div
              className="whitespace-pre-wrap text-[12px] text-muted-foreground"
              dir="auto"
            >
              Why it works: {r.savedNote ?? r.note}
            </div>
          )}
        </div>
        <div className="shrink-0 text-right text-[12px] text-muted-foreground">
          <div className="tabular-nums">
            {n(r.views)} views · {n(r.likes)} likes
          </div>
          <div>
            {r.postedAt ? `posted ${fmtDay(r.postedAt)}` : ""}
            {r.authorFollowers ? ` · ${n(r.authorFollowers)} followers` : ""}
          </div>
          <div className="mt-1 flex flex-wrap justify-end gap-1">
            {r.status === "proposed" ? (
              <button
                type="button"
                onClick={() => setSaving(true)}
                className="rounded border px-2 py-0.5 text-[12px] font-semibold text-muted-foreground hover:bg-muted"
              >
                Keep it
              </button>
            ) : null}
            {r.status === "failed" ? (
              <button
                type="button"
                onClick={() =>
                  void act(() => retry({ id: r._id }), "Queued again.")
                }
                className="rounded border px-2 py-0.5 text-[12px] font-semibold text-muted-foreground hover:bg-muted"
              >
                Try again
              </button>
            ) : null}
            {r.status === "dismissed" ? (
              <button
                type="button"
                onClick={() =>
                  void act(() => restore({ id: r._id }), "Back in the list.")
                }
                className="rounded border px-2 py-0.5 text-[12px] font-semibold text-muted-foreground hover:bg-muted"
              >
                Restore
              </button>
            ) : (
              <button
                type="button"
                onClick={() =>
                  void act(() => dismiss({ id: r._id }), "Dismissed.")
                }
                className="rounded border px-2 py-0.5 text-[12px] font-semibold text-muted-foreground hover:bg-muted"
              >
                Dismiss
              </button>
            )}
            <a
              href={r.url}
              target="_blank"
              rel="noreferrer"
              className="rounded border px-2 py-0.5 text-[12px] font-semibold text-muted-foreground hover:bg-muted"
            >
              <ExternalLink className="mr-1 inline h-3 w-3" />
              Open
            </a>
            <button
              type="button"
              onClick={() => setOpen(o => !o)}
              className="rounded border px-2 py-0.5 text-[12px] font-semibold text-muted-foreground hover:bg-muted"
            >
              {open ? "Hide" : "Read it"}
            </button>
          </div>
        </div>
      </div>
      {open ? <IdeaDetail id={r._id} /> : null}
      {saving ? <KeepDialog r={r} onClose={() => setSaving(false)} /> : null}
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
      <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

function IdeaDetail({ id }: { id: Id<"ideationPosts"> }) {
  const r = useQuery(api.ideation.detail, { id });
  if (r === undefined)
    return (
      <p className="px-3 py-2 text-[13px] text-muted-foreground">Loading…</p>
    );
  if (!r) return null;
  const osd: { at_sec?: number; text?: string }[] = Array.isArray(
    r.onScreenText,
  )
    ? r.onScreenText
    : [];
  const beats: { beat?: string; summary?: string; from_sec?: number }[] =
    Array.isArray(r.beats) ? r.beats : [];
  const conf = r.confidence ?? {};
  const copy = [
    r.hook?.text ? `HOOK: ${r.hook.text}` : "",
    r.transcript ? `SCRIPT: ${r.transcript}` : "",
    osd.length ? `ON SCREEN: ${osd.map(o => o.text).join(" / ")}` : "",
    r.whyItWorks ? `WHY IT WORKS: ${r.whyItWorks}` : "",
    r.transferable ? `FOR OUR CLIENTS: ${r.transferable}` : "",
    (r.adaptations ?? []).length
      ? `IDEAS: ${(r.adaptations as string[]).map((a, i) => `${i + 1}. ${a}`).join(" ")}`
      : "",
    `LINK: ${r.url}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const notCaptured = r.status !== "saved" || !r.capturedAt;
  return (
    <div className="space-y-3 border-t bg-muted/30 px-3 py-3 text-[13px]">
      <div className="flex flex-wrap gap-1.5">
        {[
          r.format,
          r.voice,
          r.language,
          r.dialect,
          r.cta ? `CTA: ${r.cta}` : "",
          ...(r.tags ?? []),
        ]
          .filter(
            (x: unknown): x is string => typeof x === "string" && x.length > 0,
          )
          .map((t: string) => (
            <span key={t} className="rounded border px-1.5 py-0.5 text-[11px]">
              {t}
            </span>
          ))}
        {typeof r.durationSec === "number" ? (
          <span className="rounded border px-1.5 py-0.5 text-[11px]">
            {Math.round(r.durationSec)}s
          </span>
        ) : null}
      </div>
      {notCaptured ? (
        <p className="text-muted-foreground">
          {r.status === "proposed"
            ? "Keep it and the radar fetches the video, reads what is said and what is on screen, and writes the breakdown here."
            : r.status === "failed"
              ? `Not read: ${r.error ?? "unknown reason"}.`
              : "The radar is fetching this post. The transcript lands here when it is done."}
        </p>
      ) : null}
      {r.caption ? (
        <Field label="Caption">
          <div className="whitespace-pre-wrap" dir="auto">
            {r.caption}
          </div>
        </Field>
      ) : null}
      {r.hook?.text ? (
        <Field label={`Hook${r.hook.type ? ` (${r.hook.type})` : ""}`}>
          <div dir="auto">{r.hook.text}</div>
        </Field>
      ) : null}
      {r.transcript ? (
        <Field
          label={`What is said${conf.transcript ? ` (${conf.transcript} confidence)` : ""}`}
        >
          <div className="whitespace-pre-wrap" dir="auto">
            {r.transcript}
          </div>
        </Field>
      ) : r.capturedAt ? (
        <Field label="What is said">
          <div className="text-muted-foreground">
            Nobody speaks in this one.
          </div>
        </Field>
      ) : null}
      {osd.length ? (
        <Field
          label={`What is on screen${conf.on_screen_text ? ` (${conf.on_screen_text} confidence)` : ""}`}
        >
          <ul className="space-y-0.5">
            {osd.map((o, i) => (
              <li key={`${o.at_sec}-${i}`} dir="auto">
                <span className="tabular-nums text-muted-foreground">
                  {typeof o.at_sec === "number" ? `${o.at_sec}s ` : ""}
                </span>
                {o.text}
              </li>
            ))}
          </ul>
        </Field>
      ) : null}
      {beats.length ? (
        <Field label="Structure">
          <ol className="space-y-0.5">
            {beats.map((b, i) => (
              <li key={`${b.beat}-${i}`}>
                <span className="font-semibold">{b.beat}</span>
                {typeof b.from_sec === "number" ? (
                  <span className="tabular-nums text-muted-foreground">
                    {" "}
                    {b.from_sec}s
                  </span>
                ) : null}
                : {b.summary}
              </li>
            ))}
          </ol>
        </Field>
      ) : null}
      {r.whyItWorks ? (
        <Field label="Why it works">
          <div className="whitespace-pre-wrap">{r.whyItWorks}</div>
        </Field>
      ) : null}
      {r.transferable ? (
        <Field label="For our clients">
          <div className="whitespace-pre-wrap">{r.transferable}</div>
        </Field>
      ) : null}
      {(r.adaptations ?? []).length ? (
        <Field label="Ideas to adapt">
          <ol className="list-decimal space-y-0.5 pl-5">
            {(r.adaptations as string[]).map(a => (
              <li key={a}>{a}</li>
            ))}
          </ol>
        </Field>
      ) : null}
      <Field label="Numbers">
        <div className="tabular-nums">
          {n(r.views)} views · {n(r.likes)} likes · {n(r.comments)} comments ·{" "}
          {n(r.shares)} shares
          {typeof r.saves === "number" ? ` · ${n(r.saves)} saves` : ""}
          {typeof r.baselineViews === "number"
            ? ` · account's normal ${n(Math.round(r.baselineViews))} views over ${r.baselineN ?? "?"} posts`
            : ""}
          {r.scannedAt
            ? ` · counted ${fmtDay(r.scannedAt)}`
            : r.capturedAt
              ? ` · counted ${fmtDay(r.capturedAt)}`
              : ""}
        </div>
      </Field>
      {(r.warnings ?? []).length ? (
        <div className="callout-warn rounded p-2 text-[12px]">
          {(r.warnings as string[]).join(" ")}
        </div>
      ) : null}
      <NoteEditor id={r._id} note={r.savedNote ?? r.note ?? ""} />
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
        <CopyButton text={copy} label="Copy this idea" />
        {r.savedAt ? <span>Saved {fmtWhen(r.savedAt)}</span> : null}
        {r.method?.breakdown ? (
          <span>Read by {String(r.method.breakdown)}</span>
        ) : null}
      </div>
    </div>
  );
}

function NoteEditor({ id, note }: { id: Id<"ideationPosts">; note: string }) {
  const setNote = useMutation(api.ideation.setNote);
  const [value, setValue] = useState(note);
  const [saved, setSaved] = useState(false);
  return (
    <Field label="Your note">
      <div className="flex flex-col gap-1 md:flex-row md:items-start">
        <Textarea
          value={value}
          onChange={e => setValue(e.target.value)}
          dir="auto"
          maxLength={500}
          rows={2}
          placeholder="What to take from it, which client it fits, the hook to try."
          className="min-h-[44px] text-[13px]"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={value === note}
          onClick={() =>
            void setNote({ id, note: value })
              .then(() => {
                setSaved(true);
                setTimeout(() => setSaved(false), 1800);
              })
              .catch(e => toast.error(serverMessage(e)))
          }
        >
          {saved ? "Saved" : "Save note"}
        </Button>
      </div>
    </Field>
  );
}

/** Keep a proposal: the radar then fetches the video and writes the breakdown. */
function KeepDialog({ r, onClose }: { r: Row; onClose: () => void }) {
  const save = useMutation(api.ideation.save);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await save({ id: r._id, note: note.trim() || undefined });
      toast.success("Kept. The radar is fetching the transcript.");
      onClose();
    } catch (e) {
      toast.error(serverMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle dir="auto">Keep this post</DialogTitle>
          <DialogDescription className="text-xs">
            It moves to Saved ideas, and the radar fetches the video, reads what
            is said and what is on screen, and writes the breakdown. Takes a few
            minutes.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded border bg-muted/30 px-3 py-2 text-[13px]">
          <div className="font-semibold">
            @{r.authorHandle} on {platformLabel(r.platform)}
          </div>
          <div className="tabular-nums text-muted-foreground">
            {n(r.views)} views,{" "}
            {typeof r.multiplier === "number"
              ? `${r.multiplier.toFixed(1)}x the account's normal of ${n(Math.round(r.baselineViews ?? 0))}`
              : ""}
          </div>
          <div className="mt-1 truncate" dir="auto">
            {r.caption || r.url}
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="keep-note">Why it works (optional)</Label>
          <Textarea
            id="keep-note"
            value={note}
            onChange={e => setNote(e.target.value)}
            dir="auto"
            rows={3}
            maxLength={500}
            placeholder="The hook, the contrast, the way it opens. One or two lines."
          />
          <div className="text-right text-[11px] text-muted-foreground">
            {note.length}/500
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? "Saving…" : "Keep it"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
