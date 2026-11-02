import { ChevronDown, Presentation } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { OfferPickerItem } from "./offer/OfferPickerItem";

/**
 * The ways into the client decks, for the client page header and the
 * onboarding panels. Light on purpose: nothing of the deck itself loads
 * until a deck window opens (the deck route is lazy). Each deck opens in a
 * window of its own, so the cockpit's client page (results, ads, money,
 * notes) is never the tab that gets shared.
 */

/** The CSM's two decks, and the Brand Blueprint (the CSM's "Open the Blueprint deck"). */
export type DeckKind = "onboarding" | "launch" | "blueprint";

/** The app's base path; read when used (tests run without Vite's env). */
const base = () =>
  (import.meta.env?.BASE_URL ?? "/client-success/").replace(/\/$/, "");

export function deckUrl(taskId: string, deck: DeckKind, prep = false) {
  return `${base()}/clients/${encodeURIComponent(taskId)}/present/${deck}${prep ? "?view=prep" : ""}`;
}

type Opener = (url: string, name: string, features?: string) => Window | null;

/**
 * Opens a named window, or brings it forward as it is. window.open(url,
 * name) would load the url again in a window that is already open: a second
 * Present would reset the shared deck to its cover mid-call. So the window
 * is asked for by name with a blank url first, and only a new (blank) one
 * is sent to the url.
 */
export function openNamed(
  url: string,
  name: string,
  features?: string,
  open: Opener = (u, n, f) => window.open(u, n, f),
): Window | null {
  const w = open("", name, features);
  if (!w) return null;
  let blank = true;
  try {
    blank = w.location.href === "about:blank";
  } catch {
    // another origin's page in that window: send it to the deck
  }
  if (blank) w.location.replace(url);
  w.focus();
  return w;
}

export function openDeck(taskId: string, deck: DeckKind, prep = false) {
  openNamed(
    deckUrl(taskId, deck, prep),
    `mahara-${prep ? "prep" : "deck"}-${taskId}-${deck}`,
  );
}

/** The deck the client is due for, by the board's stage and the next call. */
export function deckFor(
  stage?: string | null,
  nextCallKind?: string | null,
): DeckKind {
  if (nextCallKind === "launch") return "launch";
  if (/blueprint|launch booked|ready for launch/i.test(String(stage ?? "")))
    return "launch";
  return "onboarding";
}

const NAMES: Record<DeckKind, string> = {
  onboarding: "onboarding deck",
  launch: "launch deck",
  blueprint: "Brand Blueprint deck",
};

/** "Present", with the other deck and both prep views a click away. */
export function PresentButton({
  taskId,
  stage,
  nextCallKind,
}: {
  taskId: string;
  stage?: string | null;
  nextCallKind?: string | null;
}) {
  const due = deckFor(stage, nextCallKind);
  const other: DeckKind = due === "onboarding" ? "launch" : "onboarding";
  return (
    <div className="inline-flex items-center">
      <Button
        size="sm"
        variant="outline"
        className="rounded-r-none"
        onClick={() => openDeck(taskId, due)}
        title={`Opens the ${NAMES[due]} in its own window`}
      >
        <Presentation aria-hidden />
        Present
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="rounded-l-none border-l-0 px-2"
            aria-label="More ways to present"
          >
            <ChevronDown aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => openDeck(taskId, due, true)}>
            Prepare the {NAMES[due]}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openDeck(taskId, other)}>
            Present the {NAMES[other]}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openDeck(taskId, other, true)}>
            Prepare the {NAMES[other]}
          </DropdownMenuItem>
          <OfferPickerItem taskId={taskId} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Present and prepare one deck, as a pair (the onboarding panels). */
export function PresentDeckLinks({
  taskId,
  deck,
  primary,
}: {
  taskId: string;
  deck: DeckKind;
  primary?: boolean;
}) {
  return (
    <>
      <Button
        size="sm"
        variant={primary ? "default" : "outline"}
        onClick={() => openDeck(taskId, deck)}
      >
        <Presentation aria-hidden />
        Present the {NAMES[deck]}
      </Button>
      <button
        type="button"
        className="text-xs text-primary underline-offset-4 hover:underline"
        onClick={() => openDeck(taskId, deck, true)}
      >
        Prepare it
      </button>
    </>
  );
}
