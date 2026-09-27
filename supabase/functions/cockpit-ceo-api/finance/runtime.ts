import {AsyncLocalStorage} from 'node:async_hooks';
import type {FinanceContext} from './types.ts';
export type Runtime={read:(project:string,query:string)=>Promise<any[]>;context:FinanceContext;payments:any[];failures:string[]};
const state=new AsyncLocalStorage<Runtime>();
export function runtime(){const value=state.getStore();if(!value)throw Error('Finance runtime is not installed');return value;}
export async function withFinanceRuntime<T>(value:Runtime,run:()=>Promise<T>){return state.run(value,run);}
