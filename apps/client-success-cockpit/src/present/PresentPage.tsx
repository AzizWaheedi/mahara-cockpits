import { useMemo } from "react";
import { Navigate, useLocation, useParams } from "react-router";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { BookCallButton } from "@/components/ClientCheckIn";
import { loadTypeform } from "@/forms/useFormPanel";
import { formReads } from "@/forms/useLiveForm";
import {
  blueprintPartDone,
  loadBlueprint,
  rehearseBlueprintPart,
  runBlueprintPart,
  saveBlueprint,
} from "./blueprintSources";
import { useDeckReport } from "./DeckBoundary";
import type { KickoffPort } from "./KickoffSlide";
import { loadDeck } from "./load";
import { isOfferDeck, offerOfDeck } from "./offer/kinds";
import { loadOfferDeck, offerIO } from "./offer/load";
import { PresentApp, type View } from "./PresentApp";
import {
  clearDeckVideo,
  type DeckKind,
  readDriveImports,
  readFileFacts,
  removeLaunchAd,
  requestDriveImport,
  saveDeckVideo,
  savePrep,
  updateLaunchAd,
  uploadLaunchAd,
  uploadRefusal,
} from "./sources";
import type { DeckIO } from "./useDeckModel";

/**
 * /clients/:key/present/:deck (deck = onboarding | launch), its notes window
 * at /notes, and the prep view at ?view=prep. Inside the cockpit's sign-in
 * and the CSM seat, outside AppLayout: no sidebar, no HermesChat and no
 * Cmd+K can take focus during a call. The client is opened through the
 * seat's own Supabase client, so cockpit_csm_client_gate decides.
 */

export { presentUrls } from "./presentUrls";

import { presentUrls } from "./presentUrls";

export default function PresentPage({
  notes = false,
  deck: deckProp,
}: {
  notes?: boolean;
  /** The Blueprint's own routes name their deck (docs/brand-blueprint/SPEC.md 4.7). */
  deck?: DeckKind;
}) {
  const { key = "", deck: deckParam = "" } = useParams();
  const deck = deckProp ?? deckParam;
  const { search } = useLocation();
  const auth = useCockpitAuth();
  const client = auth.client;
  const report = useDeckReport();
  const lang = new URLSearchParams(search).get("lang") ?? undefined;
  const view: View = notes
    ? "notes"
    : new URLSearchParams(search).get("view") === "prep"
      ? "prep"
      : "present";

  const io = useMemo<DeckIO>(
    () => ({
      load: () => {
        if (!client) throw Error("Sign in to the cockpit to open the deck.");
        if (isOfferDeck(deck))
          return loadOfferDeck(client, key, offerOfDeck(deck));
        if (deck === "blueprint") return loadBlueprint(client, key);
        return loadDeck(
          client,
          key,
          deck === "launch" ? "launch" : "onboarding",
        );
      },
      // The Brand Blueprint's writes, through the seat's own client:
      // cockpit_blueprint_* decide who may save and press.
      ...(deck === "blueprint"
        ? {
            blueprint: {
              save: (changes, session, baseRevision) => {
                if (!client) throw Error("Saving needs your cockpit sign-in.");
                return saveBlueprint(
                  client,
                  key,
                  changes,
                  session,
                  baseRevision,
                );
              },
              partDone: (part, requestId) => {
                if (!client) throw Error("Sending needs your cockpit sign-in.");
                return blueprintPartDone(client, key, part, requestId);
              },
              run: id => {
                if (!client) throw Error("Sending needs your cockpit sign-in.");
                return runBlueprintPart(client, id);
              },
              rehearse: (part, answers) => {
                if (!client)
                  throw Error("The rehearsal needs your cockpit sign-in.");
                return rehearseBlueprintPart(client, key, part, answers);
              },
            },
          }
        : {}),
      ...(isOfferDeck(deck) && client
        ? { offer: offerIO(client, key, offerOfDeck(deck)) }
        : {}),
      savePrep: (k, patch) => {
        if (!client)
          throw Error(
            "Saving needs your cockpit sign-in. The preview still works.",
          );
        return savePrep(client, key, k, patch);
      },
      presenterName: auth.name,
      publicUrl: (bucket, path) =>
        client?.storage.from(bucket).getPublicUrl(path).data.publicUrl ?? "",
      fileFacts: readFileFacts,
      uploadAd: ({ file, kind, facts, onProgress }) => {
        if (!client)
          throw Error(
            "Saving needs your cockpit sign-in. The preview still works.",
          );
        return uploadLaunchAd(client, {
          taskId: key,
          file,
          kind,
          facts,
          onProgress,
        });
      },
      updateAd: (id, patch) => {
        if (!client)
          throw Error(
            "Saving needs your cockpit sign-in. The preview still works.",
          );
        return updateLaunchAd(client, key, id, patch);
      },
      removeAd: id => {
        if (!client)
          throw Error(
            "Deleting needs your cockpit sign-in. Sign in, then delete it again.",
          );
        return removeLaunchAd(client, key, id);
      },
      saveVideo: v => {
        if (!client)
          throw Error(
            "Saving needs your cockpit sign-in. The preview still works.",
          );
        return saveDeckVideo(client, v);
      },
      clearVideo: v => {
        if (!client)
          throw Error(
            "Saving needs your cockpit sign-in. The preview still works.",
          );
        return clearDeckVideo(client, v);
      },
      requestDriveImport: link => {
        if (!client)
          throw Error(
            "Saving needs your cockpit sign-in. The preview still works.",
          );
        return requestDriveImport(client, key, link);
      },
      readDriveImports: () => {
        if (!client)
          throw Error("Sign in to the cockpit to read the Drive imports.");
        return readDriveImports(client, key);
      },
    }),
    [client, key, auth.name, deck],
  );

  // The kickoff on the onboarding deck's last slide (O8) reads and notes
  // through the same gated calls as the kickoff window. Rehearsal is
  // Typeform's sandbox, for admins and the CEO only, as there.
  const rehearse =
    new URLSearchParams(search).get("rehearse") === "1" &&
    (auth.isAdmin || auth.isCeo);
  const kickoff = useMemo<KickoffPort>(() => {
    const name = auth.name.trim();
    return {
      reads: formReads(client, key, "kickoff"),
      me: {
        email: auth.email,
        firstName:
          name && !name.includes("@") ? (name.split(/\s+/)[0] ?? null) : null,
      },
      rehearse,
      embed: loadTypeform,
    };
  }, [client, key, auth.email, auth.name, rehearse]);

  if (
    deck !== "onboarding" &&
    deck !== "launch" &&
    deck !== "blueprint" &&
    !isOfferDeck(deck)
  )
    return <Navigate to={`/clients/${encodeURIComponent(key)}`} replace />;

  return (
    <PresentApp
      key={`${key}:${deck}:${view}`}
      taskId={key}
      deck={deck}
      view={view}
      io={io}
      report={report}
      urls={presentUrls(
        key,
        deck,
        lang,
        new URLSearchParams(search).get("rehearse") === "1",
      )}
      // The booking button books through CSM-gated calls: the Blueprint
      // opens the launch booking page in its own window instead (SPEC 0.1).
      book={
        deck === "blueprint" || isOfferDeck(deck)
          ? undefined
          : (d, kind, label, onBooked, opts) => (
              <BookCallButton
                taskId={d.taskId}
                clientName={d.nameEn}
                stage={d.stage ?? undefined}
                kind={kind}
                variant={opts?.variant ?? "outline"}
                defaultOpen={opts?.autoOpen}
                onAutoOpenConsumed={opts?.onAutoOpenConsumed}
                onBooked={r => onBooked(r.startTime)}
              >
                {label}
              </BookCallButton>
            )
      }
      kickoff={deck === "onboarding" ? kickoff : undefined}
      uploadLogo={async file => {
        if (!client)
          throw Error(
            "Saving needs your cockpit sign-in. The preview still works.",
          );
        const refused = uploadRefusal(file);
        if (refused) throw Error(refused);
        if (!file.type.startsWith("image/"))
          throw Error(
            `${file.name} is a video. A logo is a picture (JPG, PNG, WebP).`,
          );
        const facts = await readFileFacts(file);
        await uploadLaunchAd(client, {
          taskId: key,
          file,
          kind: "logo",
          facts,
        });
      }}
    />
  );
}
