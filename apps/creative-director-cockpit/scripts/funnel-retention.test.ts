import {test,expect} from 'bun:test';
import {buildFunnels,snapshotContext} from '../src/lib/creativeSourceModels';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {FunnelRow} from '../src/pages/FunnelsPage';

test('unconfirmed retained form questions stay visible but never count as a live zero or comparison fact',async()=>{
 const known={_id:'verified',account:'Alpha',kind:'Instant form',gates:0,questions:[],ads:[],spend:20,leads:2};
 const retained={_id:'stored',account:'Beta',kind:'Instant form',gates:0,questions:[{label:'Stored project',isGate:true,options:[]}],ads:[],spend:500,leads:100,staleReason:'Form metadata unavailable'};
 const result=await buildFunnels(snapshotContext({funnels:[known,retained],clients:[]}),undefined,null);
 expect(result.rows).toHaveLength(2);expect(result.counts.noGate).toBe(1);expect(result.counts.metadataUnavailable).toBe(1);
 expect(result.byGates).toEqual([{gates:'0',forms:1,spend:20,leads:2,cpl:10}]);
 expect(result.questionBank).toEqual([]);expect(result.rows.find(r=>r._id==='stored')!.questions).toEqual(retained.questions);
 const html=renderToStaticMarkup(createElement(FunnelRow,{r:retained}));
 expect(html).toContain('Form metadata unavailable');expect(html).toContain('role="status"');
});
