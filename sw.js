// Корефаны: фоновый помощник (service worker).
// Живёт в телефоне отдельно от сайта и показывает уведомления, даже когда сайт закрыт.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

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
          if ("navigate" in w) await w.navigate(url);
          return;
        } catch (err) { /* окно не даёт перейти — откроем новое ниже */ }
      }
    }
    await self.clients.openWindow(url);
  })());
});
