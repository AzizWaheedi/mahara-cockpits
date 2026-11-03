import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronRight,
  GripVertical,
  Lock,
  Plus,
  Trash2,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import {
  Chip,
  ExtLink,
  Kicker,
  PageHeader,
  SectionCard,
} from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  editorError,
  type FormsEditorIO,
  notAllowed,
  readEditorDoor,
  supabaseFormsEditorIO,
} from "@/lib/formsEditor";
import {
  addField as addFieldTo,
  blankTexts,
  type ClientFormSchema,
  COPY,
  CSAT_BOUNDS,
  type CsatRule,
  canMove,
  changeList,
  csatSentence,
  defaultWorkspace,
  describePath,
  type EditorFormRow,
  type EditorOne,
  type EditorRead,
  FIELD_TYPES,
  type FieldType,
  type FormField,
  type FormGroup,
  fieldLocks,
  GROUP_SUB,
  GROUP_TITLE,
  historyLine,
  kuwaitDay,
  LOW_SCORE_BOUND,
  maxLengthCap,
  moveField,
  NPS_BOUNDS,
  type NpsRule,
  npsSentence,
  previewUrl,
  type Routing,
  type RoutingPatch,
  readsByField,
  removeField,
  ruleProblem,
  STRUCTURED_STATE,
  type StructuredRead,
  structuredAsked,
  structuredOutline,
  structuredUse,
  type Text,
  TYPE_LABEL,
  updateField,
  valueFromLabel,
} from "@/lib/formsEditorCore";
import { cn } from "@/lib/utils";

/*
 * Hallmark · pre-emit critique: P4 H4 E4 S4 R5 V4 · component scope: one
 * cockpit page (no macrostructure, nav or footer picks; it lives in the
 * shared "Back to your cockpit" shell the Notices page uses).
 * states: default · hover · focus · active · disabled · loading · error · success
 *
 * Design plan (docs/forms/WAVE34-CONTRACT.md 5.0 cockpit plan, 5.13;
 * frontend-design and Hallmark loaded first):
 * - Subject: an admin or the CEO changing what a client reads in a short
 *   form, without code, and being able to undo it. Job: edit a form's words
 *   and questions safely, publish, and go back.
 * - Tokens: only the cockpit's. --primary (Mahara teal #00cfc8) for the one
 *   primary action (Publish) and the current version's ring; the warning
 *   tone for a draft that waits or a refusal to act on; --destructive only
 *   for Discard and Remove; --muted, --border and --card for the rest. No
 *   literal colour anywhere in this file.
 * - Type: Geist for words; Geist Mono for keys, versions (v3), days and the
 *   routing numbers; Arabic inputs and previews dir="rtl" lang="ar", set in
 *   IBM Plex Sans Arabic through --font-sans.
 * - Layout: the list is three SectionCards (Client forms, Staff forms,
 *   Typeform and Make forms) then the Routing card. One form per page: the
 *   question list on the left (handle, label, type chip, required, a lock
 *   when the cockpit reads it), the editor on the right with English and
 *   Arabic side by side; under them the Preview strip drawing the structure
 *   in both languages, then the history. Under 1024 px everything stacks in
 *   that order; nothing scrolls sideways at 320 px.
 * - Signature (reused from the Send a form delivery line): the version
 *   history as a vertical line of small rings in Geist Mono, "v3 published
 *   2 Nov · an admin", the current version filled teal, older ones hollow,
 *   the unpublished draft an amber ring at the top. Motion only on the ring
 *   fill (150 ms), off under reduced motion.
 * - Copy (5.13): Save draft → Draft saved; Publish version {n+1} →
 *   Published; What changed? (shown in the history); Go back to version {n}
 *   → Restored as version {m}; Open the real preview; refusals are the
 *   server's own sentences with the place they point at; No changes yet.
 *
 * The structured onboarding, read only (20261103h; WAVE56-CONTRACT.md 4.22;
 * frontend-design loaded first). Subject: the CEO or an admin opening the
 * client onboarding and finding version 3, a structured form stored in the
 * database and not live yet. Job: see what version 3 asks and how a client
 * meets it, which version clients get today, and why it is not edited here.
 * Tokens and type: the plan above, nothing new (Geist Mono for v3, keys and
 * counts; the state chip's dot carries the tone: neutral stored, warning on
 * the test card only, success live). Layout: under the read-only sentence,
 * one strip (v3, Structured, the state) and one line (the version new
 * invites get, what uses this one), then the form in its sections: each
 * question one row with its English words, its kind ("Rows, 1 to 25",
 * "Several choices (19)"), optional when it is, the Arabic right to left
 * under it, and when it shows in words. One column at every width; chips
 * wrap; nothing scrolls sideways at 375 px. Signature: a rows question
 * draws its row's columns as mono chips, the shape of each answer. No Save,
 * Publish or Go back here: the server refuses them, and the page says why.
 */

const SELECT =
  "border-input h-9 w-full min-w-0 rounded-md border bg-transparent px-2 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30";

/** True on a desktop-wide window (two columns), else one column. */
function useWide(query = "(min-width: 1024px)"): boolean {
  const read = () =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : true;
  const [wide, setWide] = useState(read);
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    )
      return;
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    on();
    m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, [query]);
  return wide;
}

/** The route: /forms-editor and /forms-editor/:key. */
export function FormsEditorPage() {
  const { client } = useCockpitAuth();
  const { key } = useParams();
  const navigate = useNavigate();
  const io = useMemo(
    () => (client ? supabaseFormsEditorIO(client) : null),
    [client],
  );
  const [door, setDoor] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    readEditorDoor(client).then(open => {
      if (live) setDoor(open);
    });
    return () => {
      live = false;
    };
  }, [client]);
  return (
    <FormsEditorView
      io={io}
      door={door}
      formKey={key ?? null}
      onOpen={k => navigate(`/forms-editor/${encodeURIComponent(k)}`)}
      onBack={() => navigate("/forms-editor")}
    />
  );
}

/** The editor without the router or the sign-in, for the harness and the tests. */
export function FormsEditorView({
  io,
  door,
  formKey,
  onOpen,
  onBack,
}: {
  io: FormsEditorIO | null;
  /** cockpit_form_doors().editor; null while it is read. */
  door: boolean | null;
  formKey: string | null;
  onOpen: (key: string) => void;
  onBack: () => void;
}) {
  return (
    <div
      className="mx-auto w-full max-w-6xl space-y-6"
      data-page="forms-editor"
    >
      <PageHeader
        title="Forms editor"
        sub="Change what clients read in their forms and when surveys go. Each change publishes as a new version you can go back from."
      />
      {door === null ? (
        <p className="text-sm text-muted-foreground" role="status">
          Reading the forms…
        </p>
      ) : !door || !io ? (
        <SectionCard title="Not open yet">
          <p className="text-sm text-muted-foreground" data-door="closed">
            {COPY.doorClosed}
          </p>
        </SectionCard>
      ) : formKey ? (
        <OneForm io={io} formKey={formKey} onBack={onBack} />
      ) : (
        <FormList io={io} onOpen={onOpen} />
      )}
    </div>
  );
}

// --- Shared bits ---------------------------------------------------------------------------------

function Refusal({
  message,
  where,
  testId,
}: {
  message: string;
  where?: string | null;
  testId?: string;
}) {
  return (
    <div
      role="alert"
      data-refusal={testId ?? "true"}
      className="rounded-xl border border-warning/50 bg-warning/10 px-3 py-2 text-sm"
    >
      <p className="font-medium">{message}</p>
      {where ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{where}</p>
      ) : null}
    </div>
  );
}

function ReadFailed({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <SectionCard title="The forms could not be read">
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button className="mt-3" variant="outline" size="sm" onClick={onRetry}>
        Read again
      </Button>
    </SectionCard>
  );
}

function NotYours({ message }: { message: string }) {
  return (
    <SectionCard title="Forms editor">
      <p className="text-sm" data-refusal="seat">
        {message}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Ask the CEO if you need to change a client form.
      </p>
    </SectionCard>
  );
}

function Bilingual({
  label,
  value,
  onChange,
  multiline,
  maxLength,
  disabled,
  hint,
  name,
}: {
  label: string;
  value: Text | null | undefined;
  onChange: (next: Text) => void;
  multiline?: boolean;
  maxLength?: number;
  disabled?: boolean;
  hint?: ReactNode;
  name: string;
}) {
  const id = useId();
  const v = value ?? { en: "", ar: "" };
  const box = (lang: "en" | "ar") => {
    const common = {
      id: `${id}-${lang}`,
      dir: lang === "ar" ? "rtl" : "ltr",
      lang,
      value: v[lang],
      maxLength,
      disabled,
      "aria-invalid": v[lang].trim() === "" ? true : undefined,
    } as const;
    return multiline ? (
      <Textarea
        {...common}
        className="min-h-[72px]"
        onChange={e => onChange({ ...v, [lang]: e.currentTarget.value })}
      />
    ) : (
      <Input
        {...common}
        onChange={e => onChange({ ...v, [lang]: e.currentTarget.value })}
      />
    );
  };
  return (
    <fieldset className="min-w-0 space-y-1.5" data-bilingual={name}>
      <legend className="text-sm font-medium">{label}</legend>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      <div className="grid gap-2 md:grid-cols-2">
        {(["en", "ar"] as const).map(lang => (
          <div key={lang} className="min-w-0 space-y-1">
            <Label
              htmlFor={`${id}-${lang}`}
              className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground"
            >
              {lang === "en" ? "English" : "Arabic"}
            </Label>
            {box(lang)}
          </div>
        ))}
      </div>
    </fieldset>
  );
}

function versionChip(row: EditorFormRow): ReactNode {
  return row.version ? (
    <span className="font-mono text-xs text-muted-foreground">
      v{row.version}
    </span>
  ) : null;
}

// --- The list ------------------------------------------------------------------------------------

function FormList({
  io,
  onOpen,
}: {
  io: FormsEditorIO;
  onOpen: (key: string) => void;
}) {
  const [read, setRead] = useState<EditorRead | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => {
    setError(null);
    io.read().then(setRead, e => setError(editorError(e)));
  }, [io]);
  useEffect(load, [load]);
  if (error) {
    if (notAllowed(error))
      return <NotYours message={(error as Error).message} />;
    return <ReadFailed message={(error as Error).message} onRetry={load} />;
  }
  if (!read)
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Reading the forms…
      </p>
    );
  const groups: FormGroup[] = ["client", "staff", "typeform"];
  return (
    <div className="space-y-6">
      {groups.map(g => {
        const rows = read.forms.filter(f => f.group === g);
        if (!rows.length) return null;
        return (
          <SectionCard
            key={g}
            title={GROUP_TITLE[g]}
            count={rows.length}
            sub={GROUP_SUB[g]}
            flush
          >
            <ul data-group={g}>
              {rows.map(row => (
                <li
                  key={row.key}
                  data-form={row.key}
                  className="border-b last:border-b-0"
                >
                  <button
                    type="button"
                    onClick={() => onOpen(row.key)}
                    className="flex w-full min-w-0 flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none active:bg-muted sm:px-6"
                  >
                    <div className="min-w-[min(100%,14rem)] flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-medium">{row.title}</span>
                        {versionChip(row)}
                        {row.titleAr ? (
                          <bdi
                            dir="rtl"
                            lang="ar"
                            className="text-sm text-muted-foreground"
                          >
                            {row.titleAr}
                          </bdi>
                        ) : null}
                      </div>
                      {row.editable ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {row.questions ?? 0} questions
                          {row.publishedAt
                            ? ` · published ${kuwaitDay(row.publishedAt)} · ${row.publishedBy}`
                            : ""}
                        </p>
                      ) : (
                        <p
                          className="mt-0.5 text-xs text-muted-foreground"
                          data-why
                        >
                          {row.why}
                        </p>
                      )}
                    </div>
                    <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-1.5">
                      {row.draft ? (
                        <Chip tone="warn">
                          {row.draft.stale
                            ? "Draft on an old version"
                            : `Draft saved ${kuwaitDay(row.draft.savedAt)}`}
                        </Chip>
                      ) : null}
                      {row.group === "client" && row.live !== null ? (
                        <Chip tone={row.live ? "good" : "neutral"}>
                          {row.live ? "Live to clients" : "Not live yet"}
                        </Chip>
                      ) : null}
                      {!row.editable ? (
                        <Chip dot={false} className="text-muted-foreground">
                          Read only
                        </Chip>
                      ) : null}
                      <ChevronRight
                        aria-hidden
                        className="size-4 text-muted-foreground"
                      />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </SectionCard>
        );
      })}
      <RoutingCard
        io={io}
        routing={read.routing}
        onSaved={r => setRead({ ...read, routing: r })}
      />
    </div>
  );
}

// --- Routing (4.9.2) ------------------------------------------------------------------------------

type RuleDraft = Record<string, number | "">;

function asDraft(
  rule: Record<string, unknown> | undefined,
  keys: readonly { key: string }[],
): RuleDraft {
  const out: RuleDraft = {};
  for (const { key } of keys) {
    const v = rule?.[key];
    out[key] = typeof v === "number" ? v : "";
  }
  return out;
}

function NumberField({
  id,
  label,
  value,
  onChange,
  lo,
  hi,
  disabled,
}: {
  id: string;
  label: string;
  value: number | "";
  onChange: (v: number | "") => void;
  lo: number;
  hi: number;
  disabled?: boolean;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={lo}
        max={hi}
        step={1}
        value={value}
        disabled={disabled}
        onChange={e => {
          const raw = e.currentTarget.value;
          onChange(raw === "" ? "" : Number(raw));
        }}
        className="font-mono tabular-nums"
      />
      <p className="font-mono text-[11px] text-muted-foreground">
        {lo} to {hi}
      </p>
    </div>
  );
}

const ROUTING_WORDS: Record<string, string> = {
  firstDay: "First NPS, days after launch",
  everyDays: "Days between rounds",
  remindAfterDays: "Shows on Today after (days)",
  afterLaunchDays: "Days after launch",
  whatsappAfterDays: "WhatsApp link on day",
  snoozeDays: '"Not now" waits (days)',
  reissues: "Re-tries",
  retryAfterDays: "Days between re-tries",
  maxAgeDays: "Last day after launch",
};

function RoutingCard({
  io,
  routing,
  onSaved,
}: {
  io: FormsEditorIO;
  routing: Routing;
  onSaved: (r: Routing) => void;
}) {
  const base = useId();
  const sched = routing.schedules;
  const [npsOn, setNpsOn] = useState(sched?.nps?.on ?? false);
  const [csatOn, setCsatOn] = useState(sched?.csat?.on ?? false);
  const [nps, setNps] = useState<RuleDraft>(() =>
    asDraft(sched?.nps?.rule, NPS_BOUNDS),
  );
  const [csat, setCsat] = useState<RuleDraft>(() =>
    asDraft(sched?.csat?.rule, CSAT_BOUNDS),
  );
  const [low, setLow] = useState<number | "">(routing.lowScore?.max ?? "");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const npsProblem = sched?.nps ? ruleProblem(NPS_BOUNDS, nps) : null;
  const csatProblem = sched?.csat ? ruleProblem(CSAT_BOUNDS, csat) : null;
  const lowProblem = ruleProblem([LOW_SCORE_BOUND], { max: low });
  const changed =
    (sched?.nps &&
      (npsOn !== sched.nps.on ||
        JSON.stringify(nps) !==
          JSON.stringify(asDraft(sched.nps.rule, NPS_BOUNDS)))) ||
    (sched?.csat &&
      (csatOn !== sched.csat.on ||
        JSON.stringify(csat) !==
          JSON.stringify(asDraft(sched.csat.rule, CSAT_BOUNDS)))) ||
    low !== (routing.lowScore?.max ?? "");
  const problem = npsProblem ?? csatProblem ?? lowProblem;

  const save = async () => {
    const patch: RoutingPatch = {};
    if (sched?.nps)
      patch.nps = { on: npsOn, rule: nps as unknown as Partial<NpsRule> };
    if (sched?.csat)
      patch.csat = { on: csatOn, rule: csat as unknown as Partial<CsatRule> };
    if (typeof low === "number") patch.lowScore = { max: low };
    setBusy(true);
    setRefusal(null);
    try {
      const next = await io.setRouting(patch);
      onSaved(next);
      toast.success(COPY.routingSaved);
    } catch (e) {
      setRefusal(editorError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard
      title="Routing"
      sub="When the automatic surveys go, and the score that counts as low. Where answers post in Slack is set in Notices and routing."
      action={
        <a
          href="/notices"
          className="text-sm text-[color:var(--primary-ink)] underline-offset-4 hover:underline"
        >
          Notices and routing
        </a>
      }
    >
      <div className="space-y-5" data-routing>
        <p className="text-sm text-muted-foreground" data-routing-note>
          {routing.note}
        </p>
        {sched?.nps ? (
          <div className="space-y-3" data-schedule="nps">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <Kicker as="h3">NPS</Kicker>
                <p className="text-sm">
                  {npsSentence(nps as unknown as Partial<NpsRule>)}
                </p>
              </div>
              <Switch
                aria-label="NPS schedule on"
                checked={npsOn}
                onCheckedChange={setNpsOn}
                disabled={busy}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {NPS_BOUNDS.map(b => (
                <NumberField
                  key={b.key}
                  id={`${base}-nps-${b.key}`}
                  label={ROUTING_WORDS[b.key] ?? b.words}
                  lo={b.lo}
                  hi={b.hi}
                  value={nps[b.key] ?? ""}
                  disabled={busy}
                  onChange={v => setNps({ ...nps, [b.key]: v })}
                />
              ))}
            </div>
          </div>
        ) : null}
        {sched?.csat ? (
          <div className="space-y-3 border-t pt-4" data-schedule="csat">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <Kicker as="h3">Onboarding survey</Kicker>
                <p className="text-sm">
                  {csatSentence(csat as unknown as Partial<CsatRule>)}
                </p>
              </div>
              <Switch
                aria-label="Onboarding survey schedule on"
                checked={csatOn}
                onCheckedChange={setCsatOn}
                disabled={busy}
              />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {CSAT_BOUNDS.map(b => (
                <NumberField
                  key={b.key}
                  id={`${base}-csat-${b.key}`}
                  label={ROUTING_WORDS[b.key] ?? b.words}
                  lo={b.lo}
                  hi={b.hi}
                  value={csat[b.key] ?? ""}
                  disabled={busy}
                  onChange={v => setCsat({ ...csat, [b.key]: v })}
                />
              ))}
            </div>
          </div>
        ) : null}
        <div className="border-t pt-4" data-low-score>
          <Kicker as="h3">Low score</Kicker>
          <p className="mb-2 text-sm">
            A score of {typeof low === "number" ? low : "?"} or less puts a call
            on the CSM's Today.
          </p>
          <div className="max-w-[12rem]">
            <NumberField
              id={`${base}-low`}
              label="Low-score line"
              lo={LOW_SCORE_BOUND.lo}
              hi={LOW_SCORE_BOUND.hi}
              value={low}
              disabled={busy}
              onChange={setLow}
            />
          </div>
        </div>
        {problem ? <Refusal message={problem} testId="routing-local" /> : null}
        {refusal ? <Refusal message={refusal} testId="routing" /> : null}
        <div className="flex justify-end">
          <Button
            onClick={save}
            disabled={busy || !changed || Boolean(problem)}
            data-action="save-routing"
          >
            {busy ? "Saving…" : COPY.saveRouting}
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}

// --- One form --------------------------------------------------------------------------------------

type Selected = { kind: "texts" } | { kind: "field"; key: string };

function OneForm({
  io,
  formKey,
  onBack,
}: {
  io: FormsEditorIO;
  formKey: string;
  onBack: () => void;
}) {
  const [one, setOne] = useState<EditorOne | null>(null);
  const [workspaces, setWorkspaces] = useState<EditorRead["workspaces"]>([]);
  const [portalBase, setPortalBase] = useState(
    "https://portal.maharamedia.com",
  );
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => {
    setError(null);
    Promise.all([io.readOne(formKey), io.read()]).then(
      ([o, r]) => {
        setOne(o);
        setWorkspaces(r.workspaces);
        setPortalBase(r.portalBase);
      },
      e => setError(editorError(e)),
    );
  }, [io, formKey]);
  useEffect(load, [load]);

  const back = (
    <button
      type="button"
      onClick={onBack}
      className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft aria-hidden className="size-4" /> All forms
    </button>
  );
  if (error) {
    return (
      <div className="space-y-4">
        {back}
        {notAllowed(error) ? (
          <NotYours message={(error as Error).message} />
        ) : (
          <ReadFailed message={(error as Error).message} onRetry={load} />
        )}
      </div>
    );
  }
  if (!one)
    return (
      <div className="space-y-4">
        {back}
        <p className="text-sm text-muted-foreground" role="status">
          Reading the form…
        </p>
      </div>
    );
  return (
    <div className="space-y-4">
      {back}
      {one.form.editable && one.published ? (
        <EditForm
          key={`${one.form.key}:${one.published.version}`}
          io={io}
          one={one}
          setOne={setOne}
          workspaces={workspaces}
          portalBase={portalBase}
        />
      ) : (
        <ReadOnlyForm one={one} io={io} />
      )}
    </div>
  );
}

function ReadOnlyForm({ one, io }: { one: EditorOne; io: FormsEditorIO }) {
  const [structured, setStructured] = useState<StructuredRead | null>(null);
  const [structuredError, setStructuredError] = useState<string | null>(null);
  const read = io.structured;
  const key = one.form.key;
  const client = one.form.group === "client";
  useEffect(() => {
    if (!read || !client) return;
    let live = true;
    read(key).then(
      s => {
        if (live) setStructured(s);
      },
      e => {
        if (!live) return;
        const m = editorError(e).message;
        // Before 20261103h the read does not exist: the plain read-only view stands alone.
        setStructuredError(m === COPY.doorClosed ? null : m);
      },
    );
    return () => {
      live = false;
    };
  }, [read, client, key]);
  return (
    <SectionCard
      title={
        <span className="flex flex-wrap items-center gap-2">
          {one.form.title} {versionChip(one.form)}
        </span>
      }
      sub={one.form.why}
    >
      {structured ? <StructuredForm s={structured} /> : null}
      {structuredError ? (
        <div className="mb-3">
          <Refusal message={structuredError} testId="structured" />
        </div>
      ) : null}
      <div data-readonly={one.form.key} className="space-y-3">
        <Kicker>Fields on record</Kicker>
        {one.record?.fields.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {one.record.fields.map(f => (
              <li key={f}>
                <Chip dot={false} className="font-mono">
                  {f}
                </Chip>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No fields on record here; the form itself holds them.
          </p>
        )}
        {one.record?.typeformId ? (
          <p className="text-xs text-muted-foreground">
            Typeform <span className="font-mono">{one.record.typeformId}</span>
          </p>
        ) : null}
      </div>
    </SectionCard>
  );
}

/** The structured version, read only: its state, who uses it, and its questions in their sections. */
function StructuredForm({ s }: { s: StructuredRead }) {
  const outline = useMemo(() => structuredOutline(s.schema), [s.schema]);
  const state = STRUCTURED_STATE[s.state];
  const sections = outline.filter(x => x.title).length;
  return (
    <section
      data-structured={s.version}
      aria-label={`Version ${s.version}, structured`}
      className="mb-5 space-y-4 border-b pb-5"
    >
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs">v{s.version}</span>
          <Chip dot={false}>Structured</Chip>
          <span data-structured-state={s.state}>
            <Chip tone={state.tone}>{state.words}</Chip>
          </span>
        </div>
        <p className="text-sm" data-structured-use>
          {structuredUse(s)}
        </p>
        <p className="text-xs text-muted-foreground">
          <span className="font-mono">{structuredAsked(s.schema)}</span>{" "}
          questions in <span className="font-mono">{sections}</span> sections ·
          about <span className="font-mono">{s.schema.minutes}</span> minutes
          {s.publishedAt
            ? ` · stored ${kuwaitDay(s.publishedAt)} · ${s.publishedBy}`
            : ""}
        </p>
      </div>
      {outline.map((section, n) => (
        <div
          key={section.title?.en ?? `section-${n}`}
          className="space-y-2"
          data-structured-section={n + 1}
        >
          {section.title ? (
            <h3 className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm font-medium">
              <span>{section.title.en}</span>
              <bdi
                dir="rtl"
                lang="ar"
                className="text-xs font-normal text-muted-foreground"
              >
                {section.title.ar}
              </bdi>
            </h3>
          ) : null}
          <ol className="divide-y rounded-md border">
            {section.items.map(item => (
              <li
                key={item.key}
                data-structured-question={item.key}
                className="min-w-0 space-y-0.5 px-3 py-2"
              >
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="min-w-0 break-words text-sm">
                    {item.label.en}
                  </span>
                  <span className="text-xs text-muted-foreground" data-kind>
                    {item.kind}
                    {item.note || item.required ? "" : " · optional"}
                  </span>
                </div>
                <bdi
                  dir="rtl"
                  lang="ar"
                  className="block break-words text-xs text-muted-foreground"
                >
                  {item.label.ar}
                </bdi>
                {item.shows ? (
                  <p className="text-xs text-muted-foreground" data-shows>
                    {item.shows}
                  </p>
                ) : null}
                {item.columns.length ? (
                  <ul
                    className="flex flex-wrap gap-1 pt-1"
                    data-columns
                    aria-label="Each row asks"
                  >
                    {item.columns.map(c => (
                      <li key={c}>
                        <Chip dot={false} className="font-mono">
                          {c}
                        </Chip>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </section>
  );
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

function EditForm({
  io,
  one,
  setOne,
  workspaces,
  portalBase,
}: {
  io: FormsEditorIO;
  one: EditorOne;
  setOne: (o: EditorOne) => void;
  workspaces: EditorRead["workspaces"];
  portalBase: string;
}) {
  const published = one.published as NonNullable<EditorOne["published"]>;
  const wide = useWide();
  const saved = one.draft?.schema ?? published.schema;
  const [draft, setDraft] = useState<ClientFormSchema>(() =>
    JSON.parse(JSON.stringify(saved)),
  );
  const [selected, setSelected] = useState<Selected>({ kind: "texts" });
  const [busy, setBusy] = useState<
    null | "save" | "publish" | "discard" | "restore"
  >(null);
  const [refusal, setRefusal] = useState<{
    message: string;
    where: string | null;
  } | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [note, setNote] = useState("");
  const dirty = !same(draft, saved);
  const hasChanges = !same(draft, published.schema);
  const stale = Boolean(one.draft?.stale);
  const next = published.version + 1;
  const blanks = blankTexts(draft);
  const reads = readsByField(published.schema);
  const effectLabel = useMemo(
    () => new Map(one.reads.map(r => [r.effect, r.label])),
    [one.reads],
  );

  // A newer server copy (after a save) replaces the local one only when nothing local is unsaved.
  const lastSaved = useRef(saved);
  useEffect(() => {
    if (!same(lastSaved.current, saved)) {
      lastSaved.current = saved;
      setDraft(JSON.parse(JSON.stringify(saved)));
    }
  }, [saved]);

  const fail = (e: unknown) => {
    const err = editorError(e);
    setRefusal({ message: err.message, where: describePath(draft, err.where) });
  };

  const saveDraft = async (
    schema: ClientFormSchema | null = draft,
    base = published.version,
  ) => {
    setBusy(schema ? "save" : "discard");
    setRefusal(null);
    try {
      const o = await io.saveDraft(published.schema.key, schema, base);
      setOne(o);
      if (!schema)
        setDraft(
          JSON.parse(JSON.stringify(o.published?.schema ?? published.schema)),
        );
      toast.success(schema ? COPY.draftSaved : COPY.discarded);
      return o;
    } catch (e) {
      fail(e);
      return null;
    } finally {
      setBusy(null);
    }
  };

  const publish = async () => {
    setBusy("publish");
    setRefusal(null);
    try {
      if (dirty || !one.draft) {
        const o = await io.saveDraft(
          published.schema.key,
          draft,
          published.version,
        );
        setOne(o);
        if (o.draft?.problem && o.draft.problem !== COPY.noChanges) {
          setRefusal({
            message: o.draft.problem,
            where: describePath(draft, o.draft.where),
          });
          return;
        }
      }
      const out = await io.publish(
        published.schema.key,
        note.trim(),
        published.version,
      );
      setReviewing(false);
      setNote("");
      setOne(out.read);
      toast.success(COPY.published);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const restore = async (version: number, restoreNote: string) => {
    setBusy("restore");
    setRefusal(null);
    try {
      const out = await io.restore(
        published.schema.key,
        version,
        restoreNote.trim() || null,
      );
      setOne(out.read);
      toast.success(COPY.restored(out.version));
      return true;
    } catch (e) {
      fail(e);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const serverProblem =
    !dirty &&
    one.draft?.problem &&
    one.draft.problem !== COPY.noChanges &&
    !stale
      ? {
          message: one.draft.problem,
          where: describePath(draft, one.draft.where),
        }
      : null;
  const changes = changeList(published.schema, draft);
  const field =
    selected.kind === "field"
      ? draft.fields.find(f => f.key === selected.key)
      : undefined;

  return (
    <div className="space-y-4" data-form-editor={published.schema.key}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold tracking-tight">
            {one.form.title}
            <span className="font-mono text-sm font-normal text-muted-foreground">
              v{published.version}
            </span>
          </h2>
          <p className="text-sm text-muted-foreground">
            <bdi dir="rtl" lang="ar">
              {published.schema.title.ar}
            </bdi>
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {one.form.live !== null ? (
              <Chip tone={one.form.live ? "good" : "neutral"}>
                {one.form.live ? "Live to clients" : "Not live yet"}
              </Chip>
            ) : null}
            {one.form.provider !== "native" ? (
              <Chip tone="neutral">
                Clients still answer the Typeform until its switch-on
              </Chip>
            ) : null}
            {dirty ? (
              <Chip tone="warn">Unsaved changes</Chip>
            ) : one.draft ? (
              <Chip tone="warn">{COPY.draftSaved}</Chip>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2" data-actions>
          {one.draft ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              disabled={busy !== null}
              onClick={() => saveDraft(null)}
              data-action="discard"
            >
              {busy === "discard" ? "Discarding…" : COPY.discard}
            </Button>
          ) : null}
          <Button
            variant="outline"
            disabled={busy !== null || !dirty || stale}
            onClick={() => saveDraft()}
            data-action="save"
          >
            {busy === "save" ? "Saving…" : COPY.saveDraft}
          </Button>
          <Button
            disabled={
              busy !== null || !hasChanges || stale || blanks.length > 0
            }
            onClick={() => setReviewing(true)}
            data-action="publish"
          >
            {COPY.publish(next)}
          </Button>
        </div>
      </header>

      {stale && one.draft ? (
        <div
          role="alert"
          className="space-y-2 rounded-xl border border-warning/50 bg-warning/10 px-3 py-2 text-sm"
          data-stale
        >
          <p className="font-medium">
            This draft was started on version {one.draft.baseVersion}; version{" "}
            {published.version} is published now.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={() => saveDraft(draft, published.version)}
            >
              Move my draft onto version {published.version}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              disabled={busy !== null}
              onClick={() => saveDraft(null)}
            >
              {COPY.discard}
            </Button>
          </div>
        </div>
      ) : null}
      {!hasChanges && !stale ? (
        <p className="text-sm text-muted-foreground" data-empty-draft>
          {COPY.noChanges}
        </p>
      ) : null}
      {blanks.length > 0 ? (
        <Refusal
          testId="blanks"
          message={`Fill both languages first: ${blanks.length} ${blanks.length === 1 ? "text is" : "texts are"} still blank.`}
          where={describePath(draft, blanks[0])}
        />
      ) : null}
      {refusal ? (
        <Refusal
          message={refusal.message}
          where={refusal.where}
          testId="server"
        />
      ) : null}
      {!refusal && serverProblem ? (
        <Refusal
          message={serverProblem.message}
          where={serverProblem.where}
          testId="draft"
        />
      ) : null}

      {reviewing ? (
        <section
          className="space-y-3 rounded-2xl border bg-card p-4 sm:p-6"
          data-review
          aria-label="Publish this version"
        >
          <h3 className="text-[15px] font-semibold">{COPY.publish(next)}</h3>
          <ul className="list-disc space-y-0.5 pl-5 text-sm" data-changes>
            {changes.map(c => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="space-y-1">
            <Label htmlFor="forms-editor-note">{COPY.notePrompt}</Label>
            <Textarea
              id="forms-editor-note"
              value={note}
              maxLength={240}
              onChange={e => setNote(e.currentTarget.value)}
              className="min-h-[64px]"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Open forms keep the version they were sent with; new ones get
            version {next}.
            {one.form.provider !== "native"
              ? " Clients see it once this form switches on."
              : ""}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="ghost"
              disabled={busy !== null}
              onClick={() => setReviewing(false)}
            >
              Keep editing
            </Button>
            <Button
              disabled={busy !== null || note.trim().length < 3}
              onClick={publish}
              data-action="confirm-publish"
            >
              {busy === "publish" ? "Publishing…" : COPY.publish(next)}
            </Button>
          </div>
        </section>
      ) : null}

      <div
        data-layout={wide ? "columns" : "stacked"}
        className={cn(
          "grid gap-4",
          wide
            ? "grid-cols-[minmax(0,20rem)_minmax(0,1fr)]"
            : "grid-cols-[minmax(0,1fr)]",
        )}
      >
        <QuestionList
          draft={draft}
          published={published.schema}
          selected={selected}
          onSelect={setSelected}
          onChange={setDraft}
          effectLabel={effectLabel}
          disabled={busy !== null}
        />
        <div className="min-w-0 space-y-4">
          {selected.kind === "texts" || !field ? (
            <FormTexts
              draft={draft}
              onChange={setDraft}
              disabled={busy !== null}
            />
          ) : (
            <QuestionEditor
              key={field.key}
              draft={draft}
              field={field}
              published={published.schema}
              effectNames={(reads[field.key] ?? []).map(
                e => effectLabel.get(e) ?? e,
              )}
              onChange={setDraft}
              onRemoved={() => setSelected({ kind: "texts" })}
              disabled={busy !== null}
            />
          )}
        </div>
      </div>

      <PreviewStrip draft={draft} />

      <RealPreview
        portalBase={portalBase}
        workspaces={workspaces}
        formKey={published.schema.key}
        hasDraft={Boolean(one.draft)}
        unsaved={dirty}
      />

      <History
        one={one}
        dirty={dirty}
        busy={busy !== null}
        onRestore={restore}
      />
    </div>
  );
}

// --- The question list -----------------------------------------------------------------------------

function QuestionList({
  draft,
  published,
  selected,
  onSelect,
  onChange,
  effectLabel,
  disabled,
}: {
  draft: ClientFormSchema;
  published: ClientFormSchema;
  selected: Selected;
  onSelect: (s: Selected) => void;
  onChange: (s: ClientFormSchema) => void;
  effectLabel: Map<string, string>;
  disabled: boolean;
}) {
  const [adding, setAdding] = useState<FieldType>("choice");
  const dragging = useRef<string | null>(null);
  const reads = readsByField(published);
  return (
    <section
      className="min-w-0 rounded-2xl border bg-card"
      aria-label="Questions"
      data-questions
    >
      <div className="border-b px-4 py-3">
        <button
          type="button"
          onClick={() => onSelect({ kind: "texts" })}
          aria-current={selected.kind === "texts" ? "true" : undefined}
          className={cn(
            "w-full rounded-lg px-2 py-1.5 text-left text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            selected.kind === "texts" &&
              "bg-primary/10 ring-1 ring-inset ring-primary/40",
          )}
        >
          Title, texts and messages
        </button>
      </div>
      <ol className="divide-y">
        {draft.fields.map((f, i) => {
          const lock = fieldLocks(published, f.key);
          const isSel = selected.kind === "field" && selected.key === f.key;
          return (
            <li
              key={f.key}
              data-question={f.key}
              draggable={!disabled}
              onDragStart={() => {
                dragging.current = f.key;
              }}
              onDragOver={e => {
                if (dragging.current && canMove(draft, dragging.current, i))
                  e.preventDefault();
              }}
              onDrop={e => {
                e.preventDefault();
                if (dragging.current)
                  onChange(moveField(draft, dragging.current, i));
                dragging.current = null;
              }}
              className={cn(
                "flex min-w-0 items-start gap-1 px-2 py-2",
                isSel && "bg-primary/10",
              )}
            >
              <GripVertical
                aria-hidden
                className="mt-2 size-4 shrink-0 cursor-grab text-muted-foreground"
              />
              <button
                type="button"
                onClick={() => onSelect({ kind: "field", key: f.key })}
                aria-current={isSel ? "true" : undefined}
                className="min-w-0 flex-1 rounded-md px-1 py-1 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-muted"
              >
                <span className="block truncate text-sm">
                  {f.label.en || (
                    <span className="text-muted-foreground">
                      Untitled question
                    </span>
                  )}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1">
                  <Chip dot={false} className="text-[11px]">
                    {TYPE_LABEL[f.type]}
                  </Chip>
                  {f.required ? (
                    <Chip dot={false} className="text-[11px]">
                      required
                    </Chip>
                  ) : null}
                  {f.showIf ? (
                    <Chip dot={false} className="text-[11px]">
                      shows if
                    </Chip>
                  ) : null}
                  {!lock.published ? (
                    <Chip tone="accent" className="text-[11px]">
                      new
                    </Chip>
                  ) : null}
                  {lock.read ? (
                    <span
                      className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
                      title={`Read by ${(reads[f.key] ?? []).map(e => effectLabel.get(e) ?? e).join(" and ")}`}
                      data-locked
                    >
                      <Lock aria-hidden className="size-3" /> read by the
                      cockpit
                    </span>
                  ) : null}
                </span>
              </button>
              <div className="flex shrink-0 flex-col">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={`Move ${f.label.en || f.key} up`}
                  disabled={
                    disabled || !canMove(draft, f.key, i - 1) || i === 0
                  }
                  onClick={() => onChange(moveField(draft, f.key, i - 1))}
                >
                  <ArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={`Move ${f.label.en || f.key} down`}
                  disabled={
                    disabled ||
                    i === draft.fields.length - 1 ||
                    !canMove(draft, f.key, i + 1)
                  }
                  onClick={() => onChange(moveField(draft, f.key, i + 1))}
                >
                  <ArrowDown />
                </Button>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-end gap-2 border-t px-4 py-3">
        <div className="min-w-0 flex-1 space-y-1">
          <Label
            htmlFor="forms-editor-add"
            className="text-xs text-muted-foreground"
          >
            New question
          </Label>
          <select
            id="forms-editor-add"
            className={SELECT}
            value={adding}
            disabled={disabled}
            onChange={e => setAdding(e.currentTarget.value as FieldType)}
          >
            {FIELD_TYPES.map(t => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || draft.fields.length >= 40}
          onClick={() => {
            const out = addFieldTo(draft, adding);
            onChange(out.schema);
            onSelect({ kind: "field", key: out.key });
          }}
          data-action="add-question"
        >
          <Plus /> Add
        </Button>
      </div>
    </section>
  );
}

// --- The form's own texts -------------------------------------------------------------------------

function FormTexts({
  draft,
  onChange,
  disabled,
}: {
  draft: ClientFormSchema;
  onChange: (s: ClientFormSchema) => void;
  disabled: boolean;
}) {
  const set = (patch: Partial<ClientFormSchema>) =>
    onChange({ ...draft, ...patch });
  return (
    <section
      className="min-w-0 space-y-4 rounded-2xl border bg-card p-4 sm:p-6"
      data-texts
      aria-label="Title, texts and messages"
    >
      <Bilingual
        name="title"
        label="Title"
        value={draft.title}
        maxLength={200}
        disabled={disabled}
        onChange={title => set({ title })}
      />
      {draft.intro ? (
        <div className="space-y-1">
          <Bilingual
            name="intro"
            label="Introduction"
            multiline
            value={draft.intro}
            maxLength={600}
            disabled={disabled}
            onChange={intro => set({ intro })}
          />
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => set({ intro: null })}
            disabled={disabled}
          >
            Remove the introduction
          </button>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => set({ intro: { en: "", ar: "" } })}
        >
          <Plus /> Add an introduction
        </Button>
      )}
      <div className="max-w-[12rem] space-y-1">
        <Label htmlFor="forms-editor-minutes" className="text-sm font-medium">
          Minutes shown
        </Label>
        <Input
          id="forms-editor-minutes"
          type="number"
          min={1}
          max={60}
          step={1}
          value={draft.minutes}
          disabled={disabled}
          className="font-mono tabular-nums"
          onChange={e =>
            set({
              minutes: Math.max(
                1,
                Math.min(60, Math.round(Number(e.currentTarget.value) || 1)),
              ),
            })
          }
        />
      </div>
      {draft.context.map((c, i) => (
        <Bilingual
          key={c.key}
          name={`context-${c.key}`}
          label={`Fact from the invite: ${c.key}`}
          hint="The cockpit fills the value; only its words change here."
          value={c.label}
          maxLength={200}
          disabled={disabled}
          onChange={label =>
            set({
              context: draft.context.map((x, j) =>
                j === i ? { ...x, label } : x,
              ),
            })
          }
        />
      ))}
      <Bilingual
        name="submit"
        label="Button"
        value={draft.submit}
        maxLength={200}
        disabled={disabled}
        onChange={submit => set({ submit })}
      />
      <Bilingual
        name="done"
        label="Thank-you line"
        multiline
        value={draft.done}
        maxLength={600}
        disabled={disabled}
        onChange={done => set({ done })}
      />
      <Bilingual
        name="whatsapp"
        label="WhatsApp text"
        multiline
        maxLength={1000}
        hint={
          <>
            Keep <span className="font-mono">{"{form_link}"}</span> where the
            link goes, once; <span className="font-mono">{"{client}"}</span>{" "}
            becomes the client's name. A CSM approves every message before it
            goes.
          </>
        }
        value={draft.invite.whatsapp}
        disabled={disabled}
        onChange={whatsapp => set({ invite: { ...draft.invite, whatsapp } })}
      />
      <Bilingual
        name="push"
        label="Phone alert"
        value={draft.invite.push}
        maxLength={200}
        disabled={disabled}
        onChange={push => set({ invite: { ...draft.invite, push } })}
      />
    </section>
  );
}

// --- One question ----------------------------------------------------------------------------------

function QuestionEditor({
  draft,
  field,
  published,
  effectNames,
  onChange,
  onRemoved,
  disabled,
}: {
  draft: ClientFormSchema;
  field: FormField;
  published: ClientFormSchema;
  effectNames: string[];
  onChange: (s: ClientFormSchema) => void;
  onRemoved: () => void;
  disabled: boolean;
}) {
  const lock = fieldLocks(published, field.key);
  const set = (patch: Partial<FormField>) =>
    onChange(updateField(draft, field.key, patch));
  const index = draft.fields.findIndex(f => f.key === field.key);
  const earlier = draft.fields
    .slice(0, index)
    .filter(f => ["tick", "choice", "scale"].includes(f.type));
  const readWords = effectNames.join(" and ");
  const publishedOptions = new Set(
    (published.fields.find(f => f.key === field.key)?.options ?? []).map(
      o => o.value,
    ),
  );
  return (
    <section
      className="min-w-0 space-y-4 rounded-2xl border bg-card p-4 sm:p-6"
      data-question-editor={field.key}
      aria-label="Question"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Kicker>Question {index + 1}</Kicker>
          <p className="font-mono text-xs text-muted-foreground" data-key>
            {field.key}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          disabled={disabled || lock.read}
          onClick={() => {
            onChange(removeField(draft, field.key));
            onRemoved();
          }}
          data-action="remove-question"
        >
          <Trash2 /> Remove
        </Button>
      </div>
      {lock.read ? (
        <p
          className="flex items-start gap-1.5 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground"
          data-lock-note
        >
          <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          Read by {readWords}. Its words can change; it stays, and its type,
          range, requirement and choices stay as they are.
        </p>
      ) : lock.published ? (
        <p className="text-xs text-muted-foreground">
          Published questions keep their key and type. To ask something else,
          add a new question.
        </p>
      ) : null}

      <Bilingual
        name="label"
        label="Question"
        multiline
        maxLength={200}
        value={field.label}
        disabled={disabled}
        onChange={label => set({ label })}
      />
      {field.hint ? (
        <div className="space-y-1">
          <Bilingual
            name="hint"
            label="Hint"
            value={field.hint}
            maxLength={600}
            disabled={disabled}
            onChange={hint => set({ hint })}
          />
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
            disabled={disabled}
            onClick={() => set({ hint: null })}
          >
            Remove the hint
          </button>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => set({ hint: { en: "", ar: "" } })}
        >
          <Plus /> Add a hint
        </Button>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <Label htmlFor={`type-${field.key}`} className="text-sm font-medium">
            Type
          </Label>
          <select
            id={`type-${field.key}`}
            className={SELECT}
            value={field.type}
            disabled={disabled || lock.published}
            onChange={e => {
              const t = e.currentTarget.value as FieldType;
              const fresh = addFieldTo({ ...draft, fields: [] }, t).schema
                .fields[0];
              if (fresh)
                set({
                  ...fresh,
                  key: field.key,
                  label: field.label,
                  hint: field.hint ?? null,
                  required: field.required,
                  showIf: field.showIf ?? null,
                });
            }}
          >
            {FIELD_TYPES.map(t => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2">
          <Label
            htmlFor={`required-${field.key}`}
            className="text-sm font-medium"
          >
            Required
          </Label>
          <Switch
            id={`required-${field.key}`}
            checked={field.required}
            disabled={disabled || lock.read}
            onCheckedChange={required => set({ required })}
          />
        </div>
      </div>

      {field.type === "scale" ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label
                htmlFor={`min-${field.key}`}
                className="text-xs text-muted-foreground"
              >
                From
              </Label>
              <select
                id={`min-${field.key}`}
                className={cn(SELECT, "font-mono")}
                value={field.min ?? 0}
                disabled={disabled || lock.read}
                onChange={e => set({ min: Number(e.currentTarget.value) })}
              >
                {[0, 1].map(n => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label
                htmlFor={`max-${field.key}`}
                className="text-xs text-muted-foreground"
              >
                To
              </Label>
              <select
                id={`max-${field.key}`}
                className={cn(SELECT, "font-mono")}
                value={field.max ?? 10}
                disabled={disabled || lock.read}
                onChange={e => set({ max: Number(e.currentTarget.value) })}
              >
                {[2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <Bilingual
            name="lowLabel"
            label="Low end"
            value={field.lowLabel}
            maxLength={200}
            disabled={disabled}
            onChange={lowLabel => set({ lowLabel })}
          />
          <Bilingual
            name="highLabel"
            label="High end"
            value={field.highLabel}
            maxLength={200}
            disabled={disabled}
            onChange={highLabel => set({ highLabel })}
          />
        </div>
      ) : null}

      {field.type === "choice" || field.type === "multi" ? (
        <div className="space-y-3" data-options>
          <Kicker as="h3">Choices</Kicker>
          {(field.options ?? []).map((o, i) => (
            <div
              key={o.value}
              className="space-y-1 rounded-lg border p-3"
              data-option={o.value}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-muted-foreground">
                  {o.value}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-destructive hover:text-destructive"
                  disabled={
                    disabled || lock.read || (field.options?.length ?? 0) <= 2
                  }
                  onClick={() =>
                    set({
                      options: (field.options ?? []).filter((_, j) => j !== i),
                    })
                  }
                  aria-label={`Remove choice ${o.label.en || o.value}`}
                >
                  <Trash2 />
                </Button>
              </div>
              <Bilingual
                name={`option-${o.value}`}
                label={`Choice ${i + 1}`}
                value={o.label}
                maxLength={200}
                disabled={disabled}
                onChange={label => {
                  const options = [...(field.options ?? [])];
                  // A choice not yet published takes its value from its English words.
                  const value = publishedOptions.has(o.value)
                    ? o.value
                    : valueFromLabel(
                        label.en || o.value,
                        options.filter((_, j) => j !== i).map(x => x.value),
                      );
                  options[i] = { value, label };
                  set({ options });
                }}
              />
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            disabled={
              disabled || lock.read || (field.options?.length ?? 0) >= 12
            }
            onClick={() =>
              set({
                options: [
                  ...(field.options ?? []),
                  {
                    value: valueFromLabel(
                      "new choice",
                      (field.options ?? []).map(x => x.value),
                    ),
                    label: { en: "", ar: "" },
                  },
                ],
              })
            }
          >
            <Plus /> Add a choice
          </Button>
          {publishedOptions.size > 0 ? (
            <p className="text-xs text-muted-foreground">
              Removing a choice keeps the answers already given with it.
            </p>
          ) : null}
        </div>
      ) : null}

      {field.type === "text" || field.type === "longtext" ? (
        <div className="max-w-[12rem] space-y-1">
          <Label
            htmlFor={`len-${field.key}`}
            className="text-xs text-muted-foreground"
          >
            Longest answer (characters)
          </Label>
          <Input
            id={`len-${field.key}`}
            type="number"
            min={1}
            max={maxLengthCap(draft.key, field.type)}
            className="font-mono tabular-nums"
            value={field.maxLength ?? ""}
            disabled={disabled}
            onChange={e => {
              const hi = maxLengthCap(draft.key, field.type);
              set({
                maxLength: Math.max(
                  1,
                  Math.min(hi, Math.round(Number(e.currentTarget.value) || hi)),
                ),
              });
            }}
          />
        </div>
      ) : null}

      <ShowIfEditor
        field={field}
        earlier={earlier}
        disabled={disabled || lock.read}
        onChange={showIf => set({ showIf })}
      />
    </section>
  );
}

function ShowIfEditor({
  field,
  earlier,
  disabled,
  onChange,
}: {
  field: FormField;
  earlier: FormField[];
  disabled: boolean;
  onChange: (s: FormField["showIf"]) => void;
}) {
  const on = field.showIf?.key
    ? earlier.find(f => f.key === field.showIf?.key)
    : undefined;
  const valueFor = (f: FormField): unknown =>
    f.type === "tick"
      ? true
      : f.type === "choice"
        ? (f.options?.[0]?.value ?? null)
        : (f.max ?? 10);
  return (
    <div className="space-y-2" data-show-if>
      <Kicker as="h3">When it shows</Kicker>
      <div className="grid gap-2 sm:grid-cols-2">
        <select
          aria-label="Show this question"
          className={SELECT}
          value={field.showIf?.key ?? ""}
          disabled={disabled || earlier.length === 0}
          onChange={e => {
            const k = e.currentTarget.value;
            const f = earlier.find(x => x.key === k);
            onChange(f ? { key: f.key, equals: valueFor(f) } : null);
          }}
        >
          <option value="">Always</option>
          {earlier.map(f => (
            <option key={f.key} value={f.key}>
              Only when “{f.label.en || f.key}” is…
            </option>
          ))}
        </select>
        {on ? (
          <select
            aria-label="Answer that shows it"
            className={SELECT}
            value={JSON.stringify(field.showIf?.equals ?? null)}
            disabled={disabled}
            onChange={e =>
              onChange({
                key: on.key,
                equals: JSON.parse(e.currentTarget.value),
              })
            }
          >
            {on.type === "tick"
              ? [true, false].map(v => (
                  <option key={String(v)} value={JSON.stringify(v)}>
                    {v ? "ticked" : "not ticked"}
                  </option>
                ))
              : on.type === "choice"
                ? (on.options ?? []).map(o => (
                    <option key={o.value} value={JSON.stringify(o.value)}>
                      {o.label.en || o.value}
                    </option>
                  ))
                : Array.from(
                    { length: (on.max ?? 10) - (on.min ?? 0) + 1 },
                    (_, i) => (on.min ?? 0) + i,
                  ).map(n => (
                    <option key={n} value={JSON.stringify(n)}>
                      {n}
                    </option>
                  ))}
          </select>
        ) : null}
      </div>
      {earlier.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          A question shows only after an earlier tick box, choice or scale.
        </p>
      ) : null}
    </div>
  );
}

// --- The preview strip (structure, both languages) -------------------------------------------------

function PreviewPane({
  schema,
  lang,
}: {
  schema: ClientFormSchema;
  lang: "en" | "ar";
}) {
  const rtl = lang === "ar";
  const t = (x: Text | null | undefined) => x?.[lang] ?? "";
  return (
    <div
      dir={rtl ? "rtl" : "ltr"}
      lang={lang}
      className="min-w-0 space-y-3 rounded-xl bg-muted/40 p-4"
      data-preview-lang={lang}
    >
      <p
        className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground"
        dir="ltr"
      >
        {lang === "en" ? "English" : "Arabic"}
      </p>
      <p className="text-base font-semibold">{t(schema.title)}</p>
      {schema.intro ? (
        <p className="text-sm text-muted-foreground">{t(schema.intro)}</p>
      ) : null}
      <ol className="space-y-3">
        {schema.fields.map(f => (
          <li key={f.key} className="space-y-1">
            <p className="text-sm font-medium">
              {t(f.label) || "…"}
              {f.required ? null : (
                <span className="ms-1 text-xs font-normal text-muted-foreground">
                  {rtl ? "(اختياري)" : "(optional)"}
                </span>
              )}
            </p>
            {f.showIf ? (
              <p className="text-xs text-muted-foreground" dir="ltr">
                shows after {f.showIf.key} = {JSON.stringify(f.showIf.equals)}
              </p>
            ) : null}
            {f.type === "scale" ? (
              <div className="flex flex-wrap gap-1" aria-hidden>
                {Array.from(
                  { length: (f.max ?? 10) - (f.min ?? 0) + 1 },
                  (_, i) => (f.min ?? 0) + i,
                ).map(n => (
                  <span
                    key={n}
                    className="inline-flex size-7 items-center justify-center rounded-md border bg-card font-mono text-xs tabular-nums"
                  >
                    {rtl ? n.toLocaleString("ar-EG") : n}
                  </span>
                ))}
              </div>
            ) : null}
            {f.type === "choice" || f.type === "multi" ? (
              <div className="flex flex-wrap gap-1">
                {(f.options ?? []).map(o => (
                  <span
                    key={o.value}
                    className="rounded-full border bg-card px-2 py-0.5 text-xs"
                  >
                    {t(o.label) || "…"}
                  </span>
                ))}
              </div>
            ) : null}
            {f.type === "text" || f.type === "longtext" ? (
              <div
                className={cn(
                  "rounded-md border bg-card",
                  f.type === "longtext" ? "h-12" : "h-7",
                )}
                aria-hidden
              />
            ) : null}
            {f.type === "tick" ? (
              <span
                className="inline-block size-4 rounded border bg-card align-middle"
                aria-hidden
              />
            ) : null}
          </li>
        ))}
      </ol>
      <span className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">
        {t(schema.submit) || "…"}
      </span>
    </div>
  );
}

function PreviewStrip({ draft }: { draft: ClientFormSchema }) {
  return (
    <SectionCard
      title="Preview"
      sub="The structure as the client meets it, in both languages. The real portal page opens below."
    >
      <div className="grid gap-3 md:grid-cols-2" data-preview>
        <PreviewPane schema={draft} lang="en" />
        <PreviewPane schema={draft} lang="ar" />
      </div>
    </SectionCard>
  );
}

function RealPreview({
  portalBase,
  workspaces,
  formKey,
  hasDraft,
  unsaved,
}: {
  portalBase: string;
  workspaces: EditorRead["workspaces"];
  formKey: string;
  hasDraft: boolean;
  unsaved: boolean;
}) {
  const [ws, setWs] = useState(
    () => defaultWorkspace(workspaces)?.locationId ?? "",
  );
  useEffect(() => {
    if (!ws && workspaces.length)
      setWs(defaultWorkspace(workspaces)?.locationId ?? "");
  }, [workspaces, ws]);
  return (
    <SectionCard
      title="The real preview"
      sub="The client's own portal page, opened as the team. Nothing is recorded there."
    >
      {workspaces.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No open workspace to preview on.
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-3" data-real-preview>
          <div className="min-w-0 flex-1 space-y-1 sm:max-w-xs">
            <Label
              htmlFor="forms-editor-workspace"
              className="text-xs text-muted-foreground"
            >
              Workspace
            </Label>
            <select
              id="forms-editor-workspace"
              className={SELECT}
              value={ws}
              onChange={e => setWs(e.currentTarget.value)}
            >
              {workspaces.map(w => (
                <option key={w.locationId} value={w.locationId}>
                  {w.name}
                  {w.status && w.status !== "Active" ? ` (${w.status})` : ""}
                </option>
              ))}
            </select>
          </div>
          <ExtLink
            href={previewUrl(portalBase, ws, formKey, hasDraft)}
            className="h-9 text-sm font-medium"
          >
            {COPY.realPreview}
          </ExtLink>
          <p className="w-full text-xs text-muted-foreground">
            {unsaved
              ? "Save the draft first: the preview shows the saved draft."
              : hasDraft
                ? "It shows the saved draft."
                : "It shows the published version."}
          </p>
        </div>
      )}
    </SectionCard>
  );
}

// --- The history (the signature: a vertical delivery line) -----------------------------------------

function History({
  one,
  dirty,
  busy,
  onRestore,
}: {
  one: EditorOne;
  dirty: boolean;
  busy: boolean;
  onRestore: (version: number, note: string) => Promise<boolean>;
}) {
  const [confirming, setConfirming] = useState<number | null>(null);
  const [note, setNote] = useState("");
  return (
    <SectionCard
      title="Versions"
      sub="Every published version stays. Going back publishes the old one as a new version."
    >
      <ol className="relative space-y-0" data-history>
        {one.draft || dirty ? (
          <li className="relative flex gap-3 pb-4" data-history-draft>
            <Ring tone="draft" />
            <div className="min-w-0 pb-1">
              <p className="font-mono text-xs">
                draft
                {one.draft
                  ? ` · saved ${kuwaitDay(one.draft.savedAt)} · ${one.draft.savedBy}`
                  : " · not saved yet"}
              </p>
            </div>
          </li>
        ) : null}
        {one.history.map((h, i) => (
          <li
            key={h.version}
            className="relative flex gap-3 pb-4"
            data-version={h.version}
          >
            {i < one.history.length - 1 ? (
              <span
                aria-hidden
                className="absolute top-4 bottom-0 left-[7px] w-px bg-border"
              />
            ) : null}
            <Ring tone={h.current ? "current" : "past"} />
            <div className="min-w-0 flex-1">
              <p className="font-mono text-xs">{historyLine(h)}</p>
              {h.note ? (
                <p className="text-sm text-muted-foreground">{h.note}</p>
              ) : null}
              {!h.current && h.client ? (
                confirming === h.version ? (
                  <div
                    className="mt-2 space-y-2 rounded-lg border p-3"
                    data-restore={h.version}
                  >
                    <Label
                      htmlFor={`restore-${h.version}`}
                      className="text-xs text-muted-foreground"
                    >
                      Why go back? (optional, shown in the history)
                    </Label>
                    <Input
                      id={`restore-${h.version}`}
                      value={note}
                      maxLength={200}
                      onChange={e => setNote(e.currentTarget.value)}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={async () => {
                          if (await onRestore(h.version, note)) {
                            setConfirming(null);
                            setNote("");
                          }
                        }}
                        data-action="confirm-restore"
                      >
                        {COPY.goBack(h.version)}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setConfirming(null)}
                      >
                        Keep version {one.published?.version}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto px-0 text-[color:var(--primary-ink)]"
                    disabled={busy}
                    onClick={() => {
                      setConfirming(h.version);
                      setNote("");
                    }}
                    data-action={`restore-${h.version}`}
                  >
                    {COPY.goBack(h.version)}
                  </Button>
                )
              ) : null}
              {!h.client ? (
                <p className="text-xs text-muted-foreground">
                  The Typeform record; it cannot come back here.
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </SectionCard>
  );
}

function Ring({ tone }: { tone: "current" | "past" | "draft" }) {
  return (
    <span
      aria-hidden
      data-ring={tone}
      className={cn(
        "relative z-10 mt-0.5 inline-block size-[15px] shrink-0 rounded-full border-2 bg-card transition-colors duration-150 motion-reduce:transition-none",
        tone === "current" && "border-primary bg-primary",
        tone === "past" && "border-muted-foreground/40",
        tone === "draft" && "border-warning border-dashed",
      )}
    />
  );
}
