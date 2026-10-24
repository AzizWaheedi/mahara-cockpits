import {
  ArrowUpRight,
  CheckCircle2,
  LoaderCircle,
  PauseCircle,
  ShieldCheck,
  UserRoundMinus,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { launchOperation } from "@/lib/launchClient";
import type { LaunchClient } from "@/lib/launchModel";

const checks = [
  [
    "campaigns",
    "Campaigns stopped",
    "Check every linked account, including campaigns with an unknown creator.",
  ],
  [
    "client_access",
    "Client access removed",
    "Remove the client team from Mahara OS and the Academy. Record each person or explain what does not apply.",
  ],
  [
    "agency_access",
    "Mahara access removed",
    "Remove our people, partner and system-user access from their Meta accounts and connected assets. Confirm the client keeps an administrator.",
  ],
  [
    "connections",
    "Other connections reviewed",
    "Review GoHighLevel, calendars and Drive sharing. Remove the approved access and keep the agreed handover and records.",
  ],
];
export function ClientService({
  c,
  client,
  rehearse,
  onHold,
}: {
  c: LaunchClient;
  client: any;
  rehearse: boolean;
  onHold: (held: boolean) => void;
}) {
  const [review, setReview] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [mode, setMode] = useState<"pause" | "offboard">("pause"),
    [reason, setReason] = useState(""),
    [confirm, setConfirm] = useState(false),
    [step, setStep] = useState(""),
    [note, setNote] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError("");
    launchOperation(client, "client.stopReview", { clickupId: c.id, rehearse })
      .then(r => {
        if (!cancelled) {
          setReview(r);
          onHold(!!r.lifecycle && r.lifecycle.state !== "released");
        }
      })
      .catch(e => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [c.id, client, rehearse, revision, onHold]);
  const hold = review?.lifecycle,
    held = hold && hold.state !== "released",
    enabled = review?.applyEnabled === true && !rehearse;
  async function stop() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await launchOperation(
        client,
        `client.${mode}`,
        {
          clickupId: c.id,
          fingerprint: review.fingerprint,
          reason: reason.trim(),
          rehearse,
        },
        true,
      );
      if (!r.ok) throw Error(r.message ?? "No change was made.");
      setMessage(r.did);
      setConfirm(false);
      onHold(true);
      setRevision(v => v + 1);
    } catch (e: any) {
      setError(e.message);
      onHold(true);
    } finally {
      setBusy(false);
    }
  }
  async function record(action: string, key?: string) {
    setBusy(true);
    setError("");
    try {
      const r = await client.rpc("cockpit_client_lifecycle_action", {
        p_client: c.id,
        p_revision: hold.revision,
        p_action: action,
        p_step: key ?? null,
        p_note: note.trim(),
      });
      if (r.error) throw Error(r.error.message);
      setReview((v: any) => ({ ...v, lifecycle: r.data.lifecycle }));
      onHold(r.data.lifecycle.state !== "released");
      setStep("");
      setNote("");
      setMessage(
        action === "release"
          ? "Hold removed. No campaign was switched on."
          : action === "complete"
            ? "Offboarding recorded as complete by the team. The campaign hold stays on."
            : "Team confirmation saved.",
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="launch-section client-service"
      aria-label="Pause and offboarding"
    >
      <div className="client-service-heading">
        <div>
          <p className="launch-eyebrow">Service controls</p>
          <h2>Pause or offboard</h2>
          <p>Stop delivery now. Keep the next step clear for everyone.</p>
        </div>
        <ShieldCheck size={24} />
      </div>
      {held && (
        <div className="client-service-hold">
          <PauseCircle size={18} />
          <div>
            <strong>
              {hold.mode === "offboard"
                ? hold.state === "complete"
                  ? "Offboarding complete"
                  : "Offboarding in progress"
                : "Campaign hold is on"}
            </strong>
            <p>
              New campaign changes and queued uploads are blocked. {hold.reason}
            </p>
            {hold.task_id && (
              <a
                className="launch-text-link"
                href={`https://app.clickup.com/t/${hold.task_id}`}
                target="_blank"
                rel="noreferrer"
              >
                Open the offboarding task <ArrowUpRight size={14} />
              </a>
            )}
          </div>
        </div>
      )}
      {held && hold.actionState && hold.actionState !== "confirmed" && (
        <div className="client-service-warning">
          <strong>Pause needs a receipt review</strong>
          <p>
            {hold.actionError ??
              "The request is still pending. Check its result before trying again."}
          </p>
          <small>
            Receipt {hold.action_id}. Ask an admin to reconcile this request.
            The campaign hold stays on.
          </small>
        </div>
      )}
      {message && (
        <p className="launch-message" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="launch-error" role="alert">
          {error} Refresh to check the current receipts before trying again.
        </p>
      )}
      {busy && (
        <p role="status" className="client-service-loading">
          <LoaderCircle size={16} className="animate-spin" /> Checking and
          saving…
        </p>
      )}
      {!review && !busy && (
        <Button variant="outline" onClick={() => setRevision(v => v + 1)}>
          Try again
        </Button>
      )}
      {review && (
        <>
          {!enabled && (
            <p className="launch-rehearsal">
              Rehearsal. No campaign or access changes will be made.
            </p>
          )}
          {(!held || hold.mode === "pause") && (
            <div
              className="client-service-choices"
              role="group"
              aria-label="Choose service action"
            >
              {[
                [
                  "pause",
                  "Pause campaigns",
                  "Keep client access and the existing setup.",
                  PauseCircle,
                ],
                [
                  "offboard",
                  "Full offboarding",
                  "Pause campaigns, then review both sides of access.",
                  UserRoundMinus,
                ],
              ].map(([key, title, text, Icon]: any) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={mode === key}
                  disabled={busy}
                  onClick={() => {
                    setMode(key);
                    setConfirm(false);
                  }}
                >
                  <Icon size={20} />
                  <strong>{title}</strong>
                  <span>{text}</span>
                </button>
              ))}
            </div>
          )}
          <div className="client-service-inventory">
            <div>
              <h3>Campaign review</h3>
              <small>
                {review.accounts.length} linked account
                {review.accounts.length === 1 ? "" : "s"} ·{" "}
                {new Date(review.checkedAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </small>
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                setConfirm(false);
                setRevision(v => v + 1);
              }}
            >
              Refresh check
            </Button>
          </div>
          {review.active.length ? (
            <ul className="client-service-campaigns">
              {review.active.map((x: any) => (
                <li key={x.id}>
                  <PauseCircle size={16} />
                  <div>
                    <strong>{x.name}</strong>
                    <small>
                      Account {x.accountId} · Campaign {x.id}
                    </small>
                  </div>
                  <span>Will pause</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="client-service-empty">
              {review.accounts.length
                ? "No verified Mahara campaign is switched on in these accounts."
                : "No account is linked. Confirm the client’s accounts before recording offboarding."}
            </p>
          )}
          {review.errors?.length > 0 && (
            <div className="client-service-warning">
              <strong>Some accounts could not be checked</strong>
              <p>
                Campaign actions stay blocked until these checks pass. If access
                was removed during offboarding, record that in the checklist.
              </p>
              {review.errors.map((x: any) => (
                <p key={x.accountId}>
                  Account {x.accountId}: {x.message}
                </p>
              ))}
            </div>
          )}
          {review.unverified.length > 0 && (
            <div className="client-service-warning">
              <strong>
                {review.unverified.length} switched-on campaign
                {review.unverified.length === 1 ? " needs" : "s need"} a manual
                review
              </strong>
              <p>
                The creator is not verified as Mahara. These campaigns will not
                be changed here.
              </p>
              {review.unverified.map((x: any) => (
                <a
                  key={x.id}
                  href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${x.accountId}&selected_campaign_ids=${x.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {x.name} · {x.id} <ArrowUpRight size={13} />
                </a>
              ))}
            </div>
          )}
          {(!held || hold.mode === "pause") && (
            <div className="client-service-action">
              <label htmlFor="service-reason">
                Reason for {mode === "offboard" ? "offboarding" : "the pause"}
              </label>
              <textarea
                id="service-reason"
                value={reason}
                maxLength={1000}
                disabled={busy}
                onChange={e => {
                  setReason(e.target.value);
                  setConfirm(false);
                }}
                placeholder="A short note for the team"
              />
              {confirm ? (
                <div className="client-service-confirm">
                  <p>
                    {mode === "pause"
                      ? "Pause the listed Mahara campaigns and hold new changes. Client access stays unchanged."
                      : "Pause the listed Mahara campaigns, hold new changes and create the offboarding task. Access removal is completed and recorded in the checklist below."}
                  </p>
                  <div>
                    <Button disabled={busy || !enabled} onClick={stop}>
                      {mode === "pause" ? "Confirm pause" : "Start offboarding"}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setConfirm(false)}
                    >
                      Go back
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  disabled={
                    busy ||
                    !enabled ||
                    reason.trim().length < 5 ||
                    review.errors?.length > 0
                  }
                  onClick={() => setConfirm(true)}
                >
                  {mode === "pause" ? "Review pause" : "Review offboarding"}
                </Button>
              )}
            </div>
          )}
          {held && hold.mode === "offboard" && (
            <div className="client-service-checklist">
              <h3>
                {hold.state === "complete"
                  ? "Offboarding record"
                  : "Finish the offboarding"}
              </h3>
              <p>
                Complete each change in its source system, then record what you
                checked. These are team confirmations.
              </p>
              {checks.map(([key, title, description]) => (
                <div key={key} className="client-service-check">
                  <CheckCircle2
                    size={18}
                    className={
                      hold.checks[key]
                        ? "text-success"
                        : "text-muted-foreground"
                    }
                  />
                  <div>
                    <strong>{title}</strong>
                    <p>{description}</p>
                    {hold.checks[key] && (
                      <small>
                        Team confirmed ·{" "}
                        {new Date(hold.checks[key].at).toLocaleDateString()}
                        <br />
                        {hold.checks[key].note}
                      </small>
                    )}
                    {step === key && (
                      <div className="client-service-proof">
                        <label htmlFor="service-evidence">
                          What was checked? Add the task or evidence link.
                        </label>
                        <textarea
                          id="service-evidence"
                          value={note}
                          maxLength={2000}
                          onChange={e => setNote(e.target.value)}
                        />
                        <Button
                          size="sm"
                          disabled={busy || !enabled || note.trim().length < 12}
                          onClick={() => record("check", key)}
                        >
                          Save confirmation
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setStep("")}
                        >
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>
                  {hold.state !== "complete" && step !== key && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || !enabled}
                      onClick={() => {
                        setStep(key);
                        setNote(hold.checks[key]?.note ?? "");
                      }}
                    >
                      {hold.checks[key] ? "Update" : "Record"}
                    </Button>
                  )}
                </div>
              ))}
              {hold.state !== "complete" && (
                <Button
                  variant="outline"
                  disabled={
                    busy ||
                    !enabled ||
                    checks.some(([key]) => !hold.checks[key])
                  }
                  onClick={() => {
                    setStep("complete");
                    setNote("");
                  }}
                >
                  Finish offboarding
                </Button>
              )}
            </div>
          )}
          {held && review.canRelease && (
            <Button
              variant="ghost"
              disabled={busy || !enabled}
              onClick={() => {
                setStep("release");
                setNote("");
              }}
            >
              Reopen campaign changes
            </Button>
          )}
          {["release", "complete"].includes(step) && (
            <div className="client-service-confirm">
              <p>
                {step === "release"
                  ? "Remove the hold so the team can prepare a relaunch. This does not restore access or turn ads on."
                  : "Confirm all four steps are complete. The campaign hold stays on."}
              </p>
              <label htmlFor="service-final-note">Review note</label>
              <textarea
                id="service-final-note"
                value={note}
                maxLength={2000}
                onChange={e => setNote(e.target.value)}
              />
              <Button
                disabled={busy || !enabled || note.trim().length < 12}
                onClick={() => record(step)}
              >
                {step === "release" ? "Remove hold" : "Confirm completion"}
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setStep("")}
              >
                Cancel
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
