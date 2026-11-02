import { Link } from "react-router";
import { reasonLabel } from "../lib/afterCall";
import { count, share, when } from "../lib/format";
import type { Funnel } from "../lib/types";
import { QualityGauge } from "./AfterCall";
import { Failed, Reading, SectionCard, SourceNote, StatTile } from "./kit";

/**
 * Intros to demos (Aziz, 2026-10-29: "how many demos we had this month, how
 * many showed the intros, how many intros turned into demos"), from
 * cockpit_sales_funnel: the intros and the demos apart, what became of every
 * intro held, why the rest booked no demo, and the lead quality the setter
 * and the closer gave. A rate with nothing to divide by is n/a, never 0%.
 */

/** What became of the held intros, in the order the bar draws them. */
const PARTS: {
  key: "advanced" | "signed" | "disqualified" | "why" | "none";
  label: string;
  color: string;
  dashed?: boolean;
}[] = [
  { key: "advanced", label: "Booked a demo", color: "var(--primary)" },
  {
    key: "signed",
    label: "Signed on the intro",
    color: "color-mix(in oklch, var(--primary) 55%, var(--success))",
  },
  {
    key: "why",
    label: "No demo, reason given",
    color: "var(--warning)",
  },
  {
    key: "disqualified",
    label: "Disqualified",
    color: "color-mix(in oklch, var(--foreground) 30%, transparent)",
  },
  {
    key: "none",
    label: "No reason yet",
    color: "transparent",
    dashed: true,
  },
];

/** The setter's view first, then the closer's: the order the lead meets them. */
const ROLE_ORDER = ["setter", "both", "closer", "manager", "unknown"];

const ROLE: Record<string, string> = {
  setter: "Setter",
  closer: "Closer",
  both: "Setter and closer",
  manager: "Manager",
  unknown: "No role",
};

function IntroSplit({ f }: { f: Funnel }) {
  const held = f.intros.shown;
  const by = new Map(f.reasons.map(r => [r.why, r.n]));
  const disqualified = by.get("disqualified") ?? 0;
  const none = by.get("none") ?? 0;
  const parts = {
    advanced: f.intros.advanced,
    signed: f.intros.signed,
    disqualified,
    none,
    why: Math.max(0, f.intros.stalled - disqualified - none),
  };
  if (!held)
    return (
      <p className="muted text-sm">
        No intro was held in this window, so there is nothing to split yet.
      </p>
    );
  return (
    <div className="space-y-2.5">
      <p className="text-sm">
        <span className="font-semibold tabular-nums">{count(held)}</span> intros
        held.{" "}
        <span className="font-semibold tabular-nums">
          {count(f.intros.advanced)}
        </span>{" "}
        booked a demo ({share(f.intros.advanced, held, 1)})
        {f.intros.signed ? (
          <>
            {" "}
            and{" "}
            <span className="font-semibold tabular-nums">
              {count(f.intros.signed)}
            </span>{" "}
            signed without one
          </>
        ) : null}
        .
      </p>
      <div
        role="img"
        aria-label={PARTS.map(p => `${p.label}: ${parts[p.key]}`).join(", ")}
        className="flex h-3 w-full overflow-hidden rounded-full bg-[color:color-mix(in_oklch,var(--foreground)_6%,transparent)]"
      >
        {PARTS.map(p =>
          parts[p.key] ? (
            <span
              key={p.key}
              className={`h-full first:rounded-s-full last:rounded-e-full ${p.dashed ? "border border-dashed border-[color:var(--muted-foreground)]" : ""}`}
              style={{
                width: `${(100 * parts[p.key]) / held}%`,
                background: p.color,
              }}
            />
          ) : null,
        )}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {PARTS.map(p =>
          parts[p.key] ? (
            <li key={p.key} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className={`size-2.5 rounded-[3px] ${p.dashed ? "border border-dashed border-[color:var(--muted-foreground)]" : ""}`}
                style={{ background: p.color }}
              />
              <span className="muted">{p.label}</span>
              <span className="font-semibold tabular-nums">
                {count(parts[p.key])}
              </span>
            </li>
          ) : null,
        )}
      </ul>
    </div>
  );
}

function Reasons({ f }: { f: Funnel }) {
  const given = f.reasons.filter(r => r.why !== "none");
  const top = Math.max(1, ...f.reasons.map(r => r.n));
  if (!f.intros.stalled) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Why no demo</h3>
      {given.length ? (
        <ul className="space-y-1.5">
          {given.map(r => (
            <li
              key={r.why}
              className="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)_2rem] items-center gap-3 text-xs"
            >
              <span className="truncate">
                {reasonLabel(r.why)}
                {r.why === "signed" ? " (no form yet)" : ""}
              </span>
              <span className="h-1.5 rounded-full bg-[color:color-mix(in_oklch,var(--foreground)_6%,transparent)]">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${(100 * r.n) / top}%`,
                    background:
                      r.why === "disqualified"
                        ? "color-mix(in oklch, var(--foreground) 30%, transparent)"
                        : "var(--warning)",
                  }}
                />
              </span>
              <span className="text-right font-semibold tabular-nums">
                {r.n}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted text-xs">No reason has been given yet.</p>
      )}
      {f.disqualified_why.length ? (
        <p className="muted text-xs">
          Disqualified:{" "}
          {f.disqualified_why.map((d, i) => (
            <span key={d.why}>
              {i ? ", " : ""}
              <bdi>{d.why}</bdi> {d.n}
            </span>
          ))}
          .
        </p>
      ) : null}
      {f.others.length ? (
        <ul className="muted space-y-0.5 text-xs">
          {f.others.slice(0, 5).map(o => (
            <li key={`${o.contact_id}-${o.start_at}`}>
              Other: “<bdi>{o.note}</bdi>” ({o.contact_name ?? "a lead"},{" "}
              {when(o.start_at)})
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Missing({ f }: { f: Funnel }) {
  if (!f.missing.length) return null;
  return (
    <div className="space-y-2 rounded-[var(--radius-lg)] border border-dashed hairline p-3">
      <h3 className="text-sm font-medium">
        {f.missing.length === 1
          ? "1 held intro has no demo and no reason yet"
          : `${f.missing.length} held intros have no demo and no reason yet`}
      </h3>
      <p className="muted text-xs">
        Open the lead and choose why under the intro. A demo booked later takes
        it off this list by itself.
      </p>
      <ul className="divide-y hairline text-sm">
        {f.missing.map(m => (
          <li
            key={m.appointment_id}
            className="flex min-w-0 items-center justify-between gap-3 py-1.5"
          >
            <Link
              to={`/lead/${encodeURIComponent(m.contact_id ?? "")}`}
              className="min-w-0 truncate font-medium hover:text-[color:var(--primary)] hover:underline"
              dir="auto"
            >
              {m.contact_name ?? "A lead"}
            </Link>
            <span className="muted shrink-0 text-xs">
              {when(m.start_at)}
              {m.status === "confirmed" ? " · not marked yet" : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Quality({ f }: { f: Funnel }) {
  const sides = [
    { label: "Intros", q: f.intros.quality },
    { label: "Demos", q: f.demos.quality },
  ];
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Lead quality, 1 to 10</h3>
      <div className="grid grid-cols-1 gap-3 @md:grid-cols-2">
        {sides.map(({ label, q }) => (
          <div
            key={label}
            className="rounded-[var(--radius-lg)] bg-[color:var(--secondary)] p-4"
          >
            <p className="muted text-xs">{label}</p>
            <div className="mt-1.5 flex items-center gap-3">
              <span className="text-2xl font-semibold leading-8 tabular-nums">
                {q?.average ?? "n/a"}
              </span>
              <QualityGauge value={q?.average ?? null} size="md" />
            </div>
            <p className="muted mt-1 text-xs">
              {q?.rated
                ? `${q.rated} of ${q.held} held rated`
                : q?.held
                  ? `None of ${q.held} held rated yet`
                  : "None held yet"}
            </p>
          </div>
        ))}
      </div>
      {f.quality_by_role.length ? (
        <p className="muted text-xs">
          {[...f.quality_by_role]
            .sort(
              (a, b) =>
                Number(b.call_type === "intro") -
                  Number(a.call_type === "intro") ||
                ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role),
            )
            .map((r, i) => (
              <span key={`${r.role}-${r.call_type}`}>
                {i ? " · " : ""}
                {ROLE[r.role] ?? r.role} on {r.call_type}s:{" "}
                <span className="font-semibold text-[color:var(--foreground)] tabular-nums">
                  {r.average ?? "n/a"}
                </span>{" "}
                ({r.rated})
              </span>
            ))}
        </p>
      ) : null}
    </div>
  );
}

export function NumbersIntros({
  funnel,
  error,
  reload,
  loading,
  team,
}: {
  funnel: Funnel | null;
  error: string | null;
  reload: () => void;
  loading: boolean;
  team: boolean;
}) {
  if (error)
    return (
      <SectionCard title="Intros and demos">
        <Failed what="Intros and demos" error={error} retry={reload} />
      </SectionCard>
    );
  if (!funnel)
    return (
      <SectionCard title="Intros and demos">
        {loading ? <Reading what="the intros and demos" /> : null}
      </SectionCard>
    );
  const f = funnel;
  return (
    <SectionCard title="Intros and demos">
      <div className="@container space-y-6">
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Intros</h3>
          <div className="grid grid-cols-2 gap-3 @md:grid-cols-3 @2xl:grid-cols-6">
            <StatTile
              variant="plain"
              label="Booked"
              value={count(f.intros.booked)}
              hint="Intros booked in this window, whatever day they are for."
            />
            <StatTile
              variant="plain"
              label="Due"
              value={count(f.intros.due)}
              sub={f.intros.ahead ? `${f.intros.ahead} still ahead` : undefined}
              hint="Intros set for a day in this window whose time has passed."
            />
            <StatTile
              variant="plain"
              label="Held"
              value={count(f.intros.shown)}
              sub={`${share(f.intros.shown, f.intros.due, 1)} show rate`}
              hint="Marked showed, or confirmed or disqualified once past (B2B's rule). A past intro nobody marked counts until it is marked."
            />
            <StatTile
              variant="plain"
              label="No-shows"
              value={count(f.intros.noshow)}
              sub={`${count(f.intros.cancelled)} cancelled`}
            />
            <StatTile
              variant="plain"
              label="Turned into demos"
              value={count(f.intros.advanced)}
              sub={`${share(f.intros.advanced, f.intros.shown, 1)} of held`}
              hint="Held intros whose lead has a demo booked at or after the intro."
            />
            <StatTile
              variant="plain"
              label="Signed on the intro"
              value={count(f.intros.signed)}
              sub="no demo needed"
              hint="Held intros with no demo whose lead sent the New Client Form after it."
            />
          </div>
        </div>

        <IntroSplit f={f} />
        <Reasons f={f} />
        <Missing f={f} />

        <div className="space-y-2">
          <h3 className="text-sm font-medium">Demos</h3>
          <div className="grid grid-cols-2 gap-3 @md:grid-cols-3 @2xl:grid-cols-6">
            <StatTile
              variant="plain"
              label="Booked"
              value={count(f.demos.booked)}
              hint="Demos booked in this window, whatever day they are for."
            />
            <StatTile
              variant="plain"
              label="Due"
              value={count(f.demos.due)}
              sub={f.demos.ahead ? `${f.demos.ahead} still ahead` : undefined}
            />
            <StatTile
              variant="plain"
              label="Held"
              value={count(f.demos.shown)}
              sub={`${share(f.demos.shown, f.demos.due, 1)} show rate`}
            />
            <StatTile
              variant="plain"
              label="No-shows"
              value={count(f.demos.noshow)}
              sub={`${count(f.demos.cancelled)} cancelled`}
            />
            <StatTile
              variant="plain"
              label="Disqualified"
              value={count(f.demos.disqualified)}
              sub={`${count(f.demos.qualified)} qualified`}
            />
            {team && f.closes !== null ? (
              <StatTile
                variant="plain"
                label="Signed"
                value={count(f.closes)}
                sub={`${share(f.closes, f.demos.shown, 1)} of demos held`}
                hint="New Client Forms sent in this window, voided ones out."
              />
            ) : null}
          </div>
        </div>

        <Quality f={f} />
      </div>
      <SourceNote>
        <p>
          The cockpit's copy of B2B's calls, read live. Shown is B2B's rule:
          marked showed, or confirmed or disqualified once the call time has
          passed; a past call nobody marked counts as held until it is marked
          {f.intros.unmarked
            ? ` (${f.intros.unmarked} intro${f.intros.unmarked === 1 ? "" : "s"} in this window)`
            : ""}
          . A mark made here counts at once; B2B's dashboard catches up within
          20 minutes. A call HighLevel changed after the mark reads as HighLevel
          has it.
        </p>
        <p>
          Turned into a demo: the lead has a demo booked at or after the intro,
          as B2B counts it, with 30 minutes of grace for an intro held a little
          early that booked the demo on the call (B2B's own rule misses those).
          Signed on the intro: no demo, and a New Client Form at or after the
          intro, voided ones out.
        </p>
        <p>
          Reasons and lead quality are what the rep chose after the call. Lead
          quality averages the held calls rated in this window; the setter's and
          the closer's are shown apart.
        </p>
      </SourceNote>
    </SectionCard>
  );
}
