import {money} from './adapters/money.ts';
import {expenses} from './adapters/expenses.ts';
import {withFinanceRuntime,type Runtime} from './runtime.ts';
export async function computeFinance(runtime:Runtime){return withFinanceRuntime(runtime,async()=>{
 const [moneyResult,expenseResult]=await Promise.all([money.compute(runtime.context),expenses.compute(runtime.context)]);
 const failed=[...runtime.failures,...moneyResult.sources.filter(s=>!s.ok).map(s=>s.name),...expenseResult.sources.filter(s=>!s.ok).map(s=>s.name)];
 if(failed.length)throw Error('Finance refresh incomplete: '+[...new Set(failed)].join('; ').slice(0,1200));
 if(!moneyResult.payload.attribution||!moneyResult.payload.rails?.manual)throw Error('Finance attribution or manual history was not confirmed');
 return {sections:[{key:'money',label:money.label,...moneyResult},{key:'expenses',label:expenses.label,...expenseResult}],payments:runtime.payments};
});}
