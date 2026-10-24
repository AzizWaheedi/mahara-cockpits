import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { launchOperation } from "@/lib/launchClient";

type Props = {
  client: any;
  clientId: string;
  account: string;
  enabled: boolean;
  rehearse: boolean;
  onReady: () => void;
};
export function LaunchCreativeImport({
  client,
  clientId,
  account,
  enabled,
  rehearse,
  onReady,
}: Props) {
  const [links, setLinks] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const announced = useRef(new Set<string>());
  const notify = useRef(onReady);
  notify.current = onReady;
  // biome-ignore lint/correctness/useExhaustiveDependencies: version deliberately refreshes the server read.
  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    async function read() {
      try {
        const { data, error } = await client.rpc("cockpit_launch_imports", {
          p_client: clientId,
          p_account: account,
        });
        if (error) throw Error(error.message);
        if (!current) return;
        const items = data ?? [];
        setRows(items);
        for (const row of items)
          if (row.status === "ready" && !announced.current.has(row.id)) {
            announced.current.add(row.id);
            notify.current();
          }
        if (items.some((r: any) => ["queued", "working"].includes(r.status)))
          timer = setTimeout(read, 5000);
      } catch (e) {
        if (current) setError((e as Error).message);
      }
    }
    read();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [client, clientId, account, version]);
  async function upload() {
    setBusy(true);
    setError("");
    try {
      const result = await launchOperation(
        client,
        "launch.importCreatives",
        {
          clickupId: clientId,
          accountId: account,
          driveLinks: links
            .split(/\n/)
            .map(x => x.trim())
            .filter(Boolean),
          rehearse,
        },
        true,
      );
      if (result.dryRun) {
        setError("Rehearsal. No files were uploaded.");
        return;
      }
      setLinks("");
      setVersion(v => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="launch-import">
      <div>
        <h4>Add approved creatives</h4>
        <p>
          Paste up to six Google Drive file links, one per line. Share the files
          as “Anyone with the link” or with the cockpit service account. They go
          into this ad account only.
        </p>
      </div>
      <label htmlFor="launch-drive-links">
        Approved image or video links
        <textarea
          id="launch-drive-links"
          rows={2}
          placeholder="https://drive.google.com/file/d/…/view"
          value={links}
          onChange={e => setLinks(e.target.value)}
        />
      </label>
      <div className="launch-import-actions">
        <small>
          Imports are saved here. You can leave and come back. No ad is
          published.
        </small>
        <Button
          variant="outline"
          disabled={busy || !links.trim() || !enabled || rehearse}
          onClick={upload}
        >
          {busy ? "Saving import…" : "Import to this account"}
        </Button>
      </div>
      {rehearse && <small>Rehearsal: imports are disabled.</small>}
      {error && (
        <p role="alert" className="launch-error">
          {error}{" "}
          <button
            type="button"
            onClick={() => {
              setError("");
              setVersion(v => v + 1);
            }}
          >
            Check status
          </button>
        </p>
      )}
      {rows.length > 0 && (
        <ul className="launch-import-jobs" aria-label="Creative imports">
          {rows.slice(0, 4).map(row => (
            <li key={row.id}>
              <strong>
                {row.status === "ready"
                  ? "Imported. Choose it below."
                  : row.status === "queued"
                    ? "Queued for import"
                    : row.status === "working"
                      ? "Importing into Meta…"
                      : "Import needs review"}
              </strong>
              <small>
                {row.status === "ready"
                  ? "A video may need a little longer to finish processing. Refresh the library if it is not visible yet."
                  : (row.error ?? row.note)}
              </small>
              {(row.media ?? []).map((m: any, i: number) => (
                <small key={i}>
                  {m.name}
                  {typeof m.percent === "number" ? ` · ${m.percent}%` : ""}
                </small>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
