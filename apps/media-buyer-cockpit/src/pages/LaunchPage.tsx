import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  FileText,
  LoaderCircle,
  Radio,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  ClientActivity,
  ClientDirectory,
  ClientTasks,
  clientState,
} from "@/components/launch/ClientDirectory";
import { LaunchSetup } from "@/components/launch/LaunchSetup";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { launchOperation, useLaunch } from "@/lib/launchClient";
import {
  accountStatus,
  accountTone,
  adsHref,
  bestPast,
  contractedBudget,
  defaultAccount,
  firstBlock,
  type LaunchClient,
  launchAge,
} from "@/lib/launchModel";
import "@/components/launch/launch.css";

const REHEARSAL = "Rehearsal. No changes will be made to Meta or ClickUp.";
const time = (v: string) =>
  new Date(v).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="launch-copy"
      onClick={() =>
        navigator.clipboard
          .writeText(id)
          .then(() => setCopied(true))
          .catch(() => setCopied(false))
      }
      aria-label={`Copy client ID ${id}`}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      <span>{copied ? "Copied" : id}</span>
    </button>
  );
}
export function LaunchPage() {
  const [params] = useSearchParams();
  const id = params.get("client") ?? undefined;
  const { data, error, loading, refresh, client } = useLaunch(id);
  if (loading)
    return (
      <main className="launch-page">
        <div className="launch-loading" role="status">
          <LoaderCircle className="animate-spin" size={20} />
          Loading the client book…
        </div>
      </main>
    );
  if (error || !data)
    return (
      <main className="launch-page">
        <h1>Clients</h1>
        <div className="launch-error" role="alert">
          <AlertTriangle size={20} />
          <div>
            <h2>The client list could not load.</h2>
            <p>
              Refresh the page; if it stays, the client board sync may be down.
            </p>
            <details>
              <summary>Details</summary>
              {error}
            </details>
            <Button onClick={refresh} variant="outline">
              Refresh
            </Button>
          </div>
        </div>
      </main>
    );
  if (id && data.clients[0])
    return (
      <LaunchDetail
        key={id}
        c={data.clients[0]}
        client={client}
        refresh={refresh}
        rehearse={params.get("rehearse") === "1"}
      />
    );
  return <ClientDirectory data={data} refresh={refresh} />;
}

function LaunchDetail({
  c,
  client,
  refresh,
  rehearse,
}: {
  c: LaunchClient;
  client: any;
  refresh: () => void;
  rehearse: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const tab = ["overview", "launch", "tasks", "activity"].includes(
    params.get("tab") ?? "",
  )
    ? params.get("tab")!
    : "overview";
  const setTab = (value: string) => {
    const next = new URLSearchParams(params);
    next.set("tab", value);
    setParams(next);
  };
  const [account, setAccount] = useState(defaultAccount(c)?.id ?? "");
  const [ready, setReady] = useState<any>(null),
    [readError, setReadError] = useState(""),
    [reading, setReading] = useState(false),
    [readVersion, setReadVersion] = useState(0);
  const [route, setRoute] = useState("copy"),
    [source, setSource] = useState(""),
    [budget, setBudget] = useState(String(contractedBudget(c)?.value ?? 30)),
    [plan, setPlan] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [linkAccount, setLinkAccount] = useState("");
  const [choices, setChoices] = useState<any>(null);
  const [setup, setSetup] = useState<Record<string, any>>({});
  const [linkPlan, setLinkPlan] = useState<any>(null);
  useEffect(() => {
    let ignore = false;
    setReady(null);
    setReadError("");
    setPlan(null);
    setSetup({});
    if (!account) return;
    setReading(true);
    launchOperation(client, "launch.readiness", {
      clickupId: c.id,
      accountId: account,
      rehearse,
    })
      .then(r => {
        if (ignore) return;
        setReady(r);
        if (r.budget?.contractedUsd) setBudget(String(r.budget.contractedUsd));
        setSource(
          r.best?.id ??
            r.candidates?.find((x: any) => x.owner?.kind === "mahara")?.id ??
            "",
        );
        setRoute(
          c.launches.some(l => l.state === "built" && l.account_id === account)
            ? "switchOn"
            : r.routes?.find((x: any) => x.available && x.id === "copy")
              ? "copy"
              : (r.routes?.find((x: any) => x.available)?.id ?? "copy"),
        );
      })
      .catch(e => {
        if (!ignore) setReadError(e.message);
      })
      .finally(() => {
        if (!ignore) setReading(false);
      });
    return () => {
      ignore = true;
    };
  }, [account, c.id, client, rehearse, c.launches, readVersion]);
  const a = c.accounts.find(x => x.id === account);
  const activeRoute = ready?.routes?.find((r: any) => r.id === route);
  const pending = c.launches.find(
    l => l.account_id === account && l.state === "built",
  );
  const best = bestPast({
    ...c,
    history: c.history.filter(h => h.account_id === account),
  });
  const cap = ready?.budget?.cap;
  const applyEnabled =
    (ready?.applyEnabled === true || choices?.applyEnabled === true) &&
    !rehearse;
  async function preview(apply = false, check = false) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await launchOperation(
        client,
        `launch.${route}`,
        {
          ...setup,
          clickupId: c.id,
          accountId: account,
          sourceCampaignId: source,
          ...(route === "switchOn" && pending ? { launchId: pending.id } : {}),
          dailyBudgetUsd: Number(budget),
          check,
          rehearse,
        },
        apply,
      );
      if (result.plan) setPlan(result.plan);
      if (result.ok) {
        setMessage(result.did ?? "The provider receipt is confirmed.");
        refresh();
      } else if (result.dryRun)
        setMessage(
          applyEnabled
            ? check
              ? "The plan check is complete. Review the result before applying."
              : "Plan ready. Nothing has changed yet."
            : REHEARSAL,
        );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The launch could not be checked.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function link(apply = false) {
    setBusy(true);
    setError("");
    try {
      const r = await launchOperation(
        client,
        "launch.attachAccount",
        { clickupId: c.id, accountId: linkAccount, rehearse },
        apply,
      );
      setLinkPlan(r.plan);
      setMessage(
        r.ok
          ? "Account linked."
          : applyEnabled
            ? "Account link checked. Review it before linking."
            : REHEARSAL,
      );
      if (r.ok) refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The account could not be checked.",
      );
    } finally {
      setBusy(false);
    }
  }
  const steps = plan?.steps ?? [];
  return (
    <main className="launch-page launch-detail" data-section={tab}>
      <Link to="/clients" className="launch-back">
        <ArrowLeft size={15} />
        All clients
      </Link>
      <header className="launch-page-header">
        <div>
          <p className="launch-eyebrow">
            {c.status} · {c.serviceMode || "Service not set"}
          </p>
          <h1>{c.name}</h1>
          <div className="launch-client-meta">
            <span>{c.stage ?? "Client account"}</span>
            <CopyId id={c.id} />
          </div>
        </div>
        <div className="launch-external">
          <a
            href={`https://app.clickup.com/t/${c.id}`}
            target="_blank"
            rel="noreferrer"
          >
            Client card
            <ArrowUpRight size={14} />
          </a>
          {c.inAds && (
            <Link to={adsHref(c)}>
              View in Ads
              <ArrowUpRight size={14} />
            </Link>
          )}
        </div>
      </header>
      {c.readOnly ? (
        <div className="launch-rehearsal">
          <ShieldCheck size={16} />
          This client is stopped. Its launch history is read-only.
        </div>
      ) : !applyEnabled ? (
        <div className="launch-rehearsal">
          <ShieldCheck size={16} />
          {REHEARSAL}
        </div>
      ) : null}
      {applyEnabled && !c.readOnly && (
        <div className="launch-inline-note">
          <ShieldCheck size={14} />
          Campaign actions are enabled. Preview first. Every change has a saved
          receipt.
        </div>
      )}
      <div
        className="client-profile-tabs"
        role="group"
        aria-label="Client sections"
      >
        {[
          ["overview", "Overview"],
          ["launch", "Launch & relaunch"],
          [
            "tasks",
            `Tasks${c.mediaTasks?.length ? ` (${c.mediaTasks.length})` : ""}`,
          ],
          ["activity", "Activity"],
        ].map(([key, label]) => (
          <button
            type="button"
            key={key}
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="launch-detail-grid">
        <aside className="launch-context">
          <section className="launch-section launch-account-plate">
            <p className="launch-eyebrow">Ad account</p>
            {c.accounts.length > 1 && (
              <div
                className="launch-account-tabs"
                role="group"
                aria-label="Choose an ad account"
              >
                {c.accounts.map(x => (
                  <button
                    type="button"
                    key={x.id}
                    aria-pressed={x.id === account}
                    onClick={() => setAccount(x.id)}
                  >
                    <span className={`launch-dot ${accountTone(x.status)}`} />…
                    {x.id.slice(-6)}
                  </button>
                ))}
              </div>
            )}
            {a ? (
              <>
                <h2>{ready?.account?.name ?? a.name ?? "Linked ad account"}</h2>
                <div className="launch-account-state">
                  <span
                    className={`launch-dot ${accountTone(ready?.account?.account_status ?? a.status)}`}
                  />
                  {accountStatus(ready?.account?.account_status ?? a.status)}
                </div>
                <dl>
                  <div>
                    <dt>Account ID</dt>
                    <dd>
                      <CopyId id={a.id} />
                    </dd>
                  </div>
                  <div>
                    <dt>Currency</dt>
                    <dd>
                      {ready?.account?.currency ?? a.currency ?? "Not checked"}
                    </dd>
                  </div>
                  <div>
                    <dt>Last spend</dt>
                    <dd>
                      {a.lastRan
                        ? time(a.lastRan)
                        : a.hasHistory
                          ? "Never"
                          : "Not in the hourly read"}
                    </dd>
                  </div>
                  <div>
                    <dt>Payment method</dt>
                    <dd>
                      {ready
                        ? ready.account.funding_source_details?.id
                          ? "Recorded"
                          : "Not recorded"
                        : "Checking Meta"}
                    </dd>
                  </div>
                </dl>
                {ready?.waitingBudgets?.length > 0 && (
                  <details className="launch-waiting-budgets">
                    <summary>
                      {ready.waitingBudgets.length} switched-on campaign
                      {ready.waitingBudgets.length === 1 ? "" : "s"}
                    </summary>
                    {ready.waitingBudgets.map((b: any) => (
                      <p key={b.id}>
                        {b.name}
                        <small>
                          {b.usd != null
                            ? `$${b.usd.toFixed(2)} a day`
                            : "Ad-set budget"}{" "}
                          · {b.owner.name}
                        </small>
                      </p>
                    ))}
                  </details>
                )}
                <a
                  className="launch-text-link"
                  target="_blank"
                  rel="noreferrer"
                  href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${a.id}`}
                >
                  Open Ads Manager
                  <ArrowUpRight size={14} />
                </a>
              </>
            ) : (
              <>
                <h2>No ad account linked</h2>
                <p>
                  Ask the client to share their account with Mahara, then link
                  it here.
                </p>
              </>
            )}
            {!c.readOnly && (
              <details
                className="launch-link-account"
                open={!a || a.status === 3}
              >
                <summary>
                  {a ? "Link another account" : "Link an ad account"}
                </summary>
                <p>
                  Shared with Mahara business 767701513092162. We check the
                  account before linking.
                </p>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      setChoices(
                        await launchOperation(client, "launch.readiness", {
                          clickupId: c.id,
                          availableAccounts: true,
                          rehearse,
                        }),
                      );
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Find shared accounts
                </Button>
                {choices && (
                  <label htmlFor="launch-detail-2">
                    Available to link
                    <AnimatedSelect
                      id="launch-detail-2"
                      value={linkAccount}
                      onChange={e => {
                        setLinkAccount(e.target.value);
                        setLinkPlan(null);
                      }}
                    >
                      <option value="">Choose a shared account</option>
                      {choices.accounts.map((x: any) => (
                        <option key={x.id} value={x.id}>
                          {x.name} · …{x.id.slice(-6)} ·{" "}
                          {accountStatus(x.account_status)}
                        </option>
                      ))}
                    </AnimatedSelect>
                    {!choices.accounts.length && (
                      <small>
                        No account shared with Mahara looks like this client's.
                        Ask the CSM to get it shared.
                      </small>
                    )}
                  </label>
                )}
                <label htmlFor="launch-detail-3">
                  Shared ad account ID
                  <Input
                    id="launch-detail-3"
                    inputMode="numeric"
                    value={linkAccount}
                    onChange={e =>
                      setLinkAccount(e.target.value.replace(/[^0-9]/g, ""))
                    }
                    placeholder="Ad account ID"
                  />
                </label>
                <Button
                  variant="outline"
                  disabled={busy || linkAccount.length < 5}
                  onClick={() => link(false)}
                >
                  Check account link
                </Button>
                {linkPlan && (
                  <p className="launch-input-help">
                    {linkPlan.result?.evidence ?? "Account checked."}
                  </p>
                )}
                {linkPlan && applyEnabled && (
                  <Button
                    variant="outline"
                    onClick={() => link(true)}
                    disabled={busy}
                  >
                    Link this account
                  </Button>
                )}
              </details>
            )}
          </section>
          <section className="launch-section">
            <p className="launch-eyebrow">Launch brief</p>
            <h2>Blueprint part 1</h2>
            {c.brief?.sentAt ? (
              <>
                <p className="launch-brief-sent">
                  <CheckCircle2 size={16} />
                  Sent {time(c.brief.sentAt)}
                </p>
                <dl>
                  {[
                    ["Service", c.brief.answers?.service],
                    ["Destination", c.brief.answers?.destination],
                    [
                      "Daily budget",
                      c.brief.answers?.daily_budget
                        ? `$${c.brief.answers.daily_budget}`
                        : null,
                    ],
                    ["Identity", c.brief.answers?.identity],
                    ["Starter ads", c.brief.answers?.starter],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v?.replaceAll("_", " ") ?? "Not recorded"}</dd>
                    </div>
                  ))}
                </dl>
                {/^https:\/\//.test(
                  c.starterPack ?? c.brief.answers?.pack_url ?? "",
                ) && (
                  <a
                    href={c.starterPack ?? c.brief.answers.pack_url}
                    className="launch-text-link"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open starter pack <ArrowUpRight size={14} />
                  </a>
                )}
                {c.brief.answers?.red_lines && (
                  <div className="launch-red-lines">
                    <p className="launch-micro">Client guidance</p>
                    <p>{c.brief.answers.red_lines}</p>
                  </div>
                )}
              </>
            ) : (
              <p>
                The creative director has not sent part 1 yet. The client stays
                visible while the team finishes it.
              </p>
            )}
            {c.tasks.map((t: any) => (
              <a
                key={t.taskId}
                href={`https://app.clickup.com/t/${t.taskId}`}
                className="launch-text-link"
                target="_blank"
                rel="noreferrer"
              >
                {t.name ?? "Open launch task"}
                <ArrowUpRight size={13} />
              </a>
            ))}
          </section>
          <section className="launch-section">
            <p className="launch-eyebrow">Ads Management</p>
            <h2>
              Board cards
              <span className="launch-inline-count">{c.cards.length}</span>
            </h2>
            {c.cards.length ? (
              c.cards.map((card: any) => (
                <a
                  key={card.taskId}
                  href={`https://app.clickup.com/t/${card.taskId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="launch-card-link"
                >
                  <FileText size={15} />
                  <span>
                    {card.name ?? card.taskName}
                    <small>{card.adStatus ?? "Status not recorded"}</small>
                  </span>
                  <ArrowUpRight size={13} />
                </a>
              ))
            ) : (
              <p>
                No ads card yet. A confirmed campaign build creates its card
                with the same name.
              </p>
            )}
          </section>
        </aside>
        <div className="launch-main">
          {tab === "overview" && (
            <>
              <section className="launch-section">
                <p className="launch-eyebrow">Client overview</p>
                <h2>Where things stand</h2>
                <div className="client-overview-state">
                  <div>
                    <strong>{clientState(c)}</strong>
                    <small>
                      {c.accounts.length} linked account
                      {c.accounts.length === 1 ? "" : "s"} ·{" "}
                      {c.mediaTasks?.length ?? 0} open media task
                      {c.mediaTasks?.length === 1 ? "" : "s"}
                    </small>
                  </div>
                  {c.inAds && (
                    <Link className="launch-text-link" to={adsHref(c)}>
                      Review Ads
                      <ArrowUpRight size={14} />
                    </Link>
                  )}
                </div>
                <p className="client-section-lede">
                  {c.readOnly
                    ? "This client is inactive. Their accounts, brief and history stay here for the team."
                    : c.inAds
                      ? "Review the current campaigns in Ads, or prepare the next campaign from this client profile."
                      : firstBlock(c)}
                </p>
                {!c.readOnly && (
                  <Button onClick={() => setTab("launch")}>
                    Launch or relaunch
                    <ArrowRight size={14} />
                  </Button>
                )}
              </section>
              <ClientTasks c={c} />
            </>
          )}
          {tab === "tasks" && <ClientTasks c={c} />}
          {tab === "activity" && <ClientActivity c={c} />}
          {tab === "launch" && (
            <>
              <section className="launch-section">
                <div className="launch-section-heading">
                  <div>
                    <p className="launch-eyebrow">Before you launch</p>
                    <h2>What this client needs</h2>
                  </div>
                  {account && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={reading}
                      onClick={() => setReadVersion(v => v + 1)}
                    >
                      <RefreshCw size={14} />
                      {reading ? "Checking" : "Check again"}
                    </Button>
                  )}
                </div>
                {reading ? (
                  <p className="launch-inline-loading">
                    <LoaderCircle size={15} className="animate-spin" />
                    Reading account health and campaign ownership from Meta…
                  </p>
                ) : readError ? (
                  <div role="alert" className="launch-error">
                    <AlertTriangle size={18} />
                    <p>
                      Meta did not answer for this account: {readError} Nothing
                      can be checked or created until it does.
                    </p>
                  </div>
                ) : ready ? (
                  <ul className="launch-checks">
                    {ready.checks.map((r: any) => (
                      <li key={r.key}>
                        <span className={`launch-check-icon ${r.state}`}>
                          {r.state === "ok" ? (
                            <Check size={15} />
                          ) : r.state === "block" ? (
                            <AlertTriangle size={15} />
                          ) : (
                            <Clock3 size={15} />
                          )}
                        </span>
                        <div>
                          <p>{r.sentence}</p>
                          {r.state !== "ok" && (
                            <small>
                              {r.owner} · {r.fix}
                            </small>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>
                    {firstBlock(c)}. Start with the account details on this
                    page.
                  </p>
                )}
              </section>
              {!c.readOnly && (
                <section className="launch-section">
                  <p className="launch-eyebrow">Your next move</p>
                  <h2>Choose how to launch</h2>
                  <div
                    className="launch-routes"
                    role="radiogroup"
                    aria-label="Launch route"
                  >
                    {(
                      ready?.routes ?? [
                        { id: "switchOn", label: "Switch back on" },
                        { id: "copy", label: "Copy a past campaign" },
                        { id: "rebuild", label: "Rebuild on a clean account" },
                        { id: "new", label: "New from the brief" },
                      ]
                    ).map((r: any) => (
                      <label
                        key={r.id}
                        className={`launch-route ${route === r.id ? "selected" : ""} ${!r.available ? "unavailable" : ""}`}
                      >
                        <input
                          type="radio"
                          name="launch-route"
                          value={r.id}
                          checked={route === r.id}
                          disabled={!r.available}
                          onChange={() => {
                            setRoute(r.id);
                            setPlan(null);
                            setError("");
                          }}
                        />
                        <span>
                          <strong>{r.label}</strong>
                          <small>
                            {r.reason ??
                              (
                                {
                                  switchOn:
                                    "Keep a verified Mahara campaign and review its budget.",
                                  copy: "Reuse the client’s own campaign. Create it paused.",
                                  rebuild:
                                    "Move the client’s media to a different linked account.",
                                  new: "Use the approved brief and imported client creatives.",
                                } as Record<string, string>
                              )[r.id]}
                          </small>
                        </span>
                      </label>
                    ))}
                  </div>
                  {ready && activeRoute?.available && (
                    <div className="launch-plan-inputs">
                      <LaunchSetup
                        rehearse={rehearse}
                        key={`${account}-${route}`}
                        client={client}
                        c={c}
                        account={account}
                        route={route}
                        source={source}
                        ready={ready}
                        value={setup}
                        onChange={v => {
                          setSetup(v);
                          setPlan(null);
                        }}
                        onSource={v => {
                          setSource(v);
                          setPlan(null);
                        }}
                      />
                      <label htmlFor="launch-detail-4">
                        Daily budget, USD
                        <div className="launch-budget">
                          <span>$</span>
                          <Input
                            id="launch-detail-4"
                            type="number"
                            min={5}
                            max={cap ?? 100}
                            value={budget}
                            onChange={e => {
                              setBudget(e.target.value);
                              setPlan(null);
                            }}
                          />
                          <span>/ day</span>
                        </div>
                        <small>
                          {ready.budget.contractedUsd
                            ? `$${ready.budget.contractedUsd} contracted · ${ready.budget.source}`
                            : "No contracted budget recorded"}{" "}
                          · Limit ${cap}
                        </small>
                      </label>
                      {route === "new" && (
                        <p className="launch-inline-note">
                          The plan needs approved copy, a Page, an audience and
                          imported client media. These are checked before any
                          campaign is created.
                        </p>
                      )}
                    </div>
                  )}
                  {plan && (
                    <div className="launch-plan-review">
                      <div className="launch-section-heading">
                        <h3>The plan</h3>
                        <span className="launch-micro">
                          {steps.length} planned steps
                        </span>
                      </div>
                      <p>
                        {plan.result?.campaignName ?? "Link the shared account"}
                      </p>
                      {plan.result?.budgetWords && (
                        <p>{plan.result.budgetWords}</p>
                      )}
                      <ol>
                        {steps.map((s: any, i: number) => (
                          <li key={`${s.path}-${i}`}>
                            <span>{i + 1}</span>
                            <div>
                              {s.provider === "clickup"
                                ? "Update the Ads Management card"
                                : s.body?.status === "ACTIVE"
                                  ? "Switch on the selected object"
                                  : s.path.endsWith("/campaigns")
                                    ? "Create the campaign, paused"
                                    : s.path.endsWith("/adsets")
                                      ? "Create the ad set, paused"
                                      : s.path.endsWith("/adcreatives")
                                        ? "Prepare the client creative"
                                        : s.path.endsWith("/ads")
                                          ? "Create the ad, paused"
                                          : "Prepare the client media"}
                              <small>{s.body?.name ?? s.provider}</small>
                            </div>
                          </li>
                        ))}
                      </ol>
                      {plan.check?.ready === false && (
                        <p className="launch-error">
                          Meta refused part of this plan. Change it, then check
                          again.
                        </p>
                      )}
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
                  <div className="launch-plan-footer">
                    <span>
                      <ShieldCheck size={14} />
                      {route === "switchOn"
                        ? "First impressions confirm delivery."
                        : "Created paused. Switch on is a separate step."}
                    </span>
                    <div>
                      {applyEnabled && plan && (
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => preview(false, true)}
                        >
                          Check with Meta
                        </Button>
                      )}
                      <Button
                        disabled={
                          busy ||
                          reading ||
                          !activeRoute?.available ||
                          plan?.check?.ready === false
                        }
                        onClick={() => preview(applyEnabled && !!plan)}
                      >
                        {busy ? (
                          <LoaderCircle className="animate-spin" size={15} />
                        ) : (
                          <ArrowRight size={15} />
                        )}{" "}
                        {plan
                          ? `${route === "switchOn" ? "Switch on" : "Create it paused"}${applyEnabled ? "" : " (rehearsal)"}`
                          : "Preview the plan"}
                      </Button>
                    </div>
                  </div>
                </section>
              )}
            </>
          )}
          {(tab === "overview" || tab === "activity") && (
            <section className="launch-section">
              <div className="launch-section-heading">
                <div>
                  <p className="launch-eyebrow">
                    Client history · Last 120 days
                  </p>
                  <h2>Past campaigns</h2>
                </div>
                {best && (
                  <span className="launch-best">
                    <span className="launch-dot ok" />
                    Best past result
                  </span>
                )}
              </div>
              {c.history.filter(h => h.account_id === account).length ? (
                <div className="launch-history">
                  {c.history
                    .filter(h => h.account_id === account)
                    .map(h => (
                      <div
                        key={`${h.account_id}-${h.campaign_id}`}
                        className={
                          h.campaign_id === best?.campaign_id ? "is-best" : ""
                        }
                      >
                        <div>
                          <p>{h.name}</p>
                          <small>
                            …{h.campaign_id?.slice(-6)} ·{" "}
                            {h.creator ?? "Creator not recorded"}
                          </small>
                        </div>
                        <span>
                          {h.leads ?? "Unknown"}
                          <small>leads</small>
                        </span>
                        <span>
                          {h.cpl != null
                            ? `$${Number(h.cpl).toFixed(2)}`
                            : "Unknown"}
                          <small>per lead</small>
                        </span>
                        <span>
                          {h.last_ran ? time(h.last_ran) : "Not recorded"}
                          <small>last spend</small>
                        </span>
                      </div>
                    ))}
                </div>
              ) : (
                <p>
                  No campaign is recorded on this account in the last 120 days.
                </p>
              )}
            </section>
          )}
          {(tab === "activity" || tab === "launch") &&
            c.launches.length > 0 && (
              <section className="launch-section">
                <p className="launch-eyebrow">Launch history</p>
                <h2>From paused to first spend</h2>
                {c.launches.map(l => (
                  <div key={l.id} className="launch-history-item">
                    <Radio size={16} />
                    <div>
                      <p>{l.campaign_name}</p>
                      <small>
                        {l.state === "reconcile"
                          ? "This launch may have reached Meta. Do not launch again; the CEO reconciles it."
                          : l.inAds
                            ? "Now listed in Ads"
                            : l.hasImpressions
                              ? "First impressions recorded"
                              : l.state === "built"
                                ? "Created paused"
                                : launchAge(l) > 24
                                  ? "No impressions after 24 hours"
                                  : "Waiting for first impressions"}{" "}
                        · {time(l.created_at)}
                      </small>
                    </div>
                    {l.state === "built" && !c.readOnly && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            const r = await client.rpc(
                              "cockpit_launch_action",
                              {
                                p_action: "discard",
                                p_args: { id: l.id },
                              },
                            );
                            if (r.error) throw r.error;
                            setMessage(
                              "The paused campaign stays in Ads Manager; nothing was deleted.",
                            );
                            refresh();
                          } catch (e) {
                            setError((e as Error).message);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Dismiss paused build
                      </Button>
                    )}
                  </div>
                ))}
              </section>
            )}
        </div>
      </div>
    </main>
  );
}
