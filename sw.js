/* 캐시 버전을 명시적으로 관리 — 코드 수정 후 배포할 때마다 반드시 올릴 것.
   (TATELIFT 때 겪은 stale cache 문제 방지) */
const CACHE_VERSION = "v0.1.0";
const CACHE_NAME = "ledger-" + CACHE_VERSION;
const APP_SHELL = [
  "./", "./index.html", "./styles.css", "./app.js", "./ocr.js", "./parser.js",
  "./manifest.json", "./icon-192.png", "./icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("ledger-") && k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* 앱 셸: cache-first. Tesseract CDN(코드+언어모델): 최초 1회 받아서 런타임 캐시 → 이후 완전 오프라인. */
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const isTesseract = url.hostname.includes("jsdelivr.net") || url.hostname.includes("unpkg.com")
    || url.pathname.includes("tesseract") || url.pathname.endsWith(".traineddata.gz");
  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).then((res) => {
        if (res.ok && (isTesseract || url.origin === location.origin)) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});
