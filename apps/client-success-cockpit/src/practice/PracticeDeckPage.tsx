import { CalendarPlus } from "lucide-react";
import { useMemo } from "react";
import { Navigate, useLocation, useParams } from "react-router";
import { toast } from "sonner";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { Button } from "@/components/ui/button";
import { PresentApp, type View } from "@/present/PresentApp";
import type { DeckKind } from "@/present/sources";
import {
  PRACTICE_TASK,
  practiceIO,
  practiceKickoff,
  practiceUrls,
} from "./practiceClient";

/**
 * /practice/present/:deck, its notes window at /notes and the prep view at
 * ?view=prep (docs/call-guide/DESIGN.md): the real deck, notes and prep on
 * the practice client, with the call guide. Outside AppLayout, as the real
 * decks are. Each window keeps its own copy of the call; the windows keep in
 * step over the practice client's own channel.
 */

const DAY = 86_400_000;

/** A booking that books nothing: the time it says, and a line saying so. */
function practiceBooking(kind: string) {
  const at = new Date(Date.now() + 2 * DAY);
  at.setHours(13, 0, 0, 0);
  const said = at.toLocaleString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
  toast(
    `Practice: the ${kind === "blueprint" ? "Brand Blueprint" : kind} call shows as booked for ${said}. Nothing was booked.`,
  );
  return at.toISOString();
}

export default function PracticeDeckPage({
  notes = false,
  deck: deckProp,
}: {
  notes?: boolean;
  deck?: DeckKind;
}) {
  const { deck: deckParam = "" } = useParams();
  const deck = deckProp ?? deckParam;
  const { search } = useLocation();
  const auth = useCockpitAuth();
  const view: View = notes
    ? "notes"
    : new URLSearchParams(search).get("view") === "prep"
      ? "prep"
      : "present";
  const ok = deck === "onboarding" || deck === "launch" || deck === "blueprint";
  const io = useMemo(
    () => (ok ? practiceIO(deck, auth.name || null) : null),
    [ok, deck, auth.name],
  );
  const kickoff = useMemo(
    () =>
      deck === "onboarding"
        ? practiceKickoff(deck, { name: auth.name, email: auth.email })
        : undefined,
    [deck, auth.name, auth.email],
  );

  if (!ok || !io) return <Navigate to="/practice" replace />;

  return (
    <PresentApp
      key={`${deck}:${view}`}
      taskId={PRACTICE_TASK}
      deck={deck}
      view={view}
      io={io}
      practice
      urls={practiceUrls(deck)}
      book={
        deck === "blueprint"
          ? undefined
          : (_d, kind, label, onBooked, opts) => (
              <Button
                size="sm"
                variant={opts?.variant ?? "outline"}
                onClick={() => {
                  opts?.onAutoOpenConsumed?.();
                  onBooked(practiceBooking(kind));
                }}
              >
                <CalendarPlus aria-hidden />
                {label}
              </Button>
            )
      }
      kickoff={kickoff}
    />
  );
}
