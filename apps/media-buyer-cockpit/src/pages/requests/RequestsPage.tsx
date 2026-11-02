// The CEO kit's status colours (StatusChip, StatusDot) live here.
import "@/components/ceo/ceo.css";
import { ChevronRight, CircleAlert, Inbox, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { EmptyState } from "@/components/ceo/EmptyState";
import { FilterChips, type FilterOption } from "@/components/ceo/FilterChips";
import { RequestForm } from "@/components/tasks/RequestForm";
import { Button } from "@/components/ui/button";
import { cancelRequest, errorWords, readRequests } from "@/lib/requestsClient";
import {
  kuwaitToday,
  type RequestsRead,
  type RequestView,
} from "@/lib/requestsCore";
import { useTaskSeat } from "@/lib/taskSeat";
import { AGAIN_REASON, RequestPanel, type RouteFrom } from "./RequestPanel";
import { RequestRowItem } from "./RequestRow";

/*
 * Hallmark · page: Requests · genre: modern-minimal (the cockpit's) · theme:
 * the portal's own tokens (docs/DESIGN.md)
 * states: default · hover · focus · active · disabled · loading · error · success
 * pre-emit critique: P4 H4 E4 S4 R5 V4
 *
 * Design plan (CONTRACT.md 6.1, 6.4): one column, max-w-6xl root, the
 * header and one muted line, a 32px pill row (FilterChips, the CEO kit's,
 * zero-count pills hidden), then either the form in one card (max-w-2xl)
 * or a flush list of one-line rows in one card. The form's route line is the
 * page's signature; the list's is the status chip on every row. A request
 * opens in the shared panel in place (?id=), never on another page.
 */

type View = "ask" | RequestView;
const VIEWS: View[] = ["ask", "mine", "assigned", "team", "all"];

type Load =
  | { status: "loading" }
  | { status: "ready"; data: RequestsRead }
  | { status: "error"; error: string };

/** A view's pill before the server has named it. */
const VIEW_WORDS: Record<RequestView, string> = {
  mine: "My requests",
  assigned: "Assigned to me",
  team: "Team queue",
  all: "All requests",
};

const PAGE = 50;
const MAX_ROWS = 200;

const EMPTY: Record<RequestView, { title: string; text: string }> = {
  mine: {
    title: "You have not asked for anything yet",
    text: "What you ask a team for shows here, with where it is in ClickUp.",
  },
  assigned: {
    title: "Nothing is assigned to you",
    text: "Requests whose ClickUp task has your name show here.",
  },
  team: {
    title: "Nothing is waiting in this queue",
    text: "Open requests for your team show here, old ClickUp form tickets too.",
  },
  all: {
    title: "No requests yet",
    text: "Every request the team raises shows here.",
  },
};

/**
 * /requests (CONTRACT.md 6.4): ask a team, and follow what you asked for,
 * what is assigned to you and your team's queue. Every seat; the database
 * decides which views a seat has.
 */
export function RequestsPage() {
  const seat = useTaskSeat();
  const client = seat.client;
  const [params, setParams] = useSearchParams();
  const rawView = params.get("view") as View | null;
  const view: View = rawView && VIEWS.includes(rawView) ? rawView : "ask";
  const openId = params.get("id");
  const [lists, setLists] = useState<Partial<Record<RequestView, Load>>>({});
  const [views, setViews] = useState<RequestsRead["views"]>([]);
  const [route, setRoute] = useState<RouteFrom | null>(null);
  const [formKey, setFormKey] = useState(0);
  // Rows per view: the first 50, then 50 more a press, up to the 200 a read
  // may return (DESIGN.md, long lists).
  const [limits, setLimits] = useState<Partial<Record<RequestView, number>>>(
    {},
  );

  const load = useCallback(
    async (v: RequestView, limit?: number) => {
      if (!client) return;
      setLists(l => ({
        ...l,
        [v]: l[v]?.status === "ready" ? l[v] : { status: "loading" },
      }));
      try {
        const data = await readRequests(client, v, limit ?? PAGE);
        setLists(l => ({ ...l, [v]: { status: "ready", data } }));
        setViews(data.views);
      } catch (e) {
        setLists(l => ({
          ...l,
          [v]: { status: "error", error: errorWords(e) },
        }));
      }
    },
    [client],
  );

  // The pills' counts come with every read; on the form, "My requests" is
  // read so the pills are there and the list is ready when pressed.
  const listView: RequestView = view === "ask" ? "mine" : view;
  const limit = limits[listView] ?? PAGE;
  useEffect(() => {
    if (seat.ready && client) void load(listView, limit);
  }, [seat.ready, client, listView, limit, load]);

  const go = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next))
      if (v === null) p.delete(k);
      else p.set(k, v);
    setParams(p, { replace: false });
  };

  const options = useMemo<FilterOption<View>[]>(() => {
    const list: FilterOption<View>[] = [
      { key: "ask", label: "Ask a team" },
      ...views.map(v => ({
        key: v.key,
        label: v.label,
        count: v.count ?? undefined,
      })),
    ];
    // Until the first read says which views the seat has, the one in the
    // address still shows as chosen.
    if (view !== "ask" && !views.some(v => v.key === view))
      list.push({ key: view, label: VIEW_WORDS[view] });
    return list;
  }, [views, view]);

  const presetType = route?.typeKey ?? params.get("type") ?? undefined;
  const clientParam = params.get("client");
  const presetClient =
    route?.client ??
    (clientParam
      ? { taskId: clientParam, name: params.get("clientName") ?? "" }
      : undefined);
  const current = view === "ask" ? null : lists[view];
  const today = kuwaitToday();

  return (
    // ceo-root: StatusChip and StatusDot take their colours from it (ceo.css).
    <div className="ceo-root mx-auto w-full max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight">Requests</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Ask another team for something. It becomes a ClickUp task with its
            SOP steps and an owner.
          </p>
        </div>
        <Link
          to="/requests/settings"
          className="-mx-2 inline-flex h-8 shrink-0 items-center gap-0.5 rounded-md px-2 text-[13px] font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-accent"
        >
          Settings
          <ChevronRight aria-hidden className="size-3.5" />
        </Link>
      </header>

      {/* The kit's row carries -my-1 (its chips' tap margins) and beat
          space-y-6, which has no specificity in Tailwind v4, so the card
          below rode 4px into the pills. In a wrapper, the wrapper takes the
          24px and the row's -4px only meets its own padding. */}
      <div>
        {/* Keyed by the pills it shows: the server's views arrive after the
            first paint, and a new row scrolls itself to the active pill, so
            a link to the last view (?view=all) never lands cut off. */}
        <FilterChips
          key={options
            .filter(o => o.count !== 0 || o.key === view)
            .map(o => o.key)
            .join(",")}
          options={options}
          value={view}
          ariaLabel="Requests"
          onChange={k => go({ view: k === "ask" ? null : k })}
        />
      </div>

      {view === "ask" ? (
        // The page's full width (tickets-look-1028): the department map takes
        // three columns, and a chosen request puts its route beside the
        // questions. The form fits itself to the card (container queries).
        <section className="rounded-2xl border bg-card p-4 sm:p-6">
          {route?.againOf ? (
            <p className="mb-4 rounded-xl bg-muted/40 p-3 text-[13px] text-muted-foreground">
              Filing again a request that did not reach ClickUp. Check the
              answers, then send.{" "}
              {route.againCanCancel
                ? "Sending it cancels the first one."
                : "The first one stays in the queue until the person who asked for it or the systems manager cancels it."}
              {route.replacesTaskId
                ? " It routes the same old ClickUp form ticket, unless someone routed it meanwhile."
                : null}
            </p>
          ) : route?.replacesTaskId ? (
            <p className="mb-4 rounded-xl bg-muted/40 p-3 text-[13px] text-muted-foreground">
              Routing a ticket from the old ClickUp form. Sending this closes
              the old one in ClickUp with a link to the new task.
            </p>
          ) : null}
          {clientParam && !route ? (
            <p className="mb-4 text-[13px] text-muted-foreground">
              For one client.{" "}
              <button
                type="button"
                className="rounded-sm font-medium text-[color:var(--tk-ink,var(--primary))] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => go({ client: null, clientName: null })}
              >
                Pick another client
              </button>
            </p>
          ) : null}
          {/* A new form for a new address or a new old ticket to route;
              the same form after a send, so its sent panel stays. */}
          <RequestForm
            key={`${formKey}:${params.get("type") ?? ""}:${clientParam ?? ""}`}
            source="requests_page"
            presetType={presetType}
            presetClient={presetClient}
            presetDetails={route?.details ?? undefined}
            presetAnswers={route?.answers}
            presetPriority={route?.priority}
            presetDueOn={route?.dueOn ?? undefined}
            replacesTaskId={route?.replacesTaskId || undefined}
            replacesIfOpen={Boolean(route?.againOf)}
            onSent={() => {
              // An old ticket is routed now (the server moved it); a request
              // filed again replaces the first one, which is cancelled here
              // when the seat may, so the queue holds it once. The notice
              // above goes, and "Ask for something else" starts clean.
              const first =
                route?.againOf && route.againCanCancel ? route.againOf : null;
              setRoute(null);
              void (async () => {
                if (first && client) {
                  try {
                    await cancelRequest(client, first, AGAIN_REASON);
                  } catch {
                    seat.toast.error(
                      "The new request is sent, but the first one is still open. Open it and cancel it.",
                    );
                  }
                }
                await load("mine");
              })();
            }}
          />
        </section>
      ) : (
        <section className="overflow-hidden rounded-2xl border bg-card">
          <ListBody
            view={view}
            state={current}
            today={today}
            onOpen={id => go({ id })}
            limit={limit}
            onRetry={() => void load(view, limit)}
            onMore={() =>
              setLimits(l => ({
                ...l,
                [view]: Math.min(MAX_ROWS, (l[view] ?? PAGE) + PAGE),
              }))
            }
            onAsk={() => go({ view: null })}
          />
        </section>
      )}

      <RequestPanel
        requestId={openId}
        onClose={() => go({ id: null })}
        onChanged={() => {
          void load(listView, limit);
        }}
        onRoute={from => {
          setRoute(from);
          setFormKey(k => k + 1);
          go({
            id: null,
            view: null,
            type: null,
            client: null,
            clientName: null,
          });
        }}
      />
    </div>
  );
}

function ListBody({
  view,
  state,
  today,
  limit,
  onOpen,
  onRetry,
  onMore,
  onAsk,
}: {
  view: RequestView;
  state: Load | null | undefined;
  today: string;
  limit: number;
  onOpen: (id: string) => void;
  onRetry: () => void;
  onMore: () => void;
  onAsk: () => void;
}) {
  if (!state || state.status === "loading")
    return (
      <p
        className="flex items-center gap-2 px-5 py-6 text-sm text-muted-foreground"
        role="status"
      >
        <LoaderCircle aria-hidden className="size-4 animate-spin" />
        Reading requests
      </p>
    );
  if (state.status === "error")
    return (
      <div className="flex items-start gap-2 px-5 py-6 text-sm" role="alert">
        <CircleAlert
          aria-hidden
          className="mt-0.5 size-4 shrink-0 text-destructive"
        />
        <div className="space-y-2">
          <p>{state.error}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={onRetry}>
              Try again
            </Button>
            <Button size="sm" variant="ghost" onClick={onAsk}>
              Ask a team
            </Button>
          </div>
        </div>
      </div>
    );
  const { rows, note } = state.data;
  // A note with no rows says why the view cannot show anything (a seat not
  // linked to ClickUp, a seat with no team): it is the view's state, never
  // followed by "nothing is assigned to you", which would read as zero.
  if (note && !rows.length)
    return (
      <p className="px-5 py-6 text-sm" role="status">
        {note}
      </p>
    );
  return (
    <>
      {note ? (
        <p className="border-b px-5 py-3 text-[13px] text-muted-foreground">
          {note}
        </p>
      ) : null}
      {rows.length ? (
        <ul aria-label="Requests">
          {rows.map(r => (
            <RequestRowItem key={r.id} row={r} today={today} onOpen={onOpen} />
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={Inbox}
          title={EMPTY[view].title}
          text={EMPTY[view].text}
          action={
            view === "mine" ? (
              <Button size="sm" onClick={onAsk}>
                Ask a team
              </Button>
            ) : undefined
          }
        />
      )}
      {rows.length >= limit && limit < MAX_ROWS ? (
        <div className="border-t px-5 py-3">
          <Button size="sm" variant="outline" onClick={onMore}>
            Show {PAGE} more
          </Button>
        </div>
      ) : rows.length >= MAX_ROWS ? (
        <p className="border-t px-5 py-3 text-[13px] text-muted-foreground">
          These are the first {MAX_ROWS}, the most pressing first. Finish or
          cancel some in ClickUp to see the rest.
        </p>
      ) : null}
    </>
  );
}
