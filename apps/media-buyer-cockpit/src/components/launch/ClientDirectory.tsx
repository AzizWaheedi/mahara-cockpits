import {
  ArrowRight,
  ArrowUpRight,
  RefreshCw,
  Search,
  Users,
} from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Input } from "@/components/ui/input";
import {
  accountStatus,
  defaultAccount,
  firstBlock,
  type LaunchClient,
  type LaunchPipeline,
  launchAge,
  launchHref,
} from "@/lib/launchModel";

export function clientState(c: LaunchClient) {
  if (c.serviceHold && c.serviceHold.state !== "released")
    return c.serviceHold.mode === "offboard"
      ? c.serviceHold.state === "complete"
        ? "Offboarded"
        : "Offboarding"
      : "On hold";
  if (c.readOnly) return c.status;
  if (c.waiting) return "Awaiting delivery";
  if (c.inAds) return "In Ads";
  if (c.lane === "onboarding") return "Onboarding";
  if (c.lane === "ready") return "Ready to launch";
  return "Nothing running";
}
export function needsAttention(c: LaunchClient) {
  if (c.serviceHold && c.serviceHold.state !== "released")
    return c.serviceHold.state !== "complete";
  return (
    !c.readOnly &&
    (!!c.mediaTasks?.length ||
      ["ready", "nothing"].includes(c.lane) ||
      c.launches.some(
        l =>
          !l.inAds &&
          (l.state === "built" ||
            l.state === "reconcile" ||
            (l.state === "switched_on" &&
              !l.hasImpressions &&
              launchAge(l) > 24)),
      ))
  );
}
export const CLIENT_VIEWS = [
  "all",
  "attention",
  "running",
  "onboarding",
  "inactive",
] as const;
export function filterClients(
  clients: LaunchClient[],
  view: string,
  search = "",
) {
  const q = search.toLowerCase().trim();
  return clients
    .filter(
      c =>
        (view === "attention"
          ? needsAttention(c)
          : view === "running"
            ? c.inAds &&
              !c.readOnly &&
              (!c.serviceHold || c.serviceHold.state === "released")
            : view === "onboarding"
              ? c.lane === "onboarding"
              : view === "inactive"
                ? c.readOnly
                : true) &&
        (!q ||
          [
            c.name,
            c.id,
            c.status,
            c.stage,
            ...c.accounts.flatMap(a => [a.name, a.id]),
          ]
            .join(" ")
            .toLowerCase()
            .includes(q)),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}
export function ClientDirectory({
  data,
  refresh,
}: {
  data: LaunchPipeline;
  refresh: () => void;
}) {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const view = params.get("view") ?? "all";
  const rows = filterClients(data.clients, view, search);
  const names = [
    "All clients",
    "Needs attention",
    "In Ads",
    "Onboarding",
    "Inactive",
  ];
  return (
    <main className="launch-page client-directory">
      <header className="launch-page-header">
        <div>
          <p className="launch-eyebrow">Media buyer · Your client book</p>
          <h1>Clients</h1>
          <p>
            Every account, every stage. Open a client to manage their next move.
          </p>
        </div>
        <label className="launch-search" htmlFor="client-search">
          <Search size={17} />
          <Input
            id="client-search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Find a client or account"
            aria-label="Find a client by name, ID or ad account"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")}>
              Clear
            </button>
          )}
        </label>
      </header>
      <div className="launch-status-line">
        <span>
          {data.sources?.board?.at
            ? `Client board checked ${new Date(data.sources.board.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
            : "Client board freshness is unavailable"}
        </span>
        <button type="button" onClick={refresh}>
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>
      <div className="client-filters" role="group" aria-label="Filter clients">
        {CLIENT_VIEWS.map((v, i) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => {
              const next = new URLSearchParams(params);
              next.set("view", v);
              setParams(next);
            }}
          >
            {names[i]}
            <span>{filterClients(data.clients, v).length}</span>
          </button>
        ))}
      </div>
      <section className="client-book" aria-label="Client directory">
        <div className="client-book-head">
          <span>Client</span>
          <span>Status</span>
          <span>Ad accounts</span>
          <span>Next step</span>
          <span />
        </div>
        {rows.map(c => {
          const a = defaultAccount(c);
          return (
            <div className="client-book-row" key={c.id}>
              <div className="client-book-name">
                <span
                  className={`client-state-spine ${c.readOnly ? "muted" : c.inAds ? "running" : "attention"}`}
                />
                <span className="launch-initial" aria-hidden="true">
                  {c.name.slice(0, 1)}
                </span>
                <div>
                  <strong>{c.name}</strong>
                  <small>
                    {c.serviceMode || "Service not set"} · {c.id}
                  </small>
                </div>
              </div>
              <div className="client-book-state">
                <span>{clientState(c)}</span>
                {!!c.mediaTasks?.length && (
                  <small>
                    {c.mediaTasks.length} open task
                    {c.mediaTasks.length === 1 ? "" : "s"}
                  </small>
                )}
              </div>
              <div className="client-book-account">
                {a ? (
                  <>
                    <span>{a.name || `Account …${a.id.slice(-6)}`}</span>
                    <small>
                      {accountStatus(a.status)}
                      {c.accounts.length > 1
                        ? ` · ${c.accounts.length} accounts`
                        : ""}
                    </small>
                  </>
                ) : (
                  <span>No account linked</span>
                )}
              </div>
              <div className="client-book-next">
                {c.readOnly
                  ? "History and account context"
                  : c.mediaTasks?.length
                    ? c.mediaTasks[0].title
                    : c.inAds
                      ? "Review performance or plan the next campaign"
                      : firstBlock(c)}
              </div>
              <Link className="client-open" to={launchHref(c.id)}>
                Open client
                <ArrowRight size={14} />
              </Link>
            </div>
          );
        })}
        {!rows.length && (
          <div className="client-book-empty">
            <Users size={24} />
            <h2>
              {data.clients.length
                ? "No clients in this view"
                : "Your seat has no clients yet"}
            </h2>
            <p>
              {data.clients.length
                ? "Try another filter or search by client name or ad account."
                : "Ask the CEO to add your clients in Team."}
            </p>
          </div>
        )}
      </section>
      <div className="launch-footer-note">
        <span>
          Inactive clients stay visible. Campaigns are created paused, then
          switched on after review.
        </span>
        <Link to="/ads">
          Open Ads
          <ArrowUpRight size={14} />
        </Link>
      </div>
    </main>
  );
}
export function ClientTasks({ c }: { c: LaunchClient }) {
  const tasks = c.mediaTasks ?? [];
  return (
    <section className="launch-section">
      <p className="launch-eyebrow">Media work</p>
      <h2>Tasks for {c.name}</h2>
      <p className="client-section-lede">
        Open the task to update its status. The existing ClickUp sync brings
        changes back here.
      </p>
      {c.tasksReady === false ? (
        <p role="status" className="client-section-lede">
          Task updates are unavailable. Check ClickUp before treating this
          client as clear.
        </p>
      ) : tasks.length ? (
        tasks.map(n => (
          <a
            className="client-task-row"
            key={n.id}
            href={n.href}
            target="_blank"
            rel="noreferrer"
          >
            <div>
              <strong>{n.title}</strong>
              <small>
                {n.body}
                {n.task?.overdue ? " · Overdue" : ""}
              </small>
              <small>{n.task?.status ?? "Status not recorded"}</small>
            </div>
            <ArrowUpRight size={16} />
          </a>
        ))
      ) : (
        <p className="client-section-lede">
          No open media task is linked to this client. Unmatched team tasks
          remain in Alerts.
        </p>
      )}
    </section>
  );
}
export function ClientActivity({ c }: { c: LaunchClient }) {
  const rows = c.actionHistory ?? [];
  return (
    <section className="launch-section">
      <p className="launch-eyebrow">Saved receipts</p>
      <h2>Campaign and creative log</h2>
      <p className="client-section-lede">
        The latest 50 recorded actions. Confirmed means Meta or ClickUp verified
        the change. Previews do not create an action.
      </p>
      {rows.length ? (
        rows.map(a => (
          <div className="client-activity-row" key={a.id}>
            <span
              className={`launch-dot ${["confirmed", "recorded"].includes(a.state) ? "ok" : a.state === "reconcile" ? "block" : "warn"}`}
            />
            <div>
              <strong>
                {a.did ||
                  a.operation
                    .replace(/^launch\./, "")
                    .replace(/([A-Z])/g, " $1")}
              </strong>
              <p>{a.campaign || c.name}</p>
              <small>
                {a.actor} · {new Date(a.at).toLocaleString("en-GB")}
              </small>
              <small>
                {a.state === "confirmed"
                  ? "Confirmed by provider"
                  : a.state === "recorded"
                    ? "Saved in the cockpit"
                    : a.state === "reconcile"
                      ? "Needs reconciliation. Do not repeat this action."
                      : a.state === "failed"
                        ? "Import failed. Review the details before retrying."
                        : a.state === "queued"
                          ? "Queued for processing"
                          : "Pending provider confirmation"}
              </small>
            </div>
          </div>
        ))
      ) : (
        <p className="client-section-lede">
          No cockpit action has been recorded for this client yet.
        </p>
      )}
    </section>
  );
}
