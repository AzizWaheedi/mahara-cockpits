import { useAction } from "convex/react";
import { ArrowUpRight, Check, Copy, ListTodo } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Chip, Dot, Kicker } from "@/components/kit";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { shortDay } from "@/lib/format";
import { api } from "../../convex/_generated/api";
import { PORTAL_FORM_URL, type PortalTask } from "../../convex/portalTasksCore";

/**
 * Give a client a task in their Mahara OS portal from the cockpit (Aziz,
 * 2026-10-06). The form is ClickUp's own "Assign a client task", opened here
 * unchanged, because the portal publishes what that form makes. ClickUp
 * cannot fill the client in from a link, so the sheet names the tag to pick,
 * and lists what the client already has to do.
 */

type Loaded = {
  clientName: string;
  tag: string | null;
  formUrl: string;
  tasks: PortalTask[];
};

const errorText = (e: unknown) =>
  (e as { data?: { message?: string } })?.data?.message ||
  (e instanceof Error ? e.message : "The portal tasks could not be read.");

export function PortalTasksButton({
  taskId,
  clientName,
  variant = "outline",
}: {
  taskId: string;
  clientName: string;
  variant?: "default" | "outline" | "ghost";
}) {
  const load = useAction(api.portalTasks.forClient);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [reload, setReload] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload re-reads the list after the form is sent
  useEffect(() => {
    if (!open) return;
    let live = true;
    setError("");
    void load({ taskId })
      .then(r => {
        if (live) setData(r as Loaded);
      })
      .catch(e => {
        if (live) setError(errorText(e));
      });
    return () => {
      live = false;
    };
  }, [open, taskId, load, reload]);

  const openTasks = (data?.tasks ?? []).filter(t => !t.done);
  const doneTasks = (data?.tasks ?? []).filter(t => t.done);

  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setOpen(true)}>
        <ListTodo aria-hidden />
        Give them a portal task
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="w-full overflow-y-auto sm:max-w-2xl"
        >
          <SheetHeader className="text-left">
            <SheetTitle className="text-lg">
              Give {clientName} a portal task
            </SheetTitle>
            <SheetDescription>
              It shows in their Mahara OS portal with your instructions and a
              due reminder. The form below is ClickUp's own.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-5">
            {error ? (
              <div className="callout-warn rounded-xl border px-3 py-2 text-xs">
                {error}
              </div>
            ) : null}

            {data ? (
              data.tag ? (
                <div className="rounded-xl bg-muted/40 p-4">
                  <Kicker>Client tag to pick</Kicker>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <code className="select-all text-sm" dir="auto">
                      {data.tag}
                    </code>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        navigator.clipboard.writeText(data.tag ?? "").then(
                          () => setCopied(true),
                          () =>
                            toast.error(
                              "The copy did not work. Select it instead.",
                            ),
                        );
                        setTimeout(() => setCopied(false), 2000);
                      }}
                    >
                      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                      {copied ? "Copied" : "Copy"}
                    </Button>
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Pick only this tag in "Client". A task with no client or two
                    clients stays unpublished.
                  </p>
                </div>
              ) : (
                <div className="callout-warn rounded-xl border px-3 py-2 text-xs">
                  {clientName} has no client tag in ClickUp's Team - Maharamedia
                  space, so a task cannot reach their portal yet. Ask Aziz to
                  add the tag "{clientName.toLowerCase()}".
                </div>
              )
            ) : error ? null : (
              <p className="text-xs text-muted-foreground">
                Reading their tag and tasks…
              </p>
            )}

            {data?.tag ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Kicker>
                    {openTasks.length
                      ? `Open in their portal (${openTasks.length})`
                      : "Open in their portal"}
                  </Kicker>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setReload(x => x + 1)}
                  >
                    Read again
                  </Button>
                </div>
                {openTasks.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Nothing open. Tasks you give them appear here.
                  </p>
                ) : (
                  <ul className="divide-y rounded-xl border">
                    {openTasks.map(t => (
                      <TaskRow key={t.id} t={t} />
                    ))}
                  </ul>
                )}
                {doneTasks.length ? (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">
                      Finished ({doneTasks.length})
                    </summary>
                    <ul className="mt-2 divide-y rounded-xl border">
                      {doneTasks.map(t => (
                        <TaskRow key={t.id} t={t} />
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-2">
              <Kicker>The form</Kicker>
              <iframe
                src={data?.formUrl ?? PORTAL_FORM_URL}
                title="Assign a client task"
                className="h-[1100px] w-full rounded-xl border bg-white"
              />
              <a
                href={data?.formUrl ?? PORTAL_FORM_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
              >
                Open the form in its own tab
                <ArrowUpRight aria-hidden className="size-3.5" />
              </a>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function TaskRow({ t }: { t: PortalTask }) {
  const overdue = !t.done && t.due && Date.parse(t.due) < Date.now();
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 font-medium" dir="auto">
          <Dot tone={t.done ? "good" : overdue ? "bad" : "warn"} />
          {t.name}
        </div>
        <div className="mt-0.5 pl-3 text-xs text-muted-foreground">
          {[
            t.requestType,
            t.due ? `due ${shortDay(t.due)}` : null,
            t.status,
            t.published ? null : "not published",
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {overdue ? <Chip tone="bad">Overdue</Chip> : null}
        {t.url ? (
          <a
            href={t.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
          >
            ClickUp
            <ArrowUpRight aria-hidden className="size-3.5" />
          </a>
        ) : null}
      </div>
    </li>
  );
}
