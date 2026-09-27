import type { ReactNode } from "react";

/**
 * The one page header every screen in this cockpit uses: the title, one
 * muted line under it, and the page's own actions on the right. The
 * layout's <main> already pads the page, so this adds no padding of its
 * own, only the 24px before the page's first section.
 */
export function PageHeader({
  title,
  sub,
  actions,
  titleDir,
}: {
  title: ReactNode;
  /** One muted line. Anything longer belongs in the page, not here. */
  sub?: ReactNode;
  /** Buttons or links for the whole page, right-aligned. */
  actions?: ReactNode;
  /** "auto" for a title that can be Arabic (a client's name). */
  titleDir?: "auto";
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1
          className="text-2xl font-semibold tracking-tight sm:text-[28px] sm:leading-9"
          dir={titleDir}
        >
          {title}
        </h1>
        {sub ? (
          <p className="mt-1 text-sm text-muted-foreground">{sub}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}
