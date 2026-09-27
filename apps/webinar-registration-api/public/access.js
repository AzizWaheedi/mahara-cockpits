const params = new URLSearchParams(location.hash.slice(1));
const purposes = [...params.keys()];
const purpose = purposes.length === 1 && ['join','survey'].includes(purposes[0]) ? purposes[0] : null;
const token = purpose && params.get(purpose);
const message = document.getElementById('message');
const heading = document.getElementById('heading');
if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
  heading.textContent = 'الرابط مو متاح';
  message.textContent = 'افتح الرابط الخاص بتسجيلك وتأكد إنه كامل.';
} else {
  heading.textContent = purpose === 'join' ? 'جاهز للتدريب؟' : 'الاستبيان الخاص فيك';
  const button = document.createElement('button');
  button.textContent = purpose === 'join' ? 'ادخل التدريب' : 'افتح الاستبيان';
  document.getElementById('actions').append(button);
  button.onclick = async () => {
    button.disabled = true;
    try {
      const r = await fetch('/api/access', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({purpose,token}),signal:AbortSignal.timeout(12000)});
      const data = await r.json();
      if (!r.ok || !data.destination) throw Error();
      location.replace(data.destination);
    } catch {
      message.textContent = 'ما قدرنا نفتح الرابط. يمكن انتهت صلاحيته، جرّب مرة ثانية أو ارجع لفريق مهارة.';
      button.disabled = false;
    }
  };
}
