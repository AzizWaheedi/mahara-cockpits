import type {ManualLoad} from './data/money.ts';
import type {BillingRow} from './billing.ts';
export type SourceStamp={name:string;freshestAt?:number;ok:boolean;note?:string};
export type DailyPoint={date:string;metric:string;scope:string;value:number};
export type SectionResult={payload:any;daily?:DailyPoint[];sources:SourceStamp[]};
export interface FinanceContext {
 runQuery(ref:'manual',args:{from:string;month:string}):Promise<ManualLoad>;
 runQuery(ref:'billing',args:{}):Promise<BillingRow[]>;
 runQuery(ref:'series',args:{metric:string;scope:string;since:string}):Promise<{date:string;value:number}[]>;
}
export type Adapter={key:string;label:string;compute:(ctx:FinanceContext)=>Promise<SectionResult>};
