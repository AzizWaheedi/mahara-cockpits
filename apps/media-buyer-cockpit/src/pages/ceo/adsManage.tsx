import { useAction } from "convex/react";
import { Check, ChevronDown, Loader2, Plus, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { money } from "@/components/ceo/format";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";
import type { B2bAdsPayload } from "../../../convex/ceo/payloads";

/**
 * Everything Ads Manager can do to Mahara's own account, done from the row it
 * belongs to.
 *
 * Aziz, 2026-09-22: "I should be able to do literally everything I can do on
 * Meta itself... not just launch a new campaign."
 *
 * The panel opens under the row rather than over the screen, because the
 * numbers you are deciding from are on that row and a dialog would hide them.
 * Nothing here writes until the last button, everything it writes lands
 * paused, and the switch that turns it on is the one already on the row,
 * which re-reads Meta rather than trusting the write.
 */

export type Mode =
  | "newAdset"
  | "newAds"
  | "budget"
  | "audience"
  | "rename"
  | "duplicate"
  | "schedule";

export type Target = {
  level: "campaign" | "adset" | "ad";
  id: string;
  name: string;
  mode: Mode;
};

const MODE_TITLE: Record<Mode, string> = {
  newAdset: "Add an ad set",
  newAds: "Add ads",
  budget: "Change the budget",
  audience: "Change the audience",
  rename: "Rename",
  duplicate: "Duplicate the ad set",
  schedule: "Stop delivering on a date",
};

// biome-ignore lint/suspicious/noExplicitAny: Meta payloads are untyped
type Any = Record<string, any>;

function today(): string {
  return new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
}

const field =
  "w-full rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const label = "text-xs font-medium text-muted-foreground";

/**
 * One labelled field. The label is a heading rather than a `<label>` element
 * because a row can hold two controls (an age range is two numbers), and a
 * label that points at one of them would be read out for the other. Every
 * control inside carries its own `aria-label`.
 */
function Row({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1">
      <span className={label}>{title}</span>
      {children}
      {hint ? (
        <span className="text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  );
}

/** Every ad on the account, newest spend first, for cloning and for media. */
function allAds(p: B2bAdsPayload) {
  return p.campaigns.flatMap(c =>
    c.adsets.flatMap(s =>
      s.ads.map(a => ({
        id: a.id,
        name: a.name,
        campaign: c.name,
        adset: s.name,
        type: c.type,
        spend: a.w30.spend,
        cpl: a.w30.cpl,
        running: a.running,
      })),
    ),
  );
}

// --- the copy studio -------------------------------------------------------

type Idea = {
  angle: string;
  headline: string;
  primaryText: string;
  approved: boolean;
};

function CopyStudio({
  adsetId,
  ideas,
  setIdeas,
}: {
  adsetId: string;
  ideas: Idea[];
  setIdeas: (x: Idea[]) => void;
}) {
  const copyIdeas = useAction(api.ceo.b2bManage.copyIdeas);
  const [brief, setBrief] = useState("");
  const [language, setLanguage] = useState<"ar" | "en">("ar");
  const [count, setCount] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res: Any = await copyIdeas({
        adsetId,
        brief,
        language,
        count,
      });
      setIdeas(
        (res.ideas ?? []).map((x: Any) => ({
          angle: String(x.angle ?? ""),
          headline: String(x.headline ?? ""),
          primaryText: String(x.primaryText ?? ""),
          approved: false,
        })),
      );
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e).slice(0, 300));
    } finally {
      setBusy(false);
    }
  };

  const edit = (i: number, patch: Partial<Idea>) =>
    setIdeas(ideas.map((x, n) => (n === i ? { ...x, ...patch } : x)));

  return (
    <div className="grid gap-3">
      <Row
        title="Brief"
        hint="Who it is for and what it promises. The angles stay in the territory of the ads already in this set."
      >
        <textarea
          aria-label="Brief"
          dir="auto"
          className={`${field} min-h-[72px]`}
          value={brief}
          onChange={e => setBrief(e.target.value)}
          placeholder="Owners of fit-out and interior firms in Kuwait who are tired of chasing referrals."
        />
      </Row>
      <div className="flex flex-wrap items-end gap-3">
        <Row title="Language">
          <AnimatedSelect
            aria-label="Language"
            className={field}
            value={language}
            onChange={e => setLanguage(e.target.value as "ar" | "en")}
          >
            <option value="ar">Arabic</option>
            <option value="en">English</option>
          </AnimatedSelect>
        </Row>
        <Row title="Angles">
          <AnimatedSelect
            aria-label="How many angles"
            className={field}
            value={count}
            onChange={e => setCount(Number(e.target.value))}
          >
            {[3, 4, 5].map(n => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </AnimatedSelect>
        </Row>
        <Button
          type="button"
          disabled={busy || brief.trim().length < 12}
          onClick={generate}
        >
          {busy ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <Sparkles aria-hidden />
          )}
          {busy ? "Writing" : ideas.length ? "Write more" : "Write angles"}
        </Button>
      </div>
      {error ? (
        <p className="text-sm text-[var(--ceo-critical)]">{error}</p>
      ) : null}
      {ideas.length ? (
        <div className="grid gap-2">
          <p className="text-xs text-muted-foreground">
            {`${ideas.filter(i => i.approved).length} of ${ideas.length} approved. Edit anything before you approve it; only the approved ones become ads.`}
          </p>
          <div className="divide-y">
            {ideas.map((idea, i) => (
              <div
                key={`${idea.headline}-${i}`}
                className="grid gap-2 py-3 first:pt-0 last:pb-0"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 text-xs text-muted-foreground">
                    {idea.angle || `Angle ${i + 1}`}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-pressed={idea.approved}
                    className={cn(
                      idea.approved &&
                        "border-transparent bg-primary/15 text-foreground ring-1 ring-inset ring-primary/40 hover:bg-primary/20",
                    )}
                    onClick={() => edit(i, { approved: !idea.approved })}
                  >
                    {idea.approved ? <Check aria-hidden /> : null}
                    {idea.approved ? "Approved" : "Approve"}
                  </Button>
                </div>
                <input
                  className={field}
                  dir="auto"
                  value={idea.headline}
                  onChange={e => edit(i, { headline: e.target.value })}
                  aria-label="Headline"
                />
                <textarea
                  className={`${field} min-h-[64px]`}
                  dir="auto"
                  value={idea.primaryText}
                  onChange={e => edit(i, { primaryText: e.target.value })}
                  aria-label="Primary text"
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// --- the panel -------------------------------------------------------------

export function ManagePanel({
  target,
  payload,
  onClose,
  onDone,
}: {
  target: Target;
  payload: B2bAdsPayload;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const inspect = useAction(api.ceo.b2bManage.inspect);
  const createAdset = useAction(api.ceo.b2bManage.createAdset);
  const createAds = useAction(api.ceo.b2bManage.createAds);
  const setBudget = useAction(api.ceo.b2bManage.setBudget);
  const renameIt = useAction(api.ceo.b2bManage.rename);
  const duplicateAdset = useAction(api.ceo.b2bManage.duplicateAdset);
  const setSchedule = useAction(api.ceo.b2bManage.setSchedule);
  const setAudience = useAction(api.ceo.b2bManage.setAudience);

  const [live, setLive] = useState<Any | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state, shared across modes; only the fields a mode shows are read.
  const [name, setName] = useState("");
  const [budget, setBudget_] = useState("");
  const [copyFrom, setCopyFrom] = useState("");
  const [countries, setCountries] = useState("");
  const [ageMin, setAgeMin] = useState("");
  const [ageMax, setAgeMax] = useState("");
  const [withAds, setWithAds] = useState(true);
  const [endTime, setEndTime] = useState("");
  const [clones, setClones] = useState<string[]>([]);
  const [mediaFrom, setMediaFrom] = useState("");
  const [ideas, setIdeas] = useState<Idea[]>([]);

  const campaign = useMemo(
    () =>
      payload.campaigns.find(
        c =>
          c.id === target.id ||
          c.adsets.some(
            s => s.id === target.id || s.ads.some(a => a.id === target.id),
          ),
      ) ?? null,
    [payload, target.id],
  );
  const ads = useMemo(() => allAds(payload), [payload]);
  const sameKind = useMemo(
    () =>
      ads
        .filter(a => !campaign || a.type === campaign.type)
        .sort((a, b) => b.spend - a.spend),
    [ads, campaign],
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    inspect({ metaId: target.id, level: target.level })
      .then((o: Any) => {
        if (!alive) return;
        setLive(o);
        setName(
          target.mode === "newAdset"
            ? `${
                String(o.name ?? "")
                  .split("|")[0]
                  .trim() || "Mahara"
              } | new set | ${today()}`
            : target.mode === "duplicate"
              ? `${String(o.name ?? "Ad set")} | copy ${today()}`
              : String(o.name ?? ""),
        );
        setBudget_(
          o.dailyBudgetUsd !== null && o.dailyBudgetUsd !== undefined
            ? String(o.dailyBudgetUsd)
            : "",
        );
        setEndTime(o.endTime ? String(o.endTime).slice(0, 10) : "");
        if (target.mode === "audience") {
          setCountries((o.audience?.countries ?? []).join(", "));
          setAgeMin(o.audience?.ageMin ? String(o.audience.ageMin) : "");
          setAgeMax(o.audience?.ageMax ? String(o.audience.ageMax) : "");
        }
      })
      .catch(e => {
        if (alive)
          setError(String(e instanceof Error ? e.message : e).slice(0, 300));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // The action identity changes every render; the target is what matters.
  }, [target.id, target.level, target.mode]);

  // The ad set whose audience a new ad set copies: the campaign's biggest.
  useEffect(() => {
    if (target.mode !== "newAdset" || copyFrom) return;
    const best = campaign?.adsets[0]?.id ?? "";
    if (best) setCopyFrom(best);
  }, [target.mode, campaign, copyFrom]);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    try {
      onDone(await fn());
      onClose();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e).slice(0, 400));
    } finally {
      setBusy(false);
    }
  };

  const approved = ideas.filter(i => i.approved);

  return (
    <div className="@container grid gap-4 rounded-xl bg-muted/40 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{MODE_TITLE[target.mode]}</p>
          <p className="truncate text-xs text-muted-foreground">
            {target.name}
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>

      {loading ? (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Reading it from Meta
        </p>
      ) : null}

      {!loading && target.mode === "rename" ? (
        <div className="grid gap-3">
          <Row
            title="Name"
            hint={
              target.level === "campaign"
                ? 'The campaign name is what files it as lead gen or retargeting. A retargeting campaign must keep the word "Retargeting".'
                : undefined
            }
          >
            <input
              aria-label="Name"
              className={field}
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </Row>
          <div>
            <Button
              type="button"
              disabled={busy || !name.trim()}
              onClick={() =>
                run(async () => {
                  await renameIt({
                    metaId: target.id,
                    level: target.level,
                    name,
                  });
                  return `Renamed to "${name}". The next refresh re-reads Meta.`;
                })
              }
            >
              {busy ? "Saving" : "Save the name"}
            </Button>
          </div>
        </div>
      ) : null}

      {!loading && target.mode === "budget" ? (
        <div className="grid gap-3">
          <p className="text-sm text-muted-foreground">
            {live?.budgetIsOnCampaign
              ? "This campaign holds the budget for all its ad sets, so change it on the campaign."
              : live?.dailyBudgetUsd
                ? `Now ${money(Number(live.dailyBudgetUsd))} a day.`
                : live?.lifetimeBudgetUsd
                  ? `Now ${money(Number(live.lifetimeBudgetUsd))} over the life of it.`
                  : "No budget set here yet."}
          </p>
          <Row
            title="Daily budget, USD"
            hint="Meta restarts the learning phase over about a 20% move, and the days just after it cost more per result."
          >
            <input
              aria-label="Daily budget in US dollars"
              className={field}
              type="number"
              min={1}
              step={1}
              value={budget}
              onChange={e => setBudget_(e.target.value)}
            />
          </Row>
          <div>
            <Button
              type="button"
              disabled={
                busy ||
                !(Number(budget) >= 1) ||
                Boolean(live?.budgetIsOnCampaign)
              }
              onClick={() =>
                run(async () => {
                  const res: Any = await setBudget({
                    metaId: target.id,
                    level: target.level === "campaign" ? "campaign" : "adset",
                    dailyUsd: Number(budget),
                  });
                  return `${money(Number(budget))} a day on "${target.name}".${res?.warning ? ` ${res.warning}` : ""}`;
                })
              }
            >
              {busy ? "Saving" : "Set the budget"}
            </Button>
          </div>
        </div>
      ) : null}

      {!loading && target.mode === "schedule" ? (
        <div className="grid gap-3">
          <Row
            title="Stop delivering on"
            hint="Leave it empty to run until it is switched off."
          >
            <DateInput
              aria-label="Stop delivering on"
              className={field}
              min={today()}
              value={endTime}
              onChange={e => setEndTime(e.target.value)}
            />
          </Row>
          <div>
            <Button
              type="button"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await setSchedule({
                    adsetId: target.id,
                    endTime: endTime ? `${endTime}T23:59:59+0300` : "",
                  });
                  return endTime
                    ? `"${target.name}" stops on ${endTime}.`
                    : `"${target.name}" has no end date any more.`;
                })
              }
            >
              {busy
                ? "Saving"
                : endTime
                  ? "Set the end date"
                  : "Remove the end date"}
            </Button>
          </div>
        </div>
      ) : null}

      {!loading && target.mode === "audience" ? (
        <div className="grid gap-3">
          <p className="text-sm text-muted-foreground">
            {live?.audience
              ? `Now ${live.audience.countries?.length ? live.audience.countries.join(", ") : "no country set"}, ages ${live.audience.ageMin ?? 18} to ${live.audience.ageMax ?? 65}, ${live.audience.genders}${live.audience.detailed ? `, ${live.audience.detailed} detailed interests` : ""}${live.audience.custom ? `, ${live.audience.custom} saved audiences` : ""}.`
              : "Meta did not return this audience."}
          </p>
          <div className="grid gap-3 @lg:grid-cols-2">
            <Row title="Countries" hint="Two-letter codes. Blank keeps them.">
              <input
                aria-label="Countries"
                className={field}
                value={countries}
                onChange={e => setCountries(e.target.value)}
                placeholder="KW, SA, AE"
              />
            </Row>
            <Row title="Age" hint="Blank keeps it.">
              <span className="flex items-center gap-2">
                <input
                  className={field}
                  type="number"
                  min={18}
                  max={65}
                  value={ageMin}
                  onChange={e => setAgeMin(e.target.value)}
                  aria-label="Youngest"
                />
                <span className="text-xs text-muted-foreground">to</span>
                <input
                  className={field}
                  type="number"
                  min={18}
                  max={65}
                  value={ageMax}
                  onChange={e => setAgeMax(e.target.value)}
                  aria-label="Oldest"
                />
              </span>
            </Row>
          </div>
          <p className="text-xs text-muted-foreground">
            Saved audiences, interests and exclusions are left exactly as Meta
            has them. Change those in Ads Manager, where you can see the size
            estimate as you go.
          </p>
          <div>
            <Button
              type="button"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const res: Any = await setAudience({
                    adsetId: target.id,
                    countries: countries
                      .split(/[,\s]+/)
                      .map(x => x.trim())
                      .filter(Boolean),
                    ageMin: Number(ageMin) || undefined,
                    ageMax: Number(ageMax) || undefined,
                  });
                  return String(res?.note ?? "Audience changed.");
                })
              }
            >
              {busy ? "Saving" : "Change the audience"}
            </Button>
          </div>
        </div>
      ) : null}

      {!loading && target.mode === "duplicate" ? (
        <div className="grid gap-3">
          <Row title="Name of the copy">
            <input
              aria-label="Name"
              className={field}
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </Row>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={withAds}
              onChange={e => setWithAds(e.target.checked)}
            />
            Copy its ads too
          </label>
          <div>
            <Button
              type="button"
              disabled={busy || !name.trim()}
              onClick={() =>
                run(async () => {
                  const res: Any = await duplicateAdset({
                    adsetId: target.id,
                    name,
                    withAds,
                  });
                  return String(res?.note ?? "Duplicated, paused.");
                })
              }
            >
              {busy ? "Copying" : "Duplicate it, paused"}
            </Button>
          </div>
        </div>
      ) : null}

      {!loading && target.mode === "newAdset" ? (
        <div className="grid gap-3">
          <Row title="Name">
            <input
              aria-label="Name"
              className={field}
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </Row>
          <Row
            title="Copy the audience from"
            hint="Targeting, optimisation goal, billing event and pixel event are copied whole. Typing an audience by hand is how a campaign quietly starts buying the wrong people."
          >
            <AnimatedSelect
              aria-label="Copy the audience from"
              className={field}
              value={copyFrom}
              onChange={e => setCopyFrom(e.target.value)}
            >
              <option value="">Pick an ad set</option>
              {payload.campaigns.flatMap(c =>
                c.adsets.map(s => (
                  <option key={s.id} value={s.id}>
                    {`${s.name}, ${money(s.w30.spend)} in 30 days`}
                  </option>
                )),
              )}
            </AnimatedSelect>
          </Row>
          <div className="grid gap-3 @xl:grid-cols-3">
            <Row
              title="Daily budget, USD"
              hint={
                live?.budgetIsHere
                  ? "This campaign shares one budget across its ad sets, so the new one gets none of its own."
                  : undefined
              }
            >
              <input
                aria-label="Daily budget in US dollars"
                className={field}
                type="number"
                min={1}
                step={1}
                disabled={Boolean(live?.budgetIsHere)}
                value={live?.budgetIsHere ? "" : budget}
                onChange={e => setBudget_(e.target.value)}
              />
            </Row>
            <Row title="Countries" hint="Blank keeps the source's.">
              <input
                aria-label="Countries"
                className={field}
                value={countries}
                onChange={e => setCountries(e.target.value)}
                placeholder="KW, SA, AE"
              />
            </Row>
            <Row title="Age" hint="Blank keeps the source's.">
              <span className="flex items-center gap-2">
                <input
                  className={field}
                  type="number"
                  min={18}
                  max={65}
                  value={ageMin}
                  onChange={e => setAgeMin(e.target.value)}
                  aria-label="Youngest"
                />
                <span className="text-xs text-muted-foreground">to</span>
                <input
                  className={field}
                  type="number"
                  min={18}
                  max={65}
                  value={ageMax}
                  onChange={e => setAgeMax(e.target.value)}
                  aria-label="Oldest"
                />
              </span>
            </Row>
          </div>
          <div>
            <Button
              type="button"
              disabled={
                busy ||
                !name.trim() ||
                !copyFrom ||
                (!live?.budgetIsHere && !(Number(budget) >= 1))
              }
              onClick={() =>
                run(async () => {
                  const res: Any = await createAdset({
                    campaignId: target.id,
                    name,
                    dailyBudgetUsd: Number(budget) || 0,
                    copyFromAdsetId: copyFrom,
                    countries: countries
                      .split(/[,\s]+/)
                      .map(x => x.trim())
                      .filter(Boolean),
                    ageMin: Number(ageMin) || undefined,
                    ageMax: Number(ageMax) || undefined,
                  });
                  return `Added "${name}". ${String(res?.note ?? "")}`;
                })
              }
            >
              {busy ? "Adding" : "Add the ad set, paused"}
            </Button>
          </div>
        </div>
      ) : null}

      {!loading && target.mode === "newAds" ? (
        <div className="grid gap-4">
          <div className="grid gap-2">
            <p className={label}>Reuse an ad that already works</p>
            <div className="max-h-56 divide-y overflow-auto rounded-lg border bg-background">
              {sameKind.slice(0, 40).map(a => (
                <label
                  key={a.id}
                  className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted/40"
                >
                  <input
                    type="checkbox"
                    checked={clones.includes(a.id)}
                    onChange={e =>
                      setClones(x =>
                        e.target.checked
                          ? [...x, a.id]
                          : x.filter(y => y !== a.id),
                      )
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{a.name}</span>
                    <span className="block text-xs tabular-nums text-muted-foreground">
                      {`${money(a.spend)} · ${a.cpl === null ? "no leads" : `${money(a.cpl)} a lead`}`}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            <p className={label}>Write new angles for this ad set</p>
            <CopyStudio adsetId={target.id} ideas={ideas} setIdeas={setIdeas} />
          </div>

          {approved.length ? (
            <Row
              title="The new copy rides this ad's video"
              hint="Meta needs a video or image for a new ad. Leave it on the first ticked ad unless you want another one's footage."
            >
              <AnimatedSelect
                aria-label="Which ad's video the new copy rides"
                className={field}
                value={mediaFrom}
                onChange={e => setMediaFrom(e.target.value)}
              >
                <option value="">
                  {clones.length
                    ? "The first ad ticked above"
                    : "An ad already in this set"}
                </option>
                {sameKind.slice(0, 40).map(a => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </AnimatedSelect>
            </Row>
          ) : null}

          <div>
            <Button
              type="button"
              disabled={busy || (!clones.length && !approved.length)}
              onClick={() =>
                run(async () => {
                  const res: Any = await createAds({
                    adsetId: target.id,
                    cloneAdIds: clones,
                    variants: approved.map(i => ({
                      headline: i.headline,
                      primaryText: i.primaryText,
                      angle: i.angle,
                    })),
                    mediaFromAdId: mediaFrom || undefined,
                  });
                  const made = Number(res?.made ?? 0);
                  const problems: string[] = res?.problems ?? [];
                  return `${made} paused ${made === 1 ? "ad" : "ads"} added to "${target.name}". Switch them on from the row when you have read them.${problems.length ? ` ${problems.join(" · ")}` : ""}`;
                })
              }
            >
              {busy
                ? "Adding"
                : `Add ${clones.length + approved.length || ""} ${clones.length + approved.length === 1 ? "ad" : "ads"}, paused`}
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="text-sm text-[var(--ceo-critical)]">{error}</p>
      ) : null}
    </div>
  );
}

const MODE_LABEL: Record<Mode, string> = {
  newAdset: "Ad set",
  newAds: "Ads",
  budget: "Budget",
  audience: "Audience",
  rename: "Rename",
  duplicate: "Duplicate",
  schedule: "End date",
};

/** A row action pill; the one whose panel is open reads teal. */
function pill(active: boolean) {
  return cn(
    "inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active
      ? "bg-primary/15 text-foreground ring-1 ring-inset ring-primary/40"
      : "text-muted-foreground ring-1 ring-inset ring-border hover:bg-muted hover:text-foreground",
  );
}

/**
 * The small toolbar that opens the panel for a row: three pills at most, and
 * the rest of an ad set's actions under "More", so a row never carries a
 * wrapping line of six.
 */
export function ManageBar({
  level,
  id,
  name,
  open,
  onOpen,
  frozen,
}: {
  level: "campaign" | "adset" | "ad";
  id: string;
  name: string;
  open: Target | null;
  onOpen: (t: Target | null) => void;
  /** Meta will not accept a write while the ad account is not in good standing. */
  frozen?: string | null;
}) {
  // The card above the rows says it once; repeating it on every row would
  // bury the numbers under the same sentence thirty times.
  if (frozen) return null;
  const modes: Mode[] =
    level === "campaign"
      ? ["newAdset", "rename", "budget"]
      : level === "adset"
        ? ["newAds", "budget", "audience", "duplicate", "schedule", "rename"]
        : ["rename"];
  const inline = modes.length > 3 ? modes.slice(0, 2) : modes;
  const more = modes.length > 3 ? modes.slice(2) : [];
  const isOpen = (m: Mode) => open?.id === id && open?.mode === m;
  const toggle = (m: Mode) =>
    onOpen(isOpen(m) ? null : { level, id, name, mode: m });
  const moreOpen = more.find(isOpen);
  return (
    <div
      role="group"
      aria-label={`Change this ${level === "adset" ? "ad set" : level}`}
      className="flex flex-wrap items-center gap-1.5"
    >
      {inline.map(m => (
        <button
          key={m}
          type="button"
          aria-pressed={isOpen(m)}
          className={pill(isOpen(m))}
          onClick={e => {
            e.stopPropagation();
            toggle(m);
          }}
        >
          {m === "newAdset" || m === "newAds" ? (
            <Plus className="size-3.5" aria-hidden />
          ) : null}
          {MODE_LABEL[m]}
        </button>
      ))}
      {more.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={pill(Boolean(moreOpen))}>
              {moreOpen ? MODE_LABEL[moreOpen] : "More"}
              <ChevronDown className="size-3.5" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {more.map(m => (
              <DropdownMenuItem key={m} onSelect={() => toggle(m)}>
                {MODE_LABEL[m]}
                {isOpen(m) ? (
                  <Check className="ml-auto size-4" aria-label="Open" />
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
