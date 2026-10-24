import { useCallback, useEffect, useState } from "react";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { launchOperation } from "@/lib/launchClient";
import type { LaunchClient } from "@/lib/launchModel";

type Props = {
  client: any;
  c: LaunchClient;
  account: string;
  route: string;
  source: string;
  ready: any;
  value: Record<string, any>;
  onChange: (v: Record<string, any>) => void;
  onSource: (v: string) => void;
};
export function LaunchSetup({
  client,
  c,
  account,
  route,
  source,
  ready,
  value,
  onChange,
  onSource,
}: Props) {
  const [catalog, setCatalog] = useState<any>(null),
    [forms, setForms] = useState<any[]>([]),
    [cities, setCities] = useState<any[]>([]),
    [sets, setSets] = useState<any[]>([]),
    [other, setOther] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const change = (patch: Record<string, any>) =>
    onChange({ ...value, ...patch });
  const read = useCallback(
    (args: Record<string, any>) =>
      launchOperation(client, "launch.readiness", {
        clickupId: c.id,
        accountId: account,
        ...args,
      }),
    [client, c.id, account],
  );
  useEffect(() => {
    let current = true;
    setError("");
    setCatalog(null);
    if (route === "new")
      read({ catalog: true })
        .then(r => {
          if (current) setCatalog(r);
        })
        .catch(e => {
          if (current) setError(e.message);
        });
    return () => {
      current = false;
    };
  }, [route, read]);
  useEffect(() => {
    let current = true;
    setSets([]);
    if (source && route !== "new" && route !== "switchOn")
      read({
        accountId: route === "rebuild" ? value.sourceAccountId : account,
        sourceCampaignId: source,
      })
        .then(r => {
          if (current) setSets(r.adsets ?? []);
        })
        .catch(e => {
          if (current) setError(e.message);
        });
    return () => {
      current = false;
    };
  }, [source, route, value.sourceAccountId, account, read]);
  useEffect(() => {
    let current = true;
    setForms([]);
    if (value.pageId && route === "new")
      read({ catalog: true, pageId: value.pageId })
        .then(r => {
          if (current) setForms(r.forms ?? []);
        })
        .catch(e => {
          if (current) setError(e.message);
        });
    return () => {
      current = false;
    };
  }, [value.pageId, route, read]);
  useEffect(() => {
    let current = true;
    setOther(null);
    if (route === "rebuild" && value.sourceAccountId)
      read({ accountId: value.sourceAccountId })
        .then(r => {
          if (current) {
            setOther(r);
          }
        })
        .catch(e => {
          if (current) setError(e.message);
        });
    return () => {
      current = false;
    };
  }, [route, value.sourceAccountId, read]);
  async function findCities() {
    setBusy(true);
    setError("");
    try {
      const r = await read({
        catalog: true,
        geoQuery: value.geoQuery,
        country: value.country,
      });
      setCities(r.cities ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function ideas() {
    setBusy(true);
    setError("");
    try {
      const r = await launchOperation(client, "launch.copyIdeas", {
        clickupId: c.id,
        accountId: account,
        language: value.language ?? "ar",
      });
      change({
        variants: (value.media ?? []).map(
          (_: any, i: number) => r.variants[i % r.variants.length],
        ),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const candidates =
    route === "rebuild" ? other?.candidates : ready?.candidates;
  const selected = value.media ?? [];
  return (
    <div className="launch-setup">
      {route === "rebuild" && (
        <label htmlFor="launch-setup-1">
          Copy from this client’s account
          <AnimatedSelect
            id="launch-setup-1"
            value={value.sourceAccountId ?? ""}
            onChange={e => {
              change({
                sourceAccountId: e.target.value,
                sourceAdsetId: undefined,
              });
              onSource("");
            }}
          >
            <option value="">Choose the old account</option>
            {c.accounts
              .filter(a => a.id !== account)
              .map(a => (
                <option key={a.id} value={a.id}>
                  {a.name ?? "Account"} · …{a.id.slice(-6)}
                </option>
              ))}
          </AnimatedSelect>
          <small>
            The selected account above is the clean destination. The old account
            stays as it is.
          </small>
        </label>
      )}
      {route !== "new" && (
        <label htmlFor="launch-setup-2">
          Source campaign
          <AnimatedSelect
            id="launch-setup-2"
            value={source}
            onChange={e => {
              onSource(e.target.value);
              change({ sourceAdsetId: undefined });
            }}
          >
            <option value="">Choose a campaign</option>
            {(candidates ?? [])
              .filter((x: any) => x.owner.kind === "mahara")
              .map((x: any) => (
                <option key={x.id} value={x.id}>
                  {x.name} · …{x.id.slice(-6)}
                </option>
              ))}
          </AnimatedSelect>
        </label>
      )}
      {sets.length > 1 && (
        <label htmlFor="launch-setup-3">
          Ad set to copy
          <AnimatedSelect
            id="launch-setup-3"
            value={value.sourceAdsetId ?? ""}
            onChange={e => change({ sourceAdsetId: e.target.value })}
          >
            <option value="">Choose the client audience</option>
            {sets.map(x => (
              <option value={x.id} key={x.id}>
                {x.name} · …{x.id.slice(-6)}
              </option>
            ))}
          </AnimatedSelect>
        </label>
      )}
      {route === "new" && (
        <>
          <label htmlFor="launch-setup-4">
            Client Page
            <AnimatedSelect
              id="launch-setup-4"
              value={value.pageId ?? ""}
              onChange={e =>
                change({
                  pageId: e.target.value,
                  formId: undefined,
                  templateFormId: undefined,
                })
              }
            >
              <option value="">
                {catalog ? "Choose a Page" : "Reading the account library…"}
              </option>
              {catalog?.pages?.map((x: any) => (
                <option value={x.id} key={x.id}>
                  {x.name}
                </option>
              ))}
            </AnimatedSelect>
          </label>
          {c.brief?.answers?.destination === "lead_form" ? (
            <div className="launch-form-choices">
              <label htmlFor="launch-setup-5">
                Lead form
                <AnimatedSelect
                  id="launch-setup-5"
                  value={value.formId ?? value.templateFormId ?? ""}
                  onChange={e =>
                    change(
                      value.useTemplate
                        ? { templateFormId: e.target.value, formId: undefined }
                        : { formId: e.target.value, templateFormId: undefined },
                    )
                  }
                >
                  <option value="">Choose a form on this Page</option>
                  {forms.map(x => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </AnimatedSelect>
              </label>
              <label className="launch-checkbox">
                <input
                  type="checkbox"
                  checked={!!value.useTemplate}
                  onChange={e =>
                    change({
                      useTemplate: e.target.checked,
                      templateFormId: e.target.checked
                        ? value.formId
                        : undefined,
                      formId: e.target.checked
                        ? undefined
                        : value.templateFormId,
                    })
                  }
                />
                Create a new version from this form template
              </label>
            </div>
          ) : (
            <div>
              <label htmlFor="launch-setup-6">
                Approved landing page
                <Input
                  id="launch-setup-6"
                  type="url"
                  value={value.landingUrl ?? ""}
                  onChange={e => change({ landingUrl: e.target.value })}
                  placeholder="https://"
                />
              </label>
              <label htmlFor="launch-new-pixel">
                Conversion pixel
                <AnimatedSelect
                  id="launch-new-pixel"
                  value={value.pixelId ?? ""}
                  onChange={e => change({ pixelId: e.target.value })}
                >
                  <option value="">Choose the client pixel</option>
                  {catalog?.pixels?.map((x: any) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </AnimatedSelect>
                <small>
                  Uses the Lead conversion event on the approved landing page.
                </small>
              </label>
            </div>
          )}
          <div className="launch-geo">
            <label htmlFor="launch-setup-7">
              Country
              <AnimatedSelect
                id="launch-setup-7"
                value={value.country ?? ""}
                onChange={e => {
                  change({ country: e.target.value, cityKey: undefined });
                  setCities([]);
                }}
              >
                <option value="">Choose country</option>
                {[
                  ["AE", "United Arab Emirates"],
                  ["SA", "Saudi Arabia"],
                  ["KW", "Kuwait"],
                  ["QA", "Qatar"],
                  ["BH", "Bahrain"],
                  ["OM", "Oman"],
                ].map(([k, n]) => (
                  <option key={k} value={k}>
                    {n}
                  </option>
                ))}
              </AnimatedSelect>
            </label>
            <label htmlFor="launch-setup-8">
              Advertising city
              <Input
                id="launch-setup-8"
                value={value.geoQuery ?? ""}
                onChange={e =>
                  change({ geoQuery: e.target.value, cityKey: undefined })
                }
                placeholder="City from the client brief"
              />
            </label>
            <Button
              variant="outline"
              disabled={busy || !value.country || !value.geoQuery}
              onClick={findCities}
            >
              Find city
            </Button>
          </div>
          {cities.length > 0 && (
            <label htmlFor="launch-setup-9">
              Audience location
              <AnimatedSelect
                id="launch-setup-9"
                value={value.cityKey ?? ""}
                onChange={e => change({ cityKey: e.target.value })}
              >
                <option value="">Choose a city, 25 km radius</option>
                {cities.map(x => (
                  <option key={x.key} value={x.key}>
                    {x.name}, {x.region}
                  </option>
                ))}
              </AnimatedSelect>
            </label>
          )}
          <div>
            <p className="launch-input-label">
              Client creatives{" "}
              <span className="launch-micro">
                {selected.length} of 6 selected
              </span>
            </p>
            <p className="launch-input-help">
              Use this client’s imported files. Preview each selection before
              creating the plan.
            </p>
            <div className="launch-media-grid">
              {catalog?.media?.map((m: any) => (
                <button
                  type="button"
                  key={m.key}
                  aria-pressed={selected.some((x: any) => x.key === m.key)}
                  onClick={() => {
                    const exists = selected.findIndex(
                      (x: any) => x.key === m.key,
                    );
                    if (exists >= 0)
                      change({
                        media: selected.filter(
                          (_: any, i: number) => i !== exists,
                        ),
                        variants: (value.variants ?? []).filter(
                          (_: any, i: number) => i !== exists,
                        ),
                      });
                    else if (selected.length < 6)
                      change({
                        media: [...selected, m],
                        variants: [
                          ...(value.variants ?? []),
                          { headline: "", primaryText: "" },
                        ],
                      });
                  }}
                >
                  {m.preview && <img src={m.preview} alt="" />}
                  <span>{m.name}</span>
                </button>
              ))}
            </div>
            {catalog && !catalog.media?.length && (
              <p className="launch-inline-note">
                No client media is in this account yet. Import the approved
                files in Ads Manager, then check again.
              </p>
            )}
            {catalog?.more && (
              <p className="launch-input-help">
                Showing the first library results. Use Ads Manager if the
                approved file is not listed.
              </p>
            )}
          </div>
          {selected.length > 0 && (
            <>
              <div className="launch-copy-tools">
                <label htmlFor="launch-setup-10">
                  Copy language
                  <AnimatedSelect
                    id="launch-setup-10"
                    value={value.language ?? "ar"}
                    onChange={e => change({ language: e.target.value })}
                  >
                    <option value="ar">Arabic</option>
                    <option value="en">English</option>
                  </AnimatedSelect>
                </label>
                <Button variant="outline" disabled={busy} onClick={ideas}>
                  Suggest copy from the brief
                </Button>
              </div>
              {selected.map((m: any, i: number) => (
                <div key={m.key} className="launch-copy-fields">
                  <h3>
                    {i + 1}. {m.name}
                  </h3>
                  <label htmlFor={`launch-setup-11-${i}`}>
                    Headline
                    <Input
                      id={`launch-setup-11-${i}`}
                      dir="auto"
                      maxLength={120}
                      value={value.variants?.[i]?.headline ?? ""}
                      onChange={e =>
                        change({
                          variants: selected.map((_: any, n: number) => ({
                            ...value.variants?.[n],
                            ...(n === i ? { headline: e.target.value } : {}),
                          })),
                        })
                      }
                    />
                  </label>
                  <label>
                    Primary text
                    <textarea
                      dir="auto"
                      maxLength={1200}
                      value={value.variants?.[i]?.primaryText ?? ""}
                      onChange={e =>
                        change({
                          variants: selected.map((_: any, n: number) => ({
                            ...value.variants?.[n],
                            ...(n === i ? { primaryText: e.target.value } : {}),
                          })),
                        })
                      }
                    />
                  </label>
                </div>
              ))}
            </>
          )}
        </>
      )}
      {error && (
        <p className="launch-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
