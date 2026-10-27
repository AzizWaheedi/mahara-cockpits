import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  type Catalog,
  type OfferClient,
  saveSetting,
} from "../../../present/offer/sources";
export function OfferSettings({
  settings,
  isCeo,
  client,
  reload,
}: {
  settings: Catalog["settings"];
  isCeo: boolean;
  client: OfferClient;
  reload: () => Promise<void>;
}) {
  const [phone, setPhone] = useState(settings.whatsappNumber ?? ""),
    [days, setDays] = useState(String(settings.validDays)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const save = async (key: string, value: string) => {
    setBusy(true);
    setError(null);
    try {
      await saveSetting(client, key, value);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="dko-panel">
      <h2>Proposal defaults</h2>
      <div className="dko-fields">
        <label className="dko-field">
          Company WhatsApp number
          <input
            readOnly={!isCeo}
            value={phone}
            onChange={e => setPhone(e.target.value)}
            inputMode="numeric"
            placeholder="Country code, then number"
          />
          <small>
            Digits only. Without it, the client page asks them to message their
            account manager.
          </small>
          {isCeo ? (
            <Button
              size="sm"
              variant="outline"
              disabled={
                busy ||
                !/^\d{8,15}$/.test(phone) ||
                phone === settings.whatsappNumber
              }
              onClick={() => void save("whatsapp_number", phone)}
            >
              Save number
            </Button>
          ) : null}
        </label>
        <label className="dko-field">
          Link valid for, days
          <input
            type="number"
            readOnly={!isCeo}
            min="7"
            max="90"
            value={days}
            onChange={e => setDays(e.target.value)}
          />
          {isCeo ? (
            <Button
              size="sm"
              variant="outline"
              disabled={
                busy ||
                Number(days) < 7 ||
                Number(days) > 90 ||
                Number(days) === settings.validDays
              }
              onClick={() => void save("valid_days", days)}
            >
              Save validity
            </Button>
          ) : null}
        </label>
      </div>
      <p className="dko-help">
        Public links: {settings.doorLive ? "live" : "not active"}. Enabling the
        public door is a release step after the domain and anonymous page checks
        pass.
      </p>
      {error ? (
        <p role="alert" className="txt-bad text-sm">
          {error}
        </p>
      ) : null}
    </section>
  );
}
