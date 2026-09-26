import { Lightbulb } from "lucide-react";
import { useState } from "react";
import { EmptyState, Failed, SectionCard, SourceNote } from "../components/kit";
import { Segmented } from "../components/ScriptParts";
import { useQuery } from "../lib/data";
import { ago, day } from "../lib/format";
import { supabase } from "../lib/supabase";

/**
 * What prospects keep saying: the questions, objections, problems and
 * expectations of the last 7 or 30 days of sales calls, most frequent first,
 * with the answer that worked, and content ideas for marketing (Aziz's
 * brief: "bias toward the last 30 days ... so we can focus on those").
 * Written by the desk from the notes of every recorded call.
 */

interface Digest {
  id: string;
  days: 7 | 30;
  from_at: string;
  to_at: string;
  calls_used: number;
  digest: {
    questions: { text: string; count: number; example: string }[];
    objections: { text: string; count: number; answer: string }[];
    problems: { text: string; count: number }[];
    expectations: { text: string; count: number }[];
    marketing: { idea: string; why: string }[];
  };
  model: string | null;
  written_at: string;
}

export default function IntelligencePage() {
  const [days, setDays] = useState<"7" | "30">("30");
  const digest = useQuery<Digest | null>(
    () =>
      supabase
        .from("cockpit_sales_digests")
        .select("*")
        .eq("days", Number(days))
        .order("written_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    [days],
  );
  const d = digest.data;
  return (
    <main className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6 md:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            What prospects are saying
          </h1>
          <p className="muted text-sm">
            {d
              ? d.calls_used
                ? `From ${d.calls_used} recorded call${d.calls_used === 1 ? "" : "s"}, ${day(d.from_at)} to ${day(d.to_at)}. Updated ${ago(d.written_at)}.`
                : `No recorded sales calls between ${day(d.from_at)} and ${day(d.to_at)}.`
              : "Most frequent first, from the notes of every recorded sales call."}
          </p>
        </div>
        <Segmented
          label="Window"
          value={days}
          options={[
            ["7", "Last 7 days"],
            ["30", "Last 30 days"],
          ]}
          onChange={v => setDays(v as "7" | "30")}
        />
      </header>

      {digest.error ? (
        <Failed what="The digest" error={digest.error} retry={digest.reload} />
      ) : digest.loading && !d ? (
        <p className="muted text-sm">Reading the digest…</p>
      ) : !d?.calls_used ? (
        <div className="panel">
          <EmptyState
            icon={Lightbulb}
            title={d ? "No calls in this window" : "No digest written yet"}
            text="The desk writes the digest every morning from the notes of the recorded sales calls. It fills in as calls are recorded again."
          />
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <SectionCard title="Objections">
            <Ranked
              items={d.digest.objections.map(o => ({
                text: o.text,
                count: o.count,
                more: o.answer
                  ? `What worked: ${o.answer}`
                  : "Nothing in the notes worked yet.",
              }))}
            />
          </SectionCard>
          <SectionCard title="Questions they ask">
            <Ranked
              items={d.digest.questions.map(q => ({
                text: q.text,
                count: q.count,
                more: q.example ? `"${q.example}"` : "",
              }))}
            />
          </SectionCard>
          <SectionCard title="Problems that bring them">
            <Ranked
              items={d.digest.problems.map(p => ({
                text: p.text,
                count: p.count,
                more: "",
              }))}
            />
          </SectionCard>
          <SectionCard title="What they expect from us">
            <Ranked
              items={d.digest.expectations.map(e => ({
                text: e.text,
                count: e.count,
                more: "",
              }))}
            />
          </SectionCard>
          <SectionCard title="For marketing" className="lg:col-span-2">
            {d.digest.marketing.length ? (
              <ul className="space-y-2">
                {d.digest.marketing.map(m => (
                  <li key={m.idea} className="text-sm" dir="auto">
                    <span className="font-medium">{m.idea}</span>
                    {m.why ? <span className="muted"> · {m.why}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted text-sm">No content ideas in this window.</p>
            )}
          </SectionCard>
        </div>
      )}
      <SourceNote>
        The desk on the VPS writes notes after every recorded sales call (Fathom
        through the Obsidian vault) and, each morning, reads the last 7 and 30
        days of those notes to write this page. Counts are how many calls raised
        a point. Phone calls count once their transcripts are in the cockpit.
        {d?.model ? ` Written by ${d.model}.` : ""}
      </SourceNote>
    </main>
  );
}

function Ranked({
  items,
}: {
  items: { text: string; count: number; more: string }[];
}) {
  if (!items.length)
    return <p className="muted text-sm">Nothing came up in this window.</p>;
  return (
    <ol className="space-y-2">
      {items.map(i => (
        <li key={i.text} className="flex gap-3">
          <span className="muted w-8 shrink-0 text-right text-sm tabular-nums">
            {i.count}×
          </span>
          <span className="min-w-0">
            <span className="block text-sm" dir="auto">
              {i.text}
            </span>
            {i.more ? (
              <span className="muted block text-xs" dir="auto">
                {i.more}
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
