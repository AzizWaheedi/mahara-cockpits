import type { ReactNode } from "react";
import { useTheme as useAppTheme } from "@/lib/theme";

/**
 * Thin adapter over the one real theme provider in `lib/theme.tsx`.
 *
 * The template shipped two providers (this one and lib/theme) that both
 * toggled the `dark` class from different localStorage keys, so the sidebar
 * toggle and the header toggle fought each other. Everything now reads the
 * same source; this file only keeps the older call sites compiling.
 */
export function ThemeProvider({
  children,
}: {
  children: ReactNode;
  defaultTheme?: "light" | "dark" | "system";
  switchable?: boolean;
}) {
  return <>{children}</>;
}

export function useTheme() {
  const { theme, toggle } = useAppTheme();
  return { theme, toggleTheme: toggle, switchable: true };
}
