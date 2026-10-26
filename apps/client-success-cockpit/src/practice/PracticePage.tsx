import { NotebookPen, Presentation, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { openNamed } from "@/present/PresentButton";
import type { DeckKind } from "@/present/sources";
import {
  clearPractice,
  PRACTICE_NAME,
  practiceUrls,
  practiceWindow,
} from "./practiceClient";

/**
 * /practice (docs/call-guide/DESIGN.md): the CSM's two calls on the practice
 * client. Each opens in its own windows, as a real client's deck does, with
 * the call guide on. Nothing here reads or writes a real client.
 */

const CALLS: {
  deck: Exclude<DeckKind, "blueprint">;
  title: string;
  line: string;
}[] = [
  {
    deck: "onboarding",
    title: "Onboarding call",
    line: "Seven slides, then the kickoff form with them and the Brand Blueprint booking.",
  },
  {
    deck: "launch",
    title: "Launch call",
    line: "The launch slides with their ads, then the summary.",
  },
];

const open = (deck: DeckKind, prep: boolean) => {
  const u = practiceUrls(deck);
  openNamed(prep ? u.prep : u.deck, practiceWindow(deck, prep));
};

export default function PracticePage() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <PageHeader
        title="Practice client"
        sub={
          <>
            Run a call on <bdi>{PRACTICE_NAME}</bdi>, a made-up client. The
            screens are the real ones. Nothing is saved, sent or booked.
          </>
        }
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              clearPractice();
              toast("The practice client is back at the start.");
            }}
          >
            <RotateCcw aria-hidden />
            Start over
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-2">
        {CALLS.map(c => (
          <section
            key={c.deck}
            data-practice-call={c.deck}
            className="flex flex-col gap-4 rounded-2xl border bg-card p-5"
          >
            <div className="space-y-1">
              <h2 className="text-lg font-semibold tracking-tight">
                {c.title}
              </h2>
              <p className="text-sm text-muted-foreground">{c.line}</p>
            </div>
            <div className="mt-auto flex flex-wrap items-center gap-3">
              <Button size="sm" onClick={() => open(c.deck, true)}>
                <NotebookPen aria-hidden />
                Start in prep
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => open(c.deck, false)}
              >
                <Presentation aria-hidden />
                Present
              </Button>
            </div>
          </section>
        ))}
      </div>

      <section className="space-y-2 text-sm">
        <h2 className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
          How practice works
        </h2>
        <ol className="max-w-2xl list-decimal space-y-1 ps-5 text-muted-foreground">
          <li>
            Start in prep. The guide at the top shows each step of the call.
          </li>
          <li>Follow the lit step: open the notes window, then Present.</li>
          <li>
            The kickoff form here is a practice copy. Submit sends nothing.
          </li>
          <li>Booking buttons show a time and book nothing.</li>
        </ol>
      </section>
    </div>
  );
}
