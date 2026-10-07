type Health=(row:Record<string,unknown>)=>Promise<void>;
const b64=(value:string|ArrayBuffer)=>{const bytes=typeof value==='string'?new TextEncoder().encode(value):new Uint8Array(value);let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');};
export async function googleTools(env:(name:string)=>string|undefined,health:Health,request:typeof fetch=fetch){
 let sa:any;try{sa=JSON.parse(env('GOOGLE_SERVICE_ACCOUNT_JSON')??'');}catch{throw Error('GOOGLE_SERVICE_ACCOUNT_JSON is not configured');}
 if(typeof sa.client_email!=='string'||typeof sa.private_key!=='string')throw Error('The Google service account is incomplete');
 const now=Math.floor(Date.now()/1000),subject=env('GOOGLE_SERVICE_ACCOUNT_SUBJECT');
 const claims={iss:sa.client_email,...(subject?{sub:subject}:{}),scope:'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/documents',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600};
 const signing=b64(JSON.stringify({alg:'RS256',typ:'JWT'}))+'.'+b64(JSON.stringify(claims));
 const der=Uint8Array.from(atob(sa.private_key.replace(/-----[^-]+-----/g,'').replace(/\s/g,'')),c=>c.charCodeAt(0));
 const key=await crypto.subtle.importKey('pkcs8',der,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
 const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(signing));
 await health({provider:'google-auth',method:'POST',resource:'oauth2.googleapis.com/token',phase:'intent'});
 const exchange=await request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:signing+'.'+b64(sig)}),signal:AbortSignal.timeout(25000)});
 await health({provider:'google-auth',method:'POST',resource:'oauth2.googleapis.com/token',phase:'response',http_status:exchange.status});
 const token=await exchange.json();if(!exchange.ok||typeof token.access_token!=='string')throw Error('Google service-account authentication failed ('+exchange.status+')');
 return async(url:string,init:RequestInit={})=>{
  const parsed=new URL(url);if(!['docs.googleapis.com','www.googleapis.com'].includes(parsed.hostname)||parsed.protocol!=='https:')throw Error('Invalid Google resource');
  const method=String(init.method??'GET').toUpperCase();if(!['GET','POST'].includes(method))throw Error('Only report reads and writes are allowed');
  const row={provider:'google',method,resource:parsed.hostname+parsed.pathname};await health({...row,phase:'intent'});
  let response:Response;try{response=await request(url,{...init,method,headers:{Authorization:'Bearer '+token.access_token,'Content-Type':'application/json'},signal:AbortSignal.timeout(30000)});}catch{await health({...row,phase:'unknown'});throw Error('Google response is unknown. Reconcile the existing report request before retrying.');}
  const data=await response.json().catch(()=>null);await health({...row,phase:'response',http_status:response.status,object_id:data?.id??data?.documentId??null});
  if(!response.ok||!data)throw Error('Google report request failed ('+response.status+'). Inspect its provider receipt.');return data;
 };
}
