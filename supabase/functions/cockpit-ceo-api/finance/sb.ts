import {runtime} from './runtime.ts';
export const B2B='flwboeijllbtrufxkhts',TRIAGE='bldgtotkfmhoxmlzowdx';
export type Row=Record<string,any>;
export {num} from './numbers.ts';
export async function sql<T extends Row=Row>(project:string,query:string):Promise<T[]>{
 if(![B2B,TRIAGE].includes(project)||!/^\s*(select|with)\b/i.test(query)||/;/.test(query))throw Error('Finance source query is not permitted');
 try{return await runtime().read(project,query) as T[];}catch(error){runtime().failures.push(`Source ${project}: ${error instanceof Error?error.message:'read failed'}`);throw error;}
}
