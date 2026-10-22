import { FilterChips } from "@/components/ceo/FilterChips";
import { GapReport } from "@/components/results/GapReport";

/**
 * The results screen beside the board, on the same page (Muhammed, 2026-10-21): /performance?view=gap.
 * The board stays the page's first view, so the address every team member already knows still opens it.
 * The gap report is read by any active seat (each client through cockpit_client_allowed).
 *
 * The call speed chart and the morning list moved to the dialer's Lead coverage view on 22 October 2026
 * (Muhammed): the call centre acts on them, not the media buyer. ?view=speed and ?view=morning now open
 * the board, and the board's uncalled count stays here for context.
 */
export const VIEWS = [
  { key: "board", label: "Board" },
  { key: "gap", label: "No result" },
] as const;
export type ViewKey = (typeof VIEWS)[number]["key"];

export function viewOf(value: string | null | undefined): ViewKey {
  return VIEWS.find(v => v.key === value)?.key ?? "board";
}

export function ViewSwitch({
  view,
  onChange,
}: {
  view: ViewKey;
  onChange: (view: ViewKey) => void;
}) {
  return (
    <FilterChips
      ariaLabel="Performance views"
      value={view}
      onChange={onChange}
      options={VIEWS.map(v => ({ key: v.key, label: v.label }))}
    />
  );
}

const INTRO: Record<
  Exclude<ViewKey, "board">,
  { title: string; text: string }
> = {
  gap: {
    title: "Meetings with no result",
    text: "Which clients are behind on filling in how their meetings went, and why.",
  },
};

/** The title and line of a view that is not the board, then the view. */
export function ResultsView({
  view,
  switcher,
}: {
  view: Exclude<ViewKey, "board">;
  switcher: React.ReactNode;
}) {
  return (
    <div className="ceo-root mx-auto w-full min-w-0 max-w-[1440px] space-y-6">
      <header className="min-w-0 max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">
          {INTRO[view].title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{INTRO[view].text}</p>
      </header>
      {switcher}
      <GapReport />
    </div>
  );
}
