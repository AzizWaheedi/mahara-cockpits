import { useAction } from "convex/react";
import { Rocket } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "@/components/ceo/EmptyState";
import { money, plural } from "@/components/ceo/format";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatusChip, type StatusTone } from "@/components/ceo/StatusChip";
import { api } from "../../../convex/_generated/api";
import type { B2bAdsPayload } from "../../../convex/ceo/payloads";

/**
 * Launch a campaign on Mahara's own account, the way the launch skill says:
 * a brief becomes a draft a person reads and edits, and nothing is created on
 * Meta until "Launch" is pressed. Everything is created paused and switched on
 * from the Ads tab.
 *
 * The first choice is the kind, and it is a hard switch rather than a hint.
 * Lead gen and retargeting copy their settings from different winners, get
 * different objectives, and are named so b2b_campaign_type files them apart.
 */

type Kind = "lead_gen" | "retargeting";

type Variant = { headline: string; primaryText: string };

type Draft = {
  id: number;
  kind: Kind;
  name: string;
  brief: string;
  dailyBudgetUsd: number;
  sourceAdsetName: string | null;
  sourceReason: string | null;
  cloneAdIds: string[];
  variants: Variant[];
  status:
    | "building"
    | "ready"
    | "launching"
    | "launched"
    | "failed"
    | "discarded";
  error: string | null;
  metaCampaignId: string | null;
  metaAdsetId: string | null;
  metaAdIds: string[];
  createdAt: string;
};

const STATUS_TONE: Record<Draft["status"], StatusTone> = {
  building: "neutral",
  ready: "good",
  launching: "warning",
  launched: "good",
  failed: "critical",
  discarded: "neutral",
};

const isArabic = (s: string) => /[؀-ۿ]/.test(s);

export function LaunchCard({
  ads,
  order,
}: {
  ads: B2bAdsPayload | null;
  order?: number;
}) {
  const list = useAction(api.ceo.b2bLaunch.list);
  const build = useAction(api.ceo.b2bLaunch.build);
  const save = useAction(api.ceo.b2bLaunch.save);
  const launch = useAction(api.ceo.b2bLaunch.launch);
  const discard = useAction(api.ceo.b2bLaunch.discard);

  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<Kind>("lead_gen");
  const [brief, setBrief] = useState("");
  const [budget, setBudget] = useState("30");
  const [lang, setLang] = useState<"ar" | "en">("ar");
  const [clone, setClone] = useState<string[]>([]);
  const [edits, setEdits] = useState<Record<number, Partial<Draft>>>({});

  const refresh = useCallback(async () => {
    try {
      setDrafts(await list({}));
      setError(null);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e).slice(0, 240));
    }
  }, [list]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e).slice(0, 240));
    }
    setBusy(false);
  }

  // Winners of the chosen kind, so a retargeting draft can only clone
  // retargeting ads and a lead-gen draft only lead-gen ones.
  const winners = (ads?.campaigns ?? [])
    .filter(c => c.type === kind)
    .flatMap(c => c.adsets.flatMap(s => s.ads))
    .filter(a => a.w30.spend > 0)
    .sort(
      (a, b) =>
        b.w30.closes - a.w30.closes ||
        b.w30.demosShown - a.w30.demosShown ||
        b.w30.leads - a.w30.leads,
    )
    .slice(0, 8);

  const field = "rounded-md border bg-background px-2 py-1.5 text-sm";
  const live = (drafts ?? []).filter(d => d.status !== "discarded");

  return (
    <SectionCard
      id="ads-launch"
      kicker="From a brief to a paused campaign on Meta"
      title="Launch a campaign"
      order={order}
    >
      {() => (
        <div className="grid gap-5">
          <p className="text-sm text-muted-foreground">
            Choose the kind, write what the campaign is for, pick the winners
            whose creatives it should reuse, and build. You get a draft to read
            and edit. Nothing touches Meta until you press launch, and
            everything is created paused.
          </p>

          <div className="grid gap-3 rounded-md border p-4">
            <div className="flex flex-wrap items-center gap-2">
              {(["lead_gen", "retargeting"] as Kind[]).map(k => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={kind === k}
                  onClick={() => {
                    setKind(k);
                    setClone([]);
                  }}
                  className={`rounded-full border px-3 py-1 text-sm font-medium ${
                    kind === k
                      ? "bg-foreground text-background"
                      : "text-muted-foreground"
                  }`}
                >
                  {k === "lead_gen" ? "Lead generation" : "Retargeting"}
                </button>
              ))}
              <span className="text-xs text-muted-foreground">
                {kind === "lead_gen"
                  ? "Cold audience sent to the funnel page, settings copied from the best lead-gen ad set, judged on cost per lead."
                  : "Warm audience, settings copied from the best retargeting ad set, named so it is never counted as lead gen."}
              </span>
            </div>
            <textarea
              id="launch-brief"
              value={brief}
              onChange={e => setBrief(e.target.value)}
              rows={3}
              placeholder={
                kind === "lead_gen"
                  ? "Who it is for and the one thing it promises, e.g. Kuwait interior design firms who want booked projects, not likes."
                  : "Who has already seen us and what should move them now, e.g. everyone who watched a video in 30 days, push them to book the intro."
              }
              className="w-full rounded-md border bg-background p-3 text-sm"
            />
            <div className="flex flex-wrap items-center gap-3">
              <label
                htmlFor="launch-budget"
                className="text-sm text-muted-foreground"
              >
                Daily budget
              </label>
              <input
                id="launch-budget"
                inputMode="decimal"
                value={budget}
                onChange={e => setBudget(e.target.value)}
                className={`${field} w-24`}
              />
              <span className="text-xs text-muted-foreground">
                USD, on the ad set
              </span>
              <span className="ml-2 flex gap-1">
                {(["ar", "en"] as const).map(l => (
                  <button
                    key={l}
                    type="button"
                    aria-pressed={lang === l}
                    onClick={() => setLang(l)}
                    className={`rounded-full border px-2.5 py-0.5 text-xs ${lang === l ? "bg-foreground text-background" : "text-muted-foreground"}`}
                  >
                    {l === "ar" ? "Arabic copy" : "English copy"}
                  </button>
                ))}
              </span>
            </div>
            {winners.length ? (
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {`Reuse the creatives of these ${kind === "lead_gen" ? "lead-gen" : "retargeting"} winners`}
                </p>
                <div className="grid gap-1 sm:grid-cols-2">
                  {winners.map(a => (
                    <label
                      key={a.id}
                      htmlFor={`clone-${a.id}`}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        id={`clone-${a.id}`}
                        type="checkbox"
                        checked={clone.includes(a.id)}
                        onChange={e =>
                          setClone(c =>
                            e.target.checked
                              ? [...c, a.id]
                              : c.filter(x => x !== a.id),
                          )
                        }
                      />
                      {a.thumbnail ? (
                        <img
                          src={a.thumbnail}
                          alt=""
                          className="size-7 rounded object-cover"
                          onError={e => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                      ) : null}
                      <span className="truncate">{a.name}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {`${a.w30.leads} leads · ${a.w30.demosShown} demos · ${a.w30.closes} closes`}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {`No ${kind === "lead_gen" ? "lead-gen" : "retargeting"} ad spent in the last 30 days, so there is no winner to copy from. The draft will still copy settings from the best ${kind === "lead_gen" ? "lead-gen" : "retargeting"} ad set on record.`}
              </p>
            )}
            <div>
              <button
                type="button"
                disabled={
                  busy || brief.trim().length < 12 || !(Number(budget) >= 5)
                }
                onClick={() =>
                  act(() =>
                    build({
                      kind,
                      brief: brief.trim(),
                      dailyBudgetUsd: Number(budget),
                      cloneAdIds: clone,
                      language: lang,
                    }),
                  )
                }
                className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "Building…" : "Build the draft"}
              </button>
            </div>
          </div>

          {drafts === null ? null : live.length ? (
            <div className="grid gap-3">
              {live.map(d => {
                const e = edits[d.id] ?? {};
                const name = e.name ?? d.name;
                const dailyBudgetUsd = e.dailyBudgetUsd ?? d.dailyBudgetUsd;
                const variants = e.variants ?? d.variants;
                const dirty = Object.keys(e).length > 0;
                const editable = d.status === "ready" || d.status === "failed";
                return (
                  <div key={d.id} className="rounded-md border p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusChip
                        tone={d.kind === "lead_gen" ? "good" : "neutral"}
                        label={
                          d.kind === "lead_gen" ? "lead gen" : "retargeting"
                        }
                      />
                      <StatusChip
                        tone={STATUS_TONE[d.status]}
                        label={d.status}
                      />
                      <span className="text-xs text-muted-foreground">
                        {d.createdAt.slice(0, 10)}
                      </span>
                    </div>
                    {editable ? (
                      <input
                        id={`draft-name-${d.id}`}
                        value={name}
                        onChange={ev =>
                          setEdits(m => ({
                            ...m,
                            [d.id]: { ...e, name: ev.target.value },
                          }))
                        }
                        className={`${field} mt-2 w-full font-medium`}
                      />
                    ) : (
                      <div className="mt-2 font-medium">{d.name}</div>
                    )}
                    {d.sourceReason ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {d.sourceReason}
                      </p>
                    ) : null}
                    {d.error ? (
                      <p className="mt-1 text-sm text-[var(--ceo-critical)]">
                        {d.error}
                      </p>
                    ) : null}
                    {d.status === "launched" ? (
                      <p className="mt-1 text-sm">
                        {`On Meta, paused: campaign ${d.metaCampaignId}, ad set ${d.metaAdsetId}, ${plural(d.metaAdIds.length, "ad")}. Turn it on from the campaign list above.`}
                      </p>
                    ) : null}

                    {editable ? (
                      <div className="mt-3 grid gap-2">
                        <div className="flex items-center gap-2 text-sm">
                          <label
                            htmlFor={`draft-budget-${d.id}`}
                            className="text-muted-foreground"
                          >
                            Daily budget
                          </label>
                          <input
                            id={`draft-budget-${d.id}`}
                            inputMode="decimal"
                            value={String(dailyBudgetUsd)}
                            onChange={ev =>
                              setEdits(m => ({
                                ...m,
                                [d.id]: {
                                  ...e,
                                  dailyBudgetUsd: Number(ev.target.value) || 0,
                                },
                              }))
                            }
                            className={`${field} w-24`}
                          />
                        </div>
                        {variants.map((v, i) => {
                          const rtl = isArabic(v.primaryText || v.headline);
                          return (
                            <div
                              key={`${d.id}-${i}`}
                              className="rounded-md border bg-muted/30 p-2"
                            >
                              <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{`Angle ${i + 1}`}</div>
                              <input
                                id={`draft-${d.id}-h-${i}`}
                                value={v.headline}
                                dir={rtl ? "rtl" : "ltr"}
                                onChange={ev => {
                                  const next = variants.map((x, j) =>
                                    j === i
                                      ? { ...x, headline: ev.target.value }
                                      : x,
                                  );
                                  setEdits(m => ({
                                    ...m,
                                    [d.id]: { ...e, variants: next },
                                  }));
                                }}
                                className={`${field} mb-1 w-full font-semibold`}
                              />
                              <textarea
                                id={`draft-${d.id}-t-${i}`}
                                value={v.primaryText}
                                dir={rtl ? "rtl" : "ltr"}
                                rows={3}
                                onChange={ev => {
                                  const next = variants.map((x, j) =>
                                    j === i
                                      ? { ...x, primaryText: ev.target.value }
                                      : x,
                                  );
                                  setEdits(m => ({
                                    ...m,
                                    [d.id]: { ...e, variants: next },
                                  }));
                                }}
                                className={`${field} w-full`}
                              />
                            </div>
                          );
                        })}
                        <button
                          type="button"
                          onClick={() =>
                            setEdits(m => ({
                              ...m,
                              [d.id]: {
                                ...e,
                                variants: [
                                  ...variants,
                                  { headline: "", primaryText: "" },
                                ],
                              },
                            }))
                          }
                          className="justify-self-start rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
                        >
                          Add an angle
                        </button>
                        <div className="flex flex-wrap items-center gap-2">
                          {dirty ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                act(async () => {
                                  await save({
                                    id: d.id,
                                    name,
                                    dailyBudgetUsd,
                                    variants,
                                  });
                                  setEdits(m => {
                                    const { [d.id]: _gone, ...rest } = m;
                                    return rest;
                                  });
                                })
                              }
                              className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
                            >
                              Save edits
                            </button>
                          ) : null}
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              act(async () => {
                                if (dirty)
                                  await save({
                                    id: d.id,
                                    name,
                                    dailyBudgetUsd,
                                    variants,
                                  });
                                await launch({ id: d.id });
                              })
                            }
                            className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
                          >
                            {`Launch it paused — ${money(dailyBudgetUsd)}/day`}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => act(() => discard({ id: d.id }))}
                            className="rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
                          >
                            Throw it away
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title="No drafts yet"
              text="Build one above."
              icon={Rocket}
              compact
            />
          )}
          {error ? (
            <p className="text-sm text-[var(--ceo-critical)]">{error}</p>
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}
