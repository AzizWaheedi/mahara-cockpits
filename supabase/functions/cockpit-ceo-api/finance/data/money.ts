export type ManualRow={id:string;day:string;amount:number;currency:"USD"|"KWD";amountUsd:number;usdPerUnit:number;client:string;clickupTaskId:string|null;rail:"bank_transfer"|"cheque"|"cash"|"tap"|"ecom"|"other";kind:"payment"|"refund";dealContracted:number|null;dealContractedUsd:number|null;note:string|null;addedBy:string;addedAt:number;deletedAt:number|null;deletedBy:string|null;
 /** cockpit_manual_payments.check_state (20261101n); "logged" when the row carries none (a database before the rule). */
 checkState?:"logged"|"checked"|"rejected";stateMissing?:boolean;checkedAt?:number|null;checkedRef?:string|null};
export type ManualLoad={live:ManualRow[];removedThisMonth:ManualRow[];anyLive:boolean;truncated:boolean;newestChangeAt:number|null;cards:{taskId:string;names:string[];csm:string|null}[]};
export function byNewest(a:ManualRow,b:ManualRow){return a.day===b.day?b.addedAt-a.addedAt:a.day<b.day?1:-1;}
