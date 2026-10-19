import { useMemo } from "react";
import { Navigate, useLocation, useParams } from "react-router";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { BookCallButton } from "@/components/ClientCheckIn";
import { loadDeck } from "./load";
import { PresentApp, type PresentUrls, type View } from "./PresentApp";
import {
  type DeckKind,
  readFileFacts,
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

/** The app's base path; read when used (tests run without Vite's env). */
const base = () =>
  (import.meta.env?.BASE_URL ?? "/client-success/").replace(/\/$/, "");

export function presentUrls(
  key: string,
  deck: DeckKind,
  lang?: string,
): PresentUrls {
  const k = encodeURIComponent(key);
  const q = lang ? `?lang=${lang}` : "";
  const other: DeckKind = deck === "onboarding" ? "launch" : "onboarding";
  return {
    deck: `${base()}/clients/${k}/present/${deck}${q}`,
    notes: `${base()}/clients/${k}/present/${deck}/notes${q}`,
    prep: `${base()}/clients/${k}/present/${deck}?view=prep`,
    client: `${base()}/clients/${k}?tab=onboarding`,
    other: `${base()}/clients/${k}/present/${other}?view=prep`,
  };
}

export default function PresentPage({ notes = false }: { notes?: boolean }) {
  const { key = "", deck = "" } = useParams();
  const { search } = useLocation();
  const auth = useCockpitAuth();
  const client = auth.client;
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
        return loadDeck(client, key);
      },
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
    }),
    [client, key, auth.name],
  );

  if (deck !== "onboarding" && deck !== "launch")
    return <Navigate to={`/clients/${encodeURIComponent(key)}`} replace />;

  return (
    <PresentApp
      key={`${key}:${deck}:${view}`}
      taskId={key}
      deck={deck}
      view={view}
      io={io}
      urls={presentUrls(key, deck, lang)}
      book={(d, kind, label, onBooked) => (
        <BookCallButton
          taskId={d.taskId}
          clientName={d.nameEn}
          stage={d.stage ?? undefined}
          kind={kind}
          variant="outline"
          onBooked={r => onBooked(r.startTime)}
        >
          {label}
        </BookCallButton>
      )}
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
