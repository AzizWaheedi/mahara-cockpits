import {expect, test} from 'bun:test';
import {deliveryClientGroups} from './deliveryClients.js';
import {delivery, deliveryRates} from '../adapters/delivery.js';
import {withRuntime, type Runtime} from '../../runtime';
import {extractDelivery} from '../metrics';

const clients = [
  {clientId:'account-a',clickupTaskId:'client-one',name:'Client One',serviceMode:'DFY',campaigns:2},
  {clientId:'account-b',clickupTaskId:'client-one',name:'Client One',serviceMode:'DFY',campaigns:3},
  {clientId:'account-c',clickupTaskId:'client-two',name:'Client One',serviceMode:'DWY',campaigns:1},
];
const spend = new Map([['account-a',{spend:100,leads:10}],['account-b',{spend:300,leads:30}],['account-c',{spend:50,leads:5}]]);
const books = new Map([['account-a',{confirmed:1,provisional:2}],['account-b',{confirmed:5,provisional:1}]]);
const counts = new Map([
  ['account-a',{leads:10,bookings:3,confirmed:1,provisional:2,showed:1,noshow:0,closes:1,noOutcome:2}],
  ['account-b',{leads:30,bookings:6,confirmed:5,provisional:1,showed:3,noshow:2,closes:1,noOutcome:1}],
]);
const group=(rows=clients)=>deliveryClientGroups(rows,spend,books,counts,new Map());

test('two exact ad accounts produce one client and ratios use combined counts',()=>{
  const rows=group();
  expect(rows.length).toBe(2);
  expect(rows[0]).toMatchObject({clickupTaskId:'client-one',accountIds:['account-a','account-b'],campaigns:5,spend:{spend:400,leads:40},booked:{confirmed:6,provisional:3}});
  expect(deliveryRates(rows[0].counts)).toMatchObject({bookRate:0.225,bookRateConfirmed:0.15,showRate:0.667,closeRate:0.5});
  // Same display name is never a client identity.
  expect(rows[1].clickupTaskId).toBe('client-two');
});

test('the published current metrics have one key per client',()=>{
  const rows=group().map(c=>({client:c.name,clickupTaskId:c.clickupTaskId,spend7d:c.spend.spend,leads7d:c.spend.leads,
    bookings7d:c.booked.confirmed+c.booked.provisional,confirmed7d:c.booked.confirmed,rates30:deliveryRates(c.counts)}));
  const metrics=extractDelivery({clients:rows} as any);
  const keys=metrics.map(m=>`${m.metric}/${m.scope}/${m.window}`);
  expect(new Set(keys).size).toBe(keys.length);
  expect(metrics.find(m=>m.metric==='delivery.spend'&&m.scope==='client:client-one')?.value).toBe(400);
});

test('a repeated identical source join counts once, but conflicting client ownership is held',()=>{
  expect(group([...clients,clients[0]])).toEqual(group());
  expect(()=>group([...clients,{...clients[0],clickupTaskId:'other-client'}])).toThrow('more than one client');
});

test('unmapped accounts remain separate and missing denominators stay unknown',()=>{
  const rows=group(clients.map(c=>({...c,clickupTaskId:null})) as any);
  expect(rows.length).toBe(3);
  expect(deliveryRates(rows[2].counts).showRate).toBeNull();
  expect(deliveryRates(rows[2].counts).closeRate).toBeNull();
});

test('conflicting service modes are not silently selected',()=>{
  const rows=group(clients.map(c=>({...c,serviceMode:c.clientId==='account-b'?'DWY':c.serviceMode})));
  expect(rows[0].serviceMode).toBeNull();
});

test('client warning counts use the same exact client identities without accounting inputs',()=>{
  const rows=deliveryClientGroups(clients);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({clickupTaskId:'client-one',campaigns:5,accountIds:['account-a','account-b'],serviceMode:'dfy'});
});

test('invalid numeric source values fail before publication',()=>{
  expect(()=>deliveryClientGroups(clients,new Map([['account-a',{spend:NaN}]]),books,counts,new Map())).toThrow('invalid source count');
});

test('follow-up examples retain newest items across accounts without mutating sources',()=>{
  const old=Array.from({length:20},(_,i)=>({at:`2026-09-${String(i+1).padStart(2,'0')}`}));
  const newest=[{at:'2026-10-21'},{at:'2026-10-20'}];
  const rows=deliveryClientGroups(clients,spend,books,counts,new Map([['account-a',old],['account-b',newest]]));
  expect(rows[0].noOutcome.length).toBe(20);
  expect(rows[0].noOutcome[0].at).toBe('2026-10-21');
  expect(old[0].at).toBe('2026-09-01');
});

test('the full delivery adapter publishes one metric per client across multiple accounts and omits no-spend clients',async()=>{
  const now=Date.now(), day=new Date(now-86400000+3*3600000).toISOString().slice(0,10);
  // Only the database boundary is stubbed: the production source parser,
  // delivery adapter and metric extractor all run. Each read is answered by
  // what it asks for, so the order the adapter starts them in does not matter.
  const answer=(query:string):any[]=>{
    if(query.includes('cockpit_client_days'))return [
      {location_id:'loc-one',clickup_id:'client-one',client_name:'Client One',status:'Active',service_mode:'DFY',date:day,confirmed:4,provisional:1,computed_ms:now},
      {location_id:'loc-empty',clickup_id:'client-empty',client_name:'No spend',status:'Active',service_mode:'DFY',date:day,confirmed:2,provisional:0,computed_ms:now},
    ];
    if(query.includes('cockpit_media_feed_state'))return [{ready:true,source_rows:2,actual_rows:2,snapshot_ms:now,first_day:day,last_day:day}];
    if(query.includes('board_rows'))return [
      ...clients.map(c=>({client_id:c.clientId,account:c.clientId,name:c.name,clickup_id:c.clickupTaskId,service_mode:c.serviceMode,hidden:false,
        location_id:c.clickupTaskId==='client-one'?'loc-one':null,on_board:c.clickupTaskId==='client-one',board_rows:1})),
    ];
    if(query.includes('round(sum(l.spend), 2)'))return [];
    if(query.includes('client_opportunities'))return [];
    if(query.includes('appointment_outcomes o') && query.includes('outcome_rows'))return [{}];
    if(query.includes('ap.tie as client_id'))return [];
    if(query.includes('spend_usd, leads, campaigns'))return [
      {client_id:'account-a',day,spend_usd:100,leads:10,campaigns:['A'],source:'media'},
      {client_id:'account-b',day,spend_usd:300,leads:30,campaigns:['B'],source:'media'},
    ];
    throw new Error(`Unexpected database read: ${query.slice(0,80)}`);
  };
  let reads=0;
  const repository={delivery:async()=>({
    campaigns:[{campaignName:'A',clientName:'Client One',spend7d:400,leads7d:40,bookings7d:4,bookingsTracked:true,syncedAt:now}],
    daily:[{date:day,campaignName:'A',spend:400,leads:40}],bookings:[],clients:[],launches:[],tree:[],offBoard:[],health:{},
  })} as unknown as Runtime['repository'];
  const result=await withRuntime({env:()=>undefined,read:async(_p:string,q:string)=>{reads+=1;return answer(q);},repository,tools:{} as Runtime['tools']},()=>delivery.compute({repository}));
  expect(reads).toBe(8);
  const payload=result.payload as any;
  expect(payload.bookingSource).toBe('board');
  expect(payload.clients).toHaveLength(1);
  // The board's 4 confirmed and 1 provisional on the card's location, over the $400 the board stores.
  expect(payload.clients[0]).toMatchObject({clickupTaskId:'client-one',spend7d:400,leads7d:40,confirmed7d:4,provisional7d:1,bookings7d:5,spendMeasured7d:400,cpbConfirmed7d:100,bookingsWhy:null,status:'bad'});
  // The company window counts every stored booking on a tied location; the
  // client with no spend here is named, not counted.
  expect(payload.last7).toMatchObject({spend:400,confirmed:4,provisional:1,bookings:5,spendMeasured:400,cpbConfirmed:100,cpb:80,notMeasured:[]});
  expect(payload.notes.some((n:any)=>n.text.includes('No spend (2)'))).toBe(true);
  const day1=payload.daily.find((r:any)=>r.date===day);
  expect(day1).toMatchObject({confirmed:4,provisional:1,spendMeasured:400,bookings:5});
  expect(result.sources.find(s=>s.name==='Client bookings (Client Performance board, cockpit_client_days)')?.ok).toBe(true);
  const metrics=extractDelivery(payload), keys=metrics.map(m=>`${m.metric}/${m.scope}/${m.window}`);
  expect(new Set(keys).size).toBe(keys.length);
  expect(metrics.find(m=>m.metric==='delivery.spend'&&m.scope==='client:client-one')?.value).toBe(400);
  expect(metrics.find(m=>m.metric==='delivery.cpb_confirmed'&&m.scope==='company'&&m.window==='last7')?.value).toBe(100);
});

test('a failed board read is not zero bookings: the section fails and keeps its last good payload',async()=>{
  const repository={delivery:async()=>({campaigns:[{campaignName:'A',spend7d:0,syncedAt:Date.now()}],daily:[],bookings:[]})} as unknown as Runtime['repository'];
  const read=async(_p:string,q:string)=>{if(q.includes('cockpit_client_days'))throw new Error('permission denied');return [];};
  await expect(withRuntime({env:()=>undefined,read,repository,tools:{} as Runtime['tools']},()=>delivery.compute({repository}))).rejects.toThrow('could not be read');
});
