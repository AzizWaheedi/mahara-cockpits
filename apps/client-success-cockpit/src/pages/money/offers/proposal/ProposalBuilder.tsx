import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  RotateCcw,
} from "lucide-react";
import {
  Children,
  cloneElement,
  isValidElement,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { PageHeader } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { OFFER_NAMES, offerDeckUrl } from "@/present/offer/kinds";
import { type CatalogRow, copyOf } from "@/present/offer/sources";
import type { LaunchAd } from "@/present/sources";
import { ProposalPreview } from "./ProposalPreview";
import {
  type ProposalContent,
  type ProposalPatch,
  withPrice,
} from "./proposalContent";
import {
  ProposalSaver,
  type ProposalSaveSnapshot,
  sessionProposalDraft,
} from "./proposalSaver";
import {
  type ProposalBundle,
  ProposalError,
  type ProposalIO,
  type ProposalIssue,
} from "./proposalSources";
import type { PublicProposal } from "./publicProposal";
import "./proposal.css";

type VideoCheck = {
  ok: boolean;
  refusal?: string | null;
  url?: string | null;
  posterUrl?: string | null;
  title?: string | null;
};
export type ProposalBuilderProps = {
  io: ProposalIO;
  onBack?: () => void;
  checkCustomVideo?: (url: string) => Promise<VideoCheck>;
  addLogo?: (file: File) => Promise<LaunchAd>;
};
const cadence: Record<string, string> = {
  one_time: "One time",
  monthly: "Monthly",
  per_day: "Per day",
  per_90_days: "For 90 days",
};
const sentence = (e: unknown) =>
  e instanceof Error ? e.message : "That did not complete. Try again.";
function Field({
  label,
  children,
  note,
}: {
  label: string;
  children: ReactNode;
  note?: string;
}) {
  const controlId = useId();
  return (
    <label className="proposal-field" htmlFor={controlId}>
      <span>{label}</span>
      {Children.map(children, child =>
        isValidElement<{ id?: string }>(child) &&
        (child.type === Input ||
          child.type === Textarea ||
          child.type === "select")
          ? cloneElement(child, { id: controlId })
          : child,
      )}
      {note ? <small>{note}</small> : null}
    </label>
  );
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="proposal-section">
      <h2>{title}</h2>
      <div className="proposal-fields">{children}</div>
    </section>
  );
}
export function priceNeedsReason(
  catalog: CatalogRow,
  price: Record<string, number>,
): boolean {
  return catalog.parts.some(
    p =>
      p.amount !== null &&
      price[p.key] !== undefined &&
      price[p.key] < p.amount,
  );
}

export function ProposalBuilder({
  io,
  onBack,
  checkCustomVideo,
  addLogo,
}: ProposalBuilderProps) {
  const [bundle, setBundle] = useState<ProposalBundle | null>(null);
  const [saved, setSaved] = useState<ProposalSaveSnapshot | null>(null);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [issues, setIssues] = useState<ProposalIssue[]>([]);
  const [busy, setBusy] = useState("");
  const [ack, setAck] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [copyUrl, setCopyUrl] = useState("");
  const [preview, setPreview] = useState<PublicProposal | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const [customUrl, setCustomUrl] = useState("");
  const [later, setLater] = useState(false);
  const [objection, setObjection] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [generation, setGeneration] = useState(0);
  const saver = useRef<ProposalSaver | null>(null);
  const ioRef = useRef(io);
  ioRef.current = io;
  const activeAction = useRef<symbol | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: generation explicitly reloads and recreates the controller after discard or a failed-load retry, even when io is unchanged.
  useEffect(() => {
    let active = true;
    let detach: (() => void) | undefined;
    let controller: ProposalSaver | null = null;
    activeAction.current = null;
    setLoadError("");
    setBundle(null);
    setSaved(null);
    setPreview(null);
    setBusy("");
    setActionError("");
    setCopyUrl("");
    setCopied(false);
    setIssues([]);
    setLater(false);
    setObjection("");
    setFollowUp("");
    setPreviewError("");
    setPreviewBusy(false);
    void io
      .load()
      .then(data => {
        if (!active) return;
        setBundle(data);
        setAck([]);
        controller = new ProposalSaver(
          data.proposal,
          (patch, revision) => io.save(patch, revision),
          600,
          sessionProposalDraft(data.proposal.taskId, data.proposal.id),
        );
        saver.current = controller;
        setSaved(controller.snapshot());
        const restored = controller.snapshot().proposal;
        setCustomUrl(
          restored.content.video.kind === "custom"
            ? restored.content.video.url
            : "",
        );
        detach = controller.subscribe(s => {
          if (active) setSaved(s);
        });
      })
      .catch(e => {
        if (active) setLoadError(sentence(e));
      });
    return () => {
      active = false;
      detach?.();
      controller?.close();
      if (saver.current === controller) saver.current = null;
    };
  }, [io, generation]);

  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => {
      if (saver.current?.snapshot().dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const retry = () => {
      if (saver.current?.snapshot().state === "error")
        void saver.current.flush().catch(() => undefined);
    };
    window.addEventListener("beforeunload", before);
    window.addEventListener("online", retry);
    return () => {
      window.removeEventListener("beforeunload", before);
      window.removeEventListener("online", retry);
    };
  }, []);

  const proposal = saved?.proposal;
  // Preview follows confirmed saves, so dates and language match the server too.
  useEffect(() => {
    if (!proposal || saved?.state !== "saved") return;
    let active = true;
    setPreviewBusy(true);
    setPreviewError("");
    void ioRef.current
      .preview(proposal)
      .then(p => {
        if (active) setPreview(p);
      })
      .catch(e => {
        if (active) {
          setPreview(null);
          setPreviewError(sentence(e));
        }
      })
      .finally(() => {
        if (active) setPreviewBusy(false);
      });
    return () => {
      active = false;
    };
  }, [proposal, saved?.state]);

  const copy =
    bundle && proposal ? copyOf(bundle.catalog, proposal.lang) : null;
  const edit = (patch: ProposalPatch, immediate = false) => {
    setCopied(false);
    setIssues([]);
    setActionError("");
    saver.current?.edit(patch, immediate);
  };
  const content = (patch: Partial<ProposalContent>, immediate = false) => {
    const current = saver.current?.snapshot().proposal.content;
    if (current) edit({ content: { ...current, ...patch } }, immediate);
  };
  type ActionScope = {
    controller: ProposalSaver;
    currentIO: ProposalIO;
    current: () => boolean;
  };
  const action = async (
    name: string,
    run: (scope: ActionScope) => Promise<void>,
  ) => {
    const controller = saver.current;
    if (!controller || activeAction.current) return;
    const marker = Symbol(name);
    const currentIO = io;
    activeAction.current = marker;
    setBusy(name);
    setActionError("");
    setIssues([]);
    const current = () =>
      saver.current === controller &&
      ioRef.current === currentIO &&
      activeAction.current === marker;
    try {
      await run({ controller, currentIO, current });
    } catch (e) {
      if (current()) {
        setActionError(sentence(e));
        if (e instanceof ProposalError) setIssues(e.issues);
      }
    } finally {
      if (current()) {
        activeAction.current = null;
        setBusy("");
      }
    }
  };
  const refresh = async ({ controller, currentIO, current }: ActionScope) => {
    const fresh = await currentIO.load();
    if (!current()) return null;
    controller.replace(fresh.proposal);
    setBundle(fresh);
    return fresh.proposal;
  };
  const refreshImages = () =>
    action("files", async scope => {
      await scope.controller.flush();
      if (scope.current()) await refresh(scope);
    });
  const reload = () => {
    if (
      saved?.dirty &&
      !window.confirm(
        "Reload the saved proposal? Changes that have not reached the server will be discarded.",
      )
    )
      return;
    void action("reload", async ({ controller, current }) => {
      await controller.discard();
      if (current()) setGeneration(x => x + 1);
    });
  };
  const changeLanguage = (lang: "en" | "ar") =>
    action("language", async scope => {
      await scope.controller.flush();
      if (!scope.current()) return;
      scope.controller.edit({ lang });
      await scope.controller.flush();
      if (!scope.current()) return;
      await refresh(scope);
    });
  const applyCurrentList = () =>
    action("list", async scope => {
      await scope.controller.flush();
      if (!scope.current()) return;
      const fresh = await scope.currentIO.load();
      if (!scope.current()) return;
      scope.controller.replace(fresh.proposal);
      setBundle(fresh);
      if (!fresh.catalog.locked)
        throw Error(
          "This price is no longer locked. Enter the client's price below.",
        );
      if (fresh.catalog.parts.some(part => part.amount === null))
        throw Error(
          "The CEO needs to set every part of this price in Money → Offers.",
        );
      scope.controller.edit({
        price: {
          parts: Object.fromEntries(
            fresh.catalog.parts.map(part => [part.key, part.amount!]),
          ),
          split: fresh.proposal.price.split,
        },
      });
      await scope.controller.flush();
      if (scope.current()) await refresh(scope);
    });
  const markResponse = (
    status: "accepted" | "not_now" | "archived",
    text: string | null,
    date: string | null,
  ) =>
    action(status, async scope => {
      const row = await scope.controller.flush();
      if (!scope.current()) return;
      const marked = await scope.currentIO.mark(
        row.revision,
        status,
        text,
        date,
      );
      if (!scope.current()) return;
      scope.controller.replace({ ...row, ...marked });
      await refresh(scope);
      if (scope.current()) setLater(false);
    });
  if (loadError)
    return (
      <div className="proposal-alert" role="alert">
        <p>{loadError}</p>
        <Button
          className="mt-3"
          variant="outline"
          onClick={() => setGeneration(x => x + 1)}
        >
          Try again
        </Button>
      </div>
    );
  if (!proposal || !saved || !bundle)
    return (
      <div
        className="flex items-center gap-2 py-12 text-sm text-muted-foreground"
        role="status"
      >
        <Loader2 className="animate-spin" size={18} />
        Opening proposal
      </div>
    );
  const p = proposal;
  const disabled = p.status === "archived" || !!busy;
  const warnings = p.warnings ?? [];
  const below = priceNeedsReason(bundle.catalog, p.price.parts);
  const currentListAvailable =
    bundle.catalog.locked &&
    bundle.catalog.parts.every(part => part.amount !== null) &&
    bundle.catalog.parts.some(part => p.price.parts[part.key] !== part.amount);
  const block = saved.state === "conflict" || saved.state === "error";
  const performSend = () =>
    action(p.code ? "update" : "copy", async scope => {
      await scope.controller.flush();
      if (!scope.current()) return;
      // Refresh language-specific video readiness, warnings and current revision before sharing.
      const row = await refresh(scope);
      if (!row || !scope.current()) return;
      if (row.code && !row.updatedAfterSend) {
        if (row.expired)
          throw Error(
            "This link has expired. Choose a future Valid until date, then select Update link.",
          );
        setCopyUrl(row.url ?? "");
        try {
          await navigator.clipboard.writeText(row.url!);
          if (scope.current()) setCopied(true);
        } catch {
          if (scope.current())
            setActionError("The link is ready. Copy it from the field below.");
        }
        return;
      }
      if ((row.warnings ?? []).some(w => !ack.includes(w.key)))
        throw Error("Review the updated points below before sharing.");
      const sent = await scope.currentIO.send(row.revision, ack, !!row.code);
      if (!scope.current()) return;
      // Keep the successful link visible even if refreshing the bundle subsequently fails.
      setCopyUrl(sent.url);
      await refresh(scope);
      if (!scope.current()) return;
      try {
        await navigator.clipboard.writeText(sent.url);
        if (scope.current()) setCopied(true);
      } catch {
        if (scope.current())
          setActionError("The link is ready. Copy it from the field below.");
      }
    });
  const fieldIssues = (name: string) =>
    [...(p.problems ?? []), ...issues].filter(
      x => x.field === name || x.field.startsWith(`${name}.`),
    );
  const problemLines = (name: string) =>
    fieldIssues(name).map((x, i) => (
      <small key={`${x.rule}-${i}`} className="text-destructive">
        {x.text}
      </small>
    ));

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          className="-ml-3"
          onClick={() =>
            void action("back", async scope => {
              await scope.controller.flush();
              if (scope.current()) onBack?.();
            })
          }
        >
          <ArrowLeft size={16} />
          Client
        </Button>
        <span
          role="status"
          aria-live="polite"
          className="text-xs text-muted-foreground"
        >
          {saved.state === "saved" ? (
            <Check size={13} className="mr-1 inline" />
          ) : null}
          {saved.message}
        </span>
      </div>
      <PageHeader
        title={`${OFFER_NAMES[p.offerKey]} proposal`}
        sub={`Prepared for ${p.clientName}`}
        actions={
          <div className="proposal-actions">
            {p.code ? (
              <Button
                variant="outline"
                disabled={!!busy}
                onClick={() => {
                  const tab = window.open("", "_blank");
                  if (tab) tab.opener = null;
                  void action("preview", async scope => {
                    try {
                      await scope.controller.flush();
                      if (!scope.current()) {
                        tab?.close();
                        return;
                      }
                      const out = await scope.currentIO.livePreview();
                      if (!scope.current()) {
                        tab?.close();
                        return;
                      }
                      if (tab) tab.location.href = out.url;
                      else
                        setActionError(
                          "Allow pop-ups to open the live preview.",
                        );
                    } catch (e) {
                      tab?.close();
                      throw e;
                    }
                  });
                }}
              >
                <ExternalLink size={16} />
                Preview live page
              </Button>
            ) : null}
            <Button
              disabled={
                disabled || block || warnings.some(w => !ack.includes(w.key))
              }
              onClick={() => void performSend()}
            >
              {busy === "copy" || busy === "update" ? (
                <Loader2 size={16} className="animate-spin" />
              ) : copied ? (
                <Check size={16} />
              ) : (
                <Copy size={16} />
              )}
              {copied
                ? "Copied"
                : p.updatedAfterSend
                  ? "Update link"
                  : "Copy link"}
            </Button>
          </div>
        }
      />
      {p.expired ? (
        <p className="proposal-alert" role="status">
          This client's link has expired. Choose a future Valid until date and
          select Update link to reopen it.
        </p>
      ) : null}
      {p.updatedAfterSend ? (
        <p className="proposal-alert">
          Your client still sees the version you sent. Select Update link when
          these changes are ready.
        </p>
      ) : null}
      {p.status === "archived" ? (
        <p className="proposal-alert">
          This proposal is archived. Its client page is closed.
        </p>
      ) : null}
      {block ? (
        <div role="alert" className="proposal-alert">
          <p>{saved.message} Your changes are still shown here.</p>
          <Button
            variant="outline"
            className="mt-2"
            onClick={
              saved.state === "conflict"
                ? reload
                : () => void saver.current?.flush().catch(() => undefined)
            }
          >
            <RotateCcw size={14} />
            {saved.state === "conflict"
              ? "Reload saved proposal"
              : "Retry save"}
          </Button>
        </div>
      ) : null}
      {actionError ? (
        <p className="proposal-alert" role="alert">
          {actionError}
        </p>
      ) : null}
      {copyUrl ? (
        <Field label="Client link">
          <Input
            readOnly
            value={copyUrl}
            onFocus={e => e.currentTarget.select()}
          />
        </Field>
      ) : null}
      <div className="proposal-layout">
        <div className="proposal-editor">
          <fieldset disabled={disabled} className="contents">
            <Section title="Proposal details">
              <Field label="Language">
                <select
                  aria-label="Language"
                  className="proposal-choice"
                  value={p.lang}
                  onChange={e =>
                    void changeLanguage(e.target.value as "en" | "ar")
                  }
                >
                  <option value="en">English</option>
                  <option value="ar">Arabic</option>
                </select>
              </Field>
              <Field label="Valid until">
                <Input
                  type="date"
                  value={p.validUntil}
                  onChange={e => edit({ valid_until: e.target.value })}
                />
                {problemLines("valid_until")}
              </Field>
              <label className="proposal-toggle">
                <input
                  type="checkbox"
                  checked={p.content.showCsm}
                  onChange={e => content({ showCsm: e.target.checked }, true)}
                />
                Show my first name as the account manager
              </label>
            </Section>
            <Section title="Client logo">
              <label className="proposal-toggle">
                <input
                  type="checkbox"
                  checked={p.content.logo.on}
                  onChange={e =>
                    content(
                      { logo: { ...p.content.logo, on: e.target.checked } },
                      true,
                    )
                  }
                />
                Include the client's logo
              </label>
              {p.content.logo.on ? (
                <Field label="Logo">
                  <select
                    className="proposal-choice"
                    value={p.content.logo.adId ?? "verified"}
                    onChange={e =>
                      content(
                        {
                          logo: {
                            on: true,
                            adId:
                              e.target.value === "verified"
                                ? null
                                : e.target.value,
                          },
                        },
                        true,
                      )
                    }
                  >
                    <option value="verified">
                      Verified logo, if available
                    </option>
                    {bundle.logos.map(l => (
                      <option key={l.id} value={l.id}>
                        {l.fileName || "Uploaded logo"}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
              {addLogo ? (
                <Field
                  label="Upload a logo"
                  note="PNG, JPEG or WebP. The logo is optional."
                >
                  <Input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      void action("logo", async scope => {
                        const ad = await addLogo(file);
                        if (!scope.current()) return;
                        setBundle(b =>
                          b
                            ? {
                                ...b,
                                logos: [
                                  ...b.logos.filter(x => x.id !== ad.id),
                                  ad,
                                ],
                              }
                            : b,
                        );
                        content({ logo: { on: true, adId: ad.id } }, true);
                      });
                      e.target.value = "";
                    }}
                  />
                </Field>
              ) : null}
            </Section>
            <Section title="Video">
              <label className="proposal-toggle">
                <input
                  type="radio"
                  name="proposal-video"
                  checked={p.content.video.kind === "default"}
                  onChange={() => content({ video: { kind: "default" } }, true)}
                />
                Use the offer's video in this language
              </label>
              {p.content.video.kind === "default" && !p.videoReady ? (
                <p className="text-sm text-muted-foreground">
                  No video is set for this language. Add a checked link below,
                  or ask the CEO to set one in Money → Offers.
                </p>
              ) : null}
              <Field
                label="Or use a video link"
                note="Loom, YouTube, Vimeo, Wistia or Google Drive. The link is checked as an anonymous viewer."
              >
                <Input
                  type="url"
                  value={customUrl}
                  placeholder="https://"
                  onChange={e => setCustomUrl(e.target.value)}
                />
              </Field>
              <Button
                variant="outline"
                disabled={!customUrl.trim() || !checkCustomVideo}
                onClick={() =>
                  void action("video", async scope => {
                    const result = await checkCustomVideo!(customUrl.trim());
                    if (!scope.current()) return;
                    if (!result.ok || !result.url)
                      throw Error(
                        result.refusal ||
                          "This video cannot be opened without signing in.",
                      );
                    content(
                      {
                        video: {
                          kind: "custom",
                          url: result.url,
                          posterUrl: result.posterUrl ?? null,
                          title: result.title?.slice(0, 40) ?? null,
                          checkedAt: new Date().toISOString(),
                        },
                      },
                      true,
                    );
                  })
                }
              >
                {busy === "video" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : null}
                Check and use video
              </Button>
              {p.content.video.kind === "custom" ? (
                <p className="text-xs text-muted-foreground">
                  Custom video checked. Changing the link above does not replace
                  it until the new check passes.
                </p>
              ) : null}
              {problemLines("video")}
            </Section>
            <Section title="What we found">
              {bundle.files.length ? (
                <div className="proposal-capture-list">
                  {bundle.files.map(f => {
                    const selected = p.content.found.find(
                      x => x.fileId === f.id,
                    );
                    return (
                      <div key={f.id} className="min-w-0 space-y-2">
                        {f.url ? (
                          <img
                            src={f.url}
                            alt={f.caption || "Client capture"}
                          />
                        ) : null}
                        <label className="proposal-toggle">
                          <input
                            type="checkbox"
                            checked={!!selected}
                            disabled={!selected && p.content.found.length >= 3}
                            onChange={e =>
                              content(
                                {
                                  found: e.target.checked
                                    ? [
                                        ...p.content.found,
                                        {
                                          fileId: f.id,
                                          caption: (f.caption ?? "").slice(
                                            0,
                                            120,
                                          ),
                                        },
                                      ]
                                    : p.content.found.filter(
                                        x => x.fileId !== f.id,
                                      ),
                                },
                                true,
                              )
                            }
                          />
                          {f.capturedOn}
                        </label>
                        {selected ? (
                          <Field label="Caption">
                            <Input
                              maxLength={120}
                              value={selected.caption}
                              onChange={e =>
                                content({
                                  found: p.content.found.map(x =>
                                    x.fileId === f.id
                                      ? { ...x, caption: e.target.value }
                                      : x,
                                  ),
                                })
                              }
                            />
                          </Field>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No captures yet. Add a dated screenshot in the offer's
                  preparation view.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <a
                  href={offerDeckUrl(p.taskId, "website", "prep")}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm underline underline-offset-4"
                >
                  Open preparation
                </a>
                <Button variant="outline" onClick={() => void refreshImages()}>
                  {busy === "files" ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <RotateCcw size={14} />
                  )}
                  Refresh captures and logos
                </Button>
              </div>
              {problemLines("found")}
            </Section>
            <Section title="Why this, for them">
              {copy ? (
                <Field label="Starting point">
                  <select
                    className="proposal-choice"
                    value={p.content.why.trigger ?? ""}
                    onChange={e => {
                      const why = copy.why.find(x => x.key === e.target.value);
                      if (why)
                        content(
                          {
                            why: {
                              trigger: why.key,
                              text: why.text,
                              edited: false,
                            },
                          },
                          true,
                        );
                    }}
                  >
                    <option value="" disabled>
                      Choose a reason
                    </option>
                    {copy.why.map(w => (
                      <option key={w.key} value={w.key}>
                        {w.label}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
              <Field label="Personalise the reason">
                <Textarea
                  dir={p.lang === "ar" ? "rtl" : "ltr"}
                  maxLength={400}
                  rows={4}
                  value={p.content.why.text}
                  onChange={e =>
                    content({
                      why: {
                        ...p.content.why,
                        text: e.target.value,
                        edited: true,
                      },
                    })
                  }
                />
                {problemLines("why")}
              </Field>
            </Section>
            <Section title="What they get">
              {p.content.get.map((line, i) => (
                <div key={line.key} className="space-y-2">
                  <label className="proposal-toggle">
                    <input
                      type="checkbox"
                      checked={!line.hidden}
                      onChange={e =>
                        content(
                          {
                            get: p.content.get.map((x, j) =>
                              j === i ? { ...x, hidden: !e.target.checked } : x,
                            ),
                          },
                          true,
                        )
                      }
                    />
                    Include this item
                  </label>
                  <Textarea
                    aria-label={`Item ${i + 1}`}
                    dir={p.lang === "ar" ? "rtl" : "ltr"}
                    maxLength={200}
                    rows={2}
                    value={line.text}
                    disabled={line.hidden}
                    onChange={e =>
                      content({
                        get: p.content.get.map((x, j) =>
                          j === i
                            ? { ...x, text: e.target.value, edited: true }
                            : x,
                        ),
                      })
                    }
                  />
                </div>
              ))}
              {problemLines("get")}
              {p.offerKey === "smm" ? (
                <div className="space-y-2">
                  {(
                    ["instagram", "tiktok", "snapchat", "facebook"] as const
                  ).map(platform => (
                    <label key={platform} className="proposal-toggle">
                      <input
                        type="checkbox"
                        checked={
                          p.content.platforms?.includes(platform) ?? false
                        }
                        disabled={platform === "instagram"}
                        onChange={e =>
                          content(
                            {
                              platforms: e.target.checked
                                ? [
                                    ...(p.content.platforms ?? ["instagram"]),
                                    platform,
                                  ]
                                : (p.content.platforms ?? []).filter(
                                    x => x !== platform,
                                  ),
                            },
                            true,
                          )
                        }
                      />
                      {platform}
                    </label>
                  ))}
                </div>
              ) : null}
            </Section>
            <Section title="How it runs">
              <Field label="Next steps">
                <Textarea
                  dir={p.lang === "ar" ? "rtl" : "ltr"}
                  rows={4}
                  maxLength={400}
                  value={p.content.steps.text}
                  onChange={e =>
                    content({ steps: { text: e.target.value, edited: true } })
                  }
                />
                {problemLines("steps")}
              </Field>
            </Section>
            <Section title="Investment">
              {bundle.catalog.parts.map(part => (
                <Field
                  key={part.key}
                  label={`${copy?.parts[part.key] ?? part.key} · USD`}
                  note={cadence[part.cadence]}
                >
                  <Input
                    type="number"
                    min="1"
                    max="1000000"
                    step="0.01"
                    inputMode="decimal"
                    value={p.price.parts[part.key] ?? ""}
                    placeholder="No price yet"
                    disabled={bundle.catalog.locked}
                    onChange={e =>
                      edit({
                        price: withPrice(p.price, part.key, e.target.value),
                      })
                    }
                  />
                </Field>
              ))}
              {bundle.catalog.locked ? (
                <p className="text-xs text-muted-foreground">
                  The CEO controls this offer's price in Money → Offers.
                </p>
              ) : null}
              {currentListAvailable ? (
                <Button
                  variant="outline"
                  onClick={() => void applyCurrentList()}
                >
                  Use current list price
                </Button>
              ) : null}
              {below ? (
                <Field
                  label="Reason for pricing below list"
                  note="Internal only. Your client never sees this."
                >
                  <Input
                    maxLength={140}
                    value={p.priceReason ?? ""}
                    onChange={e =>
                      edit({ price_reason: e.target.value || null })
                    }
                  />
                </Field>
              ) : null}
              {bundle.catalog.splitAllowed && p.heldFull ? (
                <label className="proposal-toggle">
                  <input
                    type="checkbox"
                    checked={p.price.split}
                    onChange={e =>
                      edit(
                        { price: { ...p.price, split: e.target.checked } },
                        true,
                      )
                    }
                  />
                  Offer the two-payment option
                </label>
              ) : null}
              {problemLines("price")}
            </Section>
            <Section title="Next step">
              <Field label="Button text">
                <Input
                  maxLength={40}
                  value={p.content.button.text}
                  onChange={e =>
                    content({ button: { text: e.target.value, edited: true } })
                  }
                />
                {problemLines("button")}
              </Field>
              <p className="text-xs text-muted-foreground">
                The client can message their account manager. Copying a link
                sends no message.
              </p>
            </Section>
            {warnings.length ? (
              <Section title="Review before sharing">
                <p className="text-sm text-muted-foreground">
                  These points need your attention. Acknowledge each one to
                  continue.
                </p>
                {warnings.map(w => (
                  <label key={w.key} className="proposal-toggle">
                    <input
                      type="checkbox"
                      checked={ack.includes(w.key)}
                      onChange={e =>
                        setAck(a =>
                          e.target.checked
                            ? [...a, w.key]
                            : a.filter(x => x !== w.key),
                        )
                      }
                    />
                    {w.text}
                  </label>
                ))}
              </Section>
            ) : null}
            {p.code ? (
              <Section title="Client response">
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => void markResponse("accepted", null, null)}
                  >
                    Agreed
                  </Button>
                  <Button variant="outline" onClick={() => setLater(!later)}>
                    Not now
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      if (
                        window.confirm(
                          "Archive this proposal and close its client link?",
                        )
                      )
                        void markResponse("archived", null, null);
                    }}
                  >
                    Archive
                  </Button>
                </div>
                {later ? (
                  <>
                    <Field label="What did they say?">
                      <Textarea
                        maxLength={200}
                        value={objection}
                        onChange={e => setObjection(e.target.value)}
                      />
                    </Field>
                    <Field label="Follow up on">
                      <Input
                        type="date"
                        value={followUp}
                        onChange={e => setFollowUp(e.target.value)}
                      />
                    </Field>
                    <Button
                      variant="outline"
                      disabled={!objection.trim() || !followUp}
                      onClick={() =>
                        void markResponse("not_now", objection, followUp)
                      }
                    >
                      Save follow-up
                    </Button>
                  </>
                ) : null}
              </Section>
            ) : null}
          </fieldset>
        </div>
        <ProposalPreview
          proposal={preview}
          error={previewError}
          loading={
            previewBusy || saved.state === "queued" || saved.state === "saving"
          }
        />
      </div>
    </div>
  );
}
