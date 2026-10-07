// Development-time extraction only. Runtime never loads the former service modules.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..'),ts=require(path.join(root,'apps/media-buyer-cockpit/node_modules/typescript'));
const original=path.join(root,'apps/media-buyer-cockpit/convex/sync.ts'),source=fs.readFileSync(original,'utf8');
const ast=ts.createSourceFile('sync.ts',source,ts.ScriptTarget.Latest,true);
const skip=new Set(['process','vStillItem','StillItem','StillState']);
const chunks=[];
for(const statement of ast.statements){
 if(ts.isImportDeclaration(statement))continue;
 const name=statement.name?.text??(ts.isVariableStatement(statement)?statement.declarationList.declarations[0].name.getText():'');
 if(skip.has(name))continue;
 if(ts.isVariableStatement(statement)&&statement.declarationList.declarations.some(d=>/^(internalQuery|internalMutation|internalAction|authenticatedAction|v\.)/.test(d.initializer?.getText()??'')))continue;
 if(!ts.isVariableStatement(statement)&&!ts.isFunctionDeclaration(statement)&&!ts.isTypeAliasDeclaration(statement))continue;
 let text=statement.getFullText(ast).trim();
 if(ts.isFunctionDeclaration(statement)&&!text.includes('export '))text=text.replace(/(^|\n)(async )?function /, '$1export $2function ');
 chunks.push(text.replace(/\bfetch\(/g,'providerFetch(').replace(/\bconsole\.(log|warn|error)\(/g,(_,level)=>`recordLog("${level}",`));
}
const digest=crypto.createHash('sha256').update(source).digest('hex');
const header=`// Generated from the original calculator. Source SHA256: ${digest}\n// Regenerate with node hermes/cockpit-sync/extract.cjs; no service runtime dependency.\nimport {type ActionCtx,internal,graph,allAdAccounts,callTool,supabaseQuery,unwrap,providerFetch,recordLog,MAHARA_BUSINESS_ID} from './runtime';\nimport {CPL_GATE,CPB_GATE,NEW_CAMPAIGN_FORM_URL} from './constants';\nimport {hasPicture,isMetaId,metaImageExpiry,metaImageUsable,sameStoredRow,stillCaptureDue,stillKeyFor} from './metaMedia';\n`;
// Retain upstream event identity that the old in-memory calculation discarded.
// This adds provenance only; date/status attribution and totals stay unchanged.
let generated=(header+chunks.join('\n\n')+'\n').replace(/\r\n/g,'\n');
generated=generated.replace('type BookingEvent = {','type BookingEvent = {\n  eventId?: string; locationId?: string; contactId?: string; startTime?: string;');
generated=generated.replace('out.push({\n        date:', 'out.push({\n        eventId: e.id ? String(e.id) : undefined, locationId: loc, contactId: e.contactId, startTime: e.startTime,\n        date:');
generated=generated.replace('          appointmentDate: e.appointmentDate,','          appointmentDate: e.appointmentDate,\n          eventId: e.eventId, locationId: e.locationId, contactId: e.contactId, startTime: e.startTime,');
fs.writeFileSync(path.join(__dirname,'calculator.ts'),generated);
fs.copyFileSync(path.join(root,'apps/media-buyer-cockpit/convex/metaMedia.ts'),path.join(__dirname,'metaMedia.ts'));
const constants=fs.readFileSync(path.join(root,'apps/media-buyer-cockpit/convex/constants.ts'),'utf8'),ca=ts.createSourceFile('constants.ts',constants,ts.ScriptTarget.Latest,true);
fs.writeFileSync(path.join(__dirname,'constants.ts'),ca.statements.filter(s=>ts.isVariableStatement(s)&&s.declarationList.declarations.some(d=>['CPL_GATE','CPB_GATE','NEW_CAMPAIGN_FORM_URL'].includes(d.name.getText()))).map(s=>s.getText()).join('\n'));
process.stdout.write(JSON.stringify({generated:true,source_sha256:digest,calculator_lines:chunks.join('\n').split('\n').length})+'\n');
