// Корефаны: фоновый помощник (service worker).
// Живёт в телефоне отдельно от сайта и показывает уведомления, даже когда сайт закрыт.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// ---------- Память телефона, чтобы сайт открывался мгновенно ----------
// STATIC — файлы самого сайта (скрипты, стили, иконки, шрифты). У скриптов и стилей в адресе ?v=номер,
//          поэтому новая версия сайта — это новый адрес, и старое из памяти никогда не покажется.
// PICS   — фото из Supabase. Ссылки на них каждый час новые (с новым токеном), и без этого телефон
//          заново скачивал бы каждое фото. Храним по пути файла: фото с тем же путём никогда не меняется.
const STATIC = "korefany-static-v1";
const PICS = "korefany-pics-v1";
const PICS_MAX = 800;   // примерно 100–150 МБ превью и фото; самые старые вытесняются
let picsPut = 0;

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const u = new URL(req.url);

  // Открытие сайта: главную страницу всегда сверяем с сервером, а не берём из памяти телефона.
  // Иначе iPhone ещё долго показывал старую версию после обновления сайта
  if (req.mode === "navigate") {
    // Главная страница сайта (а не что-то постороннее на том же адресе): её копию держим в памяти телефона.
    // Нет интернета — сайт всё равно открывается: из этой копии и сохранённых файлов, с сохранённой лентой
    const home = new URL("./", self.registration.scope);
    const isHome = u.origin === home.origin && (u.pathname === home.pathname || u.pathname === home.pathname + "index.html");
    e.respondWith((async () => {
      const cache = await caches.open(STATIC);
      const saved = isHome ? await cache.match(home.href) : null;
      try {
        // Есть сохранённая копия — сеть ждём не дольше 4 секунд (еле живой интернет хуже, чем его отсутствие)
        const ctrl = new AbortController();
        const timer = saved ? setTimeout(() => ctrl.abort(), 4000) : 0;
        const r = await fetch(req.url, { cache: "no-cache", credentials: "same-origin", signal: ctrl.signal });
        clearTimeout(timer);
        if (r.ok && !r.redirected && isHome) {
          const copy = r.clone();
          e.waitUntil(cache.put(home.href, copy.clone()).then(() => keepFiles(cache, copy)).catch(() => {}));
        }
        if (r.status >= 500 && saved) return saved;   // хостинг лежит — открываем сохранённое
        if (!r.redirected) return r;   // ответ с переадресацией Safari для открытия страницы не принимает
      } catch (err) { if (saved) return saved; }
      try { return await fetch(req); } catch (err) { if (saved) return saved; throw err; }
    })());
    return;
  }

  // Фото из хранилища: Yandex (storage.yandexcloud.net/<бакет>/<media|chat>/<путь>?X-Amz-...)
  // или старое из Supabase (/storage/v1/object/sign/<media|chat>/<путь>?token=...). Ключ в памяти у обоих один
  const pic = u.hostname === "storage.yandexcloud.net"
    ? u.pathname.match(/^\/[^/]+\/(media|chat)\/(.+)$/)
    : u.pathname.match(/\/storage\/v1\/object\/sign\/(media|chat)\/(.+)$/);
  if (pic && req.destination === "image" && !req.headers.has("range")) {
    e.respondWith(cachedPic(req, `https://pics.korefany/${pic[1]}/${pic[2]}`));
    return;
  }

  // Файлы сайта и шрифты Google — сначала из памяти
  const same = u.origin === self.location.origin;
  if ((same && (/[?&]v=\d+/.test(u.search) || /\/(vendor|icons|sounds|emoji)\//.test(u.pathname))) || u.hostname === "fonts.gstatic.com") {
    e.respondWith(cacheFirst(req, same && /[?&]v=\d+/.test(u.search)));
    return;
  }
  // Описание шрифтов Google: отдаём из памяти и тихо обновляем
  if (u.hostname === "fonts.googleapis.com") {
    e.respondWith(staleWhileRevalidate(req));
  }
});

// Файлы, которые подключает главная страница (стили и скрипты с ?v=номер, библиотека Supabase), кладём в память
// сразу вместе с ней. Иначе при первом запуске после обновления страница в памяти уже новая, а её файлы ещё нет —
// и без интернета сайт бы не открылся
async function keepFiles(cache, page) {
  const html = await page.text();
  const files = [...html.matchAll(/(?:src|href)="([^":]+\.(?:js|css)(?:\?v=\d+)?)"/g)].map(m => new URL(m[1], self.registration.scope).href);
  await Promise.all([...new Set(files)].map(async url => {
    if (await cache.match(url)) return;
    const r = await fetch(url);
    if (r.ok) await cache.put(url, r);
  }));
  // Прошлые версии тех же файлов из памяти убираем
  const now = new Set(files), paths = new Set(files.map(f => new URL(f).pathname));
  for (const k of await cache.keys()) {
    const ku = new URL(k.url);
    if (/[?&]v=\d+/.test(ku.search) && paths.has(ku.pathname) && !now.has(k.url)) cache.delete(k);
  }
}

async function cacheFirst(req, versioned) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(req);
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok || r.type === "opaque") {
    await cache.put(req, r.clone());
    // Пришла новая версия файла — прошлые версии того же файла из памяти убираем
    if (versioned) {
      const path = new URL(req.url).pathname;
      for (const k of await cache.keys()) {
        if (k.url !== req.url && new URL(k.url).pathname === path) cache.delete(k);
      }
    }
  }
  return r;
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(req);
  const fresh = fetch(req).then((r) => { if (r.ok) cache.put(req, r.clone()); return r; }).catch(() => hit);
  return hit || fresh;
}

async function cachedPic(req, key) {
  const cache = await caches.open(PICS);
  const hit = await cache.match(key);
  if (hit) return hit;
  let r;
  // Берём как обычный запрос с разрешением (CORS): такой ответ можно хранить без лишнего раздувания памяти
  try { r = await fetch(req.url, { mode: "cors", credentials: "omit" }); } catch (err) { return fetch(req); }
  if (r.ok && (r.headers.get("content-type") || "").startsWith("image/")) {
    await cache.put(key, r.clone());
    if (++picsPut % 25 === 0) trimPics(cache);
  }
  return r;
}

async function trimPics(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - PICS_MAX; i++) await cache.delete(keys[i]);   // keys идут от старых к новым
}

// Пришло уведомление с сервера
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data.json(); } catch (err) { d = { title: "Корефаны", body: e.data ? e.data.text() : "" }; }
  e.waitUntil((async () => {
    // Если сайт сейчас открыт перед глазами, уведомление без звука: там уже играет свой
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const focused = wins.some((w) => w.focused);
    await self.registration.showNotification(d.title || "Корефаны", {
      body: d.body || "",
      icon: "icons/icon-192.png",
      badge: "icons/badge-96.png",   // маленький белый значок в строке состояния Android
      image: d.image,                // фото из сообщения (Android)
      timestamp: Date.now(),
      tag: d.tag,            // сообщения из одного чата складываются в одно уведомление
      renotify: true,
      silent: focused,
      vibrate: [120, 60, 120],
      data: { url: d.url || "/" }
    });
  })());
});

// Нажали на уведомление: открываем нужный чат
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  // Адрес из уведомления («/#/chat/...») считаем от папки сайта, а не от корня домена:
  // на GitHub Pages сайт лежит в подпапке (имя.github.io/korefany/)
  const url = new URL((e.notification.data?.url || "").replace(/^\//, ""), self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if ("focus" in w) {
        try {
          await w.focus();
          // Браузер не умеет переводить окно сам (бывает на iPhone) — просим сайт перейти по адресу
          if ("navigate" in w) { try { await w.navigate(url); return; } catch (err) {} }
          w.postMessage({ type: "open", url });
          return;
        } catch (err) { /* окно не даёт перейти — откроем новое ниже */ }
      }
    }
    await self.clients.openWindow(url);
  })());
});
