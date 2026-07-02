// Build: generate sw.js with a content-hashed cache name.
// index.html in this repo is the single source of truth — edit it directly,
// run `node build.js`, then commit & push.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;

const fail = msg => { console.error('BUILD FAILED:', msg); process.exit(1); };
const assert = (cond, msg) => { if (!cond) fail(msg); };

// ---- sanity checks: never ship a silently broken page ----
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
assert(html.includes('rel="manifest"'), 'manifest link missing in index.html');
assert(html.includes('serviceWorker'), 'service worker registration missing in index.html');
assert(html.includes('const phrases = ['), 'phrases array missing in index.html');
assert(!html.includes('fonts.googleapis.com'), 'external Google Fonts link still present — fonts must be self-hosted');

const fontFiles = fs.readdirSync(path.join(ROOT, 'fonts')).filter(f => f.endsWith('.woff2'));
assert(fontFiles.length >= 2, 'expected self-hosted .woff2 fonts in fonts/');
for (const f of fontFiles) {
  assert(html.includes(`./fonts/${f}`), `font file ${f} is not referenced by index.html`);
}

// ---- cache name derived from content: any change rolls the cache ----
const shipped = ['index.html', 'manifest.json', 'icon-192.png', 'icon-512.png',
  ...fontFiles.map(f => 'fonts/' + f)];
const hash = crypto.createHash('sha256');
for (const f of shipped) hash.update(fs.readFileSync(path.join(ROOT, f)));
const CACHE = 'ee-' + hash.digest('hex').slice(0, 12);

const assets = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png',
  ...fontFiles.map(f => './fonts/' + f)];

const sw = `const CACHE = '${CACHE}';
const ASSETS = ${JSON.stringify(assets, null, 2)};
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(cached => {
      const network = fetch(req).then(res => {
        if (res && res.status === 200 && (res.type === 'basic' || res.type === 'cors')) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() =>
        cached ||
        (req.mode === 'navigate'
          ? caches.match('./index.html', { ignoreSearch: true })
          : new Response('', { status: 503, statusText: 'offline' }))
      );
      return cached || network;
    })
  );
});
`;
fs.writeFileSync(path.join(ROOT, 'sw.js'), sw);
console.log('BUILD OK — cache:', CACHE);
console.log('assets:', assets.join(', '));
