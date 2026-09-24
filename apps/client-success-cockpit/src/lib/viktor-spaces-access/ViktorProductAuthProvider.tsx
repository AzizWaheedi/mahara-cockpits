import type { ReactNode } from "react";

export function ViktorProductAuthProvider({
  children,
}: {
  children: ReactNode;
  enabled?: boolean;
}) {
  return <>{children}</>;
}
