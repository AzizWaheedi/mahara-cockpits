import { ArrowRight, ChevronDown } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import {
  accountStatus,
  accountTone,
  firstBlock,
  LANES,
  type Lane,
  type LaunchClient,
  launchHref,
  nextAction,
} from "@/lib/launchModel";
export function LaunchClientRow({ client: c }: { client: LaunchClient }) {
  return (
    <div className="launch-client-row">
      <div className="launch-client-name">
        <span className="launch-initial" aria-hidden="true">
          {c.name.slice(0, 1)}
        </span>
        <div>
          <p>{c.name}</p>
          <span>
            {c.stage ?? c.status} · {c.serviceMode || "Service not set"}
          </span>
        </div>
      </div>
      <div className="launch-row-accounts">
        {c.accounts.length ? (
          c.accounts.map(a => (
            <div key={a.id}>
              <span
                className={`launch-dot ${accountTone(a.status)}`}
                aria-hidden="true"
              />
              <span>
                {accountStatus(a.status)}
                <small>
                  …{a.id.slice(-6)} · {a.currency ?? "Currency unknown"}
                </small>
              </span>
            </div>
          ))
        ) : (
          <span className="text-muted-foreground">No ad account linked</span>
        )}
      </div>
      <div className="launch-row-date">
        <span className="launch-mobile-label">Last ran </span>
        {c.accounts.some(a => a.lastRan)
          ? new Date(
              c.accounts
                .map(a => a.lastRan ?? "")
                .sort()
                .at(-1)!,
            ).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
          : c.accounts.some(a => a.hasHistory)
            ? "Never"
            : "Unknown"}
      </div>
      <div className="launch-row-card">
        {c.cards[0]?.name ?? c.cards[0]?.taskName ?? "No ads card"}
        <small>{c.cards[0]?.adStatus ?? ""}</small>
      </div>
      <div className="launch-row-block">{firstBlock(c)}</div>
      <Button variant="outline" size="sm" asChild className="launch-row-action">
        <Link to={launchHref(c.id)}>
          {nextAction(c)}
          <ArrowRight size={14} />
        </Link>
      </Button>
    </div>
  );
}
export function LaunchLane({
  lane,
  clients,
}: {
  lane: Lane;
  clients: LaunchClient[];
}) {
  const [expanded, setExpanded] = useState(false),
    [ghosts, setGhosts] = useState(false);
  const info = LANES.find(x => x.id === lane)!;
  const hidden = clients.filter(c => lane === "onboarding" && c.ghosted);
  const rows = clients.filter(
    c => lane !== "onboarding" || !c.ghosted || ghosts,
  );
  return (
    <section id={`launch-${lane}`} className="launch-lane">
      <header>
        <div>
          <h2>
            {info.name}
            <span>{clients.length}</span>
          </h2>
          <p>{info.rule}</p>
        </div>
        {lane === "waiting" && clients.length > 0 && (
          <span className="launch-micro">
            First impressions confirm delivery
          </span>
        )}
      </header>
      {rows.length > 0 ? (
        <>
          <div className="launch-table-head">
            <span>Client</span>
            <span>Ad account</span>
            <span>Last ran</span>
            <span className="launch-row-card">Ads card</span>
            <span>What needs attention</span>
            <span />
          </div>
          {(expanded ? rows : rows.slice(0, 5)).map(c => (
            <LaunchClientRow key={c.id} client={c} />
          ))}
          {rows.length > 5 && (
            <button
              className="launch-show"
              type="button"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? "Show fewer" : `Show the other ${rows.length - 5}`}
              <ChevronDown size={14} />
            </button>
          )}
        </>
      ) : hidden.length === 0 ? (
        <p className="launch-empty">{info.empty}</p>
      ) : null}
      {hidden.length > 0 && (
        <button
          type="button"
          className="launch-ghosts"
          aria-expanded={ghosts}
          onClick={() => setGhosts(!ghosts)}
        >
          <span className="launch-dot unknown" />
          Ghosted ({hidden.length})<span>{ghosts ? "Hide" : "Show"}</span>
          <ChevronDown size={14} />
        </button>
      )}
    </section>
  );
}
