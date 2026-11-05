/* Hallmark · component: kickoff items as requests (sheet, page, band) · genre: modern-minimal · theme: the cockpit's own (Geist, --mahara-teal)
 * states: default · hover · focus-visible · active · disabled (raising) · loading · error · success · missing function
 * Hallmark · pre-emit critique: P4 H4 E4 S5 R5 V4
 *
 * CEO item 7 (WAVE56-CONTRACT.md 4.20 and 5.16; kickoff-requests.md 4 and
 * 5): each open kickoff item that maps to a request type is one question with
 * equal Yes and No pills. Yes raises it in one tap through the server
 * (cockpit_kickoff_item_raise, which calls the unchanged
 * cockpit_request_submit); No is recorded. "Change it first" opens the
 * prefilled ticket form and counts what it sends. The signature: each item is
 * drawn as one more trail ring (the shared fs-step and fs-ring classes, used
 * and not changed), so answering turns the open warning ring into a teal
 * check or a muted dash. Three variants: `sheet` (under the kickoff sheet's
 * trail, no "Change it first"), `page` (the client page's Onboarding tab) and
 * `band` (Today, one row per card). A missing function says one line, never an
 * error page.
 */

import { Check, LoaderCircle, Minus, X } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Chip, ExtLink, Kicker, SectionCard } from "@/components/kit";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import {
  askWords,
  type DueRead,
  existingWords,
  formOnlyWords,
  ITEMS_MISSING,
  type ItemRow,
  type ItemsRead,
  itemTone,
  kickerWords,
  NO_ANSWERS,
  NO_LABEL,
  orderItems,
  receiptWords,
  requestWords,
  routeLine,
  STILL_ON_ITS_WAY,
  stillSending,
  TOAST,
  ticketDetails,
  toDecide,
  typeOffWords,
  yesLabel,
} from "@/lib/kickoffItems";
import { itemsMissing, type KickoffItemsApi } from "@/lib/kickoffItemsClient";
import { errorWords, newRequestId, plainNote } from "@/lib/requestsClient";
import type { SubmitResult } from "@/lib/requestsCore";
import "@/forms/staff/formSheet.css";
import "./kickoffItems.css";

/** "Change it first" and "Raise it with the form": the prefilled ticket form, counted on its send. */
export type ItemTicket = {
  type: string;
  details: string;
  item: string;
  onSent: (r: SubmitResult) => void;
};

export type KickoffItemsVariant = "sheet" | "page" | "band";

const POLL_MS = 5_000;
const POLL_FOR_MS = 60_000;

type Load =
  | { kind: "loading" }
  | { kind: "missing" }
  /** A seat the read refuses (42501): the items are not for it, as on Today's band. */
  | { kind: "hidden" }
  | { kind: "error"; text: string }
  | { kind: "ready"; read: ItemsRead };

/**
 * One card's kickoff items, read on open. `sheet` sits in FormSheet's
 * afterSent; `page` is the Onboarding tab's first card. Nothing is drawn when
 * nothing is open or decided, except the page's sentence when the kickoff's
 * answers are not stored for a client still in onboarding. A seat the read
 * refuses (42501: an admin seat without the csm role) sees nothing, as on
 * Today's band.
 */
export function KickoffItems({
  api,
  taskId,
  clientName,
  variant,
  onTicket,
  reloadKey = 0,
}: {
  api: KickoffItemsApi | null;
  taskId: string;
  clientName: string;
  variant: "sheet" | "page";
  onTicket?: (t: ItemTicket) => void;
  /** A change here reads the items again (a kickoff sent from the page). */
  reloadKey?: number;
}) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const read = useCallback(async () => {
    if (!api) return;
    try {
      setLoad({ kind: "ready", read: await api.read(taskId) });
    } catch (e) {
      setLoad(
        itemsMissing(e)
          ? { kind: "missing" }
          : (e as { code?: string })?.code === "42501"
            ? { kind: "hidden" }
            : { kind: "error", text: errorWords(e) },
      );
    }
  }, [api, taskId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey asks for a fresh read
  useEffect(() => {
    void read();
  }, [read, reloadKey]);

  if (!api || load.kind === "hidden") return null;
  if (load.kind === "loading")
    return variant === "sheet" ? (
      <div data-kickoff-items="loading">
        <LoadingSkeleton
          variant="list"
          label="Reading what the kickoff left open"
          rows={3}
        />
      </div>
    ) : null;
  if (load.kind === "missing")
    return (
      <p className="ki-note" data-kickoff-items="missing">
        {ITEMS_MISSING}
      </p>
    );
  if (load.kind === "error")
    return (
      <p className="ki-note ki-fail" role="alert" data-kickoff-items="error">
        Kickoff items could not be read: {load.text}
      </p>
    );
  const r = load.read;
  if (!r.items.length) {
    if (
      variant === "page" &&
      r.reason === "no_answers" &&
      r.kickoff?.inOnboarding
    )
      return (
        <SectionCard title="Kickoff items">
          <p
            className="text-sm text-muted-foreground"
            data-kickoff-items="no-answers"
          >
            {NO_ANSWERS}
          </p>
        </SectionCard>
      );
    return null;
  }
  const list = (
    <ItemList
      api={api}
      taskId={taskId}
      clientName={clientName}
      variant={variant}
      rows={r.items}
      onTicket={variant === "sheet" ? undefined : onTicket}
    />
  );
  if (variant === "sheet") return list;
  return (
    <SectionCard
      title="Kickoff items"
      sub={
        r.kickoff?.day
          ? `From the kickoff on ${r.kickoff.day}. Yes raises the request; No records it.`
          : "Yes raises the request; No records it."
      }
    >
      {list}
    </SectionCard>
  );
}

/**
 * Today's band, "Kickoff items to decide" (4.20 cockpit_kickoff_items_due):
 * one row per card, the client and the kickoff's day in Geist Mono, its items
 * inline. Not drawn for a seat outside client success, or with nothing to
 * decide; one line while the functions are missing.
 */
export function KickoffItemsBand({
  api,
  onTicket,
  reloadKey = 0,
}: {
  api: KickoffItemsApi | null;
  onTicket?: (t: ItemTicket & { taskId: string; name: string }) => void;
  reloadKey?: number;
}) {
  const [due, setDue] = useState<
    | { kind: "loading" }
    | { kind: "missing" }
    | { kind: "hidden" }
    | { kind: "error"; text: string }
    | { kind: "ready"; read: DueRead }
  >({ kind: "loading" });
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey asks for a fresh read
  useEffect(() => {
    if (!api) return;
    let live = true;
    api
      .due()
      .then(read => live && setDue({ kind: "ready", read }))
      .catch(e => {
        if (!live) return;
        if (itemsMissing(e)) setDue({ kind: "missing" });
        // Not a client success seat: the band is not for it.
        else if ((e as { code?: string })?.code === "42501")
          setDue({ kind: "hidden" });
        else setDue({ kind: "error", text: errorWords(e) });
      });
    return () => {
      live = false;
    };
  }, [api, reloadKey]);
  if (!api || due.kind === "loading" || due.kind === "hidden") return null;
  if (due.kind === "missing")
    return (
      <p className="text-xs text-muted-foreground" data-kickoff-items="missing">
        {ITEMS_MISSING}
      </p>
    );
  if (due.kind === "error")
    return (
      <p className="text-xs txt-bad" role="alert" data-kickoff-items="error">
        Kickoff items could not be read: {due.text}
      </p>
    );
  const rows = due.read.rows;
  if (!rows.length) return null;
  const count = rows.reduce((n, r) => n + r.due, 0);
  return (
    <SectionCard
      title="Kickoff items to decide"
      count={count}
      sub={
        due.read.more
          ? "The 30 oldest kickoffs. Yes raises the request; No records it."
          : "Yes raises the request; No records it."
      }
      flush
    >
      {rows.map(row => (
        <div
          key={row.taskId}
          className="space-y-2 px-4 py-3 sm:px-6"
          data-kickoff-band-row={row.taskId}
        >
          <p className="text-sm" dir="auto">
            <Link
              to={`/clients/${encodeURIComponent(row.taskId)}?tab=onboarding`}
              className="font-medium underline-offset-4 hover:underline"
            >
              <bdi>{row.clientName}</bdi>
            </Link>
            {row.kickoffDay ? (
              <>
                {" "}
                <span className="text-muted-foreground">kickoff</span>{" "}
                <span className="font-mono text-sm text-foreground">
                  {row.kickoffDay}
                </span>
              </>
            ) : null}
          </p>
          <ItemList
            api={api}
            taskId={row.taskId}
            clientName={row.clientName}
            variant="band"
            rows={row.items}
            onTicket={
              onTicket
                ? t =>
                    onTicket({ ...t, taskId: row.taskId, name: row.clientName })
                : undefined
            }
          />
        </div>
      ))}
    </SectionCard>
  );
}

/** The list itself: it keeps its rows and replaces one with the server's answer after each press. */
function ItemList({
  api,
  taskId,
  clientName,
  variant,
  rows: first,
  onTicket,
}: {
  api: KickoffItemsApi;
  taskId: string;
  clientName: string;
  variant: KickoffItemsVariant;
  rows: ItemRow[];
  onTicket?: (t: ItemTicket) => void;
}) {
  const [rows, setRows] = useState(first);
  useEffect(() => setRows(first), [first]);
  // One request id per item's Yes, kept across retries until the server answers.
  const pending = useRef<Record<string, string>>({});
  const put = useCallback(
    (row: ItemRow) =>
      setRows(rs =>
        rs.some(r => r.item === row.item)
          ? rs.map(r => (r.item === row.item ? row : r))
          : [...rs, row],
      ),
    [],
  );
  const reload = useCallback(async () => {
    const read = await api.read(taskId);
    setRows(read.items);
  }, [api, taskId]);
  const n = toDecide(rows);
  const ordered = orderItems(rows);
  return (
    <section
      className="ki-root"
      data-variant={variant}
      aria-label="Kickoff items"
      data-kickoff-items="list"
    >
      {variant === "band" ? null : (
        <Kicker as="h3" className="ki-kicker">
          {n ? kickerWords(n) : "From the kickoff"}
        </Kicker>
      )}
      <ol className={variant === "sheet" ? "fs-trail ki-trail" : "ki-list"}>
        {ordered.map((r, i) => (
          <ItemLine
            key={r.item}
            i={i}
            row={r}
            api={api}
            taskId={taskId}
            clientName={clientName}
            pending={pending.current}
            onRow={put}
            reload={reload}
            onTicket={onTicket}
          />
        ))}
      </ol>
    </section>
  );
}

const RING_ICON = { check: Check, dash: Minus, cross: X, open: null } as const;

function ItemLine({
  i,
  row: r,
  api,
  taskId,
  clientName,
  pending,
  onRow,
  reload,
  onTicket,
}: {
  i: number;
  row: ItemRow;
  api: KickoffItemsApi;
  taskId: string;
  clientName: string;
  pending: Record<string, string>;
  onRow: (r: ItemRow) => void;
  reload: () => Promise<void>;
  onTicket?: (t: ItemTicket) => void;
}) {
  const [busy, setBusy] = useState<"yes" | "no" | "count" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [late, setLate] = useState(false);
  const receipt = useRef<HTMLParagraphElement | null>(null);
  const focusNext = useRef(false);
  const { tone, mark } = itemTone(r);
  const Icon = RING_ICON[mark];
  const decided = r.state === "raised" || r.state === "declined";

  // After a press, focus moves to the row's receipt. Keyed on the state, not
  // on `decided`: "Raise it after all" turns declined into raised, both
  // decided, and its button unmounts under the keyboard.
  useEffect(() => {
    if (focusNext.current && (r.state === "raised" || r.state === "declined")) {
      focusNext.current = false;
      receipt.current?.focus();
    }
  }, [r.state]);

  // A raised request still on its way is read again every 5 s for a minute.
  const sending = stillSending(r);
  useEffect(() => {
    if (!sending) return;
    setLate(false);
    const started = Date.now();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (stopped) return;
      if (Date.now() - started >= POLL_FOR_MS) {
        setLate(true);
        return;
      }
      try {
        await reload();
      } catch {}
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [sending, reload]);

  const yes = async () => {
    if (busy) return;
    setBusy("yes");
    setError(null);
    pending[r.item] ??= newRequestId();
    try {
      const out = await api.raise(taskId, r.item, pending[r.item]);
      if (out.alreadyOpen) {
        // Nothing was written: the row now offers "Count it".
        if (out.item) onRow(out.item);
        return;
      }
      delete pending[r.item];
      focusNext.current = true;
      if (out.item) onRow(out.item);
      else await reload();
      toast.success(TOAST.raised(out.item ?? r));
    } catch (e) {
      setError(errorWords(e));
    } finally {
      setBusy(null);
    }
  };
  const no = async () => {
    if (busy) return;
    setBusy("no");
    setError(null);
    try {
      const out = await api.decline(taskId, r.item);
      focusNext.current = true;
      if (out.item) onRow(out.item);
      else await reload();
      toast.success(TOAST.declined);
    } catch (e) {
      setError(errorWords(e));
    } finally {
      setBusy(null);
    }
  };
  const count = async (requestId: string) => {
    setBusy("count");
    setError(null);
    try {
      const out = await api.link(taskId, r.item, requestId);
      focusNext.current = true;
      if (out.item) onRow(out.item);
      else await reload();
      toast.success(TOAST.counted(out.item ?? r));
    } catch (e) {
      setError(errorWords(e));
    } finally {
      setBusy(null);
    }
  };
  const withForm = onTicket
    ? () =>
        onTicket({
          type: r.typeKey,
          details: ticketDetails(r),
          item: r.item,
          onSent: res => {
            if (res?.id) void count(res.id);
          },
        })
    : undefined;

  // The preview's note can be Postgres's own words (B4 keeps SQLERRM): plain words instead.
  const route = plainNote(routeLine(r.route));
  const rec = receiptWords(r);
  const req = r.state === "raised" ? requestWords(r.request) : null;
  const pills = (
    <div className="ki-pills" role="group" aria-label={askWords(r)}>
      <button
        type="button"
        className="ki-pill"
        aria-label={yesLabel(r, clientName)}
        aria-pressed={busy === "yes"}
        disabled={busy !== null || !r.actions.raise}
        onClick={() => void yes()}
      >
        {busy === "yes" ? (
          <>
            <LoaderCircle aria-hidden className="fs-spin ki-spin" />
            Raising…
          </>
        ) : (
          "Yes"
        )}
      </button>
      <button
        type="button"
        className="ki-pill"
        aria-label={NO_LABEL}
        aria-pressed={busy === "no"}
        disabled={busy !== null || !r.actions.decline}
        onClick={() => void no()}
      >
        {busy === "no" ? "Saving…" : "No"}
      </button>
    </div>
  );
  const noOnly = r.actions.decline ? (
    <div className="ki-pills" role="group">
      <button
        type="button"
        className="ki-pill"
        aria-label={NO_LABEL}
        disabled={busy !== null}
        onClick={() => void no()}
      >
        {busy === "no" ? "Saving…" : "No"}
      </button>
    </div>
  ) : null;

  let body: ReactNode;
  if (decided && rec) {
    body = (
      <>
        <p
          ref={receipt}
          className="ki-receipt"
          role="status"
          tabIndex={-1}
          data-receipt={r.state}
        >
          <span className="ki-receipt-head">{rec.head}</span>
          {req ? (
            <>
              {" · "}
              {req.url ? (
                <ExtLink href={req.url} className="ki-ext">
                  {req.text}
                </ExtLink>
              ) : (
                <span data-tone={req.tone}>{req.text}</span>
              )}
            </>
          ) : null}
        </p>
        {rec.sub ? (
          <p className="ki-sub" dir="auto">
            {rec.sub}
          </p>
        ) : null}
        {sending && late ? <p className="ki-sub">{STILL_ON_ITS_WAY}</p> : null}
        {r.state === "declined" && r.actions.raise ? (
          <button
            type="button"
            className="fs-link ki-again"
            disabled={busy !== null}
            onClick={() => void yes()}
          >
            {busy === "yes" ? "Raising…" : "Raise it after all"}
          </button>
        ) : r.state === "declined" &&
          !r.oneTap &&
          r.stillOpen &&
          withForm &&
          r.actions.link ? (
          <button type="button" className="fs-link ki-again" onClick={withForm}>
            Raise it with the form
          </button>
        ) : null}
      </>
    );
  } else if (r.state === "type_off") {
    body = <p className="ki-say">{typeOffWords(r)}</p>;
  } else if (r.blocked) {
    body = (
      <>
        <p className="ki-say">{r.blocked}</p>
        {noOnly}
      </>
    );
  } else if (r.existing) {
    body = (
      <>
        <p className="ki-say">{existingWords(r)}</p>
        <div className="ki-pills" role="group">
          <button
            type="button"
            className="ki-pill"
            disabled={busy !== null || !r.actions.link}
            onClick={() => void count(r.existing?.requestId ?? "")}
          >
            {busy === "count" ? "Counting…" : "Count it"}
          </button>
          <button
            type="button"
            className="ki-pill"
            aria-label={NO_LABEL}
            disabled={busy !== null || !r.actions.decline}
            onClick={() => void no()}
          >
            {busy === "no" ? "Saving…" : "No"}
          </button>
        </div>
      </>
    );
  } else if (!r.oneTap) {
    body = (
      <>
        <p className="ki-say">{formOnlyWords(r)}</p>
        {withForm && r.actions.link ? (
          <button type="button" className="fs-link ki-again" onClick={withForm}>
            Raise it with the form
          </button>
        ) : (
          <p className="ki-sub">Raise it with the form from the client page.</p>
        )}
        {noOnly}
      </>
    );
  } else {
    body = (
      <>
        {r.state === "reopened" ? (
          <p className="ki-say" data-tone="critical">
            {requestWords(r.request).text}
          </p>
        ) : null}
        <div className="ki-ask">
          <span className="ki-ask-words">{askWords(r)}</span>
          {pills}
        </div>
        {route ? <p className="ki-route">{route}</p> : null}
        {r.route?.writer?.held && r.route.writer.note ? (
          <p className="ki-sub">{r.route.writer.note}</p>
        ) : null}
        {withForm && r.actions.link ? (
          <button type="button" className="fs-link ki-again" onClick={withForm}>
            Change it first
          </button>
        ) : null}
      </>
    );
  }

  return (
    <li
      className="fs-step ki-item"
      data-state={r.state}
      data-item={r.item}
      style={{ "--i": i } as CSSProperties}
    >
      <span className="fs-ring ki-ring" data-tone={tone} aria-hidden>
        {Icon ? <Icon className="fs-ring-icon" /> : null}
      </span>
      <div className="fs-step-text ki-body">
        <span className="ki-head">
          <Chip dot={false}>{r.short}</Chip>
        </span>
        {r.line ? (
          <p className="ki-line" dir="auto">
            {r.line}
          </p>
        ) : null}
        {body}
        {error ? (
          <p className="ki-fail" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </li>
  );
}
