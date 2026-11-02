import { ArrowUpRight } from "lucide-react";
import { Page, PageHeader } from "../components/bits";
import { SopVideo } from "../components/SopVideo";
import {
  COCKPIT_GUIDES,
  COCKPIT_SOP,
  SOP_VIDEOS,
  TEAM_GUIDES,
} from "../lib/cockpits";

/**
 * How to use this desk: the demo video and both SOPs, the same rows the
 * client success cockpit's Links page shows (csmLinks.ts). The guides were
 * written on 2026-10-07 and had no page here until now. The demo plays on
 * the page itself (2026-11-02), above the links.
 */
const ROWS = [
  {
    label: "The simple SOP",
    url: COCKPIT_GUIDES.editor.simple,
    note: "Your day step by step, with a picture of every step",
  },
  {
    label: "The in-depth SOP",
    url: COCKPIT_GUIDES.editor.deep,
    note: "Every screen, and how to use it",
  },
  {
    label: "Editor desk, how to use it",
    url: COCKPIT_SOP.editor,
    note: "The SOP for this desk, in ClickUp",
  },
  {
    label: "Raise a ticket (the SOP for every team)",
    url: TEAM_GUIDES.ticket.doc,
    note: "Ask another team with Ask a team, follow it, and work the tickets assigned to you",
  },
];

export default function GuidePage() {
  return (
    <Page narrow>
      <PageHeader
        title="How to use this desk"
        sub="Watch the demo once, then keep the simple SOP open beside you while you learn the day."
      />
      <SopVideo video={SOP_VIDEOS.editor.demo} className="mb-4" />
      <SopVideo video={SOP_VIDEOS.team.ticket} className="mb-4" />
      <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
        {ROWS.map(r => (
          <li key={r.label}>
            <a
              href={r.url}
              target="_blank"
              rel="noreferrer noopener"
              className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted sm:px-5"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{r.label}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {r.note}
                </span>
              </span>
              <ArrowUpRight
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground"
              />
            </a>
          </li>
        ))}
      </ul>
    </Page>
  );
}
