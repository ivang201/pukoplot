// Сеть в отдельном потоке: приём не ждёт, пока браузер дорисует кадр,
// а пинг измеряется честно — только сеть, без подвисаний страницы.
let ws = null, url = '';
const abs = () => performance.timeOrigin + performance.now();      // мс, общее время для всех потоков
function connect() {
  ws = new WebSocket(url);
  ws.onopen = () => { postMessage({ t: '_open' }); ping(); };
  ws.onclose = () => { postMessage({ t: '_close' }); setTimeout(connect, 1500); };
  ws.onmessage = (e) => {
    const tr = abs(), s = e.data;
    if (typeof s === 'string' && s.startsWith('{"t":"pong"')) {
      const m = JSON.parse(s), r = (tr - m.c) / 1000;
      if (typeof m.T === 'number' && r >= 0 && r < 5) postMessage({ t: '_clock', r, off: m.T + r / 2 - tr / 1000 });
      return;
    }
    postMessage({ t: '_msg', s, tr });
  };
}
function ping() { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'ping', c: abs() })); }
setInterval(ping, 500);
onmessage = (e) => {
  const d = e.data;
  if (d.t === '_connect') { url = d.url; connect(); return; }
  if (ws && ws.readyState === 1) ws.send(d.s);
};
