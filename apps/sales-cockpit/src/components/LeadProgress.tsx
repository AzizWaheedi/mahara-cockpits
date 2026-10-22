import { ArrowRightLeft, Check, Pencil, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { plainStage } from "../lib/format";
import { toast } from "../lib/toast";
import type { CalendarRow, Lead, Me, TeamMember } from "../lib/types";
import { AnimatedSelect, button, buttonPrimary, field, select } from "./kit";

type Pipe = {
  id: string;
  name: string;
  stages: { id: string; name: string }[];
};
type Receipt = {
  id: string;
  day: string;
  state: string;
  by_email: string;
  host_email: string;
  source_intro_id: string | null;
  intro_id: string | null;
  demo_id: string | null;
  intro_start: string;
  demo_start: string;
  demo_end: string;
  note: string | null;
  error: string | null;
};
type Plan = { hosts: TeamMember[]; calls: CalendarRow[]; receipts: Receipt[] };
const local = (iso: string) =>
  new Date(Date.parse(iso) + 3 * 3_600_000).toISOString().slice(0, 16);
const utc = (value: string) => new Date(`${value}:00+03:00`).toISOString();

/** Inline opt-in controls keep the call and its notes visible. */
export function LeadProgress({
  lead,
  me,
  onDone,
}: {
  lead: Lead;
  me: Me;
  onDone: () => void;
}) {
  const [open, setOpen] = useState<"pipeline" | "demo" | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={button}
          aria-expanded={open === "pipeline"}
          onClick={() => setOpen(open === "pipeline" ? null : "pipeline")}
        >
          <Pencil className="size-3.5" />
          {plainStage(lead.stage_name ?? "Set pipeline status")}
        </button>
        <button
          type="button"
          className={button}
          aria-expanded={open === "demo"}
          onClick={() => setOpen(open === "demo" ? null : "demo")}
        >
          <ArrowRightLeft className="size-4" />
          Intro became a demo
        </button>
      </div>
      {open ? (
        <div className="max-w-2xl rounded-[24px] border border-white/10 bg-muted/30 p-4 sm:p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">
                {open === "pipeline" ? "Update pipeline" : "Record a live demo"}
              </h2>
              <p className="muted mt-1 text-sm">
                {open === "pipeline"
                  ? "Choose where this lead stands now."
                  : "Keep the intro credit. Count the demo for the person who took it."}
              </p>
            </div>
            <button
              type="button"
              className={button}
              aria-label="Close lead update"
              onClick={() => setOpen(null)}
            >
              <X className="size-4" />
            </button>
          </div>
          {open === "pipeline" ? (
            <PipelineEdit
              lead={lead}
              onDone={() => {
                setOpen(null);
                onDone();
              }}
            />
          ) : (
            <DemoEdit
              key={lead.contact_id}
              lead={lead}
              me={me}
              onDone={onDone}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
function PipelineEdit({
  lead,
  onDone,
}: {
  lead: Lead;
  onDone: (name: string) => void;
}) {
  const [pipes, setPipes] = useState<Pipe[]>([]),
    [pipe, setPipe] = useState(lead.pipeline_id ?? ""),
    [stage, setStage] = useState(lead.stage_id ?? "");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    api<{ pipelines: Pipe[] }>("pipeline.stages")
      .then(r => {
        if (alive) {
          setPipes(r.pipelines);
          const current = r.pipelines.find(p => p.id === lead.pipeline_id);
          if (!current) {
            setPipe(r.pipelines[0]?.id ?? "");
            setStage("");
          } else if (!current.stages.some(s => s.id === lead.stage_id))
            setStage("");
        }
      })
      .catch(e => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [lead.pipeline_id, lead.stage_id]);
  const selected = pipes.find(p => p.id === pipe);
  async function save() {
    setBusy(true);
    setError("");
    try {
      await api("pipeline.move", {
        contact_id: lead.contact_id,
        pipeline_id: pipe,
        stage_id: stage,
        expected_stage_id: lead.stage_id,
      });
      onDone(selected?.stages.find(s => s.id === stage)?.name ?? "Updated");
      toast.success("Pipeline updated in HighLevel.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      {!pipes.length && !error ? (
        <p className="muted text-sm">Reading pipeline stages…</p>
      ) : null}
      {pipes.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label htmlFor="lead-pipeline" className="space-y-1 text-sm">
            Pipeline
            <AnimatedSelect
              id="lead-pipeline"
              className={`${select} w-full`}
              value={pipe}
              onChange={e => {
                setPipe(e.target.value);
                setStage("");
              }}
            >
              {pipes.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </AnimatedSelect>
          </label>
          <label htmlFor="lead-status" className="space-y-1 text-sm">
            Status
            <AnimatedSelect
              id="lead-status"
              className={`${select} w-full`}
              value={stage}
              onChange={e => setStage(e.target.value)}
            >
              <option value="">Choose status</option>
              {selected?.stages.map(s => (
                <option key={s.id} value={s.id}>
                  {plainStage(s.name)}
                </option>
              ))}
            </AnimatedSelect>
          </label>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className={buttonPrimary}
        disabled={busy || !stage || !selected}
        onClick={() => void save()}
      >
        {busy ? "Saving…" : "Save status"}
      </button>
      <p className="muted text-xs">
        Updates the shared pipeline. HighLevel's existing stage rules still
        apply.
      </p>
    </div>
  );
}
function DemoEdit({
  lead,
  me,
  onDone,
}: {
  lead: Lead;
  me: Me;
  onDone: () => void;
}) {
  const [plan, setPlan] = useState<Plan | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const [host, setHost] = useState(me.email ?? ""),
    [intro, setIntro] = useState(""),
    [demo, setDemo] = useState("");
  const [start, setStart] = useState(
    local(new Date(Date.now() - 30 * 60_000).toISOString()),
  );
  const [end, setEnd] = useState(local(new Date().toISOString()));
  const [introStart, setIntroStart] = useState(
    local(new Date(Date.now() - 45 * 60_000).toISOString()),
  );
  const [note, setNote] = useState(""),
    [saved, setSaved] = useState<Receipt | null>(null);
  const load = useCallback(async () => {
    try {
      const p = await api<Plan>("demo.plan", { contact_id: lead.contact_id });
      setPlan(p);
      return p;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, [lead.contact_id]);
  useEffect(() => {
    let alive = true;
    void load().then(p => {
      if (!alive || !p) return;
      const r = p.calls.find(
        c =>
          c.call_type === "intro" &&
          c.start_at &&
          Date.parse(c.start_at) < Date.now(),
      );
      if (r) {
        setIntro(r.appointment_id);
        setIntroStart(local(r.start_at!));
        if (Date.parse(r.start_at!) > Date.now() - 30 * 60_000)
          setStart(
            local(new Date(Date.parse(r.start_at!) + 60_000).toISOString()),
          );
      }
      const d = p.calls.find(
        c =>
          c.call_type === "demo" &&
          c.start_at &&
          local(c.start_at).slice(0, 10) ===
            local(new Date().toISOString()).slice(0, 10),
      );
      if (d) setDemo(d.appointment_id);
    });
    return () => {
      alive = false;
    };
  }, [load]);
  const pending = plan?.receipts.find(
    r => r.state !== "recorded" && (r.by_email === me.email || me.manager),
  );
  async function save(retry?: Receipt) {
    setBusy(true);
    setError("");
    try {
      const out = await api<{ receipt: Receipt }>("demo.record", {
        contact_id: lead.contact_id,
        request_id: retry?.id ?? requestId,
        host_email: retry?.host_email ?? host,
        intro_id: retry?.source_intro_id ?? (retry ? null : intro || null),
        demo_id: retry?.demo_id ?? (demo || null),
        intro_start: retry?.intro_start ?? utc(introStart),
        demo_start: retry?.demo_start ?? utc(start),
        demo_end: retry?.demo_end ?? utc(end),
        note: retry?.note ?? note,
      });
      setSaved(out.receipt);
      onDone();
      toast.success("Demo recorded. The call history and totals are updated.");
    } catch (e) {
      setError((e as Error).message);
      await load();
    } finally {
      setBusy(false);
    }
  }
  if (saved)
    return (
      <div className="space-y-2">
        <p className="flex items-center gap-2 font-medium">
          <Check className="size-4 text-primary" />
          Demo recorded
        </p>
        <p className="muted text-sm">
          {plan?.hosts.find(h => h.email === saved.host_email)?.name ??
            "The selected teammate"}{" "}
          gets the demo credit. The intro stays on the original rep's record.
          Both calls appear below.
        </p>
      </div>
    );
  return (
    <div className="space-y-3">
      {!plan && !error ? (
        <p className="muted text-sm">Reading calls and teammates…</p>
      ) : null}
      {pending ? (
        <div className="space-y-3">
          <p className="text-sm">
            A previous save needs checking before another demo is recorded.
          </p>
          <button
            type="button"
            className={buttonPrimary}
            disabled={busy}
            onClick={() => void save(pending)}
          >
            {busy ? "Checking…" : "Check saved demo"}
          </button>
        </div>
      ) : plan ? (
        <>
          <label htmlFor="demo-host" className="block space-y-1 text-sm">
            Who took the demo?
            <AnimatedSelect
              id="demo-host"
              className={`${select} w-full`}
              value={host}
              onChange={e => setHost(e.target.value)}
            >
              {plan.hosts.map(p => (
                <option key={p.email} value={p.email}>
                  {p.email === me.email
                    ? `I took it (${p.name ?? "me"})`
                    : (p.name ?? p.email)}
                </option>
              ))}
            </AnimatedSelect>
          </label>
          <label htmlFor="demo-intro" className="block space-y-1 text-sm">
            Intro
            <AnimatedSelect
              id="demo-intro"
              className={`${select} w-full`}
              value={intro}
              onChange={e => {
                setIntro(e.target.value);
                const c = plan.calls.find(
                  r => r.appointment_id === e.target.value,
                );
                if (c?.start_at) setIntroStart(local(c.start_at));
              }}
            >
              <option value="">Unscheduled intro</option>
              {plan.calls
                .filter(r => r.call_type === "intro")
                .map(r => (
                  <option key={r.appointment_id} value={r.appointment_id}>
                    {r.start_at ? local(r.start_at).replace("T", " ") : "Intro"}{" "}
                    · {r.assigned_user_name ?? "Team"}
                  </option>
                ))}
            </AnimatedSelect>
          </label>
          {plan.calls.some(r => r.call_type === "demo") ? (
            <label htmlFor="demo-existing" className="block space-y-1 text-sm">
              Demo record
              <AnimatedSelect
                id="demo-existing"
                className={`${select} w-full`}
                value={demo}
                onChange={e => setDemo(e.target.value)}
              >
                <option value="">Add this unscheduled demo</option>
                {plan.calls
                  .filter(r => r.call_type === "demo")
                  .map(r => (
                    <option key={r.appointment_id} value={r.appointment_id}>
                      {r.start_at
                        ? local(r.start_at).replace("T", " ")
                        : "Demo"}{" "}
                      · use this existing demo
                    </option>
                  ))}
              </AnimatedSelect>
            </label>
          ) : null}
          <p className="muted text-xs">
            Actual call times, Kuwait time. Check the suggested times before
            saving.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {!intro ? (
              <label className="space-y-1 text-sm sm:col-span-2">
                Intro started
                <input
                  type="datetime-local"
                  className={field}
                  value={introStart}
                  onChange={e => setIntroStart(e.target.value)}
                />
              </label>
            ) : null}
            <label className="space-y-1 text-sm">
              Demo started
              <input
                type="datetime-local"
                className={field}
                value={start}
                onChange={e => setStart(e.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm">
              Demo ended
              <input
                type="datetime-local"
                className={field}
                value={end}
                onChange={e => setEnd(e.target.value)}
              />
            </label>
          </div>
          <input
            className={field}
            aria-label="Live demo feedback"
            placeholder="Quick feedback or next step (optional)"
            value={note}
            onChange={e => setNote(e.target.value)}
            maxLength={4000}
          />
          <p className="muted text-xs">
            Records both calls as attended in HighLevel. This confirms a demo
            that happened, with its actual host.
          </p>
          <button
            type="button"
            className={buttonPrimary}
            disabled={busy || !host || !start || !end}
            onClick={() => void save()}
          >
            {busy ? "Recording…" : "Record attended demo"}
          </button>
        </>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
