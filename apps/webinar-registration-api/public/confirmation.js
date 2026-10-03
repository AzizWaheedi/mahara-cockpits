const token = new URLSearchParams(location.hash.slice(1)).get('status');
const heading = document.getElementById('heading'), message = document.getElementById('message');
const actions = document.getElementById('actions'), schedule = document.getElementById('schedule');
let tries = 0, active = false;
function retry() {
  actions.replaceChildren();
  const button = document.createElement('button'); button.textContent = 'شيّك على التسجيل';
  button.onclick = () => { tries=0; check(); }; actions.append(button);
}
function confirmed(data) {
  const at = new Date(data.schedule.starts_at), zone = data.schedule.timezone;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'numeric',minute:'2-digit',hourCycle:'h23'}).formatToParts(at).map(p=>[p.type,p.value]));
  const hour=Number(parts.hour), minute=Number(parts.minute);
  const clock=`${hour%12||12}${minute?':'+parts.minute:''}`.replace(/\d/g,d=>'٠١٢٣٤٥٦٧٨٩'[Number(d)]);
  heading.textContent='تأكد تسجيلك'; message.textContent='احتفظ بهالصفحة، منها تقدر تدخل التدريب وتفتح الاستبيان.';
  schedule.replaceChildren();
  for(const text of [new Intl.DateTimeFormat('ar-KW-u-nu-arab',{timeZone:zone,calendar:'gregory',weekday:'long',day:'numeric',month:'long'}).format(at),`${clock} ${hour<12?'صباحًا':'مساءً'} · ${zone==='Asia/Kuwait'?'بتوقيت الكويت ومكة':zone}`]) {
    const row=document.createElement('div');row.textContent=text;schedule.append(row);
  }
  schedule.hidden=false;actions.replaceChildren();
  for(const [purpose,label] of [['join','ادخل التدريب'],['survey','افتح الاستبيان']]) {
    const url=new URL(data.links[purpose]);
    if(url.origin!==location.origin || url.pathname!=='/access.html') throw Error();
    const a=document.createElement('a');a.className='action'+(purpose==='survey'?' secondary':'');a.href=url.href;a.textContent=label;actions.append(a);
  }
}
async function check() {
  if(active)return;active=true;actions.replaceChildren();
  try {
    if(!token || !/^[A-Za-z0-9_-]{43}$/.test(token))throw Error();
    const r=await fetch('/api/status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token}),signal:AbortSignal.timeout(12000)});
    const data=await r.json();if(!r.ok)throw Error();
    if(data.status==='confirmed') { confirmed(data);return; }
    heading.textContent='تسجيلك قيد التجهيز';
    message.textContent=data.status==='schedule_changed'?'موعد التدريب تغيّر. فريق مهارة لازم يراجع حجزك قبل ما نأكد لك الموعد اليديد.':data.status==='needs_review'?'استلمنا طلبك، بس تأكيد الحجز يحتاج مراجعة من فريق مهارة.':'قاعدين نكمل تسجيلك. لا تحتاج تسجّل مرة ثانية.';
    if(data.status==='processing' && ++tries<12) setTimeout(check,5000); else retry();
  } catch {
    heading.textContent='خلنا نتأكد من تسجيلك';message.textContent='ما قدرنا نعرض حالة التسجيل الحين. جرّب مرة ثانية من نفس الصفحة.';retry();
  } finally {active=false;}
}
check();
