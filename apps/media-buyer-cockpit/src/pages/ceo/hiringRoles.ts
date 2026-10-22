/** Which hiring role a Meta campaign recruits for, from its name. Pure, so tests can import it. */
/** Campaign-name words to the hiring role key the forms use (cockpit_hiring_applications.role). */
const ROLE_WORDS: [RegExp, string, string][] = [
  [/\b(csr|call ?cent(re|er))\b/i, "call-centre", "Call centre agent"],
  [/\bcsm\b|client success/i, "csm", "Client success manager"],
  [/\bcloser\b|sales/i, "sales-closer", "Closer"],
  [/video|editor/i, "video-editor", "Video editor"],
  [/media ?buyer/i, "media-buyer", "Media buyer"],
];

export function isHiringCampaign(name: string): boolean {
  return /hiring|recruit|careers?\b|job\b/i.test(name);
}

export function roleOf(name: string): { key: string; label: string } | null {
  for (const [re, key, label] of ROLE_WORDS)
    if (re.test(name)) return { key, label };
  return null;
}
