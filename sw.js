/* офлайн-кэш: страница и видео */
const V = 'ptp-v3';
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Safari просит видео кусками (Range → 206), такой ответ в кэш не кладётся.
// Поэтому видео скачиваем целиком один раз, а куски режем из кэша сами.
const loading = {};
async function fullVideo(key) {
  const c = await caches.open(V);
  const hit = await c.match(key);
  if (hit) return hit;
  if (!loading[key]) {
    loading[key] = fetch(key).then(async res => {
      if (res.ok && res.status === 200) await c.put(key, res.clone());
      return res;
    }).finally(() => { delete loading[key]; });
  }
  await loading[key];
  return c.match(key);
}
async function video(req) {
  const u = new URL(req.url); u.search = '';
  let full;
  try { full = await fullVideo(u.href); } catch (e) { full = null; }
  if (!full) return fetch(req);
  const range = req.headers.get('range');
  if (!range) return full;
  const buf = await full.arrayBuffer(), size = buf.byteLength;
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  let start = 0, end = size - 1;
  if (m && m[1] !== '') { start = +m[1]; if (m[2] !== '') end = Math.min(+m[2], size - 1); }
  else if (m && m[2] !== '') { start = Math.max(0, size - +m[2]); }
  if (start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes',
      'Content-Range': 'bytes ' + start + '-' + end + '/' + size,
      'Content-Length': String(end - start + 1)
    }
  });
}

// страница: сеть (не дольше 4 с), иначе — кэш
async function page(req) {
  const c = await caches.open(V);
  const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; });
  net.catch(() => {});
  try {
    const r = await Promise.race([net, new Promise(ok => setTimeout(ok, 4000, null))]);
    if (r) return r;
  } catch (e) {}
  const hit = await c.match(req, { ignoreSearch: true });
  return hit || net;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  e.respondWith(url.pathname.endsWith('.mp4') ? video(req) : page(req));
});
