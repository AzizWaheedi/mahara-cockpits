import { Play, Star } from "lucide-react";
import {
  type CSSProperties,
  type DragEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CTA, digits, type L, LAUNCH, SHARED, t, tf } from "./content";
import { appLanguage, type Creative, phoneFor, shapeOf } from "./creative";
import type { SlideCtx } from "./deckContext";
import { defaultPhones, PHONES, type PhoneKey } from "./launchData";
import type { Identity } from "./mockups/Identity";
import { FbFeed, IgFeed, Phone, phoneWidth, ReelStory } from "./mockups/Phones";
import { Logo, type PlatformMark } from "./platforms";
import {
  type LocalItem,
  localCreative,
  trayCreatives,
  useLocalAds,
} from "./uploads";

/**
 * The ads slide's working parts (DESIGN 8.3, 10): the tray of their
 * creatives and the three phones, with the swap. On the call the swap is
 * the demonstration, so it is instant and nothing else on the canvas
 * moves: a click on a thumbnail puts it in the phone that suits its shape
 * (or the phone in focus), 1, 2 and 3 place the selected one, and a drag
 * puts it on any phone. Adding a file lives in the notes window; here only
 * a thin bar along the phone's foot says a save is running.
 */

export type TrayCreative = Creative & { local?: LocalItem };

const MARK: Record<PhoneKey, PlatformMark> = {
  feed: "instagram",
  reels: "instagram",
  facebook: "facebook",
};
const FRAME: Record<PhoneKey, L> = {
  feed: SHARED.frame.feed,
  reels: SHARED.frame.reels,
  facebook: SHARED.frame.facebook,
};

/** Everything the slides know about the client's creatives, this window's files included. */
export function useCreatives(ctx: SlideCtx) {
  const local = useLocalAds();
  const L = ctx.d.launch;
  return useMemo(() => {
    const tray: TrayCreative[] = trayCreatives(L.creatives, local);
    const meta: TrayCreative[] = L.metaCreatives;
    const byId = new Map<string, TrayCreative>();
    for (const c of [...tray, ...meta]) byId.set(c.id, c);
    // A file saved on the call: its local id still finds it.
    for (const i of local)
      if (!byId.has(i.id)) {
        const saved = i.savedId ? byId.get(i.savedId) : null;
        byId.set(i.id, saved ?? { ...localCreative(i), local: i });
      }
    const base = defaultPhones([...tray, ...meta], L.phonesPrep);
    const placed = { ...base, ...(ctx.live.phones ?? {}) };
    const phones = Object.fromEntries(
      PHONES.map(k => [
        k,
        placed[k] ? (byId.get(placed[k] as string) ?? null) : null,
      ]),
    ) as Record<PhoneKey, TrayCreative | null>;
    const app = appLanguage([...tray, ...meta], ctx.lang);
    return { tray, meta, byId, phones, placed, app, local };
  }, [L, local, ctx.live.phones, ctx.lang]);
}

/** Which phone a stop of the ads slide focuses (stop 0 is the overview). */
export const focusOf = (tour: number): PhoneKey | null =>
  tour >= 1 && tour <= 3 ? PHONES[tour - 1] : null;

/** Put a creative on a phone: the one named, the one in focus, or its shape's. */
export function placeCreative(
  ctx: SlideCtx,
  model: ReturnType<typeof useCreatives>,
  id: string,
  phone?: PhoneKey | null,
) {
  const c = model.byId.get(id);
  if (!c) return;
  const target =
    phone ??
    (ctx.d.deck === "launch" ? focusOf(ctx.tour) : null) ??
    phoneFor(c);
  const before = { ...model.placed } as Partial<Record<PhoneKey, string>>;
  const after = { ...before, [target]: id };
  ctx.setLive(l => ({
    ...l,
    phones: after,
    selected: id,
    undo: { phones: before, at: Date.now() },
  }));
  // In prep the arrangement is kept for the call (saved creatives only).
  if (!ctx.presenting) {
    const saved = Object.fromEntries(
      Object.entries(after).filter(
        ([, v]) => typeof v === "string" && !v.startsWith("local-"),
      ),
    );
    ctx.save({ phones: Object.keys(saved).length ? saved : null });
  }
}

const letGo = (e: { currentTarget: HTMLElement }) => e.currentTarget.blur();

function duration(seconds: number | null) {
  if (!seconds) return null;
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ------------------------------------------------------------- the tray

export function AdTray({
  ctx,
  model,
}: {
  ctx: SlideCtx;
  model: ReturnType<typeof useCreatives>;
}) {
  const { lang, live, setLive } = ctx;
  const A = LAUNCH.ads;
  const tab = live.tray === "meta" && model.meta.length ? "meta" : "uploaded";
  const items = tab === "meta" ? model.meta : model.tray;
  const onPhone = new Map<string, PhoneKey>();
  for (const k of PHONES) {
    const id = model.placed[k];
    if (id && !onPhone.has(id)) onPhone.set(id, k);
  }
  const pick = ctx.d.launch.pick;
  return (
    <section className="dkc-tray" aria-label={t(A.tray, lang)}>
      <div className="dkc-tray-head">
        <span className="dkc-tray-title">{t(A.tray, lang)}</span>
        {/* No count beside an empty tray: an empty tray says so itself. */}
        {model.tray.length + model.meta.length ? (
          <span className="dkc-tray-count">
            {digits(model.tray.length + model.meta.length, lang)}
          </span>
        ) : null}
      </div>
      {model.meta.length ? (
        <div className="dkc-tray-tabs" role="tablist">
          {(["uploaded", "meta"] as const).map(k => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              className="dkc-press"
              onClick={() => setLive(l => ({ ...l, tray: k }))}
              onPointerUp={letGo}
            >
              {t(k === "meta" ? A.meta : A.uploaded, lang)}
              {k === "meta" ? (
                <span className="dkc-tray-n">
                  {digits(model.meta.length, lang)}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
      {items.length ? (
        <ul className="dkc-tray-grid">
          {items.map(c => {
            const on = onPhone.get(c.id);
            const shape = shapeOf(c.ratio);
            const failed = c.local?.phase === "failed";
            return (
              <li key={c.id}>
                <button
                  type="button"
                  className="dkc-thumb dkc-press"
                  data-on={on ? "" : undefined}
                  data-selected={live.selected === c.id ? "" : undefined}
                  data-failed={failed ? "" : undefined}
                  draggable
                  onDragStart={(e: DragEvent) => {
                    e.dataTransfer.setData("text/x-mahara-creative", c.id);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => placeCreative(ctx, model, c.id)}
                  onPointerUp={letGo}
                  aria-label={`${c.name}, ${c.video ? "video" : "picture"}, ${shape}${c.seconds ? `, ${duration(c.seconds)}` : ""}${on ? `. On ${FRAME[on].en}` : ""}`}
                >
                  <span className="dkc-thumb-img">
                    {(c.poster ?? c.url) ? (
                      <img
                        src={(c.poster ?? c.url) as string}
                        alt=""
                        draggable={false}
                      />
                    ) : null}
                    {c.starter ? (
                      <span className="dkc-thumb-chip">
                        {t(A.starterChip, lang)}
                      </span>
                    ) : null}
                    {pick === c.id ? (
                      <Star className="dkc-thumb-star" aria-hidden />
                    ) : null}
                    {c.video ? (
                      <span className="dkc-thumb-play" aria-hidden>
                        <Play />
                      </span>
                    ) : null}
                  </span>
                  <span className="dkc-thumb-cap">
                    {on ? (
                      <span className="dkc-thumb-on">
                        {t(A.onPhone[on], lang)}
                      </span>
                    ) : (
                      <span className="dk-ltr dkc-thumb-spec">
                        {shape}
                        {c.video && c.seconds
                          ? ` · ${duration(c.seconds)}`
                          : ""}
                        {c.language ? ` · ${c.language.toUpperCase()}` : ""}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="dkc-tray-empty">
          {t(tab === "meta" ? A.metaEmpty : A.empty, lang)}
        </p>
      )}
    </section>
  );
}

// ----------------------------------------------------------- the phones

/** The phone area's size, and a phone's native size (its focus size). */
export const AREA_W = 1160;
export const AREA_H = 852;
const NATIVE_H = 852;
const NATIVE_W = phoneWidth(NATIVE_H);
const MID_H = 700;
const SIDE_H = 630;
const MID = MID_H / NATIVE_H;
const SIDE = SIDE_H / NATIVE_H;

interface Place {
  x: number;
  y: number;
  s: number;
  o: number;
}

/** Where each phone sits: the overview, or one in focus (DESIGN 8.3). */
export function layout(focus: PhoneKey | null): Record<PhoneKey, Place> {
  const mw = NATIVE_W * MID;
  const sw = NATIVE_W * SIDE;
  const midX = (AREA_W - mw) / 2;
  if (!focus)
    return {
      feed: { x: midX - 64 - sw, y: (MID_H - SIDE_H) / 2, s: SIDE, o: 1 },
      reels: { x: midX, y: 0, s: MID, o: 1 },
      facebook: { x: midX + mw + 64, y: (MID_H - SIDE_H) / 2, s: SIDE, o: 1 },
    };
  const f = PHONES.indexOf(focus);
  const fx = 330;
  const out = {} as Record<PhoneKey, Place>;
  PHONES.forEach((k, j) => {
    if (j === f) out[k] = { x: fx, y: 0, s: 1, o: 1 };
    // The other two slide outward, past the area's edges, and fade.
    else if (j === f - 1) out[k] = { x: -sw - 40, y: 93, s: SIDE, o: 0.25 };
    else if (j === f - 2) out[k] = { x: -sw * 2 - 80, y: 93, s: SIDE, o: 0 };
    else if (j === f + 1) out[k] = { x: AREA_W + 40, y: 93, s: SIDE, o: 0.25 };
    else out[k] = { x: AREA_W + sw + 80, y: 93, s: SIDE, o: 0 };
  });
  return out;
}

interface Leader {
  key: string;
  label: string;
  /** Your page and logo sits at the phone's start: its label goes that way. */
  side: "start" | "end";
  /** The part's anchor, in the area's logical coordinates. */
  ax: number;
  ay: number;
  /** Where its label sits. */
  ly: number;
}

const PARTS = ["who", "sponsored", "media", "words", "cta"] as const;

export function PhoneRow({
  ctx,
  model,
  who,
  pageName,
}: {
  ctx: SlideCtx;
  model: ReturnType<typeof useCreatives>;
  who: Identity;
  pageName: string;
}) {
  const { lang, tour, still } = ctx;
  const focus = focusOf(tour);
  const places = layout(focus);
  const rtl = lang === "ar";
  const phoneRefs = useRef<Partial<Record<PhoneKey, HTMLDivElement | null>>>(
    {},
  );
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [over, setOver] = useState<PhoneKey | null>(null);
  const A = LAUNCH.ads;
  const focused = focus ? model.phones[focus] : null;
  const cropped =
    focus && focus !== "reels" && focused && shapeOf(focused.ratio) === "9:16";
  // The button named as the phone shows it, in the phone's own language.
  const ctaText = t(CTA[focused?.cta ?? "LEARN_MORE"], model.app);

  // The leaders name the parts of the phone in focus, measured where they
  // are drawn (a mirrored phone included), in the phone's own units.
  // biome-ignore lint/correctness/useExhaustiveDependencies: measured again when what is drawn changes
  useLayoutEffect(() => {
    if (!focus) {
      setLeaders([]);
      return;
    }
    const el = phoneRefs.current[focus];
    if (!el) return;
    const box = el.getBoundingClientRect();
    const k = box.width / NATIVE_W || 1;
    const P = places[focus];
    const found: Leader[] = [];
    for (const part of PARTS) {
      const node = el.querySelector<HTMLElement>(`[data-part="${part}"]`);
      if (!node) continue;
      const r = node.getBoundingClientRect();
      // The page's avatar sits at the app's start: its label goes to that side.
      const side = part === "who" && model.app === lang ? "start" : "end";
      // Every dot sits just outside the frame, on the edge nearest its
      // label, level with the part it names: no dot and no line ever
      // crosses the app's own UI (a caption, the menu, a headline).
      const ax = side === "start" ? P.x - 10 : P.x + NATIVE_W + 10;
      const ay = P.y + ((r.top + r.bottom) / 2 - box.top) / k;
      const label =
        part === "who"
          ? t(A.leaders.who, lang)
          : part === "sponsored"
            ? t(A.leaders.sponsored, lang)
            : part === "media"
              ? t(cropped ? A.leaders.crop : A.leaders.media, lang)
              : part === "words"
                ? t(A.leaders.words, lang)
                : tf(A.leaders.cta, lang, { cta: ctaText });
      found.push({ key: part, label, side, ax, ay, ly: ay });
    }
    // Spread each side's labels so none sits on another (60 px apart), and
    // two parts on one row (the avatar and "Sponsored") get two dots.
    for (const side of ["start", "end"] as const) {
      const list = found
        .filter(f => f.side === side)
        .sort((a, b) => a.ay - b.ay);
      for (let i = 1; i < list.length; i++)
        if (list[i].ay - list[i - 1].ay < 16) {
          list[i].ay = list[i - 1].ay + 16;
          list[i].ly = Math.max(list[i].ly, list[i].ay);
        }
      for (let i = 1; i < list.length; i++)
        if (list[i].ly - list[i - 1].ly < 60) list[i].ly = list[i - 1].ly + 60;
      const last = list.at(-1);
      if (last && last.ly > AREA_H - 30) {
        const lift = last.ly - (AREA_H - 30);
        for (const f of list) f.ly -= lift;
      }
    }
    setLeaders(found);
  }, [focus, focused?.id, lang, cropped, ctaText, model.app]);

  const phys = (x: number, w = 0) => (rtl ? AREA_W - x - w : x);
  const labelX = 330 + NATIVE_W + 56;
  /** Where a start-side label ends (logical x). */
  const labelEnd = 330 - 56;
  const props = { who, pageName, app: model.app, deck: lang };

  const drop = (k: PhoneKey) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData("text/x-mahara-creative");
    if (id) {
      placeCreative(ctx, model, id, k);
      return;
    }
    const files = [...e.dataTransfer.files];
    if (files.length && ctx.ads) void ctx.ads.add(files.slice(0, 1), k);
  };

  return (
    <div
      className="dkc-phones"
      style={{ width: AREA_W, height: AREA_H }}
      data-focus={focus ?? undefined}
      data-still={still ? "" : undefined}
    >
      {PHONES.map(k => {
        const P = places[k];
        const c = model.phones[k];
        const play =
          !still && Boolean(c?.video) && (focus ? focus === k : k === "reels");
        const progress =
          c?.local && (c.local.phase === "saving" || c.local.phase === "saved")
            ? c.local.phase === "saved"
              ? 1
              : (c.local.progress ?? 0)
            : null;
        const screen =
          k === "feed" ? (
            <IgFeed creative={c} play={play} {...props} />
          ) : k === "reels" ? (
            <ReelStory creative={c} play={play} {...props} />
          ) : (
            <FbFeed creative={c} play={play} {...props} />
          );
        return (
          // biome-ignore lint/a11y/noStaticElementInteractions: a drop target for dragged thumbnails and files; the keys 1 to 3 and the notes window are the keyboard path
          <div
            key={k}
            className="dkc-phone-slot"
            data-over={over === k ? "" : undefined}
            style={
              {
                width: NATIVE_W,
                height: NATIVE_H,
                transform: `translate(${phys(P.x, NATIVE_W * P.s)}px, ${P.y}px) scale(${P.s})`,
                opacity: P.o,
              } as CSSProperties
            }
            ref={el => {
              phoneRefs.current[k] = el;
            }}
            onDragOver={e => {
              e.preventDefault();
              setOver(k);
            }}
            onDragLeave={() => setOver(o => (o === k ? null : o))}
            onDrop={drop(k)}
          >
            <Phone
              height={NATIVE_H}
              label={t(FRAME[k], lang)}
              progress={progress}
            >
              {screen}
            </Phone>
          </div>
        );
      })}
      {focus ? null : (
        <div
          className="dkc-phone-labels"
          aria-hidden
          data-tagged={
            PHONES.some(k => model.phones[k]?.starter) ? "" : undefined
          }
        >
          {PHONES.map(k => {
            const P = places[k];
            const w = NATIVE_W * P.s;
            return (
              <span
                key={k}
                className="dkc-phone-label"
                style={{ insetInlineStart: P.x, width: w }}
              >
                <span className="dk-label">
                  <Logo mark={MARK[k]} size={28} />
                  {t(FRAME[k], lang)}
                </span>
                {model.phones[k]?.starter ? (
                  <span className="dk-tag">{t(SHARED.tag.starter, lang)}</span>
                ) : null}
              </span>
            );
          })}
          <p className="dk-small dk-ink2 dkc-phones-foot">{t(A.foot, lang)}</p>
        </div>
      )}
      {leaders.length ? (
        <svg
          className="dkc-leaders"
          width={AREA_W}
          height={AREA_H}
          viewBox={`0 0 ${AREA_W} ${AREA_H}`}
          aria-hidden
        >
          {leaders.map(l => {
            const bend = l.side === "end" ? 330 + NATIVE_W + 20 : 330 - 20;
            const to = l.side === "end" ? labelX - 14 : labelEnd + 14;
            return (
              <g key={l.key}>
                <path
                  d={`M ${phys(l.ax)} ${l.ay} L ${phys(bend)} ${l.ay} L ${phys(to)} ${l.ly}`}
                  fill="none"
                  stroke="var(--dk-line-strong)"
                  strokeWidth={2}
                />
                <circle cx={phys(l.ax)} cy={l.ay} r={6} fill="var(--dk-teal)" />
              </g>
            );
          })}
        </svg>
      ) : null}
      {leaders.map(l => (
        <span
          key={l.key}
          className="dkc-leader-label"
          data-side={l.side}
          style={
            l.side === "end"
              ? { insetInlineStart: labelX, top: l.ly }
              : { insetInlineEnd: AREA_W - labelEnd, top: l.ly }
          }
        >
          {l.label}
        </span>
      ))}
      {focus && focused?.starter ? (
        <span
          className="dk-tag dkc-focus-tag"
          style={{ insetInlineStart: labelX }}
        >
          {t(SHARED.tag.starter, lang)}
        </span>
      ) : null}
    </div>
  );
}
