/**
 * Why this client's leads died.
 *
 * Read straight from the client's own GHL sub-account. Two things worth knowing
 * about the data: Mahara encodes the reason as the STAGE NAME in the "Lost Leads"
 * pipeline (not GHL's lost status), and the biggest stage by far is
 * "Other (write why in the notes section)" — so the stage breakdown alone hides
 * the real story. The notes are the story, which is why they are shown in full.
 */
type Lost = {
  total: number;
  reasons: { reason: string; count: number }[];
  notes: { note: string; reason: string; adId?: string; at: string }[];
  byAd: Record<string, number>;
};

export function LostLeads({
  lost,
  adNameById,
}: {
  lost?: Lost;
  adNameById?: Record<string, string>;
}) {
  if (!lost || lost.total === 0) return null;
  const top = lost.reasons[0];
  const vague = /other|unsure|unlabelled/i.test(top?.reason ?? "");
  const worstAd = Object.entries(lost.byAd).sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="mt-4 rounded-lg border p-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[12px] font-bold uppercase tracking-widest text-muted-foreground">
          Why leads died · {lost.total} in the lost pipeline
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {lost.reasons.map(r => (
          <span
            key={r.reason}
            className="rounded-md border px-2 py-0.5 text-[12px]"
          >
            {r.reason.replace(/\s*\(.*\)\s*$/, "")}{" "}
            <span className="font-semibold">{r.count}</span>
          </span>
        ))}
      </div>

      {vague && (
        <div className="callout-warn mt-2 rounded-md px-2.5 py-1.5 text-[12px]">
          The biggest bucket is <strong>{top.reason}</strong> — the CRM label
          isn't telling you anything. The notes below are the real reasons.
        </div>
      )}

      {worstAd && adNameById?.[worstAd[0]] && (
        <div className="mt-2 text-[12px]">
          Most lost leads came from{" "}
          <span className="font-semibold">{adNameById[worstAd[0]]}</span> (
          {worstAd[1]}). Worth checking what that ad promises.
        </div>
      )}

      {lost.notes.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <div className="text-[12px] font-semibold text-muted-foreground">
            What the team actually wrote
          </div>
          {lost.notes.slice(0, 8).map(n => (
            <div key={n.at + n.note} className="border-b pb-1.5 last:border-0">
              <div className="text-[13px]">{n.note}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {n.reason.replace(/\s*\(.*\)\s*$/, "")}
                {n.adId && adNameById?.[n.adId]
                  ? ` · ${adNameById[n.adId]}`
                  : ""}
                {n.at ? ` · ${n.at.slice(0, 10)}` : ""}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
