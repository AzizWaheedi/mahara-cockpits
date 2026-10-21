import { FilterChips } from "@/components/ceo/FilterChips";
import { GapReport } from "@/components/results/GapReport";
import { MorningList } from "@/components/results/MorningList";
import { SpeedChart } from "@/components/results/SpeedChart";

/**
 * The three results and speed screens beside the board, on the same page (Muhammed, 2026-10-21):
 * /performance?view=gap, speed or morning. The board stays the page's first view, so the address every
 * team member already knows still opens it. The database decides who reads what: the gap report and the
 * morning list for any active seat (each client through cockpit_client_allowed), the speed chart for the
 * seats that see every client.
 */
export const VIEWS = [
  { key: "board", label: "Board" },
  { key: "gap", label: "No result" },
  { key: "speed", label: "Call speed" },
  { key: "morning", label: "Morning list" },
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

const INTRO: Record<Exclude<ViewKey, "board">, { title: string; text: string }> = {
  gap: {
    title: "Meetings with no result",
    text: "Which clients are behind on filling in how their meetings went, and why.",
  },
  speed: {
    title: "Speed of the first call",
    text: "How the first call's speed lines up with bookings from paid leads.",
  },
  morning: {
    title: "Morning list",
    text: "Leads that no call is linked to, in the groups the call centre works through.",
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
      {view === "gap" ? <GapReport /> : null}
      {view === "speed" ? <SpeedChart /> : null}
      {view === "morning" ? <MorningList /> : null}
    </div>
  );
}
