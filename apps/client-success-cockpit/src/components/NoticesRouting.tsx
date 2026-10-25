import { BellRing, ChevronRight, Plus, X } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { Chip, Dot, ExtLink, Kicker, Pill } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  addSlackChannel,
  atNoticeWhen,
  NOTICE_KINDS,
  type NoticeSetting,
  noAccess,
  noticeStop,
  readNoticeSettings,
  rehearseNotice,
  removeSlackChannel,
  SEAT_LABEL,
  SEAT_RULES,
  type SeatRule,
  type SettingsPatch,
  type SettingsRead,
  type SlackChannel,
  setFormsEditor,
  setNoticeSetting,
} from "@/lib/notices";
import { cn } from "@/lib/utils";

/*
 * Hallmark · component: settings card · genre: modern-minimal (the
 * cockpit's) · theme: the client success cockpit's own tokens
 * states: default · hover · focus · active · disabled · loading · error · success
 *
 * Design plan (docs/forms/STAGE1-CONTRACT.md 6, 6.3; frontend-design and
 * Hallmark, component scope, no macrostructure):
 * - Tokens: only the cockpit's. --primary (Mahara teal) marks what is on
 *   and chosen, text-primary-ink carries teal words in light mode, the kit's
 *   Dot tones carry state (success posted, warning needs a person, muted
 *   off). No second palette, no gradient, no shadow beyond the card's.
 * - Type: Geist for the sentences; Geist Mono for what is typed or pasted
 *   in Slack (#csm-general, C09RZ0GS0V9) and for the stop's clock; the
 *   kit's mono Kicker over the two sub-lists only.
 * - Layout: the Settings page's own rounded card; one row per notice, in
 *   the order a client meets them; the row's switch at its top right; the
 *   controls folded under the row so a reader sees eight sentences, not
 *   eight forms. One column at 320 px; nothing scrolls sideways.
 * - Signature: each notice reads as one sentence ("Posts in #csm-general
 *   and tags the creative director."), with the same Slack stop as the
 *   kickoff trail under it ("Last: posted in #csm-general at 14:03").
 * - Copy: plain and active; a refusal is the server's own sentence, under
 *   the control that caused it. Nothing here posts to Slack: a test and a
 *   new channel are rows the sender picks up within a minute.
 */

export type NoticesIO = {
  read: () => Promise<SettingsRead>;
  set: (kind: string, patch: SettingsPatch) => Promise<SettingsRead>;
  addChannel: (id: string, name: string | null) => Promise<SettingsRead>;
  removeChannel: (id: string) => Promise<SettingsRead>;
  rehearse: (
    kind: string,
  ) => Promise<{ id: string; state: string; note: string | null }>;
  setEditor: (memberId: string, on: boolean) => Promise<SettingsRead>;
};

/** Each kind's label and one-line hint (contract 6.3), in the card's order. */
export const NOTICE_ROWS: Record<
  (typeof NOTICE_KINDS)[number],
  { label: string; hint: string }
> = {
  kickoff: {
    label: "Kickoff complete",
    hint: "Posts when Make has updated the card.",
  },
  "kickoff.late": {
    label: "Kickoff late",
    hint: "Posts where Kickoff complete posts, 20 minutes after a kickoff the card has not caught up with. Always on.",
  },
  "kickoff.second": {
    label: "Second kickoff",
    hint: "A line added to either kickoff notice. Always on.",
  },
  "kickoff.updated": {
    label: "Kickoff card updated",
    hint: "A reply under a late notice once the card is updated.",
  },
  "blueprint.close": {
    label: "Brand Blueprint closed",
    hint: "Posts when the creative director closes the Blueprint call.",
  },
  "blueprint.media": {
    label: "Brand Blueprint completed, for media",
    hint: "Tells the media team scripts and custom creative can start.",
  },
  "blueprint.updated": {
    label: "Blueprint card confirmed",
    hint: "A reply under the close once a card update that needed a check is confirmed.",
  },
  "blueprint.offer": {
    label: "Offer locked",
    hint: "A reply under the close when the offer is locked.",
  },
};

const SAVED = "Saved. The next notice uses it.";
const TEST_SENT =
  "Test on its way. It reaches your Slack direct messages within a minute.";
const CHANNEL_ID = /^[CG][A-Z0-9]{8,12}$/;
/** After a test or a new channel, the card reads again every 10 s for 2 minutes. */
const WATCH_EVERY_MS = 10_000;
const WATCH_FOR_MS = 2 * 60_000;

const words = (e: unknown) =>
  (e instanceof Error ? e.message : String(e ?? "")).trim() ||
  "The server gave no reason.";

/** "a", "a and b", "a, b and c". */
export function joinWords(list: string[]): string {
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
}

const channelName = (c: { id: string; name: string | null }) =>
  c.name ? `#${c.name}` : c.id;

/** Who a row tags, in words: "the CSM (nobody is in that seat)". */
export function tagWords(n: NoticeSetting): string[] {
  const seats = n.mentionRule.map(rule => {
    const label = SEAT_LABEL[rule as SeatRule] ?? rule;
    const t = n.tags.find(x => x.rule === rule);
    if (t && !t.found) return `${label} (nobody is in that seat)`;
    if (t && !t.slackKnown)
      return `${label} (no Slack account found, so named in plain text)`;
    return label;
  });
  const people = n.mentionPeople.map(p =>
    p.slackKnown
      ? p.label
      : `${p.label} (no Slack account found, so named in plain text)`,
  );
  return [...seats, ...people];
}

/** The row's one sentence, as plain words (the card draws the channel in mono). */
export function noticeSentence(n: NoticeSetting): string {
  if (!n.on && !n.fixedOn) return "Off.";
  const tags = tagWords(n);
  const tagged = tags.length ? `tags ${joinWords(tags)}` : "tags nobody";
  if (n.shape === "post")
    return n.channel
      ? `Posts in ${channelName(n.channel)} and ${tagged}.`
      : "Has no channel, so nothing posts. Choose one under Change.";
  if (n.shape === "reply")
    return `Replies in the first notice's thread and ${tagged}.`;
  return `${tagged.charAt(0).toUpperCase()}${tagged.slice(1)}.`;
}

function supabaseIO(
  client: NonNullable<ReturnType<typeof useCockpitAuth>["client"]>,
): NoticesIO {
  return {
    read: () => readNoticeSettings(client),
    set: (kind, patch) => setNoticeSetting(client, kind, patch),
    addChannel: (id, name) => addSlackChannel(client, id, name),
    removeChannel: id => removeSlackChannel(client, id),
    rehearse: kind => rehearseNotice(client, kind),
    setEditor: (memberId, on) => setFormsEditor(client, memberId, on),
  };
}

type ReadState = SettingsRead | { error: string } | { hidden: true } | null;

export function NoticesRouting({
  io: given,
  initial,
  watchEveryMs = WATCH_EVERY_MS,
}: {
  /** Stand-ins for the harness and the tests. */
  io?: NoticesIO;
  /** A read already made (the harness and the tests draw it at once). */
  initial?: SettingsRead;
  /** How often the card reads again after a test or a new channel (tests shorten it). */
  watchEveryMs?: number;
}) {
  const auth = useCockpitAuth();
  const io = useMemo<NoticesIO | null>(
    () => given ?? (auth.client ? supabaseIO(auth.client) : null),
    [given, auth.client],
  );
  const [read, setRead] = useState<ReadState>(initial ?? null);
  // After a test or a new channel: read again until this time.
  const [watchUntil, setWatchUntil] = useState(0);
  const [testFor, setTestFor] = useState<{
    kind: string;
    id: string;
  } | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!io) return;
    try {
      setRead(await io.read());
    } catch (e) {
      // A seat with no right to see notices sees nothing here.
      setRead(noAccess(e) ? { hidden: true } : { error: words(e) });
    }
  }, [io]);

  useEffect(() => {
    if (!initial) void reload();
  }, [reload, initial]);

  const watching = watchUntil > 0;
  useEffect(() => {
    if (!watching || !io) return;
    const t = window.setInterval(() => {
      if (Date.now() > watchUntil) {
        setWatchUntil(0);
        return;
      }
      io.read().then(setRead, () => {});
    }, watchEveryMs);
    return () => window.clearInterval(t);
  }, [watching, watchUntil, io, watchEveryMs]);
  const watch = () => setWatchUntil(Date.now() + WATCH_FOR_MS);

  if (!io || (read && "hidden" in read)) return null;

  return (
    <section
      aria-labelledby="notices-title"
      className="rounded-2xl border bg-card p-4 sm:p-6"
    >
      <h2
        id="notices-title"
        className="flex items-center gap-2 text-[15px] font-semibold"
      >
        <BellRing className="size-4 text-muted-foreground" aria-hidden />
        Notices and routing
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Where the cockpit posts in Slack when a kickoff or a Brand Blueprint is
        done, and who it tags. A change applies to the next notice.
      </p>

      {read === null ? (
        <p className="mt-4 text-sm text-muted-foreground" role="status">
          Reading the notice settings…
        </p>
      ) : "error" in read ? (
        <p role="alert" className="mt-4 text-sm">
          The notice settings could not be read:{" "}
          {read.error.replace(/\.\s*$/, "")}. Refresh the page; if it stays,
          tell the tech lead.{" "}
          <button
            type="button"
            onClick={() => void reload()}
            className="text-primary-ink underline-offset-4 hover:underline"
          >
            Read them again
          </button>
        </p>
      ) : (
        <Body
          read={read}
          io={io}
          onRead={setRead}
          testFor={testFor}
          onTest={(kind, id) => {
            setTestFor({ kind, id });
            watch();
          }}
          added={added}
          onAdded={id => {
            setAdded(id);
            watch();
          }}
        />
      )}
    </section>
  );
}

function Body({
  read,
  io,
  onRead,
  testFor,
  onTest,
  added,
  onAdded,
}: {
  read: SettingsRead;
  io: NoticesIO;
  onRead: (r: SettingsRead) => void;
  testFor: { kind: string; id: string } | null;
  onTest: (kind: string, id: string) => void;
  added: string | null;
  onAdded: (id: string) => void;
}) {
  const rows = NOTICE_KINDS.map(k =>
    read.notices.find(n => n.kind === k),
  ).filter((n): n is NoticeSetting => Boolean(n));
  const edit = read.can.edit;
  return (
    <div className="mt-4 space-y-6">
      {rows.length ? (
        <ul className="divide-y rounded-xl bg-muted/30">
          {rows.map(n => (
            <NoticeRow
              key={n.kind}
              n={n}
              read={read}
              io={io}
              onRead={onRead}
              testFor={testFor}
              onTest={onTest}
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          No notice settings came back. Refresh the page; if it stays, tell the
          tech lead.
        </p>
      )}
      {edit ? (
        <Channels
          read={read}
          io={io}
          onRead={onRead}
          added={added}
          onAdded={onAdded}
        />
      ) : null}
      {read.can.editors ? (
        <Editors read={read} io={io} onRead={onRead} />
      ) : null}
      {edit ? null : (
        <p className="text-xs text-muted-foreground">
          Only the CEO, an admin or someone they add can change these.
        </p>
      )}
    </div>
  );
}

/** The row's sentence, with the channel name in mono. */
function Sentence({ n }: { n: NoticeSetting }) {
  const text = noticeSentence(n);
  const name = n.channel ? channelName(n.channel) : null;
  const at = name && n.shape === "post" ? text.indexOf(name) : -1;
  if (at < 0 || !name) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <span className="font-mono text-[13px]">{name}</span>
      {text.slice(at + name.length)}
    </>
  );
}

function NoticeRow({
  n,
  read,
  io,
  onRead,
  testFor,
  onTest,
}: {
  n: NoticeSetting;
  read: SettingsRead;
  io: NoticesIO;
  onRead: (r: SettingsRead) => void;
  testFor: { kind: string; id: string } | null;
  onTest: (kind: string, id: string) => void;
}) {
  const meta = NOTICE_ROWS[n.kind as keyof typeof NOTICE_ROWS] ?? {
    label: n.kind,
    hint: "",
  };
  const edit = read.can.edit;
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const changed = n.updatedAt
    ? n.updatedBy === "the migration" || !n.updatedBy
      ? `Default, set ${atNoticeWhen(n.updatedAt, read.now)}`
      : `Changed by ${n.updatedBy} ${atNoticeWhen(n.updatedAt, read.now)}`
    : null;

  async function flip(on: boolean) {
    setSwitching(true);
    setSwitchError(null);
    try {
      onRead(await io.set(n.kind, { on }));
      toast.success(SAVED);
    } catch (e) {
      setSwitchError(words(e));
    } finally {
      setSwitching(false);
    }
  }

  const switchId = `notice-on-${n.kind.replace(/\./g, "-")}`;
  return (
    <li className="space-y-2 px-3 py-4 sm:px-4" data-kind={n.kind}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{meta.label}</h3>
          <p
            className={cn(
              "mt-0.5 text-sm",
              !n.on && !n.fixedOn && "text-muted-foreground",
            )}
          >
            <Sentence n={n} />
          </p>
          {meta.hint ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{meta.hint}</p>
          ) : null}
        </div>
        {n.fixedOn ? null : edit ? (
          <Switch
            id={switchId}
            checked={n.on}
            disabled={switching}
            aria-label={`${meta.label} notice`}
            onCheckedChange={v => void flip(v)}
            className="mt-0.5 shrink-0"
          />
        ) : (
          <Chip tone={n.on ? "good" : "neutral"} className="shrink-0">
            {n.on ? "On" : "Off"}
          </Chip>
        )}
      </div>
      {switchError ? (
        <p role="alert" className="txt-bad text-xs">
          {switchError}
        </p>
      ) : null}
      <LastStop n={n} now={read.now} />
      {changed ? (
        <p className="text-xs text-muted-foreground">{changed}</p>
      ) : null}
      {edit ? (
        <Change
          n={n}
          read={read}
          io={io}
          onRead={onRead}
          testFor={testFor}
          onTest={onTest}
          label={meta.label}
        />
      ) : null}
    </li>
  );
}

function LastStop({ n, now }: { n: NoticeSetting; now: string }) {
  if (n.shape === "variant") return null;
  if (!n.last)
    return (
      <p className="flex gap-1.5 text-xs text-muted-foreground">
        <span className="mt-[5px] flex">
          <Dot tone="neutral" />
        </span>
        No notice of this kind has gone out yet.
      </p>
    );
  const stop = noticeStop(n.last, now, {
    reply: n.shape === "reply",
    offLine: "Not posted: it was off in Settings.",
  });
  const text = stop.text.charAt(0).toLowerCase() + stop.text.slice(1);
  return (
    <p
      className={cn(
        "flex gap-1.5 text-xs",
        stop.tone === "warn" ? "txt-warn" : "text-muted-foreground",
      )}
    >
      <span className="mt-[5px] flex">
        <Dot tone={stop.tone} />
      </span>
      <span className="min-w-0">
        Last: {text}
        {stop.href ? (
          <>
            {" "}
            <ExtLink href={stop.href} className="text-primary-ink">
              Open in Slack
            </ExtLink>
          </>
        ) : null}
      </span>
    </p>
  );
}

const same = (
  a: readonly (string | number)[],
  b: readonly (string | number)[],
) =>
  a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

/** The row's controls, folded: channel, who is tagged, Save, Send a test to me. */
function Change({
  n,
  read,
  io,
  onRead,
  testFor,
  onTest,
  label,
}: {
  n: NoticeSetting;
  read: SettingsRead;
  io: NoticesIO;
  onRead: (r: SettingsRead) => void;
  testFor: { kind: string; id: string } | null;
  onTest: (kind: string, id: string) => void;
  label: string;
}) {
  const seats = n.mentionRule.filter((r): r is SeatRule =>
    (SEAT_RULES as readonly string[]).includes(r),
  );
  const people = n.mentionPeople.map(p => p.id);
  const [channel, setChannel] = useState(n.channel?.id ?? null);
  const [rules, setRules] = useState<SeatRule[]>(seats);
  const [picked, setPicked] = useState<number[]>(people);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  // A new read (after a save, or another editor's) resets the draft.
  const seen = `${n.channel?.id}|${seats.join(",")}|${people.join(",")}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `seen` is the server's values in one key
  useEffect(() => {
    setChannel(n.channel?.id ?? null);
    setRules(seats);
    setPicked(people);
  }, [seen]);

  const ok = read.channels.filter(c => c.state === "ok");
  const patch: SettingsPatch = {};
  if (n.shape === "post" && channel && channel !== (n.channel?.id ?? null))
    patch.channel = channel;
  if (!same(rules, seats)) patch.mentionRule = rules;
  if (!same(picked, people)) patch.mentionPeople = picked;
  const dirty = Object.keys(patch).length > 0;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      onRead(await io.set(n.kind, patch));
      toast.success(SAVED);
    } catch (e) {
      setError(words(e));
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setTestError(null);
    try {
      const r = await io.rehearse(n.kind);
      onTest(n.kind, r.id);
    } catch (e) {
      setTestError(words(e));
    } finally {
      setTesting(false);
    }
  }

  const byId = new Map(read.people.map(p => [p.id, p.label]));
  for (const p of n.mentionPeople) byId.set(p.id, p.label);
  const others = read.people.filter(p => !picked.includes(p.id));
  // The caller's newest test of this kind, from the read; a press just
  // made is on its way until the read shows it.
  const t = read.test?.kind === n.kind ? read.test : null;
  const pressed = testFor?.kind === n.kind;
  // A refusal of a second press is old news once the test has moved on.
  const testState = `${t?.id ?? ""}:${t?.state ?? ""}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: testState is the trigger
  useEffect(() => setTestError(null), [testState]);
  const testLine =
    pressed && (!t || t.id !== testFor?.id)
      ? TEST_SENT
      : !t
        ? null
        : t.state === "posted"
          ? `Sent to your direct messages ${atNoticeWhen(t.at, read.now)}.`
          : t.state === "queued" || t.state === "sending"
            ? TEST_SENT
            : `Not sent: ${String(t.reason ?? "no reason was given").replace(/\.\s*$/, "")}.`;
  const testWarn = Boolean(testLine?.startsWith("Not sent"));

  return (
    <details className="group/change">
      <summary className="no-marker inline-flex cursor-pointer items-center gap-1 rounded-sm text-xs font-medium text-primary-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRight
          aria-hidden
          className="size-3.5 transition-transform group-open/change:rotate-90"
        />
        Change where and who
      </summary>
      <div className="mt-3 space-y-4 border-l pl-3">
        {n.shape === "post" ? (
          <fieldset className="space-y-1.5">
            <legend className="text-xs text-muted-foreground">Posts in</legend>
            {ok.length ? (
              <div className="flex flex-wrap gap-1.5">
                {ok.map(c => (
                  <Choice
                    key={c.id}
                    active={channel === c.id}
                    onClick={() => setChannel(c.id)}
                    disabled={saving}
                    className="font-mono"
                  >
                    {channelName(c)}
                  </Choice>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                No channel is ready yet. Add one under Channels below.
              </p>
            )}
          </fieldset>
        ) : (
          <p className="text-xs text-muted-foreground">
            {n.shape === "reply"
              ? "Replies post in their first notice's thread, in its channel."
              : "Posts where Kickoff complete posts."}
          </p>
        )}

        <fieldset className="space-y-1.5">
          <legend className="text-xs text-muted-foreground">Tags</legend>
          <div className="flex flex-wrap gap-1.5">
            {SEAT_RULES.map(r => (
              <Choice
                key={r}
                active={rules.includes(r)}
                disabled={saving}
                onClick={() =>
                  setRules(x =>
                    x.includes(r) ? x.filter(y => y !== r) : [...x, r],
                  )
                }
              >
                {SEAT_LABEL[r].replace(/^the /, "The ")}
              </Choice>
            ))}
          </div>
          {picked.length ? (
            <ul className="flex flex-wrap gap-1.5" aria-label="Named people">
              {picked.map(id => (
                <li key={id}>
                  <span className="inline-flex h-8 items-center gap-1 rounded-full bg-primary/15 pr-1 pl-3 text-xs font-medium ring-1 ring-inset ring-primary/40">
                    {byId.get(id) ?? `Person ${id}`}
                    <button
                      type="button"
                      disabled={saving}
                      aria-label={`Stop tagging ${byId.get(id) ?? `person ${id}`}`}
                      onClick={() => setPicked(x => x.filter(y => y !== id))}
                      className="grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                    >
                      <X aria-hidden className="size-3.5" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {others.length ? (
            <details className="group/people">
              <summary className="no-marker inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <Plus aria-hidden className="size-3.5" />
                Tag someone by name
              </summary>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {others.map(p => (
                  <Choice
                    key={p.id}
                    active={false}
                    disabled={saving || picked.length >= 10}
                    onClick={() => setPicked(x => [...x, p.id])}
                  >
                    {p.label}
                  </Choice>
                ))}
              </div>
              {picked.length >= 10 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Ten people at most.
                </p>
              ) : null}
            </details>
          ) : null}
        </fieldset>

        {error ? (
          <p role="alert" className="txt-bad text-xs">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={!dirty || saving}
            onClick={() => void save()}
            aria-label={`Save ${label}`}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
          {n.shape === "variant" ? null : (
            <Button
              size="sm"
              variant="outline"
              disabled={testing}
              onClick={() => void test()}
            >
              {testing ? "Sending the test…" : "Send a test to me"}
            </Button>
          )}
        </div>
        {testError ? (
          <p role="alert" className="txt-bad text-xs">
            {testError}
          </p>
        ) : testLine ? (
          <p
            role="status"
            className={cn(
              "text-xs",
              testWarn ? "txt-warn" : "text-muted-foreground",
            )}
          >
            {testLine}
          </p>
        ) : null}
      </div>
    </details>
  );
}

function stateWords(c: SlackChannel): {
  text: string;
  tone: "good" | "warn" | "accent" | "neutral";
} {
  switch (c.state) {
    case "ok":
      return { text: "Ready", tone: "good" };
    case "checking":
      return { text: "Checking", tone: "accent" };
    case "refused":
      return {
        text: `Refused: ${String(c.note ?? "no reason was given").replace(/\.\s*$/, "")}.`,
        tone: "warn",
      };
    default:
      return { text: "Removed", tone: "neutral" };
  }
}

/** A choice to toggle: the kit's Pill, ringed while not chosen so it reads as one. */
function Choice({ active, className, ...rest }: Parameters<typeof Pill>[0]) {
  return (
    <Pill
      active={active}
      className={cn(className, !active && "ring-1 ring-inset ring-border")}
      {...rest}
    />
  );
}

function SubHead({ children }: { children: ReactNode }) {
  return <Kicker>{children}</Kicker>;
}

function Channels({
  read,
  io,
  onRead,
  added,
  onAdded,
}: {
  read: SettingsRead;
  io: NoticesIO;
  onRead: (r: SettingsRead) => void;
  added: string | null;
  onAdded: (id: string) => void;
}) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<{
    id: string;
    text: string;
  } | null>(null);
  const list = read.channels.filter(c => c.state !== "removed");
  const usedBy = (cid: string) =>
    read.notices
      .filter(n => n.shape === "post" && n.channel?.id === cid)
      .map(
        n => NOTICE_ROWS[n.kind as keyof typeof NOTICE_ROWS]?.label ?? n.kind,
      );
  const just = added ? read.channels.find(c => c.id === added) : null;

  async function add() {
    const clean = id.trim().toUpperCase();
    if (!CHANNEL_ID.test(clean)) {
      setError("Paste the channel's ID from Slack (it starts with C or G).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onRead(await io.addChannel(clean, name.trim().replace(/^#/, "") || null));
      onAdded(clean);
      setId("");
      setName("");
    } catch (e) {
      setError(words(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(cid: string) {
    setRemoving(cid);
    setRemoveError(null);
    try {
      onRead(await io.removeChannel(cid));
      toast.success("Removed. No notice can use it now.");
    } catch (e) {
      setRemoveError({ id: cid, text: words(e) });
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="space-y-3">
      <SubHead>Channels</SubHead>
      {list.length ? (
        <ul className="divide-y rounded-xl border">
          {list.map(c => {
            const s = stateWords(c);
            const used = usedBy(c.id);
            return (
              <li key={c.id} className="space-y-1 px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono text-[13px]">
                    {c.name ? `#${c.name}` : "No name yet"}
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {c.id}
                  </span>
                  {c.private === true ? (
                    <span className="text-xs text-muted-foreground">
                      Private
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      "inline-flex min-w-0 items-center gap-1.5 text-xs",
                      s.tone === "warn" ? "txt-warn" : "text-muted-foreground",
                    )}
                  >
                    <Dot tone={s.tone} />
                    {s.text}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto h-7 px-2 text-xs"
                    disabled={removing === c.id}
                    onClick={() => void remove(c.id)}
                    aria-label={`Remove ${c.name ? `#${c.name}` : c.id}`}
                  >
                    {removing === c.id ? "Removing…" : "Remove"}
                  </Button>
                </div>
                {used.length ? (
                  <p className="text-xs text-muted-foreground">
                    Used by {joinWords(used)}.
                  </p>
                ) : null}
                {removeError?.id === c.id ? (
                  <p role="alert" className="txt-bad text-xs">
                    {removeError.text}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">
          No channel is on the list. Add one: the cockpit checks the bot is in
          it.
        </p>
      )}

      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Add a channel: invite @mahara-club-bot to it in Slack first, then
          paste its ID (in Slack, open the channel's details; the ID is at the
          bottom).
        </p>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <div className="space-y-1">
            <Label htmlFor="notice-channel-id" className="text-xs">
              Channel ID
            </Label>
            <Input
              id="notice-channel-id"
              value={id}
              disabled={busy}
              placeholder="C0123ABCDEF"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={Boolean(error)}
              onChange={e => {
                setId(e.target.value);
                setError(null);
              }}
              onKeyDown={e => {
                if (e.key === "Enter") void add();
              }}
              className="h-8 font-mono text-xs md:text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="notice-channel-name" className="text-xs">
              Name, if you like
            </Label>
            <Input
              id="notice-channel-name"
              value={name}
              disabled={busy}
              placeholder="csm-general"
              autoComplete="off"
              spellCheck={false}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") void add();
              }}
              className="h-8 font-mono text-xs md:text-xs"
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !id.trim()}
            onClick={() => void add()}
          >
            {busy ? "Adding…" : "Add"}
          </Button>
        </div>
        {error ? (
          <p role="alert" className="txt-bad text-xs">
            {error}
          </p>
        ) : just ? (
          <p
            role="status"
            className={cn(
              "text-xs",
              just.state === "refused" ? "txt-warn" : "text-muted-foreground",
            )}
          >
            {just.state === "checking"
              ? `Checking ${channelName(just)}: the cockpit makes sure mahara-club-bot is in it, within a minute.`
              : just.state === "ok"
                ? `Added. ${channelName(just)} is ready for a notice.`
                : just.state === "refused"
                  ? `Not added: ${String(just.note ?? "no reason was given").replace(/\.\s*$/, "")}.`
                  : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Editors({
  read,
  io,
  onRead,
}: {
  read: SettingsRead;
  io: NoticesIO;
  onRead: (r: SettingsRead) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ids = new Set(read.editors.map(e => e.memberId));
  const others = read.members.filter(m => !ids.has(m.memberId));

  async function setOne(memberId: string, on: boolean) {
    setBusy(memberId);
    setError(null);
    try {
      onRead(await io.setEditor(memberId, on));
      toast.success(
        on
          ? "Added. They can change notices and routing now."
          : "Removed. They can no longer change notices and routing.",
      );
    } catch (e) {
      setError(words(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <SubHead>Who can change these</SubHead>
      <p className="text-sm">
        The CEO, admins, and{" "}
        {read.editors.length ? "these seats:" : "nobody else yet."}
      </p>
      {read.editors.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {read.editors.map(e => (
            <li key={e.memberId}>
              <span className="inline-flex h-8 items-center gap-1 rounded-full border pr-1 pl-3 text-xs font-medium">
                {e.label}
                <button
                  type="button"
                  disabled={busy === e.memberId}
                  aria-label={`Remove ${e.label}`}
                  onClick={() => void setOne(e.memberId, false)}
                  className="grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                >
                  <X aria-hidden className="size-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {others.length ? (
        <details className="group/editors">
          <summary className="no-marker inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-primary-ink">
            <Plus aria-hidden className="size-3.5" />
            Add someone
          </summary>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {others.map(m => (
              <Choice
                key={m.memberId}
                active={false}
                disabled={busy !== null}
                onClick={() => void setOne(m.memberId, true)}
              >
                {m.label}
              </Choice>
            ))}
          </div>
        </details>
      ) : null}
      {error ? (
        <p role="alert" className="txt-bad text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}
