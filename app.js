// Корефаны: весь сайт в одном файле.
// Страницы переключаются по адресу после #: #/ лента, #/people корефаны,
// #/p/<id> страничка человека, #/quotes цитаты и шутки, #/top лучшее за месяц,
// #/upload загрузка, #/me профиль.

let sb;   // подключение к Supabase, создаётся в start() в самом низу файла
const BUCKET = "media";
const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const COLORS = ["#ff6b5b", "#ffb347", "#ffe066", "#6fd39a", "#5ec8e5", "#8fa8ff", "#c79bff", "#ff8fc7"];
const EMOJI = { laugh: "😂", fire: "🔥", heart: "❤️" };

const state = {
  session: null,
  profiles: [],     // все корефаны
  media: [],        // все фото и видео, новые сверху
  quotes: [],       // цитаты и шутки, новые сверху
  quotesReady: true,// false, если таблицу цитат ещё не создали в Supabase
  quoteFilter: "all",
  mr: [],           // реакции на фото и видео: { media_id, user_id, emoji, created_at }
  qr: [],           // реакции на цитаты: { quote_id, user_id, emoji, created_at }
  reactsReady: true,// false, если таблицы реакций ещё не создали
  comments: [],     // комментарии к фото: { id, media_id, author, text, created_at }
  commentsReady: true,
  topMonth: null,   // какой месяц смотрим в «Топе»
  urls: {},         // временные ссылки на файлы: path -> { url, until }
  clikes: [],       // лайки комментариев: { comment_id, user_id }
  admins: [],       // id админов
  v132: false       // выполнен ли 22_v132.sql (новые возможности прячем, пока его нет)
};
const isAdmin = () => state.admins.includes(me());

const $app = document.getElementById("app");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const me = () => state.session?.user?.id;
const profile = id => state.profiles.find(p => p.id === id);
const nameOf = id => profile(id)?.name || "Кто-то";
const thumbPath = m => m.path.replace(/\.[^.\/]+$/, "") + "_t.jpg";
// Средний размер (1280px) для ленты и обложки: в 3–4 раза легче оригинала, а на экране телефона не отличить.
// Есть только у фото, загруженных после v55; для старых берётся оригинал
const midPath = m => m.kind === "photo" ? m.path.replace(/\.[^.\/]+$/, "") + "_m.jpg" : null;
// Поле для текста растёт под текст. Полоса прокрутки появляется, только когда дошли до максимальной высоты
function autoGrow(ta) {
  const cs = getComputedStyle(ta);
  const max = parseFloat(cs.maxHeight) || 300;
  const min = parseFloat(cs.minHeight) || 0;
  const borders = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
  ta.style.height = "auto";
  let h = ta.scrollHeight + borders;
  // iPhone считает высоту на пару пикселей больше: пока текст в одну строку, держим ровно минимальную высоту
  if (h - min < 8) h = min;
  ta.style.height = Math.min(h, max) + "px";
  ta.style.overflowY = h > max ? "auto" : "hidden";
}
document.addEventListener("input", e => { if (e.target.matches("textarea")) autoGrow(e.target); });

// Высота видимой части экрана. На iPhone, когда открыта клавиатура, она меньше,
// и чат подстраивается под неё, чтобы поле ввода не пряталось за клавиатурой
// --vvh — высота видимой части, --vvt — насколько iPhone сдвинул её вниз, когда выехала клавиатура.
// Чат на телефоне прибит именно к этой видимой части, поэтому не улетает вверх при наборе
if (window.visualViewport) {
  const setVvh = () => {
    const root = document.documentElement.style;
    root.setProperty("--vvh", visualViewport.height + "px");
    root.setProperty("--vvt", visualViewport.offsetTop + "px");
    document.body.classList.toggle("kb-open", visualViewport.height < window.innerHeight - 120);
  };
  visualViewport.addEventListener("resize", setVvh);
  visualViewport.addEventListener("scroll", setVvh);
  window.addEventListener("resize", setVvh);
  // iPhone прячет клавиатуру с анимацией и иногда сообщает размер экрана раньше, чем она доехала.
  // Тогда шторка комментариев оставалась короткой и «висела» посреди экрана — пересчитываем ещё пару раз
  document.addEventListener("focusout", () => { [80, 350, 700].forEach(t => setTimeout(setVvh, t)); });
  setVvh();
}

// Netlify на бесплатном тарифе вешает в правый нижний угол плашку «Powered by Netlify».
// Пока она видна, приподнимаем наши нижние кнопки (отправка, нижнее меню), чтобы плашка их не закрывала.
function watchNetlifyBadge() {
  const check = () => {
    const f = document.getElementById("nl-badge-frame");
    const shown = !!f && f.offsetWidth > 0 && getComputedStyle(f).display !== "none" && getComputedStyle(f).visibility !== "hidden";
    document.body.classList.toggle("has-nl-badge", shown);
  };
  new MutationObserver(check).observe(document.body, { childList: true });
  setInterval(check, 2000);
  check();
}
watchNetlifyBadge();

// «29 декабря 2023», а не «29 декабрь 2023»: в дате месяц стоит в родительном падеже
const MONTHS_OF = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
// Дата без времени («2024-06-12») — это местный день, а не полночь по Гринвичу
const toDate = d => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) : new Date(d);
const dayText = d => { const x = toDate(d); return `${x.getDate()} ${MONTHS_OF[x.getMonth()]} ${x.getFullYear()}`; };

// Аватар: фото, если корефан его поставил, иначе первая буква имени на цветном кружке
function avatar(id, big = false) {
  const n = nameOf(id);
  const pic = profile(id)?.avatar_path && url(profile(id).avatar_path);
  let h = 0; for (const c of id || "") h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `<span class="ava${big ? " big" : ""}" style="background:${COLORS[h % COLORS.length]}">${
    pic ? `<img src="${pic}" alt="">` : esc(n.charAt(0).toUpperCase())}</span>`;
}

// Свой цвет неона у каждого корефана: им светятся его профиль, кольцо аватарки и пузыри в чате
const NEON = {
  pink: { name: "Розовый", a: "#ff4fd8", b: "#8a3cff" },
  cyan: { name: "Голубой", a: "#3ee6ff", b: "#3b6dff" },
  violet: { name: "Фиолетовый", a: "#a86bff", b: "#5b3bd6" },
  green: { name: "Зелёный", a: "#3ddc84", b: "#0fa37f" },
  orange: { name: "Оранжевый", a: "#ff9a3c", b: "#ff4f6d" }
};
const colorOf = id => NEON[profile(id)?.color] || NEON.pink;
const ucStyle = id => { const c = colorOf(id); return `--uc:${c.a};--uc2:${c.b}`; };

// День рождения: сравниваем только месяц и день
const bdayMD = p => p?.birthday ? p.birthday.split("-").slice(1).map(Number) : null;
const isBdayOn = (p, d) => { const md = bdayMD(p); return !!md && md[0] === d.getMonth() + 1 && md[1] === d.getDate(); };
const bdayToday = p => isBdayOn(p, new Date());
const bdayTomorrow = p => isBdayOn(p, new Date(Date.now() + 864e5));
const bdayText = p => { const md = bdayMD(p); return md ? `${md[1]} ${MONTHS_OF[md[0] - 1]}` : ""; };

// Салют из конфетти — в день рождения
function confetti() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const box = document.createElement("div");
  box.className = "confetti";
  const colors = ["#ff4fd8", "#3ee6ff", "#ffe066", "#3ddc84", "#ff9a3c", "#a86bff"];
  box.innerHTML = Array.from({ length: 90 }, () => {
    const s = `left:${Math.random() * 100}%;background:${colors[Math.floor(Math.random() * colors.length)]};` +
      `animation-duration:${2.4 + Math.random() * 2}s;animation-delay:${Math.random() * .6}s;--r:${Math.floor(Math.random() * 720 - 360)}deg;--x:${Math.floor(Math.random() * 160 - 80)}px`;
    return `<i style="${s}"></i>`;
  }).join("");
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 5000);
}

// ---------- Данные ----------

// Supabase отдаёт не больше 1000 строк за раз. Когда фото, реакций или комментариев станет больше,
// забираем их порциями по 1000, иначе часть молча пропала бы
async function fetchAll(build) {
  let all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    // partial: список оборвался на середине. Показывать его можно, а вот сверять по нему «что удалили» нельзя
    if (error) return { data: all.length ? all : null, error: all.length ? null : error, partial: true };
    all = all.concat(data || []);
    if (!data || data.length < 1000) return { data: all, error: null };
  }
}

// Строка media из базы → фото на сайте: отметки людей — простым списком id (вложенный media_people не храним,
// он только раздувал сохранённые на телефоне данные)
const toMedia = ({ media_people, ...x }) => ({ ...x, people: (media_people || []).map(r => r.person_id) });

async function loadAll() {
  const [p, m, q, mr, qr, c, cl, ad] = await Promise.all([
    sb.from("profiles").select("*").order("name"),
    fetchAll(() => sb.from("media").select("*, media_people(person_id)").order("created_at", { ascending: false })),
    fetchAll(() => sb.from("quotes").select("*").order("created_at", { ascending: false })),
    fetchAll(() => sb.from("media_reactions").select("*").order("created_at")),
    fetchAll(() => sb.from("quote_reactions").select("*").order("created_at")),
    fetchAll(() => sb.from("comments").select("*").order("created_at")),
    fetchAll(() => sb.from("comment_likes").select("comment_id, user_id").order("created_at")),   // 22_v132.sql
    sb.from("admins").select("user_id")
  ]);
  state.clikes = cl.error ? [] : cl.data || [];
  state.v132 = !cl.error;   // новые таблицы есть — показываем лайки, ответы и прочее
  state.admins = ad.error ? [] : (ad.data || []).map(x => x.user_id);
  state.commentsReady = !c.error;
  state.comments = c.data || [];
  state.reactsReady = !mr.error && !qr.error;
  state.mr = mr.data || [];
  state.qr = qr.data || [];
  if (p.error || m.error) throw p.error || m.error;
  state.profiles = p.data;
  await signed(state.profiles.flatMap(x => [x.avatar_path, x.cover_path]).filter(Boolean));
  state.media = m.data.map(toMedia);
  // Если таблицу цитат ещё не создали, остальной сайт всё равно работает
  state.quotesReady = !q.error;
  state.quotes = q.data || [];
}

// Только профили — после смены имени, статуса, аватарки или обложки. Быстрее, чем перекачивать все фото и реакции
// Лайки комментариев, админы и «выполнен ли 22_v132.sql»
async function loadExtras() {
  const [cl, ad] = await Promise.all([
    fetchAll(() => sb.from("comment_likes").select("comment_id, user_id").order("created_at")),
    sb.from("admins").select("user_id")
  ]);
  state.clikes = cl.error ? [] : cl.data || [];
  state.v132 = !cl.error;
  state.admins = ad.error ? [] : (ad.data || []).map(x => x.user_id);
}

async function reloadProfiles() {
  const { data, error } = await sb.from("profiles").select("*").order("name");
  if (error) throw error;
  state.profiles = data;
  await signed(state.profiles.flatMap(x => [x.avatar_path, x.cover_path]).filter(Boolean));
  saveCache();
}

// ---------- Сохранённые данные: сайт открывается сразу, а свежие данные догружаются следом ----------
// Всё, что видно на сайте, после загрузки складываем в память браузера (localStorage) — своё у каждого человека.
// При следующем открытии сразу рисуем из неё, а Supabase спрашиваем уже в фоне

const cacheKey = () => "korefany-data-" + me();
// Только данные (без ссылок на файлы и времени) — по этой строке понимаем, изменилось ли что-то
// last_seen меняется каждую минуту — его не считаем, иначе каждый запуск казался бы «что-то изменилось» и страница перерисовывалась
const dataRaw = () => JSON.stringify([state.profiles.map(({ last_seen, ...p }) => p), state.media, state.quotes, state.mr, state.qr, state.comments,
  state.quotesReady, state.reactsReady, state.commentsReady, chat.ready, chat.list, chat.members, chat.last, chat.unread,
  state.clikes, state.admins, state.v132]);

// Хранится в базе браузера IndexedDB (п. 31): у localStorage предел около 5 МБ, и когда фото, реакций и комментариев
// станет много, мгновенный запуск молча пропал бы. Нет IndexedDB (старый браузер, приватный режим) — по-старому, в localStorage
const idb = (() => {
  let dbp = null;
  const open = () => dbp ||= new Promise((ok, no) => {
    const r = indexedDB.open("korefany", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
  });
  const tx = async (mode, fn) => { const db = await open(); return new Promise((ok, no) => { const t = db.transaction("kv", mode); const req = fn(t.objectStore("kv")); t.oncomplete = () => ok(req?.result); t.onerror = () => no(t.error); }); };
  return {
    get: k => tx("readonly", st => st.get(k)),
    set: (k, v) => tx("readwrite", st => st.put(v, k)),
    clear: () => tx("readwrite", st => st.clear())
  };
})();
function saveCache() {
  if (!me()) return null;
  const raw = dataRaw();
  const now = Date.now();
  const urls = Object.fromEntries(Object.entries(state.urls).filter(([, v]) => v.until > now + 5 * 60e3));
  const chatUrls = Object.fromEntries(Object.entries(chat.urls).filter(([, v]) => v.until > now + 5 * 60e3));
  const payload = JSON.stringify({ v: 1, raw, urls, chatUrls, reads: chat.reads, lastPoll: chat.lastPoll, muted: [...chat.muted] });
  const key = cacheKey();
  const toLocal = () => { try { localStorage.setItem(key, payload); } catch (e) { try { localStorage.removeItem(key); } catch (e2) {} } };
  if (window.indexedDB) idb.set(key, payload).then(() => { try { localStorage.removeItem(key); } catch (e) {} }, toLocal);
  else toLocal();
  return raw;
}

async function readCache() {
  try {
    let text = null;
    if (window.indexedDB) text = await idb.get(cacheKey()).catch(() => null);
    text ||= localStorage.getItem(cacheKey());   // сохранённое до v132 лежит в localStorage
    const c = JSON.parse(text || "null");
    if (!c || c.v !== 1) return null;
    const [profiles, media, quotes, mr, qr, comments, qReady, rReady, cReady, chReady, list, members, last, unread, clikes, admins, v132] = JSON.parse(c.raw);
    Object.assign(state, { profiles, media, quotes, mr, qr, comments, quotesReady: qReady, reactsReady: rReady, commentsReady: cReady,
      clikes: clikes || [], admins: admins || [], v132: !!v132 });
    Object.assign(state.urls, c.urls || {});
    Object.assign(chat, { ready: chReady, list, members, last, unread, reads: c.reads || {}, lastPoll: c.lastPoll, muted: new Set(c.muted || []) });
    Object.assign(chat.urls, c.chatUrls || {});
    Object.values(last || {}).forEach(m => chat.seen.add(m.id));
    return c.raw;
  } catch (e) { return null; }
}
// Выход из аккаунта: всё сохранённое на устройстве стираем
async function clearCache() {
  try { Object.keys(localStorage).filter(k => k.startsWith("korefany-data-")).forEach(k => localStorage.removeItem(k)); } catch (e) {}
  if (window.indexedDB) await idb.clear().catch(() => {});
}

// Свежие данные пришли в фоне: тихо подменяем. Страницу перерисовываем, только если человек ещё
// ничего не начал на ней делать — иначе новое увидит при следующем переходе
async function refreshInBackground(oldRaw) {
  try {
    // Данные с устройства уже на экране — с сервера забираем только изменения (п. 30): новые фото, профили,
    // новые комментарии и реакции, а что удалили и поменяли — по лёгкой сверке (id, подписи, отметки), без перекачки всего
    // Лайки комментариев и список админов — тоже: без них сайт не замечал, что база обновилась (v132), и прятал админку
    if (oldRaw) await Promise.all([reloadProfiles(), mergeNewMedia(), loadExtras(), loadChats().catch(() => { chat.ready = false; })]).then(() => poll(true, true));
    else await Promise.all([loadAll(), loadChats().catch(() => { chat.ready = false; })]);
  } catch (e) { return; }
  const raw = saveCache();
  paintChatBadge();
  refreshChatSide();
  if (raw === oldRaw) return;
  const h = location.hash.replace(/^#/, "") || "/";
  const calm = !document.getElementById("viewer") && !document.querySelector(".gs-wrap, .me-wrap") && scrollY < 40 && !document.activeElement?.matches?.("input, textarea") &&
    !/^\/(chat|upload|me)/.test(h);
  if (calm) route();
}
// Ушёл из приложения — запоминаем, что накопилось (новые комментарии, реакции)
document.addEventListener("visibilitychange", () => { if (document.hidden && state.session) saveCache(); });

// ---------- Файлы ----------
// Фото, видео и голосовые лежат в Yandex Object Storage. Ключ от него есть только у функции files в Supabase:
// она проверяет, кто спрашивает, и выдаёт временные ссылки — посмотреть, загрузить или удалить
async function filesApi(body) {
  const { data, error } = await sb.functions.invoke("files", { body });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch (e) {}
    throw new Error(msg);
  }
  return data;
}
// Ссылки на просмотр: { путь: ссылка }. Пустая ссылка — файла нет (например, среднего размера у старого фото)
async function signFiles(bucket, paths) {
  const { urls, ttl } = await filesApi({ op: "sign", bucket, paths });
  return { urls: urls || {}, until: Date.now() + Math.max(0, (ttl || 0) - 15 * 60e3) };
}
// Тип по расширению — если телефон его не сообщил (бывает с видео на Android)
const TYPE_BY_EXT = { jpg: "image/jpeg", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", m4v: "video/x-m4v", "3gp": "video/3gpp", m4a: "audio/mp4", ogg: "audio/ogg", aac: "audio/aac", mp3: "audio/mpeg" };
async function putFile(bucket, path, blob, type) {
  const ext = (path.split(".").pop() || "").toLowerCase();
  type = (type || "").split(";")[0] || TYPE_BY_EXT[ext] || "application/octet-stream";
  // Размер — часть подписи ссылки (функция files не примет файл больше разрешённого)
  const { url, headers } = await filesApi({ op: "put", bucket, path, type, size: blob.size });
  const r = await fetch(url, { method: "PUT", headers, body: blob });
  if (!r.ok) throw new Error("хранилище ответило " + r.status);
}
// Удаление не мешает остальному: если не вышло, файл просто останется лежать
const removeFiles = (bucket, paths) => paths.length ? filesApi({ op: "del", bucket, paths }).catch(() => {}) : Promise.resolve();

// Файлы закрытые, поэтому для показа берём временные ссылки (живут не меньше 6 часов)
async function signed(paths) {
  // Без связи новых ссылок не получить, а ждать ответа — значит держать страницу пустой. Берём сохранённые:
  // сами фото телефон отдаёт из своей памяти и по устаревшей ссылке (sw.js хранит их по пути файла)
  if (state.offline) return;
  const now = Date.now();
  const need = [...new Set(paths.filter(Boolean))].filter(p => !state.urls[p] || state.urls[p].until < now);
  // Порции по 100 уходят одновременно, а не по очереди
  await Promise.all(Array.from({ length: Math.ceil(need.length / 100) }, async (_, i) => {
    const part = need.slice(i * 100, i * 100 + 100);
    const r = await signFiles(BUCKET, part).catch(() => null);
    // Пустую ссылку тоже запоминаем, чтобы не спрашивать снова
    if (r) part.forEach(p => { if (p in r.urls) state.urls[p] = { url: r.urls[p], until: r.until }; });
  }));
}
const url = p => state.urls[p]?.url || "";

// ---------- Реакции ----------

const reactsOf = (type, id) => type === "m" ? state.mr.filter(r => r.media_id === id) : state.qr.filter(r => r.quote_id === id);

function reactButtons(type, id) {
  if (!state.reactsReady) return "";
  const rs = reactsOf(type, id);
  return `<div class="reacts">${Object.entries(EMOJI).map(([key, e]) => {
    const n = rs.filter(r => r.emoji === key).length;
    const mine = rs.some(r => r.emoji === key && r.user_id === me());
    return `<button type="button" class="react" data-react="${type}" data-id="${id}" data-emoji="${key}" aria-pressed="${mine}">${e}<span>${n || ""}</span></button>`;
  }).join("")}</div>`;
}

// Нажал на реакцию: ставим или убираем, и сразу обновляем кнопку без перезагрузки
async function toggleReact(btn) {
  const { react: type, id, emoji } = btn.dataset;
  const table = type === "m" ? "media_reactions" : "quote_reactions";
  const col = type === "m" ? "media_id" : "quote_id";
  const list = type === "m" ? state.mr : state.qr;
  const mine = list.find(r => r[col] === id && r.user_id === me() && r.emoji === emoji);
  btn.disabled = true;
  const { error } = mine
    ? await sb.from(table).delete().eq(col, id).eq("user_id", me()).eq("emoji", emoji)
    : await sb.from(table).insert({ [col]: id, emoji });
  btn.disabled = false;
  if (error) return toast("Реакция не сохранилась — проверь связь и нажми ещё раз");
  if (!mine) burst(btn, EMOJI[emoji]);
  // Живое обновление могло уже успеть добавить или убрать эту реакцию, поэтому проверяем
  const i = list.findIndex(r => r[col] === id && r.user_id === me() && r.emoji === emoji);
  if (mine && i >= 0) list.splice(i, 1);
  if (!mine && i < 0) list.push({ [col]: id, user_id: me(), emoji, created_at: new Date().toISOString() });
  paintReact(type, id, emoji);
}

// Перерисовать кнопку реакции: число и «нажата ли мной». Подпрыгивает при изменении
function paintReact(type, id, emoji) {
  const rs = reactsOf(type, id).filter(r => r.emoji === emoji);
  const mine = rs.some(r => r.user_id === me());
  document.querySelectorAll(`[data-react="${type}"][data-id="${id}"][data-emoji="${emoji}"]`).forEach(b => {
    b.setAttribute("aria-pressed", mine);
    b.querySelector("span").textContent = rs.length || "";
    b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop");
  });
}

// ---------- Отрисовка ----------

// Иконки для нижнего меню на телефоне
const ICONS = {
  feed: `<svg viewBox="0 0 24 24"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>`,
  people: `<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.8"/><path d="M16.5 14.6c2.6.2 4.4 2 5 5.4"/></svg>`,
  gallery: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/></svg>`,
  plus: `<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>`,
  quotes: `<svg viewBox="0 0 24 24"><path d="M7 7h4v4c0 2.5-1.5 4-4 4.5M14 7h4v4c0 2.5-1.5 4-4 4.5"/></svg>`,
  chats: `<svg viewBox="0 0 24 24"><path d="M4 6h16v10H9l-5 4z"/><path d="M8 10h8M8 13h5"/></svg>`,
  top: `<svg viewBox="0 0 24 24"><path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M9.5 17h5v4h-5z"/></svg>`,
  money: `<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18"/><circle cx="16.5" cy="14.5" r="1.4"/><path d="M7 6l8-3 1.5 3"/></svg>`,
  search: `<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg>`,
  bell: `<svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>`
};

// Положение розовой подсветки активного пункта: запоминаем, чтобы на новой странице она переехала, а не появилась
let navIndicator = null;

function shell(active, inner) {
  // Пока страница грузилась, человек ушёл на другую — эту уже не рисуем
  if (!pageMatches(active)) throw new Error("stale");
  const blink = (href, text, key, icon = key) => `<a href="${href}" class="${active === key ? "on" : ""}">${ICONS[icon]}${text}</a>`;
  // Верхнее меню — парящая неоновая капсула: логотип, разделы с иконками, «Загрузить» и аватарка
  $app.innerHTML = `
    <header class="top"><div class="wrap"><div class="capsule">
      <a class="logo" href="#/">КОРЕФАНЫ<span>.</span></a>
      <nav class="nav" id="topnav">
        <span class="nav-ind" aria-hidden="true"></span>
        ${blink("#/", "Лента", "feed")}
        ${blink("#/people", "Галерея", "people", "gallery")}
        <a href="#/chats" class="${active === "chats" ? "on" : ""}">${ICONS.chats}Чаты<i class="nav-badge" data-chat-badge hidden></i></a>
        ${blink("#/quotes", "Цитаты", "quotes")}
        ${blink("#/top", "Топ", "top")}
        ${blink("#/money", "Счёт", "money")}
      </nav>
      <a href="#/search" class="search-l${active === "search" ? " on" : ""}" title="Поиск" aria-label="Поиск">${ICONS.search}</a>
      ${state.v132 ? `<a href="#/notifications" class="search-l bell${active === "notifications" ? " on" : ""}" title="Уведомления" aria-label="Уведомления">${ICONS.bell}<i class="nav-badge" data-bell-badge hidden></i></a>` : ""}
      <a href="#/upload" class="cta-up" title="Загрузить">${ICONS.plus}<span>Загрузить</span></a>
      <a href="#/money" class="me-m top-m${active === "money" ? " on" : ""}" title="Счёт">${ICONS.money}</a>
      <a href="#/top" class="me-m top-m${active === "top" ? " on" : ""}" title="Топ месяца">${ICONS.top}</a>
      <a href="#/me" class="me-link" title="Мой профиль">${avatar(me())}</a>
    </div></div></header>
    <main class="wrap">${inner}</main>
    <nav class="bnav">
      ${blink("#/", "Лента", "feed")}
      ${blink("#/people", "Галерея", "people", "gallery")}
      <a href="#/upload" class="plus" aria-label="Загрузить"><span>${ICONS.plus}</span></a>
      <a href="#/chats" class="${active === "chats" ? "on" : ""}"><span class="bn-ico">${ICONS.chats}<i class="nav-badge" data-chat-badge hidden></i></span>Чаты</a>
      ${blink("#/quotes", "Цитаты", "quotes")}
    </nav>`;
  if (typeof paintChatBadge === "function") paintChatBadge();
  paintBell();
  moveNavIndicator();
  countUp($app);
}

// Подсветка стартует с места, где была на прошлой странице, и плавно едет к новому пункту
function moveNavIndicator() {
  const nav = document.getElementById("topnav"); if (!nav) return;
  const ind = nav.querySelector(".nav-ind"), on = nav.querySelector("a.on");
  if (!on || !nav.offsetWidth) { ind.style.opacity = 0; navIndicator = null; return; }
  const target = { left: on.offsetLeft, width: on.offsetWidth };
  const from = navIndicator || target;
  ind.style.transition = "none";
  ind.style.transform = `translateX(${from.left}px)`; ind.style.width = from.width + "px"; ind.style.opacity = navIndicator ? 1 : 0;
  void ind.offsetWidth;
  ind.style.transition = "";
  ind.style.transform = `translateX(${target.left}px)`; ind.style.width = target.width + "px"; ind.style.opacity = 1;
  navIndicator = target;
  // Пункт меняет ширину уже после отрисовки: пропал счётчик непрочитанных у «Чатов», догрузился шрифт.
  // Тогда подсветка подстраивается, а не остаётся старой ширины и не наезжает на соседний пункт
  navResize?.disconnect();
  if (window.ResizeObserver) {
    navResize = new ResizeObserver(() => {
      if (!document.body.contains(on)) return navResize.disconnect();
      if (on.offsetLeft !== navIndicator?.left || on.offsetWidth !== navIndicator?.width) moveNavIndicator();
    });
    navResize.observe(on);
    navResize.observe(nav);   // соседний пункт стал шире — активный сдвинулся, хоть сам и не изменился
  }
}
let navResize = null;
window.addEventListener("resize", () => { navIndicator = null; moveNavIndicator(); });
document.fonts?.ready.then(() => moveNavIndicator());
// Когда прокрутили страницу, капсула светится сильнее
window.addEventListener("scroll", () => document.body.classList.toggle("scrolled", scrollY > 8), { passive: true });

// Сколько записей приходится на каждое значение поля: countBy(state.mr, "media_id") → Map(id фото → число реакций)
function countBy(list, key) {
  const map = new Map();
  for (const x of list) map.set(x[key], (map.get(x[key]) || 0) + 1);
  return map;
}

// square: ровная сетка из квадратов (галерея). Без него — плитки в своих пропорциях.
// months: перед первым фото каждого месяца — подпись месяца (видна только в мелкой сетке галереи на телефоне).
// who: у плитки автор (виден только в крупной сетке по 2)
async function grid(list, emptyHtml, square = false, { months = false, who = false } = {}) {
  if (!list.length) return `<div class="empty">${emptyHtml}</div>`;
  await signed(list.map(m => thumbPath(m)));
  // Считаем реакции и комментарии один раз на всю сетку, а не перебираем все реакции для каждой плитки
  const rcOf = countBy(state.mr, "media_id"), ccOf = countBy(state.comments, "media_id");
  let lastMonth = null;
  return `<div class="grid${square ? " sq" : ""}">${list.map((m, i) => {
    const t = url(thumbPath(m));
    const rc = rcOf.get(m.id) || 0;
    const cc = ccOf.get(m.id) || 0;
    let head = "";
    if (months) {
      const d = toDate(m.taken_at || m.created_at), k = d.getFullYear() * 12 + d.getMonth();
      if (k !== lastMonth) { lastMonth = k; head = `<h3 class="g-month">${MONTHS[d.getMonth()]} ${d.getFullYear()}</h3>`; }
    }
    return `${head}<button type="button" class="tile${isNew(m) ? " is-new" : ""}" style="--i:${Math.min(i, 20)}" data-open="${m.id}" aria-label="${esc(m.caption || "Открыть")}">
      ${m.kind === "video"
        // Превью видео проверяет fixVideoThumbs: нет или чёрное — сделает новое и подставит
        ? `<img class="${t ? "fade " : ""}vthumb" ${t ? `src="${t}"` : ""} data-vthumb="${m.id}" alt="" loading="lazy" decoding="async">`
        : t ? `<img class="fade" src="${t}" alt="" loading="lazy" decoding="async">` : `<span class="noimg">🖼</span>`}
      ${m.kind === "video" ? `<span class="play">▶ видео</span>` : ""}
      ${rc || cc ? `<span class="rc">${rc ? `🔥 ${rc}` : ""}${rc && cc ? " · " : ""}${cc ? `💬 ${cc}` : ""}</span>` : ""}
      ${who ? `<span class="t-who" style="${ucStyle(m.owner)}">${avatar(m.owner)}<b>${esc(nameOf(m.owner))}</b></span>` : ""}
    </button>`;
  }).join("")}</div>`;
}
