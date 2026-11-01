/**
 * Which lead forms a sync run may read. A form used only by paused, archived or
 * deleted campaigns is never read: Meta refuses forms on pages Mahara cannot
 * see, so one paused campaign's form failed on every run (2,007 refusals since
 * 8 Oct for one form). The stored copy of such a form is kept instead.
 */
export const PAUSED_FORM_REASON = 'The campaign is paused, so the form was not read. Stored questions are kept.';

/** Split the forms in play into those to read now and those kept as stored. */
export function formsToRead(ads: Record<string, {campaign?: {effective_status?: string}}>, formOf: (adId: string) => string | undefined): {read: string[]; paused: Set<string>} {
  const live = new Set<string>();
  const paused = new Set<string>();
  for (const adId of Object.keys(ads)) {
    const form = formOf(adId);
    if (!form) continue;
    const status = ads[adId]?.campaign?.effective_status;
    // No campaign status at all is not evidence of a pause: read the form.
    if (!status || status === 'ACTIVE') live.add(form);
    else paused.add(form);
  }
  // One live ad is enough: the same form can serve a paused and an active ad.
  for (const form of live) paused.delete(form);
  return {read: [...live].sort(), paused};
}
