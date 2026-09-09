import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import {
  ALWAYS,
  SERVICE_LINES,
  type ServiceLine,
  recommendAdSets,
  ageLine,
} from "@/lib/audiences";

/** Ad accounts our Meta connection can write to. The rest need partner access. */
const WRITABLE = new Set([
  "750052678056652",
  "985366551096162",
  "1988430024784828",
  "1298343058123107",
  "971153818910775",
  "2378944772609634",
  "37532169989703452",
  "1326793265986543",
  "1923309945035375",
  "1009665871644699",
  "1790433979003370",
  "1910040802988539",
]);

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

  const writable = accountId ? WRITABLE.has(accountId) : false;
  const latest = builds?.[0];

  return (
    <div className="mt-4 rounded-md border border-dashed border-border p-3">
      <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        Build me a campaign
      </div>
      <p className="mb-2 text-[11px] text-muted-foreground">
        Give me the creative and a line about what you want. I copy the
        targeting, pixel and lead form off this client's cheapest ad set, write
        the copy, and build it <span className="font-semibold">paused</span> —
        nothing spends until you turn it on.
      </p>

      {!writable && (
        <p className="mb-2 rounded callout-warn p-2 text-[11px]">
          I can build it and show you every word, but I cannot create anything in
          this ad account until Mahara is added as a partner on it. The Launch
          button stays off until then.
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
                `${b ? `${b}\n\n` : ""}Start from what worked: “${w.adName}” for ${w.clientName} — $${(w.cpl ?? 0).toFixed(2)} a lead${w.costPerBooking ? `, $${Math.round(w.costPerBooking)} a booking` : ""}. Same angle, our client's own offer.`,
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
            className="min-h-[64px] text-[12px]"
          />
          <Textarea
            value={links}
            onChange={e => setLinks(e.target.value)}
            placeholder="Creative — paste Drive links, one per line. Or leave blank and tell me which existing ad to reuse."
            className="min-h-[52px] text-[12px]"
          />
          <Textarea
            value={contextDocs}
            onChange={e => setContextDocs(e.target.value)}
            placeholder="Brand DNA / offer creation cheat sheet — paste it or drop the link. I'll write the offer from this instead of inventing one."
            className="min-h-[52px] text-[12px]"
          />
          <div>
            <div className="mb-1 text-[11px] text-muted-foreground">
              What does this client sell? I build the audiences from it.
            </div>
            <select
              value={line}
              onChange={e => setLine(e.target.value as ServiceLine)}
              className="h-8 w-full rounded-md border bg-background px-2 text-[12px]"
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
                className="mt-1.5 h-8 text-[12px]"
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
            <span className="text-[11px] text-muted-foreground">
              Daily budget $
            </span>
            <Input
              value={budget}
              onChange={e => setBudget(e.target.value)}
              className="h-8 w-20 text-[12px]"
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
            <p className="text-[12px] text-muted-foreground">
              Working on it — reading this account's best ad set, then writing
              the copy.
            </p>
          )}
          {latest.status === "failed" && (
            <p className="text-[12px] text-red-700">
              That did not work: {latest.error}
            </p>
          )}
          {latest.status === "launched" && (
            <p className="text-[12px] text-emerald-800">
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
      <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
        What I'd do here — change anything
      </div>
      <p className="text-[11px] text-muted-foreground">{rec.why}</p>
      {rec.sets.map((a, i) => (
        <div key={a.name} className="text-[11.5px]">
          <span className="font-semibold">
            {i + 1}. {a.name}
          </span>{" "}
          — {a.what}
          <div className="text-[10.5px] text-muted-foreground">{a.detail}</div>
        </div>
      ))}
      <div className="pt-1 text-[10.5px] text-muted-foreground">
        {ageLine(line)}
      </div>
      {ALWAYS.map(a => (
        <div key={a} className="text-[10.5px] text-muted-foreground">
          {a}
        </div>
      ))}
      <div className="pt-1">
        <div className="mb-1 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
          Or just tell me the targeting you want
        </div>
        <Textarea
          value={targeting}
          onChange={e => onTargeting(e.target.value)}
          placeholder="e.g. one ad set, broad, Kuwait City 20km, 30–55, exclude last 180 days. Or: same targeting as the Liwan campaign but women only."
          className="min-h-[52px] text-[12px]"
        />
        <p className="mt-1 text-[10.5px] text-muted-foreground">
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
  thumbnailUrl?: string;
  cpl?: number;
  costPerBooking?: number;
  spend: number;
  leads: number;
};

/**
 * The winners library: ads that are actually working, anywhere in the book.
 * Same service line first — a fit-out hook does not transfer to real estate.
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
          <div className="mb-1 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
            {g.label}
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {g.rows.map(w => (
              <button
                type="button"
                key={w._id}
                onClick={() => onUse(w)}
                className="w-[150px] shrink-0 rounded-md border bg-background p-2 text-left hover:border-primary"
              >
                {w.thumbnailUrl && (
                  <img
                    src={w.thumbnailUrl}
                    alt=""
                    className="mb-1 h-[70px] w-full rounded object-cover"
                  />
                )}
                <div className="truncate text-[11px] font-semibold">
                  {w.adName}
                </div>
                <div className="truncate text-[10.5px] text-muted-foreground">
                  {w.clientName}
                </div>
                <div className="mt-0.5 text-[10.5px]">
                  <span className="font-semibold txt-good">
                    ${(w.cpl ?? 0).toFixed(2)}
                  </span>{" "}
                  a lead
                  {w.costPerBooking
                    ? ` · $${Math.round(w.costPerBooking)} a booking`
                    : ""}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {w.leads} leads on ${Math.round(w.spend)}
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="text-[10.5px] text-muted-foreground">
        Click one to start from it. It goes into the brief as a starting angle —
        the copy still gets written for this client's own offer.
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
      <p className="text-[11.5px] text-muted-foreground">
        {build.sourceReason}
      </p>
      <div className="space-y-2">
        {variants.map((v, i) => {
          const rtl = isArabic(v.primaryText || v.headline);
          return (
            <div
              key={`${build._id}-${i}`}
              className="rounded-md border bg-muted/30 p-2"
            >
              <div className="mb-1 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
                Angle {i + 1}
              </div>
              <Input
                value={v.headline}
                dir={rtl ? "rtl" : "ltr"}
                className="mb-1 h-8 text-[12px] font-semibold"
                onChange={e => edit(i, { headline: e.target.value })}
              />
              <Textarea
                value={v.primaryText}
                dir={rtl ? "rtl" : "ltr"}
                className="min-h-[64px] text-[12px]"
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
              : "Launch — needs partner access"}
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
      <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        Worked elsewhere for {info.serviceLine?.toLowerCase()} — not tried here
      </div>
      <div className="mt-1.5 space-y-1.5">
        {info.suggestions.map(s => (
          <div
            key={`${s.city}${s.playType}${s.interests.join()}`}
            className="flex flex-wrap items-center justify-between gap-2 rounded border bg-background p-1.5"
          >
            <div className="min-w-0 text-[12px]">
              <span className="font-semibold capitalize">{s.playType}</span>
              {s.interests.length > 0 && (
                <span className="text-muted-foreground">
                  {" "}
                  — {s.interests.slice(0, 3).join(", ")}
                </span>
              )}
              <span className="block text-[11px] text-muted-foreground">
                {s.city} · <span className="txt-good">${s.cpl}</span> a lead
                {s.clients > 1 ? ` · ${s.clients} clients` : ""}
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px]"
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
