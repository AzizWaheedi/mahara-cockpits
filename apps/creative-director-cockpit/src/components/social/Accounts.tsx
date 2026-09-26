import { useAction } from "convex/react";
import {
  Facebook,
  Instagram,
  LoaderCircle,
  RefreshCw,
  Search,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { useConfirm } from "./Confirm";

/**
 * Which Facebook Page and Instagram account a client posts from.
 *
 * The list is the Pages our Meta account manages (Salma refreshes it every
 * morning), and beside each the one fact that names its owner better than
 * any spelling: whether this client's own ads run on it. A person picks;
 * nothing is linked by guesswork, because a wrong link posts one client's
 * work on another's account.
 */

type Page = {
  pageId: string;
  name: string;
  picture: string | null;
  igUserId: string | null;
  igUsername: string | null;
  igPicture: string | null;
  suggested: "ads" | "name" | null;
};

type Current = {
  pageId: string;
  name: string | null;
  igUserId: string | null;
  igUsername: string | null;
  linkedAt: string | null;
  linkedBy: string | null;
};

type Pages = {
  pages: Page[];
  current: Current | null;
  refreshedAt: string | null;
  refreshing: boolean;
  refreshError: string | null;
};

function message(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  const m = /Uncaught Error: ([^\n]+)/.exec(raw);
  return (
    (m ? m[1] : raw).replace(/\s+at .*$/s, "").trim() || "That did not work."
  );
}

function when(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kuwait",
  });
}

/** Meta's picture links are signed and expire; a dead one shows initials. */
function Avatar({ src, name }: { src: string | null; name: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken)
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold uppercase text-muted-foreground">
        {name.trim().slice(0, 1)}
      </span>
    );
  return (
    <img
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      className="h-9 w-9 shrink-0 rounded-full object-cover"
    />
  );
}

export function AccountsPicker({
  clientId,
  wantsInstagram,
  onChanged,
}: {
  clientId: string;
  wantsInstagram: boolean;
  onChanged: () => Promise<void>;
}) {
  const load = useAction(api.social.pages);
  const link = useAction(api.social.linkAccounts);
  const refresh = useAction(api.social.refreshPages);
  const [data, setData] = useState<Pages | null>(null);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  const reload = useCallback(async () => {
    try {
      setData((await load({ clientTaskId: clientId })) as Pages);
    } catch (e) {
      toast.error(message(e));
    }
  }, [load, clientId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // While Salma fetches a fresh list, look again; only while on screen.
  useEffect(() => {
    if (!data?.refreshing) return;
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, 10_000);
    return () => window.clearInterval(t);
  }, [data?.refreshing, reload]);

  async function use(pageId: string | null) {
    setBusy(pageId ?? "unlink");
    try {
      await link({ clientTaskId: clientId, pageId });
      toast.success(pageId ? "Linked." : "Unlinked.");
      setPicking(false);
      await reload();
      await onChanged();
    } catch (e) {
      toast.error(message(e));
    } finally {
      setBusy(null);
    }
  }

  if (!data)
    return (
      <div>
        <span className="mb-1.5 block text-sm font-medium">
          Instagram and Facebook
        </span>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          Loading the Pages
        </p>
      </div>
    );

  const current = data.current;
  const currentPage = current
    ? data.pages.find(p => p.pageId === current.pageId)
    : null;
  const q = query.trim().toLowerCase();
  const shown = data.pages.filter(
    p =>
      p.pageId !== current?.pageId &&
      (!q ||
        p.name.toLowerCase().includes(q) ||
        (p.igUsername ?? "").toLowerCase().includes(q)),
  );
  const suggested = q ? [] : shown.filter(p => p.suggested);
  const rest = q ? shown : shown.filter(p => !p.suggested);

  const row = (p: Page) => (
    <li key={p.pageId} className="flex items-center gap-3 py-2">
      <Avatar src={p.igPicture ?? p.picture} name={p.name} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm font-medium">
          <span className="min-w-0 max-w-full truncate" dir="auto">
            {p.name}
          </span>
          {p.suggested === "ads" ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs font-medium">
              <span aria-hidden className="size-1.5 rounded-full bg-primary" />
              Their ads run here
            </span>
          ) : p.suggested === "name" ? (
            <span className="inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground">
              Name matches
            </span>
          ) : null}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {p.igUsername
            ? `@${p.igUsername}`
            : "No Instagram account on this Page"}
        </span>
      </span>
      <button
        type="button"
        disabled={Boolean(busy)}
        onClick={() => void use(p.pageId)}
        className="inline-flex h-8 shrink-0 items-center rounded-lg border px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
      >
        {busy === p.pageId ? (
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
        ) : (
          "Use this"
        )}
      </button>
    </li>
  );

  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium">
        Instagram and Facebook
      </span>

      {current ? (
        <div className="rounded-lg border p-3">
          <div className="flex items-center gap-3">
            <Avatar
              src={currentPage?.igPicture ?? currentPage?.picture ?? null}
              name={current.name ?? "?"}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <Facebook className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate" dir="auto">
                  {current.name}
                </span>
              </span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Instagram className="h-3.5 w-3.5 shrink-0" />
                {current.igUsername
                  ? `@${current.igUsername}`
                  : "No Instagram account on this Page"}
              </span>
            </span>
            {!picking ? (
              <button
                type="button"
                onClick={() => setPicking(true)}
                className="h-8 rounded-lg px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Change
              </button>
            ) : null}
          </div>
          {wantsInstagram && !current.igUserId ? (
            <p className="txt-warn mt-2 flex gap-1.5 text-xs">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              This Page has no Instagram account in Meta, so nothing can go to
              Instagram. Connect one in Meta Business Suite, or take Instagram
              off for this client above.
            </p>
          ) : null}
          {!currentPage ? (
            <p className="txt-warn mt-2 flex gap-1.5 text-xs">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Our Meta account no longer manages this Page. Ask the client to
              give access again, or pick another.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          Not linked yet. Pick the client's Page below; their Instagram account
          comes with it.
        </p>
      )}

      {!current || picking ? (
        <div className="mt-3 rounded-lg border">
          <label className="flex items-center gap-2 border-b px-3">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="sr-only">Find a Page</span>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Find a Page or an Instagram name"
              className="h-9 min-w-0 flex-1 bg-transparent text-sm focus:outline-none"
            />
          </label>
          <ul className="max-h-72 divide-y overflow-y-auto overscroll-contain px-3">
            {suggested.map(row)}
            {rest.map(row)}
            {!suggested.length && !rest.length ? (
              <li className="py-3 text-xs text-muted-foreground">
                No Page matches that. The list only has the Pages our Meta
                account manages; a client who has not given us access yet is not
                on it.
              </li>
            ) : null}
          </ul>
          {current ? (
            <div className="flex justify-between border-t px-3 py-2">
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() =>
                  void (async () => {
                    const ok = await confirm({
                      title: "Unlink this client from its Page?",
                      action: "Unlink",
                      destructive: true,
                    });
                    if (ok) void use(null);
                  })()
                }
                className="text-xs text-muted-foreground hover:text-destructive"
              >
                Unlink
              </button>
              <button
                type="button"
                onClick={() => setPicking(false)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Keep {current.name}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <span>
          The Pages our Meta account manages, refreshed every morning. Last:{" "}
          {when(data.refreshedAt)}.
        </span>
        <button
          type="button"
          disabled={data.refreshing}
          onClick={() =>
            void (async () => {
              try {
                await refresh({});
                toast.success("Asking Meta for the list. It takes a minute.");
                await reload();
              } catch (e) {
                toast.error(message(e));
              }
            })()
          }
          className="no-touch relative inline-flex items-center gap-1 font-medium text-foreground after:absolute after:-inset-2 after:content-[''] hover:underline disabled:opacity-60"
        >
          <RefreshCw
            className={`h-3 w-3 ${data.refreshing ? "animate-spin" : ""}`}
          />
          {data.refreshing ? "Refreshing" : "Refresh now"}
        </button>
      </p>
      {data.refreshError ? (
        <p className="txt-bad mt-1 text-xs">
          The last refresh failed: {data.refreshError}
        </p>
      ) : null}
      {confirmDialog}
    </div>
  );
}
