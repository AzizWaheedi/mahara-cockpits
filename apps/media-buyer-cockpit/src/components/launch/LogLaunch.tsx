import { ArrowRight, LoaderCircle, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import { launchOperation } from "@/lib/launchClient";
import type { LaunchClient } from "@/lib/launchModel";
import {
  type CardDetails,
  cardDetailsMissing,
  LaunchCardDetails,
} from "./LaunchCardDetails";

const REHEARSAL = "Rehearsal. No changes will be made to Meta or ClickUp.";

/** A campaign switched on in Ads Manager gets its card here, in place of the ClickUp form. */
export function LogLaunch({
  client,
  c,
  account,
  ready,
  applyEnabled,
  rehearse,
  refresh,
}: {
  client: any;
  c: LaunchClient;
  account: string;
  ready: any;
  applyEnabled: boolean;
  rehearse: boolean;
  refresh: () => void;
}) {
  const [campaignId, setCampaignId] = useState(""),
    [details, setDetails] = useState<CardDetails>({}),
    [plan, setPlan] = useState<any>(null),
    [logged, setLogged] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const carded = new Set(c.cards.map((x: any) => x.name ?? x.taskName));
  const choices = (ready?.candidates ?? []).filter(
    (x: any) =>
      x.status === "ACTIVE" && !carded.has(x.name) && !logged.includes(x.id),
  );
  const chosen = choices.find((x: any) => x.id === campaignId);
  const missing = chosen
    ? cardDetailsMissing(details, "log")
    : "Choose the campaign first.";
  async function run(apply: boolean) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await launchOperation(
        client,
        "launch.logCampaign",
        { clickupId: c.id, accountId: account, campaignId, details, rehearse },
        apply,
      );
      if (r.plan) setPlan(r.plan);
      if (r.ok) {
        setMessage(r.did ?? "The card is on the Ads Management board.");
        setLogged(l => [...l, campaignId]);
        setCampaignId("");
        setDetails({});
        setPlan(null);
        refresh();
      } else if (r.dryRun)
        setMessage(
          applyEnabled ? "Card ready. Nothing has changed yet." : REHEARSAL,
        );
    } catch (e) {
      setError(e instanceof Error ? e.message : "The card could not be made.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="launch-section">
      <p className="launch-eyebrow">Launched in Ads Manager</p>
      <h2>Log a launch</h2>
      <p>
        Use this in place of the ClickUp Launch New Campaign form. The cockpit
        makes the campaign card with every answer the form asks for.
      </p>
      {!ready ? (
        <p className="launch-inline-note">
          The account check above lists the campaigns you can log.
        </p>
      ) : choices.length ? (
        <div className="launch-plan-inputs">
          <label htmlFor="log-launch-campaign">
            Switched-on campaign
            <AnimatedSelect
              id="log-launch-campaign"
              value={campaignId}
              onChange={e => {
                setCampaignId(e.target.value);
                setDetails({});
                setPlan(null);
                setMessage("");
              }}
            >
              <option value="">Choose a campaign without a card</option>
              {choices.map((x: any) => (
                <option key={x.id} value={x.id}>
                  {x.name} · …{x.id.slice(-6)}
                </option>
              ))}
            </AnimatedSelect>
            <small>
              Switched-on campaigns on this account that have no card yet.
            </small>
          </label>
          {chosen && (
            <LaunchCardDetails
              key={campaignId}
              mode="log"
              client={client}
              c={c}
              account={account}
              campaignId={campaignId}
              campaignName={chosen.name}
              rehearse={rehearse}
              value={details}
              onChange={v => {
                setDetails(v);
                setPlan(null);
              }}
            />
          )}
        </div>
      ) : (
        <p className="launch-inline-note">
          Every switched-on campaign on this account already has a card. If you
          just switched one on in Ads Manager, press Check again above.
        </p>
      )}
      {plan && (
        <div className="launch-plan-review">
          <div className="launch-section-heading">
            <h3>The card</h3>
            <span className="launch-micro">
              {plan.steps?.length ?? 0} planned step
              {plan.steps?.length === 1 ? "" : "s"}
            </span>
          </div>
          <p>{plan.result?.campaignName}</p>
          <ol>
            <li>
              <span>1</span>
              <div>
                Create the Ads Management card with the launch details
                <small>
                  Ad Status Live · tagged {plan.steps?.[0]?.body?.tags?.[0]}
                </small>
              </div>
            </li>
          </ol>
        </div>
      )}
      {error && (
        <p role="alert" className="launch-error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="launch-inline-note">
          {message}
        </p>
      )}
      {choices.length > 0 && (
        <div className="launch-plan-footer">
          <span>
            <ShieldCheck size={14} />
            {chosen && missing
              ? missing
              : "The card replaces the form. The usual launch message follows."}
          </span>
          <div>
            <Button
              variant="outline"
              disabled={busy || !!missing}
              onClick={() => run(applyEnabled && !!plan)}
            >
              {busy ? (
                <LoaderCircle className="animate-spin" size={15} />
              ) : (
                <ArrowRight size={15} />
              )}{" "}
              {plan
                ? `Add to the board${applyEnabled ? "" : " (rehearsal)"}`
                : "Preview the card"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
