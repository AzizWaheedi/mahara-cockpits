/** The sales sub-account in HighLevel, where every lead's contact lives. */
export const GHL_LOCATION = "7NI8yyJtwsh2OOWA5Icr";

/** A lead's contact page in HighLevel. */
export function ghlContactUrl(contactId: string): string {
  return `https://app.gohighlevel.com/v2/location/${GHL_LOCATION}/contacts/detail/${encodeURIComponent(contactId)}`;
}
