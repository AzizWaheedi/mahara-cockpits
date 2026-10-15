import {
  memo,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import {
  APPT_ALL,
  type ApptRow,
  apptIssues,
  dealWord,
  fmtDay,
  fmtDT,
  fmtN,
  fmtTime,
  type Issue,
  type Kind,
  LEAD_ALL,
  type LeadRow,
  leadIssues,
  ms,
  plainMade,
  plainSource,
  rel,
  result,
  type SheetColumn,
} from "@/lib/dataView";

type Row = LeadRow | ApptRow;
type Help = [what: string, source: string, empty: string];
type Col = {
  label: string;
  width: number;
  group?: string;
  cls?: string;
  frozen?: boolean;
  /** Set for a column the database does not have: why it is empty. */
  notSynced?: string;
  help: Help;
  render: (row: Row, now: number) => ReactNode;
};

const NA = (
  <span className="na" title="GHL has no value for this field">
    —
  </span>
);
function Two({ a, b, mono }: { a: ReactNode; b?: ReactNode; mono?: boolean }) {
  return (
    <>
      <div className="l1">{a}</div>
      {b ? <div className={`l2${mono ? " m" : ""}`}>{b}</div> : null}
    </>
  );
}

/** The one-line verdict: "Looks right", or the first problem and a count. */
export function Verdict({
  issues,
  okText = "Looks right",
}: {
  issues: Pick<Issue, "tone" | "label">[];
  okText?: string;
}) {
  if (!issues.length)
    return (
      <span className="dv-status">
        <span className="dv-dot" />
        <span>{okText}</span>
      </span>
    );
  const [first] = issues;
  return (
    <>
      <span className={`dv-status ${first.tone}`}>
        <span className={`dv-dot ${first.tone}`} />
        <span>{first.label}</span>
      </span>
      {issues.length > 1 ? (
        <span className="dv-more-issues">+{issues.length - 1} more</span>
      ) : null}
    </>
  );
}

const lead = (r: Row) => r as LeadRow;
const appt = (r: Row) => r as ApptRow;

// Key view: the fewest columns that answer who, when, from where, what
// happened, and whether the row is right.
const LEAD_KEY: Col[] = [
  {
    label: "Lead",
    width: 230,
    cls: "strong",
    frozen: true,
    help: [
      "The person who came in.",
      "client_leads.contact_name and contact_phone",
      'Shows "No name" when GHL has no name.',
    ],
    render: r => (
      <Two
        a={lead(r).name || <span className="na">No name</span>}
        b={lead(r).phone}
        mono
      />
    ),
  },
  {
    label: "Client",
    width: 160,
    help: [
      "The Mahara client this lead belongs to.",
      "ghl_clients.client_name, else the cockpit's client list, else the GHL account name",
      "Never empty. An account with no name anywhere shows as Unknown GHL account and its id.",
    ],
    render: r => <Two a={r.client} />,
  },
  {
    label: "Came in",
    width: 170,
    help: [
      "When GHL created the contact, in Riyadh time.",
      "client_leads.created_at",
      "Never empty.",
    ],
    render: (r, now) => {
      const t = ms(lead(r).created_at) ?? 0;
      return <Two a={fmtDT(t)} b={rel(t, now)} />;
    },
  },
  {
    label: "Came from",
    width: 240,
    help: [
      "The channel, and the ad when it is a Facebook lead.",
      "client_leads.source_field; ad name from cockpit_media_daily_stats",
      '"Ad unknown" means GHL did not receive the ad id.',
    ],
    render: r => {
      const l = lead(r);
      if (l.channel === "Meta")
        return (
          <Two
            a="Facebook ad"
            b={
              l.ad_name ??
              (l.ad_id ? (
                `Ad ${l.ad_id}`
              ) : (
                <span className="warn-text">Ad unknown</span>
              ))
            }
          />
        );
      return (
        <Two
          a={plainSource(l.source, l.channel)}
          b={l.channel === "TikTok" ? "TikTok" : "Not from a Meta ad"}
        />
      );
    },
  },
  {
    label: "Campaign",
    width: 260,
    help: [
      "The Meta campaign and ad set.",
      "client_leads.campaign_id and adset_id; names from cockpit_media_daily_stats",
      "— when the lead is not from an ad, or the ad is unknown.",
    ],
    render: r => {
      const l = lead(r);
      const name = l.campaign_name ?? l.utm_campaign;
      return name ? <Two a={name} b={l.adset_name} /> : NA;
    },
  },
  {
    label: "Meeting",
    width: 210,
    help: [
      "Whether this lead booked an appointment, and what happened.",
      "appointments, matched by contact id",
      '"Not booked" means no appointment exists for this contact.',
    ],
    render: (r, now) => {
      const l = lead(r);
      if (!l.meeting_id || !l.meeting_start)
        return <Two a={<span className="na">Not booked</span>} />;
      const [word] = result(
        { status: l.meeting_status, start_at: l.meeting_start },
        now,
      );
      const more = l.meetings > 1 ? ` (${l.meetings} bookings)` : "";
      return (
        <Two
          a={`Booked${more}`}
          b={`${fmtDay(ms(l.meeting_start) ?? 0)}, ${word.toLowerCase()}`}
        />
      );
    },
  },
  {
    label: "Check",
    width: 210,
    help: [
      "Whether anything about this row looks wrong.",
      "The checks listed at the top of the page",
      '"Looks right" means no check found a problem.',
    ],
    render: r => <Verdict issues={leadIssues(lead(r))} />,
  },
];

const APPT_KEY: Col[] = [
  {
    label: "Lead",
    width: 230,
    cls: "strong",
    frozen: true,
    help: [
      "The person who booked.",
      "appointments.contact_name and contact_phone",
      '"Calendar event" when the booking came from Google Calendar with no name.',
    ],
    render: r => {
      const a = appt(r);
      if (!a.name && a.ghl_source === "google_calendar")
        return (
          <Two
            a={<span className="na">Calendar event</span>}
            b="No contact name"
          />
        );
      return (
        <Two
          a={a.name || <span className="na">No name</span>}
          b={a.phone}
          mono
        />
      );
    },
  },
  {
    label: "Client",
    width: 160,
    help: [
      "The Mahara client.",
      "ghl_clients.client_name, else the cockpit's client list, else the GHL account name",
      "Never empty. An account with no name anywhere shows as Unknown GHL account and its id.",
    ],
    render: r => <Two a={r.client} />,
  },
  {
    label: "Meeting time",
    width: 190,
    help: [
      "When the meeting is or was, in Riyadh time.",
      "appointments.start_at",
      "Never empty.",
    ],
    render: (r, now) => {
      const t = ms(appt(r).start_at) ?? 0;
      return <Two a={`${fmtDay(t)}, ${fmtTime(t)}`} b={rel(t, now)} />;
    },
  },
  {
    label: "Result",
    width: 170,
    help: [
      "What happened at the meeting.",
      "appointments.status",
      '"Result not recorded" means the time passed and nobody marked it.',
    ],
    render: (r, now) => {
      const [word, tone] = result(appt(r), now);
      return <Two a={<span className={`dv-result ${tone}`}>{word}</span>} />;
    },
  },
  {
    label: "Booked",
    width: 240,
    help: [
      "When and how the booking was made.",
      "appointments.booked_at and ghl_source",
      '"Booking method not recorded" means GHL did not say.',
    ],
    render: r => {
      const a = appt(r);
      return (
        <Two a={fmtDT(ms(a.booked_at) ?? 0)} b={plainMade(a.ghl_source)} />
      );
    },
  },
  {
    label: "Deal (portal)",
    width: 170,
    help: [
      "What the client reported after the meeting.",
      "portal_data.appointment_outcomes",
      "— means the client has not filled it in the portal.",
    ],
    render: r => {
      const a = appt(r);
      if (!a.deal && a.project_value === null) return NA;
      return (
        <Two
          a={dealWord(a.deal) ?? "Deal not set"}
          b={
            a.project_value !== null
              ? `${fmtN(a.project_value)}${a.currency ? ` ${a.currency}` : ""}`
              : "No value given"
          }
        />
      );
    },
  },
  {
    label: "Check",
    width: 230,
    help: [
      "Whether anything about this row looks wrong.",
      "The checks listed at the top of the page",
      '"Looks right" means no check found a problem.',
    ],
    render: (r, now) => <Verdict issues={apptIssues(appt(r), now)} />,
  },
];

function sheetCols<T>(list: SheetColumn<T>[]): Col[] {
  return list.map((c, i) => ({
    label: c.label,
    width: c.width,
    group: c.group,
    cls: c.cls,
    frozen: i === 0,
    notSynced: c.get
      ? undefined
      : (c.why ??
        "Not stored in the database. It may still have a value in GHL."),
    help: c.get
      ? [
          `The Master Dashboard column "${c.label}".`,
          c.source,
          c.empty ?? "— means GHL has no value for this row.",
        ]
      : [
          `The Master Dashboard column "${c.label}".`,
          "Not stored in the database",
          `Always striped. ${c.why ?? "It may still have a value in GHL."}`,
        ],
    render: (row: Row) => {
      if (!c.get) return null;
      const value = c.get(row as T);
      if (value !== null) return value;
      return c.empty ? (
        <span className="na" title={c.empty}>
          —
        </span>
      ) : (
        NA
      );
    },
  }));
}
const LEAD_ALL_COLS = sheetCols(LEAD_ALL);
const APPT_ALL_COLS = sheetCols(APPT_ALL);
export const ALL_COUNT = {
  leads: LEAD_ALL.length,
  appointments: APPT_ALL.length,
};

// Only the rows in the sheet window are drawn, plus a margin above and below
// (Muhammed, 2026-10-12: switching columns froze the laptop). 150 rows of 22
// columns were 3,300 cells for 14 visible rows. The window moves in steps of
// STEP rows, so scrolling re-renders only when a new step comes into view.
const OVERSCAN = 10;
const STEP = 5;
const ROW_H = { comfortable: 57, compact: 39 } as const;

function useRowWindow(
  ref: RefObject<HTMLDivElement | null>,
  count: number,
  density: "comfortable" | "compact",
  view: "key" | "all",
) {
  const [win, setWin] = useState<{
    first: number;
    rowH: number;
    viewH: number;
  }>({
    first: 0,
    rowH: ROW_H[density],
    viewH: 900,
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: density and view change the row and header heights
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Heights are read once per size change; a scroll only reads scrollTop,
    // so it can place the window at once, even after a jump to the end.
    let rowH: number = ROW_H[density];
    let head = 0;
    const place = () => {
      const top = Math.max(0, el.scrollTop - head);
      const first = Math.floor(top / rowH / STEP) * STEP;
      const viewH = el.clientHeight;
      setWin(w =>
        w.first === first && w.rowH === rowH && w.viewH === viewH
          ? w
          : { first, rowH, viewH },
      );
    };
    const measure = () => {
      const row = el.querySelector<HTMLElement>("tbody tr[aria-rowindex]");
      rowH = row?.getBoundingClientRect().height || ROW_H[density];
      head = el.querySelector("thead")?.getBoundingClientRect().height ?? 0;
      place();
    };
    measure();
    // The new rows are drawn before the frame that shows the scroll, so a
    // fast scroll never shows a blank strip (TanStack Virtual does the same).
    const onScroll = () => flushSync(place);
    el.addEventListener("scroll", onScroll, { passive: true });
    const size = new ResizeObserver(measure);
    size.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      size.disconnect();
    };
  }, [ref, density, view]);
  // Never start past the last screenful: switching to Compact at the end of
  // the sheet leaves a scroll position the shorter rows do not reach.
  const fit = Math.ceil(win.viewH / win.rowH);
  const first = Math.min(
    win.first,
    Math.floor(Math.max(0, count - fit) / STEP) * STEP,
  );
  const start = Math.max(0, first - OVERSCAN);
  const end = Math.min(count, first + fit + STEP + OVERSCAN);
  return {
    start,
    end,
    above: start * win.rowH,
    below: Math.max(0, count - end) * win.rowH,
  };
}

const SheetRow = memo(function SheetRow({
  row,
  index,
  cols,
  now,
  selected,
  onSelect,
}: {
  row: Row;
  index: number;
  cols: Col[];
  now: number;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <tr
      aria-rowindex={index}
      className={selected ? "sel" : undefined}
      onClick={() => onSelect(row.id)}
      onKeyDown={e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(row.id);
        }
      }}
      tabIndex={0}
      aria-selected={selected}
    >
      {cols.map(c => (
        <td
          key={c.label}
          className={
            [c.frozen ? "fz" : "", c.cls ?? "", c.notSynced ? "ns-cell" : ""]
              .join(" ")
              .trim() || undefined
          }
          title={c.notSynced}
        >
          {c.notSynced ? null : c.render(row, now)}
        </td>
      ))}
    </tr>
  );
});

function Spacer({ height, span }: { height: number; span: number }) {
  if (height <= 0) return null;
  return (
    <tr className="dv-spacer" aria-hidden>
      <td colSpan={span} style={{ height }} />
    </tr>
  );
}

// Memoized: a change elsewhere on the page (the summary, the side panel, the
// pill moving) does not redraw the sheet.
export const SheetGrid = memo(function SheetGrid({
  kind,
  view,
  density,
  rows,
  now,
  selected,
  onSelect,
}: {
  kind: Kind;
  view: "key" | "all";
  density: "comfortable" | "compact";
  rows: Row[];
  now: number;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const cols =
    kind === "leads"
      ? view === "key"
        ? LEAD_KEY
        : LEAD_ALL_COLS
      : view === "key"
        ? APPT_KEY
        : APPT_ALL_COLS;
  const all = view === "all";
  const groups: { group: string; n: number }[] = [];
  if (all)
    for (const c of cols) {
      const last = groups[groups.length - 1];
      if (last && last.group === c.group) last.n++;
      else groups.push({ group: c.group ?? "", n: 1 });
    }
  const width = cols.reduce((n, c) => n + c.width, 0);

  // Column help: one popover, placed under the "i" that opened it.
  const [help, setHelp] = useState<{
    i: number;
    top: number;
    left: number;
  } | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!help) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e.target instanceof Node && popRef.current?.contains(e.target))
        return;
      setHelp(null);
    };
    const t = window.setTimeout(() => {
      document.addEventListener("click", close);
      document.addEventListener("keydown", close);
      window.addEventListener("scroll", close, true);
    });
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [help]);
  const openHelp = (i: number, el: HTMLElement) => {
    if (help?.i === i) return setHelp(null);
    const r = el.getBoundingClientRect();
    setHelp({
      i,
      top: Math.min(r.bottom + 8, window.innerHeight - 220),
      left: Math.max(8, Math.min(r.left - 20, window.innerWidth - 308)),
    });
  };
  const helpCol = help ? cols[help.i] : null;

  const wrap = useRef<HTMLDivElement>(null);
  const { start, end, above, below } = useRowWindow(
    wrap,
    rows.length,
    density,
    view,
  );
  const headRows = all ? 2 : 1;

  return (
    <div
      ref={wrap}
      className={`dv-gridwrap ${all ? "allcols" : ""} ${density}`}
    >
      <table
        style={{ width: `max(${width}px, 100%)` }}
        aria-rowcount={rows.length + headRows}
      >
        <colgroup>
          {cols.map(c => (
            <col key={c.label} style={{ width: c.width }} />
          ))}
        </colgroup>
        <thead>
          {all ? (
            <tr className="grp" aria-rowindex={1}>
              {groups.map((g, gi) =>
                gi === 0 ? (
                  [
                    <th key={`${g.group}-a`} className="fz">
                      {g.group}
                    </th>,
                    g.n > 1 ? (
                      <th key={`${g.group}-b`} colSpan={g.n - 1} />
                    ) : null,
                  ]
                ) : (
                  <th key={g.group} colSpan={g.n}>
                    {g.group}
                  </th>
                ),
              )}
            </tr>
          ) : null}
          <tr className="cols" aria-rowindex={headRows}>
            {cols.map((c, i) => (
              <th key={c.label} className={c.frozen ? "fz" : undefined}>
                <span className="dv-th">
                  <span title={c.label}>{c.label}</span>
                  <button
                    type="button"
                    className="dv-colhelp"
                    aria-label={`About ${c.label}`}
                    aria-expanded={help?.i === i}
                    onClick={e => {
                      e.stopPropagation();
                      openHelp(i, e.currentTarget);
                    }}
                  >
                    i
                  </button>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <Spacer height={above} span={cols.length} />
          {rows.slice(start, end).map((r, i) => (
            <SheetRow
              key={r.id}
              row={r}
              index={headRows + start + i + 1}
              cols={cols}
              now={now}
              selected={selected === r.id}
              onSelect={onSelect}
            />
          ))}
          <Spacer height={below} span={cols.length} />
        </tbody>
      </table>
      {help && helpCol ? (
        <div
          ref={popRef}
          className="dv-pop"
          role="dialog"
          aria-label={`About ${helpCol.label}`}
          style={{ top: help.top, left: help.left }}
        >
          <h4>{helpCol.label}</h4>
          <dl>
            <div>
              <dt>What it means</dt>
              <dd>{helpCol.help[0]}</dd>
            </div>
            <div>
              <dt>Where it comes from</dt>
              <dd>
                <code>{helpCol.help[1]}</code>
              </dd>
            </div>
            <div>
              <dt>When it is empty</dt>
              <dd>{helpCol.help[2]}</dd>
            </div>
          </dl>
        </div>
      ) : null}
    </div>
  );
});

/** How many sheet columns are not synced, for the legend. */
export const notSyncedCount = (kind: Kind, view: "key" | "all") =>
  view === "key"
    ? 0
    : (kind === "leads" ? LEAD_ALL : APPT_ALL).filter(c => !c.get).length;
