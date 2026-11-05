// Local synthetic payloads against read-only captured deployed schema/function
// definitions. No real responses, credentials, provider calls or mutations.
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const schemas=JSON.parse(await readFile(process.env.ONBOARDING_SCHEMA_FIXTURE,'utf8'));
const functions=JSON.parse(await readFile(process.env.ONBOARDING_FUNCTION_FIXTURE,'utf8'));
const db=new PGlite();
const order=['cockpit_form_typeform_text','cockpit_form_kuwait_day','cockpit_form_rows_blank_cell','cockpit_form_stage4_fields',
 'cockpit_form_stage4_text','cockpit_form_stage4_typeform_answers','cockpit_form_stage4_print_map','cockpit_form_stage4_print_part',
 'cockpit_form_stage4_print','cockpit_form_answers_check_v1','cockpit_form_answers_check_v2','cockpit_form_answers_check'];
for(const name of order) {
 const f=functions.find(x=>x.signature.startsWith(name+'(')); assert.ok(f,`missing ${name}`); await db.exec(f.definition);
}
function visible(field, answers) {
 const c=field.showIf; if(!c) return true;
 const value=answers[c.key] ?? false;
 if('includes' in c) return Array.isArray(value)&&value.includes(c.includes);
 if('in' in c) return c.in.includes(value);
 return value===c.equals;
}
function scalar(field) {
 if(field.type==='number') return Math.max(field.min ?? 0, 0);
 if(field.type==='tick') return true;
 if(field.type==='choice') return field.options[0].value;
 if(field.type==='multi') return [field.options[0].value];
 if(field.format==='phone') return '+96511111111';
 if(field.format==='email') return 'fictional@example.invalid';
 if(field.format==='url') return 'https://example.invalid';
 return 'Fictional answer';
}
function sample(schema) {
 const a={};
 for(const f of schema.fields) {
  if(!f.required || !visible(f,a)) continue;
  if(f.type==='rows') {
   const row={}; for(const c of f.columns) if(c.required) row[c.key]=scalar(c);
   a[f.key]=Array.from({length: f.minRows ?? 1},()=>({...row}));
  } else a[f.key]=scalar(f);
 }
 return a;
}
async function validate(schema,answers) {
 const result=await db.query('select public.cockpit_form_answers_check($1::jsonb,$2::jsonb,$3::jsonb) result', [JSON.stringify(schema),JSON.stringify(answers),'{}']);
 return result.rows[0].result;
}
for(const {version,schema} of schemas) {
 assert.ok([2,3].includes(version));
 assert.ok(!schema.fields.some(f=>['file','date'].includes(f.type)));
 const input=sample(schema); const checked=await validate(schema,input);
 if(!checked.ok) throw new Error(`Synthetic schema v${version} input failed: ${JSON.stringify(checked.errors)}`);
 const again=await validate(schema,checked.answers);
 assert.equal(again.ok,true,`stored answers should still validate for v${version}`);
 assert.deepEqual(again.answers,checked.answers,`stored normalization must be stable for v${version}`);
 assert.equal((await validate(schema,{...checked.answers,unknown_synthetic:true})).ok,false);
 const missing={...checked.answers}; delete missing.fullName;
 assert.equal((await validate(schema,missing)).ok,false);
 const result=await db.query("select public.cockpit_form_stage4_print('onboarding',$1,$2::jsonb) answers",[version,JSON.stringify(checked.answers)]);
 assert.ok(Array.isArray(result.rows[0].answers) && result.rows[0].answers.length>1);
 const refs=result.rows[0].answers.map(a=>a.ref); assert.equal(new Set(refs).size,refs.length);
 console.log(`Synthetic v${version}: actual schema and validator passed; ${refs.length} rendered answers.`);
}
await db.close();
