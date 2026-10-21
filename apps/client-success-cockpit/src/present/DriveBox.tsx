import { Check, CloudDownload, X } from "lucide-react";
import {
  type ClipboardEvent,
  type FormEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Lang } from "./content";
import { DRIVE_REFUSED, DRIVE_UI, num } from "./driveCopy";
import {
  parseDriveLink,
  shortLink,
  splitDriveLinks,
  typedDriveLinks,
} from "./driveLink";
import {
  boxView,
  type FileRow,
  type ImportBlock,
  type Line,
  readFailedLine,
  refusalText,
  type Tone,
} from "./driveView";
import type { DriveBoxState, DriveRefusal } from "./useDriveImports";

/**
 * "Bring in from Drive" (DESIGN 22.7): the first block of the ads panel, in
 * prep and in the notes window, never on the canvas. The CSM pastes a link,
 * or a whole WhatsApp message with several, and it goes with no click; the
 * files then arrive in the tray as uploads do. Typed text uses the button.
 */

const TONE: Record<Tone, string> = {
  muted: "text-muted-foreground",
  warn: "txt-warn",
  good: "txt-good",
  plain: "text-foreground",
};

function Said({ line, className }: { line: Line; className?: string }) {
  return <div className={cn(TONE[line.tone], className)}>{line.text}</div>;
}

/** Each refused link on its own line: the link cut in the middle, then why. */
function refusedLines(refused: DriveRefusal[], lang: DriveBoxState["lang"]) {
  const lines: Array<{ link: string; short: string; text: string }> = [];
  const general: string[] = [];
  for (const r of refused) {
    const text = refusalText(r.code, r.message, lang);
    if (r.aboutLink)
      lines.push({ link: r.link, short: shortLink(r.link, 40), text });
    else if (!general.includes(text)) general.push(text);
  }
  return { lines, general };
}

const ISOLATES = /[\u2066-\u2069]/g;

/**
 * A file that didn't come in: its sentence, with the name inside it as the
 * link to the file in Drive, so the name is said once. A sentence without
 * the name (a full tray) keeps the name's row above it.
 */
function FailedFile({ f }: { f: FileRow }) {
  const text = f.state.text;
  const at = text.indexOf(f.name);
  const link = (label: string) => (
    <a
      href={f.href}
      target="_blank"
      rel="noreferrer"
      title={f.name}
      dir="auto"
      className="break-all font-semibold underline-offset-2 hover:underline"
    >
      {label}
    </a>
  );
  if (at < 0)
    return (
      <>
        <div className="truncate">{link(f.short)}</div>
        <Said line={f.state} className="mt-0.5" />
      </>
    );
  return (
    <div className="txt-warn">
      {text.slice(0, at).replace(ISOLATES, "")}
      {link(f.name)}
      {text.slice(at + f.name.length).replace(ISOLATES, "")}
    </div>
  );
}

/**
 * One import: its link, its line, and a row per file. A finished import
 * keeps only the rows that need the CSM (a file that didn't come in), with
 * the rest behind "Show the list ({n})", so a 20-file import never pushes the
 * panel's other controls out of the window; an open one shows every row.
 */
function ImportRows({ b, lang }: { b: ImportBlock; lang: Lang }) {
  const [all, setAll] = useState(false);
  const attention = b.files.filter(f => f.state.tone === "warn");
  const folded = !b.open && !all && b.files.length > attention.length;
  const files = folded ? attention : b.files;
  return (
    <li
      className="space-y-1.5 rounded-lg border bg-background/60 p-2.5"
      data-drive-import={b.state}
    >
      <a
        href={b.link}
        target="_blank"
        rel="noreferrer"
        title={b.link}
        dir="ltr"
        className="block truncate text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        {b.short}
      </a>
      <Said line={b.line} className="text-xs font-medium" />
      {b.share !== null ? (
        <div
          aria-hidden
          className="h-0.5 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full origin-left rounded-full bg-primary transition-transform duration-500 ease-out motion-reduce:transition-none rtl:origin-right"
            style={{ transform: `scaleX(${Math.max(0.04, b.share)})` }}
          />
        </div>
      ) : null}
      {files.length ? (
        <ul className="space-y-1">
          {files.map(f => (
            <li key={f.id} className="text-xs" data-drive-file={f.state.tone}>
              {f.state.tone === "warn" ? (
                <FailedFile f={f} />
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <a
                    href={f.href}
                    target="_blank"
                    rel="noreferrer"
                    title={f.name}
                    dir="auto"
                    className="min-w-0 truncate underline-offset-2 hover:underline"
                  >
                    {f.short}
                  </a>
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1",
                      TONE[f.state.tone],
                    )}
                  >
                    {f.state.tone === "good" ? (
                      <Check aria-hidden className="size-3" />
                    ) : null}
                    {f.state.text}
                  </span>
                </div>
              )}
              {f.note ? (
                <div className="mt-0.5 text-muted-foreground">{f.note}</div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {b.extra ? <Said line={b.extra} className="text-xs" /> : null}
      {!b.open && b.files.length > attention.length ? (
        <button
          type="button"
          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          aria-expanded={!folded}
          onClick={() => setAll(v => !v)}
        >
          {folded
            ? DRIVE_UI.showList[lang].replace("{n}", num(b.files.length, lang))
            : DRIVE_UI.hideList[lang]}
        </button>
      ) : null}
    </li>
  );
}

export function DriveBox({
  box,
  now = () => new Date(),
  initial,
}: {
  box: DriveBoxState;
  /** The CSM's clock, for "last ran 13:02" (a test hands in its own). */
  now?: () => Date;
  /** Open the box in a state (the harness's sheet of states). */
  initial?: {
    text?: string;
    touched?: boolean;
    refused?: DriveRefusal[];
    over?: number;
  };
}) {
  const lang = box.lang;
  const id = useId();
  const [text, setText] = useState(initial?.text ?? "");
  /** The field was left or pasted into: typed refusals show from now on. */
  const [touched, setTouched] = useState(initial?.touched ?? false);
  const [refused, setRefused] = useState<DriveRefusal[]>(
    initial?.refused ?? [],
  );
  const [over, setOver] = useState(initial?.over ?? 0);
  /** Links left out of a paste whose other links started: a muted note. */
  const [skipped, setSkipped] = useState<DriveRefusal[]>([]);
  const [started, setStarted] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const typed = typedDriveLinks(text);
  const parses = typed.links.some(l => parseDriveLink(l).ok);
  const typedRefusals =
    touched && text.trim() && !parses
      ? typed.links.map(l => {
          const p = parseDriveLink(l);
          const code = p.ok ? "link_bad" : p.code;
          return {
            link: l,
            code,
            message: DRIVE_REFUSED[code].en,
            aboutLink: true,
          };
        })
      : [];
  const shown = refusedLines(
    typedRefusals.length ? typedRefusals : refused,
    lang,
  );
  const invalid = shown.lines.length > 0;
  const off = !parses || box.sending || box.notLive;

  async function go(links: string[], extra: number) {
    setTouched(false);
    setRefused([]);
    setSkipped([]);
    setOver(extra);
    // What is being checked stays in sight while it goes.
    setText(links.join(" "));
    const r = await box.send(links);
    if (r.sent) {
      // At least one link started, so the paste worked: the field is
      // cleared, and a link left out (a Docs link in a WhatsApp message) is
      // a muted note under the box, never a red field beside "Started".
      setText("");
      setSkipped(r.refused);
    } else {
      // Nothing went: the field keeps what didn't, so it can be fixed.
      setRefused(r.refused);
      setText(r.refused.map(x => x.link).join(" "));
    }
    if (r.sent) {
      setStarted(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setStarted(false), 2000);
    }
  }

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    if (box.sending || box.notLive) return;
    // Read before a one-line field flattens the paste's new lines.
    const pasted = e.clipboardData.getData("text/plain");
    const split = splitDriveLinks(pasted);
    if (!split.links.some(l => parseDriveLink(l).ok)) {
      // Nothing to send: the browser's own paste, then the refusal at once.
      setRefused([]);
      setTouched(true);
      return;
    }
    e.preventDefault();
    void go(split.links, split.extra);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (off) {
      setTouched(true);
      return;
    }
    void go(typed.links, typed.extra);
  };

  const view = boxView(box.read, lang, now());
  const status: Line | null = box.notLive
    ? { text: DRIVE_UI.notLive[lang], tone: "muted" }
    : box.readProblem
      ? { text: readFailedLine(box.readProblem, lang), tone: "warn" }
      : null;
  const help = `${id}-help`;

  return (
    <div className="space-y-2.5" dir={lang === "ar" ? "rtl" : "ltr"}>
      <form className="space-y-1.5" onSubmit={onSubmit} noValidate>
        <label
          htmlFor={`${id}-link`}
          className="block text-xs font-medium text-muted-foreground"
        >
          {DRIVE_UI.label[lang]}
        </label>
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <input
              id={`${id}-link`}
              type="text"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              dir="ltr"
              value={text}
              readOnly={box.sending}
              disabled={box.notLive}
              aria-invalid={invalid || undefined}
              aria-describedby={help}
              placeholder="drive.google.com/…"
              onChange={e => {
                setText(e.target.value);
                setRefused([]);
                setSkipped([]);
                setOver(0);
              }}
              onBlur={() => text.trim() && setTouched(true)}
              onPaste={onPaste}
              className={cn(
                "h-8 w-full min-w-0 rounded-lg border bg-background px-2.5 text-sm outline-none placeholder:text-muted-foreground/60 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-55",
                invalid && "pe-8",
              )}
              // One colour for one error: the field's edge is the message's.
              style={
                invalid
                  ? {
                      borderColor:
                        "color-mix(in oklch, var(--warning) 85%, var(--foreground))",
                    }
                  : undefined
              }
            />
            {invalid && !box.sending ? (
              <button
                type="button"
                aria-label={DRIVE_UI.clear[lang]}
                className="absolute inset-y-0 end-1 my-auto grid size-6 place-items-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
                onClick={() => {
                  setText("");
                  setRefused([]);
                  setTouched(false);
                  setOver(0);
                }}
              >
                <X aria-hidden className="size-3.5" />
              </button>
            ) : null}
          </div>
          <Button
            type="submit"
            size="sm"
            disabled={off}
            aria-disabled={off || undefined}
            className="w-[6.75rem] shrink-0"
          >
            {started && !box.sending ? (
              <Check aria-hidden />
            ) : (
              <CloudDownload aria-hidden />
            )}
            {box.sending
              ? DRIVE_UI.checking[lang]
              : started
                ? DRIVE_UI.started[lang]
                : DRIVE_UI.button[lang]}
          </Button>
        </div>
        <div id={help} className="min-h-[1lh] space-y-0.5 text-xs">
          {invalid ? (
            shown.lines.map(l => (
              <div key={l.link} className="txt-warn break-words">
                <bdi dir="ltr" title={l.link}>
                  {l.short}
                </bdi>
                : {l.text}
              </div>
            ))
          ) : (
            <div className="text-muted-foreground">{DRIVE_UI.hint[lang]}</div>
          )}
          {shown.general.map(g => (
            <div key={g} className="txt-warn">
              {g}
            </div>
          ))}
          {/* Each link left out on its own row, 6 px under the hint, its
              "Skipped" and the link in medium weight (score round 2: run on
              in one grey, "two started, one skipped" was not seen at a
              glance). Still muted, never the warning tone. */}
          {refusedLines(skipped, lang).lines.map(l => (
            <div
              key={l.link}
              className="!mt-1.5 break-words text-muted-foreground"
              data-drive-skipped=""
            >
              <span className="font-medium">
                {DRIVE_UI.skipped[lang]}{" "}
                <bdi dir="ltr" title={l.link}>
                  {l.short}
                </bdi>
              </span>
              : {l.text}
            </div>
          ))}
          {over > 0 ? (
            <div className="txt-warn">{DRIVE_UI.overTen[lang]}</div>
          ) : null}
        </div>
      </form>
      <div role="status" aria-live="polite" className="space-y-2 text-xs">
        {status ? <Said line={status} /> : null}
        {view.head ? (
          <div className="font-medium text-foreground">{view.head}</div>
        ) : null}
        {view.blocks.length ? (
          <ul className="space-y-2">
            {view.blocks.map(b => (
              <ImportRows key={b.id} b={b} lang={lang} />
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
