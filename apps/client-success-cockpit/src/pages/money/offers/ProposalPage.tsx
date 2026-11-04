import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import {
  MarkOffered,
  type ProposalFacts,
  upsellKindOf,
  winsApi,
} from "@/components/ClientWins";
import { Button } from "@/components/ui/button";
import type { Door } from "@/forms/staff/formSheetCore";
import { formDoorsW56 } from "@/forms/staff/lifecycleClient";
import type { WinRow } from "@/lib/winsCore";
import { isOfferKey } from "@/present/offer/kinds";
import { checkVideo } from "@/present/offer/sources";
import { readFileFacts, uploadLaunchAd } from "@/present/sources";
import { ProposalBuilder } from "./proposal/ProposalBuilder";
import {
  createProposal,
  getProposal,
  proposalIO,
} from "./proposal/proposalSources";

export default function ProposalPage() {
  const { key = "", id = "new" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { client } = useCockpitAuth();
  const rawOffer = params.get("offer");
  const offer = isOfferKey(rawOffer) ? rawOffer : "website";
  const lang = params.get("lang") === "ar" ? "ar" : "en";
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const request = useRef<{ key: string; id: string } | null>(null);
  const io = useMemo(
    () => (client && id !== "new" ? proposalIO(client, id, key) : null),
    [client, id, key],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry deliberately starts a fresh request with the same idempotency key.
  useEffect(() => {
    if (!client || id !== "new") return;
    let active = true;
    setError("");
    const storageKey = `mm-proposal-new:${key}:${offer}:${lang}`;
    if (request.current?.key !== storageKey) {
      let existing: string | null = null;
      try {
        existing = sessionStorage.getItem(storageKey);
      } catch {
        /* Memory still covers retries. */
      }
      request.current = {
        key: storageKey,
        id:
          existing && /^[a-f0-9-]{36}$/.test(existing)
            ? existing
            : crypto.randomUUID(),
      };
      try {
        sessionStorage.setItem(storageKey, request.current.id);
      } catch {
        /* A disabled storage API is not a save failure. */
      }
    }
    void createProposal(client, key, offer, lang, request.current.id)
      .then(out => {
        if (!active) return;
        try {
          sessionStorage.removeItem(storageKey);
        } catch {
          /* The server id is now the route. */
        }
        navigate(
          `/clients/${encodeURIComponent(key)}/proposals/${out.proposal.id}`,
          { replace: true },
        );
      })
      .catch(e => {
        if (active)
          setError(
            e instanceof Error
              ? e.message
              : "The draft could not be created. Try again.",
          );
      });
    return () => {
      active = false;
    };
  }, [client, id, key, offer, lang, navigate, retry]);
  if (!client) return <p>Sign in to the cockpit to prepare a proposal.</p>;
  if (error)
    return (
      <div role="alert" className="space-y-3">
        <p>{error}</p>
        <Button variant="outline" onClick={() => setRetry(x => x + 1)}>
          Try again
        </Button>
      </div>
    );
  if (!io)
    return (
      <p role="status" className="py-12 text-sm text-muted-foreground">
        Creating your draft
      </p>
    );
  return (
    <>
      <OfferStage taskId={key} proposalId={id} />
      <ProposalBuilder
        key={id}
        io={io}
        onBack={() => navigate(`/clients/${encodeURIComponent(key)}?tab=money`)}
        checkCustomVideo={url => checkVideo(client, url)}
        addLogo={async file => {
          if (
            !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
            file.size > 2 * 1024 * 1024
          )
            throw Error("Choose a PNG, JPEG or WebP logo under 2 MB.");
          const facts = await readFileFacts(file);
          if (
            !facts.width ||
            !facts.height ||
            facts.width < 64 ||
            facts.height < 64 ||
            facts.width > 4000 ||
            facts.height > 4000
          )
            throw Error(
              "Choose a logo between 64 and 4000 pixels on each side.",
            );
          return uploadLaunchAd(client, {
            taskId: key,
            kind: "logo",
            file,
            facts,
            requestId: crypto.randomUUID(),
          });
        }}
      />
    </>
  );
}

const sum = (r: Record<string, number | null> | null | undefined) => {
  const v = Object.values(r ?? {});
  return v.length && v.every(x => typeof x === "number")
    ? (v as number[]).reduce((t, x) => t + x, 0)
    : null;
};

/**
 * The proposal's place in the wins ledger (docs/forms/WAVE56-CONTRACT.md
 * 4.3, 5.3): Mark as offered on a sent proposal (never a draft), the
 * accepted banner, and the win ribbon once offered. Behind the wins door.
 */
function OfferStage({
  taskId,
  proposalId,
}: {
  taskId: string;
  proposalId: string;
}) {
  const { client } = useCockpitAuth();
  const [door, setDoor] = useState<Door | null>(null);
  const [facts, setFacts] = useState<ProposalFacts | null>(null);
  const [win, setWin] = useState<WinRow | null>(null);
  const [version, setVersion] = useState(0);
  const api = useMemo(() => (client ? winsApi(client) : null), [client]);
  useEffect(() => {
    if (!client) return;
    let live = true;
    void formDoorsW56(client).then(d => live && setDoor(d.wins));
    return () => {
      live = false;
    };
  }, [client]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: version reads again after a mark
  useEffect(() => {
    if (!client || !api || !door?.open || proposalId === "new") return;
    let live = true;
    void getProposal(client, proposalId)
      .then(b => {
        const p = (b as { proposal?: Record<string, any> }).proposal ?? b;
        const kind = upsellKindOf(String(p.offerKey ?? ""));
        if (!live || !kind) return;
        setFacts({
          id: proposalId,
          taskId,
          status: String(p.status ?? "draft"),
          kind,
          totalUsd: sum(p.price?.parts),
          listUsd: sum(p.listPrice),
        });
      })
      .catch(() => live && setFacts(null));
    void api
      .read(taskId)
      .then(
        r =>
          live && setWin(r.wins.find(w => w.proposalId === proposalId) ?? null),
      )
      .catch(() => live && setWin(null));
    return () => {
      live = false;
    };
  }, [client, api, door?.open, proposalId, taskId, version]);
  if (!door) return null;
  if (door.open && !facts) return null;
  return (
    <div className="mb-4">
      {facts || !door.open ? (
        <MarkOffered
          api={api}
          door={door}
          proposal={
            facts ?? {
              id: proposalId,
              taskId,
              status: "draft",
              kind: "upsell_website",
              totalUsd: null,
              listUsd: null,
            }
          }
          win={win}
          onMarked={() => setVersion(v => v + 1)}
        />
      ) : null}
    </div>
  );
}
