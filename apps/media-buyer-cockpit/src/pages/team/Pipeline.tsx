import { api, useAction } from "@/lib/cockpitApi";
import { Loader2, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { addDays, dayLabel, weekStart } from "@/lib/teamCore";
import type {
  CreativeRow,
  MeetingPage as Page,
  Strip,
} from "@/lib/team";
import {
  ConfirmInline,
  chip,
  errorText,
  InlineText,
  iconButton,
  peopleOptions,
  selectClass,
} from "./teamKit";

/**
 * The creative pipeline: every video is one row on the creative call's
 * board. The Tuesday call plans next week's rows and checks this week's.
 * A video with no launch date is not planned; a row whose passed due date
 * moves has slipped, counted by the server; two slips go to Saturday's
 * whole-team meeting, which reads the strip below.
 */

type Act = (fn: () => Promise<unknown>) => Promise<void>;

const STATUS_LABEL: Record<string, string> = {
  planned: "Planned",
  scripting: "Scripting",
  footage: "Footage",
  editing: "Editing",
  review: "Review",
  approved: "Approved",
  launched: "Launched",
  cut: "Cut",
};
const KIND_LABEL: Record<string, string> = {
  new: "New",
  refresh: "Refresh",
  edit: "Edit",
};
const SOURCE_LABEL: Record<string, string> = {
  slow_client_call: "Slow client call",
  creative_request: "Creative request",
  fatigue: "Fatigue list",
  other: "Other",
};

type Filter = "all" | "this" | "next" | "slipped";

function inWeek(r: CreativeRow, from: string): boolean {
  const to = addDays(from, 7);
  return [r.scriptDue, r.footageDue, r.editDue, r.launchOn].some(
    d => d && d >= from && d < to,
  );
}

export function PipelineBoard({
  page,
  act,
  onError,
}: {
  page: Page;
  act: Act;
  onError: (m: string) => void;
}) {
  const save = useAction(api.team.saveCreativeRow);
  const remove = useAction(api.team.deleteCreativeRow);
  const rows = page.creative ?? [];
  const [filter, setFilter] = useState<Filter>("all");
  const thisWeek = weekStart(page.today);
  const nextWeek = addDays(thisWeek, 7);
  const shown = useMemo(
    () =>
      rows.filter(r =>
        filter === "all"
          ? true
          : filter === "this"
            ? inWeek(r, thisWeek)
            : filter === "next"
              ? inWeek(r, nextWeek)
              : r.slipCount > 0,
      ),
    [rows, filter, thisWeek, nextWeek],
  );
  const counts = {
    all: rows.length,
    this: rows.filter(r => inWeek(r, thisWeek)).length,
    next: rows.filter(r => inWeek(r, nextWeek)).length,
    slipped: rows.filter(r => r.slipCount > 0).length,
  };
  const id = page.meeting.id;
  const change = (r: CreativeRow, fields: Record<string, unknown>) =>
    act(() => save({ meetingId: id, id: r.id, client: r.client, ...fields }));
  return (
    <section
      className="min-w-0 rounded-2xl border bg-card"
      aria-labelledby="pipeline"
    >
      <div className="grid gap-3 px-4 pt-4 sm:px-6 sm:pt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="pipeline" className="text-[15px] font-semibold">
            Creative pipeline
          </h2>
          <span className="text-xs text-muted-foreground">
            Week of {dayLabel(thisWeek)}. No launch date means not planned.
          </span>
        </div>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {(
            [
              ["all", "Everything"],
              ["this", "This week"],
              ["next", "Next week"],
              ["slipped", "Slipped"],
            ] as const
          ).map(([key, label]) =>
            key !== "all" && !counts[key] ? null : (
              <button
                key={key}
                type="button"
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
                className={chip(filter === key)}
              >
                {label}
                <span className="ml-1.5 tabular-nums opacity-60">
                  {counts[key]}
                </span>
              </button>
            ),
          )}
        </div>
      </div>
      {shown.length ? (
        <div className="relative mt-3 overflow-x-auto border-t">
          <table className="w-full min-w-[64rem] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                {[
                  "Client and angle",
                  "Type",
                  "Script",
                  "Footage",
                  "Edit",
                  "Launch",
                  "Status",
                  "Owner",
                  "Slips",
                  "",
                ].map(h => (
                  <th
                    key={h}
                    className={`px-3 py-2 font-medium first:pl-4 sm:first:pl-6 ${h === "Client and angle" ? "w-[16rem]" : ""}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {shown.map(r => (
                <tr
                  key={r.id}
                  className={`align-top ${r.overdue ? "shadow-[inset_3px_0_0_var(--warning)]" : ""}`}
                >
                  <td className="w-[16rem] px-3 py-2 pl-4 sm:pl-6">
                    <div className="min-w-[11rem]">
                      <InlineText
                        value={r.client}
                        label="Client"
                        placeholder="Client"
                        className="block font-medium"
                        onSave={client => change(r, { client })}
                      />
                      <InlineText
                        value={r.angle ?? ""}
                        label="Angle"
                        placeholder="Add the angle"
                        className="block text-muted-foreground"
                        onSave={angle => change(r, { angle: angle || null })}
                      />
                      {r.source ? (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {SOURCE_LABEL[r.source] ?? r.source}
                        </p>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <AnimatedSelect
                      className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
                      value={r.kind ?? ""}
                      aria-label="Type"
                      onChange={e =>
                        void change(r, { kind: e.target.value || null })
                      }
                    >
                      <option value="">Type</option>
                      {Object.entries(KIND_LABEL).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </AnimatedSelect>
                  </td>
                  {(
                    [
                      ["scriptDue", "Script due"],
                      ["footageDue", "Footage due"],
                      ["editDue", "Edit due"],
                      ["launchOn", "Launch date"],
                    ] as const
                  ).map(([field, label]) => (
                    <td key={field} className="px-3 py-2">
                      <DateCell
                        value={r[field]}
                        label={label}
                        today={page.today}
                        late={Boolean(
                          r[field] &&
                            (r[field] as string) < page.today &&
                            r.overdue,
                        )}
                        empty={
                          field === "launchOn" && r.notPlanned
                            ? "Not planned"
                            : null
                        }
                        onChange={value => change(r, { [field]: value })}
                      />
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    <AnimatedSelect
                      className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
                      value={r.status}
                      aria-label="Status"
                      onChange={e => void change(r, { status: e.target.value })}
                    >
                      {Object.entries(STATUS_LABEL).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </AnimatedSelect>
                    {r.overdue ? (
                      <p className="mt-1 text-[11px] txt-warn">Overdue</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <AnimatedSelect
                      className="h-8 min-w-[8rem] max-w-[10rem] whitespace-nowrap rounded-md border border-input bg-transparent px-2 text-xs"
                      value={r.ownerId ?? ""}
                      aria-label="Owner"
                      onChange={e =>
                        void change(r, { ownerId: e.target.value || null })
                      }
                    >
                      <option value="">No owner</option>
                      {peopleOptions(page.people, undefined, false)}
                    </AnimatedSelect>
                  </td>
                  <td
                    className={`px-3 py-2 font-mono tabular-nums ${r.slipCount >= 2 ? "txt-warn font-semibold" : r.slipCount ? "" : "text-muted-foreground"}`}
                  >
                    {r.slipCount}
                  </td>
                  <td className="px-2 py-2">
                    <ConfirmInline
                      ask="Take it off?"
                      yes="Take off"
                      onYes={() =>
                        act(() =>
                          remove({ meetingId: page.meeting.id, id: r.id }),
                        )
                      }
                    >
                      {open => (
                        <button
                          type="button"
                          onClick={open}
                          className={iconButton}
                          aria-label={`Take ${r.client}'s video off the pipeline`}
                        >
                          <X className="size-4" aria-hidden />
                        </button>
                      )}
                    </ConfirmInline>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 py-6 text-sm text-muted-foreground sm:px-6">
          {rows.length
            ? "Nothing in this view."
            : "No videos on the pipeline yet. Add next week's from the three inputs: slow client call fixes, open creative requests, and the fatigue list."}
        </p>
      )}
      <AddRow page={page} act={act} onError={onError} />
    </section>
  );
}

function DateCell({
  value,
  label,
  late,
  empty,
  onChange,
}: {
  value: string | null;
  label: string;
  today: string;
  late: boolean;
  empty: string | null;
  onChange: (value: string | null) => Promise<void>;
}) {
  return (
    <div className="grid gap-0.5">
      <DateInput
        value={value ?? ""}
        onChange={e => void onChange(e.target.value || null).catch(() => null)}
        aria-label={label}
        display={d =>
          dayLabel(
            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
          )
        }
        className={`h-8 w-[7rem] text-xs [&>span]:whitespace-nowrap ${late ? "txt-warn" : ""}`}
      />
      {empty ? <span className="text-[11px] txt-warn">{empty}</span> : null}
    </div>
  );
}

function AddRow({
  page,
  act,
  onError,
}: {
  page: Page;
  act: Act;
  onError: (m: string) => void;
}) {
  const save = useAction(api.team.saveCreativeRow);
  const openRequests = useAction(api.team.openCreativeRequests);
  const [client, setClient] = useState("");
  const [angle, setAngle] = useState("");
  const [kind, setKind] = useState("new");
  const [source, setSource] = useState("slow_client_call");
  const [busy, setBusy] = useState<string | null>(null);
  const [requests, setRequests] = useState<
    | {
        id: string;
        client: string;
        campaign: string | null;
        reason: string | null;
        note: string | null;
        createdAt: string;
      }[]
    | null
  >(null);
  const add = async (fields: Record<string, unknown>, key: string) => {
    setBusy(key);
    try {
      await act(() =>
        save({
          meetingId: page.meeting.id,
          client: String(fields.client),
          ...fields,
        }),
      );
    } catch {
      // The page shows the error.
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="grid gap-3 border-t px-4 py-3 sm:px-6">
      <form
        className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_8rem_11rem_auto] lg:items-center"
        onSubmit={async e => {
          e.preventDefault();
          if (!client.trim()) return;
          await add({ client, angle: angle || null, kind, source }, "add");
          setClient("");
          setAngle("");
        }}
      >
        <Input
          value={client}
          onChange={e => setClient(e.target.value)}
          placeholder="Client"
          aria-label="Client"
          dir="auto"
        />
        <Input
          value={angle}
          onChange={e => setAngle(e.target.value)}
          placeholder="Angle"
          aria-label="Angle"
          dir="auto"
        />
        <AnimatedSelect
          className={selectClass}
          value={kind}
          onChange={e => setKind(e.target.value)}
          aria-label="Type"
        >
          {Object.entries(KIND_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </AnimatedSelect>
        <AnimatedSelect
          className={selectClass}
          value={source}
          onChange={e => setSource(e.target.value)}
          aria-label="Where it came from"
        >
          {Object.entries(SOURCE_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </AnimatedSelect>
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={busy === "add" || !client.trim()}
        >
          {busy === "add" ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <Plus aria-hidden />
          )}
          Add a video
        </Button>
      </form>
      {requests === null ? (
        <button
          type="button"
          className="w-fit text-sm text-primary underline-offset-4 hover:underline"
          onClick={async () => {
            try {
              setRequests(
                (await openRequests({})) as NonNullable<typeof requests>,
              );
            } catch (e) {
              onError(errorText(e));
            }
          }}
        >
          Add from creative request
        </button>
      ) : (
        <div className="grid gap-2 rounded-xl bg-muted/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">Open creative requests</p>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setRequests(null)}
            >
              Close
            </button>
          </div>
          {requests.length ? (
            <ul className="grid gap-2">
              {requests.map(r => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
                >
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{r.client}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      {[r.reason, r.note].filter(Boolean).join(": ") ||
                        r.campaign ||
                        ""}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {dayLabel(r.createdAt)}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === r.id}
                    onClick={async () => {
                      await add(
                        {
                          client: r.client,
                          angle:
                            [r.reason, r.note]
                              .filter(Boolean)
                              .join(": ")
                              .slice(0, 200) || null,
                          kind: "new",
                          source: "creative_request",
                          creativeRequestId: r.id,
                        },
                        r.id,
                      );
                      setRequests(list =>
                        (list ?? []).filter(x => x.id !== r.id),
                      );
                    }}
                  >
                    {busy === r.id ? (
                      <Loader2 className="animate-spin" aria-hidden />
                    ) : (
                      <Plus aria-hidden />
                    )}
                    Add
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No open creative request is waiting: every one is on the pipeline
              or closed.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** The whole-team meeting reads the pipeline and never edits it. */
export function PipelineStrip({ strip }: { strip: Strip }) {
  return (
    <section
      className="rounded-2xl border bg-card p-4 sm:p-6"
      aria-labelledby="pipeline-strip"
    >
      <h2 id="pipeline-strip" className="text-[15px] font-semibold">
        Creative pipeline
      </h2>
      <div className="mt-3 grid grid-cols-2 gap-3 @container sm:grid-cols-3">
        <Tile
          label="Launched last week"
          value={`${strip.launchedLastWeek}`}
          note={`of ${strip.plannedLastWeek} planned`}
        />
        <Tile
          label="Launching this week"
          value={`${strip.launchingThisWeek}`}
        />
        <Tile
          label="Slipped twice or more"
          value={`${strip.slippedTwice}`}
          warn={strip.slippedTwice > 0}
        />
      </div>
      {strip.slipped.length ? (
        <ul className="mt-3 grid gap-1 text-sm">
          {strip.slipped.map(s => (
            <li key={`${s.client}-${s.angle}`}>
              <span className="font-medium">{s.client}</span>
              {s.angle ? (
                <span className="text-muted-foreground"> {s.angle}</span>
              ) : null}{" "}
              <span className="txt-warn">slipped {s.slips} times</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Tile({
  label,
  value,
  note,
  warn,
}: {
  label: string;
  value: string;
  note?: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded-xl bg-muted/40 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`mt-1 whitespace-nowrap text-2xl font-semibold tabular-nums ${warn ? "txt-warn" : ""}`}
      >
        {value}
      </p>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}
