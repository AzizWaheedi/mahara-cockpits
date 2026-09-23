import { useAction, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { DateInput } from "@/components/ui/date-input";
import { api } from "../../convex/_generated/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

type WindowResult = {
  from: string;
  to: string;
  daysWithData: number;
  spend: number;
  leads: number;
  cpl: number | null;
  attributedBookings: number;
};
type Change = {
  id: string;
  source: string;
  at: number;
  actor: string;
  label: string;
  result: {
    state: "too_early" | "inconclusive" | "observed";
    reason: string;
    before: WindowResult;
    after: WindowResult;
  };
};

const money = (value: number | null) =>
  value === null ? "n/a" : `$${value.toFixed(2)}`;

function Window({
  title,
  data,
  leadsOnly,
}: {
  title: string;
  data: WindowResult;
  leadsOnly: boolean;
}) {
  return (
    <div className="min-w-0 rounded-md border bg-background p-2.5">
      <div className="text-[12px] font-semibold">
        {title}{" "}
        <span className="font-normal text-muted-foreground">
          {data.from} to {data.to}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px] tabular-nums">
        <span>
          Spend <strong>{money(data.spend)}</strong>
        </span>
        <span>
          Leads <strong>{data.leads}</strong>
        </span>
        <span>
          CPL <strong>{money(data.cpl)}</strong>
        </span>
        {!leadsOnly && (
          <span>
            Matched bookings <strong>{data.attributedBookings}</strong>
          </span>
        )}
      </div>
      {data.daysWithData < 3 && (
        <div className="mt-1 text-[11px] text-muted-foreground">
          {data.daysWithData} of 3 daily records available
        </div>
      )}
    </div>
  );
}

export function CampaignChangesResults({
  campaignName,
  taskUrl,
  leadsOnly,
  ads,
}: {
  campaignName: string;
  taskUrl?: string;
  leadsOnly: boolean;
  ads: { metaId: string; name: string; status: string }[];
}) {
  const data = useQuery(api.changeResults.forCampaign, { campaignName }) as
    | { changes: Change[]; periodDays: number; source: string }
    | undefined;
  const addChange = useMutation(api.cockpit.logManualChange);
  const [adding, setAdding] = useState(false);
  const [what, setWhat] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const trimmed = what.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await addChange({ campaignName, what: trimmed });
      setWhat("");
      setAdding(false);
      toast.success("Change added to this campaign and queued for ClickUp.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add the change.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Changes and results" className="space-y-3">
      <CreativeRequests
        campaignName={campaignName}
        ads={ads}
        leadsOnly={leadsOnly}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[14px] font-bold">Changes &amp; Results</h3>
          <p className="text-[12px] text-muted-foreground">
            What changed in this campaign and what was observed afterwards.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setAdding(v => !v)}>
          {adding ? "Cancel" : "Add change"}
        </Button>
      </div>
      {adding && (
        <div className="rounded-md border bg-background p-3">
          <label
            htmlFor="campaign-change-note"
            className="block text-[12px] font-semibold"
          >
            What changed?
          </label>
          <p className="mb-2 text-[12px] text-muted-foreground">
            Add work missing from Meta's activity log. It will also be posted to
            the campaign's ClickUp task.
          </p>
          <div className="flex flex-wrap gap-2">
            <Input
              id="campaign-change-note"
              value={what}
              onChange={event => setWhat(event.target.value)}
              placeholder="Changed the hook in the new ad"
              className="min-w-52 flex-1"
              maxLength={500}
            />
            <Button size="sm" disabled={!what.trim() || busy} onClick={save}>
              {busy ? "Adding…" : "Add change"}
            </Button>
          </div>
        </div>
      )}
      {data === undefined ? (
        <p className="rounded-md border p-3 text-[13px] text-muted-foreground">
          Loading changes…
        </p>
      ) : data.changes.length === 0 ? (
        <p className="rounded-md border p-3 text-[13px] text-muted-foreground">
          No campaign changes are available for the last {data.periodDays} days.
          Add a change only if it is missing from Meta.
        </p>
      ) : (
        <div className="space-y-2">
          {data.changes.map(change => (
            <article
              key={change.id}
              className="rounded-md border bg-background p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold" dir="auto">
                    {change.label}
                  </div>
                  <div className="text-[12px] text-muted-foreground">
                    {new Date(change.at).toLocaleString("en-GB", {
                      timeZone: "Asia/Kuwait",
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    · {change.actor} · {change.source}
                    {taskUrl && (
                      <>
                        {" "}
                        ·{" "}
                        <a
                          className="underline"
                          href={taskUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Campaign task in ClickUp
                        </a>
                      </>
                    )}
                  </div>
                </div>
                <span className="rounded border px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                  {change.result.state === "too_early"
                    ? "Too early"
                    : change.result.state === "inconclusive"
                      ? "Inconclusive"
                      : "Observed"}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Window
                  title="Before"
                  data={change.result.before}
                  leadsOnly={leadsOnly}
                />
                <Window
                  title="After"
                  data={change.result.after}
                  leadsOnly={leadsOnly}
                />
              </div>
              <p className="mt-2 text-[12px] text-muted-foreground">
                {change.result.reason}
              </p>
            </article>
          ))}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        {data?.source ?? ""} The change day is excluded; each side uses three
        complete Kuwait days. Matched bookings are not every client booking.
        Other changes may affect the result.
      </p>
    </section>
  );
}

type CreativeRequest = {
  id: string;
  source_meta_ad_id: string | null;
  source_ad_name: string | null;
  request_reason?: string | null;
  status: string;
  script_task_url?: string | null;
  editor_task_url?: string | null;
  asset_url?: string | null;
  launched_meta_ad_id?: string | null;
  launched_at?: string | null;
  launch_time_source?: string | null;
  verdict?: string | null;
  feedback_posted_at?: string | null;
  feedback_error?: string | null;
  last_error?: string | null;
};

function safeLink(url?: string | null): string | undefined {
  return url && /^https:\/\//i.test(url) ? url : undefined;
}

function CreativeLaunchResult({
  request,
  campaignName,
  leadsOnly,
}: {
  request: CreativeRequest;
  campaignName: string;
  leadsOnly: boolean;
}) {
  const result = useQuery(
    api.changeResults.forCreativeLaunch,
    request.launched_meta_ad_id && request.launched_at
      ? {
          campaignName,
          sourceAdId: request.source_meta_ad_id ?? undefined,
          launchedAdId: request.launched_meta_ad_id,
          launchedAt: Date.parse(request.launched_at),
        }
      : "skip",
  ) as
    | {
        campaign: Change["result"];
        sourceBefore: WindowResult | null;
        replacementAfter: WindowResult;
      }
    | undefined;
  if (!request.launched_meta_ad_id) return null;
  if (!result)
    return (
      <p className="text-[12px] text-muted-foreground">
        Loading launch results…
      </p>
    );
  return (
    <div className="mt-2 space-y-2">
      <div className="text-[12px] font-semibold">
        Observed after the creative launch
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {result.sourceBefore && (
          <Window
            title="Original ad before"
            data={result.sourceBefore}
            leadsOnly={leadsOnly}
          />
        )}
        <Window
          title="New ad after"
          data={result.replacementAfter}
          leadsOnly={leadsOnly}
        />
      </div>
      <p className="text-[12px] text-muted-foreground">
        Campaign result:{" "}
        {result.campaign.state === "too_early"
          ? "Too early"
          : result.campaign.state === "inconclusive"
            ? "Inconclusive"
            : "Observed"}
        . {result.campaign.reason}
        {request.launch_time_source === "buyer_date" &&
          " Launch day was entered by the media buyer."}
      </p>
      <p className="text-[11px] text-muted-foreground">
        {result.sourceBefore
          ? "These ads ran in different periods. The comparison is observational."
          : "No original ad was selected; the campaign result above is observational."}{" "}
        Matched bookings are only those traced to an ad.
      </p>
    </div>
  );
}

function CreativeRequests({
  campaignName,
  ads,
  leadsOnly,
}: {
  campaignName: string;
  ads: { metaId: string; name: string; status: string }[];
  leadsOnly: boolean;
}) {
  const list = useAction(api.creativeRequests.list);
  const linkLaunch = useAction(api.creativeRequests.linkLaunch);
  const review = useAction(api.creativeRequests.review);
  const retryFeedback = useAction(api.creativeRequests.retryFeedback);
  const [rows, setRows] = useState<CreativeRequest[] | null>(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [launchDays, setLaunchDays] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      setRows((await list({ campaignName })) as CreativeRequest[]);
      setError("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Creative requests could not load.",
      );
    }
  }, [campaignName, list]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const doLink = async (row: CreativeRequest) => {
    const launchedAdId = picked[row.id];
    const launchedOn = launchDays[row.id];
    if (!launchedAdId || !launchedOn) return;
    setBusy(row.id);
    try {
      await linkLaunch({ id: row.id, campaignName, launchedAdId, launchedOn });
      await refresh();
      toast.success("Launched ad linked to the creative request.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not link the ad.");
    } finally {
      setBusy(null);
    }
  };
  const doReview = async (
    row: CreativeRequest,
    verdict: "worked" | "needs_another_version" | "stop",
  ) => {
    setBusy(row.id);
    try {
      const updated = (await review({
        id: row.id,
        campaignName,
        verdict,
      })) as CreativeRequest;
      await refresh();
      if (updated.feedback_error) toast.error(updated.feedback_error);
      else
        toast.success(
          "Creative result saved and shared on the production tasks.",
        );
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Could not save the result.",
      );
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-bold">Creative requests</h3>
        <button
          type="button"
          className="text-[12px] underline"
          onClick={() => void refresh()}
        >
          Refresh
        </button>
      </div>
      {error && <p className="mt-2 text-[12px] txt-bad">{error}</p>}
      {rows === null && !error && (
        <p className="mt-2 text-[12px] text-muted-foreground">
          Loading requests…
        </p>
      )}
      {rows?.length === 0 && (
        <p className="mt-2 text-[12px] text-muted-foreground">
          No creative request yet. Start one in Recommendations.
        </p>
      )}
      {rows?.map(row => {
        const choices = ads.filter(ad => ad.metaId !== row.source_meta_ad_id);
        const reasonLabels: Record<string, string> = {
          more_ads: "More ads to test",
          new_angle: "New message, angle, or hook",
          fatigue: "Refresh a fatigued ad",
          edit_visuals: "Improve the edit or visuals",
        };
        const reasonLabel = reasonLabels[row.request_reason ?? ""];
        return (
          <div
            key={row.id}
            className="mt-2 rounded-md border bg-background p-3"
          >
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <strong dir="auto">{reasonLabel ?? "Creative request"}</strong>
              <span className="text-muted-foreground" dir="auto">
                {row.source_ad_name ?? "Campaign-wide"}
              </span>
              <span className="rounded border px-1.5 py-0.5 text-[11px]">
                {row.status.replaceAll("_", " ")}
              </span>
              {safeLink(row.script_task_url) && (
                <a
                  href={safeLink(row.script_task_url)}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  Director task
                </a>
              )}
              {safeLink(row.editor_task_url) && (
                <a
                  href={safeLink(row.editor_task_url)}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  Editor task
                </a>
              )}
              {safeLink(row.asset_url) && (
                <a
                  href={safeLink(row.asset_url)}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  Finished cut
                </a>
              )}
            </div>
            {row.last_error && (
              <p className="mt-1 text-[12px] txt-warn">{row.last_error}</p>
            )}
            {!row.launched_meta_ad_id && choices.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                <p className="w-full text-[11px] text-muted-foreground">
                  Confirm this ad uses the finished cut before linking it.
                </p>
                <AnimatedSelect
                  aria-label={`Launched ad for ${row.source_ad_name ?? "campaign"}`}
                  value={picked[row.id] ?? ""}
                  onChange={event =>
                    setPicked(prev => ({
                      ...prev,
                      [row.id]: event.target.value,
                    }))
                  }
                  className="min-w-40 flex-1 rounded-md border bg-background px-2 py-1 text-[12px]"
                >
                  <option value="">Select the launched new ad</option>
                  {choices.map(ad => (
                    <option key={ad.metaId} value={ad.metaId}>
                      {ad.name} · {ad.status}
                    </option>
                  ))}
                </AnimatedSelect>
                {/* biome-ignore lint/a11y/noLabelWithoutControl: The custom control renders a button inside this label. */}
                <label className="flex items-center gap-1.5 text-[12px]">
                  Day ad went live
                  <DateInput
                    aria-label={`Launch day for ${row.source_ad_name ?? "campaign"}`}
                    max={new Date(Date.now() + 3 * 3_600_000)
                      .toISOString()
                      .slice(0, 10)}
                    value={launchDays[row.id] ?? ""}
                    onChange={event =>
                      setLaunchDays(prev => ({
                        ...prev,
                        [row.id]: event.target.value,
                      }))
                    }
                    className="rounded-md border bg-background px-2 py-1"
                  />
                </label>
                <Button
                  size="sm"
                  disabled={
                    !picked[row.id] || !launchDays[row.id] || busy === row.id
                  }
                  onClick={() => void doLink(row)}
                >
                  Link launched ad
                </Button>
              </div>
            )}
            <CreativeLaunchResult
              request={row}
              campaignName={campaignName}
              leadsOnly={leadsOnly}
            />
            {row.launched_meta_ad_id && !row.verdict && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[12px] text-muted-foreground">
                  After reviewing the result:
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === row.id}
                  onClick={() => void doReview(row, "worked")}
                >
                  Worked
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === row.id}
                  onClick={() => void doReview(row, "needs_another_version")}
                >
                  Needs another version
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === row.id}
                  onClick={() => void doReview(row, "stop")}
                >
                  Stop
                </Button>
              </div>
            )}
            {row.verdict && (
              <p className="mt-2 text-[12px] font-semibold">
                Buyer assessment: {row.verdict.replaceAll("_", " ")}
              </p>
            )}
            {row.feedback_error && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] txt-warn">
                <span>{row.feedback_error}</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === row.id}
                  onClick={async () => {
                    setBusy(row.id);
                    try {
                      await retryFeedback({ id: row.id, campaignName });
                      await refresh();
                    } catch (e) {
                      toast.error(
                        e instanceof Error
                          ? e.message
                          : "Could not share feedback.",
                      );
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  Retry sharing
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
