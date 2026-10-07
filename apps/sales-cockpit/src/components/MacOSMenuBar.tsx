import { Clock, Moon, PanelLeftClose, PanelLeftOpen, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { pageTitle } from "../lib/pages";
import { useDark } from "../lib/theme";
import { Avatar } from "./kit";
import { Wordmark } from "./Wordmark";

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
  // One theme for the whole cockpit: the sidebar's switch flips this too.
  const [dark, toggleDark] = useDark();

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

  // The page's one name, the same as the sidebar's (lib/pages.ts).
  const routeTitle = pageTitle(location.pathname);

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
          onClick={toggleDark}
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
