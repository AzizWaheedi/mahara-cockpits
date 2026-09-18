/** Small, boring formatters. Kuwait is UTC+3 and never moves. */

const KUWAIT = "Asia/Kuwait";

export function clock(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return "--:--";
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return `${h ? `${h}:` : ""}${mm}:${String(rest).padStart(2, "0")}`;
}

export function minutes(seconds: number | null | undefined): string {
  if (!seconds) return "0 min";
  const m = seconds / 60;
  return m < 1 ? `${Math.round(seconds)} sec` : `${m.toFixed(1)} min`;
}

export function day(iso: string | null | undefined): string {
  if (!iso) return "--";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleDateString("en-GB", {
    timeZone: KUWAIT,
    day: "numeric",
    month: "short",
  });
}

export function moment(iso: string | null | undefined): string {
  if (!iso) return "--";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleString("en-GB", {
    timeZone: KUWAIT,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "3 days late", "due today", "in 2 days". Plain words, no colour logic here. */
export function whenDue(iso: string | null | undefined): { text: string; late: boolean } {
  if (!iso) return { text: "no date", late: false };
  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) return { text: "no date", late: false };
  const days = Math.round((due.getTime() - Date.now()) / 86_400_000);
  if (days < -1) return { text: `${Math.abs(days)} days late`, late: true };
  if (days === -1) return { text: "1 day late", late: true };
  if (days === 0) return { text: "due today", late: false };
  if (days === 1) return { text: "due tomorrow", late: false };
  return { text: `in ${days} days`, late: false };
}

export function shape(width: number | null, height: number | null): string {
  if (!width || !height) return "";
  const r = width / height;
  if (Math.abs(r - 9 / 16) < 0.02) return "9:16";
  if (Math.abs(r - 16 / 9) < 0.02) return "16:9";
  if (Math.abs(r - 1) < 0.02) return "1:1";
  if (Math.abs(r - 4 / 5) < 0.02) return "4:5";
  return `${width}x${height}`;
}

/** A Drive file id embedded in a preview frame. */
export function drivePreview(driveId: string | null | undefined): string | null {
  return driveId ? `https://drive.google.com/file/d/${driveId}/preview` : null;
}
