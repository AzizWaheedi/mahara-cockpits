import { Clock, Moon, PanelLeftClose, PanelLeftOpen, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { Avatar } from "./kit";
import { Wordmark } from "./Wordmark";

const ROUTE_NAMES: Record<string, string> = {
  "/": "Today's Agenda",
  "/dialer": "Power Dialer",
  "/calendar": "Call Calendar",
  "/leads": "Leads Directory",
  "/pipeline": "Sales Pipeline",
  "/proposals": "Proposals Studio",
  "/contracts": "Client Contracts",
  "/numbers": "Scorecard & Dials",
  "/goals": "Goals & Pace",
  "/eod": "End of Day Report",
  "/followups": "Follow-up Queue",
  "/recordings": "Call Recordings",
  "/deck": "Interactive Pitch Deck",
  "/team": "Sales Team Management",
  "/links": "Key Links & Resources",
  "/intelligence": "Prospect Intelligence",
};

export function MacOSMenuBar({
  name,
  role,
  owedCount = 0,
  sidebarCollapsed,
  onToggleSidebar,
}: {
  name: string;
  role: string;
  owedCount?: number;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}) {
  const location = useLocation();
  const [timeStr, setTimeStr] = useState("");
  const [dateStr, setDateStr] = useState("");
  const [dark, setDark] = useState(() => {
    try {
      const stored = localStorage.getItem("theme");
      if (stored === "light" || stored === "dark") return stored === "dark";
    } catch {}
    return true;
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    try {
      localStorage.setItem("theme", dark ? "dark" : "light");
    } catch {}
  }, [dark]);

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setTimeStr(
        now.toLocaleTimeString("en-GB", {
          timeZone: "Asia/Kuwait",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }),
      );
      setDateStr(
        now.toLocaleDateString("en-GB", {
          timeZone: "Asia/Kuwait",
          weekday: "short",
          day: "numeric",
          month: "short",
        }),
      );
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  const routeTitle =
    ROUTE_NAMES[location.pathname] ||
    (location.pathname.startsWith("/lead/")
      ? "Lead Details"
      : location.pathname.startsWith("/call/")
        ? "Guided Call Script"
        : location.pathname.startsWith("/proposal/")
          ? "Proposal Editor"
          : location.pathname.startsWith("/recording/")
            ? "Recording Review"
            : "Sales Cockpit");

  return (
    <header className="sticky top-0 z-20 flex h-10 w-full items-center justify-between border-b hairline bg-[color:var(--background)]/80 px-3 text-xs backdrop-blur-xl transition-all">
      {/* Left section: App identity & sidebar toggle */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleSidebar}
          title={
            sidebarCollapsed
              ? "Expand sidebar (Ctrl+B)"
              : "Collapse sidebar (Ctrl+B)"
          }
          className="flex size-7 items-center justify-center rounded-[8px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground transition-colors"
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen className="size-4" />
          ) : (
            <PanelLeftClose className="size-4" />
          )}
        </button>

        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <Wordmark size="sm" />
          <span className="muted font-normal">/</span>
          <span className="font-semibold tracking-tight text-foreground">
            {routeTitle}
          </span>
        </div>
      </div>

      {/* Center: Kuwait Time & Date (Authentic macOS center clock) */}
      <div className="hidden sm:flex items-center gap-2 rounded-full border border-border bg-foreground/[0.03] px-3 py-1 text-[11px] font-mono text-foreground tabular-nums">
        <Clock className="size-3 text-muted-foreground" />
        <span>Kuwait:</span>
        <span className="font-semibold text-foreground">{timeStr}</span>
        <span className="muted font-sans">·</span>
        <span className="font-sans text-muted-foreground">{dateStr}</span>
      </div>

      {/* Right: Status chips, Theme toggle & user account */}
      <div className="flex items-center gap-2">
        {owedCount > 0 ? (
          <Link
            to="/calendar?view=owed"
            className="flex items-center gap-1.5 rounded-full border tone-warn px-2.5 py-0.5 text-[11px] font-medium transition-colors hover:bg-warning/20"
          >
            <span className="size-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span>{owedCount} owed</span>
          </Link>
        ) : null}

        <button
          type="button"
          title={dark ? "Switch to light mode" : "Switch to dark mode"}
          onClick={() => setDark((d: boolean) => !d)}
          className="flex size-7 items-center justify-center rounded-[8px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground transition-colors"
        >
          {dark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
        </button>

        <div className="flex items-center gap-1.5 rounded-full border border-border bg-foreground/[0.03] py-0.5 pr-2 pl-1 text-[11px]">
          <Avatar name={name} size={22} />
          <span className="max-w-32 truncate font-medium text-foreground">
            {name.split(" ")[0]}{" "}
            <span className="muted font-normal">({role})</span>
          </span>
        </div>
      </div>
    </header>
  );
}
