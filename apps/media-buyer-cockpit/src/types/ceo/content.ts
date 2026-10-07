/**
 * What the content brings in, as against what the ads bring in.
 */

export type ContentPlatform = {
  platform: string;
  /** Contacts that arrived with no evidence of a paid ad. */
  contacts: number;
  /** Of those, the ones a setter tagged, which is what the rest of the cockpit calls a lead. */
  leads: number;
  booked: number;
  demosShown: number;
  /** Signed deals traced to one of these contacts by contact id. */
  closes: number;
  contracted: number;
  cash: number;
  /** Posts published to this platform in the window, from the asset library. */
  posts: number | null;
  newestPost: string | null;
};

export type ContentDealSource = {
  source: string;
  deals: number;
  contracted: number;
  cash: number;
  withAd: number;
  paid: boolean;
};

export type ContentWindow = {
  from: string;
  to: string;
  totals: {
    contacts: number;
    leads: number;
    paidLeads: number;
    organicLeads: number;
    reactivationLeads: number;
    unnamedLeads: number;
  };
  platforms: ContentPlatform[];
  deals: ContentDealSource[];
  /** Every deal signed in the window, whatever it came from. */
  dealsAll: { deals: number; contracted: number; cash: number };
  /** The deals whose closer did not say "ads". */
  dealsOrganic: { deals: number; contracted: number; cash: number };
};
