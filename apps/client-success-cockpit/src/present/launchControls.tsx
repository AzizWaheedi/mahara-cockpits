import {
  Copy,
  ExternalLink,
  Play,
  RotateCcw,
  Star,
  Undo2,
  Upload,
} from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PAIN_STORY, type Pain } from "./callScript";
import { CTA, type Cta, LAUNCH, LINKS, t } from "./content";
import { Field, PrepText, Segmented, Toggle } from "./controls";
import type { CallKind, DeckData, Overrides } from "./deckData";
import { PROOF_ID } from "./launchData";
import type { DeckKind } from "./sources";
import { type LocalItem, useLocalAds } from "./uploads";
import type { DeckModel } from "./useDeckModel";

/**
 * The launch deck's presenter controls, in cockpit UI (DESIGN 12.2, 12.3):
 * the notes window shows them on the call, the prep view before it. Never
 * on the canvas. Prep saves go through the same gated, audited save as the
 * canvas; files go through the ads tray's save (launchAds.*).
 */

export interface LaunchControlProps {
  slideId: string;
  d: DeckData;
  model: DeckModel;
  /** Where the deck is (the notes window follows it). */
  tour: number;
  book?: (kind: CallKind, label: string) => ReactNode;
  /** The prep view: the set-up controls too. */
  full?: boolean;
  addFiles?: (
    files: File[],
    phone?: "feed" | "reels" | "facebook" | null,
    kind?: "starter" | "custom",
  ) => Promise<void>;
  updateAd?: (id: string, patch: Record<string, unknown>) => Promise<unknown>;
  /** Ask the deck window to act (the call's P and R). */
  sendKey?: (key: string) => void;
  /** The last results of adding a file, said plainly. */
  messages?: string[];
  now?: number;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2 border-t pt-3">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          window.setTimeout(() => setDone(false), 2000);
        });
      }}
    >
      <Copy aria-hidden />
      {done ? "Copied. Paste it in the group." : label}
    </Button>
  );
}

/** One prep text with its Arabic twin (CONTENT-AR: the build cannot translate). */
function Twin({
  label,
  hint,
  k,
  prep,
  set,
  rows = 1,
}: {
  label: string;
  hint?: ReactNode;
  k: string;
  prep: Overrides;
  set: (patch: Overrides) => void;
  rows?: number;
}) {
  const ar = str(prep[`${k}_ar`]);
  return (
    <Field
      label={label}
      hint={
        <>
          {hint}
          {str(prep[k]) && !ar ? (
            <span className="block txt-warn">
              No Arabic yet: the Arabic deck shows the English.
            </span>
          ) : null}
        </>
      }
    >
      <PrepText
        label={label}
        value={str(prep[k])}
        rows={rows}
        onChange={v => set({ [k]: v })}
      />
      <PrepText
        label={`${label}, Arabic`}
        value={ar}
        rows={rows}
        rtl
        placeholder="بالعربي، للعرض العربي"
        onChange={v => set({ [`${k}_ar`]: v })}
      />
    </Field>
  );
}

// ------------------------------------------------------------ the ads

const PHASE: Record<LocalItem["phase"], string> = {
  shown: "Shown, not saved",
  saving: "Saving",
  saved: "Saved",
  failed: "Not saved",
};

function UploadPanel({
  addFiles,
  messages,
}: {
  addFiles?: LaunchControlProps["addFiles"];
  messages?: string[];
}) {
  const local = useLocalAds();
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<"custom" | "starter">("custom");
  const [over, setOver] = useState(false);
  if (!addFiles) return null;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a drop zone beside the "Add a file" button, which is the keyboard path
    <div
      className={cn(
        "space-y-2 rounded-lg border border-dashed p-2.5",
        over && "border-primary bg-primary/5",
      )}
      onDragOver={e => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={e => {
        e.preventDefault();
        setOver(false);
        void addFiles([...e.dataTransfer.files], null, kind);
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => input.current?.click()}>
          <Upload aria-hidden />
          Add a file
        </Button>
        <Segmented
          label="Kind"
          value={kind}
          options={[
            { value: "custom", label: "Their own" },
            { value: "starter", label: "Starter template" },
          ]}
          onChange={setKind}
        />
        <input
          ref={input}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm"
          className="sr-only"
          onChange={e => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            void addFiles(files, null, kind);
          }}
        />
      </div>
      <div className="text-xs text-muted-foreground">
        Or drop it here. It shows on the phone in focus (or the one its shape
        suits) at once, and saves behind it.
      </div>
      {local.length ? (
        <ul className="space-y-1 text-xs">
          {local.map(i => (
            <li key={i.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">{i.name}</span>
              <span
                className={cn(
                  "shrink-0 tabular-nums",
                  i.phase === "failed" || i.phase === "shown"
                    ? "txt-warn"
                    : i.phase === "saved"
                      ? "txt-good"
                      : "text-muted-foreground",
                )}
              >
                {PHASE[i.phase]}
                {i.phase === "saving"
                  ? ` ${Math.round((i.progress ?? 0) * 100)}%`
                  : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {[
        ...local.filter(i => i.message).map(i => i.message as string),
        ...(messages ?? []),
      ].map(m => (
        <div key={m} className="text-xs txt-warn">
          {m}
        </div>
      ))}
    </div>
  );
}

function AdsControls(p: LaunchControlProps) {
  const { d, model, full, now = Date.now() } = p;
  const live = model.live;
  const selected = live.selected ?? null;
  const all = [...d.launch.creatives, ...d.launch.metaCreatives];
  const sel = all.find(c => c.id === selected) ?? null;
  const undo = live.undo && now - live.undo.at < 10_000 ? live.undo : null;
  const prep = model.prep.launch;
  const planned = strings(prep.platforms_planned);
  const saved = Boolean(selected && !selected.startsWith("local-"));
  return (
    <div className="space-y-4">
      <Section title="Add a file">
        <UploadPanel addFiles={p.addFiles} messages={p.messages} />
        <div className="text-xs text-muted-foreground">
          Present maximised, not full screen, so you can reach this window.
          Showing a preview is not approval; approval happens in the group.
        </div>
      </Section>
      <Section title="On the phones">
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!undo}
            onClick={() =>
              undo &&
              model.setLive(l => ({ ...l, phones: undo.phones, undo: null }))
            }
          >
            <Undo2 aria-hidden />
            Undo swap
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!saved}
            onClick={() =>
              selected &&
              model.setPrep(
                "launch",
                { their_pick: d.launch.pick === selected ? null : selected },
                true,
              )
            }
          >
            <Star
              aria-hidden
              className={cn(d.launch.pick === selected && "fill-current")}
            />
            {d.launch.pick && d.launch.pick === selected
              ? "Their pick (marked)"
              : "Their pick"}
          </Button>
          {p.updateAd && sel?.from === "upload" && saved ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void p.updateAd?.(sel.id, { hidden: true }).then(async () => {
                  await model.reload();
                  model.hub.post({ type: "ads" });
                });
              }}
            >
              Remove from the deck
            </Button>
          ) : null}
        </div>
        <div className="text-xs text-muted-foreground">
          {sel
            ? `Selected: ${sel.name}. 1, 2, 3 put it on a phone; M marks it as their pick.`
            : "Click a creative on the deck to select it."}{" "}
          Remove only hides it from this deck; nothing changes in their Meta
          account.
        </div>
      </Section>
      <Section title="Planned next (only if it's agreed)">
        <div className="flex flex-wrap gap-3">
          {["Snapchat", "TikTok", "Google"].map(n => (
            <Toggle
              key={n}
              checked={planned.includes(n)}
              onChange={v =>
                model.setPrep(
                  "launch",
                  {
                    platforms_planned: v
                      ? [...planned, n]
                      : planned.filter(x => x !== n),
                  },
                  true,
                )
              }
            >
              {n}
            </Toggle>
          ))}
        </div>
      </Section>
      {full ? <CreativeWords {...p} /> : null}
    </div>
  );
}

/** Each creative's words, edited in prep only (DESIGN 10.5). */
function CreativeWords({ d, model, updateAd }: LaunchControlProps) {
  const [pickId, setPickId] = useState<string>("");
  const all = [...d.launch.creatives, ...d.launch.metaCreatives];
  const c = all.find(x => x.id === pickId) ?? all[0];
  if (!c) return null;
  const metaText = record(model.prep.launch.meta_ad_text);
  const save = (patch: Record<string, unknown>) => {
    if (c.from === "upload") {
      void updateAd?.(c.id, patch).then(async () => {
        await model.reload();
        model.hub.post({ type: "ads" });
      });
      return;
    }
    const keys: Record<string, string> = {
      primaryText: "primary_text",
      headline: "headline",
      cta: "cta",
      language: "language",
      placement: "placement",
    };
    const cur = record(metaText[c.id]);
    const next = { ...cur };
    for (const [k, v] of Object.entries(patch)) next[keys[k] ?? k] = v;
    model.setPrep("launch", { meta_ad_text: { ...metaText, [c.id]: next } });
  };
  return (
    <Section title="Each creative's words">
      <select
        className="w-full rounded-lg border bg-background px-2 py-1.5 text-sm"
        value={c.id}
        onChange={e => setPickId(e.target.value)}
        aria-label="Creative"
      >
        {all.map(x => (
          <option key={x.id} value={x.id}>
            {x.from === "meta" ? "Meta · " : ""}
            {x.name}
          </option>
        ))}
      </select>
      <TextForm
        key={c.id}
        primary={c.primaryText ?? ""}
        headline={c.headline ?? ""}
        onSave={(primaryText, headline) =>
          save({ primaryText: primaryText || null, headline: headline || null })
        }
      />
      <Field
        label="Call to action"
        hint={c.cta ? null : "Default: Learn more."}
      >
        <select
          className="w-full rounded-lg border bg-background px-2 py-1.5 text-sm"
          value={c.cta ?? ""}
          onChange={e => save({ cta: e.target.value || null })}
          aria-label="Call to action"
        >
          <option value="">Learn more (default)</option>
          {(Object.keys(CTA) as Cta[]).map(k => (
            <option key={k} value={k}>
              {CTA[k].en}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex flex-wrap gap-3">
        <Segmented
          label="Language"
          value={c.language ?? "auto"}
          options={[
            { value: "auto", label: "Not set" },
            { value: "en", label: "EN" },
            { value: "ar", label: "AR" },
          ]}
          onChange={v => save({ language: v === "auto" ? null : v })}
        />
        <Segmented
          label="Placement"
          value={c.placement ?? "auto"}
          options={[
            { value: "auto", label: "By shape" },
            { value: "feed", label: "Feed" },
            { value: "reels", label: "Reels" },
            { value: "facebook", label: "Facebook" },
          ]}
          onChange={v => save({ placement: v === "auto" ? null : v })}
        />
        {c.from === "upload" ? (
          <Segmented
            label="Kind"
            value={c.starter ? "starter" : "custom"}
            options={[
              { value: "custom", label: "Their own" },
              { value: "starter", label: "Starter" },
            ]}
            onChange={v => save({ kind: v })}
          />
        ) : null}
      </div>
    </Section>
  );
}

/** A creative's primary text and headline, saved with one press. */
function TextForm({
  primary,
  headline,
  onSave,
}: {
  primary: string;
  headline: string;
  onSave: (primary: string, headline: string) => void;
}) {
  const [p, setP] = useState(primary);
  const [h, setH] = useState(headline);
  const changed = p.trim() !== primary || h.trim() !== headline;
  return (
    <div className="space-y-2">
      <Field
        label="Primary text"
        hint={
          primary
            ? null
            : "Missing: the phones draw grey bars, never invented words."
        }
      >
        <PrepText label="Primary text" rows={3} value={p} onChange={setP} />
      </Field>
      <Field label="Headline (the Facebook feed)">
        <PrepText label="Headline" value={h} onChange={setH} />
      </Field>
      <Button
        size="sm"
        variant="outline"
        disabled={!changed}
        onClick={() => onSave(p.trim(), h.trim())}
      >
        Save the words
      </Button>
    </div>
  );
}

// ------------------------------------------------------------ the call

function CallControls(p: LaunchControlProps) {
  const { d, model, full, sendKey } = p;
  const prep = model.prep.launch;
  const set = (patch: Overrides, now = false) =>
    model.setPrep("launch", patch, now);
  const call = d.launch.call;
  const subtitles = model.live.subtitles ?? model.lang === "en";
  const band = record(prep.budget_band);
  const bandAr = record(prep.budget_band_ar);
  return (
    <div className="space-y-4">
      <Section title="The call">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Dialect"
            value={call.dialect}
            options={[
              { value: "kw", label: "Kuwaiti" },
              { value: "sa", label: "Saudi" },
            ]}
            onChange={v => set({ dialect: v }, true)}
          />
          <Segmented
            label="Subtitles"
            value={subtitles ? "on" : "off"}
            options={[
              { value: "on", label: "Subtitles on" },
              { value: "off", label: "Off" },
            ]}
            onChange={v =>
              model.setLive(l => ({ ...l, subtitles: v === "on" }))
            }
          />
        </div>
        {sendKey ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => sendKey("p")}>
              <Play aria-hidden />
              Play / pause the call
            </Button>
            <Button size="sm" variant="outline" onClick={() => sendKey("r")}>
              <RotateCcw aria-hidden />
              Replay this stage
            </Button>
          </div>
        ) : null}
        <div className="text-xs text-muted-foreground">
          {call.dialectFrom === "prep"
            ? "Dialect set here."
            : call.dialectFrom === "country"
              ? "Dialect from their country."
              : call.dialectFrom === "areas"
                ? "Dialect from their service areas."
                : "No country on file: Kuwaiti, the script's own dialect."}{" "}
          Keys on the deck: → finishes a stage, P plays it all, S subtitles, D
          dialect.
        </div>
        {call.missing.length ? (
          <ul className="space-y-1 text-xs txt-warn">
            {call.missing.map(m => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        ) : null}
      </Section>
      <Section title="The story and the selling point">
        <Segmented<Pain>
          label="The customer's story"
          value={call.pain}
          options={[
            { value: "delays", label: "Delays" },
            { value: "design", label: "Design" },
            { value: "cost", label: "Cost" },
          ]}
          onChange={v => set({ pain: v }, true)}
        />
        <div className="text-xs text-muted-foreground">
          The call's story: {PAIN_STORY[call.pain]}. Pick the one their selling
          point answers.
        </div>
        <Twin
          label="Their selling point, one line"
          hint={
            <>
              Said by our caller: "At {d.nameEn}, …". From their Brand DNA,
              offer or call guide, never the script's own claims.
              {d.launch.refs.brandDna ? (
                <a
                  className="ms-1 underline"
                  href={d.launch.refs.brandDna}
                  target="_blank"
                  rel="noreferrer"
                >
                  Brand DNA
                </a>
              ) : null}
              {d.launch.refs.offer ? (
                <a
                  className="ms-1 underline"
                  href={d.launch.refs.offer}
                  target="_blank"
                  rel="noreferrer"
                >
                  Offer
                </a>
              ) : null}
            </>
          }
          k="selling_point"
          prep={prep}
          set={patch => set(patch)}
        />
      </Section>
      {full ? (
        <>
          <Section title="The call's other details">
            <Twin
              label="Who holds the consultation (with the title)"
              k="engineer"
              prep={prep}
              set={patch => set(patch)}
              hint="Eng. Khalid · المهندس خالد"
            />
            <Twin
              label="Their project, as the caller says it"
              k="project"
              prep={prep}
              set={patch => set(patch)}
              hint="Blank uses the service's family: 'your new kitchen'."
            />
            <Field
              label="The customer's budget band"
              hint={
                call.bandFrom === "prep"
                  ? "Set here."
                  : `From the table: ${call.band.band.en}.`
              }
            >
              {(["band", "answer", "note"] as const).map(k => (
                <div key={k} className="grid grid-cols-2 gap-1.5">
                  <PrepText
                    label={`Band ${k}`}
                    value={str(band[k])}
                    placeholder={
                      call.band[
                        k === "band"
                          ? "band"
                          : k === "answer"
                            ? "answer"
                            : "note"
                      ].en
                    }
                    onChange={v =>
                      set({ budget_band: { ...band, [k]: v.trim() || null } })
                    }
                  />
                  <PrepText
                    label={`Band ${k}, Arabic`}
                    rtl
                    value={str(bandAr[k])}
                    placeholder={
                      call.band[
                        k === "band"
                          ? "band"
                          : k === "answer"
                            ? "answer"
                            : "note"
                      ].ar
                    }
                    onChange={v =>
                      set({
                        budget_band_ar: { ...bandAr, [k]: v.trim() || null },
                      })
                    }
                  />
                </div>
              ))}
            </Field>
          </Section>
          <Toggle
            checked={call.guideChecked}
            onChange={v => set({ call_guide_checked: v || null }, true)}
          >
            I checked their call guide, and it's the page the dialer reads
          </Toggle>
        </>
      ) : null}
      {d.mode.dwy ? (
        <Section title="Done with you: links for their team">
          <a
            className="inline-flex items-center gap-1 text-sm underline"
            href={LINKS.scriptsDoc}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink aria-hidden className="size-3.5" />
            The sample script
          </a>
          <div className="text-xs text-muted-foreground">
            Their calling playbook is the DWY SOP copy on their card.
            {d.launch.refs.clickup ? (
              <a
                className="ms-1 underline"
                href={d.launch.refs.clickup}
                target="_blank"
                rel="noreferrer"
              >
                Open the card
              </a>
            ) : null}
          </div>
        </Section>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------ the others

function FreedomControls({ d, model, full }: LaunchControlProps) {
  const agreed = d.launch.agreedAt;
  const prep = model.prep.launch;
  const shown = strings(prep.shown_slides);
  const hidden = strings(prep.dos_donts_hidden);
  return (
    <div className="space-y-4">
      <Section title="Agreement">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={agreed ? "outline" : "default"}
            onClick={() =>
              model.setPrep(
                "launch",
                { creative_agreed_at: agreed ? null : true },
                true,
              )
            }
          >
            {agreed ? "Undo the agreement" : "We agree to test this way"}
          </Button>
          <span className="text-xs text-muted-foreground">
            {agreed
              ? "Recorded. The quiet stamp shows on the slide."
              : "Record it only when they say yes (or press A on the deck)."}
          </span>
        </div>
      </Section>
      <Toggle
        checked={shown.includes(PROOF_ID)}
        onChange={v =>
          model.setPrep(
            "launch",
            {
              shown_slides: v
                ? [...shown, PROOF_ID]
                : shown.filter(x => x !== PROOF_ID),
            },
            true,
          )
        }
      >
        Show "How a test runs" (the 20 tiles, an illustration)
      </Toggle>
      {full && (d.dosDonts.do.length || d.dosDonts.dont.length) ? (
        <Section title="Do's & Don'ts to show (NOTES never show)">
          {[...d.dosDonts.dont, ...d.dosDonts.do].map(x => (
            <Toggle
              key={x}
              checked={!hidden.includes(x)}
              onChange={v =>
                model.setPrep(
                  "launch",
                  {
                    dos_donts_hidden: v
                      ? hidden.filter(y => y !== x)
                      : [...hidden, x],
                  },
                  true,
                )
              }
            >
              {x}
            </Toggle>
          ))}
        </Section>
      ) : null}
      <Section title="Red lines typed on the call">
        <PrepText
          label="Red lines"
          rows={3}
          value={strings(model.prep.onboarding.red_lines).join("\n")}
          onChange={v =>
            model.setPrep("onboarding", {
              red_lines: v
                .split("\n")
                .map(x => x.trim())
                .filter(Boolean),
            })
          }
        />
        <div className="text-xs text-muted-foreground">
          After the call, copy them to the card's Do's & Don'ts.
        </div>
      </Section>
    </div>
  );
}

function FormControls({ d, model, full }: LaunchControlProps) {
  const prep = model.prep.launch;
  const funnels = d.launch.funnels;
  const confirmed = str(prep.form_confirmed);
  const typed = Array.isArray(prep.form_questions)
    ? (prep.form_questions as Record<string, unknown>[])
    : [];
  const asText = typed
    .map(
      q =>
        `${str(q.label)} | ${strings(q.options).join(", ")}${q.isGate ? " | filters" : ""}`,
    )
    .join("\n");
  return (
    <div className="space-y-4">
      <Section title="Their form">
        {funnels.length ? (
          <div className="space-y-1.5">
            {funnels.map(f => {
              const id = f.formId ?? f.sourceId;
              return (
                <Toggle
                  key={f.sourceId}
                  checked={confirmed === id}
                  onChange={v =>
                    model.setPrep(
                      "launch",
                      { form_confirmed: v ? id : null },
                      true,
                    )
                  }
                >
                  This is their form: {f.formName ?? f.kind ?? f.sourceId}
                  <span className="block text-xs text-muted-foreground">
                    {f.kind ?? "Form"} · {f.questions.length} questions
                    {f.formStatus ? ` · ${f.formStatus}` : ""}
                  </span>
                </Toggle>
              );
            })}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">
            No forms read from their campaigns yet. Type the questions below, or
            the slide stays hidden.
          </div>
        )}
      </Section>
      {full ? (
        <>
          <Field
            label="Or type the questions: question | options, comma separated | filters"
            hint="Typed questions take the place of the form's."
          >
            <PrepText
              label="Form questions"
              rows={4}
              value={asText}
              onChange={v => {
                const qs = v
                  .split("\n")
                  .map(line => line.split("|").map(x => x.trim()))
                  .filter(([label]) => label)
                  .slice(0, 12)
                  .map(([label, opts = "", gate = ""]) => ({
                    label,
                    options: opts
                      .split(",")
                      .map(o => o.trim())
                      .filter(Boolean),
                    isGate: /filter|gate|فلتر/i.test(gate),
                  }));
                model.setPrep("launch", {
                  form_questions: qs.length ? qs : null,
                });
              }}
            />
          </Field>
          <Toggle
            checked={d.launch.welcomeVideo}
            onChange={v =>
              model.setPrep("launch", { welcome_video: v || null }, true)
            }
          >
            Their welcome message has a short video about them
          </Toggle>
          <Field label="Their thank-you words (blank: the default)">
            <PrepText
              label="Thank-you"
              rows={2}
              value={str(prep.thank_you)}
              placeholder={LAUNCH.form.thanksDefault.en}
              onChange={v => model.setPrep("launch", { thank_you: v })}
            />
            <PrepText
              label="Thank-you, Arabic"
              rows={2}
              rtl
              value={str(prep.thank_you_ar)}
              placeholder={LAUNCH.form.thanksDefault.ar}
              onChange={v => model.setPrep("launch", { thank_you_ar: v })}
            />
          </Field>
        </>
      ) : null}
    </div>
  );
}

function CoverControls({ d, model }: LaunchControlProps) {
  const custom = d.launch.creatives.filter(c => !c.starter);
  return (
    <div className="space-y-4">
      <Field
        label="Go-live date"
        hint={
          d.goLive
            ? "The cover and the 90 days count from it."
            : "None on the card. Without it, the cover shows no date."
        }
      >
        <input
          type="date"
          className="rounded-lg border bg-background px-2 py-1.5 text-sm"
          value={str(model.prep.launch.go_live) || (d.goLive ?? "")}
          onChange={e =>
            model.setPrep("launch", { go_live: e.target.value || null }, true)
          }
          aria-label="Go-live date"
        />
      </Field>
      <Field
        label="The cover's creative (their own, never a starter)"
        hint={
          custom.length
            ? null
            : "No custom creatives yet: the cover shows the faint lanes."
        }
      >
        <select
          className="w-full rounded-lg border bg-background px-2 py-1.5 text-sm"
          value={d.launch.cover?.id ?? ""}
          onChange={e =>
            model.setPrep(
              "launch",
              { cover_creative: e.target.value || null },
              true,
            )
          }
          aria-label="Cover creative"
        >
          <option value="">The faint lanes</option>
          {custom.map(c => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}

function partText(d: DeckData): string {
  const P = LAUNCH.part;
  const lang = d.lang;
  return [
    t(P.title, lang),
    ...P.rows.map(
      r =>
        `- ${t(d.mode.dwy && r.jobDwy ? r.jobDwy : r.job, lang)}. ${t(d.mode.dwy && r.whyDwy ? r.whyDwy : r.why, lang)}`,
    ),
  ].join("\n");
}

/** The launch deck's controls for one slide. */
export function LaunchControls(p: LaunchControlProps) {
  const { slideId, d, model, book } = p;
  switch (slideId) {
    case "cover":
      return <CoverControls {...p} />;
    case "journey":
      return (
        <div className="space-y-3">
          <Toggle
            checked={d.launch.bookingVideo}
            onChange={v =>
              model.setPrep("launch", { booking_video: v || null }, true)
            }
          >
            Their booking confirmation carries a short video about them
          </Toggle>
          <div className="text-xs text-muted-foreground">
            Google Calendar:{" "}
            {d.launch.calendar === "done"
              ? "connected (stop 5 says so plainly)."
              : d.launch.calendar === "todo"
                ? "not connected: stop 5 asks them to connect it."
                : "not checked yet."}
          </div>
        </div>
      );
    case "ads":
      return <AdsControls {...p} />;
    case "creative-freedom":
      return <FreedomControls {...p} />;
    case "form":
      return <FormControls {...p} />;
    case "call":
      return <CallControls {...p} />;
    case "portal":
      return (
        <div className="space-y-3">
          <CopyButton
            text={`Mahara OS: ${LINKS.portal}\nInstall it on your phone: ${LINKS.portalInstall}`}
            label="Copy the portal links for the group"
          />
          {d.mode.dwy ? (
            <Toggle
              checked={d.launch.dwyOs}
              onChange={v =>
                model.setPrep(
                  "onboarding",
                  { dwy_os_approved: v || null },
                  true,
                )
              }
            >
              Mahara OS is approved for this client
              <span className="block text-xs text-muted-foreground">
                Until it is, the slide shows their CRM stages.
              </span>
            </Toggle>
          ) : null}
        </div>
      );
    case "your-part":
      return (
        <CopyButton text={partText(d)} label='Copy "Your part" for the group' />
      );
    case "first-90-days":
    case "green-light":
      return book ? (
        <div className="flex flex-wrap gap-2">
          {book(
            "checkin",
            d.next.checkin
              ? "Book the first check-in again"
              : "Book the first check-in",
          )}
        </div>
      ) : null;
    default:
      return null;
  }
}

export type { DeckKind };
export { partText };
