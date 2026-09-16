import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import {
  ALWAYS,
  ageLine,
  recommendAdSets,
  SERVICE_LINES,
  type ServiceLine,
} from "@/lib/audiences";
import { api } from "../../convex/_generated/api";
import { CreativePreview } from "./CreativePreview";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";

type Variant = {
  headline: string;
  primaryText: string;
  description?: string;
  approved?: boolean;
};

function isArabic(s: string) {
  return /[\u0600-\u06FF]/.test(s);
}

/**
 * "Build me a campaign."
 *
 * She drops in the creative and one line about what she wants. Viktor copies the
 * settings off this client's own cheapest ad set and writes the copy. She reads
 * it, edits anything, then launches — always paused, so nothing spends before a
 * human has looked at it in Ads Manager.
 */
export function BuildPanel({
  clientTag,
  clientName,
  accountId,
  language,
  serviceType,
}: {
  clientTag: string;
  clientName: string;
  accountId?: string;
  language?: string;
  serviceType?: string;
}) {
  const builds = useQuery(api.cockpit.buildsFor, { clientTag });
  const winners = useQuery(api.cockpit.winners, { serviceType });
  const requestBuild = useMutation(api.cockpit.requestBuild);
  const saveVariants = useMutation(api.cockpit.saveVariants);
  const launchBuild = useMutation(api.cockpit.launchBuild);
  const discardBuild = useMutation(api.cockpit.discardBuild);

  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState("");
  const [links, setLinks] = useState("");
  const [budget, setBudget] = useState("40");
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<ServiceLine | "">("");
  const [otherService, setOtherService] = useState("");
  const [contextDocs, setContextDocs] = useState("");
  const [targeting, setTargeting] = useState("");

  // Whether Mahara can write to the account is decided on the server at launch
  // (builder.ts canWriteLive, against Meta's live list) and comes back as a
  // failed build with the reason. A hardcoded list here disabled Launch for
  // most clients the backend was happy to launch. The only thing this side
  // knows is whether an account id has been synced at all.
  const writable = Boolean(accountId);
  const latest = builds?.[0];

  return (
    <div className="mt-4 rounded-md border border-dashed border-border p-3">
      <div className="mb-1 text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
        Build me a campaign
      </div>
      <p className="mb-2 text-[12px] text-muted-foreground">
        Give me the creative and a line about what you want. I copy the
        targeting, pixel and lead form off this client's cheapest ad set, write
        the copy, and build it <span className="font-semibold">paused</span> —
        nothing spends until you turn it on.
      </p>

      {!writable && (
        <p className="mb-2 rounded callout-warn p-2 text-[12px]">
          This client has no Meta ad account id synced yet, so there is nothing
          to launch into. I can still build it and show you every word. Add the
          account to the client sheet and the Launch button lights up after the
          next sync.
        </p>
      )}

      {!open && (
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          Build a campaign
        </Button>
      )}

      {open && winners && (
        <WinnersStrip
          winners={winners}
          onUse={(w: Winner) =>
            setBrief(
              b =>
                `${b ? `${b}\n\n` : ""}Start from what worked: “${w.adName}” for ${w.clientName}, ${typeof w.cpl === "number" ? `$${w.cpl.toFixed(2)}` : "n/a"} a lead${w.costPerBooking ? `, $${Math.round(w.costPerBooking)} a booking` : ""}. Same angle, our client's own offer.`,
            )
          }
        />
      )}

      {open && (
        <div className="space-y-2">
          <Textarea
            value={brief}
            onChange={e => setBrief(e.target.value)}
            placeholder="What is this campaign for? e.g. new villa fit-out offer, same audience as the last one, push the free consultation."
            className="min-h-[64px] text-[13px]"
          />
          <Textarea
            value={links}
            onChange={e => setLinks(e.target.value)}
            placeholder="Creative — paste Drive links, one per line. Or leave blank and tell me which existing ad to reuse."
            className="min-h-[52px] text-[13px]"
          />
          <Textarea
            value={contextDocs}
            onChange={e => setContextDocs(e.target.value)}
            placeholder="Brand DNA / offer creation cheat sheet — paste it or drop the link. I'll write the offer from this instead of inventing one."
            className="min-h-[52px] text-[13px]"
          />
          <div>
            <div className="mb-1 text-[12px] text-muted-foreground">
              What does this client sell? I build the audiences from it.
            </div>
            <select
              value={line}
              onChange={e => setLine(e.target.value as ServiceLine)}
              className="h-8 w-full rounded-md border bg-background px-2 text-[13px]"
            >
              <option value="">Choose one…</option>
              {SERVICE_LINES.map(s => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
              <option value="other">Something else — I'll type it</option>
            </select>
            {line === ("other" as ServiceLine) && (
              <Input
                value={otherService}
                onChange={e => setOtherService(e.target.value)}
                placeholder="What do they sell? e.g. smart home automation"
                className="mt-1.5 h-8 text-[13px]"
              />
            )}
            <ProvenPlays clientName={clientName} onUse={t => setTargeting(t)} />
            {line && line !== ("other" as ServiceLine) && (
              <AudiencePlan
                line={line}
                budget={Number(budget) || 30}
                targeting={targeting}
                onTargeting={setTargeting}
              />
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-muted-foreground">
              Daily budget $
            </span>
            <Input
              value={budget}
              onChange={e => setBudget(e.target.value)}
              className="h-8 w-20 text-[13px]"
            />
            <Button
              size="sm"
              disabled={busy || !brief.trim()}
              onClick={async () => {
                setBusy(true);
                try {
                  await requestBuild({
                    clientTag,
                    clientName,
                    accountId: accountId ?? "",
                    kind: "campaign",
                    brief: [
                      brief.trim(),
                      targeting.trim()
                        ? `Targeting she asked for: ${targeting.trim()}`
                        : "",
                    ]
                      .filter(Boolean)
                      .join("\n"),
                    serviceOther:
                      line === ("other" as ServiceLine)
                        ? otherService || undefined
                        : undefined,
                    contextDocs: contextDocs || undefined,
                    creativeLinks: links
                      .split("\n")
                      .map(l => l.trim())
                      .filter(Boolean),
                    dailyBudget: Number(budget) || 30,
                    language: language ?? "en",
                  });
                  setBrief("");
                  setLinks("");
                  setTargeting("");
                  setOpen(false);
                  toast.success("Building it — copy and settings in a moment");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Build it
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {latest && (
        <div className="mt-3 rounded-lg border bg-background p-3">
          {latest.status === "building" && (
            <p className="text-[13px] text-muted-foreground">
              Working on it — reading this account's best ad set, then writing
              the copy.
            </p>
          )}
          {latest.status === "failed" && (
            <p className="text-[13px] text-red-700">
              That did not work: {latest.error}
            </p>
          )}
          {latest.status === "launched" && (
            <p className="text-[13px] text-emerald-800">
              Built and <span className="font-semibold">paused</span> on Meta.{" "}
              {latest.note} Logged on the ClickUp task.
            </p>
          )}
          {(latest.status === "ready" || latest.status === "launching") && (
            <ReadyBuild
              build={latest}
              writable={writable}
              onSave={async (variants: Variant[]) => {
                await saveVariants({ id: latest._id, variants });
              }}
              onLaunch={async () => {
                await launchBuild({ id: latest._id });
                toast.success("Going up on Meta — paused");
              }}
              onDiscard={async () => {
                await discardBuild({ id: latest._id });
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * My recommendation, not a template. She can ignore all of it and just type what
 * she wants — that box wins over anything I suggest.
 */
function AudiencePlan({
  line,
  budget,
  targeting,
  onTargeting,
}: {
  line: ServiceLine;
  budget: number;
  targeting: string;
  onTargeting: (v: string) => void;
}) {
  const rec = recommendAdSets(budget, line);
  return (
    <div className="mt-2 space-y-1.5 rounded-md bg-muted/40 p-2">
      <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        What I'd do here — change anything
      </div>
      <p className="text-[12px] text-muted-foreground">{rec.why}</p>
      {rec.sets.map((a, i) => (
        <div key={a.name} className="text-[12px]">
          <span className="font-semibold">
            {i + 1}. {a.name}
          </span>{" "}
          — {a.what}
          <div className="text-[11px] text-muted-foreground">{a.detail}</div>
        </div>
      ))}
      <div className="pt-1 text-[11px] text-muted-foreground">
        {ageLine(line)}
      </div>
      {ALWAYS.map(a => (
        <div key={a} className="text-[11px] text-muted-foreground">
          {a}
        </div>
      ))}
      <div className="pt-1">
        <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          Or just tell me the targeting you want
        </div>
        <Textarea
          value={targeting}
          onChange={e => onTargeting(e.target.value)}
          placeholder="e.g. one ad set, broad, Kuwait City 20km, 30–55, exclude last 180 days. Or: same targeting as the Liwan campaign but women only."
          className="min-h-[52px] text-[13px]"
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          Whatever you write here wins over what I suggested above.
        </p>
      </div>
    </div>
  );
}

type Winner = {
  _id: string;
  adName: string;
  clientName: string;
  metaAdId?: string;
  accountId?: string;
  /** Our saved copy of the ad's still: never expires. */
  stillUrl?: string;
  stillTinyUrl?: string;
  /** Meta's own still. The preview uses it only while its link is valid. */
  thumbnailUrl?: string;
  cpl?: number;
  costPerBooking?: number;
  spend: number;
  leads: number;
};

/**
 * The winners library: ads that are actually working, anywhere in the book.
 * Same service line first, because a fit-out hook does not transfer to real
 * estate. Pictures come from CreativePreview, which falls back to a
 * placeholder that says why when an ad has no picture.
 */
function WinnersStrip({
  winners,
  onUse,
}: {
  winners: { sameLine: Winner[]; rest: Winner[] };
  onUse: (w: Winner) => void;
}) {
  const groups = [
    { label: "Working for the same kind of client", rows: winners.sameLine },
    { label: "Working elsewhere in the book", rows: winners.rest },
  ].filter(g => g.rows.length > 0);
  if (groups.length === 0) return null;

  return (
    <div className="mb-3 space-y-2">
      {groups.map(g => (
        <div key={g.label}>
          <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            {g.label}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {g.rows.map(w => (
              <div
                key={w._id}
                className="w-[150px] shrink-0 rounded-md border bg-background p-2 hover:border-primary"
              >
                {/* The picture opens the ad; the text below starts from it. */}
                <div className="mb-1">
                  <CreativePreview
                    size="lg"
                    name={w.adName}
                    metaAdId={w.metaAdId}
                    accountId={w.accountId}
                    stillUrl={w.stillUrl}
                    stillTinyUrl={w.stillTinyUrl}
                    thumbUrl={w.thumbnailUrl}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => onUse(w)}
                  title="Start the brief from this ad"
                  className="block w-full text-left"
                >
                  <div className="truncate text-[12px] font-semibold">
                    {w.adName}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {w.clientName}
                  </div>
                  <div className="mt-0.5 text-[11px]">
                    <span
                      className={`font-semibold ${typeof w.cpl === "number" ? "txt-good" : "text-muted-foreground"}`}
                    >
                      {typeof w.cpl === "number"
                        ? `$${w.cpl.toFixed(2)}`
                        : "n/a"}
                    </span>{" "}
                    a lead
                    {w.costPerBooking
                      ? ` · $${Math.round(w.costPerBooking)} a booking`
                      : ""}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {w.leads} leads on ${Math.round(w.spend)}
                  </div>
                  <div className="mt-1 text-[11px] font-semibold text-primary">
                    Start from this
                  </div>
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
      <p className="text-[11px] text-muted-foreground">
        Click a picture to watch the ad. Click the text to start from it: it
        goes into the brief as a starting angle, and the copy still gets written
        for this client's own offer.
      </p>
    </div>
  );
}

function ReadyBuild({
  build,
  writable,
  onSave,
  onLaunch,
  onDiscard,
}: {
  // biome-ignore lint/suspicious/noExplicitAny: draft row
  build: any;
  writable: boolean;
  onSave: (v: Variant[]) => Promise<void>;
  onLaunch: () => Promise<void>;
  onDiscard: () => Promise<void>;
}) {
  const [variants, setVariants] = useState<Variant[]>(build.variants ?? []);
  const [dirty, setDirty] = useState(false);

  const edit = (i: number, patch: Partial<Variant>) => {
    setVariants(prev =>
      prev.map((v, idx) => (idx === i ? { ...v, ...patch } : v)),
    );
    setDirty(true);
  };

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-muted-foreground">{build.sourceReason}</p>
      <div className="space-y-2">
        {variants.map((v, i) => {
          const rtl = isArabic(v.primaryText || v.headline);
          return (
            <div
              key={`${build._id}-${i}`}
              className="rounded-md border bg-muted/30 p-2"
            >
              <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                Angle {i + 1}
              </div>
              <Input
                value={v.headline}
                dir={rtl ? "rtl" : "ltr"}
                className="mb-1 h-8 text-[13px] font-semibold"
                onChange={e => edit(i, { headline: e.target.value })}
              />
              <Textarea
                value={v.primaryText}
                dir={rtl ? "rtl" : "ltr"}
                className="min-h-[64px] text-[13px]"
                onChange={e => edit(i, { primaryText: e.target.value })}
              />
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {dirty && (
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              await onSave(variants);
              setDirty(false);
              toast.success("Saved your edits");
            }}
          >
            Save edits
          </Button>
        )}
        <Button
          size="sm"
          disabled={!writable || build.status === "launching"}
          onClick={async () => {
            if (dirty) await onSave(variants);
            await onLaunch();
          }}
        >
          {build.status === "launching"
            ? "Going up…"
            : writable
              ? `Launch it paused — $${build.dailyBudget}/day`
              : "Launch, once an ad account is synced"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDiscard}>
          Throw it away
        </Button>
      </div>
    </div>
  );
}

/**
 * What has worked for this client's service line in other cities.
 *
 * Shown while she builds, not on a separate page: the recommendation is only
 * useful at the moment the decision is being made. Nothing here is applied
 * automatically — she chooses.
 */
function ProvenPlays({
  clientName,
  onUse,
}: {
  clientName: string;
  onUse: (targeting: string) => void;
}) {
  const info = useQuery(api.market.forClient, { client: clientName });
  if (!info || info.suggestions.length === 0) return null;

  return (
    <div className="rounded-md border bg-muted/30 p-2">
      <div className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
        Worked elsewhere for {info.serviceLine?.toLowerCase()} — not tried here
      </div>
      <div className="mt-1.5 space-y-1.5">
        {info.suggestions.map(s => (
          <div
            key={`${s.city}${s.playType}${s.interests.join()}`}
            className="flex flex-wrap items-center justify-between gap-2 rounded border bg-background p-1.5"
          >
            <div className="min-w-0 text-[13px]">
              <span className="font-semibold capitalize">{s.playType}</span>
              {s.interests.length > 0 && (
                <span className="text-muted-foreground">
                  {" "}
                  — {s.interests.slice(0, 3).join(", ")}
                </span>
              )}
              <span className="block text-[12px] text-muted-foreground">
                {s.city} · <span className="txt-good">${s.cpl}</span> a lead
                {s.clients > 1 ? ` · ${s.clients} clients` : ""}
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[12px]"
              onClick={() =>
                onUse(
                  s.interests.length
                    ? `Use the ${s.city} play: ${s.interests.join(", ")}`
                    : `Use ${s.playType} targeting, like ${s.city}`,
                )
              }
            >
              Use this
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
