import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
const win = new Window({url:"https://localhost/"});
for(const k of ["window","document","navigator","HTMLElement","HTMLFormElement","MutationObserver","Element","Node","Event","MouseEvent","DocumentFragment","Text"]) (globalThis as any)[k] = k === "window" ? win : (win as any)[k];
(globalThis as any).getComputedStyle=win.getComputedStyle.bind(win);
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const calls:{name:string,args:any}[]=[];
const panel={apply:true,finishedAt:new Date().toISOString(),error:null,dailyReviewedAt:null,clients:[{bindingId:"binding1",client:"Fictional Design",clientTaskId:"test1",accountId:"123456",signal:"unsettled",error:null,fresh:true,checkedAt:new Date().toISOString(),nextSendAt:null,review:{id:"review1",version:1,body:"⚠️ تنبيه بخصوص وسيلة الدفع في الحساب الإعلاني",state:"pending",reason:null,createdAt:new Date().toISOString(),actor:null,decidedAt:null,delivery:null}}]};
mock.module("@/lib/supabase",()=>({supabase:{rpc(name:string,args:any){calls.push({name,args});const promise=Promise.resolve({data:name==="cockpit_ad_billing_review_panel" ? structuredClone(panel) : "review1",error:null});return Object.assign(promise,{abortSignal:()=>promise});}}}));
const {createRoot}=await import("react-dom/client");
const {act}=await import("react");
const {MemoryRouter}=await import("react-router");
const {AdBillingReviewPage}=await import("../src/components/AdBillingReview");
const host=win.document.createElement("div");win.document.body.append(host);const root=createRoot(host as any);
async function render(mode="approve") {await act(async()=>{root.render(<MemoryRouter key={mode} initialEntries={[`/ad-billing?binding=binding1&mode=${mode}`]}><AdBillingReviewPage /></MemoryRouter>);});}
const button=(text:string)=>Array.from(host.querySelectorAll("button")).find(b=>b.textContent?.includes(text))!;
afterAll(async()=>{await act(async()=>root.unmount());await win.happyDOM.close();});
test("opening the Slack approval URL renders an editable Arabic draft and never sends",async()=>{
 await render();expect(host.textContent).toContain("Fictional Design");expect(host.querySelector("textarea")?.getAttribute("dir")).toBe("auto");
 expect(calls.filter(c=>c.name==="cockpit_ad_billing_decide")).toHaveLength(0);
 expect((button("Approve & queue") as any).disabled).toBe(false);
});
test("deny opens a required reason; blank denial button stays disabled",async()=>{
 await render("deny");expect(host.textContent).toContain("Why should this message not be sent?");expect((button("Record denial") as any).disabled).toBe(true);
});
test("explicit approval sends the version and exact reviewed body once",async()=>{
 await render("edit");await act(async()=>{button("Approve & queue").click();});
 const requests=calls.filter(c=>c.name==="cockpit_ad_billing_decide");expect(requests).toHaveLength(1);expect(requests[0].args.p_body).toBe(panel.clients[0].review.body);expect(requests[0].args.p_version).toBe(1);expect(host.textContent).toContain("Approved and queued");
});
test("cooldown disables approval while preserving deny and daily review",async()=>{
 (panel.clients[0] as any).nextSendAt=new Date(Date.now()+3600000).toISOString();await render("cooldown");expect((button("Approve & queue") as any).disabled).toBe(true);expect((button("Deny with") as any).disabled).toBe(false);expect(host.textContent).toContain("already sent recently");
});
