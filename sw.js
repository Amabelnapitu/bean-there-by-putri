// Bean There offline support: keeps the app and the latest café list on the phone.
var CACHE = "bean-there-v1";
var SHELL = ["./", "index.html", "styles.css", "app.js", "config.js", "data/cafes.csv", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// Try the network first (so updates show up straight away), but give up after a few seconds
// on a weak signal and use the saved copy instead.
function networkFirst(req, cacheKey) {
  return caches.open(CACHE).then(function (cache) {
    var network = fetch(req).then(function (res) {
      if (res && (res.ok || res.type === "opaque")) cache.put(cacheKey || req, res.clone());
      return res;
    });
    var timeout = new Promise(function (resolve) { setTimeout(resolve, 4000); });
    return Promise.race([network, timeout.then(function () { return cache.match(cacheKey || req); })])
      .then(function (res) { return res || network; })
      .catch(function () { return cache.match(cacheKey || req); })
      .then(function (res) { return res || network; });
  });
}

function cacheFirst(req) {
  return caches.open(CACHE).then(function (cache) {
    return cache.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) { if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()); return res; });
    });
  });
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.hostname === "script.google.com" || url.hostname.endsWith("googleusercontent.com")) return; // votes and notes need the network
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") { e.respondWith(cacheFirst(req)); return; }
  if (url.hostname === "docs.google.com") { e.respondWith(networkFirst(req, url.href)); return; } // the published café list
  if (url.origin === self.location.origin) {
    if (req.mode === "navigate") { e.respondWith(networkFirst(req, "index.html")); return; }
    e.respondWith(networkFirst(req, url.pathname.endsWith("/") ? "./" : url.href.split("?")[0]));
  }
});
