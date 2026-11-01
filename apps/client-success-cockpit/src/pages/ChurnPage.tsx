import { Check, Loader2, Pencil, Plus, X } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import {
  Chip,
  Kicker,
  PageHeader,
  SectionCard,
  StatTile,
} from "@/components/kit";
import { RequestForm } from "@/components/tasks/RequestForm";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { FormSheet } from "@/forms/staff/FormSheet";
import { FORM_DEFS } from "@/forms/staff/formDefs";
import {
  answerNotice,
  confirmChurn,
  type Doors,
  formDoors,
  formPrefill,
  formTrail,
  matchLegacy,
  NO_DOORS,
} from "@/forms/staff/lifecycleClient";
import type {
  NoticeRow,
  ChurnPage as Page,
  PickClient,
  StoppedRow,
  Waiting,
} from "@/lib/churnClient";
import { changeChurn, readChurnPage } from "@/lib/churnClient";
import {
  answerProblem,
  CHURN_TYPE_WORDS,
  cardLine,
  confirmLine,
  confirmPrefill,
  countsAs,
  type Departure,
  daysIn,
  type MonthRow,
  mergePrefill,
  monthName,
  PROGRAMME_DAYS,
  type PrefillLine,
  SURVEY_WORDS,
  TARGET_PCT,
  typeNote,
  verdictLine,
} from "@/lib/churnCore";
import { plural, shortDay } from "@/lib/format";
import { readRequestTypes } from "@/lib/requestsClient";
import { cn } from "@/lib/utils";

/**
 * The churn tracker (the CEO, 2026-10-01): mahara-context's churn sheet,
 * inside the cockpit. One row per client who left, logged the day it
 * happens; two numbers typed a month; the rest worked out (lib/churnCore).
 * It replaces the Churn Tracker 2026 sheet, whose months are brought in.
 *
 * The confirm (docs/forms/WAVE12-CONTRACT.md 4.5, 5.5): every logged row,
 * every termination survey and every card that reads Stopped without a
 * departure gets "Confirm churn", which opens the shared FormSheet and
 * writes the card through one audited function. Each row then says where
 * it stands: confirmed (teal ring) or logged (amber), and the card's state.
 * The doors show only once cockpit_form_doors says their functions exist.
 */

/** Who the confirm sheet is open for, and what the tracker already knows. */
type ConfirmTarget = {
  taskId: string;
  name: string;
  /** "Stopped · left 18 Oct", beside the client's name in the sheet. */
  status: string;
  local: PrefillLine[];
  surveyResponseId: string | null;
};
type PrefillState = {
  loading: boolean;
  prefill: PrefillLine[];
  calls: { id: string; at: string; kind: string; source: string }[];
  hints: PrefillLine[];
  error: string | null;
};
type TicketTarget = {
  type: string;
  label: string;
  client: { taskId: string; name: string };
  details: string;
};

const field =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm";

/** What a refused call says, in the words the server wrote. */
function errorText(e: unknown): string {
  const data = (e as { data?: unknown } | null)?.data;
  if (typeof data === "string") return data;
  if (data && typeof (data as { message?: unknown }).message === "string")
    return (data as { message: string }).message;
  const raw = e instanceof Error ? e.message : String(e);
  const m = raw.match(/Uncaught Error: ([\s\S]*?)(?:\n\s+at |$)/);
  return (
    (m ? m[1] : raw).trim().slice(0, 300) ||
    "That did not save, so nothing changed. Try again in a minute."
  );
}

const pct = (n: number | null) => (n === null ? "Not yet" : `${n.toFixed(1)}%`);
const usd = (n: number | null) =>
  n === null ? "" : `$${Math.round(n).toLocaleString("en-US")}`;

type Draft = {
  id?: number;
  client: string;
  clickupTaskId: string | null;
  leftOn: string;
  launchedOn: string;
  reason: string;
  mrrLostUsd: string;
  csm: string;
  note: string;
};

export function ChurnPage({ embedded = false }: { embedded?: boolean }) {
  const { client, session } = useCockpitAuth();
  const load = useCallback(
    () => readChurnPage(client),
    [client, session?.user.id],
  );
  const { saveDeparture, removeDeparture, saveMonth, dismiss } = useMemo(
    () => ({
      saveDeparture: (args: Record<string, unknown>) =>
        changeChurn(client, "saveDeparture", args),
      removeDeparture: (args: Record<string, unknown>) =>
        changeChurn(client, "removeDeparture", args),
      saveMonth: (args: Record<string, unknown>) =>
        changeChurn(client, "saveMonth", args),
      dismiss: (args: Record<string, unknown>) =>
        changeChurn(client, "dismiss", args),
    }),
    [client, session?.user.id],
  );
  const scope = session?.user.id ?? "";
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [loaded, setLoaded] = useState<{ scope: string; page: Page } | null>(
    null,
  );
  const page = loaded?.scope === scope ? loaded.page : null;
  const setPage = useCallback(
    (next: Page | null) => {
      if (currentScope.current === scope)
        setLoaded(next ? { scope, page: next } : null);
    },
    [scope],
  );
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  // The doors of 20261101o: closed until cockpit_form_doors says they exist.
  const [doors, setDoors] = useState<Doors>(NO_DOORS);
  // The request types this seat may raise, so a ticket button shows only once its type exists (D-R1).
  const [ticketTypes, setTicketTypes] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [confirming, setConfirming] = useState<ConfirmTarget | null>(null);
  const [opened, setOpened] = useState(0);
  const [prefill, setPrefill] = useState<PrefillState | null>(null);
  const [ticket, setTicket] = useState<TicketTarget | null>(null);

  useEffect(() => {
    if (!client) return;
    let live = true;
    void formDoors(client).then(d => {
      if (live) setDoors(d);
    });
    return () => {
      live = false;
    };
  }, [client, session?.user.id]);

  useEffect(() => {
    if (!client || !doors.churnConfirm) return;
    let live = true;
    readRequestTypes(client)
      .then(t => {
        if (live)
          setTicketTypes(
            new Map(t.types.filter(x => x.enabled).map(x => [x.key, x.label])),
          );
      })
      .catch(() => {
        // No catalogue, no ticket buttons: the rest of the tracker works.
      });
    return () => {
      live = false;
    };
  }, [client, doors.churnConfirm]);

  /** Opens the confirm sheet; the server's prefill is read once per open. */
  const openConfirm = useCallback(
    (t: ConfirmTarget) => {
      setConfirming(t);
      setOpened(n => n + 1);
      if (!client || !doors.prefill) {
        setPrefill({
          loading: false,
          prefill: [],
          calls: [],
          hints: [],
          error: null,
        });
        return;
      }
      setPrefill({
        loading: true,
        prefill: [],
        calls: [],
        hints: [],
        error: null,
      });
      formPrefill(client, "churn_confirm", t.taskId)
        .then(r =>
          setPrefill({
            loading: false,
            prefill: r.prefill,
            calls: r.calls,
            hints: r.hints,
            error: null,
          }),
        )
        .catch(e =>
          setPrefill({
            loading: false,
            prefill: [],
            calls: [],
            hints: [],
            error: `${errorText(e)} The form still works: fill it by hand.`,
          }),
        );
    },
    [client, doors.prefill],
  );

  const refresh = useCallback(async () => {
    try {
      setPage(await load());
      if (currentScope.current === scope) setError(null);
    } catch (e) {
      if (currentScope.current === scope) setError(errorText(e));
    }
  }, [load, scope, setPage]);

  useEffect(() => {
    setPage(null);
    setDraft(null);
    setError(null);
    void refresh();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 60_000);
    return () => clearInterval(t);
  }, [refresh, setPage]);

  /** Run a change; the server answers with the page as it now is. */
  const act = async (fn: () => Promise<Page>) => {
    try {
      setPage(await fn());
      if (currentScope.current === scope) setError(null);
    } catch (e) {
      if (currentScope.current === scope) setError(errorText(e));
      throw e;
    }
  };

  const openDraft = (d: Draft) => {
    setDraft(d);
    requestAnimationFrame(() =>
      document
        .getElementById("churn-form")
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };

  if (!page)
    return (
      <div
        className={
          embedded ? "space-y-6" : "mx-auto w-full max-w-6xl space-y-6"
        }
      >
        <PageHeader
          as={embedded ? "h2" : "h1"}
          title="Churn tracker"
          sub="A client lost before day 90 is churn. A client who finishes the term is not, renewed or not."
        />
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Reading the
            register
          </p>
        )}
      </div>
    );

  const current = page.months.find(m => m.month === page.month) ?? null;
  const blank = (): Draft => ({
    client: "",
    clickupTaskId: null,
    leftOn: page.today,
    launchedOn: "",
    reason: "",
    mrrLostUsd: "",
    csm: "",
    note: "",
  });

  return (
    <div
      className={embedded ? "space-y-6" : "mx-auto w-full max-w-6xl space-y-6"}
    >
      <PageHeader
        as={embedded ? "h2" : "h1"}
        title="Churn tracker"
        sub="A client lost before day 90 is churn. A client who finishes the term is not, renewed or not."
        actions={
          <Button onClick={() => openDraft(blank())}>
            <Plus aria-hidden /> Log a departure
          </Button>
        }
      >
        {doors.churnConfirm ? null : (
          <p className="mt-2 text-xs text-muted-foreground">
            Confirm churn opens after the next cockpit update.
          </p>
        )}
      </PageHeader>

      {draft ? (
        <DepartureForm
          key={draft.id ?? "new"}
          draft={draft}
          page={page}
          onCancel={() => setDraft(null)}
          onSave={async d => {
            await act(() =>
              saveDeparture({
                ...(d.id ? { id: d.id } : {}),
                client: d.client,
                clickupTaskId: d.clickupTaskId,
                leftOn: d.leftOn,
                launchedOn: d.launchedOn || null,
                reason: d.reason,
                mrrLostUsd: d.mrrLostUsd.trim() ? Number(d.mrrLostUsd) : null,
                csm: d.csm || null,
                note: d.note || null,
              }),
            );
            toast.success(d.id ? "Saved" : `Logged ${d.client}`);
            setDraft(null);
          }}
          onRemove={
            draft.id && page.me.canRemove
              ? async why => {
                  await act(() =>
                    removeDeparture({ id: draft.id as number, why }),
                  );
                  toast.success("Taken out of the register");
                  setDraft(null);
                }
              : null
          }
        />
      ) : null}

      {doors.churnConfirm && page.notices.length ? (
        <NoticeBand
          notices={page.notices}
          ticketLabel={ticketTypes.get("client_notice") ?? null}
          onConfirm={n =>
            openConfirm({
              taskId: n.taskId as string,
              name: n.clientName,
              status: `Termination survey ${shortDay(n.noticeOn ?? n.submittedAt)}`,
              local: noticePrefill(n, page),
              surveyResponseId: n.responseId,
            })
          }
          onAnswer={async (n, note) => {
            if (!client) throw new Error("Client-success sign-in is required");
            await answerNotice(client, n.responseId, "staying", note);
            toast.success("Saved");
            await refresh();
          }}
          onTicket={(n, label) =>
            setTicket({
              type: "client_notice",
              label,
              client: { taskId: n.taskId as string, name: n.clientName },
              details: `${n.clientName} sent the termination survey on ${shortDay(n.noticeOn ?? n.submittedAt)}.`,
            })
          }
        />
      ) : null}

      {doors.churnConfirm && page.unmatched.length ? (
        <UnmatchedBand
          rows={page.unmatched}
          clients={page.clients}
          onPick={async (n, c) => {
            if (!client) throw new Error("Client-success sign-in is required");
            await matchLegacy(client, n.responseId, c.key);
            toast.success(`Matched to ${c.name}`);
            await refresh();
          }}
        />
      ) : null}

      {current ? (
        <ThisMonth
          row={current}
          page={page}
          onSave={(month, f) => act(() => saveMonth({ month, ...f }))}
        />
      ) : null}

      {page.waiting.length ? (
        <WaitingList
          items={page.waiting}
          onLog={w =>
            openDraft({
              client: w.client,
              clickupTaskId: w.clickupTaskId,
              leftOn: w.leftOn,
              launchedOn: w.launchedOn ?? "",
              reason: w.reason ?? "",
              mrrLostUsd: w.mrrLostUsd === null ? "" : String(w.mrrLostUsd),
              csm: w.csm ?? "",
              note: "",
            })
          }
          onDismiss={(w, why) =>
            act(() =>
              dismiss({ key: w.key, leftOn: w.leftOn, client: w.client, why }),
            )
          }
        />
      ) : null}

      <Register
        departures={page.departures}
        canConfirm={doors.churnConfirm}
        onConfirm={d =>
          d.clickupTaskId
            ? openConfirm({
                taskId: d.clickupTaskId,
                name: d.client,
                status: `Logged · left ${shortDay(d.leftOn)}`,
                local: confirmPrefill({
                  leftOn: d.leftOn,
                  reason: d.reason,
                  mrrLostUsd: d.mrrLostUsd,
                  churnType: d.confirm?.churnType ?? null,
                  typeDefault: d.confirm?.typeDefault ?? null,
                  survey: d.confirm?.surveyResponseId
                    ? {
                        noticeOn: d.confirm.noticeOn,
                        dayWords: shortDay(d.confirm.noticeOn) || "on file",
                      }
                    : null,
                }),
                surveyResponseId: d.confirm?.surveyResponseId ?? null,
              })
            : openDraft(draftOf(d))
        }
        onEdit={d => openDraft(draftOf(d))}
        onAdd={() => openDraft(blank())}
      />

      {doors.churnConfirm && page.stopped.length ? (
        <StoppedBand
          rows={page.stopped}
          onConfirm={r =>
            openConfirm({
              taskId: r.taskId,
              name: r.clientName,
              status: r.churnDate
                ? `Stopped · churn date ${shortDay(r.churnDate)}`
                : "Stopped · no churn date on the card",
              local: confirmPrefill({
                leftOn: r.churnDate,
                leftOnFrom: "card",
                mrrLostUsd: r.mrrUsd,
                mrrFrom: "card",
                typeDefault: r.typeDefault,
              }),
              surveyResponseId: null,
            })
          }
        />
      ) : null}

      <Months
        rows={page.months}
        onSave={(month, f) => act(() => saveMonth({ month, ...f }))}
      />

      <Rules />
      <Changes log={page.log} />

      {confirming && client ? (
        <FormSheet
          key={`${confirming.taskId}:${opened}`}
          open
          onOpenChange={o => {
            if (!o) setConfirming(null);
          }}
          def={FORM_DEFS.churn_confirm}
          client={{ taskId: confirming.taskId, name: confirming.name }}
          status={confirming.status}
          prefill={mergePrefill(prefill?.prefill ?? [], confirming.local)}
          calls={prefill?.calls ?? []}
          hints={prefill?.hints ?? []}
          loading={prefill?.loading ?? false}
          prefillError={prefill?.error ?? null}
          submit={async (a, requestId) => {
            const r = await confirmChurn(
              client,
              confirming.taskId,
              a,
              requestId,
              {
                source: page.me.isCeo ? "ceo" : "csm",
                surveyResponseId: confirming.surveyResponseId,
              },
            );
            return { message: r.message, ref: r.ref };
          }}
          trail={ref => formTrail(client, ref)}
          onTicket={
            ticketTypes.has("client_offboarding")
              ? type =>
                  setTicket({
                    type,
                    label: ticketTypes.get(type) ?? "Offboarding",
                    client: {
                      taskId: confirming.taskId,
                      name: confirming.name,
                    },
                    details: `${confirming.name} is leaving: churn confirmed in the cockpit.`,
                  })
              : undefined
          }
          onSent={() => void refresh()}
        />
      ) : null}

      <Sheet
        open={ticket !== null}
        onOpenChange={o => {
          if (!o) setTicket(null);
        }}
      >
        <SheetContent
          side="right"
          className="w-full overflow-y-auto sm:max-w-xl"
        >
          <SheetHeader>
            <SheetTitle>
              {ticket ? (
                <>
                  {ticket.label}: <bdi>{ticket.client.name}</bdi>
                </>
              ) : null}
            </SheetTitle>
            <SheetDescription>
              The ticket reaches task alerts and Your tasks like any other.
            </SheetDescription>
          </SheetHeader>
          {ticket ? (
            <div className="mt-4">
              <RequestForm
                source="client_page"
                presetClient={ticket.client}
                presetType={ticket.type}
                presetDetails={ticket.details}
                compact
              />
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** A register row as the correction form takes it. */
function draftOf(d: Departure): Draft {
  return {
    id: d.id,
    client: d.client,
    clickupTaskId: d.clickupTaskId,
    leftOn: d.leftOn,
    launchedOn: d.launchedOn ?? "",
    reason: d.reason,
    mrrLostUsd: d.mrrLostUsd === null ? "" : String(d.mrrLostUsd),
    csm: d.csm ?? "",
    note: d.note ?? "",
  };
}

/** A survey's answers for the confirm: its logged departure when there is one, else the card. */
function noticePrefill(n: NoticeRow, page: Page): PrefillLine[] {
  const dep = page.departures.find(
    d =>
      d.id === n.departureId ||
      (d.clickupTaskId === n.taskId && !d.confirm?.confirmedAt),
  );
  const card = page.clients.find(c => c.key === n.taskId);
  const survey = {
    noticeOn: n.noticeOn,
    dayWords: shortDay(n.noticeOn ?? n.submittedAt) || "on file",
  };
  return dep
    ? confirmPrefill({
        leftOn: dep.leftOn,
        reason: dep.reason,
        mrrLostUsd: dep.mrrLostUsd,
        typeDefault: dep.confirm?.typeDefault ?? n.typeDefault,
        survey,
      })
    : confirmPrefill({
        mrrLostUsd: card?.mrrUsd ?? null,
        mrrFrom: "card",
        typeDefault: n.typeDefault,
        survey,
      });
}

// --- this month ----------------------------------------------------------------------

function ThisMonth({
  row,
  page,
  onSave,
}: {
  row: MonthRow;
  page: Page;
  onSave: (
    month: string,
    f: { activeAtStart?: number | null; newClients?: number | null },
  ) => Promise<void>;
}) {
  const start = page.starts.find(s => s.month === row.month);
  const launched = page.launches.find(l => l.month === row.month)?.names ?? [];
  const band = row.band;
  return (
    <section
      className="rounded-2xl border bg-card"
      aria-labelledby="this-month"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 sm:px-6 sm:pt-6">
        <h2 id="this-month" className="text-[15px] font-semibold">
          {monthName(row.month)}
        </h2>
        {band ? <Chip tone={band.tone}>{band.label}</Chip> : null}
      </div>
      <div className="flex flex-wrap items-end gap-x-10 gap-y-3 px-4 pt-3 sm:px-6">
        <div>
          <div
            className={cn(
              "whitespace-nowrap text-4xl font-semibold tracking-tight tabular-nums",
              row.rolling3Pct === null
                ? "text-muted-foreground"
                : row.rolling3Pct <= TARGET_PCT
                  ? "txt-good"
                  : "txt-bad",
            )}
          >
            {pct(row.rolling3Pct)}
          </div>
          <div className="text-xs text-muted-foreground">
            Churn over the last three months
            {row.rolling3Pct !== null && row.rolling3Months < 3
              ? ` (only ${row.rolling3Months} of them have a start figure)`
              : ""}{" "}
            · target under {TARGET_PCT}%
          </div>
        </div>
        <div className="pb-1 text-sm">
          {row.running ? "This month to date" : "This month"}{" "}
          <span className="font-semibold tabular-nums">
            {pct(row.churnPct)}
          </span>
          <span className="text-muted-foreground">
            {row.activeAtStart
              ? ` · ${row.churned} of ${row.activeAtStart} active at the start`
              : ""}
          </span>
          {row.registerShort > 0 ? (
            <div className="text-xs txt-warn">
              The old sheet counted {row.registerShort} more lost this month
              than the register holds. Log the missing departures.
            </div>
          ) : null}
        </div>
      </div>
      <div className="@container px-4 pb-4 pt-4 sm:px-6 sm:pb-6">
        <div className="grid grid-cols-2 gap-3 @md:grid-cols-3 @3xl:grid-cols-6">
          <StatTile
            plain
            label="Active at the start"
            value={
              <NumberCell
                value={row.activeAtStart}
                label={`Active clients at the start of ${monthName(row.month)}`}
                onSave={n => onSave(row.month, { activeAtStart: n })}
              />
            }
            sub={
              row.startCarried ? (
                "Carried from last month"
              ) : row.activeAtStart === null &&
                start?.paying !== null &&
                start?.paying !== undefined ? (
                <Suggest
                  onUse={() =>
                    onSave(row.month, { activeAtStart: start?.paying ?? null })
                  }
                >
                  Use {start?.paying}, the roster on {shortDay(start?.day)}
                </Suggest>
              ) : row.activeAtStart === null ? (
                "Type it once"
              ) : (
                "Typed"
              )
            }
          />
          <StatTile
            plain
            label="New clients"
            value={
              <NumberCell
                value={row.newClients}
                label={`New clients in ${monthName(row.month)}`}
                onSave={n => onSave(row.month, { newClients: n })}
              />
            }
            sub={
              row.newClients === null && launched.length ? (
                <Suggest
                  onUse={() =>
                    onSave(row.month, { newClients: launched.length })
                  }
                >
                  Use {launched.length}, launched this month
                </Suggest>
              ) : row.newClients === null ? (
                "Type it at month end"
              ) : (
                "Typed"
              )
            }
          />
          <StatTile
            plain
            label="Churned"
            value={row.churned}
            sub="Left before day 90"
            tone={row.churned ? "txt-bad" : undefined}
          />
          <StatTile
            plain
            label="Finished the term"
            value={row.completed}
            sub="Day 90 or later"
          />
          <StatTile
            plain
            label="Active at the end"
            value={row.activeAtEnd ?? "Not yet"}
            sub="Start + new − left"
          />
          <StatTile
            plain
            label="Net growth"
            value={
              row.netGrowth === null
                ? "Not yet"
                : `${row.netGrowth > 0 ? "+" : ""}${row.netGrowth}`
            }
            sub="New − left"
          />
        </div>
        {row.unknown ? (
          <p className="mt-3 text-sm txt-warn">
            {plural(row.unknown, "departure")} this month{" "}
            {row.unknown === 1 ? "has" : "have"} no launch date, so{" "}
            {row.unknown === 1 ? "it does" : "they do"} not count either way
            yet. Open {row.unknown === 1 ? "it" : "them"} below and add one.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function Suggest({
  children,
  onUse,
}: {
  children: ReactNode;
  onUse: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onUse();
        } catch {
          // The page shows the error.
        } finally {
          setBusy(false);
        }
      }}
      className="text-left text-primary underline-offset-2 hover:underline disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/** A count that turns into a field when clicked; Enter or leaving it saves, Escape puts it back. */
function NumberCell({
  value,
  label,
  onSave,
  className,
}: {
  value: number | null;
  label: string;
  onSave: (n: number | null) => Promise<void>;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value === null ? "" : String(value));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!editing) setText(value === null ? "" : String(value));
  }, [value, editing]);
  const save = async () => {
    const t = text.trim();
    const n = t === "" ? null : Number(t);
    if (n === value || (n !== null && (!Number.isInteger(n) || n < 0))) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await onSave(n);
      setEditing(false);
    } catch {
      // The page shows the error; the number stays for another try.
    } finally {
      setBusy(false);
    }
  };
  if (!editing)
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`${label}: ${value ?? "not set"}. Edit`}
        className={cn(
          "group inline-flex items-center gap-1.5 rounded-md text-left tabular-nums underline-offset-4 decoration-muted-foreground/40 hover:underline",
          value === null ? "text-muted-foreground" : "",
          className,
        )}
      >
        {value ?? "Add"}
        <Pencil
          className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 pointer-coarse:opacity-100"
          aria-hidden
        />
      </button>
    );
  return (
    <span className="inline-flex items-center gap-1">
      <input
        // biome-ignore lint/a11y/noAutofocus: opened by a click on the number itself
        autoFocus
        inputMode="numeric"
        value={text}
        disabled={busy}
        aria-label={label}
        onChange={e => setText(e.target.value.replace(/[^\d]/g, ""))}
        onBlur={() => void save()}
        onKeyDown={e => {
          if (e.key === "Enter") {
            e.preventDefault();
            void save();
          }
          if (e.key === "Escape") setEditing(false);
        }}
        className="h-9 w-20 rounded-md border border-input bg-background px-2 text-base font-semibold tabular-nums focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      {busy ? (
        <Loader2
          className="size-4 animate-spin text-muted-foreground"
          aria-hidden
        />
      ) : null}
    </span>
  );
}

// --- logging a departure --------------------------------------------------------------

function DepartureForm({
  draft,
  page,
  onCancel,
  onSave,
  onRemove,
}: {
  draft: Draft;
  page: Page;
  onCancel: () => void;
  onSave: (d: Draft) => Promise<void>;
  onRemove: ((why: string) => Promise<void>) | null;
}) {
  const [d, setD] = useState<Draft>(draft);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [why, setWhy] = useState("");
  const ids = useId();
  const set = (patch: Partial<Draft>) => setD(x => ({ ...x, ...patch }));

  /** Picking a known client fills what the cockpit already knows about them. */
  const pick = (name: string) => {
    const c: PickClient | undefined = page.clients.find(
      x => x.name.toLowerCase() === name.trim().toLowerCase(),
    );
    if (!c) {
      set({ client: name, clickupTaskId: null });
      return;
    }
    set({
      client: c.name,
      clickupTaskId: c.key,
      launchedOn: d.launchedOn || c.launchedOn || "",
      csm: d.csm || c.csm || "",
      mrrLostUsd: d.mrrLostUsd || (c.mrrUsd === null ? "" : String(c.mrrUsd)),
    });
  };

  const verdict = d.leftOn
    ? {
        kind: countsAs({ leftOn: d.leftOn, launchedOn: d.launchedOn || null }),
        line: verdictLine({
          leftOn: d.leftOn,
          launchedOn: d.launchedOn || null,
        }),
      }
    : null;
  const ready = d.client.trim() && d.leftOn && d.reason;

  return (
    <form
      id="churn-form"
      className="scroll-mt-6 rounded-2xl border bg-card p-4 sm:p-6"
      onSubmit={async e => {
        e.preventDefault();
        if (!ready) return;
        setBusy(true);
        try {
          await onSave(d);
        } catch {
          // The page shows the error; the form keeps what was typed.
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-[15px] font-semibold">
          {d.id ? `Correct ${draft.client}` : "Log a departure"}
        </h2>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close"
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:size-10"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="grid gap-1 sm:col-span-2">
          <label
            htmlFor={`${ids}-client`}
            className="text-xs font-medium text-muted-foreground"
          >
            Client
          </label>
          <Input
            id={`${ids}-client`}
            value={d.client}
            onChange={e => pick(e.target.value)}
            list="churn-clients"
            placeholder="Start typing a client"
            dir="auto"
            autoComplete="off"
          />
          <datalist id="churn-clients">
            {page.clients.map(c => (
              <option key={c.key} value={c.name} />
            ))}
          </datalist>
        </div>
        <div className="grid gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            Left on
          </span>
          <DateInput
            value={d.leftOn}
            max={page.today}
            onChange={e => set({ leftOn: e.target.value })}
            aria-label="Left on"
          />
        </div>
        <div className="grid gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            Launched on
          </span>
          <DateInput
            value={d.launchedOn}
            max={d.leftOn || page.today}
            onChange={e => set({ launchedOn: e.target.value })}
            aria-label="Launched on"
          />
        </div>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground sm:col-span-2">
          Why they left
          <select
            value={d.reason}
            onChange={e => set({ reason: e.target.value })}
            className={field}
          >
            <option value="" disabled>
              Pick one
            </option>
            {page.reasons.map(r => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-1">
          <label
            htmlFor={`${ids}-mrr`}
            className="text-xs font-medium text-muted-foreground"
          >
            Monthly value lost ($)
          </label>
          <Input
            id={`${ids}-mrr`}
            value={d.mrrLostUsd}
            onChange={e =>
              set({ mrrLostUsd: e.target.value.replace(/[^\d.]/g, "") })
            }
            inputMode="decimal"
            placeholder="0"
          />
        </div>
        <div className="grid gap-1">
          <label
            htmlFor={`${ids}-csm`}
            className="text-xs font-medium text-muted-foreground"
          >
            CSM
          </label>
          <Input
            id={`${ids}-csm`}
            value={d.csm}
            onChange={e => set({ csm: e.target.value })}
            placeholder="Who looked after them"
          />
        </div>
        <div className="grid gap-1 sm:col-span-2 lg:col-span-4">
          <label
            htmlFor={`${ids}-note`}
            className="text-xs font-medium text-muted-foreground"
          >
            Note
          </label>
          <Textarea
            id={`${ids}-note`}
            value={d.note}
            onChange={e => set({ note: e.target.value })}
            rows={2}
            placeholder="What happened, in a sentence. Optional."
            className="resize-none"
            dir="auto"
          />
        </div>
      </div>
      {verdict ? (
        <p className="mt-4 flex items-center gap-2 text-sm">
          <Chip
            tone={
              verdict.kind === "churn"
                ? "bad"
                : verdict.kind === "completed"
                  ? "neutral"
                  : "warn"
            }
          >
            {verdict.kind === "churn"
              ? "Churn"
              : verdict.kind === "completed"
                ? "Finished the term"
                : "Needs a launch date"}
          </Chip>
          <span className="text-muted-foreground">{verdict.line}</span>
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={busy || !ready}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {d.id ? "Save changes" : "Log it"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <span className="flex-1" />
        {onRemove ? (
          removing ? (
            <span className="flex flex-wrap items-center gap-2">
              <Input
                value={why}
                onChange={e => setWhy(e.target.value)}
                placeholder="Why it comes out"
                className="h-8 w-56 text-sm"
                aria-label="Why it comes out of the register"
              />
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={busy || why.trim().length < 4}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onRemove(why);
                  } catch {
                    // The page shows the error.
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Take it out
              </Button>
            </span>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => setRemoving(true)}
            >
              Take out of the register
            </Button>
          )
        ) : null}
      </div>
    </form>
  );
}

// --- waiting to be logged -------------------------------------------------------------

function WaitingList({
  items,
  onLog,
  onDismiss,
}: {
  items: Waiting[];
  onLog: (w: Waiting) => void;
  onDismiss: (w: Waiting, why: string) => Promise<void>;
}) {
  return (
    <section className="rounded-2xl border bg-card" aria-labelledby="waiting">
      <div className="px-4 pt-4 sm:px-6 sm:pt-5">
        <h2 id="waiting" className="text-[15px] font-semibold">
          Not in the register yet
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          ClickUp and the daily roster say these clients left. Log each one, or
          say it was not a departure.
        </p>
      </div>
      <ul className="mt-3 divide-y border-t">
        {items.map(w => (
          <WaitingRow key={w.key} w={w} onLog={onLog} onDismiss={onDismiss} />
        ))}
      </ul>
    </section>
  );
}

function WaitingRow({
  w,
  onLog,
  onDismiss,
}: {
  w: Waiting;
  onLog: (w: Waiting) => void;
  onDismiss: (w: Waiting, why: string) => Promise<void>;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
      <div className="min-w-0 flex-1">
        <div className="font-medium">
          <bdi>{w.client}</bdi>
        </div>
        <div className="text-xs text-muted-foreground">
          Left {shortDay(w.leftOn)} · {w.why}
        </div>
      </div>
      {asking ? (
        <span className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Not a departure?</span>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onDismiss(w, "");
              } catch {
                // The page shows the error.
              } finally {
                setBusy(false);
              }
            }}
          >
            <Check aria-hidden /> Yes, hide it
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
            Keep
          </Button>
        </span>
      ) : (
        <span className="flex items-center gap-1">
          <Button size="sm" onClick={() => onLog(w)}>
            Log it
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => setAsking(true)}
          >
            Not a departure
          </Button>
        </span>
      )}
    </li>
  );
}

// --- the register -------------------------------------------------------------------

/** Where in the 90 days they left: a slim track, the marker at their day. */
function TermBar({ days }: { days: number | null }) {
  if (days === null)
    return (
      <span
        className="block h-1.5 w-16 rounded-full border border-dashed border-warning/60"
        aria-hidden
      />
    );
  const at = Math.min(days, PROGRAMME_DAYS) / PROGRAMME_DAYS;
  const churn = days < PROGRAMME_DAYS;
  return (
    <span
      className="relative block h-1.5 w-16 rounded-full bg-muted"
      aria-hidden
    >
      <span
        className={cn(
          "absolute inset-y-0 left-0 rounded-full",
          churn ? "bg-destructive/70" : "bg-primary/70",
        )}
        style={{ width: `${at * 100}%` }}
      />
    </span>
  );
}

/** Confirmed: a filled teal ring. Logged, not confirmed: a hollow amber one (5.5). */
function ConfirmRing({ confirmed }: { confirmed: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-2.5 shrink-0 rounded-full border-2",
        confirmed
          ? "border-primary bg-primary"
          : "border-warning bg-transparent",
      )}
    />
  );
}

const CARD_INK = {
  good: "text-foreground",
  warn: "txt-warn",
  bad: "text-destructive",
  neutral: "text-muted-foreground",
} as const;

/** "Confirm churn": the destructive act, quiet until pressed. */
function ConfirmButton({
  onClick,
  label = "Confirm churn",
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={onClick}
      className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
    >
      {label}
    </Button>
  );
}

function Register({
  departures,
  canConfirm,
  onConfirm,
  onEdit,
  onAdd,
}: {
  departures: Departure[];
  canConfirm: boolean;
  onConfirm: (d: Departure) => void;
  onEdit: (d: Departure) => void;
  onAdd: () => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? departures : departures.slice(0, 50);
  const waiting = departures.filter(
    d => d.confirm && !d.confirm.confirmedAt,
  ).length;
  return (
    <section className="rounded-2xl border bg-card" aria-labelledby="register">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pt-4 sm:px-6 sm:pt-5">
        <div className="min-w-0">
          <h2 id="register" className="text-[15px] font-semibold">
            Departures
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {departures.length
              ? `${plural(departures.length, "client")} logged${canConfirm && waiting ? ` · ${waiting} not confirmed` : ""} · click a client to correct the row`
              : ""}
          </p>
        </div>
        {canConfirm ? (
          <div className="flex flex-col items-start gap-1 sm:items-end">
            <Button type="button" size="sm" variant="outline" disabled>
              Send exit survey
            </Button>
            <span className="text-xs text-muted-foreground">
              Client forms arrive with the portal (wave 3).
            </span>
          </div>
        ) : null}
      </div>
      {departures.length ? (
        <ul className="mt-3 divide-y border-t">
          {shown.map(d => {
            const n = daysIn(d);
            const kind = countsAs(d);
            const c = d.confirm;
            const status = c
              ? confirmLine(c, shortDay)
              : { confirmed: false, line: "" };
            const card = c ? cardLine(c.cardState, c.cardError) : null;
            const note = c
              ? typeNote({
                  leftOn: d.leftOn,
                  launchedOn: d.launchedOn,
                  churnType: c.churnType,
                })
              : null;
            return (
              <li
                key={d.id}
                className="grid gap-x-6 gap-y-2 px-4 py-3 transition-colors hover:bg-muted/30 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-6"
              >
                <button
                  type="button"
                  onClick={() => onEdit(d)}
                  className="min-w-0 rounded-md text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium">
                      <bdi>{d.client}</bdi>
                    </span>
                    <Chip
                      tone={
                        kind === "churn"
                          ? "bad"
                          : kind === "completed"
                            ? "neutral"
                            : "warn"
                      }
                    >
                      {kind === "churn"
                        ? `Churn · day ${n}`
                        : kind === "completed"
                          ? `Finished the term · day ${n}`
                          : "Needs a launch date"}
                    </Chip>
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Left {shortDay(d.leftOn)}
                    {d.launchedOn
                      ? ` · launched ${shortDay(d.launchedOn)}`
                      : ""}
                    {` · ${d.reason}`}
                    {d.csm ? ` · ${d.csm}` : ""}
                    {d.note ? ` · ${d.note}` : ""}
                  </span>
                  {c?.confirmedAt && c.whyDetail ? (
                    <span
                      className="mt-0.5 line-clamp-1 block text-xs text-muted-foreground"
                      dir="auto"
                    >
                      Why: {c.whyDetail}
                    </span>
                  ) : null}
                  {note ? (
                    <span className="mt-0.5 block text-xs txt-warn">
                      {note}
                    </span>
                  ) : null}
                </button>
                <span className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:justify-end">
                  {c && canConfirm ? (
                    <span className="flex min-w-0 max-w-[22rem] flex-col gap-0.5 sm:items-end sm:text-right">
                      <span className="flex items-center gap-1.5 text-xs font-medium">
                        <ConfirmRing confirmed={status.confirmed} />
                        <span className={status.confirmed ? "" : "txt-warn"}>
                          {status.line}
                        </span>
                      </span>
                      {status.confirmed && c.churnType ? (
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {CHURN_TYPE_WORDS[c.churnType]}
                          {c.surveyState
                            ? ` · ${SURVEY_WORDS[c.surveyState]}`
                            : ""}
                        </span>
                      ) : null}
                      {card ? (
                        <span
                          title={
                            card.line === card.short ? undefined : card.line
                          }
                          className={cn(
                            "font-mono text-[11px] leading-snug",
                            CARD_INK[card.tone],
                          )}
                        >
                          {card.short}
                          {card.line === card.short ? null : (
                            <span className="sr-only">. {card.line}</span>
                          )}
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                  {c && canConfirm && !c.confirmedAt ? (
                    <ConfirmButton onClick={() => onConfirm(d)} />
                  ) : null}
                  <TermBar days={n} />
                  <span className="w-16 text-right text-sm tabular-nums">
                    {usd(d.mrrLostUsd)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="px-4 pb-6 pt-3 sm:px-6">
          <p className="text-sm text-muted-foreground">
            Nobody is in the register yet. Log a client the day they leave, and
            the month below counts it.
          </p>
          <Button size="sm" variant="outline" className="mt-3" onClick={onAdd}>
            <Plus aria-hidden /> Log a departure
          </Button>
        </div>
      )}
      {departures.length > 50 ? (
        <button
          type="button"
          onClick={() => setAll(a => !a)}
          className="w-full border-t px-4 py-2.5 text-xs text-muted-foreground hover:text-foreground sm:px-6"
        >
          {all ? "Show the latest 50" : `Show all ${departures.length}`}
        </button>
      ) : null}
    </section>
  );
}

// --- notices, unmatched surveys and Stopped cards -------------------------------------------

/** The survey's ratings, numbers in Geist Mono with their question beside them. */
function Ratings({ ratings }: { ratings: NoticeRow["ratings"] }) {
  if (!ratings.length) return null;
  return (
    <span className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {ratings.map(r => (
        <span key={r.title} className="flex min-w-0 items-baseline gap-1.5">
          <span className="font-mono font-medium tabular-nums">{r.value}</span>
          <span
            className="max-w-[16rem] truncate text-muted-foreground"
            title={r.title}
          >
            {r.title}
          </span>
        </span>
      ))}
    </span>
  );
}

function NoticeBand({
  notices,
  ticketLabel,
  onConfirm,
  onAnswer,
  onTicket,
}: {
  notices: NoticeRow[];
  /** The client_notice type's label, or null while the type is not in the catalogue. */
  ticketLabel: string | null;
  onConfirm: (n: NoticeRow) => void;
  onAnswer: (n: NoticeRow, note: string) => Promise<void>;
  onTicket: (n: NoticeRow, label: string) => void;
}) {
  return (
    <SectionCard
      title="Notice in"
      count={notices.length}
      sub="These clients sent the termination survey. Confirm the churn, or say they are staying."
      flush
    >
      {notices.map(n => (
        <NoticeRowView
          key={n.responseId}
          n={n}
          ticketLabel={ticketLabel}
          onConfirm={onConfirm}
          onAnswer={onAnswer}
          onTicket={onTicket}
        />
      ))}
    </SectionCard>
  );
}

function NoticeRowView({
  n,
  ticketLabel,
  onConfirm,
  onAnswer,
  onTicket,
}: {
  n: NoticeRow;
  ticketLabel: string | null;
  onConfirm: (n: NoticeRow) => void;
  onAnswer: (n: NoticeRow, note: string) => Promise<void>;
  onTicket: (n: NoticeRow, label: string) => void;
}) {
  const [answering, setAnswering] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const ids = useId();
  const save = async () => {
    const p = answerProblem(note);
    setProblem(p);
    if (p) return;
    setBusy(true);
    try {
      await onAnswer(n, note.trim());
      setAnswering(false);
      setNote("");
    } catch (e) {
      setProblem(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="px-4 py-3 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="font-medium">
            <bdi>{n.clientName}</bdi>
          </div>
          <div className="text-xs text-muted-foreground">
            Sent the termination survey on{" "}
            <span className="font-mono">
              {shortDay(n.noticeOn ?? n.submittedAt) || "a day not recorded"}
            </span>
          </div>
          <Ratings ratings={n.ratings} />
        </div>
        {answering ? null : (
          <span className="flex flex-wrap items-center gap-1">
            <ConfirmButton onClick={() => onConfirm(n)} />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setAnswering(true)}
            >
              Not leaving
            </Button>
            {ticketLabel ? (
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground"
                onClick={() => onTicket(n, ticketLabel)}
              >
                Open the notice ticket
              </Button>
            ) : null}
          </span>
        )}
      </div>
      {answering ? (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={e => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="grid min-w-0 flex-1 gap-1">
            <label
              htmlFor={`${ids}-note`}
              className="text-xs font-medium text-muted-foreground"
            >
              What did the client say?
            </label>
            <Input
              id={`${ids}-note`}
              autoFocus
              value={note}
              dir="auto"
              disabled={busy}
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? `${ids}-problem` : undefined}
              onChange={e => setNote(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Escape") setAnswering(false);
              }}
              placeholder="They signed for the next campaign on the call"
            />
          </div>
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Save
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setAnswering(false)}
          >
            Cancel
          </Button>
          {problem ? (
            <p
              id={`${ids}-problem`}
              className="w-full text-xs text-destructive"
              role="alert"
            >
              {problem}
            </p>
          ) : (
            <p className="w-full text-xs text-muted-foreground">
              Nothing changes on the card. The notice leaves this list.
            </p>
          )}
        </form>
      ) : null}
    </div>
  );
}

function UnmatchedBand({
  rows,
  clients,
  onPick,
}: {
  rows: NoticeRow[];
  clients: PickClient[];
  onPick: (n: NoticeRow, c: PickClient) => Promise<void>;
}) {
  return (
    <SectionCard
      title="Termination surveys not matched to a card"
      count={rows.length}
      sub="These came without a card id, so the cockpit never guesses whose they are. Pick the card; you can pick only your own clients."
      flush
    >
      {rows.map(n => (
        <UnmatchedRow
          key={n.responseId}
          n={n}
          clients={clients}
          onPick={onPick}
        />
      ))}
    </SectionCard>
  );
}

function UnmatchedRow({
  n,
  clients,
  onPick,
}: {
  n: NoticeRow;
  clients: PickClient[];
  onPick: (n: NoticeRow, c: PickClient) => Promise<void>;
}) {
  const [picking, setPicking] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const ids = useId();
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
      <div className="min-w-0">
        <div className="font-medium">
          <bdi>{n.clientName}</bdi>
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            name from the form
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          Sent the termination survey on{" "}
          <span className="font-mono">
            {shortDay(n.noticeOn ?? n.submittedAt) || "a day not recorded"}
          </span>
        </div>
      </div>
      {picking ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={async e => {
            e.preventDefault();
            const c = clients.find(x => x.key === key);
            if (!c) {
              setProblem("Pick the client's card first.");
              return;
            }
            setBusy(true);
            try {
              await onPick(n, c);
              setPicking(false);
            } catch (err) {
              setProblem(errorText(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label htmlFor={`${ids}-card`} className="sr-only">
            The client's card
          </label>
          <select
            id={`${ids}-card`}
            value={key}
            onChange={e => setKey(e.target.value)}
            className={cn(field, "w-56")}
            disabled={busy}
          >
            <option value="" disabled>
              Pick the card
            </option>
            {clients.map(c => (
              <option key={c.key} value={c.key}>
                {c.name}
              </option>
            ))}
          </select>
          <Button type="submit" size="sm" disabled={busy || !key}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Match it
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setPicking(false)}
          >
            Cancel
          </Button>
          {problem ? (
            <p className="w-full text-xs text-destructive" role="alert">
              {problem}
            </p>
          ) : null}
        </form>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setPicking(true)}>
          Pick the card
        </Button>
      )}
    </div>
  );
}

function StoppedBand({
  rows,
  onConfirm,
}: {
  rows: StoppedRow[];
  onConfirm: (r: StoppedRow) => void;
}) {
  return (
    <details className="group rounded-2xl border bg-card">
      <summary className="no-marker flex cursor-pointer flex-wrap items-baseline gap-x-2 gap-y-1 px-4 py-4 sm:px-6">
        <span className="text-[15px] font-semibold">
          Stopped on the card, not in the register ({rows.length})
        </span>
        <span className="text-xs text-muted-foreground">
          Confirm each one, or leave it if it was stopped by mistake.
        </span>
      </summary>
      <ul className="divide-y border-t">
        {rows.map(r => (
          <li
            key={r.taskId}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6"
          >
            <div className="min-w-0">
              <div className="font-medium">
                <bdi>{r.clientName}</bdi>
              </div>
              <div className="text-xs text-muted-foreground">
                {r.churnDate ? (
                  <>
                    Churn date on the card{" "}
                    <span className="font-mono">{shortDay(r.churnDate)}</span>
                  </>
                ) : (
                  "No churn date on the card"
                )}
                {r.stoppedSince ? (
                  <>
                    {" "}
                    · Stopped since{" "}
                    <span className="font-mono">
                      {shortDay(r.stoppedSince)}
                    </span>
                  </>
                ) : (
                  " · Stopped in every daily snapshot so far"
                )}
                {r.mrrUsd !== null
                  ? ` · ${usd(r.mrrUsd)} a month on the card`
                  : ""}
              </div>
            </div>
            <ConfirmButton onClick={() => onConfirm(r)} />
          </li>
        ))}
      </ul>
    </details>
  );
}

// --- by month -----------------------------------------------------------------------

function Months({
  rows,
  onSave,
}: {
  rows: MonthRow[];
  onSave: (
    month: string,
    f: { activeAtStart?: number | null; newClients?: number | null },
  ) => Promise<void>;
}) {
  return (
    <section className="rounded-2xl border bg-card" aria-labelledby="months">
      <div className="px-4 pt-4 sm:px-6 sm:pt-5">
        <h2 id="months" className="text-[15px] font-semibold">
          By month
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Click a start or a new-clients count to change it. A blank start
          carries from the month before.
        </p>
      </div>
      <div className="mt-3 overflow-x-auto border-t">
        <table className="w-full min-w-[46rem] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              {[
                "Month",
                "Start",
                "New",
                "Churned",
                "Finished term",
                "End",
                "Churn",
                "3 months",
                "",
              ].map(h => (
                <th
                  key={h}
                  className="px-4 py-2 font-medium first:pl-4 sm:first:pl-6"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map(r => (
              <tr key={r.month} className="tabular-nums">
                <td className="whitespace-nowrap px-4 py-2.5 sm:pl-6">
                  {monthName(r.month)}
                  {r.lostBeforeRegister !== null ? (
                    <span
                      className="block text-xs text-muted-foreground"
                      title={r.note ?? undefined}
                    >
                      from the old sheet
                    </span>
                  ) : r.registerShort > 0 ? (
                    <span className="block text-xs txt-warn">
                      {r.registerShort} not logged yet
                    </span>
                  ) : r.running ? (
                    <span className="block text-xs text-muted-foreground">
                      to date
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-2.5">
                  <NumberCell
                    value={r.activeAtStart}
                    label={`Active clients at the start of ${monthName(r.month)}`}
                    onSave={n => onSave(r.month, { activeAtStart: n })}
                    className={r.startCarried ? "text-muted-foreground" : ""}
                  />
                </td>
                <td className="px-4 py-2.5">
                  <NumberCell
                    value={r.newClients}
                    label={`New clients in ${monthName(r.month)}`}
                    onSave={n => onSave(r.month, { newClients: n })}
                  />
                </td>
                <td className={cn("px-4 py-2.5", r.churned ? "txt-bad" : "")}>
                  {r.churned}
                </td>
                <td className="px-4 py-2.5">{r.completed}</td>
                <td className="px-4 py-2.5">{r.activeAtEnd ?? "–"}</td>
                <td className="px-4 py-2.5">{pct(r.churnPct)}</td>
                <td className="px-4 py-2.5 font-medium">
                  {pct(r.rolling3Pct)}
                  {r.rolling3Pct !== null && r.rolling3Months < 3 ? (
                    <span className="block text-xs font-normal text-muted-foreground">
                      {r.rolling3Months} of 3 months
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-2.5 pr-4 sm:pr-6">
                  {r.band ? (
                    <Chip tone={r.band.tone}>{r.band.label}</Chip>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// --- the rules, and what changed ---------------------------------------------------------

function Rules() {
  return (
    <details className="rounded-2xl border bg-card px-4 py-3 sm:px-6">
      <summary className="cursor-pointer text-[15px] font-semibold">
        How churn is counted
      </summary>
      <ul className="mt-3 grid list-disc gap-2 pb-2 pl-5 text-sm leading-relaxed">
        <li>
          Churn is a client lost before day {PROGRAMME_DAYS} from launch. A
          client who finishes the {PROGRAMME_DAYS} days and does not renew has
          finished the term: it is counted on its own line and is never churn,
          so one client leaving is never counted twice.
        </li>
        <li>
          The day they left is the day they said they were stopping, 14 days
          after a payment-failure pause, or 14 days with no reply across three
          channels. A paused client asked to pause in writing has not left.
        </li>
        <li>
          Churn is never reversed. A client who comes back is a reactivation,
          and their churn stays in the month it happened.
        </li>
        <li>
          Each month needs two numbers: clients active at the start (left blank,
          it carries from the month before) and new clients. Everything else is
          worked out from the register.
        </li>
        <li>
          Manage against the three-month figure: at 17 clients one departure is
          5.9%, so a single month says little. 0 to 4% is excellent, 5 to 8%
          good, 9 to 10% on target, 11 to 12% watch, 13 to 15% bad, over 15%
          critical.
        </li>
      </ul>
    </details>
  );
}

function Changes({ log }: { log: Page["log"] }) {
  if (!log.length) return null;
  return (
    <details className="rounded-2xl border bg-card px-4 py-3 sm:px-6">
      <summary className="cursor-pointer text-sm font-semibold">
        What changed
      </summary>
      <Kicker className="mt-3">Latest first</Kicker>
      <ul className="mt-2 grid gap-1.5 pb-2 text-xs">
        {log.slice(0, 15).map((l, i) => (
          <li key={i}>
            <span className="text-muted-foreground">
              {shortDay(l.at.slice(0, 10))}:{" "}
            </span>
            {l.by.split("@")[0]} {l.what}
          </li>
        ))}
      </ul>
    </details>
  );
}
