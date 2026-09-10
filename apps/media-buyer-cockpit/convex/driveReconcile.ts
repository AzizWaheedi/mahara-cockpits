import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import {
  clientDataHeader,
  DATABASE_SHEET,
  normTight,
  readClientData,
} from "./clientData";
import { callTool, googleAccessToken, unwrap } from "./tools";

/**
 * Drive links live in three places: the ClickUp client card ("Drive Link" /
 * "Drive Folder"), the Client Data tab ("Google Drive Link"), and the parent
 * folder that holds every client folder. This walks all three and fills in
 * whichever is missing, so every client's folder is findable from the card
 * and from the sheet. Aziz, 2026-09-10: "this is where our drives live".
 *
 * Run with apply=false first: it returns the plan and writes nothing.
 */

// biome-ignore lint/suspicious/noExplicitAny: external payloads
type Any = any;

const CLIENTS_LIST = "901816559981";
const CF_DRIVE_LINK = "19e39b91-dd2f-4027-ba88-31bc6aae07c3";
const CF_DRIVE_FOLDER = "ce6129a5-c8e5-41ba-ac50-8650c7556469";
export const CLIENT_DRIVES_PARENT = "1DTJUOos129Sl-dSp_zllja47cx_LexFW";

const folderUrl = (id: string) =>
  `https://drive.google.com/drive/folders/${id}`;

function folderIdOf(link: unknown): string | undefined {
  const m = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(String(link ?? ""));
  return m?.[1];
}

/** Folder names carry a prefix or suffix the card never has. */
function folderName(name: string): string {
  return name
    .replace(/^\s*mahara\s*[-–—]\s*/i, "")
    .replace(/\s*[-–—]\s*workspace\s*$/i, "")
    .trim();
}

function prefixMatch(a: string, b: string): boolean {
  const x = normTight(folderName(a));
  const y = normTight(folderName(b));
  if (!x || !y) return false;
  return (
    x === y ||
    (x.length >= 5 && y.length >= 5 && (x.startsWith(y) || y.startsWith(x)))
  );
}

async function clickupGet(url: string): Promise<Any> {
  return unwrap(await callTool("pd_clickup_proxy_get", { url }));
}
async function clickupPost(url: string, json_body: Record<string, unknown>) {
  return unwrap(await callTool("pd_clickup_proxy_post", { url, json_body }));
}

async function clientTasks(): Promise<Any[]> {
  const out: Any[] = [];
  for (let page = 0; page < 8; page++) {
    const d = await clickupGet(
      `https://api.clickup.com/api/v2/list/${CLIENTS_LIST}/task?include_closed=true&page=${page}`,
    );
    const tasks: Any[] = d?.tasks ?? [];
    out.push(...tasks);
    if (tasks.length < 100) break;
  }
  return out;
}

async function subfoldersOf(
  token: string,
  parent: string,
): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${parent}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "nextPageToken,files(id,name)",
      pageSize: "500",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?${params}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    const data = await res.json();
    if (!res.ok)
      throw new Error(
        `parent folder: ${data?.error?.message ?? res.status} (share it with the service account)`,
      );
    out.push(
      ...((data.files ?? []) as Any[]).map(f => ({
        id: String(f.id),
        name: String(f.name),
      })),
    );
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

/** Every client folder: the parent's children, plus what sits inside "Churned". */
async function parentSubfolders(
  token: string,
): Promise<{ id: string; name: string }[]> {
  const top = await subfoldersOf(token, CLIENT_DRIVES_PARENT);
  const churned = top.filter(f => /churn/i.test(f.name));
  const nested = (
    await Promise.all(churned.map(f => subfoldersOf(token, f.id)))
  ).flat();
  const skip = /^(template|client internal documents|churned)/i;
  return [...top, ...nested].filter(f => !skip.test(folderName(f.name)));
}

const colLetter = (i: number) => String.fromCharCode(65 + i);

export const run = internalAction({
  args: { apply: v.boolean() },
  returns: v.any(),
  handler: async (_ctx, { apply }) => {
    const token = await googleAccessToken();
    const [tasks, rows, header, subfolders] = await Promise.all([
      clientTasks(),
      readClientData(),
      clientDataHeader(),
      parentSubfolders(token),
    ]);
    const cf = (t: Any, id: string) =>
      String(
        (t.custom_fields ?? []).find((c: Any) => c.id === id)?.value ?? "",
      ).trim();

    const plan: Any[] = [];
    const noDrive: string[] = [];
    const usedRows = new Set<number>();

    for (const t of tasks) {
      const name = String(t.name ?? "").trim();
      if (!name || /playing account/i.test(name)) continue;
      const cardLink = cf(t, CF_DRIVE_LINK) || cf(t, CF_DRIVE_FOLDER);
      const row =
        rows.find(r => r.clickupId === t.id) ??
        rows.find(r => normTight(r.name) === normTight(name)) ??
        rows.find(r => prefixMatch(r.name, name));
      if (row) usedRows.add(row.rowNumber);
      const rowLink = row?.driveLink ?? "";
      const sub =
        subfolders.find(
          f => normTight(folderName(f.name)) === normTight(name),
        ) ?? subfolders.find(f => prefixMatch(f.name, name));
      const found = folderIdOf(cardLink) ?? folderIdOf(rowLink) ?? sub?.id;
      if (!found) {
        noDrive.push(name);
        continue;
      }
      const url = folderUrl(found);
      const source = folderIdOf(cardLink)
        ? "card"
        : folderIdOf(rowLink)
          ? "sheet"
          : "parent folder";
      const writes: Any[] = [];
      if (!folderIdOf(cardLink))
        writes.push({
          where: "clickup",
          taskId: t.id,
          field: "Drive Link",
          value: url,
        });
      if (row && !folderIdOf(rowLink))
        writes.push({
          where: "sheet",
          cell: `${colLetter(header.col.driveLink)}${row.rowNumber}`,
          value: url,
        });
      if (!row)
        writes.push({
          where: "sheet-append",
          name,
          taskId: t.id,
          status: String(t.status?.status ?? ""),
          value: url,
        });
      if (writes.length) plan.push({ client: name, source, writes });
    }

    let done = 0;
    const failed: string[] = [];
    if (apply) {
      for (const p of plan) {
        for (const w of p.writes) {
          try {
            if (w.where === "clickup") {
              await clickupPost(
                `https://api.clickup.com/api/v2/task/${w.taskId}/field/${CF_DRIVE_LINK}`,
                { value: w.value },
              );
            } else if (w.where === "sheet") {
              const res = await fetch(
                `https://sheets.googleapis.com/v4/spreadsheets/${DATABASE_SHEET}/values/${encodeURIComponent(`Client Data!${w.cell}`)}?valueInputOption=USER_ENTERED`,
                {
                  method: "PUT",
                  headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({ values: [[w.value]] }),
                },
              );
              if (!res.ok)
                throw new Error(
                  `sheet ${res.status}: ${(await res.text()).slice(0, 120)}`,
                );
            } else if (w.where === "sheet-append") {
              const line: string[] = new Array(header.head.length).fill("");
              const put = (i: number, v: string) => {
                if (i >= 0) line[i] = v;
              };
              put(header.col.name, w.name);
              put(header.col.clickupId, w.taskId);
              put(header.col.driveLink, w.value);
              put(
                header.col.status,
                /active/i.test(w.status) ? "Active" : "Launching",
              );
              const res = await fetch(
                `https://sheets.googleapis.com/v4/spreadsheets/${DATABASE_SHEET}/values/${encodeURIComponent("Client Data!A:Z")}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({ values: [line] }),
                },
              );
              if (!res.ok)
                throw new Error(
                  `sheet append ${res.status}: ${(await res.text()).slice(0, 120)}`,
                );
            }
            done++;
            w.done = true;
          } catch (e) {
            failed.push(`${p.client}: ${w.where}: ${String(e).slice(0, 160)}`);
          }
        }
      }
    }
    // Folders in the parent that no card claims: worth a look.
    const claimed = new Set(plan.map(p => normTight(p.client)));
    const orphanFolders = subfolders
      .filter(f => !tasks.some((t: Any) => prefixMatch(t.name, f.name)))
      .map(f => f.name);
    return {
      apply,
      tasks: tasks.length,
      sheetRows: rows.length,
      parentFolders: subfolders.length,
      plan,
      writes: plan.reduce((n, p) => n + p.writes.length, 0),
      done,
      failed,
      noDriveAnywhere: noDrive,
      foldersWithNoCard: orphanFolders,
      _claimed: claimed.size,
    };
  },
});
