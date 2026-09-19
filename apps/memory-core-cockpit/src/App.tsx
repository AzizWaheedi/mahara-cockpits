import {
  Database,
  Lock,
  MessageSquareQuote,
  Moon,
  NotebookPen,
  Search,
  Sun,
} from "lucide-react";
import { useEffect, useState } from "react";
import { SyncButton } from "@/components/memory/SyncButton";
import { useAccessCode, useGate } from "@/components/memory/useMemoryCore";
import { Wordmark } from "@/components/memory/Wordmark";
import { AskView } from "@/views/AskView";
import { MemoriesView } from "@/views/MemoriesView";
import { SearchView } from "@/views/SearchView";
import { SourcesView } from "@/views/SourcesView";
import { UnlockView } from "@/views/UnlockView";

const VIEWS = [
  { key: "search", label: "Search", icon: Search },
  { key: "ask", label: "Ask", icon: MessageSquareQuote },
  { key: "memories", label: "Memories", icon: NotebookPen },
  { key: "sources", label: "Sources", icon: Database },
] as const;

type ViewKey = (typeof VIEWS)[number]["key"];

const THEME_KEY = "memory-core-theme";

/** The sentence under each view's title, so the screen says what it is for. */
const BLURBS: Record<ViewKey, string> = {
  search: "One box over Notion, Gmail, Google Drive and everything you saved.",
  ask: "A question answered from your own material, with the sources it used.",
  memories: "The facts you tell the core yourself. Searchable like the rest.",
  sources: "What is connected, when it last answered, and what to do if not.",
};

export default function App() {
  const { code, save } = useAccessCode();
  const gate = useGate(code);
  const [view, setView] = useState<ViewKey>("search");
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem(THEME_KEY) === "dark";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
    } catch {
      // A browser that blocks storage still shows the theme for this session.
    }
  }, [dark]);

  if (!code || !gate.ok) {
    return (
      <UnlockView
        configured={gate.configured}
        checking={Boolean(code) && gate.loading}
        message={code && gate.loading ? "" : gate.message}
        onSubmit={save}
      />
    );
  }

  return (
    <div className="mc-root min-h-dvh bg-background">
      <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div className="flex items-center gap-5">
            <Wordmark />
            <nav className="flex items-center gap-1" aria-label="Views">
              {VIEWS.map(item => {
                const Icon = item.icon;
                const active = view === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setView(item.key)}
                    aria-current={active ? "page" : undefined}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      active
                        ? "bg-[var(--mc-emphasis-wash)] text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Icon className="size-3.5" aria-hidden />
                    {item.label}
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <SyncButton code={code} size="sm" label="Sync now" />
            <button
              type="button"
              onClick={() => setDark(current => !current)}
              aria-label={
                dark
                  ? "Switch to the light surface"
                  : "Switch to the dark surface"
              }
              className="inline-flex size-8 items-center justify-center rounded-lg border bg-card text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {dark ? (
                <Sun className="size-3.5" aria-hidden />
              ) : (
                <Moon className="size-3.5" aria-hidden />
              )}
            </button>
            <button
              type="button"
              onClick={() => save("")}
              aria-label="Lock this browser"
              className="inline-flex size-8 items-center justify-center rounded-lg border bg-card text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Lock className="size-3.5" aria-hidden />
            </button>
          </div>
        </div>
        <div className="mc-beam" />
      </header>

      <main className="mx-auto max-w-6xl px-5 py-6">
        <div className="mb-5">
          <h1 className="text-lg font-semibold tracking-tight text-foreground">
            {VIEWS.find(item => item.key === view)?.label}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{BLURBS[view]}</p>
        </div>

        {view === "search" ? <SearchView code={code} /> : null}
        {view === "ask" ? <AskView code={code} /> : null}
        {view === "memories" ? <MemoriesView code={code} /> : null}
        {view === "sources" ? (
          <SourcesView code={code} onLock={() => save("")} />
        ) : null}
      </main>

      <footer className="mx-auto max-w-6xl px-5 pb-10 pt-2">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Memory Core · a Mahara internal tool. Notion, Gmail and Google Drive
          come through Composio; memories you save stay in Convex.
        </p>
      </footer>
    </div>
  );
}
