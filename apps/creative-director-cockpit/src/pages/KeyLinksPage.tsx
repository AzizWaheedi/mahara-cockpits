import { Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
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
    <div className="mx-auto max-w-4xl space-y-4 p-4 pb-16">
      <header>
        <h1 className="text-[19px] font-bold tracking-tight">Key links</h1>
        <p className="text-[13px] text-muted-foreground">
          Everything you open in a day. Pulled from the Brand Blueprint
          framework, the Client Communication SOP and ClickUp itself. If one is
          missing or wrong, tell Aziz and it gets fixed here, not in a bookmark.
        </p>
      </header>

      {LINK_GROUPS.map(g => (
        <section key={g.title} className="rounded-lg border">
          <div className="border-b px-3.5 py-2">
            <div className="text-[14px] font-semibold">{g.title}</div>
            <div className="text-[12px] text-muted-foreground">{g.blurb}</div>
          </div>
          <div className="divide-y">
            {g.rows.map(r => (
              <div
                key={r.url + r.label}
                className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2"
              >
                <div className="min-w-0">
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-[13px] font-medium underline underline-offset-2"
                  >
                    {r.label}
                    <ExternalLink className="h-3 w-3 text-muted-foreground" />
                  </a>
                  {r.note && (
                    <div className="text-[12px] text-muted-foreground">
                      {r.note}
                    </div>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(r.url);
                    toast.success("Link copied");
                  }}
                >
                  <Copy className="mr-1 h-3 w-3" />
                  Copy
                </Button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
