import { useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

/** Tickets the CSM raises. Picking the request picks the board — she never picks a team. */
const TICKETS: { label: string; dept: string; deptLabel: string }[] = [
  {
    label: "Switch this campaign to a landing page",
    dept: "tech",
    deptLabel: "Tech",
  },
  {
    label: "Add qualification questions to the lead form",
    dept: "tech",
    deptLabel: "Tech",
  },
  { label: "Tracking / page is broken", dept: "tech", deptLabel: "Tech" },
  { label: "GHL or automation change needed", dept: "tech", deptLabel: "Tech" },
  { label: "New ads needed", dept: "creative", deptLabel: "Creative" },
  { label: "New scripts needed", dept: "creative", deptLabel: "Creative" },
  {
    label: "Thank-you video to lift show rate",
    dept: "creative",
    deptLabel: "Creative",
  },
  {
    label: "Lead quality is poor — review targeting",
    dept: "media_buyer",
    deptLabel: "Media buyer",
  },
  {
    label: "Budget change requested by the client",
    dept: "media_buyer",
    deptLabel: "Media buyer",
  },
  {
    label: "Leads are not being called",
    dept: "call_center",
    deptLabel: "Call centre",
  },
  {
    label: "Show-rate SOP needed for this account",
    dept: "call_center",
    deptLabel: "Call centre",
  },
];

const STAGES = [
  "Active",
  "Needs Contacting",
  "Onboarding Booked",
  "LAUNCH BOOKED",
  "Ready For Launch🚀",
  "DELAY OUT OF OUR CONTROL",
  "GHOSTED",
  "Paused",
  "Stopped",
];
const HAPPINESS = [
  "Very Happy (testimonial)",
  "Happy",
  "Neutral",
  "At Risk",
  "Paused",
  "Churned",
];
const REASONS = [
  "Client is travelling / unavailable",
  "Waiting on the client to send something",
  "Waiting on another team",
  "Already handled outside the app",
  "Disagree with the call",
];
const CLOCKS = ["Tomorrow", "In 3 days", "Next week"];

/** Booking links and forms, lifted from the Client Journey SOP so nobody hunts. */
const LINKS = {
  onboardingCall:
    "https://api.leadconnectorhq.com/widget/booking/z1Ne59rohCCj87KhcXoi",
  checkInCall:
    "https://api.leadconnectorhq.com/widget/booking/SHjlq0UjeR11maltYNyh",
  callSummaryForm: "https://maharamedia.typeform.com/to/fRokTITH",
  kickoffForm: "https://maharamedia.typeform.com/to/BbJy6xg4",
  calculator: "http://calculator.maharamedia.com",
};

/**
 * Which call is next in the journey, its booking link, and a message the CSM can send
 * as-is. Arabic, because the clients are Arabic — the CSM edits, then sends by hand.
 */
function nextCall(c: Client): { label: string; url: string; message: string } {
  const name = c.name;
  if (c.stage === "Needs Contacting")
    return {
      label: "Welcome call, then the onboarding call",
      url: LINKS.onboardingCall,
      message: `أهلاً ${name} 👋 معك فريق مهارة. حاولنا نتواصل معك للترحيب فيك في البرنامج. خطوتنا القادمة هي مكالمة الانضمام (٦٠ دقيقة) ويفضل تكون من الكمبيوتر ومسجّل دخول على حساب فيسبوك. تحجز الوقت المناسب لك من هنا: ${LINKS.onboardingCall}`,
    };
  if (c.bucket === "onboarding")
    return {
      label: "Onboarding call",
      url: LINKS.onboardingCall,
      message: `أهلاً ${name} 👋 لتثبيت موعد مكالمة الانضمام، اختر الوقت المناسب لك من هنا: ${LINKS.onboardingCall} — ويفضل تكون من الكمبيوتر ومسجّل دخول على فيسبوك حتى نجهز كل شيء في نفس المكالمة.`,
    };
  return {
    label: "Client check-in call",
    url: LINKS.checkInCall,
    message: `أهلاً ${name} 👋 حاب نراجع معك أرقام الحملة: عدد العملاء المحتملين، الحجوزات، وتكلفة الحجز، ونتفق على الخطوة القادمة. احجز الوقت المناسب لك من هنا: ${LINKS.checkInCall}`,
  };
}

/**
 * The message the CSM should actually send, chosen from the cadence rule that fired.
 * Arabic, editable, never auto-sent — Viktor drafts, a human sends.
 */
function draftFor(c: Client): { why: string; message: string } {
  const name = c.name;
  if (c.pauseRequired)
    return {
      why: `Invoice ${c.paymentDue}d past due with no extension logged`,
      message: `أهلاً ${name} 👋 تنبيه ودّي بخصوص الفاتورة المستحقة. نحتاج تسويتها اليوم حتى لا تتوقف الحملة، وإذا تحتاج تمديد بسيط أخبرني وأرتبها لك.`,
    };
  if (c.stage === "Needs Contacting")
    return {
      why: "New signup — welcome call first, then the onboarding call",
      message: `أهلاً ${name} 👋 معك فريق مهارة، مبروك انضمامك للبرنامج! حاولنا نتواصل معك للترحيب. خطوتنا القادمة مكالمة الانضمام، وأرسل لك الرابط للحجز.`,
    };
  if (c.bucket === "onboarding")
    return {
      why: `In onboarding (${c.stage}) — message every working day until they move`,
      message: `أهلاً ${name} 👋 متابعة بسيطة على خطوة الانضمام حتى نطلق حملتك في أسرع وقت. باقي علينا تثبيت الموعد وتجهيز الوصول للحسابات — تحب أساعدك فيها الآن؟`,
    };
  if ((c.liveDays ?? 99) <= 7)
    return {
      why: `Launch week (day ${c.liveDays}) — daily message, review call on day 7`,
      message: `صباح الخير ${name} 👋 تحديث سريع على الحملة في أسبوعها الأول. أي استفسار من العملاء الجدد أو أي شيء تحب نعدّله، خبرني وأتابعه فوراً.`,
    };
  if ((c.callDays ?? 99) >= 14)
    return {
      why: "14 days since the last check-in call",
      message: `أهلاً ${name} 👋 حاب نراجع معك الأرقام في مكالمة قصيرة: العملاء المحتملين، الحجوزات، وتكلفة الحجز، ونتفق على الخطوة القادمة.`,
    };
  if ((c.silentDays ?? 99) >= 7)
    return {
      why: `No contact for ${c.silentDays ?? "?"} days`,
      message: `أهلاً ${name} 👋 أطمئن عليك وعلى الحملة. آخر الأرقام عندنا إيجابية، وحاب أسمع منك كيف الحجوزات من ناحيتكم.`,
    };
  return {
    why: c.todo,
    message: `أهلاً ${name} 👋 تحديث سريع على الحملة، وأي شيء تحتاجه أنا موجود.`,
  };
}

const LEVEL: Record<string, string> = {
  red: "border-l-4 border-rose-500 bg-rose-50/40",
  amber: "border-l-4 border-amber-500 bg-amber-50/40",
  blue: "border-l-4 border-sky-500 bg-sky-50/30",
  green: "border-l-4 border-emerald-500",
};

const CHIP: Record<string, string> = {
  red: "bg-rose-100 text-rose-700",
  amber: "bg-amber-100 text-amber-700",
  blue: "bg-sky-100 text-sky-700",
  green: "bg-emerald-100 text-emerald-700",
};

// biome-ignore lint/suspicious/noExplicitAny: snapshot payload is untyped by design
type Client = any;

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-xl font-semibold ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

/**
 * Bottom-right escape hatch: if the screen is wrong, say so where you noticed it.
 * It files an owned task rather than becoming a message someone forgets.
 */
function IssueReporter({ page }: { page: string }) {
  const report = useMutation(api.csm.reportIssue);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  return (
    <div className="fixed bottom-4 left-4 z-30 w-[min(22rem,calc(100vw-2rem))] md:left-[calc(var(--sidebar-width,16rem)+1rem)]">
      {open ? (
        <div className="space-y-2 rounded-lg border bg-card p-3 shadow-lg">
          <div className="text-sm font-semibold">
            Something wrong on this screen?
          </div>
          <p className="text-xs text-muted-foreground">
            Wrong client, wrong instruction, missing field — say it here and It
            gets fixed.
          </p>
          <Textarea
            rows={3}
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="What is wrong, and what should it say instead?"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={async () => {
                if (!text.trim()) return;
                await report({ page, text: text.trim() });
                setText("");
                setOpen(false);
                toast.success("Sent. A fix task was created");
              }}
            >
              Send it
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          className="shadow-lg"
          onClick={() => setOpen(true)}
        >
          Something wrong here?
        </Button>
      )}
    </div>
  );
}

/**
 * One client, one recommended message, editable and sendable by hand. Shows when the
 * last proactive message actually went out, so silence is visible per row.
 */
function TouchpointRow({
  c,
  onLog,
}: {
  c: Client;
  onLog: (
    c: Client,
    action: string,
    kind: string,
    extra?: Record<string, unknown>,
  ) => void;
}) {
  const draft = draftFor(c);
  const [text, setText] = useState(draft.message);
  const [open, setOpen] = useState(false);
  const nc = nextCall(c);
  return (
    <div className={`rounded-lg border ${LEVEL[c.level] ?? ""}`}>
      <button
        type="button"
        className="flex w-full flex-wrap items-start justify-between gap-2 px-4 py-3 text-left"
        onClick={() => setOpen(!open)}
      >
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{c.name}</span>
            <span
              className={`rounded px-1.5 py-0.5 text-[12px] ${CHIP[c.level]}`}
            >
              {c.stage}
            </span>
            {c.defcon && (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[12px] text-slate-600">
                {c.defcon}
              </span>
            )}
          </div>
          <div className="mt-1 text-sm">{draft.why}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            last proactive message{" "}
            {c.lastPoc ? `${c.lastPoc} (${c.silentDays}d ago)` : "never"} · last
            call {c.lastCall ?? "never"} · 1-1 notes {c.lastNoteOn ?? "none"}
          </div>
        </div>
        <span className="text-xs text-muted-foreground">
          {open ? "close" : "draft"}
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t px-4 py-3">
          <Textarea
            rows={4}
            value={text}
            onChange={e => setText(e.target.value)}
            dir="auto"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(text);
                toast.success(
                  "Copied — paste it into the client's WhatsApp group",
                );
              }}
            >
              Copy the message
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                onLog(c, "Sent the recommended message", "touchpoint", {
                  note: text,
                })
              }
            >
              Sent it — log the touchpoint
            </Button>
            <a
              className="rounded bg-muted px-2 py-1 text-xs"
              href={nc.url}
              target="_blank"
              rel="noreferrer"
            >
              {nc.label} link
            </a>
            {c.noteMissing && (
              <a
                className="rounded bg-rose-100 px-2 py-1 text-xs text-rose-700"
                href={LINKS.callSummaryForm}
                target="_blank"
                rel="noreferrer"
              >
                1-1 notes missing for the last call
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Every checklist item carries the reason it exists — click it and you see why. */
function ChecklistItem({
  title,
  why,
  action,
}: {
  title: string;
  why: string;
  action?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded border">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-sm"
        onClick={() => setOpen(!open)}
      >
        <span>{title}</span>
        <span className="text-xs text-muted-foreground">
          {open ? "hide" : "why?"}
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t px-3 py-2 text-xs text-muted-foreground">
          <div>{why}</div>
          {action}
        </div>
      )}
    </div>
  );
}

export function CsmPage() {
  const snap = useQuery(api.csm.snapshot, {});
  const toggleCheck = useMutation(api.csm.toggleCheck);
  const act = useMutation(api.csm.act);
  const addPlanItems = useMutation(api.csm.addPlanItems);
  const submitEod = useMutation(api.csm.submitEod);

  const [open, setOpen] = useState<string | null>(null);
  const [panel, setPanel] = useState<
    "actions" | "book" | "ticket" | "leave" | "update"
  >("actions");
  const [ticket, setTicket] = useState(TICKETS[0].label);
  const [ticketNote, setTicketNote] = useState("");
  const [reason, setReason] = useState(REASONS[0]);
  const [clock, setClock] = useState(CLOCKS[1]);
  const [note, setNote] = useState("");
  const [dump, setDump] = useState("");
  const [energy, setEnergy] = useState("Energy 4");
  const [stress, setStress] = useState("Stress 2");
  const [lost, setLost] = useState("");
  const [onePercent, setOnePercent] = useState("");
  const [rollup, setRollup] = useState("");
  const [tab, setTab] = useState<
    | "today"
    | "touchpoints"
    | "management"
    | "onboarding"
    | "hot"
    | "loose"
    | "tasks"
  >("today");

  const done = useMemo(
    () =>
      new Set(
        (snap?.decisions ?? []).map((d: { subject: string }) => d.subject),
      ),
    [snap],
  );

  if (snap === undefined) {
    return (
      <div className="p-10 text-sm text-muted-foreground">
        Loading today's clients…
      </div>
    );
  }

  const t = snap.totals;
  // biome-ignore lint/suspicious/noExplicitAny: decision rows
  const ds: any[] = snap.decisions;
  const callsToday = ds.filter(d => /call/i.test(d.action)).length;
  const signupsToday = ds.filter(d =>
    /signup|welcome|onboarding/i.test(d.action),
  ).length;
  const hotToday = ds.filter(d =>
    /upsell|referral|review/i.test(d.action),
  ).length;
  const ticketsToday = ds.filter(d => d.kind === "rerouted").length;
  const clients: Client[] = snap.clients;
  // Today = the combined priority list across both motions; the other two tabs are the
  // split, so he can work one motion at a time.
  const needsAction = (c: Client) => c.rank < 40 && c.level !== "green";
  const todayList = clients.filter(needsAction);
  const managementList = clients.filter(c => c.bucket === "management");
  const onboardingList = clients.filter(c => c.bucket === "onboarding");
  const hotList = clients.filter(c => c.hot.length > 0 && !c.hotBlocked);
  const looseList = clients.filter(c => c.loose.length > 0);
  const ticketRows = ds.filter(d => d.kind === "rerouted");
  // A commitment counts as outstanding until the CSM turns it into a task or says done.
  const handledText = new Set(ds.map(d => d.action));
  const commitmentRows = clients.flatMap((c: Client) =>
    (c.commitments ?? [])
      .filter(
        (item: { text: string }) =>
          !handledText.has(`Commitment handled: ${item.text}`),
      )
      .map((item: { text: string; source: string }) => ({ client: c, item })),
  );

  const run = async (
    c: Client,
    action: string,
    kind: string,
    extra: Record<string, unknown> = {},
  ) => {
    await act({ clientId: c._id as Id<"clients">, action, kind, ...extra });
    setOpen(null);
    setNote("");
    setTicketNote("");
    toast.success(
      kind === "ticket"
        ? "Ticket created on the right board"
        : kind === "left"
          ? "Left, with a reason logged"
          : "Logged to ClickUp",
    );
  };

  const submitPlan = async () => {
    const items = dump
      .split("\n")
      .map(l => l.trim())
      .filter(Boolean)
      .map(text => ({ text }));
    if (!items.length) return;
    await addPlanItems({ items });
    setDump("");
    toast.success(
      `${items.length} task${items.length > 1 ? "s" : ""} created for tomorrow`,
    );
  };

  const row = (c: Client) => {
    const isOpen = open === c.name;
    const handled = done.has(c.name);
    return (
      <div
        key={c.taskId}
        className={`rounded-lg border ${LEVEL[c.level] ?? ""} ${handled ? "opacity-55" : ""}`}
      >
        <button
          type="button"
          className="flex w-full flex-wrap items-start justify-between gap-2 px-4 py-3 text-left"
          onClick={() => {
            setOpen(isOpen ? null : c.name);
            setPanel("actions");
          }}
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{c.name}</span>
              <span
                className={`rounded px-1.5 py-0.5 text-[12px] ${CHIP[c.level]}`}
              >
                {c.stage}
              </span>
              {c.happiness && (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[12px] text-slate-600">
                  {c.happiness}
                </span>
              )}
              {handled && (
                <span className="text-[12px] text-emerald-700">
                  ✓ handled today
                </span>
              )}
            </div>
            <div className="mt-1 text-sm">{c.todo}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {c.lastPoc ? `last contact ${c.lastPoc}` : "never contacted"}
              {c.lastCall ? ` · last call ${c.lastCall}` : " · no call logged"}
              {c.nextPoc ? ` · next ${c.nextPoc}` : ""}
              {c.liveDays !== undefined ? ` · live ${c.liveDays}d` : ""}
              {c.csmAssigned ? ` · ${c.csmAssigned}` : ""}
            </div>
          </div>
          <span className="text-xs text-muted-foreground">
            {isOpen ? "close" : "open"}
          </span>
        </button>

        {isOpen && (
          <div className="space-y-3 border-t px-4 py-3">
            <div className="flex flex-wrap gap-2 text-xs">
              {(["actions", "book", "update", "ticket", "leave"] as const).map(
                p => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPanel(p)}
                    className={`rounded px-2 py-1 ${panel === p ? "bg-foreground text-background" : "bg-muted"}`}
                  >
                    {p === "actions"
                      ? "Do it"
                      : p === "book"
                        ? "Book the next call"
                        : p === "update"
                          ? "Update the board"
                          : p === "ticket"
                            ? "Raise a ticket"
                            : "Leave it"}
                  </button>
                ),
              )}
            </div>

            {panel === "actions" && (
              <div className="space-y-2">
                <Textarea
                  placeholder="Call summary or what you said to them (optional — goes on the ClickUp task)"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  rows={2}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      run(c, "Messaged the client", "touchpoint", { note })
                    }
                  >
                    Logged a message
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => run(c, "Held a call", "call", { note })}
                  >
                    Logged a call + summary
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const d = prompt("Next touchpoint date (YYYY-MM-DD)");
                      if (d)
                        run(
                          c,
                          `Booked the next touchpoint for ${d}`,
                          "booked",
                          { value: d },
                        );
                    }}
                  >
                    Book the next touchpoint
                  </Button>
                  {c.sheetLink && (
                    <a
                      className="text-xs underline"
                      href={c.sheetLink}
                      target="_blank"
                      rel="noreferrer"
                    >
                      report sheet
                    </a>
                  )}
                  {c.taskUrl && (
                    <a
                      className="text-xs underline"
                      href={c.taskUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      ClickUp
                    </a>
                  )}
                </div>
                {c.hot.length > 0 && !c.hotBlocked && (
                  <div className="rounded border border-emerald-300 bg-emerald-50/60 p-2">
                    <div className="text-xs font-semibold text-emerald-800">
                      Hot list
                    </div>
                    {c.hot.map((h: { kind: string; why: string }) => (
                      <div
                        key={h.kind}
                        className="mt-1 flex items-center justify-between gap-2 text-xs"
                      >
                        <span>
                          <strong>{h.kind}</strong> — {h.why}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            run(c, `${h.kind} conversation had`, "upsell", {
                              note: h.why,
                            })
                          }
                        >
                          Had it
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                {c.changes.length > 0 && (
                  <div className="rounded border bg-muted/40 p-2">
                    <div className="text-xs font-semibold">
                      Campaign changes since your last call
                    </div>
                    {c.changes.map(
                      (
                        ch: { action: string; day: string; evidence: string },
                        i: number,
                      ) => (
                        <div
                          key={`${ch.day}-${i}`}
                          className="mt-1 text-xs text-muted-foreground"
                        >
                          <span className="text-foreground">{ch.day}</span> —{" "}
                          {ch.action}. {ch.evidence}
                        </div>
                      ),
                    )}
                  </div>
                )}
                {c.loose.length > 0 && (
                  <div className="text-xs text-rose-700">
                    Loose ends: {c.loose.join(" · ")}
                  </div>
                )}
              </div>
            )}

            {panel === "book" && (
              <div className="space-y-2 text-sm">
                {(() => {
                  const nc = nextCall(c);
                  return (
                    <>
                      <div className="text-xs text-muted-foreground">
                        Next in the journey: <strong>{nc.label}</strong>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <a
                          className="rounded bg-foreground px-2 py-1 text-xs text-background"
                          href={nc.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open the booking link
                        </a>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            navigator.clipboard.writeText(nc.url);
                            toast.success("Booking link copied");
                          }}
                        >
                          Copy the link
                        </Button>
                        <a
                          className="text-xs underline"
                          href={LINKS.callSummaryForm}
                          target="_blank"
                          rel="noreferrer"
                        >
                          1-1 call summary form
                        </a>
                      </div>
                      <Textarea
                        rows={4}
                        defaultValue={nc.message}
                        id={`msg-${c.taskId}`}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            const el = document.getElementById(
                              `msg-${c.taskId}`,
                            ) as HTMLTextAreaElement | null;
                            navigator.clipboard.writeText(
                              el?.value ?? nc.message,
                            );
                            toast.success(
                              "Message copied — send it from WhatsApp",
                            );
                          }}
                        >
                          Copy the message
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => {
                            const d = prompt(
                              "Booked for which date? (YYYY-MM-DD)",
                            );
                            if (d)
                              run(c, `Booked ${nc.label} for ${d}`, "booked", {
                                value: d,
                                note: `Sent the booking link (${nc.url}).`,
                              });
                          }}
                        >
                          They booked — log the date
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            run(
                              c,
                              `Sent the ${nc.label} booking link`,
                              "touchpoint",
                              {
                                note: `Booking link sent: ${nc.url}`,
                              },
                            )
                          }
                        >
                          Sent it, not booked yet
                        </Button>
                      </div>
                      <p className="text-[12px] text-muted-foreground">
                        The cockpit drafts, you send. Nothing goes to the client
                        from here.
                      </p>
                    </>
                  );
                })()}
              </div>
            )}

            {panel === "update" && (
              <div className="space-y-2 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">
                    Client status
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {STAGES.map(s => (
                      <button
                        key={s}
                        type="button"
                        className={`rounded px-2 py-1 text-xs ${s === c.stage ? "bg-foreground text-background" : "bg-muted"}`}
                        onClick={() =>
                          run(c, `Moved to ${s}`, "stage", { value: s })
                        }
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">
                    Client happiness
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {HAPPINESS.map(h => (
                      <button
                        key={h}
                        type="button"
                        className={`rounded px-2 py-1 text-xs ${h === c.happiness ? "bg-foreground text-background" : "bg-muted"}`}
                        onClick={() =>
                          run(c, `Happiness set to ${h}`, "happiness", {
                            value: h,
                          })
                        }
                      >
                        {h}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {panel === "ticket" && (
              <div className="space-y-2">
                <select
                  className="w-full rounded border bg-background px-2 py-1 text-sm"
                  value={ticket}
                  onChange={e => setTicket(e.target.value)}
                >
                  {TICKETS.map(r => (
                    <option key={r.label} value={r.label}>
                      {r.label} → {r.deptLabel}
                    </option>
                  ))}
                </select>
                <Textarea
                  placeholder="What exactly is needed?"
                  value={ticketNote}
                  onChange={e => setTicketNote(e.target.value)}
                  rows={2}
                />
                <Button
                  size="sm"
                  onClick={() => {
                    const hit = TICKETS.find(r => r.label === ticket)!;
                    run(c, hit.label, "ticket", {
                      department: hit.dept,
                      note: ticketNote,
                    });
                  }}
                >
                  Create it on{" "}
                  {TICKETS.find(r => r.label === ticket)?.deptLabel}
                </Button>
              </div>
            )}

            {panel === "leave" && (
              <div className="space-y-2">
                <select
                  className="w-full rounded border bg-background px-2 py-1 text-sm"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                >
                  {REASONS.map(r => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
                <div className="flex gap-1">
                  {CLOCKS.map(k => (
                    <button
                      key={k}
                      type="button"
                      className={`rounded px-2 py-1 text-xs ${k === clock ? "bg-foreground text-background" : "bg-muted"}`}
                      onClick={() => setClock(k)}
                    >
                      {k}
                    </button>
                  ))}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    run(c, "Left as is", "left", { reason, snooze: clock })
                  }
                >
                  Leave it, show me {clock.toLowerCase()}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <IssueReporter page={tab} />
      <header>
        <h1 className="text-2xl font-bold tracking-tight">
          Client Success Cockpit
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {new Date().toLocaleDateString("en-GB", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}{" "}
          ·{" "}
          {snap.lastSyncAt
            ? `synced ${new Date(snap.lastSyncAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
            : "not yet synced"}{" "}
          · clients on WhatsApp, team on Slack
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Need you today" value={t.dueToday} tone="text-rose-600" />
        <Stat
          label="New signups"
          value={t.newSignups}
          tone={t.newSignups ? "text-rose-600" : ""}
        />
        <Stat label="In onboarding" value={t.onboarding} />
        <Stat label="Managed clients" value={t.managed ?? 0} />
        <Stat
          label="Invoices past due"
          value={t.pastDue}
          tone={t.pastDue ? "text-rose-600" : ""}
        />
        <Stat label="Hot list" value={t.hot} tone="text-emerald-600" />
        <Stat label="Loose ends" value={t.loose} />
      </div>

      <section className="rounded-lg border">
        <div className="border-b px-4 py-2 text-sm font-semibold">
          Your day — three sprints
        </div>
        <div className="divide-y">
          {snap.checks.map(
            (c: {
              _id: string;
              label: string;
              detail?: string;
              done: boolean;
            }) => (
              <button
                key={c._id}
                type="button"
                className="flex w-full items-start gap-3 px-4 py-2 text-left text-sm"
                onClick={() => toggleCheck({ id: c._id as Id<"checks"> })}
              >
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[11px] ${c.done ? "bg-emerald-600 text-white" : ""}`}
                >
                  {c.done ? "✓" : ""}
                </span>
                <span className={c.done ? "line-through opacity-60" : ""}>
                  {c.label}
                  {c.detail && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {c.detail}
                    </span>
                  )}
                </span>
              </button>
            ),
          )}
        </div>
      </section>

      <div className="flex flex-wrap gap-2 text-sm">
        {(
          [
            ["today", `Today (${todayList.length})`],
            [
              "management",
              `Client management (${managementList.filter(needsAction).length}/${managementList.length})`,
            ],
            [
              "onboarding",
              `Client onboarding (${onboardingList.filter(needsAction).length}/${onboardingList.length})`,
            ],
            ["hot", `Hot list (${hotList.length})`],
            ["loose", `Loose ends (${looseList.length})`],
            ["tasks", `ClickUp tasks (${snap.tasks.length})`],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`rounded px-3 py-1 ${tab === k ? "bg-foreground text-background" : "bg-muted"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "today" && (
        <div className="space-y-3">
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Onboarding — get them live (
              {onboardingList.filter(needsAction).length})
            </div>
            {onboardingList.filter(needsAction).map(row)}
          </div>
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Management — keep them alive (
              {managementList.filter(needsAction).length})
            </div>
            {managementList.filter(needsAction).map(row)}
          </div>
        </div>
      )}
      {tab === "touchpoints" && (
        <div className="space-y-4">
          {[
            {
              key: "launch",
              title: "Launch week — message every day",
              hint: "Day 1–7 after launch, plus the day-7 review call.",
              rows: clients.filter(
                c => c.bucket === "management" && (c.liveDays ?? 99) <= 7,
              ),
            },
            {
              key: "pipeline",
              title:
                "In onboarding — message every working day until they move",
              hint: "Nothing else moves them forward.",
              rows: onboardingList.filter(needsAction),
            },
            {
              key: "call",
              title: "Check-in call due — 14 days since the last one",
              hint: "A message does not clear this. It needs a call.",
              rows: clients.filter(
                c =>
                  c.bucket === "management" &&
                  (c.liveDays ?? 0) > 7 &&
                  (c.callDays === undefined || c.callDays >= 14),
              ),
            },
            {
              key: "silent",
              title: "Going quiet — 7 days or more with no contact",
              hint: "Comms level slips to Meh at 14 days, Danger at 30.",
              rows: clients.filter(
                c =>
                  c.bucket === "management" &&
                  (c.silentDays === undefined || c.silentDays >= 7),
              ),
            },
            {
              key: "booked",
              title: "Booked ahead — nothing due",
              hint: "Suppressed until the booked date, unless an invoice goes past due.",
              rows: clients.filter(c => c.nextPoc && c.nextPoc > snap.day),
            },
          ].map(group => (
            <div key={group.key} className="space-y-2">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.title} ({group.rows.length})
                </div>
                <div className="text-xs text-muted-foreground/80">
                  {group.hint}
                </div>
              </div>
              {group.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing here today.
                </p>
              ) : (
                group.rows.map(c => (
                  <TouchpointRow key={c.taskId} c={c} onLog={run} />
                ))
              )}
            </div>
          ))}
        </div>
      )}
      {tab === "management" && (
        <div className="space-y-2">{managementList.map(row)}</div>
      )}
      {tab === "onboarding" && (
        <div className="space-y-2">{onboardingList.map(row)}</div>
      )}
      {tab === "hot" && (
        <div className="space-y-2">
          {hotList.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nobody is eligible today. The list only opens after a first win,
              and only once per client per month.
            </p>
          ) : (
            hotList.map(row)
          )}
        </div>
      )}
      {tab === "loose" && <div className="space-y-2">{looseList.map(row)}</div>}
      {tab === "tasks" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Commitments from calls ({commitmentRows.length})
            </div>
            <p className="text-xs text-muted-foreground/80">
              Pulled from the 1-1 Call Notes form. Each one becomes a real task,
              or you say why not.
            </p>
            {commitmentRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing outstanding from the last round of calls.
              </p>
            ) : (
              commitmentRows.map(({ client, item }, i) => (
                <ChecklistItem
                  key={`${client.taskId}-${i}`}
                  title={`${client.name} — ${item.text}`}
                  why={`You said this on a call. Source: ${item.source}.`}
                  action={
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={() =>
                          addPlanItems({
                            items: [
                              { text: item.text, clientName: client.name },
                            ],
                          }).then(() =>
                            toast.success("Task created on Client Success"),
                          )
                        }
                      >
                        Create the task
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          run(
                            client,
                            `Commitment handled: ${item.text}`,
                            "touchpoint",
                            {
                              note: item.source,
                            },
                          )
                        }
                      >
                        Already done
                      </Button>
                    </div>
                  }
                />
              ))
            )}
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Tickets raised today ({ticketRows.length})
            </div>
            <p className="text-xs text-muted-foreground/80">
              Verified against ClickUp: a ticket only counts once it exists on
              the other team's board.
            </p>
            {ticketRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No tickets raised today.
              </p>
            ) : (
              ticketRows.map(
                (d: {
                  _id: string;
                  subject: string;
                  action: string;
                  reroutedTo?: string;
                  clickupTaskUrl?: string;
                  logError?: string;
                }) => (
                  <ChecklistItem
                    key={d._id}
                    title={`${d.subject} — ${d.action} → ${d.reroutedTo ?? "?"} ${d.clickupTaskUrl ? "✓ landed" : d.logError ? "✗ failed" : "… sending"}`}
                    why={
                      d.clickupTaskUrl
                        ? `Created on the ${d.reroutedTo} board. Open it: ${d.clickupTaskUrl}`
                        : d.logError
                          ? `ClickUp rejected it: ${d.logError}. Raise it again.`
                          : "Still being created — refresh in a moment."
                    }
                  />
                ),
              )
            )}
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Loose ends ({t.loose})
            </div>
            {looseList.flatMap((c: Client) =>
              c.loose.map((l: string, i: number) => (
                <ChecklistItem
                  key={`${c.taskId}-loose-${i}`}
                  title={`${c.name} — ${l}`}
                  why={`${c.stage}. ${c.todo}. Clear it before 18:00 or it shows in your EOD.`}
                  action={
                    c.taskUrl ? (
                      <a
                        className="underline"
                        href={c.taskUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open the client task
                      </a>
                    ) : undefined
                  }
                />
              )),
            )}
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Client Success board — due, overdue or undated (
              {snap.tasks.length})
            </div>
            {snap.tasks.map(
              (task: {
                taskId: string;
                name: string;
                taskUrl?: string;
                status: string;
                dueDate?: string;
                overdueDays?: number;
              }) => (
                <div
                  key={task.taskId}
                  className="flex items-center justify-between gap-3 rounded border px-3 py-2 text-sm"
                >
                  <div>
                    <div className="font-medium">{task.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {task.status}
                      {task.dueDate
                        ? ` · due ${task.dueDate}`
                        : " · no due date"}
                      {task.overdueDays && task.overdueDays > 0
                        ? ` · ${task.overdueDays}d overdue`
                        : ""}
                    </div>
                  </div>
                  {task.taskUrl && (
                    <a
                      className="text-xs underline"
                      href={task.taskUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      open
                    </a>
                  )}
                </div>
              ),
            )}
          </div>
        </div>
      )}

      <section className="rounded-lg border">
        <div className="border-b px-4 py-2 text-sm font-semibold">
          End of day — plan tomorrow today
        </div>
        <div className="space-y-3 px-4 py-3">
          <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded bg-muted/50 p-2">
              <div className="text-xs text-muted-foreground">
                Clients handled today
              </div>
              <div className="text-lg font-semibold">
                {snap.decisions.length}
              </div>
            </div>
            <div className="rounded bg-muted/50 p-2">
              <div className="text-xs text-muted-foreground">Calls logged</div>
              <div className="text-lg font-semibold">
                {
                  snap.decisions.filter((d: { kind: string; action: string }) =>
                    /call/i.test(d.action),
                  ).length
                }
              </div>
            </div>
            <div className="rounded bg-muted/50 p-2">
              <div className="text-xs text-muted-foreground">
                Tickets raised
              </div>
              <div className="text-lg font-semibold">
                {
                  snap.decisions.filter(
                    (d: { kind: string }) => d.kind === "rerouted",
                  ).length
                }
              </div>
            </div>
            <div className="rounded bg-muted/50 p-2">
              <div className="text-xs text-muted-foreground">
                Left with a reason
              </div>
              <div className="text-lg font-semibold">
                {
                  snap.decisions.filter(
                    (d: { kind: string }) => d.kind === "left",
                  ).length
                }
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            This is your end-of-day report — it writes itself from what you
            actually did. Add anything you want on tomorrow's board, one per
            line.
          </p>
          <Textarea
            rows={3}
            value={dump}
            onChange={e => setDump(e.target.value)}
            placeholder="Arabic or English. One line per thing."
          />
          <Button size="sm" onClick={submitPlan}>
            Create tomorrow's tasks
          </Button>

          {/* This replaces the Account Manager EOD Typeform — same questions, but the
              countable ones are already answered from today's activity. */}
          <div className="space-y-2 border-t pt-3">
            <div className="text-sm font-semibold">
              Your EOD {snap.eod ? "· submitted ✓" : ""}
            </div>
            <div className="grid gap-2 text-xs sm:grid-cols-2">
              <div className="rounded bg-muted/50 p-2">
                Call summaries logged: <strong>{callsToday}</strong> · new
                signups contacted: <strong>{signupsToday}</strong>
              </div>
              <div className="rounded bg-muted/50 p-2">
                Upsell / referral / review conversations:{" "}
                <strong>{hotToday}</strong> · tickets raised:{" "}
                <strong>{ticketsToday}</strong>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <select
                className="rounded border bg-background px-2 py-1 text-xs"
                value={energy}
                onChange={e => setEnergy(e.target.value)}
              >
                {[
                  "Energy 1",
                  "Energy 2",
                  "Energy 3",
                  "Energy 4",
                  "Energy 5",
                ].map(x => (
                  <option key={x}>{x}</option>
                ))}
              </select>
              <select
                className="rounded border bg-background px-2 py-1 text-xs"
                value={stress}
                onChange={e => setStress(e.target.value)}
              >
                {[
                  "Stress 1",
                  "Stress 2",
                  "Stress 3",
                  "Stress 4",
                  "Stress 5",
                ].map(x => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </div>
            <Textarea
              rows={2}
              value={lost}
              onChange={e => setLost(e.target.value)}
              placeholder="Clients lost or at risk today (blank = none)"
            />
            <Textarea
              rows={2}
              value={onePercent}
              onChange={e => setOnePercent(e.target.value)}
              placeholder="One 1% improvement for you or the company"
            />
            <Textarea
              rows={2}
              value={rollup}
              onChange={e => setRollup(e.target.value)}
              placeholder="Daily roll up — fires, anything Aziz should know"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                await submitEod({
                  energy,
                  stress,
                  answers: { lost, onePercent, rollup },
                  computed: {
                    handled: snap.decisions.length,
                    calls: callsToday,
                    signups: signupsToday,
                    hot: hotToday,
                    tickets: ticketsToday,
                    left: snap.decisions.filter(
                      (d: { kind: string }) => d.kind === "left",
                    ).length,
                  },
                });
                toast.success("EOD filed — no Typeform needed");
              }}
            >
              File my EOD
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
