// The CEO kit's status colours (StatusChip, StatusDot) live here.
import "@/components/ceo/ceo.css";
import { ChevronRight, CircleAlert, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { FilterChips, type FilterOption } from "@/components/ceo/FilterChips";
import { Button } from "@/components/ui/button";
import { errorWords, readRequestTypes } from "@/lib/requestsClient";
import type { TypesRead } from "@/lib/requestsCore";
import { useTaskSeat } from "@/lib/taskSeat";
import { AlertRules } from "./AlertRules";
import { SeatLinks } from "./SeatLinks";
import { RequestTypes } from "./TypeEditor";

/*
 * Hallmark · page: Requests settings · genre: modern-minimal (the
 * cockpit's) · theme: the portal's own tokens (docs/DESIGN.md)
 * states: default · hover · focus · active · disabled · loading · error · success
 * pre-emit critique: P4 H4 E4 S4 R4 V4
 *
 * Design plan (CONTRACT.md 6.4, PLAN.md 4.8 and D17): the routing an
 * editor used to change in ClickUp's automations, as rows anyone with the
 * right can change here. One column, the header and one muted line, the
 * link to the Slack notices page, then 32px pills for the three tabs and
 * one card per tab with a flush list. The type editor opens in the shared
 * panel. The database gates every read and save; a seat that is not an
 * editor sees only its own alerts.
 */

type Tab = "types" | "people" | "alerts";
const TABS: Tab[] = ["types", "people", "alerts"];

/**
 * /requests/settings: request types, people in ClickUp and alerts (6.4).
 * Editors are the CEO, admin seats and any seat given the right
 * (cockpit_forms_editor_gate); the server says which this seat is.
 */
export function RequestsSettings() {
  const seat = useTaskSeat();
  const client = seat.client;
  const [params, setParams] = useSearchParams();
  const [read, setRead] = useState<
    | { status: "loading" }
    | { status: "ready"; data: TypesRead }
    | { status: "error"; error: string }
  >({ status: "loading" });

  const load = useCallback(async () => {
    if (!client) return;
    try {
      setRead({ status: "ready", data: await readRequestTypes(client) });
    } catch (e) {
      setRead({ status: "error", error: errorWords(e) });
    }
  }, [client]);
  useEffect(() => {
    if (seat.ready && client) void load();
  }, [seat.ready, client, load]);

  const editor = read.status === "ready" && read.data.seat.editor;
  // The Slack notices page reads only for a notices editor (the same gate as
  // here) or a client success or creative seat (cockpit_slack_notice_viewer);
  // any other seat would land on its refusal, so it gets no link.
  const noticesOpen =
    read.status === "ready" &&
    (read.data.seat.editor ||
      read.data.seat.teams.includes("client_success") ||
      read.data.seat.teams.includes("creative"));
  const asked = params.get("tab") as Tab | null;
  const tab: Tab =
    read.status !== "ready"
      ? "alerts"
      : !editor
        ? "alerts"
        : asked && TABS.includes(asked)
          ? asked
          : "types";

  const options = useMemo<FilterOption<Tab>[]>(
    () =>
      editor
        ? [
            { key: "types", label: "Request types" },
            { key: "people", label: "People in ClickUp" },
            { key: "alerts", label: "Alerts" },
          ]
        : [{ key: "alerts", label: "Alerts" }],
    [editor],
  );

  return (
    // ceo-root: StatusChip and StatusDot take their colours from it (ceo.css).
    <div className="ceo-root mx-auto w-full max-w-6xl space-y-6">
      <header className="min-w-0 max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">
          Requests settings
        </h1>
        {/* One line, said once the seat is known, so it never changes
            under the reader. */}
        <p className="mt-1 min-h-5 text-sm text-muted-foreground">
          {read.status !== "ready"
            ? ""
            : editor
              ? "Where each request goes, who owns it and what it asks, which ClickUp user each seat is, and which alerts you get. A change applies to the next request."
              : "Which task alerts you get, and when."}
        </p>
        {noticesOpen ? (
          <a
            href="/client-success/notices"
            className="mt-2 inline-flex items-center gap-0.5 rounded-sm text-[13px] font-medium text-[color:var(--tk-ink,var(--primary))] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Slack notices
            <ChevronRight aria-hidden className="size-3.5" />
          </a>
        ) : null}
      </header>

      {read.status === "loading" ? (
        <p
          className="flex items-center gap-2 text-sm text-muted-foreground"
          role="status"
        >
          <LoaderCircle aria-hidden className="size-4 animate-spin" />
          Reading your seat
        </p>
      ) : read.status === "error" ? (
        <>
          <div className="flex items-start gap-2 text-sm" role="alert">
            <CircleAlert
              aria-hidden
              className="mt-0.5 size-4 shrink-0 text-destructive"
            />
            <div className="space-y-2">
              <p>{read.error}</p>
              <Button size="sm" variant="outline" onClick={() => void load()}>
                Try again
              </Button>
            </div>
          </div>
          {/* Alerts read on their own, so a seat can still set them. */}
          <AlertRules />
        </>
      ) : (
        <>
          {options.length > 1 ? (
            // A wrapper takes space-y-6's 24px; the row's own -my-1 would
            // beat it and pull the card below into the pills.
            <div>
              <FilterChips
                options={options}
                value={tab}
                ariaLabel="Settings"
                onChange={k => {
                  const p = new URLSearchParams(params);
                  p.set("tab", k);
                  setParams(p);
                }}
              />
            </div>
          ) : null}
          {tab === "types" ? (
            <RequestTypes
              read={read.data}
              onRead={data => setRead({ status: "ready", data })}
              reload={load}
            />
          ) : tab === "people" ? (
            <SeatLinks />
          ) : (
            <AlertRules />
          )}
        </>
      )}
    </div>
  );
}
