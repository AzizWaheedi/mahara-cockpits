import { ArrowRight, Clock3 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import {
  type LaunchPipeline,
  laneClients,
  launchHref,
} from "@/lib/launchModel";
import { launchRows } from "@/lib/mediaSourceModels";
import { LaunchClientRow } from "./LaunchLane";
import "./launch.css";
export function LaunchToday({ data }: { data: LaunchPipeline | null }) {
  if (!data) return null;
  const n =
    data.lanes.ready +
    data.lanes.onboarding +
    data.lanes.nothing +
    data.lanes.waiting;
  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Client launches</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {data.lanes.ready} ready · {data.lanes.nothing} with nothing running
            · {data.lanes.waiting} waiting for spend
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/launch">
            Open Launch
            <ArrowRight size={14} />
          </Link>
        </Button>
      </div>
      {!n && (
        <p className="mt-3 text-xs text-muted-foreground">
          No launch needs attention today.
        </p>
      )}
    </section>
  );
}
export function LaunchNothingRunning({
  data,
  error,
  refresh,
}: {
  data: LaunchPipeline | null;
  error: string;
  refresh: () => void;
}) {
  return (
    <div className="launch-page !p-0 mt-5">
      {error ? (
        <div className="launch-error">
          The launch list could not load.
          <Button variant="outline" onClick={refresh}>
            Refresh
          </Button>
        </div>
      ) : !data ? (
        <p className="launch-empty">Loading the client book…</p>
      ) : laneClients(data, "nothing").length ? (
        laneClients(data, "nothing").map(c => (
          <LaunchClientRow key={c.id} client={c} />
        ))
      ) : (
        <p className="launch-empty">
          Every active client has a campaign running.
        </p>
      )}
    </div>
  );
}
export function JustLaunched({
  data,
  renderPanel,
}: {
  data: LaunchPipeline | null;
  renderPanel?: (c: any) => ReactNode;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (!data) return null;
  const rows = launchRows(data);
  if (!rows.length) return null;
  return (
    <section className="mt-5 mb-5 rounded-xl border bg-card p-4">
      <h3 className="text-sm font-semibold">Just launched</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        First impressions recorded. Numbers for your date range start with the
        next sync.
      </p>
      {rows.map(c => (
        <div key={c._id}>
          <button
            type="button"
            className="flex w-full items-center gap-3 border-b py-4 text-left text-sm"
            aria-expanded={open === c._id}
            onClick={() => setOpen(open === c._id ? null : c._id)}
          >
            <Clock3 size={15} />
            <span className="flex-1">
              {c.clientName}
              <small className="block text-xs text-muted-foreground">
                {c.campaignName}
              </small>
            </span>
            <span className="text-xs text-muted-foreground">
              {c.today?.impressions ?? "Unknown"} impressions today
            </span>
            <ArrowRight size={15} />
          </button>
          {open === c._id && renderPanel && (
            <div className="pt-4">{renderPanel(c)}</div>
          )}
        </div>
      ))}
    </section>
  );
}
export function LaunchAccountLink({
  data,
  name,
}: {
  data: LaunchPipeline | null;
  name: string;
}) {
  const c = data?.clients.find(
    c => c.name.toLowerCase() === name.toLowerCase(),
  );
  if (!c) return null;
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border bg-card p-4">
      <div>
        <p className="text-sm font-medium">Launch or relaunch {c.name}</p>
        <p className="text-xs text-muted-foreground">
          Account access, brief, past campaigns and the next launch.
        </p>
      </div>
      <Button variant="outline" size="sm" asChild>
        <Link to={launchHref(c.id)}>
          Open Launch
          <ArrowRight size={14} />
        </Link>
      </Button>
    </div>
  );
}
