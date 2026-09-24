import { ExternalLink, Play } from "lucide-react";
import { useState } from "react";
import { day } from "../lib/format";
import { type AdPreview, adPreview } from "../lib/portal";
import type { Lead } from "../lib/types";
import { button } from "./kit";

/**
 * Where the lead came from: the ad, the campaign, the form's tracking, and
 * the ad itself on request. Meta's preview is fetched fresh by the portal
 * (its links die within a day), so it is only asked for when the rep wants
 * to see it.
 */
export function AdOrigin({ lead }: { lead: Lead }) {
  const [preview, setPreview] = useState<AdPreview | null>(null);
  const [busy, setBusy] = useState(false);

  const rows: [string, string | null][] = [
    ["Ad", lead.ad_name],
    ["Ad set", lead.adset_name],
    ["Campaign", lead.campaign_name],
    [
      "Source",
      [lead.utm_source, lead.source].filter(Boolean).join(" · ") || null,
    ],
    ["Booked by", lead.booking_channel],
  ];
  const shown = rows.filter(([, v]) => v);

  async function load() {
    if (!lead.ad_id) return;
    setBusy(true);
    try {
      setPreview(await adPreview(lead.ad_id));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {shown.length ? (
        <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5 text-sm">
          {shown.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="muted">{k}</dt>
              <dd className="min-w-0 break-words" dir="auto">
                {v}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="muted text-sm">
          HighLevel has no ad on this contact. They may have come from organic
          content, a referral or a direct message.
        </p>
      )}
      {lead.ad_id ? (
        preview?.ok && (preview.src || preview.stillUrl) ? (
          <div className="space-y-2">
            {preview.src ? (
              <iframe
                title="The ad this lead came from"
                src={preview.src}
                className="w-full rounded-[var(--radius-md)] border hairline bg-white"
                style={{
                  aspectRatio:
                    preview.width && preview.height
                      ? `${preview.width} / ${preview.height}`
                      : "4 / 5",
                  maxHeight: "36rem",
                }}
                sandbox="allow-scripts allow-same-origin allow-popups"
                loading="lazy"
              />
            ) : (
              <img
                src={preview.stillUrl}
                alt="The ad this lead came from"
                className="w-full rounded-[var(--radius-md)] border hairline"
              />
            )}
            <a
              href={`https://www.facebook.com/adsmanager/manage/ads?selected_ad_ids=${lead.ad_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="muted inline-flex items-center gap-1 text-xs hover:underline"
            >
              Open in Ads Manager{" "}
              <ExternalLink className="size-3" aria-hidden />
            </a>
          </div>
        ) : (
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={load}
              disabled={busy}
              className={button}
            >
              <Play className="size-3.5" aria-hidden />
              {busy ? "Loading the ad…" : "Show the ad"}
            </button>
            {preview && !preview.ok ? (
              <p className="muted text-xs">
                {preview.reason ||
                  preview.error ||
                  "Meta did not return a preview for this ad."}
              </p>
            ) : null}
          </div>
        )
      ) : null}
      {lead.lead_created_at ? (
        <p className="muted text-xs">Came in on {day(lead.lead_created_at)}.</p>
      ) : null}
    </div>
  );
}
