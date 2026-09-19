import { useEffect, useState } from "react";
import { NavLink } from "react-router";
import { useWho } from "../lib/auth";
import { otherCockpits, portalUrl } from "../lib/portal";
import { Wordmark } from "./Wordmark";

/**
 * The same shape as the other three cockpits: grouped navigation down the
 * left, the portal's other doors underneath, the person at the bottom.
 *
 * The shared sections keep the names they have elsewhere. "Ideation" and
 * "What works" are literally the same rows the creative director sees, so
 * calling them something else here would make switching cockpits feel like
 * two products.
 */
const GROUPS: { label: string; items: { to: string; label: string }[] }[] = [
  {
    label: "Your day",
    items: [
      { to: "/", label: "Jobs" },
      { to: "/pipeline", label: "Pipeline" },
      { to: "/eod", label: "End of day" },
    ],
  },
  {
    label: "The work",
    items: [{ to: "/videos", label: "Footage" }],
  },
  {
    label: "Library",
    items: [
      { to: "/ideas", label: "Ideation" },
      { to: "/winners", label: "What works" },
    ],
  },
];

function ThemeToggle() {
  const [dark, setDark] = useState(() => {
    try {
      const stored = localStorage.getItem("theme");
      if (stored === "light" || stored === "dark") return stored === "dark";
    } catch {
      // A private window forbids this; fall through to the system setting.
    }
    return (
      typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
    );
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    try {
      localStorage.setItem("theme", dark ? "dark" : "light");
    } catch {
      // The tool still works, it just forgets.
    }
  }, [dark]);

  return (
    <button type="button" onClick={() => setDark((d) => !d)} className="muted text-xs">
      {dark ? "Light" : "Dark"}
    </button>
  );
}

export default function Sidebar({
  name,
  isAdmin,
  onNavigate,
}: {
  name: string;
  isAdmin: boolean;
  onNavigate?: () => void;
}) {
  const { cockpits, signOut } = useWho();
  const doors = otherCockpits(cockpits, isAdmin);

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-4">
      <a href={`${portalUrl()}/`} className="px-2">
        <Wordmark size="md" />
      </a>

      <nav className="flex flex-col gap-5">
        {GROUPS.map((g) => (
          <div key={g.label}>
            <p className="muted mb-1 px-2 text-[11px] font-medium tracking-wide uppercase">
              {g.label}
            </p>
            <ul className="space-y-0.5">
              {g.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === "/"}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      `block rounded-[var(--radius-md)] px-2 py-1.5 text-sm transition-colors ${
                        isActive
                          ? "bg-[color:var(--secondary)] font-medium"
                          : "muted hover:bg-[color:var(--secondary)] hover:text-[color:var(--foreground)]"
                      }`
                    }
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {doors.length ? (
          <div>
            <p className="muted mb-1 px-2 text-[11px] font-medium tracking-wide uppercase">
              Switch cockpit
            </p>
            <ul className="space-y-0.5">
              {doors.map((d) => (
                <li key={d.key}>
                  <a
                    href={d.href}
                    className="muted block rounded-[var(--radius-md)] px-2 py-1.5 text-sm transition-colors hover:bg-[color:var(--secondary)] hover:text-[color:var(--foreground)]"
                  >
                    {d.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </nav>

      <div className="mt-auto border-t hairline px-2 pt-3">
        <p className="truncate text-sm font-medium">{name}</p>
        <div className="mt-1 flex items-center gap-3">
          <ThemeToggle />
          <button type="button" onClick={signOut} className="muted text-xs">
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
