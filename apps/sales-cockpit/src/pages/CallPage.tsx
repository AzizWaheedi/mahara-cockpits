import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { button, EmptyState, Failed, page, pageWide } from "../components/kit";
import type { Key } from "../components/ScriptParts";
import { ScriptRunner } from "../components/ScriptRunner";
import { ZoomLinkButton } from "../components/ZoomLink";
import { isClient } from "../lib/clients";
import { useLead, useLeadActivity } from "../lib/data";
import type { Me } from "../lib/types";

/**
 * The call, guided: the setter's intro or the closer's demo, one part at a
 * time, from Aziz's own frameworks. Word for word or as bullets, English or
 * Gulf Arabic, with the lead's details already in the lines. The prospect's
 * numbers sit in a strip pinned above the script, each answer's field sits
 * under the line that asks for it, every part has open notes, and it all
 * saves to the lead as the call goes (components/ScriptRunner.tsx). The
 * intro's last part books the demo.
 */
export default function CallPage({ me }: { me: Me }) {
  const { contactId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const lead = useLead(contactId);
  const activity = useLeadActivity(contactId, lead.data?.phone8 ?? null);

  const defaultKey: Key =
    me.role === "setter" ? "intro" : me.role === "closer" ? "demo" : "intro";
  const key: Key =
    params.get("script") === "demo"
      ? "demo"
      : params.get("script") === "intro"
        ? "intro"
        : defaultKey;

  if (lead.error)
    return (
      <Wrap>
        <Failed what="This lead" error={lead.error} retry={lead.reload} />
      </Wrap>
    );
  if (!lead.data)
    return (
      <Wrap>
        {lead.loading ? (
          <p className="muted text-sm">Opening the call…</p>
        ) : (
          <EmptyState
            title="This lead is not in the cockpit"
            text="Open it again from the Leads list."
          />
        )}
      </Wrap>
    );

  const l = lead.data;
  const leadName = l.name ?? "the lead";

  return (
    <main className={pageWide}>
      <ScriptRunner
        key={`${contactId}:${key}`}
        me={me}
        as={me.role === "closer" ? "closer" : "setter"}
        lead={l}
        scriptKey={key}
        onScriptKey={v => {
          const p = new URLSearchParams(params);
          p.set("script", v);
          setParams(p, { replace: true });
        }}
        layout="page"
        appointments={activity.data?.appointments ?? []}
        notes={activity.data?.notes ?? []}
        notesLoaded={Boolean(activity.data) || Boolean(activity.error)}
        reload={activity.reload}
        headerStart={
          <>
            <Link
              to={`/lead/${contactId}`}
              className="muted inline-flex items-center gap-1 text-sm hover:underline"
            >
              <ArrowLeft className="size-3.5" aria-hidden /> {leadName}
            </Link>
            <h1 className="text-lg font-semibold tracking-tight" dir="auto">
              {key === "intro" ? "Intro call" : "Demo"} with {leadName}
            </h1>
          </>
        }
        headerEnd={
          <>
            {isClient(l) ? null : (
              <ZoomLinkButton lead={l} me={me} kind={key} />
            )}
            {key === "demo" ? (
              <Link
                to={`/deck?lead=${encodeURIComponent(contactId)}`}
                target="_blank"
                rel="noopener"
                className={button}
                title="The pitch deck with their name and the numbers from these notes. They save as you type."
              >
                Present the deck
              </Link>
            ) : null}
          </>
        }
      />
    </main>
  );
}

function Wrap({ children }: { children: ReactNode }) {
  return <main className={page}>{children}</main>;
}
