import os, socket, struct, threading, time
# Run only against a disposable synthetic database. No production data.
P=os.path.join(os.environ['SYNTHETIC_PG_SOCKET_DIR'], '.s.PGSQL.5432')
class DB:
 def __init__(self):
  self.s=socket.socket(socket.AF_UNIX);self.s.connect(P)
  b=struct.pack('!I',196608)+b'user\0sandbox_test\0database\0postgres\0\0';self.s.sendall(struct.pack('!I',len(b)+4)+b);self.read()
 def recv(self,n):
  out=b''
  while len(out)<n:
   b=self.s.recv(n-len(out))
   if not b:raise RuntimeError('socket closed')
   out+=b
  return out
 def read(self):
  rows=[];err=None
  while True:
   typ=self.recv(1);n=struct.unpack('!I',self.recv(4))[0];b=self.recv(n-4)
   if typ==b'D':
    count=struct.unpack('!H',b[:2])[0];off=2;row=[]
    for _ in range(count):
     ln=struct.unpack('!i',b[off:off+4])[0];off+=4;row.append(None if ln<0 else b[off:off+ln].decode());off+=max(0,ln)
    rows.append(row)
   if typ==b'E':err=b
   if typ==b'Z':
    if err:raise RuntimeError(err)
    return rows
 def q(self,q):
  b=q.encode()+b'\0';self.s.sendall(b'Q'+struct.pack('!I',len(b)+4)+b);return self.read()
 def close(self):self.s.close()
a=DB();b=DB();a.q("CREATE TABLE synthetic_request_types (key text primary key, policy text not null, version int not null); INSERT INTO synthetic_request_types VALUES ('card_missing','legacy',1)")
# Scenario A: submission reads and locks the row. A concurrent activation waits until it commits.
a.q('BEGIN');r=a.q("SELECT policy,version FROM synthetic_request_types WHERE key='card_missing' FOR SHARE");assert r==[['legacy','1']]
started=threading.Event();done=threading.Event();out=[]
def activation():
 started.set();out.append(b.q("UPDATE synthetic_request_types SET policy='retained_v1',version=2 WHERE key='card_missing'"));done.set()
t=threading.Thread(target=activation);t.start();assert started.wait(2);time.sleep(.3);assert not done.is_set(),'activation did not wait for legacy submit';a.q('COMMIT');assert done.wait(3);t.join();assert a.q("SELECT policy,version FROM synthetic_request_types WHERE key='card_missing'")==[['retained_v1','2']]
# Scenario B: activation locks first. The submit re-read waits, then sees the committed v1 row.
a.q("UPDATE synthetic_request_types SET policy='legacy',version=3 WHERE key='card_missing'");a.q('BEGIN');a.q("UPDATE synthetic_request_types SET policy='retained_v1',version=4 WHERE key='card_missing'")
started.clear();done.clear();out.clear()
def submission():
 started.set();out.append(b.q("SELECT policy,version FROM synthetic_request_types WHERE key='card_missing' FOR SHARE"));done.set()
t=threading.Thread(target=submission);t.start();assert started.wait(2);time.sleep(.3);assert not done.is_set(),'legacy submission did not wait for activation';a.q('COMMIT');assert done.wait(3);t.join();assert out==[[['retained_v1','4']]],out
# Rollback wakes a waiter and exposes the previous legacy policy.
a.q("UPDATE synthetic_request_types SET policy='legacy',version=5 WHERE key='card_missing'");a.q('BEGIN');a.q("UPDATE synthetic_request_types SET policy='retained_v1',version=6 WHERE key='card_missing'")
started.clear();done.clear();out.clear();t=threading.Thread(target=submission);t.start();assert started.wait(2);time.sleep(.3);assert not done.is_set();a.q('ROLLBACK');assert done.wait(3);t.join();assert out==[[['legacy','5']]],out
print('PASS: two independent PostgreSQL 17 connections: both lock orders and rollback; synthetic isolated row only')
a.q('DROP TABLE synthetic_request_types');a.close();b.close()
