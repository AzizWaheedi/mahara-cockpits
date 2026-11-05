import { describe, expect, test } from 'bun:test';
import { committedSourcePort, READ_SOURCE_SQL } from './source-port.ts';

const binding = { taskId:'fictional',responseId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',schemaVersion:3,commentId:'fictional',commentSha256:'a'.repeat(64) };
const identity = { runId:'123',attempt:'2' };
const secret = 'synthetic-capability';
const signal = new AbortController().signal;

describe('source port, synthetic committed-query contract',()=>{
  test('passes the secret and exact binding as separate SQL parameters',async()=>{
    let got: unknown[] = [];
    const port=committedSourcePort(async (sql,params,received)=>{
      expect(sql).toBe(READ_SOURCE_SQL); expect(received).toBe(signal); got=[...params];
      return {rows:[{snapshot:{taskId:'fictional'}}]};
    });
    expect((await port(binding,secret,identity,signal))?.taskId).toBe('fictional');
    expect(got).toEqual([secret,binding.taskId,binding.responseId,3,binding.commentId,binding.commentSha256,'123',2]);
    expect(READ_SOURCE_SQL).not.toContain(secret);
  });
  test('denies malformed identities, aborts, bad shapes and private errors',async()=>{
    let calls=0;
    const port=committedSourcePort(async()=>{calls++;throw new Error('fictional private capability');});
    expect(await port(binding,secret,{runId:'bad',attempt:'1'},signal)).toBeNull();
    const controller=new AbortController();controller.abort();
    expect(await port(binding,secret,identity,controller.signal)).toBeNull();
    expect(calls).toBe(0);
    expect(await port(binding,secret,identity,signal)).toBeNull();
    const multiple=committedSourcePort(async()=>({rows:[{snapshot:{}},{snapshot:{}}]}));
    expect(await multiple(binding,secret,identity,signal)).toBeNull();
  });
});
