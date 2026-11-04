import { ArrowUpRight, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Input } from "@/components/ui/input";
import { launchOperation } from "@/lib/launchClient";
import type { LaunchClient } from "@/lib/launchModel";

/** The answers of the ClickUp "Launch New Campaign" form, written on the card by the cockpit. */
export type CardDetails = {
  serviceType?: string | null;
  priority?: string | null;
  funnelType?: string | null;
  landingUrl?: string | null;
  dailyAdSpendUsd?: number | string | null;
  launchDay?: string;
  dos?: string;
};
export type CardInfo = {
  options: Record<"serviceType" | "priority" | "funnelType", string[]>;
  defaults: CardDetails;
  sources: Record<string, string | null>;
  fixed: {
    tag: string;
    platform: string;
    metaAccountUrl: string;
    crmUrl: string | null;
    cities: string[];
  };
  campaign: { id: string; name: string; status: string } | null;
};
type Mode = "switchOn" | "log";
const SOURCE: Record<string, string> = {
  "Last ads card": "From the last ads card",
  "Blueprint part 1": "From Blueprint part 1",
  Campaign: "From the campaign in Meta",
  "Campaign budget": "From the campaign budget",
  "Paused build": "From the paused build",
};
const kuwaitDay = (daysAgo = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuwait" }).format(
    new Date(Date.now() - daysAgo * 86_400_000),
  );

/** What the server would refuse, said before the press. */
export function cardDetailsMissing(v: CardDetails, mode: Mode): string | null {
  if (!v.serviceType) return "Choose the service type for the card.";
  if (!v.priority) return "Choose the priority for the card.";
  if (!v.funnelType) return "Choose the funnel type for the card.";
  if (
    v.funnelType === "Landing Page" &&
    !/^https:\/\/\S+$/.test(v.landingUrl ?? "")
  )
    return "Add the landing page link.";
  if (mode === "log" && !(Number(v.dailyAdSpendUsd) >= 1))
    return "Enter the daily ad spend.";
  if (mode === "log" && !v.launchDay) return "Choose the launch date.";
  return null;
}

export function LaunchCardForm({
  info,
  value,
  onChange,
  mode,
  campaignName,
  spendUsd,
}: {
  info: CardInfo;
  value: CardDetails;
  onChange: (v: CardDetails) => void;
  mode: Mode;
  campaignName?: string;
  spendUsd?: number;
}) {
  const change = (patch: CardDetails) => onChange({ ...value, ...patch });
  const from = (key: string) =>
    info.sources[key] ? <small>{SOURCE[info.sources[key]!]}</small> : null;
  const choice = (
    key: "serviceType" | "priority" | "funnelType",
    label: string,
    empty: string,
    hint?: string,
  ) => (
    <label htmlFor={`launch-card-${mode}-${key}`}>
      {label}
      <AnimatedSelect
        id={`launch-card-${mode}-${key}`}
        value={value[key] ?? ""}
        onChange={e => change({ [key]: e.target.value || null })}
      >
        <option value="">{empty}</option>
        {info.options[key].map(o => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </AnimatedSelect>
      {hint && <small>{hint}</small>}
      {from(key)}
    </label>
  );
  return (
    <div className="launch-card-form">
      <div className="launch-card-form-head">
        <div>
          <p className="launch-eyebrow">ClickUp card</p>
          <p className="launch-card-name">
            <span className="launch-dot ok" />
            {campaignName ?? info.campaign?.name ?? "The campaign name in Meta"}
          </p>
          <p>
            {mode === "switchOn"
              ? "Made on the Ads Management board when the campaign switches on."
              : "Made on the Ads Management board when you add it."}{" "}
            These answers replace the Launch New Campaign form.
          </p>
        </div>
        <span className="launch-card-tag">{info.fixed.tag}</span>
      </div>
      <div className="launch-card-questions">
        {choice("serviceType", "Service type", "Choose the service")}
        {choice(
          "priority",
          "Priority",
          "Choose the priority",
          "Based on monthly spend",
        )}
        {choice("funnelType", "Funnel type", "Choose the funnel")}
        {value.funnelType === "Landing Page" && (
          <label htmlFor={`launch-card-${mode}-landing`}>
            Landing page
            <Input
              id={`launch-card-${mode}-landing`}
              type="url"
              value={value.landingUrl ?? ""}
              onChange={e => change({ landingUrl: e.target.value })}
              placeholder="https://"
            />
            {value.landingUrl && from("landingUrl")}
          </label>
        )}
        {mode === "log" && (
          <>
            <label htmlFor="launch-card-log-spend">
              Daily ad spend, USD
              <Input
                id="launch-card-log-spend"
                type="number"
                min={1}
                inputMode="decimal"
                value={value.dailyAdSpendUsd ?? ""}
                onChange={e => change({ dailyAdSpendUsd: e.target.value })}
              />
              {from("dailyAdSpendUsd")}
            </label>
            <label htmlFor="launch-card-log-day">
              Launch date
              <Input
                id="launch-card-log-day"
                type="date"
                min={kuwaitDay(14)}
                max={kuwaitDay()}
                value={value.launchDay ?? ""}
                onChange={e => change({ launchDay: e.target.value })}
              />
              <small>The day it went live, Kuwait time</small>
            </label>
          </>
        )}
        <label htmlFor={`launch-card-${mode}-dos`} className="wide">
          Do's and don'ts
          <textarea
            id={`launch-card-${mode}-dos`}
            dir="auto"
            maxLength={2000}
            value={value.dos ?? ""}
            onChange={e => change({ dos: e.target.value })}
          />
          <small>Optional. Shown on the card for the team.</small>
        </label>
      </div>
      <dl className="launch-card-fixed">
        {mode === "switchOn" && (
          <>
            <div>
              <dt>Launch date</dt>
              <dd>The day it switches on</dd>
            </div>
            <div>
              <dt>Daily ad spend</dt>
              <dd>
                {spendUsd
                  ? `$${spendUsd} a day, the budget above`
                  : "The budget above"}
              </dd>
            </div>
          </>
        )}
        <div>
          <dt>Platform</dt>
          <dd>{info.fixed.platform}</dd>
        </div>
        <div>
          <dt>Meta ad account</dt>
          <dd>
            <a
              href={info.fixed.metaAccountUrl}
              target="_blank"
              rel="noreferrer"
            >
              Ads Manager link
              <ArrowUpRight size={12} />
            </a>
          </dd>
        </div>
        <div>
          <dt>CRM sub-account</dt>
          <dd>
            {info.fixed.crmUrl ? (
              <a href={info.fixed.crmUrl} target="_blank" rel="noreferrer">
                CRM link
                <ArrowUpRight size={12} />
              </a>
            ) : (
              "No CRM location on the client record"
            )}
          </dd>
        </div>
        <div>
          <dt>Advertising cities</dt>
          <dd>
            {info.fixed.cities.length
              ? info.fixed.cities.join(", ")
              : "None on the last ads card"}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** Reads the suggested answers once, then lets the media buyer change any of them. */
export function LaunchCardDetails({
  client,
  c,
  account,
  campaignId,
  rehearse,
  value,
  onChange,
  ...form
}: {
  client: any;
  c: LaunchClient;
  account: string;
  campaignId?: string;
  rehearse: boolean;
  value: CardDetails;
  onChange: (v: CardDetails) => void;
  mode: Mode;
  campaignName?: string;
  spendUsd?: number;
}) {
  const [info, setInfo] = useState<CardInfo | null>(null),
    [error, setError] = useState("");
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  useEffect(() => {
    let current = true;
    setInfo(null);
    setError("");
    launchOperation(client, "launch.readiness", {
      clickupId: c.id,
      accountId: account,
      ...(campaignId ? { campaignId } : {}),
      cardDetails: true,
      rehearse,
    })
      .then((r: CardInfo) => {
        if (!current) return;
        setInfo(r);
        // Anything typed while the suggestions loaded wins over them.
        const typed = Object.fromEntries(
          Object.entries(latest.current.value).filter(([, v]) => v),
        );
        latest.current.onChange({ ...r.defaults, ...typed });
      })
      .catch(e => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [client, c.id, account, campaignId, rehearse]);
  if (error)
    return (
      <p className="launch-error" role="alert">
        The card answers could not load: {error}
      </p>
    );
  if (!info)
    return (
      <p className="launch-inline-loading">
        <LoaderCircle size={15} className="animate-spin" />
        Reading the last ads card and the campaign…
      </p>
    );
  return (
    <LaunchCardForm info={info} value={value} onChange={onChange} {...form} />
  );
}
