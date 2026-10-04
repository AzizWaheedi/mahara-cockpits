import { Link, useLocation } from "react-router";

export const clientRoutes = [
  { href: "/clients", label: "Follow-ups" },
  { href: "/performance", label: "Performance" },
  { href: "/backlog", label: "Data issues" },
];
export const growthRoutes = [
  { href: "/projections", label: "Renewals" },
  { href: "/hotlist", label: "Opportunities" },
  { href: "/churn", label: "Retention" },
  { href: "/money", label: "My income" },
];
export function WorkspaceNav() {
  const { pathname } = useLocation();
  const routes = clientRoutes.some(r => r.href === pathname)
    ? clientRoutes
    : growthRoutes.some(r => r.href === pathname)
      ? growthRoutes
      : null;
  if (!routes) return null;
  return (
    <nav
      aria-label={
        routes === clientRoutes ? "Client workspace" : "Growth workspace"
      }
      className="mx-auto mb-6 flex w-full max-w-6xl flex-wrap gap-1 rounded-2xl border bg-card p-1.5"
    >
      {routes.map(r => (
        <Link
          key={r.href}
          to={r.href}
          aria-current={pathname === r.href ? "page" : undefined}
          className={`rounded-xl px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary ${pathname === r.href ? "bg-primary/15 text-foreground ring-1 ring-inset ring-primary/30" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
        >
          {r.label}
        </Link>
      ))}
    </nav>
  );
}
