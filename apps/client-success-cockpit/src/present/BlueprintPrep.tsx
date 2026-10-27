import { Check, CircleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Conflicts,
  OpenDoc,
  PartsBar,
  QuestionField,
  said,
} from "./BlueprintFields";
import {
  type BpKey,
  type BpPart,
  has,
  labelOf,
  QUESTIONS,
} from "./blueprintForm";
import { part1Suggestions } from "./blueprintPrefill";
import type { DeckData } from "./deckData";
import type { BpModel } from "./useBlueprint";

/**
 * The Brand Blueprint's prep (docs/brand-blueprint/SPEC.md 5.7), 15
 * minutes before the call: the ready check, part 1 confirmed in one press,
 * what the call must still ask, what the client has told us, the links, and
 * the whole form by part (for finishing part 2 later the same day). The
 * slides and their readiness are prep's own strip, above.
 */

const PART_NAME: Record<BpPart, string> = {
  1: "Part 1 · Starter ads",
  2: "Part 2 · Brand and money",
  3: "Part 3 · The offer",
};

function Check1({
  ok,
  children,
  fix,
}: {
  ok: boolean;
  children: string;
  fix?: string;
}) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {ok ? (
        <Check aria-hidden className="mt-0.5 size-4 shrink-0 txt-good" />
      ) : (
        <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 txt-warn" />
      )}
      <span>
        {children}
        {!ok && fix ? (
          <span className="block text-xs text-muted-foreground">{fix}</span>
        ) : null}
      </span>
    </li>
  );
}

export function BlueprintPrep({
  bp,
  d,
  made = false,
}: {
  bp: BpModel | null | undefined;
  d: DeckData;
  /** The practice client, whose own line is above: no rehearsal line. */
  made?: boolean;
}) {
  const suggestions = useMemo(
    () => (bp ? part1Suggestions(bp.prefill, bp.answers) : []),
    [bp],
  );
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  if (!bp) return null;
  const isTicked = (k: BpKey) => ticked[k] ?? true;
  const service = bp.answers.service as string | undefined;
  const pack = service ? bp.bundle?.settings.packs?.[service] : null;
  const part1Done = bp.missing(1).length === 0;
  const order: BpPart[] = [1, 2];
  // Prep's own answers are set here, so the call's list leaves them out.
  const PREP_OWN: string[] = [
    "pack_url",
    "daily_budget",
    "destination",
    "identity",
    "dna_status",
    "dna_missing",
    "offer",
  ];
  const missingAll = order
    .flatMap(p => bp.missing(p))
    .filter(k => !PREP_OWN.includes(k));
  const dnaQ = QUESTIONS.find(q => q.key === "dna_status");
  const offerQ = QUESTIONS.find(q => q.key === "offer");
  const kickoff = d.kickoff.entry;
  return (
    <div className="space-y-5">
      {bp.rehearsal && !made ? (
        <div className="rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-medium">
          Rehearsal: nothing is saved or sent.
        </div>
      ) : null}
      <Conflicts bp={bp} />

      <section className="space-y-2 rounded-xl border p-4">
        <h2 className="text-sm font-semibold">Ready for the call</h2>
        <ul className="space-y-1.5">
          <Check1
            ok={part1Done}
            fix="Confirm part 1 below; on the call only capacity and the pack's approval are left."
          >
            Part 1 confirmed
          </Check1>
          <Check1
            ok={Boolean(pack) || bp.answers.starter === "no"}
            fix={
              service
                ? `No starter pack for ${said("service", service).toLowerCase()} in Settings yet: paste its Drive folder in part 1.`
                : "Choose the service first."
            }
          >
            Starter pack set
          </Check1>
          <Check1
            ok={Boolean(bp.bundle?.settings.assignee)}
            fix="Launch tasks go out unassigned, so nobody is pinged. Set the launch media buyer in Settings."
          >
            Launch media buyer set
          </Check1>
          <Check1
            ok={Boolean(bp.docs.offerUrl)}
            fix="The card has no Offer Cheat Sheet link."
          >
            Offer sheet on the card
          </Check1>
          <Check1
            ok={Boolean(bp.docs.brandDnaUrl)}
            fix="The card has no Brand DNA link."
          >
            Brand DNA doc on the card
          </Check1>
          <Check1
            ok={has(bp.answers, "dna_status")}
            fix="Set the Brand DNA status below. On the call it reads as one line."
          >
            Brand DNA status set
          </Check1>
          <Check1
            ok={has(bp.answers, "offer")}
            fix="Write an offer draft below. They correct it on slide 13."
          >
            Offer draft written
          </Check1>
        </ul>
        {bp.prefill.notes.map(n => (
          <div key={n} className="text-xs txt-warn">
            {n}
          </div>
        ))}
      </section>

      {suggestions.length ? (
        <section className="space-y-3 rounded-xl border p-4">
          <h2 className="text-sm font-semibold">Confirm part 1</h2>
          <p className="text-xs text-muted-foreground">
            Everything the kickoff and the card already say. Untick anything
            that is wrong; the rest is saved in one go.
          </p>
          <ul className="space-y-2">
            {suggestions.map(({ key, prefill }) => (
              <li key={key}>
                <label className="flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-[var(--mahara-teal)]"
                    checked={isTicked(key)}
                    onChange={e =>
                      setTicked(t => ({ ...t, [key]: e.target.checked }))
                    }
                  />
                  <span className="min-w-0">
                    <span className="font-medium">{labelOf(key)}:</span>{" "}
                    <span dir="auto">{said(key, prefill.value)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {prefill.kind === "D" ? "Default" : "From"}{" "}
                      {prefill.source.replace(/^The /, "the ")}
                      {prefill.date
                        ? `, ${new Date(prefill.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
                        : ""}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            disabled={bp.readOnly}
            onClick={() =>
              bp.acceptMany(suggestions.filter(s => isTicked(s.key)))
            }
          >
            Confirm part 1
          </Button>
        </section>
      ) : null}

      <section className="space-y-4 rounded-xl border p-4">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">Set before the call</h2>
          <p className="text-xs text-muted-foreground">
            The notes window shows these as text on the call, so you type
            nothing for them there.
          </p>
        </div>
        {dnaQ ? <QuestionField bp={bp} q={dnaQ} /> : null}
        {offerQ ? <QuestionField bp={bp} q={offerQ} /> : null}
      </section>

      {missingAll.length ? (
        <section className="space-y-2 rounded-xl border p-4">
          <h2 className="text-sm font-semibold">Still to ask on the call</h2>
          <ol className="flex flex-wrap gap-1.5">
            {missingAll.map(k => (
              <li key={k}>
                <a
                  href={`#bp-${k}`}
                  className="inline-block rounded border px-2 py-0.5 text-xs hover:border-primary"
                >
                  {labelOf(k)}
                </a>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <details className="rounded-xl border p-4">
        <summary className="cursor-pointer text-sm font-semibold">
          What they've told us
        </summary>
        <dl className="mt-3 space-y-2 text-sm">
          {(kickoff?.answers ?? []).map(a => (
            <div key={`${a.ref}-${a.title}`}>
              <dt className="text-xs text-muted-foreground">
                Kickoff · {a.title}
              </dt>
              <dd dir="auto">{a.value}</dd>
            </div>
          ))}
          {!kickoff ? (
            <div className="text-xs txt-warn">No kickoff on record.</div>
          ) : null}
        </dl>
      </details>

      <section className="space-y-2 rounded-xl border p-4">
        <h2 className="text-sm font-semibold">Links</h2>
        <div className="flex flex-wrap gap-2">
          <OpenDoc url={bp.docs.offerUrl} name={`mahara-offer-${d.taskId}`}>
            Offer Cheat Sheet
          </OpenDoc>
          <OpenDoc url={bp.docs.brandDnaUrl} name={`mahara-dna-${d.taskId}`}>
            Brand DNA
          </OpenDoc>
          <OpenDoc url={bp.docs.research} name={`mahara-research-${d.taskId}`}>
            Market research
          </OpenDoc>
          <OpenDoc url={bp.docs.driveUrl} name={`mahara-drive-${d.taskId}`}>
            Drive
          </OpenDoc>
        </div>
        {bp.docs.offerUrl ? (
          <p className="text-xs text-muted-foreground">
            Write your offer guess in the offer sheet before the call, so they
            correct a draft instead of a blank page.
          </p>
        ) : null}
      </section>

      <section className="space-y-3 rounded-xl border p-4">
        <h2 className="text-sm font-semibold">The whole form</h2>
        <PartsBar bp={bp} timeZone={d.timeZone} press={[1, 2, 3]} />
        {([1, 2, 3] as const).map(p => (
          <details
            key={p}
            id={`part${p}`}
            className={cn("rounded-lg border p-3")}
            open={p === 1 && !part1Done}
          >
            <summary className="cursor-pointer text-sm font-medium">
              {PART_NAME[p]}
            </summary>
            <div className="mt-3 space-y-4">
              {QUESTIONS.filter(q => q.part === p && q.key).map(q => (
                <QuestionField key={q.n} bp={bp} q={q} />
              ))}
            </div>
          </details>
        ))}
      </section>
    </div>
  );
}
