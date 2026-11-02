import type {MultiPlan,Provider,Row} from './core.ts';
export const LTV_FIELD='11d70e58-20e7-4ff0-85c6-51de42f044d2';
/**
 * One LTV writer (docs/forms/WAVE56-CONTRACT.md E10, 4.4.3, C8): the cockpit's
 * morning run writes the ClickUp LTV field through billing kind ltv, from the
 * card's starting value plus checked payments only. The CEO's old Apply
 * (ceo.ltv.apply) is retired: index.ts refuses it before any preview or
 * provider call, and this stays as the last guard, so no path writes LTV here.
 * The operation stays in core.ts's allow-list so an open old bundle gets this
 * sentence instead of "Unsupported provider operation".
 */
export const LTV_RETIRED='Lifetime value is written by the cockpit every morning now. See the list on the Billing tab.';
export async function prepareLtv(_args:Row,_preview:Row,_p:Provider):Promise<MultiPlan> {
 throw new Error(LTV_RETIRED);
}
