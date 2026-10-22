// Корефаны: уведомления на телефон, когда сайт закрыт (Web Push).
// Включаются в профиле. На iPhone работают только если сайт добавлен на экран «Домой».

const VAPID_PUBLIC_KEY = "BDxXcj4xWyY64OKqehyLNcDC4eo0t0WRLFLHlCMF1eRQXe4N-AhF9uAW9H0ZZO_xvRCynJRDWr5NGPJHLlcJMxI";
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const secureSite = location.protocol === "https:" || location.hostname === "localhost";

if ("serviceWorker" in navigator && secureSite) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

function b64ToBytes(s) {
  const raw = atob((s + "=".repeat((4 - s.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

// Фоновый помощник готов. Если он так и не запустился (бывает в странных браузерах),
// через 5 секунд сдаёмся, а не висим вечно на «Проверяю...»
function swReady() {
  return Promise.race([navigator.serviceWorker.ready, new Promise((_, no) => setTimeout(() => no(new Error("помощник не запустился")), 5000))]);
}

// Что сейчас с уведомлениями на этом устройстве
async function pushState() {
  if (isIOS && !isStandalone) return "need-install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window) || !secureSite) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await swReady();
  const sub = await reg.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

// Сохраняем адрес этого устройства в базе, чтобы сервер знал, куда слать.
// Через функцию claim_push: если телефоном раньше пользовался другой корефан, адрес перейдёт к тебе
async function saveSubscription(sub) {
  const j = sub.toJSON();
  let { error } = await sb.rpc("claim_push", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
  // Если 11_fixes.sql ещё не выполнен — по-старому
  if (error && /claim_push/.test(error.message || "")) {
    ({ error } = await sb.from("push_subscriptions").upsert(
      { endpoint: j.endpoint, user_id: me(), p256dh: j.keys.p256dh, auth: j.keys.auth },
      { onConflict: "endpoint" }
    ));
  }
  if (error) throw error;
}

// При выходе из аккаунта: этот телефон больше не получает уведомления выходящего человека
async function unlinkPushDevice() {
  try {
    if (!("serviceWorker" in navigator) || !secureSite) return;
    const sub = await (await swReady()).pushManager.getSubscription();
    if (sub) await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  } catch (e) {}
}

async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return "denied";
  const reg = await swReady();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY) });
  await saveSubscription(sub);
  return "on";
}

async function disablePush() {
  const reg = await swReady();
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
    await sub.unsubscribe();
  }
  return "off";
}

// После входа ещё раз привязываем устройство к тому, кто вошёл
async function syncPush() {
  try {
    if (await pushState() !== "on") return;
    const sub = await (await swReady()).pushManager.getSubscription();
    if (sub) await saveSubscription(sub);
  } catch (e) {}
}

// Блок «Уведомления на телефон» в профиле
async function renderPushBox() {
  const box = document.getElementById("pushBox"); if (!box) return;
  const st = await pushState().catch(() => "unsupported");
  const texts = {
    "need-install": `<p class="msg">На iPhone уведомления работают только из приложения:<br>
      1. В Safari нажми <b>«Поделиться»</b> → <b>«На экран "Домой"»</b>.<br>
      2. Открой Корефаны <b>с иконки</b> на экране.<br>
      3. Зайди сюда в профиль и включи уведомления.</p>`,
    "unsupported": `<p class="msg">Этот браузер не умеет получать уведомления. Попробуй Chrome или Safari на iPhone через иконку на экране «Домой».</p>`,
    "denied": `<p class="msg">Уведомления запрещены в настройках. Разреши их: <b>Настройки телефона → Уведомления → Корефаны</b> (или настройки сайта в браузере), потом вернись сюда.</p>`,
    "off": `<div class="row"><button class="btn primary" type="button" data-push="on">🔔 Включить уведомления</button></div>
      <p class="msg">Будут приходить сообщения из чатов, даже когда сайт закрыт.</p>`,
    "on": `<div class="row"><span class="push-on">✅ Уведомления включены</span>
      <button class="btn" type="button" data-push="test">Проверить</button>
      <button class="btn" type="button" data-push="off">Выключить</button></div>`
  };
  box.innerHTML = texts[st] || texts.unsupported;
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-push]"); if (!b) return;
  b.disabled = true;
  try {
    if (b.dataset.push === "on") await enablePush();
    if (b.dataset.push === "off") await disablePush();
    if (b.dataset.push === "test") {
      const reg = await swReady();
      await reg.showNotification("Корефаны", { body: "Так будут выглядеть уведомления о сообщениях", icon: "icons/icon-192.png", tag: "test" });
    }
  } catch (err) {
    toast("Не получилось: " + (err.message || err));
  }
  b.disabled = false;
  renderPushBox();
});
