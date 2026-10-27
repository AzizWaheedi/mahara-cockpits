import { allOfferLoaded, ALL_CATALOG } from "./offer/allFixtures";
import { deckOfOffer, isOfferKey } from "../present/offer/kinds";
import { useMemo } from "react";
import { createRoot } from "react-dom/client";
import { OfferHotRow } from "../pages/money/offers/OfferHotRow";
import { OffersTab } from "../pages/money/offers/OffersTab";
import { OfferPicker } from "../present/offer/OfferPicker";
import type { OfferClient, Pitch, UpsellFile } from "../present/offer/sources";
import { PresentApp, type View } from "../present/PresentApp";
import { applyPatch } from "../present/prep";
import type { DeckIO } from "../present/useDeckModel";
import {
  fixturePitch,
  OFFER_FIXTURES,
  OFFER_NOW,
  type OfferFixture,
  offerStatus,
} from "./offer/fixtures";
import "../index.css";

const harnessCalls: string[] = [];
Object.assign(window, { offerHarnessCalls: harnessCalls });
const params = new URLSearchParams(location.search);
const asked = params.get("fixture");
const fixture: OfferFixture = OFFER_FIXTURES.includes(asked as OfferFixture)
  ? (asked as OfferFixture)
  : "full";
const selectedOffer = isOfferKey(params.get("offer"))
  ? (params.get("offer") as keyof typeof ALL_CATALOG)
  : "website";
const selectedDeck = deckOfOffer(selectedOffer);
function App() {
  const client = useMemo(() => {
    let row = structuredClone(ALL_CATALOG[selectedOffer]);
    const settings = {
      whatsappNumber: null as string | null,
      validDays: 30,
      doorLive: false,
    };
    return {
      rpc: async (name: string, args: Record<string, unknown>) => {
        harnessCalls.push(name);
        if (name === "cockpit_upsell_catalog_read")
          return {
            data: {
              rows: Object.values(ALL_CATALOG).map(v =>
                v.offerKey === selectedOffer ? row : v,
              ),
              settings,
              videos: [],
              isCeo: params.get("role") === "ceo",
              at: "2026-10-26",
            },
            error: null,
          };
        if (name === "cockpit_csm_deck_videos_read")
          return { data: { rows: [], slots: [] }, error: null };
        if (name === "cockpit_upsell_pitch_log")
          return { data: { month: args.p_month, rows: [] }, error: null };
        if (name === "cockpit_upsell_catalog_set") {
          if (params.get("role") !== "ceo")
            return {
              data: null,
              error: { message: "Only the CEO changes the price list." },
            };
          const patch = args.p_patch as {
            parts: Array<{ key: string; amount: number | null }>;
            locked?: boolean;
          };
          row = {
            ...row,
            parts: row.parts.map(p => ({
              ...p,
              amount: patch.parts.find(v => v.key === p.key)?.amount ?? null,
            })),
            locked: patch.locked ?? row.locked,
            revision: row.revision + 1,
          };
          return { data: row, error: null };
        }
        if (name === "cockpit_upsell_setting_set") {
          if (args.p_key === "whatsapp_number")
            settings.whatsappNumber = String(args.p_value);
          if (args.p_key === "valid_days")
            settings.validDays = Number(args.p_value);
          return { data: {}, error: null };
        }
        return {
          data: null,
          error: {
            message: "That operation is unavailable in the fictional harness.",
          },
        };
      },
      functions: {
        invoke: async () => ({
          data: null,
          error: {
            message: "External checks are disabled in this fictional harness.",
          },
        }),
      },
    } as unknown as OfferClient;
  }, []);
  const io = useMemo<DeckIO>(() => {
    const loaded = allOfferLoaded(selectedOffer, fixture);
    let revision = 1,
      pitch: Pitch | null = null;
    return {
      load: async () => structuredClone(loaded),
      now: () => new Date("2026-10-26T10:00:00Z"),
      presenterName: "Example account manager",
      savePrep: async (deck, patch) => {
        loaded.prep[deck] = applyPatch(loaded.prep[deck] ?? {}, patch);
        loaded.offer!.prep!.overrides = loaded.prep[selectedDeck]!;
        if (patch.client_asked) {
          loaded.offer!.mode = "client_asked";
          loaded.offer!.catalog = allOfferLoaded(selectedOffer, "full")
            .offer!.catalog;
        }
        return {
          deck,
          overrides: loaded.prep[deck]!,
          revision: ++revision,
          updatedAt: new Date().toISOString(),
          updatedBy: "fixture@example.test",
          changed: true,
        };
      },
      offer: {
        savePitch: async (id, patch) => {
          pitch = fixturePitch(id, patch, pitch, loaded);
          loaded.offer!.pitches = [pitch];
          return pitch;
        },
        pitchVideo: async () => ({
          url: null,
          counted: false,
          note: "No external video is loaded in this fictional harness.",
        }),
        siteCheck: async () => ({}),
        markWin: async () => ({}),
        upload: async (file, on, searchedAs) => {
          const image = await createImageBitmap(file);
          const f: UpsellFile = {
            id: crypto.randomUUID(),
            kind: "capture",
            mime: file.type,
            bytes: file.size,
            width: image.width,
            height: image.height,
            fileName: file.name || "Capture",
            caption: null,
            createdAt: OFFER_NOW,
            path: `fixture/${crypto.randomUUID()}`,
            url: URL.createObjectURL(file),
            capturedOn: on,
            searchedAs: searchedAs || null,
          };
          image.close();
          loaded.offer!.files.push(f);
          return f;
        },
        updateFile: async (id, patch) => {
          const f = loaded.offer!.files.find(v => v.id === id);
          if (f && typeof patch.caption === "string") f.caption = patch.caption;
        },
        removeFile: async id => {
          loaded.offer!.files = loaded.offer!.files.filter(f => f.id !== id);
        },
        findLogos: async () => ({ candidates: [] }),
        pickLogo: async () => {
          throw Error("No logo changes in this harness.");
        },
      },
    };
  }, []);
  const url = (view: View) => {
    const p = new URLSearchParams(params);
    p.set("view", view);
    return `${location.pathname}?${p}`;
  };
  const view = params.get("view");
  if (view === "picker")
    return (
      <main className="mx-auto max-w-xl p-8">
        <p className="mb-4 text-xs text-muted-foreground">
          Fictional client. No external writes.
        </p>
        <OfferPicker
          taskId="fictional"
          status={offerStatus(fixture)}
          client={null}
        />
      </main>
    );
  if (view === "hotrow")
    return (
      <main className="mx-auto max-w-xl p-8">
        <OfferHotRow
          c={{ taskId: "fictional" }}
          status={offerStatus(fixture)}
          client={null}
        />
      </main>
    );
  if (view === "offers")
    return (
      <main className="mx-auto max-w-5xl p-8">
        <p className="mb-4 text-xs text-muted-foreground">
          Fictional catalogue. Changes remain in this tab.
        </p>
        <OffersTab client={client} />
      </main>
    );
  return (
    <PresentApp
      taskId={`offer-fixture-${selectedOffer}-${fixture}`}
      deck={selectedDeck}
      view={(params.get("view") ?? "present") as View}
      io={io}
      urls={{
        deck: url("present"),
        notes: url("notes"),
        prep: url("prep"),
        client: url("prep"),
        other: url("prep"),
      }}
    />
  );
}
createRoot(document.getElementById("root")!).render(<App />);
