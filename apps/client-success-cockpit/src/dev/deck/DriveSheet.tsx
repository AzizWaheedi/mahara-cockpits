/**
 * Every state of the Drive box on one page, in one language, for the shots
 * (present-harness.html?view=drive&lang=en|ar): the scenarios of
 * driveFixtures.ts as the read gives them, the typed and pasted refusals,
 * the over-ten line, and the box while it checks. Nothing is sent.
 */

import type { Lang } from "@/present/content";
import { DriveBox } from "@/present/DriveBox";
import { DRIVE_REFUSED, DRIVE_UI } from "@/present/driveCopy";
import type { DriveBoxState, DriveRefusal } from "@/present/useDriveImports";
import {
  DRIVE_SCENARIOS,
  type DriveScenario,
  driveScenario,
  HARNESS_NOW,
} from "./driveFixtures";

/** The harness's clock (19 October, 09:00), as prep reads it. */
const NOW = HARNESS_NOW;

function box(
  lang: Lang,
  s: DriveScenario | null,
  extra: Partial<DriveBoxState> = {},
): DriveBoxState {
  const read =
    s && s !== "readfail" && s !== "notlive"
      ? { ...driveScenario(s, NOW), at: new Date(NOW).toISOString() }
      : null;
  return {
    enabled: true,
    lang,
    read,
    readProblem: s === "readfail" ? "No connection" : null,
    notLive: s === "notlive",
    sending: false,
    send: async () => ({ sent: 0, refused: [] }),
    ...extra,
  };
}

const refused = (
  link: string,
  code: keyof typeof DRIVE_REFUSED,
): DriveRefusal => ({
  link,
  code,
  message: DRIVE_REFUSED[code].en,
  aboutLink: code.startsWith("link_"),
});

export function DriveSheet({ lang }: { lang: Lang }) {
  const cards: Array<{
    name: string;
    box: DriveBoxState;
    initial?: Parameters<typeof DriveBox>[0]["initial"];
  }> = [
    ...DRIVE_SCENARIOS.map(s => ({ name: s, box: box(lang, s) })),
    {
      name: "typed, refused",
      box: box(lang, "idle"),
      initial: {
        text: "https://docs.google.com/document/d/1AbCdEfGhIjK/edit",
        touched: true,
      },
    },
    {
      name: "pasted, some refused",
      box: box(lang, "queued"),
      initial: {
        text: "https://drive.google.com/drive/my-drive https://www.instagram.com/p/C0abc",
        refused: [
          refused("https://drive.google.com/drive/my-drive", "link_page"),
          refused("https://www.instagram.com/p/C0abc", "link_bad"),
        ],
        over: 2,
      },
    },
    {
      name: "server refused",
      box: box(lang, "several"),
      initial: {
        text: "https://drive.google.com/drive/folders/1NeWfOlDeRaFtErTeN26",
        refused: [
          refused(
            "https://drive.google.com/drive/folders/1NeWfOlDeRaFtErTeN26",
            "too_many_open",
          ),
        ],
      },
    },
    {
      name: "checking",
      box: box(lang, "idle", { sending: true }),
      initial: {
        text: "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMn",
      },
    },
  ];
  return (
    <div
      className="min-h-screen bg-background p-6 text-foreground"
      data-drive-sheet
    >
      <h1 className="mb-4 text-sm font-semibold">
        {DRIVE_UI.title[lang]} · {lang}
      </h1>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(348px,1fr))] items-start gap-4">
        {cards.map(c => (
          <section
            key={c.name}
            data-drive-card={c.name}
            className="space-y-2 rounded-xl border p-4"
          >
            <h2 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {c.name}
            </h2>
            <DriveBox
              box={c.box}
              initial={c.initial}
              now={() => new Date(NOW)}
            />
          </section>
        ))}
      </div>
    </div>
  );
}
