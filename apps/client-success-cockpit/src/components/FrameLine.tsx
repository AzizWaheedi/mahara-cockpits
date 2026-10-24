/**
 * One plain line for the Brand Blueprint's frame in the creative director
 * cockpit (docs/brand-blueprint/EMBED.md 4.6): never this app's sidebar
 * skeleton, its sign-in page or its crash screen inside the other cockpit's
 * page. The page around the frame says what to do next.
 */
export function FrameLine({ children }: { children: string }) {
  return (
    <div
      role="status"
      className="grid min-h-screen place-content-center bg-background p-6 text-sm text-muted-foreground"
    >
      {children}
    </div>
  );
}
