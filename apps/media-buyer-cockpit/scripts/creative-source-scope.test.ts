import {test,expect} from 'bun:test';
import {sourceClientNames} from '../../../scripts/lib/creativeSourceScope';
const sets={clients:[{name:'Alpha Design',aliases:['Alpha Ad Account','alpha']},{name:'Beta Design',aliases:['beta']}],campaigns:[{_id:'campaign',campaignName:'Alpha | GCC',clientName:'Alpha Design',accountName:'Alpha Ad Account'}]};
test('scope follows exact clients/task tags/campaign joins and rejects industry-word guesses',()=>{
 expect(sourceClientNames('clients',{_id:'a',name:'Alpha Design'},sets)).toEqual(['Alpha Design']);
 expect(sourceClientNames('creativeTasks',{_id:'task',clients:['alpha','beta']},sets)).toEqual(['Alpha Design','Beta Design']);
 expect(sourceClientNames('creativeTasks',{_id:'unassigned',clients:[]},sets)).toEqual([]);
 expect(sourceClientNames('ads',{_id:'ad',campaignName:'Alpha | GCC'},sets)).toEqual(['Alpha Design']);
 expect(sourceClientNames('funnels',{_id:'form',account:'Alpha Ad Account'},sets)).toEqual(['Alpha Design']);
 expect(()=>sourceClientNames('funnels',{_id:'bad',account:'Design Ad Account'},sets)).toThrow('missing');
 expect(()=>sourceClientNames('videoJobs',{_id:'bad',clients:['alpha','Unknown']},sets)).toThrow('missing');
 expect(()=>sourceClientNames('campaigns',{_id:'bad',clientName:'Alpha Design',accountName:'beta'},sets)).toThrow('ambiguous');
 expect(sourceClientNames('winnersArchive',{_id:'shared',client:'Unknown'},sets)).toEqual([]);
});
test('duplicate aliases and duplicate campaign ownership fail closed',()=>{
 expect(()=>sourceClientNames('clients',{_id:'a',name:'alpha'},{...sets,clients:[...sets.clients,{name:'Another',aliases:['alpha']}]})).toThrow('ambiguous');
 expect(()=>sourceClientNames('metaTree',{_id:'ad',campaignName:'Alpha | GCC'},{...sets,campaigns:[...sets.campaigns,{_id:'other',campaignName:'Alpha | GCC',clientName:'Beta Design'}]})).toThrow('ambiguous');
});
