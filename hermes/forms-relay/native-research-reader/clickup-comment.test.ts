import {describe, test, expect} from 'bun:test';
import {makeClickupCommentReader} from './clickup-comment.ts';
const signal = () => new AbortController().signal;
const reply = (comments: unknown[]) => new Response(JSON.stringify({comments}), {status:200});
const item = (id: string, text='hello') => ({id, date:'1700000000000', comment_text:text});
describe('ClickUp task comment adapter', () => {
  test('gets exact text from exact task and limits network privileges', async () => {
    let called = 0;
    const read = makeClickupCommentReader('fictional', async (url, opts) => {
      called++; expect(url).toBe('https://api.clickup.com/api/v2/task/test123/comment');
      expect(opts.method).toBe('GET'); expect(opts.redirect).toBe('error');
      return reply([item('10','مرحبا\nworld')]);
    });
    const got = await read('test123','10',signal());
    expect(new TextDecoder().decode(got!.bytes)).toBe('مرحبا\nworld'); expect(called).toBe(1);
  });
  test('paginates using exact id and timestamp and finds only pinned comment', async () => {
    let calls=0;
    const page=Array.from({length:25},(_,i)=>item(String(i+1)));
    const read=makeClickupCommentReader('fictional',async (url)=> {
      calls++; if(calls===1)return reply(page);
      const u=new URL(url); expect(u.searchParams.get('start_id')).toBe('25'); expect(u.searchParams.get('start')).toBe('1700000000000');
      return reply([item('50','specific')]);
    });
    expect(new TextDecoder().decode((await read('test123','50',signal()))!.bytes)).toBe('specific'); expect(calls).toBe(2);
  });
  test('missing and malformed comments never fall back to a different result', async () => {
    expect(await makeClickupCommentReader('x',async()=>reply([item('9')]))('abc','10',signal())).toBeNull();
    await expect(makeClickupCommentReader('x',async()=>reply([{id:'10',comment_text:null}]))('abc','10',signal())).rejects.toThrow('Comment read denied');
  });
  test('rejects untrusted task identifiers before network', async () => {
    let called=false; const read=makeClickupCommentReader('x',async()=>{called=true; return reply([])});
    await expect(read('../other','10',signal())).rejects.toThrow(); expect(called).toBe(false);
  });
  test('rejects duplicate ids, oversized data, HTTP errors, malformed JSON', async () => {
    for (const response of [reply([item('10'),item('10')]), reply([item('10','x'.repeat(256*1024+1))]), new Response('',{status:403}), new Response('{',{status:200})]) {
      await expect(makeClickupCommentReader('x',async()=>response)('abc','10',signal())).rejects.toThrow('Comment read denied');
    }
  });
  test('bounds pagination and rejects repeated cursors', async () => {
    let calls=0; const read=makeClickupCommentReader('x',async()=>{calls++; return reply(Array.from({length:25},(_,i)=>item(String(i+1))))});
    await expect(read('abc','999',signal())).rejects.toThrow(); expect(calls).toBe(2);
  });
  test('cancelled operation does not leak network failure text', async () => {
    const c=new AbortController(); c.abort(); let called=false;
    const read=makeClickupCommentReader('x',async()=>{called=true; throw new Error('private')});
    await expect(read('abc','10',c.signal)).rejects.toThrow('Comment read denied'); expect(called).toBe(false);
  });
});

test('aborts a provider that ignores the signal without leaking its result', async () => {
  const controller = new AbortController();
  const read = makeClickupCommentReader('fictional', async () => new Promise<Response>(() => {}));
  const pending = read('abc', '10', controller.signal);
  controller.abort();
  await expect(pending).rejects.toThrow('Comment read denied');
});
test('rejects pagination beyond four pages instead of substituting another comment', async () => {
  let calls=0;
  const read=makeClickupCommentReader('fictional',async()=>{
    calls++;
    return reply(Array.from({length:25},(_,i)=>item(String(calls*100+i))));
  });
  await expect(read('abc','9999',signal())).rejects.toThrow('Comment read denied');
  expect(calls).toBe(4);
});
test('rejects provider bodies above the declared limit without reading', async () => {
  const response=new Response('{}',{status:200,headers:{'content-length':'1048577'}});
  await expect(makeClickupCommentReader('x',async()=>response)('abc','10',signal())).rejects.toThrow('Comment read denied');
});
