/**
 * What the newest comments on the client's ClickUp card said: call summaries,
 * kickoff handoffs, client briefs and notes, digested by Hermes within about
 * 15 minutes of being posted (commentWatch.ts in the media buyer backend).
 * Each cockpit shows the part it acts on.
 */

export type ClientUpdate = {
  at: number;
  kind: string;
  summary?: string;
  nextSteps?: string[];
  clientRequests?: string[];
  risks?: string[];
  forAds?: string[];
  forCreative?: string[];
};

type Focus = "ads" | "creative" | "csm";

const KIND: Record<string, string> = {
  call: "Call summary",
  kickoff: "Kickoff handoff",
  brief: "Client brief",
  note: "Comment",
};

const LISTS: Record<Focus, Array<[string, keyof ClientUpdate]>> = {
  ads: [
    ["For the ads", "forAds"],
    ["Risks", "risks"],
  ],
  creative: [
    ["For creative", "forCreative"],
    ["Client asked for", "clientRequests"],
  ],
  csm: [
    ["Next steps", "nextSteps"],
    ["Client asked for", "clientRequests"],
    ["Risks", "risks"],
  ],
};

function day(at: number) {
  const d = new Date(at);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** The updates as a plain list, for inside another panel. */
export function ClientUpdateList({
  updates,
  focus,
  limit = 3,
}: {
  updates?: ClientUpdate[];
  focus: Focus;
  limit?: number;
}) {
  const list = (updates ?? []).slice(0, limit);
  if (!list.length) return null;
  return (
    <ul className="space-y-3">
      {list.map(u => (
        <li key={`${u.at}-${u.kind}`} className="text-[13px] leading-snug">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {KIND[u.kind] ?? "Comment"} · {day(u.at)}
          </p>
          {u.summary ? <p className="mt-0.5">{u.summary}</p> : null}
          {LISTS[focus].map(([label, key]) => {
            const items = (u[key] as string[] | undefined) ?? [];
            return items.length ? (
              <p key={label} className="mt-1">
                <span className="font-semibold">{label}: </span>
                {items.slice(0, 5).join(" · ")}
                {items.length > 5
                  ? ` · +${items.length - 5} more on the card`
                  : ""}
              </p>
            ) : null;
          })}
        </li>
      ))}
    </ul>
  );
}

/** The updates in their own card. Nothing when the card has no digested comments. */
export function ClientUpdates({
  updates,
  focus,
  url,
  limit = 3,
}: {
  updates?: ClientUpdate[];
  focus: Focus;
  url?: string;
  limit?: number;
}) {
  if (!(updates ?? []).length) return null;
  return (
    <section className="rounded-lg border bg-card p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Latest from the ClickUp card
        </h3>
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="text-[12px] underline underline-offset-2"
          >
            Open the card
          </a>
        ) : null}
      </div>
      <ClientUpdateList updates={updates} focus={focus} limit={limit} />
    </section>
  );
}
