import { phoneFor } from "./creative";
import type { PhoneKey } from "./launchData";
import { readFileFacts } from "./sources";
import { type AddResult, addFile, remapPhones } from "./uploads";
import type { DeckIO, DeckModel } from "./useDeckModel";

/**
 * Adding files to the ads tray from any window (the notes window's "Add a
 * file", a file dropped on a phone in the deck, the prep view): the file
 * goes on a phone at once, for every window, and the save runs behind it.
 * When it is saved, the phones point at the saved copy and every window
 * reads the tray again.
 */
export function makeAddFiles(
  model: Pick<DeckModel, "emit" | "setLive" | "reload" | "hub">,
  io: Pick<DeckIO, "uploadAd" | "fileFacts">,
  /** The phone in focus on the ads slide, when the deck is there. */
  focusPhone: () => PhoneKey | null,
  onResult?: (r: AddResult & { name: string }) => void,
) {
  return async (
    files: File[],
    phone?: PhoneKey | null,
    kind: "starter" | "custom" = "custom",
  ) => {
    for (const file of files) {
      const r = await addFile(
        file,
        { kind, phone },
        {
          facts: io.fileFacts ?? readFileFacts,
          save: io.uploadAd
            ? a => io.uploadAd?.(a) as Promise<never>
            : () =>
                Promise.reject(
                  Error(
                    "Saving needs your cockpit sign-in. The preview still works.",
                  ),
                ),
          emit: m => {
            model.emit(m);
            if (m.type !== "file") return;
            const f = m.file;
            const target =
              f.phone ??
              focusPhone() ??
              phoneFor({
                ratio: f.width && f.height ? f.width / f.height : null,
                placement: null,
              });
            model.setLive(l => ({
              ...l,
              phones: { ...(l.phones ?? {}), [target]: f.id },
              selected: f.id,
              undo: { phones: l.phones ?? {}, at: Date.now() },
            }));
          },
        },
      );
      if (r.phase === "saved" && r.saved && r.id) {
        const from = r.id;
        const to = r.saved.id;
        model.setLive(l => ({
          ...l,
          phones: remapPhones(l.phones ?? {}, from, to),
          selected: l.selected === from ? to : l.selected,
        }));
        await model.reload();
        model.hub.post({ type: "ads" });
      }
      onResult?.({ ...r, name: file.name });
    }
  };
}
