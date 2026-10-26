import { RotateCw } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "react-router";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { DeckFrame } from "@/components/DeckFrame";
import { Button } from "@/components/ui/button";
import {
  blueprintFrame,
  blueprintPathOf,
  type FrameMessage,
  isTaskId,
  PRACTICE_TASK,
  practiceFrame,
  practicePathOf,
} from "@/lib/deckHost";

/**
 * The Blueprint call's notes popup (docs/brand-blueprint/EMBED.md 4.4), at
 * /creative/blueprint/:taskId/notes: one frame of the deck's notes view
 * that fills the window, no sidebar. The talk track, the private fields and
 * the part buttons are the deck's own; only the address is this cockpit's.
 */

type Notes = "opening" | "ready" | "failed" | "signedout";

export function BlueprintNotes({
  taskId,
  src,
  allowed,
}: {
  taskId: string;
  /** The frame's address (the harness points it at the deck harness). */
  src: string | null;
  allowed: (pathname: string) => boolean;
}) {
  const [state, setState] = useState<Notes>("opening");
  const [name, setName] = useState<string | null>(null);
  const [key, setKey] = useState(0);

  useEffect(() => {
    const before = document.title;
    document.title = name ? `Notes · ${name}` : "Notes";
    return () => {
      document.title = before;
    };
  }, [name]);

  const onMessage = (m: FrameMessage) => {
    if (m.type === "ready") {
      setState("ready");
      if (m.name) setName(m.name);
    } else if (m.type === "failed") setState("failed");
    else if (m.type === "signed-out") setState("signedout");
  };

  if (!isTaskId(taskId) || !src)
    return (
      <Line>
        <p className="text-[15px] font-semibold">
          No client card with that ID.
        </p>
      </Line>
    );

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-background text-foreground">
      {state === "opening" || state === "ready" ? (
        <DeckFrame
          key={key}
          src={src}
          title="Brand Blueprint notes"
          allowed={allowed}
          onMessage={onMessage}
          onTrouble={t => {
            if (t === "slow" || t === "left") setState("failed");
          }}
          shown={state === "ready"}
        />
      ) : null}
      {state === "ready" ? null : (
        <Line>
          {state === "opening" ? (
            <p className="text-sm text-muted-foreground">Opening the notes…</p>
          ) : (
            <>
              <p className="text-[15px] font-semibold">
                {state === "signedout"
                  ? "Sign in to the cockpit again."
                  : "The notes did not open. Reload this window."}
              </p>
              <div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setState("opening");
                    setKey(k => k + 1);
                  }}
                >
                  <RotateCw aria-hidden />
                  Reload
                </Button>
              </div>
            </>
          )}
        </Line>
      )}
    </div>
  );
}

function Line({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background px-6 text-center"
    >
      {children}
    </div>
  );
}

/** The route: /creative/blueprint/:taskId/notes, outside the cockpit's layout. */
export function BlueprintNotesPage() {
  const { taskId = "" } = useParams();
  const { search } = useLocation();
  const auth = useCockpitAuth();
  const rehearse =
    (auth.isAdmin || auth.isCeo) &&
    new URLSearchParams(search).get("rehearse") === "1";
  const src = useMemo(
    () => blueprintFrame(taskId, { view: "notes", rehearse }),
    [taskId, rehearse],
  );
  return (
    <BlueprintNotes
      key={`${taskId}:${rehearse}`}
      taskId={taskId}
      src={src}
      allowed={p => {
        const m = blueprintPathOf(p);
        return m?.taskId === taskId && m.view === "notes";
      }}
    />
  );
}

/** The practice client's notes popup: /creative/blueprint/practice/notes. */
export function PracticeNotesPage() {
  return (
    <BlueprintNotes
      taskId={PRACTICE_TASK}
      src={practiceFrame("notes")}
      allowed={p => practicePathOf(p) === "notes"}
    />
  );
}
