import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { Button } from "@/components/ui/button";
import { isOfferKey } from "@/present/offer/kinds";
import { checkVideo } from "@/present/offer/sources";
import { readFileFacts, uploadLaunchAd } from "@/present/sources";
import { ProposalBuilder } from "./proposal/ProposalBuilder";
import { createProposal, proposalIO } from "./proposal/proposalSources";

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
          throw Error("Choose a logo between 64 and 4000 pixels on each side.");
        return uploadLaunchAd(client, {
          taskId: key,
          kind: "logo",
          file,
          facts,
          requestId: crypto.randomUUID(),
        });
      }}
    />
  );
}
