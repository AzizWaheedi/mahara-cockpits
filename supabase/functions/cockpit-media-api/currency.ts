// Meta holds money in each ad account's own currency; the cockpit types and words dollars.
// Budgets cross between the two here and nowhere else (same rates as apps/media-buyer-cockpit/convex/currency.ts).
// A currency the cockpit cannot convert is refused, never assumed to be dollars: a wrong guess moves real money.
export const USD_PER:Record<string,number>={USD:1,SAR:0.2666,QAR:0.2747,AED:0.2723,KWD:3.26};
// Meta counts budgets in hundredths of these (offset 100). KWD has a rate for spend but no Meta offset, so its budgets are refused.
export const HUNDREDTHS=new Set(['USD','SAR','QAR','AED']);
const code=(currency:unknown)=>String(currency??'').trim().toUpperCase();
const cents=(x:number)=>Math.round(Number((x*100).toPrecision(12)))/100;
/** Dollars typed in the cockpit, as a Meta budget in the account's minor units. $30 is 3000 on USD and 11253 on SAR. */
export function usdToBudget(usd:number,currency:unknown):number {
 const c=code(currency);if(!HUNDREDTHS.has(c))throw new Error(`This ad account is in ${c||'a currency Meta did not name'}. Change the budget in Ads Manager.`);
 return Math.round(usd/USD_PER[c]*100);
}
/** A Meta budget (minor units) in dollars, unrounded so budgetWords can give back the exact amount Meta holds. Undefined when it cannot be read safely. */
export function budgetToUsd(minor:unknown,currency:unknown):number|undefined {
 const n=Number(minor),c=code(currency);
 if(minor===null||minor===undefined||minor===''||!Number.isFinite(n)||n<=0||!HUNDREDTHS.has(c))return undefined;
 return n/100*USD_PER[c];
}
/** "$30.00" for a dollar account; "$46.66 (175.00 SAR in Meta)" for any other. */
export function budgetWords(usd:number,currency:unknown):string {
 const c=code(currency),dollars=`$${cents(usd).toFixed(2)}`;
 return c==='USD'?dollars:`${dollars} (${(usdToBudget(usd,c)/100).toFixed(2)} ${c} in Meta)`;
}
/** Spend Meta reports in the account's currency (major units), in dollars. Undefined for a currency with no rate. */
export function spendToUsd(amount:number,currency:unknown):number|undefined {
 const rate=USD_PER[code(currency)];
 return rate&&Number.isFinite(amount)?amount*rate:undefined;
}
