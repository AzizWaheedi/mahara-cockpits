/** Canonical file URLs make imports reusable across viewers and link variants. */
export function normalizeImportLinks(input: unknown): string[] {
 if (!Array.isArray(input) || !input.length || input.length > 6) throw Error('Paste one to six individual Google Drive file links.');
 const ids = input.map(value => {
  let url: URL; try { url = new URL(String(value)); } catch { throw Error('Paste a Google Drive file link.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'drive.google.com' || url.username || url.password || url.port) throw Error('Use a secure Google Drive file link.');
  const id = url.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]{16,})(?:\/|$)/)?.[1] ?? (url.pathname === '/open' ? url.searchParams.get('id') : null);
  if (!id || !/^[A-Za-z0-9_-]{16,}$/.test(id)) throw Error('Paste individual file links, not a Drive folder.');
  return id;
 });
 return [...new Set(ids)].sort().map(id => `https://drive.google.com/file/d/${id}/view`);
}
