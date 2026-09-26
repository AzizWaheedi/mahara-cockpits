/* Shared bilingual countdown. Missing or mixed schedule assets never invent a date. */
(function () {
  var schedule = window.MAHARA_WEBINAR;
  var box = document.getElementById('countdown');
  var over = document.getElementById('countOver');
  var marker = document.querySelector('meta[name="webinar-config-sha256"]');
  if (!box || !over) return;
  var target = schedule && schedule.starts_at ? Date.parse(schedule.starts_at) : NaN;
  if (!schedule || schedule.status !== 'scheduled' || !marker ||
      marker.content !== schedule.config_sha256 || !Number.isFinite(target)) {
    box.style.display = 'none';
    over.style.display = 'none';
    return;
  }
  var ids = ['cd-d', 'cd-h', 'cd-m', 'cd-s'];
  function tick() {
    var diff = target - Date.now();
    if (diff <= 0) { box.style.display = 'none'; over.style.display = 'inline'; return; }
    var values = [Math.floor(diff / 86400000), Math.floor(diff / 3600000) % 24,
      Math.floor(diff / 60000) % 60, Math.floor(diff / 1000) % 60];
    values.forEach(function (value, i) {
      var text = String(value).padStart(2, '0');
      if (document.documentElement.lang === 'ar') text = text.replace(/\d/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'[Number(d)]; });
      document.getElementById(ids[i]).textContent = text;
    });
    setTimeout(tick, 1000);
  }
  tick();
})();
