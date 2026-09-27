import { api, useAction } from "@/lib/cockpitApi";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Loader2,
  Lock,
  Plus,
  X,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { dayLabel } from "@/lib/teamCore";
import type {
  MeetingPage as Page,
  Sitting,
  Wheel,
} from "@/lib/team";
import {
  ConfirmInline,
  chip,
  errorText,
  InlineText,
  iconButton,
  peopleById,
  selectClass,
  useBusy,
} from "./teamKit";

/**
 * The wheels: role-play scenarios, who plays the agent, and the prize a
 * week's goal earns. The server picks (crypto random) and writes the result
 * into the sitting's notes; the wheel on the screen only lands where the
 * server said. Any meeting can have wheels: its hosts add them, and the CEO
 * and admins keep the prize amounts.
 */

type Act = (fn: () => Promise<unknown>) => Promise<void>;

const KIND_LABEL = {
  scenario: "Scenarios",
  person: "Names",
  prize: "Prize",
} as const;

export function Wheels({
  page,
  act,
  sitting,
  onPage,
  onError,
}: {
  page: Page;
  act: Act;
  sitting: Sitting | null;
  onPage: (p: Page) => void;
  onError: (message: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  if (!page.wheels.length && !page.canManage) return null;
  return (
    <section
      className="rounded-2xl border bg-card p-4 sm:p-6"
      aria-labelledby="wheels"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="wheels" className="text-[15px] font-semibold">
          Wheels
        </h2>
        {sitting ? (
          <span className="text-xs text-muted-foreground">
            Spins go into the notes for{" "}
            {sitting.onDate === page.today ? "today" : dayLabel(sitting.onDate)}
          </span>
        ) : null}
      </div>
      {page.wheels.length ? (
        <div className="@container mt-4 grid gap-6">
          {page.wheels.map(w => (
            <WheelPanel
              key={w.id}
              wheel={w}
              page={page}
              act={act}
              sitting={sitting}
              onPage={onPage}
              onError={onError}
            />
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          No wheels on this meeting. Add one for role-play scenarios, for
          picking who goes next, or for a prize the team earns.
        </p>
      )}
      {page.canManage ? (
        adding ? (
          <AddWheel page={page} act={act} onDone={() => setAdding(false)} />
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="mt-4"
            onClick={() => setAdding(true)}
          >
            <Plus aria-hidden /> Add a wheel
          </Button>
        )
      ) : null}
    </section>
  );
}

// --- one wheel -------------------------------------------------------------------------------

function WheelPanel({
  wheel,
  page,
  act,
  sitting,
  onPage,
  onError,
}: {
  wheel: Wheel;
  page: Page;
  act: Act;
  sitting: Sitting | null;
  onPage: (p: Page) => void;
  onError: (message: string) => void;
}) {
  const spin = useAction(api.team.spin);
  const saveWheel = useAction(api.team.saveWheel);
  const deleteWheel = useAction(api.team.deleteWheel);
  const setGoal = useAction(api.team.setGoalHit);
  const byId = peopleById(page.people);
  const uid = useId();
  const editWheel = wheel.kind === "prize" ? page.me.isBoss : page.canManage;
  const members = page.members.map(m => ({
    ...m,
    name: byId.get(m.personId)?.name ?? m.personId,
  }));
  const nonHosts = members.filter(m => m.part !== "host");
  const [among, setAmong] = useState<string[]>(() =>
    (nonHosts.length >= 2 ? nonHosts : members).map(m => m.personId),
  );
  const [forPerson, setForPerson] = useState("");
  const liveOptions = wheel.options.filter(o => o.active);
  const labels =
    wheel.kind === "person"
      ? members.filter(m => among.includes(m.personId)).map(m => m.name)
      : liveOptions.map(o => o.rendered);
  const [shown, setShown] = useState<string[] | null>(null);
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const locked =
    wheel.kind === "prize" &&
    wheel.lockedUntilGoal &&
    sitting?.goalHit !== true;
  const slices = shown ?? labels;
  const spins = page.spins.filter(s => s.wheelId === wheel.id).slice(0, 4);

  const go = async () => {
    if (!sitting || spinning) return;
    setResult(null);
    setSpinning(true);
    try {
      const res = (await spin({
        wheelId: wheel.id,
        sittingId: sitting.id,
        ...(wheel.kind === "person" ? { among } : {}),
        ...(forPerson ? { forPerson } : {}),
      })) as {
        page: Page;
        result: { index: number; label: string; choices: string[] };
      };
      const n = res.result.choices.length;
      setShown(res.result.choices);
      const center = ((res.result.index + 0.5) * 360) / n;
      const reduce = window.matchMedia?.(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      setRotation(
        r => r + (reduce ? 0 : 360 * 5) + ((((-center - r) % 360) + 360) % 360),
      );
      timer.current = setTimeout(
        () => {
          setSpinning(false);
          setResult(res.result.label);
          onPage(res.page);
        },
        reduce ? 0 : 3300,
      );
    } catch (e) {
      setSpinning(false);
      onError(errorText(e));
    }
  };

  return (
    <article className="grid gap-4 border-t pt-5 first:border-t-0 first:pt-0 @xl:grid-cols-[11.5rem_minmax(0,1fr)] @xl:gap-8">
      <div className="grid content-start justify-items-center gap-3">
        <Disc
          labels={slices}
          rotation={rotation}
          spinning={spinning}
          locked={locked}
        />
        {result ? (
          <p
            className="max-w-full rounded-full bg-primary/15 px-3 py-1 text-center text-sm font-medium ring-1 ring-inset ring-primary/40"
            aria-live="polite"
          >
            {result}
          </p>
        ) : null}
        {locked ? (
          <div className="grid justify-items-center gap-2 text-center text-xs text-muted-foreground">
            <span>Mark this week's goal as hit to unlock</span>
            {page.canManage && sitting ? (
              <span className="flex items-center gap-2 text-sm text-foreground">
                <Switch
                  id={`${uid}-goal`}
                  checked={sitting.goalHit === true}
                  onCheckedChange={v =>
                    void act(() => setGoal({ sittingId: sitting.id, hit: v }))
                  }
                />
                <label htmlFor={`${uid}-goal`}>Goal hit</label>
              </span>
            ) : null}
          </div>
        ) : (
          <Button
            size="sm"
            variant="teal"
            disabled={!sitting || spinning || !labels.length || !wheel.active}
            onClick={() => void go()}
          >
            {spinning ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {spinning ? "Spinning" : "Spin"}
          </Button>
        )}
      </div>
      <div className="grid min-w-0 content-start gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {editWheel ? (
            <InlineText
              value={wheel.name}
              label="Wheel name"
              placeholder="Name the wheel"
              className="text-sm font-semibold"
              onSave={name =>
                act(() =>
                  saveWheel({ meetingId: page.meeting.id, id: wheel.id, name }),
                )
              }
            />
          ) : (
            <span className="text-sm font-semibold">{wheel.name}</span>
          )}
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            {KIND_LABEL[wheel.kind]}
            {wheel.kind === "prize" && wheel.lockedUntilGoal ? ", earned" : ""}
            {!wheel.active ? ", switched off" : ""}
          </span>
          {wheel.sourceUrl ? (
            <a
              href={wheel.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Picker wheel <ArrowUpRight className="size-3" aria-hidden />
            </a>
          ) : null}
          {editWheel ? (
            <span className="ml-auto flex items-center gap-2">
              {wheel.kind === "prize" ? (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Switch
                    id={`${uid}-earned`}
                    checked={wheel.lockedUntilGoal}
                    onCheckedChange={v =>
                      void act(() =>
                        saveWheel({
                          meetingId: page.meeting.id,
                          id: wheel.id,
                          name: wheel.name,
                          lockedUntilGoal: v,
                        }),
                      )
                    }
                  />
                  <label htmlFor={`${uid}-earned`}>Earned</label>
                </span>
              ) : null}
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Switch
                  id={`${uid}-on`}
                  checked={wheel.active}
                  onCheckedChange={v =>
                    void act(() =>
                      saveWheel({
                        meetingId: page.meeting.id,
                        id: wheel.id,
                        name: wheel.name,
                        active: v,
                      }),
                    )
                  }
                />
                <label htmlFor={`${uid}-on`}>On</label>
              </span>
              <ConfirmInline
                ask="Delete this wheel?"
                yes="Delete"
                onYes={() => act(() => deleteWheel({ id: wheel.id }))}
              >
                {open => (
                  <button
                    type="button"
                    onClick={open}
                    className={iconButton}
                    aria-label={`Delete the ${wheel.name} wheel`}
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                )}
              </ConfirmInline>
            </span>
          ) : null}
        </div>
        {wheel.kind === "person" ? (
          <div className="grid gap-1.5">
            <p className="text-xs text-muted-foreground">
              In the draw: the people in this meeting
            </p>
            <div className="flex flex-wrap gap-1.5">
              {members.map(m => (
                <button
                  key={m.personId}
                  type="button"
                  aria-pressed={among.includes(m.personId)}
                  onClick={() =>
                    setAmong(a =>
                      a.includes(m.personId)
                        ? a.filter(x => x !== m.personId)
                        : [...a, m.personId],
                    )
                  }
                  className={chip(among.includes(m.personId))}
                >
                  {m.name}
                </button>
              ))}
              {!members.length ? (
                <span className="text-sm text-muted-foreground">
                  Nobody is in this meeting yet.
                </span>
              ) : null}
            </div>
          </div>
        ) : (
          <Options wheel={wheel} page={page} act={act} />
        )}
        {wheel.kind === "prize" && members.length ? (
          <div className="grid max-w-xs gap-1 text-xs font-medium text-muted-foreground">
            <label htmlFor={`${uid}-for`}>Spinning for</label>
            <AnimatedSelect
              id={`${uid}-for`}
              className={selectClass}
              value={forPerson}
              onChange={e => setForPerson(e.target.value)}
            >
              <option value="">Nobody named</option>
              {members.map(m => (
                <option key={m.personId} value={m.personId}>
                  {m.name}
                </option>
              ))}
            </AnimatedSelect>
          </div>
        ) : null}
        {spins.length ? (
          <ul className="grid gap-1 text-xs text-muted-foreground">
            {spins.map(s => (
              <li key={s.id}>
                {s.sittingId ? dayLabel(s.sittingId.slice(-10)) : ""}:{" "}
                <span className="text-foreground">{s.label}</span>
                {s.forWhom ? ` for ${s.forWhom}` : ""}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </article>
  );
}

/**
 * A slice's colour: teal and deep blue in turn, a third tone when an odd
 * count would put two of a colour side by side. The options list carries
 * the same colour, so a slice is read off the list, not off rotated text.
 */
export function sliceColor(i: number, n: number): string {
  if (n > 1 && n % 2 === 1 && i === n - 1)
    return "color-mix(in oklch, var(--mahara-teal) 45%, var(--deep-space))";
  return i % 2
    ? "color-mix(in oklch, var(--royal-blue) 62%, var(--deep-space))"
    : "color-mix(in oklch, var(--mahara-teal) 78%, var(--deep-space))";
}

/** The wheel itself: coloured slices, a teal pointer, one long ease-out to where the server landed. */
function Disc({
  labels,
  rotation,
  spinning,
  locked,
}: {
  labels: string[];
  rotation: number;
  spinning: boolean;
  locked: boolean;
}) {
  const n = Math.max(labels.length, 1);
  const gradient = useMemo(
    () =>
      Array.from(
        { length: n },
        (_, i) =>
          `${sliceColor(i, n)} ${(i * 360) / n}deg ${((i + 1) * 360) / n}deg`,
      ).join(", "),
    [n],
  );
  return (
    <div className="relative size-40" aria-hidden>
      <span
        className="absolute left-1/2 top-[-4px] z-10 size-0 -translate-x-1/2 border-x-[9px] border-t-[14px] border-x-transparent border-t-primary drop-shadow"
        aria-hidden
      />
      <div
        className={`absolute inset-0 rounded-full ring-1 ring-white/10 ${locked ? "opacity-40 saturate-50" : ""}`}
        style={{
          background: labels.length
            ? `conic-gradient(${gradient})`
            : "var(--muted)",
          transform: `rotate(${rotation}deg)`,
          transition: spinning
            ? "transform 3.2s cubic-bezier(0.12, 0.8, 0.18, 1)"
            : "none",
        }}
      />
      <div className="absolute inset-[36%] flex items-center justify-center rounded-full bg-card ring-1 ring-white/10">
        {locked ? (
          <Lock
            className="size-4 text-warning"
            aria-label="Earned: locked until the goal is hit"
          />
        ) : null}
      </div>
    </div>
  );
}

// --- the options -------------------------------------------------------------------------------

function Options({ wheel, page, act }: { wheel: Wheel; page: Page; act: Act }) {
  const save = useAction(api.team.saveWheelOption);
  const remove = useAction(api.team.deleteWheelOption);
  const move = useAction(api.team.moveWheelOption);
  const setAmount = useAction(api.team.setPrizeAmount);
  const canEdit = wheel.kind === "prize" ? page.me.isBoss : true;
  const [label, setLabel] = useState("");
  const [busy, run] = useBusy();
  const live = wheel.options.filter(o => o.active);
  return (
    <div className="grid gap-2">
      <ol className="grid gap-1.5">
        {wheel.options.map((o, i) => {
          const n = o.active ? live.indexOf(o) + 1 : null;
          const templated = o.label.includes("{amount}");
          const off = o.active ? "" : "text-muted-foreground line-through";
          return (
            <li
              key={o.id}
              className="group grid grid-cols-[0.625rem_minmax(0,1fr)_auto] items-start gap-x-2.5 text-sm"
            >
              <span
                className="mt-[0.4rem] size-2.5 rounded-full"
                style={{
                  background: n
                    ? sliceColor(n - 1, live.length)
                    : "transparent",
                }}
                aria-hidden
              />
              <div className="grid min-w-0 gap-0.5">
                {/* A prize with an amount reads as it will on the wheel; its
                    number is the field beside it, and the sentence stays. */}
                {canEdit && !templated ? (
                  <InlineText
                    value={o.label}
                    label="Option"
                    placeholder="Option"
                    className={off}
                    onSave={next =>
                      act(() =>
                        save({ wheelId: wheel.id, id: o.id, label: next }),
                      )
                    }
                  />
                ) : (
                  <span className={off}>{o.rendered}</span>
                )}
                {canEdit && wheel.kind === "prize" ? (
                  <InlineText
                    value={o.condition ?? ""}
                    label="Condition"
                    placeholder="Add a condition"
                    className="text-xs"
                    emptyClass="pointer-fine:opacity-0 pointer-fine:group-hover:opacity-70 focus-visible:opacity-100"
                    onSave={next =>
                      act(() =>
                        save({
                          wheelId: wheel.id,
                          id: o.id,
                          label: o.label,
                          condition: next || null,
                        }),
                      )
                    }
                  />
                ) : o.condition ? (
                  <span className="text-xs text-muted-foreground">
                    {o.condition}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-0.5">
                {templated && page.me.isBoss ? (
                  <label className="mr-1 flex items-center gap-1 text-xs text-muted-foreground">
                    {o.suffix ? null : (
                      <span>
                        {o.currency && o.currency !== "USD" ? o.currency : "$"}
                      </span>
                    )}
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={0.01}
                      defaultValue={o.amount ?? ""}
                      aria-label={`Amount for ${o.rendered}`}
                      onBlur={e => {
                        const value = Number(e.target.value);
                        if (e.target.value !== "" && value !== o.amount)
                          void act(() =>
                            setAmount({
                              optionId: o.id,
                              amount: value,
                              meetingId: page.meeting.id,
                            }),
                          );
                      }}
                      className="h-7 w-20 rounded-md border border-input bg-transparent px-2 text-right font-mono text-sm tabular-nums"
                    />
                    {o.suffix ? <span>{o.suffix}</span> : null}
                  </label>
                ) : null}
                {canEdit ? (
                  <span className="flex items-center gap-0.5 opacity-100 transition-opacity pointer-fine:sm:opacity-0 pointer-fine:sm:group-focus-within:opacity-100 pointer-fine:sm:group-hover:opacity-100">
                    <label
                      className="flex size-8 items-center justify-center pointer-coarse:size-10"
                      title="On the wheel"
                    >
                      <input
                        type="checkbox"
                        checked={o.active}
                        onChange={e =>
                          void act(() =>
                            save({
                              wheelId: wheel.id,
                              id: o.id,
                              label: o.label,
                              active: e.target.checked,
                            }),
                          )
                        }
                        className="accent-[var(--mahara-teal)]"
                      />
                      <span className="sr-only">On the wheel</span>
                    </label>
                    <button
                      type="button"
                      aria-label="Move up"
                      disabled={i === 0 || busy === `o${o.id}`}
                      onClick={() =>
                        run(`o${o.id}`, () =>
                          act(() => move({ id: o.id, dir: "up" })),
                        )
                      }
                      className={iconButton}
                    >
                      <ArrowUp className="size-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      aria-label="Move down"
                      disabled={
                        i === wheel.options.length - 1 || busy === `o${o.id}`
                      }
                      onClick={() =>
                        run(`o${o.id}`, () =>
                          act(() => move({ id: o.id, dir: "down" })),
                        )
                      }
                      className={iconButton}
                    >
                      <ArrowDown className="size-4" aria-hidden />
                    </button>
                    <ConfirmInline
                      ask="Take it off?"
                      yes="Take off"
                      onYes={() => act(() => remove({ id: o.id }))}
                    >
                      {open => (
                        <button
                          type="button"
                          aria-label={`Take "${o.rendered}" off the wheel`}
                          onClick={open}
                          className={iconButton}
                        >
                          <X className="size-4" aria-hidden />
                        </button>
                      )}
                    </ConfirmInline>
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      {canEdit ? (
        <form
          className="flex gap-2"
          onSubmit={e => {
            e.preventDefault();
            if (!label.trim()) return;
            void run("add", async () => {
              await act(() =>
                save({
                  wheelId: wheel.id,
                  label,
                  ...(wheel.kind === "prize" && label.includes("{amount}")
                    ? { currency: "USD", amount: 0 }
                    : {}),
                }),
              );
              setLabel("");
            });
          }}
        >
          <Input
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder={
              wheel.kind === "prize"
                ? "Add a prize, {amount} for the number"
                : "Add an option"
            }
            aria-label="New option"
            className="h-8"
          />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={busy === "add" || !label.trim()}
          >
            {busy === "add" ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Plus aria-hidden />
            )}
            Add
          </Button>
        </form>
      ) : wheel.kind === "prize" ? (
        <p className="text-xs text-muted-foreground">
          The CEO and admins set the prizes and their amounts.
        </p>
      ) : null}
    </div>
  );
}

function AddWheel({
  page,
  act,
  onDone,
}: {
  page: Page;
  act: Act;
  onDone: () => void;
}) {
  const save = useAction(api.team.saveWheel);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"scenario" | "person" | "prize">("scenario");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mt-4 grid gap-2 rounded-xl bg-muted/40 p-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto_auto] sm:items-center"
      onSubmit={async e => {
        e.preventDefault();
        if (name.trim().length < 2) return;
        setBusy(true);
        try {
          await act(() => save({ meetingId: page.meeting.id, name, kind }));
          onDone();
        } catch {
          // The page shows the error.
        } finally {
          setBusy(false);
        }
      }}
    >
      <Input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Wheel name, like Objection role play"
        aria-label="Wheel name"
        autoFocus
      />
      <AnimatedSelect
        className={selectClass}
        value={kind}
        onChange={e => setKind(e.target.value as typeof kind)}
        aria-label="Kind"
      >
        <option value="scenario">Scenarios</option>
        <option value="person">Names from the sitting</option>
        {page.me.isBoss ? <option value="prize">Prize, earned</option> : null}
      </AnimatedSelect>
      <Button type="submit" size="sm" disabled={busy || name.trim().length < 2}>
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
        Add the wheel
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onDone}>
        Cancel
      </Button>
    </form>
  );
}
