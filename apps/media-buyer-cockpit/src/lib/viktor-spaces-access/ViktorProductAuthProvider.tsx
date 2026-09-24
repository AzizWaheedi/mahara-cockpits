import type { ReactNode } from "react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexProvider } from "convex/react";
import { convex } from "@/auth/convexClient";

export function ViktorProductAuthProvider({
  children,
  enabled,
}: {
  children: ReactNode;
  enabled: boolean;
}) {
  const hasConvexUrl = Boolean(
    (import.meta.env.VITE_CONVEX_URL as string | undefined)?.trim(),
  );
  if (!enabled || !hasConvexUrl) {
    return <ConvexProvider client={convex}>{children}</ConvexProvider>;
  }
  return <ConvexAuthProvider client={convex}>{children}</ConvexAuthProvider>;
}
