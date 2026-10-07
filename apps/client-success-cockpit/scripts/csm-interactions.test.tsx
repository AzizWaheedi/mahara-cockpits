import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act, createContext, useContext, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useSearchParams } from "react-router";
import type { CallKind } from "../src/lib/checkInCore";
import type { ClientCallReceipt } from "../src/lib/checkInClient";

const win = new Window({ url: "https://localhost/" });
const globals = globalThis as unknown as Record<string, unknown>;
const previous = new Map<string, unknown>();
for (const [key, value] of Object.entries({ window: win, document: win.document, navigator: win.navigator, HTMLElement: win.HTMLElement, Element: win.Element, Node: win.Node, Event: win.Event, CustomEvent: win.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true })) {
  previous.set(key, globals[key]);
  globals[key] = value;
}
afterAll(() => {
  mock.restore();
  for (const [key, value] of previous) {
    if (value === undefined) delete globals[key]; else globals[key] = value;
  }
});

let actor = "actor-a";
let allowed: string[] = ["Current client"];
let roster = [{taskId:"client-1",name:"Current client",stage:"Active",csmAssigned:"Current CSM",rank:1,level:"red"}];
const nativeClient = {};
mock.module("@/auth/SupabaseAuthProvider", () => ({
  useCockpitAuth: () => ({client:nativeClient,session:{user:{id:actor}},clients:allowed,roles:["csm"],ready:true,isAuthenticated:true,isAdmin:false,isCeo:false}),
}));
mock.module("@/lib/useCsmSnapshot", () => ({
  useCsmSnapshot: (client: unknown) => ({snap:client?{clients:roster}:undefined,loading:!client,error:null}),
}));
mock.module("sonner", () => ({toast:{success:()=>{},error:()=>{}}}));

// Keep controlled state and user events real without testing Radix/cmdk internals.
const DialogState = createContext({open:false,onOpenChange:(_open:boolean)=>{}});
mock.module("@/components/ui/dialog", () => ({
  Dialog: ({open,onOpenChange,children}:{open:boolean;onOpenChange:(open:boolean)=>void;children:ReactNode}) => <DialogState.Provider value={{open,onOpenChange}}>{children}</DialogState.Provider>,
  DialogTrigger: ({children}:{children:ReactNode}) => { const state=useContext(DialogState); return <div onClick={()=>state.onOpenChange(true)}>{children}</div>; },
  DialogContent: ({children}:{children:ReactNode}) => { const state=useContext(DialogState); return state.open?<section role="dialog">{children}<button onClick={()=>state.onOpenChange(false)}>Close dialog</button></section>:null; },
  DialogHeader: ({children}:{children:ReactNode}) => <header>{children}</header>,
  DialogTitle: ({children}:{children:ReactNode}) => <h2>{children}</h2>,
  DialogDescription: ({children}:{children:ReactNode}) => <p>{children}</p>,
}));
mock.module("@/components/ui/command", () => ({
  CommandDialog: ({open,children}:{open:boolean;children:ReactNode}) => open?<section aria-label="Search">{children}</section>:null,
  CommandInput: () => <input aria-label="Search clients" />,
  CommandList: ({children}:{children:ReactNode}) => <div>{children}</div>,
  CommandEmpty: ({children}:{children:ReactNode}) => <p>{children}</p>,
  CommandGroup: ({heading,children}:{heading:string;children:ReactNode}) => <section aria-label={heading}>{children}</section>,
  CommandItem: ({onSelect,children}:{onSelect:()=>void;children:ReactNode}) => <button onClick={onSelect}>{children}</button>,
}));
mock.module("@/components/kit", () => ({
  PageHeader: ({title,children}:{title:string;children:ReactNode}) => <header><h1>{title}</h1>{children}</header>,
  Pill: ({children,onClick}:{children:ReactNode;onClick:()=>void}) => <button onClick={onClick}>{children}</button>,
  PillRow: ({children}:{children:ReactNode}) => <div>{children}</div>,
}));
mock.module("@/components/ReportIssue", () => ({ReportIssue:()=>null}));
const row = {taskId:"client-1",clientName:"Current client"};
type ProjectionRowFixture = {taskId:string;clientName:string};
mock.module("@/components/projections/ProjectionsKit", () => ({
  ProjectionStrip:()=>null,RenewalWindow:()=>null,HistoryTable:()=>null,GoldLibrary:()=>null,
  PlanDrawer: ({bookWith}:{bookWith:(row:ProjectionRowFixture,done:(when:string)=>Promise<void>)=>ReactNode}) => <div>{bookWith(row,async()=>{throw new Error("The page must save through its native onEdit");})}</div>,
}));
const page = {owner:"csm@example.test",owners:[],canEditOthers:false,gold:[]};
let failPlan = true;
const planWrites: unknown[] = [];
mock.module("@/lib/projectionsClient", () => ({
  readProjections:async()=>page,
  editProjections:async(_client:unknown,change:unknown)=>{planWrites.push(change);if(failPlan)throw new Error("Plan storage unavailable");return page;},
  projectionCommand:async()=>{throw new Error("The plan retry must not book through projections");},
}));
let bookings = 0;
const receipt: ClientCallReceipt = {appointmentId:"appointment-confirmed",startTime:"2026-10-10T10:00:00.000Z"};
mock.module("@/lib/checkInClient", () => ({
  readClientContact:async()=>({id:"contact-1",name:"Owner",phone:null,email:null,url:"https://example.com/contact"}),
  prepareClientCheckIn:async(_client:unknown,args:{day:string;kind:CallKind})=>({
    contact:{id:"contact-1",name:"Owner",phone:null,email:null,url:"https://example.com/contact"},
    calendar:{id:"calendar-1",name:"Check-in",minutes:30,kind:args.kind,label:"Check-in call"},
    slots:[receipt.startTime],day:args.day,timezone:"Asia/Kuwait",kind:args.kind,
  }),
  bookClientCheckIn:async()=>{bookings++;return receipt;},
}));

const { CommandPalette, recentSearchHits } = await import("../src/components/CommandPalette");
const { ClientCheckIn } = await import("../src/components/ClientCheckIn");
const { ProjectionsPage } = await import("../src/pages/ProjectionsPage");
const { openSearch } = await import("../src/lib/search");

// These imports follow mock registration so tests exercise the native UI against deterministic module boundaries.
function hostRoot() {
  const host = win.document.createElement("div");
  win.document.body.appendChild(host);
  // happy-dom implements the element contract consumed by React DOM.
  const root = createRoot(host as unknown as HTMLElement);
  return {host,root};
}

test("recent client history rehydrates current labels and drops revoked clients", () => {
  const hrefs=["/clients/client-1","/clients/client-1?act=book","/clients/client-1?tab=results","/clients/revoked","/clients/revoked?act=book"];
  const hits=recentSearchHits(hrefs,roster);
  expect(hits).toHaveLength(3);
  expect(hits[0].label).toBe("Current client");
  expect(hits[0].sub).toContain("Current CSM");
  expect(recentSearchHits(hrefs,[])).toEqual([]);
});

test("search namespaces history and clears visible clients on actor or access changes", async()=>{
  const {host,root}=hostRoot();
  actor="actor-a";allowed=["Current client"];
  win.localStorage.setItem("cs-search-recent",JSON.stringify([{label:"Legacy private client",sub:"Legacy CSM",href:"/clients/legacy"}]));
  win.localStorage.setItem("cs-search-recent:actor-a",JSON.stringify(["/clients/client-1","/clients/revoked"]));
  try{
    await act(async()=>root.render(<MemoryRouter><CommandPalette/></MemoryRouter>));
    await act(async()=>openSearch());
    expect(host.textContent).toContain("Current client");
    expect(host.textContent).not.toContain("Legacy private client");
    expect(host.textContent).not.toContain("Legacy CSM");
    const recent=host.querySelector('[aria-label="Recent"]');
    expect(recent?.textContent).toContain("Current CSM");
    await act(async()=>recent?.querySelector("button")?.click());
    const saved=win.localStorage.getItem("cs-search-recent:actor-a")??"";
    expect(JSON.parse(saved)[0]).toBe("/clients/client-1");
    expect(saved).not.toContain("Current client");
    expect(saved).not.toContain("Current CSM");
    await act(async()=>openSearch());
    actor="actor-b";allowed=["Another client"];roster=[];
    await act(async()=>root.render(<MemoryRouter><CommandPalette/></MemoryRouter>));
    expect(host.querySelector('[aria-label="Search"]')).toBeNull();
    await act(async()=>openSearch());
    expect(host.textContent).not.toContain("Current client");
    expect(host.querySelector('[aria-label="Recent"]')).toBeNull();
    allowed=["Access changed"];
    await act(async()=>root.render(<MemoryRouter><CommandPalette/></MemoryRouter>));
    expect(host.querySelector('[aria-label="Search"]')).toBeNull();
    actor="actor-a";allowed=[];
    await act(async()=>root.render(<MemoryRouter><CommandPalette/></MemoryRouter>));
    await act(async()=>openSearch());
    expect(host.querySelector('[aria-label="Recent"]')).toBeNull();
  }finally{await act(async()=>root.unmount());host.remove();actor="actor-a";allowed=["Current client"];roster=[{taskId:"client-1",name:"Current client",stage:"Active",csmAssigned:"Current CSM",rank:1,level:"red"}];win.localStorage.clear();}
});

function BookingQuery() {
  const [params,setParams]=useSearchParams();
  return <><button onClick={()=>setParams({act:"book"})}>Search book action</button><output>{params.toString()}</output><ClientCheckIn taskId="client-1" clientName="Current client" autoOpen={params.get("act")==="book"} onAutoOpenConsumed={()=>setParams({}, {replace:true})}/></>;
}
test("a repeated same-client booking query opens the mounted dialog and consumes the action",async()=>{
  const {host,root}=hostRoot();
  try{
    await act(async()=>root.render(<MemoryRouter><BookingQuery/></MemoryRouter>));
    for(let attempt=0;attempt<2;attempt++){
      const trigger=[...host.querySelectorAll("button")].find(button=>button.textContent==="Search book action");
      await act(async()=>trigger?.click());
      expect(host.querySelector('[role="dialog"]')).not.toBeNull();
      expect(host.querySelector("output")?.textContent).toBe("");
      const close=[...host.querySelectorAll("button")].find(button=>button.textContent==="Close dialog");
      await act(async()=>close?.click());
      expect(host.querySelector('[role="dialog"]')).toBeNull();
    }
  }finally{await act(async()=>root.unmount());host.remove();}
});

test("a confirmed appointment survives plan failure and retry never books again",async()=>{
  const {host,root}=hostRoot();bookings=0;planWrites.length=0;failPlan=true;
  try{
    await act(async()=>root.render(<MemoryRouter initialEntries={["/money?tab=projections&client=client-1"]}><ProjectionsPage/></MemoryRouter>));
    const open=[...host.querySelectorAll("button")].find(button=>button.textContent?.includes("Book it at a free time"));
    expect(open).toBeDefined();
    await act(async()=>open?.click());
    const slot=host.querySelector('[aria-pressed="false"]');
    expect(slot).not.toBeNull();
    await act(async()=>slot?.dispatchEvent(new win.MouseEvent("click",{bubbles:true})));
    const confirm=[...host.querySelectorAll("button")].find(button=>button.textContent?.includes("Book the check-in call"));
    expect(confirm).toBeDefined();
    await act(async()=>confirm?.click());
    expect(bookings).toBe(1);
    expect(planWrites).toEqual([{kind:"plan",taskId:"client-1",patch:{callBookedFor:receipt.startTime}}]);
    expect(host.textContent).toContain(receipt.appointmentId);
    expect(host.textContent).toContain("Plan storage unavailable");
    expect([...host.querySelectorAll("button")].some(button=>button.textContent?.includes("Book it at a free time"))).toBe(false);
    failPlan=false;
    const retry=[...host.querySelectorAll("button")].find(button=>button.textContent==="Retry saving the plan");
    expect(retry).toBeDefined();
    await act(async()=>retry?.click());
    expect(bookings).toBe(1);
    expect(planWrites).toHaveLength(2);
    expect(planWrites[1]).toEqual(planWrites[0]);
    expect(host.textContent).not.toContain("Plan storage unavailable");
  }finally{await act(async()=>root.unmount());host.remove();}
});
