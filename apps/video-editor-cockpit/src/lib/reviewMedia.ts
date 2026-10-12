/** Only Google's file viewer becomes an iframe. Never embed arbitrary URLs. */
export function drivePreview(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "drive.google.com")
      return null;
    const id =
      url.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]+)(?:\/|$)/)?.[1] ??
      (url.pathname === "/open" ? url.searchParams.get("id") : null);
    return id && /^[A-Za-z0-9_-]{10,}$/.test(id)
      ? `https://drive.google.com/file/d/${id}/preview`
      : null;
  } catch {
    return null;
  }
}
