import { WorkError } from "./worker.js";

const GHL = "https://services.leadconnectorhq.com";
const ZOOM = "https://api.zoom.us/v2";
export function createProviders({ env = process.env, fetcher = fetch } = {}) {
  async function request(url, method, body, headers) {
    let response;
    try { response = await fetcher(url,{method,headers:{...headers,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined,redirect:"error",signal:AbortSignal.timeout(12000)}); }
    catch { throw new WorkError("provider_unavailable"); }
    if (!response.ok) throw new WorkError([401,403].includes(response.status)?"provider_credentials_rejected":"provider_request_failed",[401,403].includes(response.status));
    try { return await response.json(); } catch { throw new WorkError("provider_response_invalid"); }
  }
  async function ghl(path,method="GET",body) {
    if (!env.GHL_TOKEN) throw new WorkError("ghl_not_configured",true);
    return request(GHL+path,method,body,{Authorization:`Bearer ${env.GHL_TOKEN}`,Version:"2021-07-28"});
  }
  let zoomAccess, expires=0;
  async function zoom(path,method="GET",body) {
    if (!env.ZOOM_ACCOUNT_ID || !env.ZOOM_CLIENT_ID || !env.ZOOM_CLIENT_SECRET) throw new WorkError("zoom_not_configured",true);
    if (!zoomAccess || expires<Date.now()) {
      const url="https://zoom.us/oauth/token?"+new URLSearchParams({grant_type:"account_credentials",account_id:env.ZOOM_ACCOUNT_ID});
      const result=await request(url,"POST",undefined,{Authorization:"Basic "+Buffer.from(env.ZOOM_CLIENT_ID+":"+env.ZOOM_CLIENT_SECRET).toString("base64")});
      if (!result.access_token) throw new WorkError("zoom_credentials_rejected",true);
      zoomAccess=result.access_token; expires=Date.now()+Math.max(0,Number(result.expires_in||60)-30)*1000;
    }
    return request(ZOOM+path,method,body,{Authorization:`Bearer ${zoomAccess}`});
  }
  const contact=async id=>{
    const result=await ghl(`/contacts/${encodeURIComponent(id)}`);
    if(!result.contact) throw new WorkError("contact_read_incomplete");
    return result.contact;
  };
  async function search(query,location) {
    let path="/contacts/?"+new URLSearchParams({locationId:location,query,limit:"100"});
    const all=[],seen=new Set(); let total;
    for(let page=0;page<100;page++) {
      if(seen.has(path)) throw new WorkError("contact_pagination_incomplete");
      seen.add(path);
      const result=await ghl(path);
      if(!Array.isArray(result.contacts) || !Number.isInteger(result.meta?.total)) throw new WorkError("contact_pagination_incomplete");
      if(total!==undefined && total!==result.meta.total) throw new WorkError("contact_snapshot_changed");
      total=result.meta.total; all.push(...result.contacts);
      const next=result.meta.nextPageUrl;
      if(!next) {
        if(all.length!==total) throw new WorkError("contact_pagination_incomplete");
        return all;
      }
      let url;
      try { url=new URL(next); } catch { throw new WorkError("contact_pagination_incomplete"); }
      if(url.origin!==GHL || url.pathname!=="/contacts/" || url.searchParams.get("locationId")!==location || url.searchParams.get("query")!==query) throw new WorkError("contact_pagination_scope",true);
      path=url.pathname+url.search;
    }
    throw new WorkError("contact_pagination_incomplete");
  }
  return {
    getContact:contact,
    findContacts:async(input,location)=>[...await search(input.email,location),...await search(input.phone,location)],
    createContact:async(input,location)=>{
      const result=await ghl("/contacts/","POST",{locationId:location,firstName:input.first_name,lastName:input.last_name,email:input.email,phone:input.phone,source:"webinar-receipt"});
      if(!result.contact?.id) throw new WorkError("contact_receipt_missing");
      return contact(result.contact.id);
    },
    appointments:async id=>{
      const result=await ghl(`/contacts/${encodeURIComponent(id)}/appointments`);
      if(!Array.isArray(result.events) || result.nextPageToken || result.meta?.nextPageUrl) throw new WorkError("appointment_lookup_incomplete");
      return result.events;
    },
    createAppointment:async(scope,id)=>{
      const result=await ghl("/calendars/events/appointments","POST",{calendarId:scope.calendar_id,locationId:scope.location_id,contactId:id,
        startTime:scope.starts_at,endTime:new Date(Date.parse(scope.starts_at)+scope.duration_minutes*60000).toISOString(),title:"Mahara live training",appointmentStatus:"confirmed",toNotify:false});
      if(!result.id) throw new WorkError("appointment_receipt_missing");
      const saved=await ghl(`/calendars/events/appointments/${encodeURIComponent(result.id)}`);
      return saved.appointment || saved;
    },
    meeting:id=>zoom(`/meetings/${encodeURIComponent(id)}`),
    registrants:async id=>{
      const rows=[]; let token="",total; const seen=new Set();
      for(let page=0;page<100;page++) {
        if(seen.has(token)) throw new WorkError("zoom_pagination_incomplete"); seen.add(token);
        const result=await zoom(`/meetings/${encodeURIComponent(id)}/registrants?`+new URLSearchParams({status:"approved",page_size:"300",next_page_token:token}));
        if(!Array.isArray(result.registrants) || !Number.isInteger(result.total_records)) throw new WorkError("zoom_pagination_incomplete");
        if(total!==undefined && total!==result.total_records) throw new WorkError("zoom_snapshot_changed");
        total=result.total_records; rows.push(...result.registrants); token=result.next_page_token || "";
        if(!token) { if(rows.length!==total) throw new WorkError("zoom_pagination_incomplete"); return rows; }
      }
      throw new WorkError("zoom_pagination_incomplete");
    },
    createRegistrant:async(id,c)=>{
      const result=await zoom(`/meetings/${encodeURIComponent(id)}/registrants`,"POST",{email:c.email,first_name:c.firstName || "",last_name:c.lastName || "",auto_approve:true});
      return {id:result.registrant_id,join_url:result.join_url};
    },
  };
}
