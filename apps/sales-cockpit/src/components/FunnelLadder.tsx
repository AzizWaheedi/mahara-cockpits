import {
  CURRENCIES,
  type Currency,
  type Funnel,
  gapFor,
  type Step,
  sayMany,
  sayMoney,
  sayPct,
  stepWords,
  wholeFunnel,
} from "../lib/funnel";
import { AnimatedSelect, SectionCard, SourceNote } from "./kit";

/**
 * The prospect's funnel on the call, top to bottom the way the closer asks
 * it: ad spend, inquiries, meetings booked, meetings held, projects signed.
 * Between each two rungs is the step's rate as a bar with our number as a
 * teal tick, so the leak is visible before it is read; the one step that
 * leaks the most is named, with what fixing only it is worth. A rung they
 * have not given a number for says so and is never drawn as zero.
 */

const PROBLEM_WORDS: Record<Funnel["problems"][number], string> = {
  booked_over_leads:
    "More meetings booked than inquiries. Check both numbers; booking is left out of the gap.",
  showed_over_booked:
    "More meetings held than booked. Check both numbers; show-up is left out of the gap.",
  closed_over_showed:
    "More projects signed than meetings held. Check both numbers; closing is left out of the gap.",
  ad_leads_over_leads:
    "More inquiries from ads than in all. Inquiries a month should count every source.",
};

const RUNG = "flex items-baseline justify-between gap-3 py-1.5 text-sm";

function money(n: number | null, f: Funnel): string | null {
  return n == null ? null : sayMoney(n, f.currency, "en");
}

function Missing({ ask }: { ask: string }) {
  return (
    <span className="muted whitespace-nowrap text-xs" title={`Ask for ${ask}`}>
      not given yet
    </span>
  );
}

function Rung({
  label,
  value,
  ask,
}: {
  label: string;
  value: string | null;
  ask: string;
}) {
  return (
    <div className={RUNG}>
      <span className="whitespace-nowrap font-medium">{label}</span>
      {value == null ? (
        <Missing ask={ask} />
      ) : (
        <span className="tabular-nums">{value}</span>
      )}
    </div>
  );
}

function Rail({
  step,
  name,
  leak,
}: {
  step: Step;
  name: string;
  leak: boolean;
}) {
  const theirs = step.theirs;
  const impossible = step.standing === "impossible";
  const width = theirs == null ? 0 : Math.min(theirs, 1) * 100;
  const color = impossible
    ? "var(--destructive)"
    : step.standing === "behind"
      ? "var(--warning)"
      : "var(--success)";
  return (
    <div
      className={`ms-3 rounded-[12px] border-s-2 py-2 ps-3 transition-colors ${
        leak
          ? "border-amber-400 bg-amber-500/10 shadow-sm"
          : "hairline hover:bg-white/[0.02]"
      }`}
      style={leak ? { borderColor: "var(--warning)" } : undefined}
    >
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className={leak ? "font-semibold text-amber-300" : "muted"}>
          {name}
        </span>
        <span className="whitespace-nowrap tabular-nums">
          {theirs == null ? null : impossible ? (
            <span style={{ color: "var(--destructive)" }}>over 100% </span>
          ) : (
            <span className="font-semibold text-white">{sayPct(theirs, "en")} </span>
          )}
          <span className="muted">
            {theirs == null ? "" : "/ "}ours {sayPct(step.ours, "en")}
          </span>
        </span>
      </div>
      <div
        className="relative mt-1.5 h-2 rounded-full overflow-hidden border border-white/5"
        style={{ background: "color-mix(in oklch, var(--secondary) 80%, black)" }}
        role="img"
        aria-label={
          theirs == null
            ? `${name}: not worked out yet; ours is ${sayPct(step.ours, "en")}`
            : `${name}: theirs ${sayPct(Math.min(theirs, 9.99), "en")}, ours ${sayPct(step.ours, "en")}`
        }
      >
        {theirs != null ? (
          <div
            className="h-full rounded-full motion-safe:transition-[width] motion-safe:duration-300 shadow-sm"
            style={{ width: `${width}%`, background: color }}
          />
        ) : null}
        <div
          className="absolute -top-0.5 bottom-0 w-1 rounded-full shadow-[0_0_6px_var(--primary)]"
          style={{
            left: `calc(${step.ours * 100}% - 2px)`,
            background: "var(--primary)",
          }}
          aria-hidden
        />
      </div>
      {leak ? (
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-amber-400 animate-pulse" />
          <p className="text-xs font-bold tracking-tight text-amber-300">
            Biggest bottleneck
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function FunnelLadder({
  f,
  onCurrency,
  script,
}: {
  f: Funnel;
  onCurrency: (c: Currency) => void;
  script: "intro" | "demo";
}) {
  const g = f.given;
  const step = (k: Step["key"]) => f.steps.find(s => s.key === k) as Step;
  const ads = step("ads");
  const gap = gapFor(f);
  const whole = script === "demo" ? wholeFunnel(f) : null;
  const perYear = f.closed == null ? null : f.closed * 12;
  const currencyPicker = (
    <label className="muted flex items-center gap-1.5 text-xs">
      <span>Their money in</span>
      <AnimatedSelect
        value={f.currency}
        onChange={e => onCurrency(e.target.value as Currency)}
        className="h-7 rounded-[12px] border border-white/10 bg-[color:var(--card)] px-2 text-xs"
      >
        {CURRENCIES.map(c => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </AnimatedSelect>
    </label>
  );

  if (script === "intro")
    return (
      <SectionCard title="Their numbers so far" side={currencyPicker}>
        <div className="divide-y hairline">
          <div className={RUNG}>
            <span className="font-medium">Cost of an inquiry</span>
            {f.costs.perLead == null ? (
              <Missing ask="ad spend and inquiries from ads" />
            ) : (
              <span className="text-end tabular-nums">
                <span
                  className="font-semibold"
                  style={
                    ads.standing === "behind"
                      ? { color: "var(--warning)" }
                      : undefined
                  }
                >
                  {money(f.costs.perLead, f)}
                </span>
                <span className="muted">
                  {" "}
                  / ours {money(f.ours.perLead, f)}
                </span>
              </span>
            )}
          </div>
          <Rung
            label="Quotes they win"
            value={
              f.rates.quoteWin == null ? null : sayPct(f.rates.quoteWin, "en")
            }
            ask="projects and quotes, 12 months"
          />
          <Rung
            label="Projects a month"
            value={
              g.closed12 == null
                ? null
                : String(Math.round((g.closed12 / 12) * 10) / 10)
            }
            ask="projects closed, 12 months"
          />
          <Rung
            label="Average project"
            value={money(g.aov, f)}
            ask="typical project value"
          />
        </div>
        <p className="muted mt-3 text-xs">
          Don't comment on these on the call. The closer opens the demo with all
          of them filled in.
        </p>
        <Sources f={f} />
      </SectionCard>
    );

  return (
    <SectionCard title="Their numbers" side={currencyPicker}>
      <div>
        <Rung
          label="Ad spend"
          value={g.spend == null ? null : `${money(g.spend, f)} a month`}
          ask="ad spend a month"
        />
        {g.spend ? (
          <div className="ms-3 flex items-baseline justify-between gap-2 border-s-2 hairline py-1 ps-3 text-xs">
            <span className="muted">
              Per inquiry{f.costs.perLeadAllSources ? ", all sources" : ""}
            </span>
            {f.costs.perLead == null ? (
              <span className="muted">needs inquiries from ads</span>
            ) : (
              <span className="tabular-nums">
                <span
                  className="font-semibold"
                  style={
                    ads.standing === "behind"
                      ? { color: "var(--warning)" }
                      : undefined
                  }
                >
                  {money(f.costs.perLead, f)}
                </span>
                <span className="muted">
                  {" "}
                  / ours {money(f.ours.perLead, f)}
                </span>
              </span>
            )}
          </div>
        ) : null}
        <Rung
          label="Inquiries"
          value={
            g.leads == null
              ? null
              : `${g.leads} a month${g.adLeads != null ? `, ${g.adLeads} from ads` : ""}`
          }
          ask="inquiries a month"
        />
        <Rail
          step={step("booking")}
          name="Booked"
          leak={f.leak === "booking"}
        />
        <Rung
          label="Meetings booked"
          value={g.booked == null ? null : String(g.booked)}
          ask="meetings booked a month"
        />
        <Rail step={step("show")} name="Held" leak={f.leak === "show"} />
        <Rung
          label="Meetings held"
          value={g.showed == null ? null : String(g.showed)}
          ask="meetings held a month"
        />
        <Rail step={step("close")} name="Signed" leak={f.leak === "close"} />
        <Rung
          label="Projects signed"
          value={
            f.closed == null
              ? null
              : `${Math.round(f.closed * 10) / 10} a month${f.closedFromYear ? ", from 12 months" : ""}`
          }
          ask="projects signed a month"
        />
        <Rung
          label="Average project"
          value={money(g.aov, f)}
          ask="average project"
        />
      </div>

      {f.problems.length ? (
        <ul
          className="mt-3 space-y-1 text-xs"
          style={{ color: "var(--destructive)" }}
        >
          {f.problems.map(p => (
            <li key={p}>{PROBLEM_WORDS[p]}</li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 border-t hairline pt-3">
        {!f.leak || !gap ? (
          <p className="muted text-sm">
            {g.leads == null
              ? "Walk the funnel from the top and type each number in. The gap appears here as soon as there's enough to work it out."
              : "Add meetings booked, meetings held and projects signed to find the step that leaks the most."}
          </p>
        ) : (
          <>
            <p className="muted text-xs">
              {f.leak === "volume"
                ? "Every step is at or above ours. The gap is volume: twice the inquiries at their own rates."
                : f.leak === "referrals"
                  ? "No funnel numbers yet. The gap is the slow months."
                  : `Fix only ${stepWords(f.leak, "en")}`}
            </p>
            {gap.projectsYear != null ? (
              <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight">
                {gap.moneyYear != null
                  ? `${money(gap.moneyYear, f)} a year`
                  : sayMany(gap.projectsYear, "project", "en", true)}
              </p>
            ) : null}
            <p className="muted text-xs tabular-nums">
              {gap.projectsYear != null
                ? `${sayMany(gap.projectsYear, "project", "en", f.leak !== "referrals")} a year`
                : null}
              {gap.moneyMonth != null
                ? `, ${money(gap.moneyMonth, f)} a month`
                : ""}
              {gap.moneyYear == null
                ? ". Add their average project to put money on it."
                : ""}
            </p>
            {gap.usesOurs ? (
              <p className="muted mt-1 text-xs">
                A later step they gave no number for is counted at ours.
              </p>
            ) : null}
            {gap.big ? (
              <p className="mt-1 text-xs" style={{ color: "var(--warning)" }}>
                That's more than twice what they sign in a year now. It is what
                their numbers say; lead with half of it if it sounds too big.
              </p>
            ) : null}
            {whole &&
            gap.projectsYear != null &&
            whole.projectsYear >= gap.projectsYear + 1 &&
            f.leak !== "volume" ? (
              <p className="muted mt-2 text-xs tabular-nums">
                Every step inside their funnel at ours:{" "}
                {sayMany(whole.projectsYear, "project", "en", true)} a year
                {whole.moneyYear != null
                  ? `, ${money(whole.moneyYear, f)}`
                  : ""}
                {perYear ? ` (they sign about ${Math.round(perYear)} now)` : ""}
                .
              </p>
            ) : null}
          </>
        )}
      </div>
      <Sources f={f} />
    </SectionCard>
  );
}

function Sources({ f }: { f: Funnel }) {
  return (
    <SourceNote>
      <p>
        Theirs is only what they said on this call and on the intro call.
        Nothing is filled in for them: a rung with no number stays empty, and a
        step is worked out only from numbers they gave.
      </p>
      <p>
        Ours are the numbers Mahara holds every client's funnel to: $15 an
        inquiry, $60 a booked meeting, a quarter of inquiries booked, 60% of
        booked meetings held and a fifth of held meetings signed.
      </p>
      <p>
        Their amounts stay in {f.currency}; ours are converted at the Gulf pegs
        (the dinar at 0.3085 a dollar, 27 September 2026). The gap is what one
        step is worth if only that step matched ours, a year at their average
        project.
      </p>
    </SourceNote>
  );
}
