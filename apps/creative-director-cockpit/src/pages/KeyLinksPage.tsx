import { ArrowUpRight, Copy } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { LINK_GROUPS } from "@/lib/creativeLinks";

/**
 * Key links, the same idea as the CSM cockpit's page.
 *
 * Built for one job: you never hunt for a URL again, and never use an old
 * one someone pasted in WhatsApp six months ago.
 */
export function KeyLinksPage() {
  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Key links"
        sub="Everything you open in a day, from the Brand Blueprint framework, the client communication SOP and ClickUp."
      />

      <div className="grid items-start gap-4 lg:grid-cols-2 lg:gap-6">
        {LINK_GROUPS.map(g => (
          <section
            key={g.title}
            className="overflow-hidden rounded-2xl border bg-card"
          >
            <div className="p-4 sm:px-6 sm:pt-6">
              <h2 className="text-[15px] font-semibold">{g.title}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{g.blurb}</p>
            </div>
            <ul className="divide-y border-t">
              {g.rows.map(r => (
                <li
                  key={r.url + r.label}
                  className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6"
                >
                  <div className="min-w-0">
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      {r.label}
                      <ArrowUpRight className="ml-1 inline size-3.5 align-[-2px]" />
                    </a>
                    {r.note && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {r.note}
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Copy the link: ${r.label}`}
                    onClick={() => {
                      void navigator.clipboard.writeText(r.url);
                      toast.success("Link copied");
                    }}
                    className="shrink-0"
                  >
                    <Copy />
                    Copy
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        A link missing or wrong? Tell Aziz and it gets fixed here, not in a
        bookmark.
      </p>
    </div>
  );
}
