import { useAction } from "convex/react";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Megaphone,
} from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/ceo/EmptyState";
import { count, money, pct } from "@/components/ceo/format";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatTile } from "@/components/ceo/StatTile";
import { StatusChip, type StatusTone } from "@/components/ceo/StatusChip";
import { api } from "../../../convex/_generated/api";
import type {
  B2bAdNode,
  B2bAdsPayload,
  B2bAdWindow,
  B2bVerdict,
} from "../../../convex/ceo/payloads";
import type { CeoTabProps } from "./types";

/**
 * Mahara's own ad account, campaign by ad set by ad, with the whole funnel
 * under every row and a switch on each one.
 *
 * The client Ads Management screen was the model, but this one has more to
 * show, because Mahara's own leads, calls and deals all carry the ad they came
 * from. So a row here runs from impressions to the signed contract, and the
 * verdict beside it says whose problem a bad number is: the ad, the setter or
 * the closer.
 */

type Win = "w7" | "w30";

const TONE: Record<B2bVerdict["verdict"], StatusTone> = {
  scale: "good",
  hold: "warning",
  kill: "critical",
  fatiguing: "warning",
  "no delivery": "neutral",
  off: "neutral",
  "leads do not book": "serious",
  "intros do not convert": "serious",
  "demos do not close": "serious",
};

const OWNER: Record<NonNullable<B2bVerdict["owner"]>, string> = {
  ads: "the ad",
  setter: "the setter",
  closer: "the closer",
};

const CONSTRAINT_OWNER: Record<string, string> = {
  ads: "creative",
  landing: "landing page",
  setter: "setter",
  closer: "closer",
};

function adsManagerUrl(
  account: string,
  level: "campaign" | "adset" | "ad",
  id: string,
) {
  const key =
    level === "campaign"
      ? "selected_campaign_ids"
      : level === "adset"
        ? "selected_adset_ids"
        : "selected_ad_ids";
  return `https://adsmanager.facebook.com/adsmanager/manage/${level === "ad" ? "ads" : level === "adset" ? "adsets" : "campaigns"}?act=${account}&${key}=${id}`;
}

/** The funnel as a short row of numbers, in order, so the eye reads left to right. */
function Funnel({ w }: { w: B2bAdWindow }) {
  const cells: { label: string; value: string; dim?: boolean }[] = [
    { label: "spend", value: money(w.spend) },
    { label: "Meta leads", value: count(w.metaLeads), dim: true },
    { label: "leads", value: count(w.leads) },
    { label: "cost/lead", value: w.cpl === null ? "—" : money(w.cpl) },
    {
      label: "intros",
      value: `${count(w.introsShown)}/${count(w.introsBooked)}`,
    },
    { label: "demos", value: `${count(w.demosShown)}/${count(w.demosBooked)}` },
    {
      label: "cost/demo",
      value: w.costPerDemo === null ? "—" : money(w.costPerDemo),
    },
    { label: "closes", value: count(w.closes) },
    { label: "contracted", value: money(w.contracted) },
    { label: "ROAS", value: w.roas === null ? "—" : `${w.roas.toFixed(1)}x` },
  ];
  return (
    <div
      className="grid grid-cols-5 gap-x-4 gap-y-2 text-sm sm:grid-cols-10"
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      {cells.map(c => (
        <div key={c.label} className="min-w-0">
          <div className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
            {c.label}
          </div>
          <div className={c.dim ? "text-muted-foreground" : "font-medium"}>
            {c.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function Toggle({
  metaId,
  level,
  name,
  running,
  onDone,
}: {
  metaId: string;
  level: "campaign" | "adset" | "ad";
  name: string;
  running: boolean;
  onDone: (msg: string) => void;
}) {
  const setStatus = useAction(api.ceo.b2bControl.setStatus);
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<boolean | null>(null);
  const on = local ?? running;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async e => {
        e.stopPropagation();
        setBusy(true);
        const next = !on;
        const r = await setStatus({ metaId, level, active: next, name });
        if (r.ok) {
          setLocal(next);
          onDone(
            `${next ? "Turned on" : "Turned off"} ${level} "${name}". Meta accepted it; the numbers here update on the next refresh.`,
          );
        } else onDone(r.error ?? "Meta refused the change.");
        setBusy(false);
      }}
      className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
        on
          ? "border-[var(--ceo-good)] text-[var(--ceo-good)]"
          : "border-border text-muted-foreground"
      } disabled:opacity-50`}
      title={
        on ? "On in Meta. Click to pause." : "Off in Meta. Click to turn on."
      }
    >
      {busy ? "…" : on ? "On" : "Off"}
    </button>
  );
}

function AdRow({
  ad,
  win,
  account,
  onDone,
}: {
  ad: B2bAdNode;
  win: Win;
  account: string;
  onDone: (m: string) => void;
}) {
  const w = ad[win];
  return (
    <div className="grid gap-2 border-t py-3 pl-3">
      <div className="flex items-start gap-3">
        {ad.thumbnail ? (
          <img
            src={ad.thumbnail}
            alt=""
            loading="lazy"
            className="size-14 shrink-0 rounded object-cover"
            onError={e => {
              e.currentTarget.style.display = "none";
            }}
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium">{ad.name}</span>
            <StatusChip
              tone={TONE[ad.verdict.verdict]}
              label={ad.verdict.verdict}
            />
            {ad.verdict.owner && ad.verdict.owner !== "ads" ? (
              <span className="text-xs text-muted-foreground">
                {`→ ${OWNER[ad.verdict.owner]}`}
              </span>
            ) : null}
            <a
              href={adsManagerUrl(account, "ad", ad.id)}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-foreground"
              title="Open in Ads Manager"
            >
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
            <span className="ml-auto">
              <Toggle
                metaId={ad.id}
                level="ad"
                name={ad.name}
                running={ad.running}
                onDone={onDone}
              />
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {ad.verdict.reason}
          </p>
        </div>
      </div>
      <Funnel w={w} />
    </div>
  );
}

function CampaignCard({
  c,
  win,
  account,
  onDone,
}: {
  c: B2bAdsPayload["campaigns"][number];
  win: Win;
  account: string;
  onDone: (m: string) => void;
}) {
  const [open, setOpen] = useState(c.running);
  const [openSets, setOpenSets] = useState<Record<string, boolean>>({});
  const w = c[win];
  return (
    <div className="rounded-md border">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-start gap-3 p-3 text-left hover:bg-muted/40"
      >
        {open ? (
          <ChevronDown
            className="mt-1 size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
        ) : (
          <ChevronRight
            className="mt-1 size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{c.name}</span>
            <StatusChip
              tone={
                c.type === "lead_gen"
                  ? "good"
                  : c.type === "retargeting"
                    ? "neutral"
                    : "warning"
              }
              label={c.type.replace(/_/g, " ")}
            />
            <span className="text-xs text-muted-foreground">
              {`${c.adsets.length} ad ${c.adsets.length === 1 ? "set" : "sets"} · ${c.adsets.reduce((n, a) => n + a.ads.length, 0)} ads`}
            </span>
            <a
              href={adsManagerUrl(account, "campaign", c.id)}
              target="_blank"
              rel="noreferrer"
              onClick={e => e.stopPropagation()}
              className="text-muted-foreground hover:text-foreground"
              title="Open in Ads Manager"
            >
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
            <span className="ml-auto">
              <Toggle
                metaId={c.id}
                level="campaign"
                name={c.name}
                running={c.running}
                onDone={onDone}
              />
            </span>
          </div>
          {c.constraint ? (
            <p className="mt-1 text-xs">
              <span className="font-medium text-[var(--ceo-serious)]">
                The constraint is {CONSTRAINT_OWNER[c.constraint.owner]}:{" "}
              </span>
              <span className="text-muted-foreground">
                {`${c.constraint.stage} runs at ${pct(c.constraint.mine)} against ${pct(c.constraint.account)} across the account.`}
              </span>
            </p>
          ) : null}
          <div className="mt-2">
            <Funnel w={w} />
          </div>
        </div>
      </button>
      {open ? (
        <div className="border-t px-3 pb-2">
          {c.adsets.map(s => {
            const so = openSets[s.id] ?? s.running;
            const sw = s[win];
            return (
              <div key={s.id} className="border-t first:border-t-0">
                <button
                  type="button"
                  onClick={() => setOpenSets(m => ({ ...m, [s.id]: !so }))}
                  className="flex w-full items-start gap-2 py-3 text-left hover:bg-muted/30"
                >
                  {so ? (
                    <ChevronDown
                      className="mt-1 size-3.5 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                  ) : (
                    <ChevronRight
                      className="mt-1 size-3.5 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{s.name}</span>
                      <span className="text-xs text-muted-foreground">{`${s.ads.length} ads`}</span>
                      <span className="ml-auto">
                        <Toggle
                          metaId={s.id}
                          level="adset"
                          name={s.name}
                          running={s.running}
                          onDone={onDone}
                        />
                      </span>
                    </div>
                    <div className="mt-2">
                      <Funnel w={sw} />
                    </div>
                  </div>
                </button>
                {so ? (
                  <div className="pb-2 pl-5">
                    {s.ads.map(a => (
                      <AdRow
                        key={a.id}
                        ad={a}
                        win={win}
                        account={account}
                        onDone={onDone}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function AdsTab({ sections }: CeoTabProps) {
  const section = sections.b2bAds;
  const p = section?.payload ?? null;
  const [win, setWin] = useState<Win>("w7");
  const [msg, setMsg] = useState<string | null>(null);

  const verdictChips = useMemo(() => {
    if (!p) return [];
    return Object.entries(p.verdicts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => ({ key: k as B2bVerdict["verdict"], n }));
  }, [p]);

  if (!p)
    return (
      <SectionCard title="Our ads" section={section}>
        {() => null}
      </SectionCard>
    );

  const a = p.account[win];
  const label = win === "w7" ? "Last 7 days" : "Last 30 days";

  return (
    <div className="grid gap-4 lg:gap-6">
      <SectionCard
        kicker={`Mahara's own account · ${label}`}
        title="Our ads"
        section={section}
        notes={p.notes}
        actions={
          <div className="flex gap-1">
            {(["w7", "w30"] as Win[]).map(k => (
              <button
                key={k}
                type="button"
                onClick={() => setWin(k)}
                aria-pressed={win === k}
                className={`rounded-full border px-2.5 py-0.5 text-xs ${
                  win === k
                    ? "bg-foreground text-background"
                    : "text-muted-foreground"
                }`}
              >
                {k === "w7" ? "7 days" : "30 days"}
              </button>
            ))}
          </div>
        }
        order={0}
      >
        {() => (
          <div className="grid gap-5">
            <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4 xl:grid-cols-8">
              <StatTile
                variant="plain"
                label="Lead-gen ad spend"
                value={money(a.spend)}
              />
              <StatTile
                variant="plain"
                label="Leads in the CRM"
                value={count(a.leads)}
                sub={`Meta counts ${count(a.metaLeads)}`}
                hint="Meta counts a form fill. The CRM counts a contact that arrived with its attribution. The gap is a diagnosis, not noise."
              />
              <StatTile
                variant="plain"
                label="Cost per lead"
                value={a.cpl === null ? "—" : money(a.cpl)}
                sub="against the $15 gate"
              />
              <StatTile
                variant="plain"
                label="Intros shown"
                value={count(a.introsShown)}
                sub={`of ${count(a.introsBooked)} booked`}
              />
              <StatTile
                variant="plain"
                label="Demos shown"
                value={count(a.demosShown)}
                sub={`of ${count(a.demosBooked)} booked`}
              />
              <StatTile
                variant="plain"
                label="Cost per demo"
                value={a.costPerDemo === null ? "—" : money(a.costPerDemo)}
                sub="no gate set"
              />
              <StatTile
                variant="plain"
                label="Closes"
                value={count(a.closes)}
                sub={money(a.contracted)}
              />
              <StatTile
                variant="plain"
                label="ROAS on contracted"
                value={a.roas === null ? "—" : `${a.roas.toFixed(1)}x`}
                status={
                  p.running === 0 ? (
                    <StatusChip tone="critical" label="Nothing running" />
                  ) : undefined
                }
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{`${count(p.running)} of ${count(p.total)} ads running.`}</span>
              {verdictChips.map(v => (
                <StatusChip
                  key={v.key}
                  tone={TONE[v.key]}
                  label={`${v.n} ${v.key}`}
                />
              ))}
            </div>

            {msg ? <p className="text-sm">{msg}</p> : null}
          </div>
        )}
      </SectionCard>

      {p.campaigns.length ? (
        <div className="grid gap-3">
          {p.campaigns.map(c => (
            <CampaignCard
              key={c.id}
              c={c}
              win={win}
              account={p.accountId}
              onDone={setMsg}
            />
          ))}
        </div>
      ) : (
        <SectionCard title="Campaigns" section={section} order={1}>
          {() => (
            <EmptyState
              title="No campaigns in the last thirty days"
              text="Meta has no snapshot rows for the account in this window."
              icon={Megaphone}
            />
          )}
        </SectionCard>
      )}
    </div>
  );
}
