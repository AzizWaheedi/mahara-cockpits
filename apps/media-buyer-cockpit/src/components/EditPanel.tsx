import { useAction } from "convex/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  assistLabel,
  creativeWaitLabel,
  useAssist,
} from "@/components/useAssist";
import { api } from "../../convex/_generated/api";
import { isDriveLink } from "../../convex/driveCreative";

/**
 * "Change what's already running" — the other half of the builder.
 *
 * Three things she actually does during the day: add an ad set, test new copy on
 * an ad that works, move a budget. Everything created here lands PAUSED so she
 * reviews it in Ads Manager before it spends.
 */
// biome-ignore lint/suspicious/noExplicitAny: snapshot rows are untyped
type Row = any;

type Tab = "ads" | "creative" | "adset" | "budget" | null;

/**
 * A call that threw (session expired, connection dropped mid-flight) rather
 * than returned ok:false. Meta may or may not have applied it, so say so
 * instead of leaving the button stuck on its busy label.
 */
function describe(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return `Could not confirm that with Meta (${msg}). Check Ads Manager before retrying.`;
}

export function EditPanel({ campaign, tree }: { campaign: Row; tree: Row[] }) {
  const [tab, setTab] = useState<Tab>(null);
  const adSets = tree.filter(t => t.kind === "adset");
  const ads = tree.filter(t => t.kind === "ad");

  return (
    <div className="mt-3 rounded-lg border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
          Make changes
        </span>
        {(
          [
            ["ads", "Test new copy"],
            ["creative", "Add a creative"],
            ["adset", "Add an ad set"],
            ["budget", "Change a budget"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <Button
            key={label}
            size="sm"
            variant={tab === key ? "default" : "outline"}
            className="h-7 px-2 text-[12px]"
            onClick={() => setTab(tab === key ? null : key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {tab === "ads" && (
        <CopyTest campaign={campaign} ads={ads} adSets={adSets} />
      )}
      {tab === "creative" && (
        <AddCreative campaign={campaign} ads={ads} adSets={adSets} />
      )}
      {tab === "adset" && <NewAdSet campaign={campaign} adSets={adSets} />}
      {tab === "budget" && <BudgetEditor campaign={campaign} adSets={adSets} />}

      <AskViktor campaign={campaign} />
    </div>
  );
}

function CopyTest({
  campaign,
  ads,
  adSets,
}: {
  campaign: Row;
  ads: Row[];
  adSets: Row[];
}) {
  const create = useAction(api.edit.newAdsFromExisting);
  const copyAssist = useAssist("copy");
  const [source, setSource] = useState<string>(ads[0]?.metaId ?? "");
  const [adset, setAdset] = useState<string>("");
  const [brief, setBrief] = useState("");
  const [variants, setVariants] = useState<
    { message: string; headline: string; angle?: string }[]
  >([{ message: "", headline: "" }]);
  const [busy, setBusy] = useState(false);

  // Copy comes back out of band, so it lands here whenever Viktor is done —
  // she can keep working in the meantime and does not have to sit and watch.
  const drafted = copyAssist.row?.variants;
  useEffect(() => {
    if (drafted && drafted.length > 0) {
      setVariants(
        drafted.map(v => ({
          headline: v.headline,
          message: v.message,
          angle: v.angle,
        })),
      );
    }
  }, [drafted]);

  if (ads.length === 0)
    return (
      <p className="mt-3 text-[13px] text-muted-foreground">
        No ads synced for this campaign yet, so there's nothing to copy from.
      </p>
    );

  return (
    <div className="mt-3 space-y-2.5">
      <p className="text-[13px] text-muted-foreground">
        Keeps the video, the page and the lead form exactly as they are — only
        the text changes. New ads arrive <strong>paused</strong>.
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-[12px] font-semibold">
          Copy this ad
          <select
            className="mt-1 w-full rounded-md border bg-background p-1.5 text-[13px] font-normal"
            value={source}
            onChange={e => setSource(e.target.value)}
          >
            {ads.map(a => (
              <option key={a.metaId} value={a.metaId}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[12px] font-semibold">
          Put them in
          <select
            className="mt-1 w-full rounded-md border bg-background p-1.5 text-[13px] font-normal"
            value={adset}
            onChange={e => setAdset(e.target.value)}
          >
            <option value="">Same ad set as the original</option>
            {adSets.map(s => (
              <option key={s.metaId} value={s.metaId}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[220px] flex-1 text-[12px] font-semibold">
          Optional — tell me an angle and I'll draft a first pass
          <input
            className="mt-1 w-full rounded-md border bg-background p-1.5 text-[13px] font-normal"
            placeholder="e.g. lead with the free consultation"
            value={brief}
            onChange={e => setBrief(e.target.value)}
          />
        </label>
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-[12px]"
          disabled={copyAssist.waiting}
          onClick={async () => {
            await copyAssist.ask({
              campaignName: campaign.campaignName,
              client: campaign.clientName ?? campaign.accountName,
              brief,
              language: campaign.language,
            });
            toast.info("Asked. The options land here when they're ready.");
          }}
        >
          {copyAssist.waiting ? "Writing…" : "Write me options"}
        </Button>
      </div>

      {assistLabel(copyAssist.row, copyAssist.waiting) && (
        <p className="rounded-md bg-muted p-2 text-[12px] text-muted-foreground">
          {assistLabel(copyAssist.row, copyAssist.waiting)} You don't have to
          wait — type your own copy below and create the ads the same way.
        </p>
      )}
      {copyAssist.row?.status === "ready" && copyAssist.row.note && (
        <p className="rounded-md bg-muted p-2 text-[12px]">
          {copyAssist.row.note}
        </p>
      )}

      {variants.map((vr, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: editable fixed-order rows
        <div key={i} className="rounded-md border bg-background p-2">
          {vr.angle && (
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              {vr.angle}
            </div>
          )}
          <input
            className="w-full border-b bg-transparent pb-1 text-[13px] font-semibold outline-none"
            placeholder="Headline (under 40 characters)"
            value={vr.headline}
            onChange={e =>
              setVariants(
                variants.map((x, j) =>
                  j === i ? { ...x, headline: e.target.value } : x,
                ),
              )
            }
          />
          <textarea
            className="mt-1.5 w-full resize-y bg-transparent text-[13px] outline-none"
            rows={3}
            dir="auto"
            placeholder="Primary text"
            value={vr.message}
            onChange={e =>
              setVariants(
                variants.map((x, j) =>
                  j === i ? { ...x, message: e.target.value } : x,
                ),
              )
            }
          />
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-[12px]"
          onClick={() =>
            setVariants([...variants, { message: "", headline: "" }])
          }
        >
          + Another version
        </Button>
        <Button
          size="sm"
          className="h-7 text-[12px]"
          disabled={busy}
          onClick={async () => {
            const clean = variants.filter(x => x.message && x.headline);
            if (clean.length === 0) {
              toast.error("Each version needs a headline and primary text.");
              return;
            }
            setBusy(true);
            try {
              const r = await create({
                sourceAdId: source,
                variants: clean,
                adsetId: adset || undefined,
                campaignName: campaign.campaignName,
              });
              if (r.ok)
                toast.success(
                  `Created ${r.made?.length} paused ad${r.made?.length === 1 ? "" : "s"}. Review in Ads Manager, then switch them on.`,
                );
              else toast.error(r.error ?? "Meta refused that.");
            } catch (e) {
              toast.error(describe(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Creating…" : "Create the ads (paused)"}
        </Button>
      </div>
    </div>
  );
}

function NewAdSet({ campaign, adSets }: { campaign: Row; adSets: Row[] }) {
  const dup = useAction(api.edit.duplicateAdSet);
  const [from, setFrom] = useState(adSets[0]?.metaId ?? "");
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");
  const [busy, setBusy] = useState(false);

  if (adSets.length === 0)
    return (
      <p className="mt-3 text-[13px] text-muted-foreground">
        No ad sets synced for this campaign yet.
      </p>
    );

  return (
    <div className="mt-3 space-y-2.5">
      <p className="text-[13px] text-muted-foreground">
        Copies the targeting, optimisation and lead form from an ad set that
        already works. Arrives <strong>paused</strong> with no ads in it — add
        ads with "Test new copy".
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-[12px] font-semibold">
          Copy targeting from
          <select
            className="mt-1 w-full rounded-md border bg-background p-1.5 text-[13px] font-normal"
            value={from}
            onChange={e => setFrom(e.target.value)}
          >
            {adSets.map(s => (
              <option key={s.metaId} value={s.metaId}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[12px] font-semibold">
          Call it
          <input
            className="mt-1 w-full rounded-md border bg-background p-1.5 text-[13px] font-normal"
            placeholder="New ad set name"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </label>
        <label className="text-[12px] font-semibold">
          Daily budget ($)
          <input
            className="mt-1 w-full rounded-md border bg-background p-1.5 text-[13px] font-normal"
            placeholder="same as the original"
            inputMode="decimal"
            value={budget}
            onChange={e => setBudget(e.target.value)}
          />
        </label>
      </div>
      <Button
        size="sm"
        className="h-7 text-[12px]"
        disabled={busy}
        onClick={async () => {
          if (!name) {
            toast.error("Give the ad set a name.");
            return;
          }
          setBusy(true);
          try {
            const r = await dup({
              adsetId: from,
              newName: name,
              dailyBudget: budget ? Number(budget) : undefined,
              campaignName: campaign.campaignName,
            });
            if (r.ok) toast.success(`Created "${name}", paused. Logged.`);
            else toast.error(r.error ?? "Meta refused that.");
          } catch (e) {
            toast.error(describe(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Creating…" : "Create the ad set (paused)"}
      </Button>
    </div>
  );
}

function BudgetEditor({ campaign, adSets }: { campaign: Row; adSets: Row[] }) {
  const setBudgetAction = useAction(api.edit.setAdSetBudget);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  if (adSets.length === 0)
    return (
      <p className="mt-3 text-[13px] text-muted-foreground">
        No ad sets synced for this campaign yet.
      </p>
    );

  // CBO: one budget on the campaign, so one input, not one per ad set.
  // Meta refuses an ad set budget on these campaigns (2026-09-14).
  const isCbo = campaign.budgetLevel === "campaign";
  const rows = isCbo
    ? [
        {
          metaId: adSets[0].metaId,
          name: `Campaign budget (CBO), shared by ${adSets.length} ad set${adSets.length === 1 ? "" : "s"}`,
          dailyBudget: campaign.budgetDaily,
        },
      ]
    : adSets;

  return (
    <div className="mt-3 space-y-2">
      <p className="text-[12px] text-muted-foreground">
        {isCbo
          ? "This campaign uses a campaign budget (CBO). A change applies to the whole campaign and Meta splits it across the ad sets."
          : campaign.budgetLevel === "adset"
            ? "This campaign uses ad set budgets (ABO). Each ad set is changed on its own."
            : ""}
      </p>
      {rows.map(s => (
        <div
          key={s.metaId}
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background p-2"
        >
          <div className="min-w-0">
            <div className="text-[13px] font-semibold">{s.name}</div>
            <div className="text-[12px] text-muted-foreground">
              now{" "}
              {s.dailyBudget !== undefined
                ? `$${s.dailyBudget.toFixed(2)}/day`
                : "—"}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              className="w-24 rounded-md border bg-background p-1.5 text-[13px]"
              inputMode="decimal"
              placeholder="new $"
              value={edits[s.metaId] ?? ""}
              onChange={e => setEdits({ ...edits, [s.metaId]: e.target.value })}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[12px]"
              disabled={busy || !edits[s.metaId]}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await setBudgetAction({
                    adsetId: s.metaId,
                    dailyBudget: Number(edits[s.metaId]),
                    name: s.name,
                    campaignName: campaign.campaignName,
                  });
                  if (r.ok)
                    toast.success(
                      isCbo
                        ? "Campaign budget set. Logged."
                        : `${s.name} set. Logged.`,
                    );
                  else toast.error(r.error ?? "Meta refused that.");
                } catch (e) {
                  toast.error(describe(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Set
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Add a finished creative to a campaign that is already running.
 *
 * The template ad carries everything that is fiddly to rebuild — lead form,
 * page, CTA, targeting — so she only supplies the new file and, if she wants,
 * new copy.
 */
function AddCreative({
  campaign,
  ads,
  adSets,
}: {
  campaign: Row;
  ads: Row[];
  adSets: Row[];
}) {
  const add = useAction(api.edit.addCreativeToCampaign);
  const driveAssist = useAssist("creative");
  const [source, setSource] = useState<string>(ads[0]?.metaId ?? "");
  const [adset, setAdset] = useState<string>("");
  const [kind, setKind] = useState<"video" | "image">("video");
  const [drive, setDrive] = useState("");
  /** A file Viktor already pulled off Drive and loaded into the ad account. */
  const [picked, setPicked] = useState<{
    name: string;
    videoId?: string;
    imageHash?: string;
  } | null>(null);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [headline, setHeadline] = useState("");
  const [busy, setBusy] = useState(false);

  /** A Drive link belongs in the Drive box: move it there and start the fetch, no dead end. */
  async function fetchFromDrive(links: string[]) {
    await driveAssist.ask({
      campaignName: campaign.campaignName,
      client: campaign.clientName ?? campaign.accountName,
      driveLinks: links,
    });
  }

  async function submit() {
    if (!source) return toast.error("Pick an ad to copy the setup from.");
    if (!picked && !url.trim())
      return toast.error("Paste a Drive link, or a direct link to the file.");
    if (!picked && isDriveLink(url)) {
      const link = url.trim();
      setDrive(link);
      setUrl("");
      await fetchFromDrive([link]);
      toast.info(
        "That's a Drive link — fetching it into the ad account now. Press Use this when it appears above.",
      );
      return;
    }
    setBusy(true);
    try {
      const res = await add({
        sourceAdId: source,
        campaignName: campaign.campaignName,
        adsetId: adset || undefined,
        videoId: picked?.videoId,
        imageHash: picked?.imageHash,
        videoUrl: !picked && kind === "video" ? url.trim() : undefined,
        imageUrl: !picked && kind === "image" ? url.trim() : undefined,
        adName: name.trim() || undefined,
        message: message.trim() || undefined,
        headline: headline.trim() || undefined,
      });
      if (res.ok) {
        toast.success(
          "Added, paused. Review it in Ads Manager before it runs.",
        );
        setUrl("");
        setDrive("");
        setPicked(null);
        setName("");
        setMessage("");
        setHeadline("");
      } else if (res.assistId) {
        // The action queued a Drive fetch for her; follow it in the Drive box.
        driveAssist.watch(res.assistId);
        setDrive(url.trim());
        setUrl("");
        toast.info(res.error ?? "Fetching it from Drive.");
      } else {
        toast.error(res.error ?? "Meta refused it.");
      }
    } catch (e) {
      toast.error(describe(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-2 text-xs">
      <p className="text-muted-foreground">
        Everything except the file and the copy is copied from the ad you pick —
        lead form, page and CTA come across untouched. It lands paused.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-muted-foreground">Copy the setup from</span>
          <select
            className="w-full rounded border bg-background p-1.5"
            value={source}
            onChange={e => setSource(e.target.value)}
          >
            {ads.map(a => (
              <option key={a.metaId} value={a.metaId}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-muted-foreground">Put it in</span>
          <select
            className="w-full rounded border bg-background p-1.5"
            value={adset}
            onChange={e => setAdset(e.target.value)}
          >
            <option value="">Same ad set as that ad</option>
            {adSets.map(s => (
              <option key={s.metaId} value={s.metaId}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="rounded-md border bg-background p-2">
        <div className="mb-1 text-[12px] font-semibold">
          Paste the Drive link — I'll fetch the file and put it in the ad
          account
        </div>
        <div className="flex flex-wrap gap-1.5">
          <input
            className="min-w-[200px] flex-1 rounded border bg-background p-1.5"
            placeholder="https://drive.google.com/file/d/…"
            value={drive}
            onChange={e => setDrive(e.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-[12px]"
            disabled={driveAssist.waiting || !drive.trim()}
            onClick={async () => {
              await fetchFromDrive(
                drive
                  .split(/[\s,]+/)
                  .map(x => x.trim())
                  .filter(Boolean),
              );
              toast.info("Fetching it from Drive.");
            }}
          >
            {driveAssist.waiting ? "Fetching…" : "Get it from Drive"}
          </Button>
        </div>
        {creativeWaitLabel(
          driveAssist.row,
          driveAssist.waiting,
          driveAssist.now,
        ) && (
          <p
            className={`mt-1 text-[12px] ${driveAssist.row?.status === "failed" ? "txt-bad" : "text-muted-foreground"}`}
          >
            {creativeWaitLabel(
              driveAssist.row,
              driveAssist.waiting,
              driveAssist.now,
            )}
          </p>
        )}
        {(driveAssist.row?.media ?? []).map(m => (
          <div
            key={m.link}
            className="mt-1 flex items-center justify-between gap-2 border-t pt-1 text-[12px]"
          >
            <span className="min-w-0 flex-1 truncate">
              {m.name}
              {m.error && <span className="txt-bad"> — {m.error}</span>}
            </span>
            {!m.error && (
              <Button
                size="sm"
                variant={
                  picked?.name === m.name &&
                  (picked?.videoId ?? picked?.imageHash)
                    ? "default"
                    : "outline"
                }
                className="h-6 px-2 text-[11px]"
                onClick={() => {
                  setPicked({
                    name: m.name,
                    videoId: m.videoId,
                    imageHash: m.imageHash,
                  });
                  setKind(m.videoId ? "video" : "image");
                  if (!name) setName(m.name.replace(/\.[a-z0-9]+$/i, ""));
                }}
              >
                {picked?.name === m.name ? "Using this" : "Use this"}
              </Button>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-1.5">
        {(["video", "image"] as const).map(k => (
          <Button
            key={k}
            size="sm"
            variant={kind === k ? "default" : "outline"}
            className="h-7 px-2 text-[12px] capitalize"
            onClick={() => setKind(k)}
          >
            {k}
          </Button>
        ))}
      </div>
      {!picked && !driveAssist.waiting && (
        <input
          className="w-full rounded border bg-background p-1.5"
          placeholder="Or a direct link to the file (a Drive link pasted here is fetched for you)"
          value={url}
          onChange={e => setUrl(e.target.value)}
        />
      )}
      <input
        className="w-full rounded border bg-background p-1.5"
        placeholder="Ad name (optional)"
        value={name}
        onChange={e => setName(e.target.value)}
      />
      <textarea
        className="w-full rounded border bg-background p-1.5"
        rows={2}
        placeholder="New primary text (optional — leave blank to keep the original)"
        value={message}
        onChange={e => setMessage(e.target.value)}
      />
      <input
        className="w-full rounded border bg-background p-1.5"
        placeholder="New headline (optional)"
        value={headline}
        onChange={e => setHeadline(e.target.value)}
      />
      <Button
        size="sm"
        className="h-7 text-[12px]"
        disabled={busy}
        onClick={submit}
      >
        {busy ? "Uploading to Meta…" : "Add it, paused"}
      </Button>
    </div>
  );
}

/** One line where she can ask for anything that isn't a button. */
function AskViktor({ campaign }: { campaign: Row }) {
  const ask = useAction(api.edit.askViktorFor);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    if (text.trim().length < 5) return;
    setBusy(true);
    try {
      const res = await ask({
        campaignName: campaign.campaignName,
        client: campaign.clientName,
        request: text.trim(),
      });
      if (res.ok) {
        toast.success("Sent to Aziz on Slack.");
        setText("");
      } else {
        toast.error(res.error ?? "Couldn't send that.");
      }
    } catch (e) {
      toast.error(describe(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 border-t pt-2">
      <div className="flex items-center gap-1.5">
        <input
          className="flex-1 rounded border bg-background p-1.5 text-xs"
          placeholder="Or just say what you want for this campaign…"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") void send();
          }}
        />
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 text-[12px]"
          disabled={busy}
          onClick={send}
        >
          {busy ? "Sending…" : "Send"}
        </Button>
      </div>
    </div>
  );
}
