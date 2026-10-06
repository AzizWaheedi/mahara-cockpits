import "./richDoc.css";
import { type EditorOptions, Extension } from "@tiptap/core";
import { Highlight } from "@tiptap/extension-highlight";
import { Image } from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { TextAlign } from "@tiptap/extension-text-align";
import {
  BackgroundColor,
  Color,
  FontSize,
  TextStyle,
} from "@tiptap/extension-text-style";
import { Placeholder } from "@tiptap/extensions";
import {
  type Editor,
  EditorContent,
  useEditor,
  useEditorState,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { api, useAction } from "@/lib/cockpitApi";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowUpRight,
  Baseline,
  Bold,
  ChevronDown,
  Highlighter,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Maximize2,
  Minimize2,
  Minus,
  Pencil,
  Plus,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Table2,
  Underline,
  Undo2,
  Unlink,
} from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  docHtml,
  docText,
  PICTURE_BUCKET,
  PICTURE_MAX_BYTES,
  PICTURE_PATH,
  PICTURE_TYPES,
} from "@/lib/teamDoc";
import { cleanPasted, sameColour } from "./pasteClean";
import { errorText, type SaveResult, shortName, when } from "./teamKit";

/**
 * The meeting's doc, written like a Google Doc (the CEO, 2026-09-30:
 * "bullet points, sizes, headings ... copy and paste images"): text styles
 * and sizes, bold to strikethrough, colour and highlight, bulleted,
 * numbered and checklist lists, links, tables, alignment, and pictures
 * pasted, dropped or picked straight in. Everyone on the team edits it. It
 * saves by itself a moment after typing stops and never overwrites a newer
 * version somebody else saved in between: both are on screen and the
 * person chooses (the rule SharedText keeps for the notes).
 *
 * The doc is HTML; one written as plain text before opens converted
 * (lib/teamDoc.ts). A picture goes to the private team-docs bucket before
 * the doc keeps it (the native picture endpoint); one pasted as a web address is
 * copied in. The outline beside the page lists the doc's headings, the one
 * in view lit like the rail's active row.
 */

type Props = {
  meetingId: string;
  value: string;
  version: number;
  savedBy: string | null;
  savedAt: string | null;
  onSave: (html: string, version: number) => Promise<SaveResult>;
};

type Theirs = {
  text: string;
  by: string | null;
  at: string | null;
  version: number;
};

type Picture = { path: string; url: string };

/** What the toolbar and the outline read from the editor. */
type Ui = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  block: "h1" | "h2" | "h3" | "quote" | "p";
  bullet: boolean;
  ordered: boolean;
  task: boolean;
  link: boolean;
  href: string | null;
  color: string | null;
  fontSize: string | null;
  mark: string | null;
  align: "left" | "center" | "right" | "justify";
  table: boolean;
  canUndo: boolean;
  canRedo: boolean;
  canSink: boolean;
  canLift: boolean;
  empty: boolean;
  from: number;
  outline: { level: number; text: string; pos: number }[];
};

const PLACEHOLDER =
  "Start writing. Paste from a Google Doc, or paste a screenshot straight in.";

const SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48];

/** Text colours that read on the dark page and the light one. */
const TEXT_COLOURS = [
  { name: "Teal", value: "#00CFC8" },
  { name: "Blue", value: "#60A5FA" },
  { name: "Purple", value: "#A78BFA" },
  { name: "Red", value: "#F87171" },
  { name: "Orange", value: "#FB923C" },
  { name: "Green", value: "#34D399" },
  { name: "Grey", value: "#94A3B8" },
];

/** Highlights, see-through so the words stay readable on either page. */
const MARKS = [
  { name: "Teal", value: "rgba(0, 207, 200, 0.28)" },
  { name: "Blue", value: "rgba(96, 165, 250, 0.3)" },
  { name: "Purple", value: "rgba(167, 139, 250, 0.32)" },
  { name: "Red", value: "rgba(248, 113, 113, 0.32)" },
  { name: "Orange", value: "rgba(251, 146, 60, 0.32)" },
  { name: "Green", value: "rgba(52, 211, 153, 0.3)" },
  { name: "Yellow", value: "rgba(250, 204, 21, 0.38)" },
];

/** A picture in the doc keeps its bucket path; the page signs a link for it. */
const DocImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      path: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-path"),
        renderHTML: (attrs: { path?: string | null }) =>
          attrs.path ? { "data-path": attrs.path } : {},
      },
      // Set while the picture is on its way to the bucket; never saved.
      uploading: { default: null, rendered: false },
    };
  },
});

function hasWords(html: string): boolean {
  return Boolean(
    html
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .trim(),
  );
}

/** Our own signed picture link, read back to its bucket path. */
function pathOfSigned(src: string): string | null {
  const m = src.match(
    new RegExp(`/storage/v1/object/sign/${PICTURE_BUCKET}/([^?]+)\\?token=`),
  );
  const path = m ? decodeURIComponent(m[1]) : null;
  return path && PICTURE_PATH.test(path) ? path : null;
}

function htmlOf(e: Editor): string {
  return e.isEmpty ? "" : e.getHTML();
}

function key(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function outlineOf(e: Editor): { level: number; text: string; pos: number }[] {
  const out: { level: number; text: string; pos: number }[] = [];
  e.state.doc.forEach((node, offset) => {
    if (node.type.name === "heading")
      out.push({
        level: Number(node.attrs.level ?? 1),
        text: node.textContent.trim(),
        pos: offset,
      });
  });
  return out;
}

// --- the doc ----------------------------------------------------------------------------

export default function RichDoc({
  meetingId,
  value,
  version,
  savedBy,
  savedAt,
  onSave,
}: Props) {
  const upload = useAction(api.teamPictures.upload);
  const ready = useAction(api.teamPictures.ready);
  const fromUrl = useAction(api.teamPictures.fromUrl);

  const [state, setState] = useState<"idle" | "dirty" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [theirs, setTheirs] = useState<Theirs | null>(null);
  const [uploads, setUploads] = useState(0);
  const [full, setFull] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // Re-renders the link card in place while the page scrolls under it.
  const [, setScrolled] = useState(0);
  const cardWanted = useRef(false);

  const base = useRef(version);
  const latest = useRef(docHtml(value));
  const inFlight = useRef(false);
  const blocked = useRef(false);
  const pending = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tried = useRef(new Set<string>());
  const stateRef = useRef(state);
  stateRef.current = state;
  const saveRef = useRef<() => Promise<void>>(async () => {});
  const filesRef = useRef<(files: File[], at: number | null) => void>(() => {});
  const adoptRef = useRef<() => void>(() => {});
  const openLinkRef = useRef<() => void>(() => {});

  function schedule() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveRef.current(), 1500);
  }

  // Made once: the editor reads its handlers through refs, so a new options
  // object each render would only make it reconfigure itself on every key.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refs and setters, read when called
  const options = useMemo<Partial<EditorOptions>>(
    () => ({
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          link: {
            openOnClick: false,
            autolink: true,
            linkOnPaste: true,
            defaultProtocol: "https",
            HTMLAttributes: {
              target: "_blank",
              rel: "noopener noreferrer nofollow",
            },
          },
          dropcursor: { width: 2, color: "var(--primary)" },
        }),
        TextStyle,
        Color,
        FontSize,
        BackgroundColor,
        Highlight.configure({ multicolor: true }),
        TextAlign.configure({ types: ["heading", "paragraph"] }),
        TaskList,
        TaskItem.configure({ nested: true }),
        TableKit.configure({ table: { resizable: true } }),
        DocImage.configure({
          allowBase64: true,
          resize: {
            enabled: true,
            alwaysPreserveAspectRatio: true,
            minWidth: 64,
            directions: [
              "top-left",
              "top-right",
              "bottom-left",
              "bottom-right",
            ],
          },
        }),
        Placeholder.configure({ placeholder: PLACEHOLDER }),
        Extension.create({
          name: "docKeys",
          addKeyboardShortcuts: () => ({
            "Mod-k": () => {
              openLinkRef.current();
              return true;
            },
          }),
        }),
      ],
      content: latest.current,
      textDirection: "auto",
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: {
          class: "team-doc-body",
          "aria-label": "The meeting's doc",
        },
        transformPastedHTML: cleanPasted,
        handlePaste: (_view, event) => {
          const data = event.clipboardData;
          const files = [...(data?.files ?? [])].filter(f =>
            f.type.startsWith("image/"),
          );
          if (!data || !files.length) return false;
          // A copied picture comes with an <img> of itself and no words (a
          // file copied in Finder brings only its name as text); a passage,
          // or a table with a picture of itself, pastes as itself.
          const html = data.getData("text/html");
          if (html && hasWords(html)) return false;
          event.preventDefault();
          filesRef.current(files, null);
          return true;
        },
        handleDrop: (view, event, _slice, moved) => {
          if (moved) return false;
          const files = [...(event.dataTransfer?.files ?? [])].filter(f =>
            f.type.startsWith("image/"),
          );
          if (!files.length) return false;
          event.preventDefault();
          const at = view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          });
          filesRef.current(files, at?.pos ?? null);
          return true;
        },
        handleClick: (_view, _pos, event) => {
          // A link opens with Cmd or Ctrl held, or from the card under it.
          if (!(event.metaKey || event.ctrlKey)) return false;
          const a = (event.target as HTMLElement | null)?.closest("a[href]");
          if (!a) return false;
          window.open(a.getAttribute("href") ?? "", "_blank", "noopener");
          return true;
        },
      },
      onUpdate: ({ editor: e }) => {
        latest.current = htmlOf(e);
        setState("dirty");
        schedule();
        adoptRef.current();
      },
    }),
    [],
  );
  const editor = useEditor(options);

  const ui = useEditorState({
    editor,
    selector: ({ editor: e }): Ui | null => {
      if (!e) return null;
      const style = e.getAttributes("textStyle");
      return {
        bold: e.isActive("bold"),
        italic: e.isActive("italic"),
        underline: e.isActive("underline"),
        strike: e.isActive("strike"),
        block: e.isActive("heading", { level: 1 })
          ? "h1"
          : e.isActive("heading", { level: 2 })
            ? "h2"
            : e.isActive("heading", { level: 3 })
              ? "h3"
              : e.isActive("blockquote")
                ? "quote"
                : "p",
        bullet: e.isActive("bulletList"),
        ordered: e.isActive("orderedList"),
        task: e.isActive("taskList"),
        link: e.isActive("link"),
        href: (e.getAttributes("link").href as string | undefined) ?? null,
        color: (style.color as string | undefined) ?? null,
        fontSize: (style.fontSize as string | undefined) ?? null,
        mark:
          (style.backgroundColor as string | undefined) ??
          (e.getAttributes("highlight").color as string | undefined) ??
          null,
        align:
          (["center", "right", "justify"] as const).find(a =>
            e.isActive({ textAlign: a }),
          ) ?? "left",
        table: e.isActive("table"),
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
        canSink:
          e.can().sinkListItem("listItem") || e.can().sinkListItem("taskItem"),
        canLift:
          e.can().liftListItem("listItem") || e.can().liftListItem("taskItem"),
        empty: e.state.selection.empty,
        from: e.state.selection.from,
        outline: outlineOf(e),
      };
    },
  });

  // --- saving: the same rule as the notes ---------------------------------------------

  saveRef.current = async () => {
    if (inFlight.current || blocked.current || pending.current > 0) return;
    const content = latest.current;
    const from = base.current;
    inFlight.current = true;
    setState("saving");
    setError(null);
    try {
      const res = await onSave(content, from);
      if (res.ok) {
        base.current = from + 1;
        if (latest.current === content) setState("idle");
        else {
          setState("dirty");
          schedule();
        }
      } else {
        blocked.current = true;
        setTheirs(res.conflict);
        setState("dirty");
      }
    } catch (e) {
      setError(errorText(e));
      setState("dirty");
    } finally {
      inFlight.current = false;
    }
  };

  // A newer version from a refresh: taken when nothing here is unsaved,
  // otherwise shown beside the unsaved doc.
  useEffect(() => {
    if (!editor || inFlight.current || version <= base.current) return;
    if (state === "idle" && pending.current === 0) {
      base.current = version;
      const html = docHtml(value);
      latest.current = html;
      editor.commands.setContent(html, { emitUpdate: false });
    } else {
      blocked.current = true;
      setTheirs({ text: value, by: savedBy, at: savedAt, version });
    }
  }, [editor, value, version, savedBy, savedAt, state]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // --- pictures -----------------------------------------------------------------------

  const begin = (n = 1) => {
    pending.current += n;
    setUploads(pending.current);
  };
  const end = () => {
    pending.current = Math.max(0, pending.current - 1);
    setUploads(pending.current);
    if (!pending.current && stateRef.current === "dirty") schedule();
  };

  async function put(file: Blob, type: string): Promise<Picture> {
    const { path, uploadUrl } = (await upload({
      meetingId,
      contentType: type,
      bytes: file.size,
    })) as { path: string; uploadUrl: string };
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": type },
      body: file,
    });
    if (!res.ok)
      throw new Error(
        `The picture did not upload (${res.status}). Paste it again.`,
      );
    return (await ready({ meetingId, path })) as Picture;
  }

  /** The picture marked `id`: given its bucket link, or taken out. */
  function settle(id: string, attrs: Record<string, unknown> | null) {
    if (!editor || editor.isDestroyed) return;
    let found: { pos: number; size: number; attrs: Record<string, unknown> } = {
      pos: -1,
      size: 0,
      attrs: {},
    };
    editor.state.doc.descendants((node, pos) => {
      if (found.pos >= 0) return false;
      if (node.type.name === "image" && node.attrs.uploading === id) {
        found = { pos, size: node.nodeSize, attrs: node.attrs };
        return false;
      }
      return true;
    });
    if (found.pos < 0) return;
    const tr = editor.state.tr;
    if (attrs)
      tr.setNodeMarkup(found.pos, undefined, {
        ...found.attrs,
        ...attrs,
        uploading: null,
      });
    else tr.delete(found.pos, found.pos + found.size);
    tr.setMeta("addToHistory", false);
    editor.view.dispatch(tr);
  }

  filesRef.current = (files, at) => {
    if (!editor) return;
    const ok: { file: File; id: string; preview: string }[] = [];
    for (const f of files) {
      const type = f.type.toLowerCase();
      if (!PICTURE_TYPES[type]) {
        setError(
          `${f.name || "That file"} is not a picture the doc takes. Paste a PNG, JPEG, GIF or WebP.`,
        );
        continue;
      }
      if (f.size > PICTURE_MAX_BYTES) {
        setError(
          `${f.name || "That picture"} is over 10 MB. Paste a smaller one.`,
        );
        continue;
      }
      ok.push({ file: f, id: key(), preview: URL.createObjectURL(f) });
    }
    if (!ok.length) return;
    const nodes = ok.map(x => ({
      type: "image",
      attrs: { src: x.preview, uploading: x.id },
    }));
    begin(ok.length);
    const chain = editor.chain().focus();
    (at === null
      ? chain.insertContent(nodes)
      : chain.insertContentAt(at, nodes)
    ).run();
    for (const x of ok)
      put(x.file, x.file.type.toLowerCase())
        .then(p => settle(x.id, { src: p.url, path: p.path }))
        .catch(e => {
          settle(x.id, null);
          setError(errorText(e));
        })
        .finally(() => {
          end();
          setTimeout(() => URL.revokeObjectURL(x.preview), 60_000);
        });
  };

  // Pictures that came in with pasted HTML: our own links are read back to
  // their path, inline ones uploaded, and web ones copied into the bucket.
  adoptRef.current = () => {
    if (!editor) return;
    const todo: { id: string; src: string; pos: number }[] = [];
    const known: { pos: number; path: string }[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== "image") return true;
      const src = String(node.attrs.src ?? "");
      if (node.attrs.path || node.attrs.uploading || !src) return false;
      if (src.startsWith("blob:") || tried.current.has(src)) return false;
      const own = pathOfSigned(src);
      if (own) known.push({ pos, path: own });
      else if (/^data:image\//i.test(src) || /^https:\/\//i.test(src)) {
        tried.current.add(src);
        todo.push({ id: key(), src, pos });
      }
      return false;
    });
    if (!known.length && !todo.length) return;
    const tr = editor.state.tr;
    for (const k of known) {
      const node = tr.doc.nodeAt(k.pos);
      if (node)
        tr.setNodeMarkup(k.pos, undefined, { ...node.attrs, path: k.path });
    }
    for (const t of todo) {
      const node = tr.doc.nodeAt(t.pos);
      if (node)
        tr.setNodeMarkup(t.pos, undefined, { ...node.attrs, uploading: t.id });
    }
    tr.setMeta("addToHistory", false);
    begin(todo.length);
    editor.view.dispatch(tr);
    for (const t of todo) {
      const inline = t.src.startsWith("data:");
      const job: Promise<Picture> = inline
        ? fetch(t.src)
            .then(r => r.blob())
            .then(b => {
              if (!PICTURE_TYPES[b.type] || b.size > PICTURE_MAX_BYTES)
                throw new Error("not a picture the doc takes");
              return put(b, b.type);
            })
        : (fromUrl({ meetingId, url: t.src }) as Promise<Picture>);
      job
        .then(p => settle(t.id, { src: p.url, path: p.path }))
        .catch(() => {
          if (inline) {
            settle(t.id, null);
            setError(
              "A pasted picture could not be uploaded, so it was left out. Paste it again.",
            );
          } else {
            settle(t.id, {});
            setNote(
              "A pasted picture could not be copied in, so it stays linked to the page it came from. It shows as long as that page keeps it.",
            );
          }
        })
        .finally(end);
    }
  };

  // --- links --------------------------------------------------------------------------

  openLinkRef.current = () => setLinkOpen(true);

  // --- the outline: the heading in view --------------------------------------------------

  useEffect(() => {
    if (!editor) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (editor.isDestroyed) return;
        const heads = [
          ...editor.view.dom.querySelectorAll(
            ":scope > h1, :scope > h2, :scope > h3",
          ),
        ] as HTMLElement[];
        let at = heads.length ? 0 : -1;
        heads.forEach((h, i) => {
          if (h.getBoundingClientRect().top < 170) at = i;
        });
        setActive(at);
        if (cardWanted.current) setScrolled(n => n + 1);
      });
    };
    measure();
    window.addEventListener("scroll", measure, {
      capture: true,
      passive: true,
    });
    editor.on("update", measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", measure, { capture: true });
      editor.off("update", measure);
    };
  }, [editor]);

  // --- full page --------------------------------------------------------------------------

  useEffect(() => {
    if (!full) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        !document.querySelector("[data-radix-popper-content-wrapper]")
      )
        setFull(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = before;
      window.removeEventListener("keydown", onKey);
    };
  }, [full]);

  if (!editor || !ui) return null;

  const status = uploads
    ? `Uploading ${uploads === 1 ? "1 picture" : `${uploads} pictures`}`
    : state === "saving"
      ? "Saving"
      : state === "dirty"
        ? "Not saved yet"
        : savedAt
          ? `Saved ${when(savedAt)} by ${shortName(savedBy)}`
          : "Nothing written yet";
  const dot =
    uploads || state === "saving"
      ? "bg-muted-foreground animate-pulse motion-reduce:animate-none"
      : state === "dirty"
        ? "bg-warning"
        : "bg-success";

  cardWanted.current = Boolean(ui.link && ui.empty && ui.href && !linkOpen);
  const card = cardWanted.current
    ? (() => {
        try {
          const at = editor.view.coordsAtPos(ui.from);
          // Under the toolbar or below the screen: not shown.
          if (at.bottom < 64 || at.bottom > window.innerHeight - 40)
            return null;
          return { left: at.left, top: at.bottom + 6, href: ui.href as string };
        } catch {
          return null;
        }
      })()
    : null;

  return (
    <section
      aria-labelledby="the-doc"
      className={
        full
          ? "fixed inset-0 z-[60] overflow-y-auto bg-background pt-safe"
          : // A grid item: without min-w-0 the toolbar's full width widens the page.
            "min-w-0 rounded-2xl border bg-card"
      }
    >
      <div
        className={
          full ? "mx-auto min-h-full max-w-6xl bg-card sm:border-x" : ""
        }
      >
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pb-3 pt-4 sm:px-6 sm:pt-5">
          <div className="min-w-0">
            <h2 id="the-doc" className="text-[15px] font-semibold">
              The doc
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              The meeting's living document. Everyone on the team edits it, and
              it carries from one meeting to the next.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span
              role="status"
              className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground"
            >
              <span className={`size-1.5 rounded-full ${dot}`} aria-hidden />
              {status}
            </span>
            {state === "dirty" && !theirs && !uploads ? (
              <button
                type="button"
                className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => {
                  if (timer.current) clearTimeout(timer.current);
                  void saveRef.current();
                }}
              >
                Save now
              </button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setFull(f => !f)}
              aria-label={full ? "Close the full page" : "Open as a full page"}
            >
              {full ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
              <span className="hidden sm:inline">
                {full ? "Close full page" : "Full page"}
              </span>
            </Button>
          </div>
        </header>

        <Toolbar
          editor={editor}
          ui={ui}
          linkOpen={linkOpen}
          setLinkOpen={setLinkOpen}
          onPictures={files => filesRef.current(files, null)}
        />

        {theirs ? (
          <div className="mx-4 mt-4 grid gap-2 rounded-xl bg-muted/40 p-4 text-sm sm:mx-6">
            <p>
              {shortName(theirs.by) || "Someone"} saved a newer version
              {theirs.at ? ` at ${when(theirs.at)}` : ""} while you were
              writing. Yours is not saved yet.
            </p>
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Read their version</summary>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-sans">
                {docText(theirs.text) || "(empty)"}
              </pre>
            </details>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const html = docHtml(theirs.text);
                  base.current = theirs.version;
                  latest.current = html;
                  blocked.current = false;
                  editor.commands.setContent(html, { emitUpdate: false });
                  setTheirs(null);
                  setState("idle");
                }}
              >
                Use theirs
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  base.current = theirs.version;
                  blocked.current = false;
                  setTheirs(null);
                  void saveRef.current();
                }}
              >
                Keep mine
              </Button>
            </div>
          </div>
        ) : null}
        {error ? (
          <p
            className="mx-4 mt-3 text-sm text-destructive sm:mx-6"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        {note ? (
          <p className="mx-4 mt-3 text-sm text-muted-foreground sm:mx-6">
            {note}{" "}
            <button
              type="button"
              className="underline-offset-2 hover:text-foreground hover:underline"
              onClick={() => setNote(null)}
            >
              Got it
            </button>
          </p>
        ) : null}

        <div
          className={`grid gap-8 px-4 pb-4 pt-5 sm:px-6 lg:justify-center ${
            ui.outline.length
              ? "lg:grid-cols-[minmax(0,12rem)_minmax(0,48rem)]"
              : "lg:grid-cols-[minmax(0,48rem)]"
          }`}
        >
          {ui.outline.length ? (
            <nav
              aria-label="The doc's headings"
              className="team-doc-outline hidden lg:block"
            >
              <div className="sticky top-16 grid gap-0.5">
                <p className="mb-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  Outline
                </p>
                {ui.outline.map((h, i) => (
                  <button
                    key={`${h.pos}-${h.text}`}
                    type="button"
                    aria-current={i === active ? "true" : undefined}
                    onClick={() => {
                      const dom = editor.view.nodeDOM(
                        h.pos,
                      ) as HTMLElement | null;
                      dom?.scrollIntoView({
                        behavior: window.matchMedia(
                          "(prefers-reduced-motion: reduce)",
                        ).matches
                          ? "auto"
                          : "smooth",
                        block: "start",
                      });
                      editor.commands.setTextSelection(h.pos + 1);
                    }}
                    className={`relative block w-full truncate rounded-md py-1 pr-2 text-left text-sm text-muted-foreground transition-colors hover:text-foreground ${
                      h.level === 1 ? "pl-3" : h.level === 2 ? "pl-6" : "pl-9"
                    }`}
                    dir="auto"
                  >
                    {h.text || "Untitled heading"}
                  </button>
                ))}
              </div>
            </nav>
          ) : null}
          <div className="team-doc relative min-w-0">
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>

      {card ? (
        <div
          className="fixed z-[70] flex max-w-[min(26rem,calc(100vw-2rem))] items-center gap-1 rounded-lg border bg-popover px-2 py-1 text-xs shadow-lg"
          style={{
            // As wide as it may grow (26rem, or the screen less its margins), kept on screen.
            left: Math.max(
              16,
              Math.min(
                card.left,
                window.innerWidth - Math.min(416, window.innerWidth - 32) - 16,
              ),
            ),
            top: card.top,
          }}
        >
          <a
            href={card.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-w-0 items-center gap-1 px-1 text-primary underline-offset-2 hover:underline"
          >
            <span className="truncate">
              {card.href.replace(/^https?:\/\//, "")}
            </span>
            <ArrowUpRight className="size-3.5 shrink-0" aria-hidden />
          </a>
          <button
            type="button"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Edit the link"
            title="Edit the link"
            onMouseDown={e => e.preventDefault()}
            onClick={() => setLinkOpen(true)}
          >
            <Pencil className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Remove the link"
            title="Remove the link"
            onMouseDown={e => e.preventDefault()}
            onClick={() =>
              editor.chain().focus().extendMarkRange("link").unsetLink().run()
            }
          >
            <Unlink className="size-3.5" aria-hidden />
          </button>
        </div>
      ) : null}
    </section>
  );
}

// --- the toolbar ---------------------------------------------------------------------------

const tool = (on: boolean) =>
  `flex h-8 min-w-8 shrink-0 items-center justify-center gap-1 rounded-lg px-1.5 text-sm transition-colors disabled:opacity-30 pointer-coarse:h-10 pointer-coarse:min-w-10 ${
    on
      ? "bg-primary/15 text-foreground ring-1 ring-inset ring-primary/40"
      : "text-muted-foreground hover:bg-muted hover:text-foreground"
  }`;

function Gap() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />;
}

function Tool({
  label,
  on = false,
  disabled = false,
  onRun,
  children,
}: {
  label: string;
  on?: boolean;
  disabled?: boolean;
  onRun: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={on}
      disabled={disabled}
      onMouseDown={e => e.preventDefault()}
      onClick={onRun}
      className={tool(on)}
    >
      {children}
    </button>
  );
}

const BLOCKS = [
  { key: "p", label: "Normal text", className: "text-sm" },
  { key: "h1", label: "Heading 1", className: "text-xl font-semibold" },
  { key: "h2", label: "Heading 2", className: "text-lg font-semibold" },
  { key: "h3", label: "Heading 3", className: "text-base font-semibold" },
  { key: "quote", label: "Quote", className: "text-sm italic" },
] as const;

const BLOCK_SIZE: Record<string, number> = { h1: 30, h2: 24, h3: 19 };

function Toolbar({
  editor,
  ui,
  linkOpen,
  setLinkOpen,
  onPictures,
}: {
  editor: Editor;
  ui: Ui;
  linkOpen: boolean;
  setLinkOpen: (open: boolean) => void;
  onPictures: (files: File[]) => void;
}) {
  const picker = useRef<HTMLInputElement | null>(null);
  const chain = () => editor.chain().focus();
  const size = ui.fontSize
    ? Math.round(
        Number.parseFloat(ui.fontSize) *
          (ui.fontSize.endsWith("pt") ? 4 / 3 : 1),
      )
    : (BLOCK_SIZE[ui.block] ?? 16);
  const setSize = (n: number) =>
    n === (BLOCK_SIZE[ui.block] ?? 16)
      ? chain().unsetFontSize().run()
      : chain().setFontSize(`${n}px`).run();
  const step = (dir: 1 | -1) => {
    const next =
      dir > 0
        ? SIZES.find(s => s > size)
        : [...SIZES].reverse().find(s => s < size);
    if (next) setSize(next);
  };
  const item = (task: boolean) => (task ? "taskItem" : "listItem");
  const block = BLOCKS.find(b => b.key === ui.block) ?? BLOCKS[0];
  const AlignIcon =
    ui.align === "center"
      ? AlignCenter
      : ui.align === "right"
        ? AlignRight
        : ui.align === "justify"
          ? AlignJustify
          : AlignLeft;
  const keep = { onCloseAutoFocus: (e: Event) => e.preventDefault() };

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="sticky top-0 z-20 flex items-center gap-0.5 overflow-x-auto border-y bg-card/95 px-2 py-1.5 backdrop-blur [scrollbar-width:none] supports-[backdrop-filter]:bg-card/80 sm:px-4 [&::-webkit-scrollbar]:hidden"
    >
      <Tool
        label="Undo"
        disabled={!ui.canUndo}
        onRun={() => chain().undo().run()}
      >
        <Undo2 className="size-4" aria-hidden />
      </Tool>
      <Tool
        label="Redo"
        disabled={!ui.canRedo}
        onRun={() => chain().redo().run()}
      >
        <Redo2 className="size-4" aria-hidden />
      </Tool>
      <Gap />

      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          className={`${tool(false)} w-[7.5rem] justify-between px-2 text-foreground`}
          onMouseDown={e => e.preventDefault()}
          aria-label={`Text style: ${block.label}`}
        >
          <span className="truncate text-[13px]">{block.label}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48" {...keep}>
          {BLOCKS.map(b => (
            <DropdownMenuItem
              key={b.key}
              className={b.className}
              onSelect={() => {
                const c = chain();
                if (b.key === "p") c.setParagraph().run();
                else if (b.key === "quote")
                  c.setParagraph().toggleBlockquote().run();
                else
                  c.setHeading({
                    level: Number(b.key.slice(1)) as 1 | 2 | 3,
                  }).run();
              }}
            >
              {b.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Gap />

      <Tool
        label="Smaller text"
        onRun={() => step(-1)}
        disabled={size <= SIZES[0]}
      >
        <Minus className="size-3.5" aria-hidden />
      </Tool>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          className="flex h-8 w-11 shrink-0 items-center justify-center rounded-lg border border-input font-mono text-[13px] tabular-nums text-foreground hover:bg-muted pointer-coarse:h-10"
          onMouseDown={e => e.preventDefault()}
          aria-label={`Text size: ${size}`}
        >
          {size}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="w-20" {...keep}>
          {SIZES.map(s => (
            <DropdownMenuItem
              key={s}
              className={`justify-center font-mono tabular-nums ${s === size ? "text-primary" : ""}`}
              onSelect={() => setSize(s)}
            >
              {s}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Tool
        label="Bigger text"
        onRun={() => step(1)}
        disabled={size >= SIZES[SIZES.length - 1]}
      >
        <Plus className="size-3.5" aria-hidden />
      </Tool>
      <Gap />

      <Tool
        label="Bold (Cmd B)"
        on={ui.bold}
        onRun={() => chain().toggleBold().run()}
      >
        <Bold className="size-4" aria-hidden />
      </Tool>
      <Tool
        label="Italic (Cmd I)"
        on={ui.italic}
        onRun={() => chain().toggleItalic().run()}
      >
        <Italic className="size-4" aria-hidden />
      </Tool>
      <Tool
        label="Underline (Cmd U)"
        on={ui.underline}
        onRun={() => chain().toggleUnderline().run()}
      >
        <Underline className="size-4" aria-hidden />
      </Tool>
      <Tool
        label="Strikethrough"
        on={ui.strike}
        onRun={() => chain().toggleStrike().run()}
      >
        <Strikethrough className="size-4" aria-hidden />
      </Tool>
      <Swatches
        label="Text colour"
        icon={<Baseline className="size-4" aria-hidden />}
        current={ui.color}
        colours={TEXT_COLOURS}
        none="Default"
        onPick={c =>
          c ? chain().setColor(c).run() : chain().unsetColor().run()
        }
      />
      <Swatches
        label="Highlight"
        icon={<Highlighter className="size-4" aria-hidden />}
        current={ui.mark}
        colours={MARKS}
        none="None"
        onPick={c =>
          c
            ? chain().unsetHighlight().setBackgroundColor(c).run()
            : chain().unsetBackgroundColor().unsetHighlight().run()
        }
      />
      <Gap />

      <LinkTool editor={editor} ui={ui} open={linkOpen} setOpen={setLinkOpen} />
      <Tool label="Add a picture" onRun={() => picker.current?.click()}>
        <ImagePlus className="size-4" aria-hidden />
      </Tool>
      <input
        ref={picker}
        type="file"
        accept={Object.keys(PICTURE_TYPES).join(",")}
        multiple
        className="hidden"
        onChange={e => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) onPictures(files);
        }}
      />
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          className={tool(ui.table)}
          onMouseDown={e => e.preventDefault()}
          aria-label="Table"
          title="Table"
        >
          <Table2 className="size-4" aria-hidden />
          <ChevronDown className="size-3 opacity-60" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52" {...keep}>
          <DropdownMenuItem
            disabled={ui.table}
            onSelect={() =>
              chain()
                .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                .run()
            }
          >
            Insert a table
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {(
            [
              ["Add a row above", () => chain().addRowBefore().run()],
              ["Add a row below", () => chain().addRowAfter().run()],
              ["Add a column left", () => chain().addColumnBefore().run()],
              ["Add a column right", () => chain().addColumnAfter().run()],
              ["Header row on or off", () => chain().toggleHeaderRow().run()],
              ["Delete the row", () => chain().deleteRow().run()],
              ["Delete the column", () => chain().deleteColumn().run()],
            ] as const
          ).map(([label, run]) => (
            <DropdownMenuItem key={label} disabled={!ui.table} onSelect={run}>
              {label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={!ui.table}
            onSelect={() => chain().deleteTable().run()}
          >
            Delete the table
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Gap />

      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          className={tool(false)}
          onMouseDown={e => e.preventDefault()}
          aria-label={`Align: ${ui.align}`}
          title="Align"
        >
          <AlignIcon className="size-4" aria-hidden />
          <ChevronDown className="size-3 opacity-60" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-40" {...keep}>
          {(
            [
              ["left", "Left", AlignLeft],
              ["center", "Centre", AlignCenter],
              ["right", "Right", AlignRight],
              ["justify", "Justified", AlignJustify],
            ] as const
          ).map(([value, label, Icon]) => (
            <DropdownMenuItem
              key={value}
              className={ui.align === value ? "text-primary" : ""}
              onSelect={() => chain().setTextAlign(value).run()}
            >
              <Icon aria-hidden /> {label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Tool
        label="Checklist"
        on={ui.task}
        onRun={() => chain().toggleTaskList().run()}
      >
        <ListChecks className="size-4" aria-hidden />
      </Tool>
      <Tool
        label="Bulleted list"
        on={ui.bullet}
        onRun={() => chain().toggleBulletList().run()}
      >
        <List className="size-4" aria-hidden />
      </Tool>
      <Tool
        label="Numbered list"
        on={ui.ordered}
        onRun={() => chain().toggleOrderedList().run()}
      >
        <ListOrdered className="size-4" aria-hidden />
      </Tool>
      <Tool
        label="Decrease indent"
        disabled={!ui.canLift}
        onRun={() => chain().liftListItem(item(ui.task)).run()}
      >
        <IndentDecrease className="size-4" aria-hidden />
      </Tool>
      <Tool
        label="Increase indent"
        disabled={!ui.canSink}
        onRun={() => chain().sinkListItem(item(ui.task)).run()}
      >
        <IndentIncrease className="size-4" aria-hidden />
      </Tool>
      <Gap />
      <Tool
        label="Clear formatting"
        onRun={() => chain().unsetAllMarks().clearNodes().run()}
      >
        <RemoveFormatting className="size-4" aria-hidden />
      </Tool>
    </div>
  );
}

function Swatches({
  label,
  icon,
  current,
  colours,
  none,
  onPick,
}: {
  label: string;
  icon: ReactNode;
  current: string | null;
  colours: { name: string; value: string }[];
  none: string;
  onPick: (colour: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={tool(Boolean(current))}
        onMouseDown={e => e.preventDefault()}
        aria-label={label}
        title={label}
      >
        <span className="relative flex flex-col items-center">
          {icon}
          <span
            className="mt-0.5 h-[3px] w-4 rounded-full"
            style={{ background: current ?? "var(--muted-foreground)" }}
            aria-hidden
          />
        </span>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto p-3"
        onOpenAutoFocus={e => e.preventDefault()}
        onCloseAutoFocus={e => e.preventDefault()}
      >
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          {label}
        </p>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onMouseDown={e => e.preventDefault()}
            onClick={() => {
              onPick(null);
              setOpen(false);
            }}
            className="h-7 rounded-full border px-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {none}
          </button>
          {colours.map(c => (
            <button
              key={c.name}
              type="button"
              aria-label={c.name}
              title={c.name}
              onMouseDown={e => e.preventDefault()}
              onClick={() => {
                onPick(c.value);
                setOpen(false);
              }}
              className={`size-7 rounded-full ring-offset-2 ring-offset-popover transition-shadow hover:ring-2 hover:ring-border ${
                sameColour(current, c.value) ? "ring-2 ring-primary" : ""
              }`}
              style={{ background: c.value }}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function LinkTool({
  editor,
  ui,
  open,
  setOpen,
}: {
  editor: Editor;
  ui: Ui;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  useEffect(() => {
    if (!open) return;
    setUrl(ui.href ?? "");
    const { from, to, empty } = editor.state.selection;
    setText(empty ? "" : editor.state.doc.textBetween(from, to, " "));
  }, [open, ui.href, editor]);
  const apply = (e: FormEvent) => {
    e.preventDefault();
    const raw = url.trim();
    if (!raw) return;
    const href = /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`;
    if (!/^(https?:|mailto:|tel:)/i.test(href)) return;
    const c = editor.chain().focus();
    if (ui.link) c.extendMarkRange("link").setLink({ href }).run();
    else if (editor.state.selection.empty)
      c.insertContent({
        type: "text",
        text: text.trim() || raw,
        marks: [{ type: "link", attrs: { href } }],
      }).run();
    else c.setLink({ href }).run();
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={tool(ui.link)}
        onMouseDown={e => e.preventDefault()}
        aria-label="Link (Cmd K)"
        title="Link (Cmd K)"
      >
        <LinkIcon className="size-4" aria-hidden />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 p-3"
        onCloseAutoFocus={e => e.preventDefault()}
      >
        <form className="grid gap-2" onSubmit={apply}>
          {editor.state.selection.empty && !ui.link ? (
            <Input
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Text to show"
              aria-label="Text to show"
              className="h-8 text-sm"
              dir="auto"
            />
          ) : null}
          <Input
            autoFocus
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="Paste or type a link"
            aria-label="Link address"
            className="h-8 text-sm"
          />
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={!url.trim()}>
              {ui.link ? "Update link" : "Add link"}
            </Button>
            {ui.link ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  editor
                    .chain()
                    .focus()
                    .extendMarkRange("link")
                    .unsetLink()
                    .run();
                  setOpen(false);
                }}
              >
                Remove link
              </Button>
            ) : null}
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
