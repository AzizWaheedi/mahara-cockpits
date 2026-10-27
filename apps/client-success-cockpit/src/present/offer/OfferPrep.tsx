import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { DeckModel } from "../useDeckModel";
import { belowList, listOf, validPrice } from "./price";
import { RevisionCloud } from "./slides/RevisionCloud";
import type { CaptureMark, OfferModel } from "./useOffer";
export function OfferPrep({
  offer: m,
  model,
}: {
  offer: OfferModel | null | undefined;
  model: DeckModel;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState<string | null>(null),
    [when, setWhen] = useState(new Date().toISOString().slice(0, 10)),
    [searched, setSearched] = useState("");
  const [prices, setPrices] = useState<Record<string, string> | null>(null),
    [reason, setReason] = useState<string | null>(null);
  const logoRequests = useRef(new Map<string, string>());
  const uploadId = useRef<{ file: File; id: string } | null>(null),
    start = useRef<{ x: number; y: number } | null>(null);
  const [mark, setMark] = useState<CaptureMark | null>(null);
  const [logos, setLogos] = useState<Array<{ url: string; source: string }>>(
    [],
  );
  if (!m) return null;
  const p = m.prep;
  const save = (patch: Record<string, unknown>) =>
    model.setPrep("offer_website", patch, true);
  const action = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      await model.reload();
      setMessage("Saved.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const text = (key: string) =>
    typeof p[key] === "string" ? (p[key] as string) : "";
  const selected = Array.isArray(p.captures)
    ? (p.captures as Array<{ id: string; mark?: CaptureMark }>)
    : [];
  const price = Object.fromEntries(
    m.row?.parts.map(part => [
      part.key,
      Number(prices?.[part.key] ?? m.opening?.[part.key] ?? ""),
    ]) ?? [],
  );
  const low = m.row ? belowList(price, m.row) : false;
  const first = m.captures[0];
  return (
    <div className="space-y-4" data-offer-prep>
      <section className="dko-panel">
        <h2>Prepare one clear conversation</h2>
        <p className="dko-help">
          Private prep. The client sees only the presentation. Captures and
          opening prices are saved to this client's record.
        </p>
        {message ? <p role="status">{message}</p> : null}
        {m.sources.mode === "client_asked" ? (
          <p className="dko-help">
            Client asked. The gate's original flags stay on the pitch record.
          </p>
        ) : null}
      </section>
      <section className="dko-panel">
        <h2>01 · What we saw</h2>
        <p className="dko-help">
          {m.sources.site.verdict === "not_checked"
            ? "Site not checked yet"
            : (m.sources.site.note ??
              m.sources.site.verdict.replaceAll("_", " "))}
        </p>
        {m.sources.site.disagree ? (
          <p className="text-sm txt-warn">
            The sources have different website addresses. Choose the right one
            before checking.
          </p>
        ) : null}
        {m.sources.site.urls.map(v => (
          <p key={v.url + v.from} className="dko-help">
            {v.from}:{" "}
            <a
              href={v.url}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              {v.url}
            </a>
          </p>
        ))}
        <label className="dko-field">
          Website address
          <input
            type="url"
            defaultValue={text("site_url")}
            onBlur={e => save({ site_url: e.target.value || null })}
          />
        </label>
        <div className="flex gap-3">
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !m.io}
            onClick={() =>
              void action(() => m.io!.siteCheck(text("site_url") || undefined))
            }
          >
            Check the site
          </Button>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={p.site_thin === true}
              onChange={e => save({ site_thin: e.target.checked })}
            />
            It doesn't show their work
          </label>
        </div>
        <div className="dko-fields">
          <label className="dko-field">
            Capture date
            <input
              type="date"
              value={when}
              max={new Date().toISOString().slice(0, 10)}
              onChange={e => setWhen(e.target.value)}
            />
          </label>
          <label className="dko-field">
            Searched from
            <input
              value={searched}
              maxLength={80}
              placeholder="City, if relevant"
              onChange={e => setSearched(e.target.value)}
            />
          </label>
        </div>
        <label className="dko-field">
          Add a real screenshot
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy || !m.io}
            onChange={e => {
              const file = e.target.files?.[0];
              if (!file || !m.io) return;
              if (uploadId.current?.file !== file)
                uploadId.current = { file, id: crypto.randomUUID() };
              void action(async () => {
                const f = await m.io!.upload(
                  file,
                  when,
                  searched,
                  uploadId.current!.id,
                );
                if (selected.length < 3)
                  save({ captures: [...selected, { id: f.id }] });
              });
            }}
          />
        </label>
        <div className="dko-capture-list">
          {m.sources.files.map(f => (
            <div className="rounded border p-2" key={f.id}>
              {f.url ? <img src={f.url} alt={f.caption ?? f.fileName} /> : null}
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={selected.some(s => s.id === f.id)}
                  disabled={
                    !selected.some(s => s.id === f.id) && selected.length >= 3
                  }
                  onChange={e =>
                    save({
                      captures: e.target.checked
                        ? [...selected, { id: f.id }]
                        : selected.filter(s => s.id !== f.id),
                    })
                  }
                />
                {f.capturedOn}
              </label>
              <input
                aria-label="Capture caption"
                maxLength={120}
                className="mt-2 w-full bg-transparent text-xs"
                defaultValue={f.caption ?? ""}
                onBlur={e =>
                  void action(() =>
                    m.io!.updateFile(f.id, { caption: e.target.value || null }),
                  )
                }
              />
              <button
                type="button"
                className="text-xs text-muted-foreground underline"
                onClick={() =>
                  void action(async () => {
                    save({ captures: selected.filter(s => s.id !== f.id) });
                    await model.flush();
                    await m.io!.removeFile(f.id);
                  })
                }
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        {first?.url ? (
          <>
            <p className="dko-help">
              Drag around the part to discuss. This marks the actual screenshot.
            </p>
            <div
              className="dko-capture-edit"
              onPointerDown={e => {
                e.currentTarget.setPointerCapture(e.pointerId);
                const r = e.currentTarget.getBoundingClientRect();
                start.current = {
                  x: (e.clientX - r.left) / r.width,
                  y: (e.clientY - r.top) / r.height,
                };
              }}
              onPointerMove={e => {
                if (!start.current) return;
                const r = e.currentTarget.getBoundingClientRect(),
                  x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
                  y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
                setMark({
                  x: Math.min(x, start.current.x),
                  y: Math.min(y, start.current.y),
                  w: Math.abs(x - start.current.x),
                  h: Math.abs(y - start.current.y),
                });
              }}
              onPointerUp={() => {
                if (mark && mark.w >= 0.04 && mark.h >= 0.04)
                  save({
                    captures: selected.map(s =>
                      s.id === first.id ? { ...s, mark } : s,
                    ),
                  });
                start.current = null;
              }}
              onPointerCancel={() => {
                start.current = null;
                setMark(null);
              }}
            >
              <img src={first.url} alt="Capture to mark" />
              <RevisionCloud mark={mark ?? first.mark} />
            </div>
          </>
        ) : null}
      </section>
      <section className="dko-panel">
        <h2>02 · Their words</h2>
        <label className="dko-field">
          Use their answer
          <select
            value={text("goal_pick") || "goal90"}
            onChange={e => save({ goal_pick: e.target.value })}
          >
            <option value="goal90">90-day goal</option>
            <option value="goal12_24">One to two year goal</option>
            <option value="challenges">What's in the way</option>
            <option value="why">Why they joined</option>
            <option value="typed">Something they told me</option>
          </select>
        </label>
        {p.goal_pick === "typed" ? (
          <div className="dko-fields">
            <label className="dko-field">
              Their exact words
              <textarea
                maxLength={300}
                defaultValue={text("goal_typed")}
                onBlur={e => save({ goal_typed: e.target.value || null })}
              />
            </label>
            <label className="dko-field">
              Said on
              <input
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                defaultValue={text("goal_typed_on")}
                onBlur={e => save({ goal_typed_on: e.target.value || null })}
              />
            </label>
          </div>
        ) : (
          <blockquote className="border-l-2 border-primary pl-4 text-sm">
            {m.goal?.answer ??
              "No answer recorded. The slide asks a question instead."}
          </blockquote>
        )}
        <label className="dko-field">
          Spoken Arabic
          <select
            value={text("dialect") || m.dialect}
            onChange={e => save({ dialect: e.target.value })}
          >
            <option value="kw">Kuwaiti</option>
            <option value="sa">Saudi</option>
          </select>
        </label>
      </section>
      <section className="dko-panel">
        <h2>03 · Their opening price</h2>
        <p className="dko-help">
          You choose the price. Below a set list price, add one line explaining
          why. The lower price discussed later stays in private notes.
        </p>
        <div className="dko-fields">
          {m.row?.parts.map(part => (
            <label key={part.key} className="dko-field">
              {part.key} · USD
              <input
                type="number"
                min="1"
                max="1000000"
                step="0.01"
                disabled={m.row?.locked}
                value={
                  prices?.[part.key] ?? String(m.opening?.[part.key] ?? "")
                }
                onChange={e =>
                  setPrices(old => ({
                    ...Object.fromEntries(
                      m.row!.parts.map(x => [
                        x.key,
                        String(m.opening?.[x.key] ?? ""),
                      ]),
                    ),
                    ...old,
                    [part.key]: e.target.value,
                  }))
                }
              />
              <small>
                {part.amount === null
                  ? "List not set"
                  : `List: ${part.amount} USD`}
              </small>
            </label>
          ))}
        </div>
        {low ? (
          <label className="dko-field">
            Why below list
            <input
              maxLength={140}
              value={reason ?? text("opening_reason")}
              onChange={e => setReason(e.target.value)}
            />
          </label>
        ) : null}
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={
              busy ||
              !m.row ||
              m.row.locked ||
              Object.values(price).some(n => !validPrice(n)) ||
              (low && !(reason ?? text("opening_reason")).trim())
            }
            onClick={() => {
              save({
                opening_price: price,
                opening_reason: (reason ?? text("opening_reason")) || null,
              });
              setMessage(
                "Opening price queued. The save status below confirms when it is recorded.",
              );
            }}
          >
            Save opening price
          </Button>
          {m.row && listOf(m.row) ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setPrices(null);
                save({ opening_price: null, opening_reason: null });
              }}
            >
              Use list
            </Button>
          ) : null}
        </div>
        {m.priceProblem ? (
          <p className="text-sm txt-warn">{m.priceProblem}</p>
        ) : null}
        <label className="dko-field">
          Existing payment link
          <input
            type="url"
            defaultValue={text("payment_link")}
            placeholder="Whop checkout or ecom invoice"
            onBlur={e => save({ payment_link: e.target.value || null })}
          />
          <small>
            Paste a real existing checkout. No checkout is created here.
          </small>
        </label>
        <ProjectValue offer={m} save={save} />
      </section>
      <section className="dko-panel">
        <h2>04 · The client's mark and photos</h2>
        <div className="dko-capture-list">
          {model.loaded?.ads
            .filter(
              a => a.mime.startsWith("image/") && a.kind !== "logo" && a.url,
            )
            .map(a => (
              <label key={a.id} className="rounded border p-2 text-xs">
                <img src={a.url ?? ""} alt={a.fileName ?? "Project image"} />
                <span className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={
                      Array.isArray(p.example_stills) &&
                      p.example_stills.includes(a.id)
                    }
                    disabled={
                      Array.isArray(p.example_stills) &&
                      p.example_stills.length >= 3 &&
                      !p.example_stills.includes(a.id)
                    }
                    onChange={e => {
                      const ids = Array.isArray(p.example_stills)
                        ? p.example_stills
                        : [];
                      save({
                        example_stills: e.target.checked
                          ? [...ids, a.id]
                          : ids.filter(v => v !== a.id),
                      });
                    }}
                  />
                  {a.fileName}
                </span>
              </label>
            ))}
        </div>
        <p className="dko-help">
          Choose from the verified logo, uploads or their own website. An
          example is always labelled as an example.
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={!m.io || busy}
          onClick={() =>
            void action(async () => {
              const found = await m.io!.findLogos();
              setLogos(found.candidates);
            })
          }
        >
          Find logo options
        </Button>
        <div className="flex flex-wrap gap-4">
          {logos.map(v => (
            <button
              key={v.url}
              type="button"
              className="rounded border p-3"
              onClick={() =>
                void action(() =>
                  m.io!.pickLogo(
                    v.url,
                    logoRequests.current.get(v.url) ??
                      (() => {
                        const id = crypto.randomUUID();
                        logoRequests.current.set(v.url, id);
                        return id;
                      })(),
                  ),
                )
              }
            >
              <img
                className="h-16 w-24 object-contain"
                src={v.url}
                alt={`Use ${v.source} logo`}
              />
              <span className="text-xs">{v.source}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
function ProjectValue({
  offer: m,
  save,
}: {
  offer: OfferModel;
  save: (p: Record<string, unknown>) => void;
}) {
  const old = m.prep.project_value as
    | {
        amount?: number;
        currency?: string;
        said_on?: string;
        from?: "typed" | "onboarding";
      }
    | undefined;
  const onboarding = m.sources.project.onboarding;
  const [source, setSource] = useState<"typed" | "onboarding">(
    old?.from ?? "typed",
  );
  const [amount, setAmount] = useState(String(old?.amount ?? "")),
    [currency, setCurrency] = useState(old?.currency ?? m.sources.currency),
    [on, setOn] = useState(
      old?.said_on ?? new Date().toISOString().slice(0, 10),
    );
  return (
    <details>
      <summary className="cursor-pointer text-sm font-medium">
        Their typical project value
      </summary>
      <p className="dko-help mt-2">
        {onboarding?.answer ?? "No typed value in onboarding."}
        {m.sources.project.sheet
          ? ` Sheet average: ${m.sources.project.sheet.usd} USD across ${m.sources.project.sheet.closes} signed projects (${m.sources.project.sheet.window}).`
          : ""}
      </p>
      {onboarding ? (
        <label className="dko-field mt-3">
          This figure comes from
          <select
            value={source}
            onChange={e => {
              const next =
                e.target.value === "onboarding" ? "onboarding" : "typed";
              setSource(next);
              setAmount("");
              setCurrency(next === "onboarding" ? "" : m.sources.currency);
              setOn(
                next === "onboarding"
                  ? (onboarding.answeredOn?.slice(0, 10) ?? "")
                  : new Date().toISOString().slice(0, 10),
              );
            }}
          >
            <option value="typed">The client told me</option>
            <option value="onboarding">Their onboarding answer</option>
          </select>
          {source === "onboarding" ? (
            <small>
              Confirm one amount and its currency from the answer above. If it
              gives a range or the currency is unclear, ask the client for a
              figure.
            </small>
          ) : null}
        </label>
      ) : null}
      <div className="dko-fields mt-3">
        <label className="dko-field">
          Value they gave you
          <input
            type="number"
            min="1"
            value={amount}
            onChange={e => setAmount(e.target.value)}
          />
        </label>
        <label className="dko-field">
          Currency
          <select value={currency} onChange={e => setCurrency(e.target.value)}>
            <option value="" disabled>
              Choose the stated currency
            </option>
            {["USD", "KWD", "SAR", "AED", "QAR", "BHD", "OMR"].map(v => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label className="dko-field">
          Said on
          <input
            type="date"
            max={new Date().toISOString().slice(0, 10)}
            value={on}
            onChange={e => setOn(e.target.value)}
          />
        </label>
      </div>
      <Button
        size="sm"
        className="mt-3"
        disabled={
          !Number.isFinite(Number(amount)) ||
          Number(amount) <= 0 ||
          Number(amount) > 100000000 ||
          !currency ||
          !on
        }
        onClick={() =>
          save({
            project_value: {
              amount: Number(amount),
              currency,
              from: source,
              said_on: on,
            },
          })
        }
      >
        {source === "onboarding"
          ? "Use confirmed onboarding figure"
          : "Use their figure"}
      </Button>
      <p className="dko-help">
        Conversion source: {m.sources.fx.from}.{" "}
        {m.sources.fx.usdPer
          ? `1 ${m.sources.currency} = ${m.sources.fx.usdPer} USD.`
          : (m.sources.fx.note ??
            "No rate recorded. The offer total stays in USD.")}
      </p>
    </details>
  );
}
