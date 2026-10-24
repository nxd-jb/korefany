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
  urls: {}          // временные ссылки на файлы: path -> { url, until }
};

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
    if (error) return { data: all.length ? all : null, error: all.length ? null : error };
    all = all.concat(data || []);
    if (!data || data.length < 1000) return { data: all, error: null };
  }
}

async function loadAll() {
  const [p, m, q, mr, qr, c] = await Promise.all([
    sb.from("profiles").select("*").order("name"),
    fetchAll(() => sb.from("media").select("*, media_people(person_id)").order("created_at", { ascending: false })),
    fetchAll(() => sb.from("quotes").select("*").order("created_at", { ascending: false })),
    fetchAll(() => sb.from("media_reactions").select("*").order("created_at")),
    fetchAll(() => sb.from("quote_reactions").select("*").order("created_at")),
    fetchAll(() => sb.from("comments").select("*").order("created_at"))
  ]);
  state.commentsReady = !c.error;
  state.comments = c.data || [];
  state.reactsReady = !mr.error && !qr.error;
  state.mr = mr.data || [];
  state.qr = qr.data || [];
  if (p.error || m.error) throw p.error || m.error;
  state.profiles = p.data;
  await signed(state.profiles.flatMap(x => [x.avatar_path, x.cover_path]).filter(Boolean));
  state.media = m.data.map(x => ({ ...x, people: x.media_people.map(r => r.person_id) }));
  // Если таблицу цитат ещё не создали, остальной сайт всё равно работает
  state.quotesReady = !q.error;
  state.quotes = q.data || [];
}

// ---------- Сохранённые данные: сайт открывается сразу, а свежие данные догружаются следом ----------
// Всё, что видно на сайте, после загрузки складываем в память браузера (localStorage) — своё у каждого человека.
// При следующем открытии сразу рисуем из неё, а Supabase спрашиваем уже в фоне

const cacheKey = () => "korefany-data-" + me();
// Только данные (без ссылок на файлы и времени) — по этой строке понимаем, изменилось ли что-то
// last_seen меняется каждую минуту — его не считаем, иначе каждый запуск казался бы «что-то изменилось» и страница перерисовывалась
const dataRaw = () => JSON.stringify([state.profiles.map(({ last_seen, ...p }) => p), state.media, state.quotes, state.mr, state.qr, state.comments,
  state.quotesReady, state.reactsReady, state.commentsReady, chat.ready, chat.list, chat.members, chat.last, chat.unread]);

function saveCache() {
  if (!me()) return null;
  const raw = dataRaw();
  const now = Date.now();
  const urls = Object.fromEntries(Object.entries(state.urls).filter(([, v]) => v.until > now + 5 * 60e3));
  const chatUrls = Object.fromEntries(Object.entries(chat.urls).filter(([, v]) => v.until > now + 5 * 60e3));
  try {
    localStorage.setItem(cacheKey(), JSON.stringify({ v: 1, raw, urls, chatUrls, reads: chat.reads, lastPoll: chat.lastPoll, muted: [...chat.muted] }));
  } catch (e) {
    try { localStorage.removeItem(cacheKey()); } catch (e2) {}   // не влезло в память — просто не храним
  }
  return raw;
}

function readCache() {
  try {
    const c = JSON.parse(localStorage.getItem(cacheKey()) || "null");
    if (!c || c.v !== 1) return null;
    const [profiles, media, quotes, mr, qr, comments, qReady, rReady, cReady, chReady, list, members, last, unread] = JSON.parse(c.raw);
    Object.assign(state, { profiles, media, quotes, mr, qr, comments, quotesReady: qReady, reactsReady: rReady, commentsReady: cReady });
    Object.assign(state.urls, c.urls || {});
    Object.assign(chat, { ready: chReady, list, members, last, unread, reads: c.reads || {}, lastPoll: c.lastPoll, muted: new Set(c.muted || []) });
    Object.assign(chat.urls, c.chatUrls || {});
    Object.values(last || {}).forEach(m => chat.seen.add(m.id));
    return c.raw;
  } catch (e) { return null; }
}

// Свежие данные пришли в фоне: тихо подменяем. Страницу перерисовываем, только если человек ещё
// ничего не начал на ней делать — иначе новое увидит при следующем переходе
async function refreshInBackground(oldRaw) {
  try {
    await Promise.all([loadAll(), loadChats().catch(() => { chat.ready = false; })]);
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
async function putFile(bucket, path, blob, type) {
  const { url, headers } = await filesApi({ op: "put", bucket, path, type: type || "application/octet-stream" });
  const r = await fetch(url, { method: "PUT", headers, body: blob });
  if (!r.ok) throw new Error("хранилище ответило " + r.status);
}
// Удаление не мешает остальному: если не вышло, файл просто останется лежать
const removeFiles = (bucket, paths) => paths.length ? filesApi({ op: "del", bucket, paths }).catch(() => {}) : Promise.resolve();

// Файлы закрытые, поэтому для показа берём временные ссылки (живут не меньше 6 часов)
async function signed(paths) {
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
  if (error) return;
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
  money: `<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18"/><circle cx="16.5" cy="14.5" r="1.4"/><path d="M7 6l8-3 1.5 3"/></svg>`
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

// square: ровная сетка из квадратов (галерея). Без него — плитки в своих пропорциях
async function grid(list, emptyHtml, square = false) {
  if (!list.length) return `<div class="empty">${emptyHtml}</div>`;
  await signed(list.map(m => thumbPath(m)));
  // Считаем реакции и комментарии один раз на всю сетку, а не перебираем все реакции для каждой плитки
  const rcOf = countBy(state.mr, "media_id"), ccOf = countBy(state.comments, "media_id");
  return `<div class="grid${square ? " sq" : ""}">${list.map((m, i) => {
    const t = url(thumbPath(m));
    const rc = rcOf.get(m.id) || 0;
    const cc = ccOf.get(m.id) || 0;
    return `<button type="button" class="tile" style="--i:${Math.min(i, 20)}" data-open="${m.id}" aria-label="${esc(m.caption || "Открыть")}">
      ${m.kind === "video"
        // Превью видео проверяет fixVideoThumbs: нет или чёрное — сделает новое и подставит
        ? `<img class="${t ? "fade " : ""}vthumb" ${t ? `src="${t}"` : ""} data-vthumb="${m.id}" alt="" loading="lazy" decoding="async">`
        : t ? `<img class="fade" src="${t}" alt="" loading="lazy" decoding="async">` : `<span class="noimg">🖼</span>`}
      ${m.kind === "video" ? `<span class="play">▶ видео</span>` : ""}
      ${rc || cc ? `<span class="rc">${rc ? `🔥 ${rc}` : ""}${rc && cc ? " · " : ""}${cc ? `💬 ${cc}` : ""}</span>` : ""}
    </button>`;
  }).join("")}</div>`;
}

// Лента «как это было»: посты как в Инстаграме, новые сверху, между месяцами — подпись месяца.
// Посты подгружаются порциями по мере прокрутки, чтобы не грузить сразу все фото
const FEED_STEP = 10;
let feedObserver = null;

async function viewFeed() {
  const list = [...state.media].sort((a, b) => (b.taken_at || b.created_at).localeCompare(a.taken_at || a.created_at));
  state.feed = { list, shown: 0, lastMonth: null };
  state.current = list;
  shell("feed", `
    ${bdayBanner()}
    ${await coverHtml()}
    ${list.length ? `<div class="feed" id="feed"></div><div class="feed-more" id="feedMore"></div>`
      : `<div class="empty">Пока ничего нет. <a href="#/upload">Загрузи первое фото</a>, и с него начнётся история.</div>`}`);
  startCover();
  wireParallax();
  if (!list.length) return;
  await appendPosts();
  // Когда долистали до низа — подгружаем следующие посты
  feedObserver?.disconnect();
  feedObserver = new IntersectionObserver(async es => {
    if (es[0].isIntersecting && state.feed.shown < state.feed.list.length) await appendPosts();
  }, { rootMargin: "1600px" });   // догружаем заранее, примерно за два экрана телефона до конца
  feedObserver.observe(document.getElementById("feedMore"));
}

// Плашка над лентой: у кого сегодня и завтра день рождения. В сам день — салют, раз в день на устройство
function bdayBanner() {
  const today = state.profiles.filter(bdayToday), tomorrow = state.profiles.filter(bdayTomorrow);
  if (!today.length && !tomorrow.length) return "";
  if (today.length) {
    const key = "korefany-bday-" + new Date().toDateString();
    try { if (!localStorage.getItem(key)) { localStorage.setItem(key, "1"); setTimeout(confetti, 400); } } catch (e) {}
  }
  const names = list => list.map(p => `<a href="#/p/${p.id}">${esc(p.name)}</a>`).join(", ");
  return `<div class="bday-banner">
    ${today.length ? `<p>🎉 Сегодня день рождения: ${names(today)}! <a href="#/chats" class="bday-cta">Поздравить в чате →</a></p>` : ""}
    ${tomorrow.length ? `<p class="bday-soon">🎂 Завтра день рождения: ${names(tomorrow)}</p>` : ""}
  </div>`;
}

const monthOf = m => { const d = toDate(m.taken_at || m.created_at); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };

async function appendPosts() {
  const f = state.feed, feed = document.getElementById("feed"); if (!feed || f.loading) return;
  // Пока догружается порция, вторую не начинаем — иначе посты могли встать не по порядку
  f.loading = true;
  const part = f.list.slice(f.shown, f.shown + FEED_STEP);
  f.shown += part.length;
  try { await signed(part.flatMap(m => [m.path, thumbPath(m), midPath(m)])); } finally { f.loading = false; }
  if (!document.body.contains(feed)) return;
  let html = "";
  part.forEach((m, i) => {
    const month = monthOf(m);
    if (month !== f.lastMonth) { html += `<div class="feed-month"><span>${month}</span></div>`; f.lastMonth = month; }
    html += postHtml(m, i);
  });
  // Выплывают только первые посты. Догруженные при прокрутке встают сразу, иначе при быстрой прокрутке
  // их ловишь полупрозрачными и с задержкой
  if (f.shown > part.length) html = html.replaceAll(`<article class="post"`, `<article class="post quiet"`);
  feed.insertAdjacentHTML("beforeend", html);
  keepNear(feed);
  const more = document.getElementById("feedMore");
  if (more) more.textContent = f.shown < f.list.length ? "Загружаю ещё..." : "Это всё. Дальше история только начинается 🔥";
  // Низ ленты всё ещё на экране (короткие посты или быстрая прокрутка) — догружаем следующую порцию сами
  if (more && f.shown < f.list.length && more.getBoundingClientRect().top < innerHeight + 1600) setTimeout(appendPosts, 50);
}

function postHtml(m, i = 0) {
  const cc = state.comments.filter(c => c.media_id === m.id).length;
  return `<article class="post" data-post="${m.id}" style="--i:${i}">
    <header class="post-head">
      <a href="#/p/${m.owner}" class="post-who" style="${ucStyle(m.owner)}">${avatar(m.owner)}<div><b>${esc(nameOf(m.owner))}</b><span>${dayText(m.taken_at || m.created_at)}</span></div></a>
      <button type="button" class="post-edit" data-edit-media="${m.id}" aria-label="${m.owner === me() ? "Изменить: кто на фото, подпись, дата" : "Отметить, кто на фото"}" title="${m.owner === me() ? "Изменить" : "Отметить, кто на фото"}">${m.owner === me() ? "✎" : "👥"}</button>
    </header>
    <div class="post-media" data-post-media="${m.id}">${m.kind === "video"
      ? videoTag(m, `controls playsinline style="aspect-ratio:${mediaSize(m.id)?.join(" / ") || "4 / 5"}"`)
      : postPicture(m)}</div>
    <div class="post-body">
      <div class="post-actions">
        ${reactButtons("m", m.id)}
        ${state.commentsReady ? `<button type="button" class="react post-cbtn" data-post-comment="${m.id}" aria-label="Комментарии">💬<span data-ccount="${m.id}">${cc || ""}</span></button>` : ""}
      </div>
      ${m.caption ? `<p class="post-cap"><b>${esc(nameOf(m.owner))}</b> ${esc(m.caption)}</p>` : ""}
      ${m.people.length ? `<p class="post-people">На фото: ${m.people.map(p => `<a href="#/p/${p}">${esc(nameOf(p))}</a>`).join(", ")}</p>` : ""}
      <div class="post-comments" data-cprev="${m.id}">${commentsPreview(m)}</div>
    </div>
  </article>`;
}

// Видео с превью-картинкой. Нет превью или оно чёрное — fixVideoThumbs сделает новое и поставит в poster
function videoTag(m, attrs) {
  const poster = url(thumbPath(m));
  return `<video src="${url(m.path)}" ${poster ? `poster="${poster}"` : ""} data-vthumb="${m.id}" ${attrs} preload="none"></video>`;
}

// Фото в посте проявляется: сначала видно размытое маленькое превью (оно лёгкое и грузится мгновенно),
// поверх него плавно проступает чёткое фото, когда загрузится
// Превью грузится сразу (оно маленькое), чтобы пост получил свою высоту до того, как до него долистали:
// иначе пост сначала пустой, а потом резко вырастает, и лента дёргается
function postPicture(m) {
  const t = url(thumbPath(m)), src = url(midPath(m)) || url(m.path), alt = esc(m.caption || "");
  const wh = mediaSize(m.id), size = wh ? ` width="${wh[0]}" height="${wh[1]}"` : "";
  if (!t) return `<img class="full" src="${src}" alt="${alt}"${size} loading="lazy" decoding="async">`;
  return `<img class="ph" src="${t}" alt="" aria-hidden="true"${size} decoding="async">` +
    `<img class="full fade" src="${src}" alt="${alt}" loading="lazy" decoding="async">`;
}

// Размеры фото и видео запоминаются на устройстве (korefany-ar: id → [ширина, высота] превью).
// В следующий раз место под фото в ленте занято заранее, и при прокрутке ничего не прыгает
const SIZES_KEY = "korefany-ar";
let sizes = null, sizesTimer = null;
function mediaSize(id) {
  if (!sizes) { try { sizes = JSON.parse(localStorage.getItem(SIZES_KEY)) || {}; } catch { sizes = {}; } }
  return sizes[id];
}
function rememberSize(id, w, h) {
  if (!id || !w || !h || mediaSize(id)) return;
  // Хватит точности до сотых: превью маленькое, а сохранённые числа не раздувают память
  const k = 100 / Math.max(w, h);
  sizes[id] = [Math.round(w * k), Math.round(h * k)];
  clearTimeout(sizesTimer);
  sizesTimer = setTimeout(() => { try { localStorage.setItem(SIZES_KEY, JSON.stringify(sizes)); } catch {} }, 1500);
}

// Картинка с классом fade загрузилась — показываем её (одно правило на весь сайт).
// Заодно запоминаем пропорции фото из поста
document.addEventListener("load", e => {
  const el = e.target;
  if (el.dataset?.sleep) return;   // это заглушка уснувшего поста, а не фото
  if (el.classList?.contains("fade")) el.classList.add("loaded");
  if (el.tagName === "IMG" && !el.classList.contains("fade")) {
    const id = el.closest("[data-post-media]")?.dataset.postMedia;
    if (id) rememberSize(id, el.naturalWidth, el.naturalHeight);
  }
}, true);
document.addEventListener("loadedmetadata", e => {
  const id = e.target.closest?.("[data-post-media]")?.dataset.postMedia;
  if (id && e.target.videoWidth) { rememberSize(id, e.target.videoWidth, e.target.videoHeight); e.target.style.aspectRatio = `${e.target.videoWidth} / ${e.target.videoHeight}`; }
}, true);

// Посты далеко от экрана «засыпают»: фото и видео выгружаются, место под ними остаётся той же высоты.
// Иначе на iPhone каждое долистанное фото копится в памяти, и после пары десятков постов
// Safari убивает вкладку — выглядит так, будто сайт сам перезагрузился
const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
let feedKeeper = null;
function keepNear(root) {
  feedKeeper ??= new IntersectionObserver(es => es.forEach(e => e.isIntersecting ? wakeMedia(e.target) : sleepMedia(e.target)),
    { rootMargin: "2000px 0px" });   // примерно три экрана телефона вверх и вниз остаются живыми
  root.querySelectorAll("[data-post-media]:not([data-kept])").forEach(el => { el.dataset.kept = "1"; feedKeeper.observe(el); });
}
function sleepMedia(box) {
  if (box.dataset.asleep) return;
  const h = box.offsetHeight; if (!h) return;
  box.dataset.asleep = "1";
  box.style.height = h + "px";
  box.querySelectorAll("img").forEach(img => {
    img.dataset.src = img.getAttribute("src") || "";
    img.dataset.sleep = "1";
    img.src = BLANK;
  });
  box.querySelectorAll("video").forEach(v => {
    v.pause();
    v.dataset.src = v.getAttribute("src") || ""; v.dataset.poster = v.getAttribute("poster") || "";
    v.removeAttribute("src"); v.removeAttribute("poster"); v.load();
  });
}
function wakeMedia(box) {
  if (!box.dataset.asleep) return;
  delete box.dataset.asleep;
  box.querySelectorAll("img[data-sleep]").forEach(img => { delete img.dataset.sleep; img.src = img.dataset.src; });
  box.querySelectorAll("video").forEach(v => {
    // Пока пост спал, fixVideoThumbs мог поставить новое превью — его не затираем
    if (v.dataset.poster && !v.getAttribute("poster")) v.setAttribute("poster", v.dataset.poster);
    if (v.dataset.src) v.setAttribute("src", v.dataset.src);
  });
  // Фото уже в кэше и встаёт почти сразу; высоту отпускаем, когда оно загрузится
  const full = box.querySelector("img.full") || box.querySelector("img");
  const free = () => { box.style.height = ""; };
  if (!full || full.complete) free(); else { full.addEventListener("load", free, { once: true }); full.addEventListener("error", free, { once: true }); }
}

// Под постом — два последних комментария и ссылка на остальные
function commentsPreview(m) {
  if (!state.commentsReady) return "";
  const list = state.comments.filter(c => c.media_id === m.id);
  const last = list.slice(-2);
  return `${list.length > 2 ? `<button type="button" class="link-btn post-all" data-post-comment="${m.id}">Все комментарии (${list.length})</button>` : ""}
    ${last.map(c => `<p class="post-c"><b>${esc(nameOf(c.author))}</b> ${esc(c.text)}</p>`).join("")}
    <button type="button" class="post-write" data-post-comment="${m.id}">Написать комментарий...</button>`;
}

// Обновить счётчик и превью комментариев у поста (после отправки, удаления или живого обновления)
function refreshPost(mediaId) {
  const m = state.media.find(x => x.id === mediaId); if (!m) return;
  const prev = document.querySelector(`[data-cprev="${mediaId}"]`);
  if (prev) prev.innerHTML = commentsPreview(m);
  const cnt = document.querySelector(`[data-ccount="${mediaId}"]`);
  if (cnt) cnt.textContent = state.comments.filter(c => c.media_id === mediaId).length || "";
}

// Нажатие на фото в посте: одно — открыть на весь экран, два быстрых — ❤️
let postTap = { id: null, timer: null };
function postMediaClick(el, e) {
  if (e.target.tagName === "VIDEO") return;
  const id = el.dataset.postMedia;
  if (postTap.id === id && postTap.timer) {
    clearTimeout(postTap.timer); postTap = { id: null, timer: null };
    const heart = document.createElement("span");
    heart.className = "big-heart"; heart.textContent = "❤️";
    el.appendChild(heart); setTimeout(() => heart.remove(), 1000);
    const btn = document.querySelector(`[data-post="${id}"] [data-react="m"][data-emoji="heart"]`);
    if (btn && btn.getAttribute("aria-pressed") !== "true") toggleReact(btn);
    return;
  }
  clearTimeout(postTap.timer);
  postTap = { id, timer: setTimeout(() => { postTap = { id: null, timer: null }; openViewer(id, 0, el.querySelector("img.full.loaded, img.full:not(.fade)") || el.querySelector("img.ph")); }, 260) };
}

// Обложка ленты: случайные фото сменяют друг друга, плюс счётчики.
// Каждое фото видно целиком, а по бокам — его же размытая копия, чтобы ничего не обрезалось
const COVER_COUNT = 12, COVER_EVERY = 5000;
let coverTimer = null;

async function coverHtml() {
  const photos = state.media.filter(m => m.kind === "photo");
  // Перемешиваем и берём до 12 штук — при каждом открытии ленты набор новый
  for (let i = photos.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [photos[i], photos[j]] = [photos[j], photos[i]]; }
  const slides = photos.slice(0, COVER_COUNT);
  await signed(slides.flatMap(m => [m.path, thumbPath(m), midPath(m)]));
  const dates = state.media.map(m => new Date(m.taken_at || m.created_at).getTime());
  const first = dates.length ? Math.min(...dates) : Date.now();
  const days = Math.max(1, Math.floor((Date.now() - first) / 864e5));
  const stat = (n, forms) => `<div><b data-count="${n}">${n}</b><span>${plural(n, forms)}</span></div>`;
  return `<section class="cover" id="cover">
    ${slides.map((m, i) => `<div class="cover-slide${i === 0 ? " on" : ""}" data-cover-open="${m.id}">
      <img class="cs-bg" src="${url(thumbPath(m)) || url(m.path)}" alt="">
      <img class="cs-fg fade" ${i < 2 ? "src" : "data-src"}="${url(midPath(m)) || url(m.path)}" alt="" decoding="async">
    </div>`).join("")}
    ${slides.length > 1 ? `<div class="cover-dots">${slides.map((_, i) => `<i class="${i === 0 ? "on" : ""}"></i>`).join("")}</div>` : ""}
    <div class="cover-in">
      <p class="cover-kicker">${dates.length ? "История с " + dayText(first) : "История начинается"}</p>
      <h1 class="cover-title">Как это было</h1>
      <div class="stats">
        ${stat(state.media.length, ["фото и видео", "фото и видео", "фото и видео"])}
        ${stat(state.quotes.length, ["цитата", "цитаты", "цитат"])}
        ${stat(state.profiles.length, ["корефан", "корефана", "корефанов"])}
        ${stat(days, ["день истории", "дня истории", "дней истории"])}
      </div>
    </div>
  </section>`;
}

// Запуск смены фото на обложке: само каждые 5 секунд, пальцем — свайпом, нажатие открывает фото
function startCover() {
  clearInterval(coverTimer);
  const cover = document.getElementById("cover"); if (!cover) return;
  const slides = [...cover.querySelectorAll(".cover-slide")];
  const dots = [...cover.querySelectorAll(".cover-dots i")];
  if (slides.length < 2) return;
  let cur = 0;
  // Большие фото обложки грузятся по очереди: текущее и следующее, а не все 12 сразу при открытии ленты
  const load = i => { const img = slides[(i + slides.length) % slides.length].querySelector("img[data-src]"); if (img) { img.src = img.dataset.src; img.removeAttribute("data-src"); } };
  const go = (n, dir) => {
    n = (n + slides.length) % slides.length;
    if (n === cur) return;
    load(n); load(n + 1); load(n - 1);
    const out = slides[cur], inn = slides[n];
    // Новое фото ставим сбоку без анимации, потом плавно заезжает, а старое уезжает в другую сторону
    inn.style.transition = "none"; inn.style.transform = `translateX(${dir * 100}%)`;
    void inn.offsetWidth;
    inn.style.transition = ""; inn.style.transform = "";
    inn.classList.add("on");
    out.classList.remove("on"); out.style.transform = `translateX(${-dir * 100}%)`;
    dots[cur]?.classList.remove("on"); dots[n]?.classList.add("on");
    cur = n;
  };
  const restart = () => {
    clearInterval(coverTimer);
    coverTimer = setInterval(() => { if (!document.hidden && document.body.contains(cover)) go(cur + 1, 1); else if (!document.body.contains(cover)) clearInterval(coverTimer); }, COVER_EVERY);
  };
  let sx = 0, sy = 0;
  cover.addEventListener("touchstart", e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  cover.addEventListener("touchend", e => {
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { go(cur + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1); restart(); }
  });
  cover.addEventListener("click", e => {
    if (Math.abs(e.clientX - sx) > 10 && sx) return;   // это был свайп, а не нажатие
    const id = slides[cur].dataset.coverOpen;
    if (id) openViewer(id, 0, slides[cur].querySelector(".cs-fg"));
  });
  restart();
}

// Галерея: сверху корефаны-постеры работают как фильтр, снизу все фото и видео ровной сеткой.
// Нажал на корефана — остались только фото с ним, нажал ещё раз — снова все
const tagged = id => state.media.filter(m => m.people.includes(id));

async function viewPeople() {
  const rcOf = countBy(state.mr, "media_id"), months = allMonthStats();
  // Каждому своё фото: первыми выбирают те, у кого фото меньше всего; занятые фото пропускаются,
  // а из свободных берётся то, где меньше людей (человек виднее), потом — где больше реакций.
  // Повтор только если у человека все фото уже заняты
  const pick = new Map(), used = new Set();
  [...state.profiles].sort((a, b) => tagged(a.id).length - tagged(b.id).length).forEach(p => {
    // Видео — только если фото нет: у старых видео превью бывает чёрным или его нет совсем
    const list = tagged(p.id).sort((a, b) =>
      used.has(a.id) - used.has(b.id) || (a.kind === "video") - (b.kind === "video") || a.people.length - b.people.length || (rcOf.get(b.id) || 0) - (rcOf.get(a.id) || 0));
    if (list[0]) { pick.set(p.id, list[0]); used.add(list[0].id); }
  });
  const bestOf = id => pick.get(id);
  const covers = [...pick.values()];
  await signed(covers.map(thumbPath));
  if (state.galleryFilter && !profile(state.galleryFilter)) state.galleryFilter = null;
  shell("people", `
    <div><h1>Галерея</h1><p class="sub">Все наши фото и видео в одном месте</p></div>
    <section>
      <h2>Кто на фото</h2>
      <div class="posters" id="posters">${state.profiles.map((p, i) => {
        const best = bestOf(p.id);
        const bg = best ? url(thumbPath(best)) : "";
        const icons = [...new Set(personBadges(p.id, months).map(b => b.icon))].join(" ");
        return `<div class="poster" role="button" tabindex="0" data-gfilter="${p.id}" aria-pressed="false" style="--i:${Math.min(i, 20)};${ucStyle(p.id)}">
          ${bg ? `<img src="${bg}" alt="" loading="lazy">` : ""}
          <a class="poster-link" href="#/p/${p.id}" title="Открыть профиль">Профиль →</a>
          <div class="poster-in">
            ${avatar(p.id)}
            <b>${esc(p.name)}</b>
            ${p.status ? `<em class="poster-status">${esc(p.status)}</em>` : ""}
            <span>${tagged(p.id).length} фото${icons ? ` · ${icons}` : ""}</span>
          </div>
        </div>`;
      }).join("")}</div>
    </section>
    <section id="galleryGrid"></section>`);
  await renderGallery();
}

// Что показывать в галерее (все, фото, видео) и в каком порядке. Выбор запоминается на устройстве
const G_KINDS = [
  ["all", "Все", `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>`],
  ["photo", "Фото", `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4 4 3 3-2 4 3"/></svg>`],
  ["video", "Видео", `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.2v5.6l4.8-2.8z"/></svg>`]
];
const G_SORTS = [["new", "Сначала новые"], ["old", "Сначала старые"], ["top", "Больше реакций"], ["talk", "Больше комментариев"], ["rnd", "Вперемешку"]];
function galleryView() {
  if (!state.gview) {
    let v = {};
    try { v = JSON.parse(localStorage.getItem("korefany-gallery") || "{}"); } catch {}
    state.gview = {
      kind: G_KINDS.some(k => k[0] === v.kind) ? v.kind : "all",
      sort: G_SORTS.some(s => s[0] === v.sort) ? v.sort : "new"
    };
  }
  return state.gview;
}
function setGalleryView(patch) {
  Object.assign(galleryView(), patch);
  if (patch.sort === "rnd") state.gshuffle = null;   // нажал «Вперемешку» ещё раз — перемешать заново
  try { localStorage.setItem("korefany-gallery", JSON.stringify(state.gview)); } catch {}
}
const ofKind = (list, kind) => kind === "all" ? list : list.filter(m => m.kind === kind);
function sortMedia(list, sort) {
  const when = m => m.taken_at || m.created_at;
  const newer = (a, b) => when(b).localeCompare(when(a));
  if (sort === "old") return list.sort((a, b) => -newer(a, b));
  if (sort === "top" || sort === "talk") {
    const n = countBy(sort === "top" ? state.mr : state.comments, "media_id");
    return list.sort((a, b) => (n.get(b.id) || 0) - (n.get(a.id) || 0) || newer(a, b));
  }
  if (sort === "rnd") {
    // Случайный порядок держится, пока не выберешь «Вперемешку» снова, чтобы сетка не прыгала
    const r = state.gshuffle ||= new Map();
    for (const m of list) if (!r.has(m.id)) r.set(m.id, Math.random());
    return list.sort((a, b) => r.get(a.id) - r.get(b.id));
  }
  return list.sort(newer);
}

// Перерисовать только сетку и подсветку постеров, без перезагрузки всей страницы.
// gallerySeq: быстро переключили несколько раз — сетку рисует только последний вызов
let gallerySeq = 0;
async function renderGallery() {
  const seq = ++gallerySeq;
  const f = state.galleryFilter, { kind, sort } = galleryView();
  document.querySelectorAll("[data-gfilter]").forEach(b => b.setAttribute("aria-pressed", b.dataset.gfilter === f));
  document.getElementById("posters")?.classList.toggle("filtered", !!f);
  const list = sortMedia([...ofKind(f ? tagged(f) : state.media, kind)], sort);
  state.current = list;
  paintGallerySheet();
  const box = document.getElementById("galleryGrid"); if (!box) return;
  const what = kind === "video" ? "Видео" : kind === "photo" ? "Фото" : "Фото и видео";
  const title = f ? `${what}, где есть ${esc(nameOf(f))}` : kind === "all" ? "Все фото и видео" : `Только ${what.toLowerCase()}`;
  const changed = kind !== "all" || sort !== "new";
  const gridHtml = await grid(list, f ? `${what}, где есть ${esc(nameOf(f))}, пока нет.${kind === "all" ? " Загрузи и отметь." : ""}`
    : kind === "video" ? "Видео пока нет." : `Пока пусто. <a href="#/upload">Загрузи первое фото</a>.`, true);
  if (seq !== gallerySeq || !box.isConnected) return;
  box.innerHTML = `
    <div class="gallery-head">
      <div class="g-title"><h2>${title} <span class="g-count">${list.length}</span></h2>
        <span class="g-sort">${G_SORTS.find(s => s[0] === sort)[1]}${f ? ` · <button type="button" class="link-btn g-reset" data-gfilter-reset>Показать всех</button>` : ""}</span></div>
      <button type="button" class="g-filter${changed ? " on" : ""}" data-gsheet aria-label="Фильтр и порядок" title="Фильтр и порядок">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>
      </button>
    </div>
    ${gridHtml}`;
}

// Шторка «Фильтр и порядок»: на телефоне снизу, на компьютере окном по центру.
// Выбор применяется сразу, сетка за шторкой перерисовывается
function openGallerySheet() {
  document.querySelector(".gs-wrap")?.remove();
  const w = document.createElement("div");
  w.className = "gs-wrap";
  w.innerHTML = `<div class="pv-dim" data-gs-close></div>
    <div class="gs-sheet" role="dialog" aria-label="Фильтр и порядок"><div class="pv-grab" data-gs-close></div><div id="gsBody"></div></div>`;
  document.body.appendChild(w);
  paintGallerySheet();
  void w.offsetWidth; w.classList.add("open");
  w.querySelector(".gs-kind[aria-pressed=true]")?.focus({ preventScroll: true });
}
function closeGallerySheet() {
  const w = document.querySelector(".gs-wrap"); if (!w) return;
  w.classList.remove("open"); setTimeout(() => w.remove(), 280);
}
function paintGallerySheet() {
  const body = document.getElementById("gsBody"); if (!body) return;
  const { kind, sort } = galleryView(), f = state.galleryFilter;
  const base = f ? tagged(f) : state.media;
  // Перерисовка не должна терять фокус с клавиатуры
  const was = document.activeElement?.closest?.("#gsBody button");
  const again = was && (was.dataset.gsKind ? `[data-gs-kind="${was.dataset.gsKind}"]` : was.dataset.gsSort ? `[data-gs-sort="${was.dataset.gsSort}"]` : null);
  body.innerHTML = `
    <div class="gs-h"><h3>Показать</h3>${kind !== "all" || sort !== "new" ? `<button type="button" class="link-btn" data-gs-reset>Сбросить</button>` : ""}</div>
    <div class="gs-kinds">${G_KINDS.map(([k, label, icon]) =>
      `<button type="button" class="gs-kind" data-gs-kind="${k}" aria-pressed="${kind === k}">${icon}<b>${label}</b><small>${ofKind(base, k).length}</small></button>`).join("")}</div>
    <div class="gs-h"><h3>Порядок</h3></div>
    <div class="gs-sorts" role="radiogroup" aria-label="Порядок">${G_SORTS.map(([s, label]) =>
      `<button type="button" class="gs-sort" role="radio" data-gs-sort="${s}" aria-checked="${sort === s}"><i></i>${label}</button>`).join("")}</div>
    <button type="button" class="btn primary gs-go" data-gs-close>Показать ${state.current.length}</button>`;
  if (again) body.querySelector(again)?.focus({ preventScroll: true });
}
document.addEventListener("click", e => {
  if (e.target.closest("[data-gsheet]")) return openGallerySheet();
  if (!e.target.closest(".gs-wrap")) return;
  const k = e.target.closest("[data-gs-kind]"), s = e.target.closest("[data-gs-sort]");
  if (k) { setGalleryView({ kind: k.dataset.gsKind }); renderGallery(); }
  else if (s) { setGalleryView({ sort: s.dataset.gsSort }); renderGallery(); }
  else if (e.target.closest("[data-gs-reset]")) { setGalleryView({ kind: "all", sort: "new" }); renderGallery(); }
  else if (e.target.closest("[data-gs-close]")) closeGallerySheet();
});

async function viewPerson(id) {
  const p = profile(id);
  if (!p) { shell("people", `<div class="empty">Такого корефана нет. <a href="#/people">Ко всем корефанам</a></div>`); return; }
  const list = state.media.filter(m => m.people.includes(id));
  const saidBy = state.quotes.filter(q => q.author_id === id);
  const badges = personBadges(id);
  shell("people", `
    ${profileHero(p, id === me() ? `<a class="btn" href="#/me">✎ Редактировать</a>`
      : chat.ready ? `<button type="button" class="btn primary" data-dm="${id}">Написать</button>` : "")}
    ${badges.length ? `<section><h2>Награды</h2><div class="badges">${badges.map(b =>
      `<span class="badge${b.key === "score" ? " gold" : ""}"><i>${b.icon}</i>${b.title}<small>${b.when}${b.now ? " · пока лидирует" : ""}</small></span>`).join("")}</div></section>` : ""}
    <section><h2>Отмечен на ${list.length}</h2>${await grid(list, `${esc(p.name)} пока нигде не отмечен. Загрузи фото и отметь его.`)}</section>
    ${saidBy.length ? `<section><h2>Говорил</h2><div class="quotes">${saidBy.map(quoteCard).join("")}</div></section>` : ""}`);
  state.current = list;
  if (bdayToday(p)) confetti();   // у человека сегодня день рождения — салют
}

// Шапка профиля: обложка, аватарка в кольце своего цвета, имя, статус, о себе, цифры,
// день рождения и закреплённая цитата. actions — кнопки справа («Написать» или «Редактировать»)
function profileHero(p, actions = "", editable = false) {
  const id = p.id;
  const tagged = state.media.filter(m => m.people.includes(id)).length;
  const saidBy = state.quotes.filter(q => q.author_id === id);
  const uploaded = state.media.filter(m => m.owner === id);
  const upIds = new Set(uploaded.map(m => m.id)), saidIds = new Set(saidBy.map(q => q.id));
  const got = state.mr.filter(r => upIds.has(r.media_id)).length + state.qr.filter(r => saidIds.has(r.quote_id)).length;
  const stat = (n, forms) => `<div><b data-count="${n}">${n}</b><span>${plural(n, forms)}</span></div>`;
  const cover = p.cover_path && url(p.cover_path);
  const pq = p.pinned_quote && state.quotes.find(q => q.id === p.pinned_quote);
  return `<section class="phero" style="${ucStyle(id)}">
    <div class="phero-cover${cover ? " has-pic" : ""}">
      ${cover ? `<img class="pc-fg" src="${cover}" alt="Обложка">` : ""}
      ${editable ? `<div class="phero-edit">
        <button type="button" class="btn" data-pick="cover">📷 Обложка</button>
        ${p.cover_path ? `<button type="button" class="btn" data-remove="cover" aria-label="Убрать обложку">✕</button>` : ""}
      </div>` : ""}
    </div>
    <div class="phero-in">
      <div class="phero-ava">${avatar(id, true)}${editable ? `<button type="button" class="ava-cam" data-pick="avatar" aria-label="Сменить аватарку">📷</button>` : ""}</div>
      <div class="phero-info">
        <h1>${esc(p.name)}${bdayToday(p) ? " 🎂" : ""}</h1>
        ${p.status ? `<p class="phero-status">${esc(p.status)}</p>` : ""}
        ${p.bio ? `<p class="sub">${esc(p.bio)}</p>` : ""}
        ${p.birthday ? `<p class="phero-bday">${bdayToday(p) ? "🎉 Сегодня день рождения!" : `🎂 ${bdayText(p)}`}</p>` : ""}
      </div>
      <div class="phero-actions">${actions}</div>
    </div>
    <div class="stats phero-stats">
      ${stat(tagged, ["раз на фото", "раза на фото", "раз на фото"])}
      ${stat(uploaded.length, ["загрузка", "загрузки", "загрузок"])}
      ${stat(saidBy.length, ["цитата", "цитаты", "цитат"])}
      ${stat(got, ["реакция", "реакции", "реакций"])}
    </div>
    ${pq ? `<blockquote class="phero-quote"><span>📌</span>«${esc(pq.text)}»</blockquote>` : ""}
  </section>`;
}

// ---------- Цитаты и шутки ----------

function quoteCard(q) {
  const who = q.author_id ? `<a class="chip" href="#/p/${q.author_id}">${avatar(q.author_id)}${esc(nameOf(q.author_id))}</a>` : `<span class="chip">Кто-то</span>`;
  return `<article class="quote ${q.kind}">
    <span class="kind">${q.kind === "joke" ? "Шутка" : "Цитата"}</span>
    <p class="qtext">${q.kind === "quote" ? "«" + esc(q.text) + "»" : esc(q.text)}</p>
    <div class="row">${who}${q.context ? `<span class="msg">${esc(q.context)}</span>` : ""}</div>
    ${reactButtons("q", q.id)}
    <div class="qmeta"><span>добавил ${esc(nameOf(q.added_by))}, ${dayText(q.created_at)}</span>
      ${q.added_by === me() ? `<button type="button" class="link-btn" data-delq="${q.id}">удалить</button>` : ""}</div>
  </article>`;
}

function viewQuotes() {
  if (!state.quotesReady) {
    shell("quotes", `<div class="empty">Раздел цитат ещё не включён. Нужно выполнить файл 02_quotes.sql в Supabase.</div>`);
    return;
  }
  const f = state.quoteFilter;
  const list = state.quotes.filter(q => f === "all" || q.kind === f);
  const tab = (key, text) => `<button type="button" class="tab" data-qf="${key}" aria-pressed="${f === key}">${text}</button>`;
  shell("quotes", `
    <div><h1>Цитаты и шутки</h1><p class="sub">Золотые фразы и приколы, которые нельзя забыть</p></div>
    <form class="card" id="qForm">
      <div class="row">
        <button type="button" class="tab" data-qk="quote" aria-pressed="true">Цитата</button>
        <button type="button" class="tab" data-qk="joke" aria-pressed="false">Шутка</button>
      </div>
      <label>Текст<textarea id="qText" maxlength="1000" required placeholder="Что было сказано?"></textarea></label>
      <label>Кто сказал
        <div class="chips" id="qWho">
          <button type="button" class="chip" data-who="" aria-pressed="true">Кто-то</button>
          ${state.profiles.map(p => `<button type="button" class="chip" data-who="${p.id}" aria-pressed="false">${avatar(p.id)}${esc(p.name)}</button>`).join("")}
        </div>
      </label>
      <label>Где и когда<input type="text" id="qContext" maxlength="120" placeholder="Например: на даче, лето 2024"></label>
      <div class="row"><button type="submit" class="btn primary">Добавить</button><p class="msg" id="qMsg"></p></div>
    </form>
    <div class="row">${tab("all", "Всё")}${tab("quote", "Цитаты")}${tab("joke", "Шутки")}</div>
    ${list.length ? `<div class="quotes">${list.map(quoteCard).join("")}</div>`
      : `<div class="empty">Пока пусто. Вспомни, что смешного говорили корефаны, и добавь первое.</div>`}`);

  // Выбор одного варианта в группе кнопок
  const single = (sel, attr) => document.querySelectorAll(sel).forEach(b => b.onclick = () =>
    document.querySelectorAll(sel).forEach(x => x.setAttribute("aria-pressed", x === b)));
  single("[data-qk]"); single("[data-who]");
  document.querySelectorAll("[data-qf]").forEach(b => b.onclick = () => { state.quoteFilter = b.dataset.qf; viewQuotes(); });

  document.getElementById("qForm").onsubmit = async e => {
    e.preventDefault();
    const m = document.getElementById("qMsg");
    const btn = e.target.querySelector('button[type="submit"]');
    if (btn.disabled) return;
    btn.disabled = true;   // двойное нажатие не создаёт две одинаковые цитаты
    const { error } = await sb.from("quotes").insert({
      kind: document.querySelector('[data-qk][aria-pressed="true"]').dataset.qk,
      text: document.getElementById("qText").value.trim(),
      author_id: document.querySelector('[data-who][aria-pressed="true"]').dataset.who || null,
      context: document.getElementById("qContext").value.trim() || null
    });
    if (error) { btn.disabled = false; m.className = "msg err"; m.textContent = "Не сохранилось. Попробуй ещё раз."; return; }
    await loadAll(); viewQuotes();
  };
}

// ---------- Топ месяца ----------

const plural = (n, [one, few, many]) => {
  const a = n % 100, b = n % 10;
  return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
};

// color — неон карточки-награды в «Топе», rule — что считается (на обороте карточки)
const NOMS = [
  { key: "score", icon: "👑", title: "Корефан месяца", unit: ["очко", "очка", "очков"], color: "#ff4fd8",
    rule: "Загрузки + отметки + реакции на его фото + 😂 на цитатах ×2" },
  { key: "uploads", icon: "📸", title: "Фотограф месяца", unit: ["загрузка", "загрузки", "загрузок"], color: "#3ee6ff",
    rule: "Больше всех загрузил фото и видео за месяц" },
  { key: "tags", icon: "⭐", title: "Звезда месяца", unit: ["отметка", "отметки", "отметок"], color: "#ffd34f",
    rule: "Чаще всех отмечен на фото за месяц" },
  { key: "laughs", icon: "😂", title: "Комик месяца", unit: ["😂", "😂", "😂"], color: "#ff9f43",
    rule: "Его цитаты собрали больше всех 😂 за месяц" }
];

// Номер месяца: год × 12 + месяц, по местному времени
const monthKey = iso => { const d = new Date(iso); return d.getFullYear() * 12 + d.getMonth(); };

// Очки каждого корефана сразу за все месяцы: Map(номер месяца → { id → очки }).
// Один проход по фото и реакциям вместо того, чтобы для каждого месяца и каждого человека перебирать всё заново
function allMonthStats() {
  const mediaById = new Map(state.media.map(x => [x.id, x])), quoteById = new Map(state.quotes.map(q => [q.id, q]));
  const months = new Map();
  const s = (k, id) => {
    let st = months.get(k); if (!st) months.set(k, st = {});
    return st[id] || (st[id] = { uploads: 0, tags: 0, laughs: 0, likes: 0, score: 0 });
  };
  state.media.forEach(x => { const k = monthKey(x.created_at); s(k, x.owner).uploads++; x.people.forEach(p => s(k, p).tags++); });
  state.mr.forEach(r => { const x = mediaById.get(r.media_id); if (x) s(monthKey(r.created_at), x.owner).likes++; });
  state.qr.forEach(r => {
    if (r.emoji !== "laugh") return;
    const q = quoteById.get(r.quote_id); if (q?.author_id) s(monthKey(r.created_at), q.author_id).laughs++;
  });
  months.forEach(st => Object.values(st).forEach(v => { v.score = v.uploads + v.tags + v.likes + v.laughs * 2; }));
  return months;
}

// Очки за один месяц (для «Топа») и фото, загруженные в этом месяце
function monthStats(y, m) {
  const k = y * 12 + m;
  return { stats: allMonthStats().get(k) || {}, monthMedia: state.media.filter(x => monthKey(x.created_at) === k) };
}
const leaderOf = (stats, key) => Object.entries(stats).filter(([id, v]) => v[key] > 0 && profile(id)).sort((a, b) => b[1][key] - a[1][key])[0];

// Награды корефана: в каких месяцах он выигрывал номинации
// months — готовый результат allMonthStats(), чтобы в галерее не считать его заново для каждого корефана
function personBadges(id, months = allMonthStats()) {
  const now = new Date(), end = now.getFullYear() * 12 + now.getMonth();
  const out = [];
  [...months.keys()].filter(k => k <= end).sort((a, b) => a - b).forEach(k => {
    const yy = Math.floor(k / 12), mm = k % 12;
    NOMS.forEach(n => {
      const l = leaderOf(months.get(k), n.key);
      if (l && l[0] === id) out.push({ ...n, when: `${MONTHS[mm]} ${yy}`, now: k === end });
    });
  });
  return out.reverse();
}

async function viewTop() {
  if (!state.topMonth) { const d = new Date(); state.topMonth = { y: d.getFullYear(), m: d.getMonth() }; }
  const { y, m } = state.topMonth;
  const now = new Date();
  const isNow = y === now.getFullYear() && m === now.getMonth();

  const { stats, monthMedia } = monthStats(y, m);
  // Лучшие фото: загруженные в этом месяце, по числу реакций
  const rcOf = countBy(state.mr, "media_id");
  const best = monthMedia
    .map(x => ({ x, n: rcOf.get(x.id) || 0 }))
    .filter(o => o.n > 0).sort((a, b) => b.n - a.n).slice(0, 6).map(o => o.x);

  // Награды месяца — коллекционные карточки: листаются свайпом, нажатие переворачивает.
  // Спереди победитель, на обороте — кто был рядом (топ-5) и за что дают награду
  const rankOf = key => Object.entries(stats).filter(([id, v]) => v[key] > 0 && profile(id)).sort((a, b) => b[1][key] - a[1][key]);
  const cards = NOMS.map((n, i) => {
    const list = rankOf(n.key), l = list[0], v = l ? l[1][n.key] : 0;
    const front = l
      ? `<span class="aw-ava">${avatar(l[0], true)}</span>
         <b class="aw-name">${esc(nameOf(l[0]))}</b>
         <span class="aw-val"><b data-count="${v}">${v}</b> ${plural(v, n.unit)}</span>`
      : `<span class="aw-ava aw-none">?</span><b class="aw-name">Пока никого</b><span class="aw-val">Награда ещё свободна</span>`;
    const back = list.length
      ? `<ol class="aw-list">${list.slice(0, 5).map(([id, s], k) => `<li${k === 0 ? ` class="win"` : ""}>
          <span class="aw-place">${k + 1}</span>${avatar(id)}<span class="aw-who">${esc(nameOf(id))}</span><b>${s[n.key]}</b></li>`).join("")}</ol>`
      : `<p class="aw-empty">В этом месяце тут ещё никого</p>`;
    return `<div class="aw" data-aw="${i}" style="--nc:${n.color}; --i:${i}" tabindex="0" role="button" aria-label="${n.title}: перевернуть карточку">
      <div class="aw-in">
        <div class="aw-face aw-front">
          <span class="aw-no">№${i + 1} / ${NOMS.length}</span>
          <span class="aw-ico" aria-hidden="true">${n.icon}</span>
          <span class="aw-title">${n.title}</span>
          ${front}
          <span class="aw-hint">Нажми — перевернуть</span>
        </div>
        <div class="aw-face aw-back">
          <span class="aw-title">${n.icon} ${n.title}</span>
          ${back}
          <p class="aw-rule">${n.rule}</p>
          ${l ? `<a class="aw-link" href="#/p/${l[0]}">Профиль победителя →</a>` : ""}
        </div>
      </div>
    </div>`;
  }).join("");
  const noms = `<div class="aw-wrap">
      <button type="button" class="aw-arrow prev" data-aw-go="-1" aria-label="Предыдущая награда">‹</button>
      <div class="aw-track" id="awTrack">${cards}</div>
      <button type="button" class="aw-arrow next" data-aw-go="1" aria-label="Следующая награда">›</button>
    </div>
    <div class="aw-dots" id="awDots">${NOMS.map((_, i) => `<i class="${i === 0 ? "on" : ""}"></i>`).join("")}</div>`;

  // Шапка: слева название и переключатель месяца, справа цифры месяца — чтобы не было пустоты
  const k = y * 12 + m;
  const reacts = state.mr.filter(r => monthKey(r.created_at) === k).length + state.qr.filter(r => monthKey(r.created_at) === k).length;
  const active = Object.values(stats).filter(v => v.score > 0).length;
  const daysLeft = new Date(y, m + 1, 0).getDate() - now.getDate();
  const when = !isNow ? "Итоги подведены" : daysLeft ? `До итогов ${daysLeft} ${plural(daysLeft, ["день", "дня", "дней"])}` : "Итоги — сегодня в полночь";
  const stat = (n, label, c) => `<div class="th-stat" style="--sc:${c}"><b data-count="${n}">${n}</b><span>${label}</span></div>`;

  shell("top", `
    <div class="top-hero">
      <div class="th-main">
        <h1>Топ месяца</h1>
        <div class="th-month">
          <button type="button" data-tm="-1" aria-label="Прошлый месяц">‹</button>
          <b>${MONTHS[m]} ${y}</b>
          <button type="button" data-tm="1" aria-label="Следующий месяц" ${isNow ? "disabled" : ""}>›</button>
        </div>
        <p class="th-when">${isNow ? `<i class="th-live"></i>` : "🏁 "}${when}</p>
      </div>
      <div class="th-stats">
        ${stat(monthMedia.length, "фото и видео", "#ff4fd8")}
        ${stat(reacts, plural(reacts, ["реакция", "реакции", "реакций"]), "#3ee6ff")}
        ${stat(active, "корефанов в деле", "#ffd34f")}
      </div>
    </div>
    ${state.reactsReady ? "" : `<div class="empty">Реакции ещё не включены. Нужно выполнить файл 03_reactions.sql в Supabase.</div>`}
    <section class="awards"><h2>Награды месяца</h2>${noms}</section>
    <section><h2>Лучшие фото и видео</h2>${await grid(best, "В этом месяце ещё никто не ставил реакций. Открой любое фото и жми 😂 🔥 ❤️")}</section>`);
  state.current = best;
  wireAwards();

  document.querySelectorAll("[data-tm]").forEach(b => b.onclick = () => {
    let mm = m + Number(b.dataset.tm), yy = y;
    if (mm < 0) { mm = 11; yy--; } if (mm > 11) { mm = 0; yy++; }
    state.topMonth = { y: yy, m: mm };
    viewTop();
  });
}

// Карточки-награды: свайп листает (прилипают по центру), нажатие или Enter переворачивает,
// точки снизу и стрелки по бокам (на компьютере) показывают, какая сейчас
function wireAwards() {
  const track = document.getElementById("awTrack"); if (!track) return;
  const cards = [...track.querySelectorAll("[data-aw]")], dots = [...document.querySelectorAll("#awDots i")];
  let cur = 0, t = null;
  const current = () => {
    const mid = track.scrollLeft + track.clientWidth / 2;
    let best = 0, d = Infinity;
    cards.forEach((c, i) => { const x = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid); if (x < d) { d = x; best = i; } });
    return best;
  };
  const paint = () => {
    cur = current();
    dots.forEach((x, i) => x.classList.toggle("on", i === cur));
    cards.forEach((c, i) => {
      c.classList.toggle("cur", i === cur);
      if (i !== cur) c.classList.remove("flipped");   // уехала в сторону — снова лицом
    });
  };
  const go = i => {
    const c = cards[Math.max(0, Math.min(cards.length - 1, i))];
    track.scrollTo({ left: c.offsetLeft - (track.clientWidth - c.offsetWidth) / 2, behavior: "smooth" });
  };
  track.addEventListener("scroll", () => { clearTimeout(t); t = setTimeout(paint, 60); }, { passive: true });
  cards.forEach((c, i) => {
    const flip = e => {
      if (e.target.closest("a")) return;
      // На компьютере карточки стоят в ряд (grid) — переворачивается любая. На телефоне соседняя сначала подъезжает к центру
      const row = getComputedStyle(track).display === "grid";
      if (!row && i !== cur) return go(i);
      c.classList.toggle("flipped");
      navigator.vibrate?.(8);
    };
    c.addEventListener("click", flip);
    c.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(e); } });
  });
  document.querySelectorAll("[data-aw-go]").forEach(b => b.onclick = () => go(cur + Number(b.dataset.awGo)));
  paint();
}

// Загрузка пачкой: выбираешь сразу много фото и видео (хоть 30), потом листаешь их по одному
// и у каждого отмечаешь, кто на нём, подпись и дату. «Как на прошлом» и «…всем» — чтобы не тыкать одно и то же 30 раз
const isApple = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const localDay = ms => { const d = new Date(ms), p2 = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };

function viewUpload() {
  // На iPhone в списке форматов только «image/*,video/*»: с расширениями (.heic) Safari открывал не галерею,
  // а «Файлы» — там фото выбираются по одному. HEIC iPhone и так сам переводит в JPEG
  const accept = isApple ? "image/*,video/*" : "image/*,video/*,.heic,.heif";
  shell("", `
    <div><h1>Загрузить</h1><p class="sub">Выбери сразу сколько угодно фото и видео — потом пролистаешь их и отметишь, кто где. Фото сожмутся сами, видео до ${KOREFANY.maxVideoMb} МБ.</p></div>
    <form class="card up-form" id="upForm">
      <div class="drop" id="drop" tabindex="0" role="button">Нажми или перетащи сюда фото и видео<small>Можно выбрать сразу много</small></div>
      <input type="file" id="files" accept="${accept}" multiple hidden>
      <div class="up-editor" id="upEditor" hidden>
        <div class="up-strip" id="upStrip"></div>
        <div class="up-cur">
          <div class="up-preview" id="upPrev"></div>
          <div class="up-fields">
            <div class="up-head">
              <button type="button" class="btn icon-btn" data-up-go="-1" aria-label="Предыдущее">←</button>
              <b id="upNum"></b>
              <button type="button" class="btn icon-btn" data-up-go="1" aria-label="Следующее">→</button>
            </div>
            <div class="up-label">Кто на этом ${"<span id='upWhat'>фото</span>"}?</div>
            <div class="chips" id="tagChips">${state.profiles.map(p =>
              `<button type="button" class="chip" data-tag="${p.id}" aria-pressed="false">${avatar(p.id)}${esc(p.name)}</button>`).join("")}</div>
            <div class="up-quick">
              <button type="button" class="link-btn" data-up-copy>↺ Как на прошлом</button>
              <button type="button" class="link-btn" data-up-alltags>👥 Эти отметки — всем</button>
            </div>
            <label>Подпись<textarea id="caption" maxlength="500" placeholder="Что тут происходит?"></textarea></label>
            <label>Когда это было<input type="date" id="takenAt"></label>
            <div class="up-quick"><button type="button" class="link-btn" data-up-alldate>📅 Эту дату — всем</button></div>
          </div>
        </div>
      </div>
      <div class="progress" id="upProg" hidden><i></i></div>
      <div class="row"><button type="submit" class="btn primary" id="upBtn" disabled>Загрузить</button><p class="msg" id="upMsg"></p></div>
    </form>`);

  // Что выбрано: у каждого файла свои отметки, подпись и дата
  let items = [], cur = 0, busy = false;
  const $ = id => document.getElementById(id);
  const chips = () => [...document.querySelectorAll("#tagChips [data-tag]")];
  const kindOf = f => f.type.startsWith("video/") ? "video" : "photo";

  const add = list => {
    const have = new Set(items.map(it => it.key));
    // HEIC с айфона Windows иногда отдаёт без типа, поэтому смотрим и на расширение
    const fresh = [...list].filter(f => f.type.startsWith("image/") || f.type.startsWith("video/") || isHeic(f))
      .map(f => ({ file: f, key: `${f.name}|${f.size}|${f.lastModified}`, kind: kindOf(f), tags: [], caption: "",
        // Дата — по местному времени, а не по Гринвичу: иначе утреннее фото в Ангарске попадало во вчерашний день
        takenAt: localDay(f.lastModified || Date.now()) }))
      .filter(it => !have.has(it.key));
    if (!fresh.length) return;
    const first = items.length;
    items.push(...fresh);
    paintStrip();
    show(first);
    pumpThumbs();
  };

  // ВАЖНО для iPhone: на экране только уменьшенные копии. Раньше в ленте стояли оригиналы по 12 Мп,
  // и при 10 фото телефон раскрывал сотни мегабайт картинок на каждое нажатие — страница замирала,
  // кнопка «Загрузить» не нажималась. Теперь миниатюры 200px и превью 1200px делаются по одной, в фоне
  const makePic = async (it, max) => {
    if (it.kind === "video") { const b = await videoThumb(it.file); return b ? URL.createObjectURL(b) : null; }
    const img = await decodeImage(it.file);
    try { const b = await scaleTo(img, max, 0.8); return b ? URL.createObjectURL(b) : null; }
    finally { img.close?.(); }
  };
  const forget = it => [it.thumb, it.view, it.vurl].forEach(u => u && URL.revokeObjectURL(u));
  let pumping = false;
  async function pumpThumbs() {
    if (pumping) return;
    pumping = true;
    try {
      for (let it; !busy && (it = items.find(x => !x.thumbTried));) {   // во время загрузки не мешаем ей
        it.thumbTried = true;
        it.thumb = await makePic(it, 200).catch(() => null);
        if (!items.includes(it)) { forget(it); continue; }   // пока делали, его уже убрали
        const el = $("upStrip")?.querySelector(`[data-key="${CSS.escape(it.key)}"] .up-pic`);
        if (el) el.outerHTML = thumbPic(it);
      }
    } finally { pumping = false; }
  }
  const thumbPic = it => it.thumb ? `<img class="up-pic" src="${it.thumb}" alt="">`
    : `<span class="up-pic${it.thumbTried ? "" : " wait"}">${it.thumbTried ? (it.kind === "video" ? "🎬" : "🖼") : ""}</span>`;
  const thumbHtml = (it, i) => `<button type="button" class="up-thumb${i === cur ? " on" : ""}" data-up-pick="${i}" data-key="${esc(it.key)}" aria-label="${it.kind === "video" ? "Видео" : "Фото"} ${i + 1}">
      ${thumbPic(it)}
      ${it.kind === "video" ? `<i class="up-vid">▶</i>` : ""}
      <i class="up-badge"${it.tags.length ? "" : " hidden"}>👥 ${it.tags.length}</i>
      <span class="up-x" data-up-del="${i}" role="button" aria-label="Убрать">✕</span>
    </button>`;

  // Ленту целиком рисуем только когда добавили или убрали файлы. Выбор и отметки — точечно, без перерисовки картинок
  const paintStrip = () => {
    $("upStrip").innerHTML = items.map(thumbHtml).join("") + `<button type="button" class="up-thumb up-more" data-up-more aria-label="Добавить ещё">+</button>`;
  };
  const markStrip = () => {
    $("upStrip").querySelectorAll("[data-up-pick]").forEach((b, i) => {
      b.classList.toggle("on", i === cur);
      const badge = b.querySelector(".up-badge"), n = items[i]?.tags.length || 0;
      badge.hidden = !n; badge.textContent = `👥 ${n}`;
    });
    $("upStrip").querySelector(".up-thumb.on")?.scrollIntoView({ block: "nearest", inline: "center" });
  };

  // Большое превью текущего: фото — уменьшенная копия 1200px, видео — само видео (только одно на экране)
  function paintPreview(it) {
    const box = $("upPrev");
    if (it.kind === "video") {
      it.vurl = it.vurl || URL.createObjectURL(it.file);
      box.innerHTML = `<video src="${it.vurl}" controls muted playsinline preload="metadata"></video>`;
      return;
    }
    if (it.view) { box.innerHTML = `<img src="${it.view}" alt="">`; return; }
    box.innerHTML = `<span class="up-nopic">Открываю фото...</span>`;
    it.viewing = it.viewing || makePic(it, 1200).catch(() => null);
    it.viewing.then(u => {
      it.view = u;
      if (items[cur] !== it) return;   // пока открывали, уже перелистнули
      box.innerHTML = u ? `<img src="${u}" alt="">` : `<span class="up-nopic">Превью не открылось, но фото загрузится нормально</span>`;
    });
  }

  // Открыть файл номер i: превью и его отметки, подпись, дата
  function show(i) {
    $("upEditor").hidden = !items.length;
    $("drop").hidden = !!items.length;
    $("upBtn").disabled = !items.length || busy;
    $("upBtn").textContent = items.length > 1 ? `Загрузить все (${items.length})` : "Загрузить";
    if (!items.length) { $("upStrip").innerHTML = ""; $("upPrev").innerHTML = ""; cur = 0; return; }   // убрали все — начинаем с чистого листа
    const prev = items[cur];
    cur = Math.max(0, Math.min(items.length - 1, i));
    const it = items[cur];
    if (prev !== it || !$("upPrev").firstElementChild) paintPreview(it);
    $("upNum").textContent = `${cur + 1} из ${items.length}`;
    $("upWhat").textContent = it.kind === "video" ? "видео" : "фото";
    chips().forEach(b => b.setAttribute("aria-pressed", it.tags.includes(b.dataset.tag)));
    $("caption").value = it.caption; autoGrow($("caption"));
    $("takenAt").value = it.takenAt || "";
    document.querySelector('[data-up-go="-1"]').disabled = cur === 0;
    document.querySelector('[data-up-go="1"]').disabled = cur === items.length - 1;
    document.querySelector("[data-up-copy]").disabled = cur === 0;
    markStrip();
  }

  const drop = $("drop"), input = $("files");
  drop.onclick = () => input.click();
  drop.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } };
  input.onchange = () => { add(input.files); input.value = ""; };   // value = "": тот же файл можно выбрать снова
  for (const el of [drop, $("upEditor")]) {
    el.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
    el.ondragleave = () => drop.classList.remove("over");
    el.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); add(e.dataTransfer.files); };
  }

  // Свайп по превью влево-вправо — следующее и предыдущее фото
  let sx = 0, sy = 0;
  $("upPrev").addEventListener("touchstart", e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  $("upPrev").addEventListener("touchend", e => {
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) show(cur + (dx < 0 ? 1 : -1));
  }, { passive: true });

  $("tagChips").onclick = e => {
    const b = e.target.closest("[data-tag]"); if (!b || !items[cur]) return;
    const on = b.getAttribute("aria-pressed") !== "true";
    b.setAttribute("aria-pressed", on);
    const it = items[cur];
    it.tags = on ? [...it.tags, b.dataset.tag] : it.tags.filter(x => x !== b.dataset.tag);
    markStrip();
  };
  $("caption").oninput = () => { if (items[cur]) items[cur].caption = $("caption").value; };
  $("takenAt").onchange = () => { if (items[cur]) items[cur].takenAt = $("takenAt").value; };

  $("upEditor").onclick = e => {
    const del = e.target.closest("[data-up-del]");
    if (del) {
      e.stopPropagation();
      const i = Number(del.dataset.upDel);
      if (items[i]) forget(items[i]);
      items.splice(i, 1);
      paintStrip();
      $("upPrev").innerHTML = "";   // превью нарисуется заново для того, кто теперь текущий
      return show(i < cur ? cur - 1 : cur);
    }
    if (e.target.closest("[data-up-more]")) return input.click();
    const pick = e.target.closest("[data-up-pick]"); if (pick) return show(Number(pick.dataset.upPick));
    const go = e.target.closest("[data-up-go]"); if (go) return show(cur + Number(go.dataset.upGo));
    const say = t => { const m = $("upMsg"); m.className = "msg ok"; m.textContent = t; setTimeout(() => { if (m.textContent === t) m.textContent = ""; }, 2500); };
    if (e.target.closest("[data-up-copy]") && cur > 0) { items[cur].tags = [...items[cur - 1].tags]; show(cur); return say("Отметки как на прошлом"); }
    if (e.target.closest("[data-up-alltags]")) { const t = items[cur].tags; items.forEach(it => it.tags = [...t]); show(cur); return say(t.length ? `Отметки поставлены на все ${items.length}` : "Отметки убраны со всех"); }
    if (e.target.closest("[data-up-alldate]")) { const d = items[cur].takenAt; items.forEach(it => it.takenAt = d); return say(`Дата поставлена на все ${items.length}`); }
  };

  $("upForm").onsubmit = async e => {
    e.preventDefault();
    if (busy || !items.length) return;
    busy = true;
    const btn = $("upBtn"), msg = $("upMsg");
    btn.disabled = true; msg.className = "msg";
    $("upForm").classList.add("uploading");
    const prog = $("upProg"), bar = prog.querySelector("i");
    prog.hidden = false;
    const failed = [], total = items.length;
    for (let i = 0; i < total; i++) {
      const it = items[i];
      msg.textContent = `Загружаю ${i + 1} из ${total}...`;
      bar.style.width = `${Math.max(6, (i + 0.5) / total * 100)}%`;
      try { await uploadOne(it.file, { tags: it.tags, caption: it.caption.trim(), takenAt: it.takenAt || null }); forget(it); }
      catch (err) { failed.push({ it, text: `${it.file.name}: ${err.message || err}` }); }
      bar.style.width = `${(i + 1) / total * 100}%`;
    }
    // Одно уведомление всем на всю пачку: «Костя загрузил 12 фото и 2 видео» (а не 14 штук подряд)
    if (failed.length < total) sb.rpc("announce_media").then(() => {}, () => {});
    await loadAll();
    busy = false;
    $("upForm").classList.remove("uploading");
    if (failed.length) {
      // Остаются только те, что не загрузились, — со своими отметками. Повторное нажатие не задублирует загруженное
      items = failed.map(f => f.it);
      items.forEach(it => { forget(it); it.thumbTried = false; it.thumb = it.view = it.vurl = null; it.viewing = null; });
      paintStrip(); $("upPrev").innerHTML = "";
      show(0);
      pumpThumbs();
      msg.className = "msg err";
      msg.textContent = `Не загрузилось ${failed.length} из ${total}: ${failed.map(f => f.text).join("; ")}`;
    } else {
      location.hash = "#/";
    }
  };
}

// Мой профиль: сверху шапка как на странице корефана (с кнопками смены обложки и аватарки),
// ниже вкладки: Профиль · Уведомления · Звук · Безопасность
const ME_TABS = [["profile", "Профиль"], ["notify", "Уведомления"], ["sound", "Звук"], ["security", "Безопасность"]];
const STATUS_PRESETS = ["🎧 на расслабоне", "🏋️ в зале", "😴 сплю", "🍕 ем", "🎮 играю", "📚 учусь", "💼 на работе", "🚗 в дороге"];

async function viewMe() {
  const p = profile(me()) || { id: me(), name: "", bio: "" };
  state.meTab = state.meTab || "profile";
  shell("", `
    ${profileHero(p, `<a class="btn" href="#/p/${me()}">Как меня видят →</a>`, true)}
    <input type="file" id="pickFile" accept="image/*,.heic,.heif" hidden>
    <p class="msg" id="pickMsg"></p>
    <nav class="me-tabs" id="meTabs">${ME_TABS.map(([k, t]) =>
      `<button type="button" class="tab" data-metab="${k}" aria-pressed="${state.meTab === k}">${t}</button>`).join("")}</nav>
    <section id="meTab" class="me-tab"></section>`);
  wireMePictures(p);
  renderMeTab();
}

function renderMeTab() {
  const p = profile(me()) || { name: "", bio: "" };
  const box = document.getElementById("meTab"); if (!box) return;
  document.querySelectorAll("[data-metab]").forEach(b => b.setAttribute("aria-pressed", b.dataset.metab === state.meTab));
  const t = state.meTab;

  if (t === "profile") {
    const myQuotes = state.quotes.filter(q => q.author_id === me());
    box.innerHTML = `
      <form class="card" id="profForm">
        <label>Имя<input type="text" id="pName" maxlength="40" required value="${esc(p.name)}"></label>
        <label>Статус<input type="text" id="pStatus" maxlength="40" value="${esc(p.status || "")}" placeholder="Например: 🎧 на расслабоне"></label>
        <div class="chips">${STATUS_PRESETS.map(s => `<button type="button" class="chip" data-status="${esc(s)}">${esc(s)}</button>`).join("")}
          <button type="button" class="chip" data-status="">✕ без статуса</button></div>
        <label>Пару слов о себе<textarea id="pBio" maxlength="200">${esc(p.bio || "")}</textarea></label>
        <label>День рождения<input type="date" id="pBday" value="${p.birthday || ""}"></label>
        <label>Закреплённая цитата
          <select id="pQuote"><option value="">Без цитаты</option>${myQuotes.map(q =>
            `<option value="${q.id}" ${p.pinned_quote === q.id ? "selected" : ""}>${esc(q.text.slice(0, 70))}</option>`).join("")}</select>
          ${myQuotes.length ? "" : `<span class="msg">Пока нет цитат, где автор — ты. Их добавляют в разделе «Цитаты».</span>`}
        </label>
        <div class="row"><button class="btn primary" type="submit">Сохранить</button><p class="msg" id="pMsg"></p></div>
      </form>
      <div class="card">
        <h2 style="margin:0">Цвет неона</h2>
        <div class="swatches">${Object.entries(NEON).map(([k, c]) =>
          `<button type="button" class="swatch" data-color="${k}" aria-pressed="${(p.color || "pink") === k}" style="--a:${c.a};--b:${c.b}" title="${c.name}"><span></span>${c.name}</button>`).join("")}</div>
        <p class="msg">Этим цветом светятся твой профиль, кольцо аватарки и твои сообщения в чатах — у всех.</p>
      </div>`;
    autoGrow(document.getElementById("pBio"));
    box.querySelectorAll("[data-status]").forEach(b => b.onclick = () => { document.getElementById("pStatus").value = b.dataset.status; });
    box.querySelectorAll("[data-color]").forEach(b => b.onclick = async () => {
      box.querySelectorAll("[data-color]").forEach(x => x.setAttribute("aria-pressed", x === b));
      const { error } = await sb.from("profiles").update({ color: b.dataset.color }).eq("id", me());
      if (error) return toast("Не получилось сменить цвет");
      // Перекрашиваем шапку на месте, без перерисовки вкладки: недописанные имя и статус в форме не пропадут
      const mine = profile(me()); if (mine) mine.color = b.dataset.color;
      document.querySelector(".phero")?.setAttribute("style", ucStyle(me()));
    });
    document.getElementById("profForm").onsubmit = async e => {
      e.preventDefault();
      const m = document.getElementById("pMsg");
      const name = document.getElementById("pName").value.trim();
      if (!name) { m.className = "msg err"; m.textContent = "Имя не может быть пустым."; return; }
      const { error } = await sb.from("profiles").update({
        name,
        status: document.getElementById("pStatus").value.trim() || null,
        bio: document.getElementById("pBio").value.trim(),
        birthday: document.getElementById("pBday").value || null,
        pinned_quote: document.getElementById("pQuote").value || null
      }).eq("id", me());
      if (error) { m.className = "msg err"; m.textContent = "Не сохранилось. Попробуй ещё раз."; return; }
      await loadAll(); viewMe();
    };
  }

  if (t === "notify") {
    box.innerHTML = `<div class="card"><h2 style="margin:0">Уведомления на телефон</h2><div id="pushBox"><p class="msg">Проверяю...</p></div></div>`;
    renderPushBox();
  }

  if (t === "sound") {
    box.innerHTML = `<div class="card">
      <h2 style="margin:0">Звук сообщений</h2>
      <div class="row">
        <button class="btn" type="button" id="soundToggle" aria-pressed="${soundOn()}">${soundOn() ? "🔔 Включён" : "🔕 Выключен"}</button>
        <button class="btn" type="button" id="soundTest">▶ Послушать</button>
      </div>
      <label class="vol">Громкость <b id="volVal">${Math.round(soundVolume() * 100)}%</b>
        <span class="vol-row"><span aria-hidden="true">🔈</span>
          <input type="range" id="volume" min="0" max="100" step="5" value="${Math.round(soundVolume() * 100)}" style="--p:${Math.round(soundVolume() * 100)}%">
          <span aria-hidden="true">🔊</span></span>
      </label>
      <p class="msg">Играет, когда тебе пишут в чатах. Настройка своя на каждом телефоне и компьютере.</p>
    </div>`;
    document.getElementById("soundToggle").onclick = e => {
      const on = !soundOn();
      setSoundOn(on);
      e.currentTarget.setAttribute("aria-pressed", on);
      e.currentTarget.textContent = on ? "🔔 Включён" : "🔕 Выключен";
      if (on) playMessageSound(true);
    };
    document.getElementById("soundTest").onclick = () => playMessageSound(true);
    // Ползунок громкости: двигаешь — меняется число, отпустил — звучит пример с новой громкостью
    const vol = document.getElementById("volume");
    vol.oninput = () => {
      document.getElementById("volVal").textContent = vol.value + "%";
      vol.style.setProperty("--p", vol.value + "%");
      setSoundVolume(vol.value / 100);
    };
    vol.onchange = () => { setupAudio(); playMessageSound(true); };
  }

  if (t === "security") {
    box.innerHTML = `
      <form class="card" id="passForm">
        <h2 style="margin:0">Новый пароль</h2>
        <p class="msg">Почта для входа: ${esc(state.session.user.email)}</p>
        <label>Пароль, минимум 8 символов<input type="password" id="pass" minlength="8" required autocomplete="new-password"></label>
        <div class="row"><button class="btn" type="submit">Сменить пароль</button><p class="msg" id="passMsg"></p></div>
      </form>
      <div class="card"><h2 style="margin:0">Выход</h2><p class="msg">На этом устройстве нужно будет снова ввести почту и пароль.</p>
        <div><button class="btn danger" id="logout" type="button">Выйти</button></div></div>
      <p class="msg">Версия сайта: ${APP_VERSION || "?"}</p>`;
    document.getElementById("passForm").onsubmit = async e => {
      e.preventDefault();
      const m = document.getElementById("passMsg");
      const { error } = await sb.auth.updateUser({ password: document.getElementById("pass").value });
      m.className = error ? "msg err" : "msg ok";
      m.textContent = error ? "Не получилось сменить пароль: " + error.message : "Пароль изменён";
      if (!error) document.getElementById("pass").value = "";
    };
    document.getElementById("logout").onclick = async () => {
      // Отвязываем этот телефон от уведомлений: иначе после выхода сюда приходили бы чужие сообщения
      await unlinkPushDevice();
      // Сохранённые на телефоне фото и данные — только для вошедшего, при выходе стираем
      try { await caches.delete("korefany-pics-v1"); } catch (e) {}
      try { Object.keys(localStorage).filter(k => k.startsWith("korefany-data-")).forEach(k => localStorage.removeItem(k)); } catch (e) {}
      sb.auth.signOut();
    };
  }
}

// Смена аватарки и обложки: кнопки 📷 прямо в шапке профиля
function wireMePictures(p) {
  const file = document.getElementById("pickFile"), msg = document.getElementById("pickMsg");
  let what = null;
  document.querySelectorAll("[data-pick]").forEach(b => b.onclick = () => { what = b.dataset.pick; file.click(); });
  const save = async (field, newPath) => {
    const old = p[field];
    const { error } = await sb.from("profiles").update({ [field]: newPath }).eq("id", me());
    if (error) throw error;
    if (old) await removeFiles(BUCKET, [old]);
    await loadAll(); viewMe();
  };
  document.querySelectorAll("[data-remove]").forEach(b => b.onclick = () => save(b.dataset.remove === "cover" ? "cover_path" : "avatar_path", null)
    .catch(err => { msg.className = "msg err"; msg.textContent = "Не получилось: " + (err.message || err); }));
  file.onchange = async () => {
    const f = file.files[0]; file.value = ""; if (!f || !what) return;
    msg.className = "msg"; msg.textContent = "Загружаю...";
    try {
      // Аватарка — квадрат 400px, обложка — широкая картинка до 1600px
      const blob = what === "avatar" ? await cropSquare(f, 400) : await resizeImage(f, 1600, 0.85);
      const path = `${me()}/${what}-${Date.now()}.jpg`;
      await putFile(BUCKET, path, blob, "image/jpeg");
      await save(what === "avatar" ? "avatar_path" : "cover_path", path);
    } catch (err) { msg.className = "msg err"; msg.textContent = "Не получилось: " + (err.message || err); }
  };
}

document.addEventListener("click", e => {
  const t = e.target.closest("[data-metab]");
  if (t) { state.meTab = t.dataset.metab; renderMeTab(); }
});

function viewLogin() {
  // Логотип как неоновая вывеска: зажигается с мерцанием, одна буква иногда «барахлит»
  $app.innerHTML = `
    <div class="login">
      <h1 class="sign" aria-label="Корефаны">КОРЕФ<span class="broken">А</span>НЫ</h1>
      <p class="tagline">только для своих</p>
      <form class="card" id="loginForm">
      <p class="msg">Логин и пароль выдаёт Костя.</p>
      <label>Почта<input type="email" id="email" required autocomplete="username"></label>
      <label>Пароль<input type="password" id="password" required autocomplete="current-password"></label>
      <button class="btn primary" type="submit">Войти</button>
      <p class="msg err" id="loginMsg"></p>
    </form></div>`;
  // Почту с прошлого входа подставляем сами, пароль запомнит браузер
  try { document.getElementById("email").value = localStorage.getItem("korefany-email") || ""; } catch (e) {}
  document.getElementById("loginForm").onsubmit = async e => {
    e.preventDefault();
    const email = document.getElementById("email").value.trim();
    const { error } = await sb.auth.signInWithPassword({ email, password: document.getElementById("password").value });
    if (error) { document.getElementById("loginMsg").textContent = "Не пускает: неверная почта или пароль."; return; }
    try { localStorage.setItem("korefany-email", email); } catch (e) {}
  };
}

// ---------- Просмотр одного файла ----------

// dir: -1 пришли свайпом назад, 1 вперёд, 0 просто открыли.
// fromEl — картинка, на которую нажали (плитка, пост, обложка): фото «вырастет» из неё
async function openViewer(id, dir = 0, fromEl = null) {
  let list = state.current || state.media;
  if (!list.some(m => m.id === id)) list = state.media;
  const idx = list.findIndex(m => m.id === id);
  const m = list[idx]; if (!m) return;
  // На телефоне — свой просмотр, как в Инстаграме (ниже, openPhoneViewer)
  if (matchMedia("(max-width: 700px)").matches) return openPhoneViewer(list, idx, fromEl, dir);
  await signed([m.path, thumbPath(m)]);
  document.getElementById("viewer")?.remove();   // листаем: старый просмотр убираем без шага «назад»
  state.viewing = m.id;
  const el = document.createElement("div");
  el.className = "viewer"; el.id = "viewer";
  // Фон за фото: размытая копия самого снимка
  const bg = url(thumbPath(m)) || (m.kind === "photo" ? url(m.path) : "");
  el.innerHTML = `
    ${bg ? `<div class="viewer-bg" style="background-image:url('${bg}')"></div>` : ""}
    <button class="btn close" data-close>✕ Закрыть</button>
    ${idx > 0 ? `<button class="btn nav-btn prev" data-go="${list[idx - 1].id}" data-dir="-1" aria-label="Предыдущее">←</button>` : ""}
    ${idx < list.length - 1 ? `<button class="btn nav-btn next" data-go="${list[idx + 1].id}" data-dir="1" aria-label="Следующее">→</button>` : ""}
    <div class="media${dir ? (dir > 0 ? " from-right" : " from-left") : ""}">${m.kind === "video"
      ? `<video src="${url(m.path)}" poster="${url(thumbPath(m))}" data-vthumb="${m.id}" controls autoplay playsinline></video>`
      : `<img src="${url(m.path)}" alt="${esc(m.caption)}">`}</div>
    <aside class="info">
      ${m.caption ? `<p class="caption">${esc(m.caption)}</p>` : ""}
      <p class="msg">${dayText(m.taken_at || m.created_at)} · загрузил ${esc(nameOf(m.owner))}</p>
      ${reactButtons("m", m.id)}
      ${m.people.length ? `<div><h2>На фото</h2><div class="chips">${m.people.map(p =>
        `<a class="chip" href="#/p/${p}">${avatar(p)}${esc(nameOf(p))}</a>`).join("")}</div></div>` : ""}
      <div class="row">${m.owner === me()
        ? `<button type="button" class="btn" data-edit-media="${m.id}">✎ Изменить</button><button class="btn danger" data-del="${m.id}">Удалить</button>`
        : `<button type="button" class="btn" data-edit-media="${m.id}">👥 Отметить, кто на фото</button>`}</div>
      ${commentsBlock(m)}
    </aside>`;
  const fresh = !document.getElementById("viewer");
  document.body.appendChild(el);
  document.body.classList.add("viewer-open");   // страница под просмотром не прокручивается
  // Кнопка «Назад» на телефоне закрывает просмотр, а не уводит со страницы
  if (fresh && !history.state?.viewer) history.pushState({ viewer: true }, "");
  wireComments(el, m);
  wireDoubleTap(el, m);
  if (fromEl && !dir && m.kind === "photo") flyIn(fromEl, el);

  // Свайпы на телефоне: влево — следующее, вправо — предыдущее, вниз — закрыть
  const media = el.querySelector(".media");
  let sx = 0, sy = 0;
  media.addEventListener("touchstart", e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  media.addEventListener("touchend", e => {
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      const next = dx < 0 ? list[idx + 1] : list[idx - 1];
      if (next) openViewer(next.id, dx < 0 ? 1 : -1);
    } else if (dy > 90 && Math.abs(dy) > Math.abs(dx)) closeViewer();
  });
}
// ---------- Просмотр фото на телефоне (как в Инстаграме) ----------
// Фото на весь экран листается пальцем, соседние выглядывают по краям. Сверху — кто загрузил и «3 / 24»,
// снизу — реакции и подпись, комментарии выезжают шторкой. Смахнуть вниз — закрыть, два касания — ❤️
// Ссылки на файлы фото и двух соседей с каждой стороны — чтобы листать без ожидания
const pvSign = (list, idx) => signed([-2, -1, 0, 1, 2].map(d => list[idx + d]).filter(Boolean).flatMap(x => [x.path, thumbPath(x), midPath(x)]));

// Части просмотра. При листании пересобираются только подписи вокруг, а сами фото остаются на месте —
// раньше пересоздавался весь просмотр, и экран мигал
function pvSlide(x, cur = false) {
  if (!x) return `<div class="pv-slide empty"></div>`;
  return `<div class="pv-slide${cur ? " media" : ""}" data-pv-id="${x.id}" style="background-image:url('${url(thumbPath(x))}')">${
    x.kind === "video" && cur
      ? `<video src="${url(x.path)}" poster="${url(thumbPath(x))}" data-vthumb="${x.id}" controls autoplay playsinline></video>`
      : x.kind === "video" ? `<img class="vthumb" ${url(thumbPath(x)) ? `src="${url(thumbPath(x))}"` : ""} data-vthumb="${x.id}" alt="" draggable="false"><span class="pv-play">▶</span>`
      : `<img class="fade" src="${url(midPath(x)) || url(x.path)}" alt="${esc(x.caption || "")}" draggable="false">`}</div>`;
}
function pvTop(m, list, idx) {
  return `<button type="button" class="pv-x" data-close aria-label="Закрыть">✕</button>
    <a class="pv-who" href="#/p/${m.owner}" style="${ucStyle(m.owner)}">${avatar(m.owner)}<b>${esc(nameOf(m.owner))}</b></a>
    <span class="pv-count">${idx + 1} / ${list.length}</span>
    <button type="button" class="pv-edit" data-edit-media="${m.id}" aria-label="${m.owner === me() ? "Изменить: кто на фото, подпись, дата" : "Отметить, кто на фото"}">${m.owner === me() ? "✎" : "👥"}</button>
    ${m.owner === me() ? `<button type="button" class="pv-del" data-del="${m.id}" aria-label="Удалить">Удалить</button>` : ""}`;
}
// Точки под фото: не больше семи, текущая — вытянутая розовая
function pvDots(list, idx) {
  if (list.length < 2) return "";
  const from = Math.max(0, Math.min(idx - 3, list.length - 7));
  return list.slice(from, from + 7).map((_, i) => `<i class="${from + i === idx ? "on" : ""}"></i>`).join("");
}
function pvInfo(m) {
  const cc = state.comments.filter(c => c.media_id === m.id).length;
  return `<div class="pv-acts">${reactButtons("m", m.id)}
      ${state.commentsReady ? `<button type="button" class="react pv-cbtn" data-pv-comments aria-label="Комментарии">💬<span class="c-count">${cc || ""}</span></button>` : ""}</div>
    ${m.caption ? `<p class="pv-cap">${esc(m.caption)}</p>` : ""}
    <p class="pv-meta">${dayText(m.taken_at || m.created_at)}${m.people.length ? ` · на фото ${m.people.map(p => `<a href="#/p/${p}">${esc(nameOf(p))}</a>`).join(", ")}` : ""}</p>`;
}
// Уже загруженные картинки показываем сразу, без проявления
const pvShowLoaded = root => root.querySelectorAll("img.fade").forEach(i => { if (i.complete && i.naturalWidth) i.classList.add("loaded", "now"); });

async function openPhoneViewer(list, idx, fromEl = null) {
  const m = list[idx];
  await pvSign(list, idx);
  const old = document.getElementById("viewer");
  const fresh = !old;
  old?.remove();
  state.viewing = m.id;

  const el = document.createElement("div");
  el.className = "viewer pv" + (fresh ? "" : " instant"); el.id = "viewer";
  el.innerHTML = `
    <div class="pv-top">${pvTop(m, list, idx)}</div>
    <div class="pv-stage"><div class="pv-track">${pvSlide(list[idx - 1])}${pvSlide(m, true)}${pvSlide(list[idx + 1])}</div></div>
    <div class="pv-dots">${pvDots(list, idx)}</div>
    <div class="pv-info">${pvInfo(m)}</div>
    <div class="pv-sheet-wrap" hidden><div class="pv-dim" data-pv-close-sheet></div>
      <div class="pv-sheet"><div class="pv-grab" data-pv-close-sheet></div><div class="pv-comments">${commentsBlock(m)}</div></div></div>`;
  document.body.appendChild(el);
  document.body.classList.add("viewer-open");
  pvShowLoaded(el);
  if (fresh && !history.state?.viewer) history.pushState({ viewer: true }, "");
  wireComments(el, m);
  wirePhoneViewer(el, list, idx);
  if (fromEl && m.kind === "photo") flyIn(fromEl, el);
}

function openPvSheet() {
  const w = document.querySelector(".viewer .pv-sheet-wrap"); if (!w) return false;
  w.hidden = false;
  void w.offsetWidth;   // сначала шторка появляется внизу, потом выезжает
  w.classList.add("open");
  return true;
}
function closePvSheet() {
  const w = document.querySelector(".viewer .pv-sheet-wrap"); if (!w || w.hidden) return;
  w.classList.remove("open");
  document.activeElement?.blur?.();
  setTimeout(() => { w.hidden = true; }, 280);
}
document.addEventListener("click", e => {
  if (e.target.closest("[data-pv-comments]")) openPvSheet();
  if (e.target.closest("[data-pv-close-sheet]")) closePvSheet();
});

function wirePhoneViewer(el, list, idx) {
  const stage = el.querySelector(".pv-stage"), track = el.querySelector(".pv-track");
  const has = d => !!list[idx + d];
  // Перешли к соседнему фото: сдвигаем ленту из трёх слайдов (лишний убираем, новый сосед добавляется с другого края)
  // и обновляем подписи. Сами картинки не пересоздаются, поэтому ничего не мигает
  const shift = async d => {
    const prevM = list[idx], nextM = list[idx + d];
    // С видео проще пересобрать просмотр целиком (у текущего видео — плеер, у соседа — значок ▶)
    if (prevM.kind === "video" || nextM.kind === "video") return openPhoneViewer(list, idx + d);
    idx += d;
    const m = list[idx];
    state.viewing = m.id;
    await pvSign(list, idx).catch(() => {});
    if (!document.body.contains(el)) return;
    if (d > 0) { track.firstElementChild.remove(); track.insertAdjacentHTML("beforeend", pvSlide(list[idx + 1])); }
    else { track.lastElementChild.remove(); track.insertAdjacentHTML("afterbegin", pvSlide(list[idx - 1])); }
    [...track.children].forEach((s, i) => s.classList.toggle("media", i === 1));
    pvShowLoaded(track);
    setX(0, false);
    el.querySelector(".pv-top").innerHTML = pvTop(m, list, idx);
    el.querySelector(".pv-dots").innerHTML = pvDots(list, idx);
    el.querySelector(".pv-info").innerHTML = pvInfo(m);
    el.querySelector(".pv-comments").innerHTML = commentsBlock(m);
    wireComments(el, m);
    busy = false;
  };
  let sx = 0, sy = 0, st = 0, dx = 0, dy = 0, axis = null, lastTap = 0, busy = false;
  const base = () => -(track.querySelector(".pv-slide").offsetWidth + 8);   // сдвиг, при котором по центру текущее фото
  const setX = (x, anim) => { track.style.transition = anim ? "transform .3s cubic-bezier(.2, .9, .25, 1)" : "none"; track.style.transform = `translateX(${base() + x}px)`; };
  const setY = (y, anim) => {
    const t = anim ? "transform .3s cubic-bezier(.2, .9, .25, 1), opacity .3s" : "none";
    stage.style.transition = t; stage.style.transform = y ? `translateY(${y}px) scale(${1 - Math.min(y, 400) / 1600})` : "";
    el.style.setProperty("--pv-fade", Math.max(0, 1 - y / 350));
  };
  setX(0, false);

  stage.addEventListener("touchstart", e => {
    if (busy || e.touches.length > 1) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now(); dx = dy = 0; axis = null;
  }, { passive: true });
  stage.addEventListener("touchmove", e => {
    if (busy || e.touches.length > 1) return;
    dx = e.touches[0].clientX - sx; dy = e.touches[0].clientY - sy;
    if (!axis && Math.hypot(dx, dy) > 8) axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    if (axis === "x") {
      // У края списка фото тянется туго — понятно, что дальше ничего нет
      const edge = (dx > 0 && !has(-1)) || (dx < 0 && !has(1));
      setX(edge ? dx * .3 : dx, false);
    } else if (axis === "y" && dy > 0) setY(dy, false);
  }, { passive: true });
  stage.addEventListener("touchend", e => {
    if (busy) return;
    const dt = Date.now() - st, w = stage.offsetWidth;
    if (axis === "x") {
      const d = dx < 0 ? 1 : -1, fast = Math.abs(dx) / dt > .5;
      if (has(d) && (Math.abs(dx) > w * .22 || fast)) {
        busy = true;
        // Новое фото разгорается до полной яркости, пока едет к центру, а старое тускнеет
        [...track.children].forEach((s, i) => s.classList.toggle("media", i === 1 + d));
        setX(-d * (track.querySelector(".pv-slide").offsetWidth + 8), true);
        setTimeout(() => shift(d), 300);
      } else setX(0, true);
    } else if (axis === "y") {
      if (dy > 110 || (dy > 40 && dy / dt > .6)) {
        busy = true;
        setY(innerHeight, true);
        setTimeout(() => closeViewer(), 260);
      } else setY(0, true);
    } else if (dt < 250) {
      // Касание без движения: два быстрых — ❤️ с большим сердцем
      const now = Date.now();
      if (now - lastTap < 300) {
        lastTap = 0;
        const cur = el.querySelector(".pv-slide.media"), heart = document.createElement("span");
        heart.className = "big-heart"; heart.textContent = "❤️";
        cur.appendChild(heart); setTimeout(() => heart.remove(), 1000);
        const btn = el.querySelector('.pv-acts [data-react="m"][data-emoji="heart"]');
        if (btn && btn.getAttribute("aria-pressed") !== "true") toggleReact(btn);
      } else lastTap = now;
    }
  });
}

// Фото вылетает из плитки и плавно вырастает до полного размера.
// Летит копия уже загруженной маленькой картинки; настоящее фото показывается, когда она долетела и само загрузилось
function flyIn(src, viewer) {
  const media = viewer.querySelector(".media"), img = media?.querySelector("img");
  const s = src.getBoundingClientRect();
  if (!img || !s.width || !src.naturalWidth || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const pad = parseFloat(getComputedStyle(media).paddingLeft) || 0, mb = media.getBoundingClientRect();
  const a = src.naturalWidth / src.naturalHeight;
  const mh = getComputedStyle(img).maxHeight, maxH = mh.endsWith("px") ? parseFloat(mh) : innerHeight;
  // Фото встаёт по центру своей области (тот же расчёт, что делает CSS: не шире области и не выше max-height)
  const boxH = Math.min(maxH, mb.height - pad * 2);
  const w = Math.min(mb.width - pad * 2, boxH * a), h = w / a;
  const top = mb.top + (mb.height - h) / 2, left = mb.left + (mb.width - w) / 2;
  const ghost = document.createElement("img");
  ghost.className = "fly-ghost"; ghost.src = src.currentSrc || src.src; ghost.alt = "";
  viewer.appendChild(ghost);
  media.classList.add("flying");
  const anim = ghost.animate([
    { left: s.left + "px", top: s.top + "px", width: s.width + "px", height: s.height + "px", borderRadius: "6px" },
    { left: left + "px", top: top + "px", width: w + "px", height: h + "px", borderRadius: "8px" }
  ], { duration: 380, easing: "cubic-bezier(.2, .9, .25, 1)", fill: "forwards" });
  let shown = false;
  const reveal = () => {
    if (shown) return; shown = true;
    media.classList.remove("flying");
    ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: "forwards" }).onfinish = () => ghost.remove();
    setTimeout(() => ghost.remove(), 400);   // на случай, если анимация замерла (приложение свернули)
  };
  const whenLoaded = () => { if (img.complete && img.naturalWidth) reveal(); else { img.onload = reveal; img.onerror = reveal; } };
  anim.onfinish = whenLoaded;
  setTimeout(whenLoaded, 600);   // запасной путь: фото не должно остаться спрятанным, даже если полёт не доиграл
}

// ---------- Изменить своё фото: кто на нём, подпись, дата ----------
// Открывается кнопкой ✎ (своё фото) или 👥 (чужое) у поста и в просмотре.
// Отмечать людей может любой корефан (14_tags_everyone.sql), подпись и дату — только тот, кто загрузил
function openMediaEditor(id) {
  const m = state.media.find(x => x.id === id); if (!m) return;
  const own = m.owner === me(), what = m.kind === "video" ? "видео" : "фото";
  document.querySelector(".me-wrap")?.remove();
  const w = document.createElement("div");
  w.className = "me-wrap";
  w.innerHTML = `<div class="pv-dim" data-me-close></div>
    <form class="me-sheet" id="mediaEdit">
      <div class="pv-grab" data-me-close></div>
      <h2>${own ? `Изменить ${what}` : `Кто на ${what}?`}</h2>
      <label>${own ? `Кто на ${what}` : `Отметь всех, кого узнаёшь. ${what === "фото" ? "Фото" : "Видео"} появится у них на страничке`}
        <div class="chips">${state.profiles.map(p =>
          `<button type="button" class="chip" data-et="${p.id}" aria-pressed="${m.people.includes(p.id)}">${avatar(p.id)}${esc(p.name)}</button>`).join("")}</div>
      </label>
      ${own ? `<label>Подпись<textarea id="eCap" maxlength="500" placeholder="Что тут происходит?">${esc(m.caption || "")}</textarea></label>
      <label>Когда это было<input type="date" id="eDate" value="${m.taken_at || ""}"></label>` : ""}
      <div class="row"><button type="submit" class="btn primary">Сохранить</button><button type="button" class="btn" data-me-close>Отмена</button><p class="msg" id="eMsg"></p></div>
    </form>`;
  document.body.appendChild(w);
  void w.offsetWidth; w.classList.add("open");
  if (own) autoGrow(w.querySelector("#eCap"));
  const close = () => { w.classList.remove("open"); setTimeout(() => w.remove(), 280); };
  w.querySelectorAll("[data-me-close]").forEach(b => b.onclick = close);
  w.querySelectorAll("[data-et]").forEach(b => b.onclick = () => b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") !== "true"));
  w.querySelector("#mediaEdit").onsubmit = async e => {
    e.preventDefault();
    const btn = w.querySelector('button[type="submit"]'), msg = w.querySelector("#eMsg");
    if (btn.disabled) return;
    btn.disabled = true; msg.className = "msg"; msg.textContent = "Сохраняю...";
    const people = [...w.querySelectorAll('[data-et][aria-pressed="true"]')].map(b => b.dataset.et);
    // Подпись и дату меняет только владелец; у чужого фото оставляем как было
    const caption = own ? w.querySelector("#eCap").value.trim() || null : m.caption || null;
    const taken_at = own ? w.querySelector("#eDate").value || null : m.taken_at || null;
    const add = people.filter(p => !m.people.includes(p)), rem = m.people.filter(p => !people.includes(p));
    const results = await Promise.all([
      rem.length ? sb.from("media_people").delete().eq("media_id", m.id).in("person_id", rem) : { error: null },
      add.length ? sb.from("media_people").insert(add.map(person_id => ({ media_id: m.id, person_id }))) : { error: null },
      caption !== (m.caption || null) || taken_at !== (m.taken_at || null)
        ? sb.from("media").update({ caption, taken_at }).eq("id", m.id) : { error: null }
    ]);
    const [rDel, rAdd, rUpd] = results;
    // Что получилось — то и запоминаем, даже если часть не сохранилась
    if (!rDel.error) m.people = m.people.filter(p => !rem.includes(p));
    if (!rAdd.error) m.people = [...m.people, ...add.filter(p => !m.people.includes(p))];
    if (!rUpd.error) { m.caption = caption; m.taken_at = taken_at; }
    refreshMediaEverywhere(m);
    if (results.some(r => r.error)) {
      btn.disabled = false; msg.className = "msg err";
      // Чужое фото, а база ещё не разрешает отмечать всем — значит, не выполнен SQL
      msg.textContent = !own ? "Не сохранилось. Если ошибка повторяется — нужно выполнить 14_tags_everyone.sql в Supabase." : "Сохранилось не всё. Попробуй ещё раз.";
      return;
    }
    saveCache();
    close();
    toast("Сохранено");
  };
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-edit-media]");
  if (b) { e.preventDefault(); openMediaEditor(b.dataset.editMedia); }
});

// Фото изменили — перерисовываем его везде, где оно сейчас на экране: пост в ленте и открытый просмотр
function refreshMediaEverywhere(m) {
  const post = document.querySelector(`[data-post="${m.id}"]`);
  if (post) { post.outerHTML = postHtml(m); pvShowLoaded(document.querySelector(`[data-post="${m.id}"]`)); if (feedKeeper) keepNear(document.getElementById("feed") || document); }
  if (state.viewing !== m.id) return;
  const pvInfoEl = document.querySelector(".viewer.pv .pv-info");
  if (pvInfoEl) pvInfoEl.innerHTML = pvInfo(m);
  else if (document.querySelector(".viewer")) openViewer(m.id);   // на компьютере просто перерисовываем просмотр
}

// silent: закрыть без шага «назад» в истории (когда уходим по ссылке или уже нажали «Назад»)
function closeViewer(silent = false) {
  const el = document.getElementById("viewer");
  document.querySelector(".me-wrap")?.remove();   // окно «Изменить фото» закрывается вместе с просмотром
  if (!el) return;
  el.remove();
  state.viewing = null;
  document.body.classList.remove("viewer-open");
  if (!silent && history.state?.viewer) history.back();
}
window.addEventListener("popstate", () => { if (document.getElementById("viewer")) closeViewer(true); });

// Двойное касание по фото — ❤️, как в Инстаграме, с большим сердцем
function wireDoubleTap(el, m) {
  const media = el.querySelector(".media");
  let lastTap = 0, tx = 0, ty = 0;
  const like = () => {
    const heart = document.createElement("span");
    heart.className = "big-heart"; heart.textContent = "❤️";
    media.appendChild(heart);
    setTimeout(() => heart.remove(), 1000);
    const btn = el.querySelector('[data-react="m"][data-emoji="heart"]');
    if (btn && btn.getAttribute("aria-pressed") !== "true") toggleReact(btn);
  };
  media.addEventListener("dblclick", e => { if (e.target.tagName !== "VIDEO") like(); });
  media.addEventListener("touchend", e => {
    if (e.target.tagName === "VIDEO") return;
    const t = e.changedTouches[0], now = Date.now();
    if (now - lastTap < 300 && Math.abs(t.clientX - tx) < 30 && Math.abs(t.clientY - ty) < 30) { e.preventDefault(); like(); lastTap = 0; }
    else { lastTap = now; tx = t.clientX; ty = t.clientY; }
  });
}

// Эмодзи вылетает из кнопки реакции
function burst(btn, emoji) {
  const r = btn.getBoundingClientRect();
  for (let i = 0; i < 5; i++) {
    const s = document.createElement("span");
    s.className = "float-emoji"; s.textContent = emoji;
    s.style.left = r.left + r.width / 2 + "px"; s.style.top = r.top + "px";
    s.style.setProperty("--dx", (Math.random() * 60 - 30).toFixed(0) + "px");
    s.style.animationDelay = i * 60 + "ms";
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 1200);
  }
}

// ---------- Комментарии ----------

// «только что», «5 мин назад», «3 ч назад»...
function ago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "только что";
  if (s < 3600) return `${Math.floor(s / 60)} мин назад`;
  if (s < 86400) return `${Math.floor(s / 3600)} ч назад`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} дн назад`;
  return dayText(iso);
}

const SEND_ICON = `<svg viewBox="0 0 24 24"><path d="M4 12l16-8-6 16-2.5-6.5z"/><path d="M11.5 13.5L20 4"/></svg>`;

function commentHtml(c, m, i = 0, isNew = false) {
  const canDelete = c.author === me();   // удалить может только автор
  return `<div class="c-item${c.author === me() ? " mine" : ""}${isNew ? " new" : ""}" data-cid="${c.id}" style="--i:${Math.min(i, 15)}">
    <a href="#/p/${c.author}">${avatar(c.author)}</a>
    <div class="c-bubble">
      <div class="c-head"><b>${esc(nameOf(c.author))}</b><span>${ago(c.created_at)}</span>
        ${canDelete ? `<button type="button" class="link-btn" data-delc="${c.id}">удалить</button>` : ""}</div>
      <p class="c-text">${esc(c.text)}</p>
    </div>
  </div>`;
}

function commentsBlock(m) {
  if (!state.commentsReady) return "";
  const list = state.comments.filter(c => c.media_id === m.id);
  return `<section class="comments">
    <h2>Комментарии <span class="c-count">${list.length || ""}</span></h2>
    <div class="c-list">${list.length ? list.map((c, i) => commentHtml(c, m, i)).join("")
      : `<p class="c-empty">Пока тихо. Напиши первым!</p>`}</div>
    <form class="c-form">
      <div class="pill"><textarea rows="1" maxlength="500" placeholder="Написать комментарий..." aria-label="Комментарий"></textarea></div>
      <button type="submit" class="c-send" aria-label="Отправить" disabled>${SEND_ICON}</button>
    </form>
  </section>`;
}

function wireComments(el, m) {
  const form = el.querySelector(".c-form"); if (!form) return;
  const ta = form.querySelector("textarea"), send = form.querySelector(".c-send");
  const listEl = el.querySelector(".c-list");
  // Поле растёт вместе с текстом
  ta.oninput = () => { autoGrow(ta); send.disabled = !ta.value.trim(); };
  // Enter отправляет, Shift+Enter — новая строка. На телефоне Enter — просто новая строка, отправка кнопкой
  ta.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey && !matchMedia("(pointer: coarse)").matches) { e.preventDefault(); submit(); } };
  form.onsubmit = e => { e.preventDefault(); submit(); };
  const submit = async () => {
    const text = ta.value.trim(); if (!text || send.classList.contains("flying")) return;
    send.disabled = true; send.classList.add("flying");
    const { data, error } = await sb.from("comments").insert({ media_id: m.id, text }).select().single();
    send.classList.remove("flying");
    if (error) { send.disabled = false; ta.placeholder = "Не отправилось, попробуй ещё раз"; return; }
    ta.value = ""; ta.oninput();
    // Живое обновление могло уже показать этот комментарий раньше ответа сервера
    if (state.comments.some(c => c.id === data.id)) return;
    state.comments.push(data);
    listEl.querySelector(".c-empty")?.remove();
    listEl.insertAdjacentHTML("beforeend", commentHtml(data, m, 0, true));
    paintCommentCount(m.id);
    listEl.lastElementChild.scrollIntoView({ behavior: "smooth", block: "nearest" });
    refreshPost(m.id);
  };
}

async function deleteComment(btn) {
  if (btn.textContent !== "точно?") { btn.textContent = "точно?"; return; }
  btn.disabled = true;
  const id = btn.dataset.delc;
  const { error } = await sb.from("comments").delete().eq("id", id);
  if (error) { btn.textContent = "не вышло"; return; }
  const c = state.comments.find(x => x.id === id);
  state.comments = state.comments.filter(x => x.id !== id);
  const item = btn.closest(".c-item");
  item.classList.add("bye");
  setTimeout(() => item.remove(), 280);
  if (c) { paintCommentCount(c.media_id); refreshPost(c.media_id); }
}

document.addEventListener("click", async e => {
  const react = e.target.closest("[data-react]"); if (react) return toggleReact(react);
  const delc = e.target.closest("[data-delc]"); if (delc) return deleteComment(delc);
  const pm = e.target.closest("[data-post-media]"); if (pm) return postMediaClick(pm, e);
  // Галерея: фильтр по корефану (ссылка «Профиль →» внутри постера работает как обычная ссылка)
  const gf = e.target.closest("[data-gfilter]");
  if (gf && !e.target.closest("a")) { state.galleryFilter = state.galleryFilter === gf.dataset.gfilter ? null : gf.dataset.gfilter; return renderGallery(); }
  if (e.target.closest("[data-gfilter-reset]")) { state.galleryFilter = null; return renderGallery(); }
  const pc = e.target.closest("[data-post-comment]");
  if (pc) {   // «Написать комментарий» или «Все комментарии» — открываем фото и сразу ставим курсор в поле
    await openViewer(pc.dataset.postComment);
    // На телефоне комментарии в шторке — сначала открываем её
    if (openPvSheet()) setTimeout(() => document.querySelector(".viewer .c-form textarea")?.focus(), 320);
    else document.querySelector(".viewer .c-form textarea")?.focus();
    return;
  }
  const open = e.target.closest("[data-open]"); if (open) return openViewer(open.dataset.open, 0, open.querySelector("img"));
  const go = e.target.closest("[data-go]"); if (go) return openViewer(go.dataset.go, Number(go.dataset.dir || 0));
  if (e.target.closest("[data-close]")) return closeViewer();
  if (e.target.closest(".viewer a")) return closeViewer(true);   // ссылка сама откроет новую страницу
  const delq = e.target.closest("[data-delq]");
  if (delq) {
    if (delq.textContent !== "точно удалить?") { delq.textContent = "точно удалить?"; return; }
    delq.disabled = true;
    const { error } = await sb.from("quotes").delete().eq("id", delq.dataset.delq);
    if (error) { delq.disabled = false; delq.textContent = "не вышло, ещё раз?"; return; }
    await loadAll(); route();
    return;
  }
  const del = e.target.closest("[data-del]");
  if (del) {
    // Удаление в два нажатия, чтобы не стереть случайно
    if (del.textContent !== "Точно удалить?") { del.textContent = "Точно удалить?"; return; }
    const m = state.media.find(x => x.id === del.dataset.del);
    del.disabled = true;
    // Сначала запись в базе, потом файлы: если удаление не прошло, пост не останется без картинки
    const { error } = await sb.from("media").delete().eq("id", m.id);
    if (error) { del.disabled = false; del.textContent = "Не удалилось, ещё раз?"; return; }
    await removeFiles(BUCKET, [m.path, thumbPath(m), midPath(m)].filter(Boolean));
    closeViewer(); await loadAll(); route();
  }
});
document.addEventListener("keydown", e => {
  // Постер-фильтр в галерее выбирается и с клавиатуры
  if ((e.key === "Enter" || e.key === " ") && e.target.matches?.("[data-gfilter]")) { e.preventDefault(); e.target.click(); return; }
  // Открыто окно «Изменить фото» — Esc закрывает только его, а не просмотр под ним
  if (e.key === "Escape" && document.querySelector(".gs-wrap")) { closeGallerySheet(); return; }
  const editor = document.querySelector(".me-wrap");
  if (e.key === "Escape" && editor) { editor.classList.remove("open"); setTimeout(() => editor.remove(), 280); return; }
  if (!document.getElementById("viewer")) return;
  if (e.target.closest?.("textarea, input")) return;   // пишут комментарий — стрелки не листают
  if (e.key === "Escape") closeViewer();
  if (e.key === "ArrowLeft") document.querySelector(".viewer .prev")?.click();
  if (e.key === "ArrowRight") document.querySelector(".viewer .next")?.click();
});

// ---------- Загрузка файла ----------

async function uploadOne(file, { tags, caption, takenAt }) {
  const id = crypto.randomUUID();
  const isVideo = file.type.startsWith("video/");
  let main, thumb, mid = null, ext;

  if (isVideo) {
    if (file.size > KOREFANY.maxVideoMb * 1024 * 1024) throw new Error(`видео больше ${KOREFANY.maxVideoMb} МБ`);
    main = file;
    ext = (file.name.split(".").pop() || "mp4").toLowerCase();
    thumb = await videoThumb(file);
  } else {
    const img = await decodeImage(file);
    [main, mid, thumb] = await Promise.all([scaleTo(img, 2560, 0.85), scaleTo(img, 1280, 0.82), scaleTo(img, 640, 0.8)]);   // mid — для ленты
    img.close?.();   // открытое фото держит много памяти — на iPhone при загрузке пачки это важно
    if (!main) throw new Error("не получилось сжать фото");
    ext = "jpg";
  }

  const path = `${me()}/${id}.${ext}`;
  await putFile(BUCKET, path, main, isVideo ? file.type : "image/jpeg");
  // Превью и средний размер не обязательны: без них сайт покажет оригинал
  await Promise.all([
    thumb && putFile(BUCKET, `${me()}/${id}_t.jpg`, thumb, "image/jpeg").catch(() => {}),
    mid && putFile(BUCKET, `${me()}/${id}_m.jpg`, mid, "image/jpeg").catch(() => {})
  ]);

  let r = await sb.from("media").insert({ id, path, kind: isVideo ? "video" : "photo", caption: caption || null, taken_at: takenAt });
  if (r.error) throw r.error;
  if (tags.length) {
    r = await sb.from("media_people").insert(tags.map(person_id => ({ media_id: id, person_id })));
    if (r.error) throw r.error;
  }
}

// Открыть любую картинку: JPG, PNG, WebP, GIF, AVIF, BMP, HEIC с айфона.
// Пробуем по очереди: быстрый способ браузера, обычную картинку, а для HEIC — конвертер.
const isHeic = f => /image\/hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name || "");

async function decodeImage(file) {
  try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch (e) {}
  try { return await createImageBitmap(file); } catch (e) {}
  try { return await loadImg(file); } catch (e) {}
  if (isHeic(file)) {
    // Конвертер HEIC лежит на сайте и грузится только когда нужен (он большой)
    await loadScript("vendor/heic2any.min.js");
    const out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
    return decodeImage(Array.isArray(out) ? out[0] : out);
  }
  throw new Error("этот формат не открывается. Подойдут JPG, PNG, WebP, GIF или HEIC");
}

function loadImg(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image(), src = URL.createObjectURL(blob);
    img.onload = () => { URL.revokeObjectURL(src); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(src); reject(new Error("не картинка")); };
    img.src = src;
  });
}

const loadedScripts = {};
function loadScript(src) {
  return loadedScripts[src] || (loadedScripts[src] = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error("не загрузился конвертер HEIC"));
    document.head.appendChild(s);
  }));
}

// Холст с тёмным фоном: у прозрачных PNG вместо дыр будет фон сайта, а не чёрный
function darkCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#15111f"; ctx.fillRect(0, 0, w, h);
  return [c, ctx];
}
const sizeOf = img => [img.naturalWidth || img.width, img.naturalHeight || img.height];

// Уменьшаем фото, чтобы экономить место. Поворот с телефона учитывается.
async function resizeImage(file, maxSide, quality) {
  return scaleTo(await decodeImage(file), maxSide, quality);
}
// Уменьшить уже открытую картинку. Нужна, чтобы при загрузке открывать фото один раз, а не трижды (HEIC открывается долго)
function scaleTo(img, maxSide, quality) {
  const [w, h] = sizeOf(img);
  const k = Math.min(1, maxSide / Math.max(w, h));
  const [c, ctx] = darkCanvas(Math.round(w * k), Math.round(h * k));
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(res, "image/jpeg", quality));
}

// Квадрат из центра фото для аватарки
async function cropSquare(file, size) {
  const img = await decodeImage(file);
  const [w, h] = sizeOf(img);
  const s = Math.min(w, h);
  const [c, ctx] = darkCanvas(size, size);
  ctx.drawImage(img, (w - s) / 2, (h - s) / 2, s, s, 0, 0, size, size);
  return new Promise(res => c.toBlob(res, "image/jpeg", 0.88));
}

// Почти чёрная картинка? (средняя яркость мала и нет ни одной светлой точки)
// iPhone иногда отдаёт кадр, который ещё не успел отрисоваться, — получается чёрный прямоугольник вместо превью
function isBlackCanvas(src, w, h) {
  try {
    const c = document.createElement("canvas"); c.width = 24; c.height = 24;
    const g = c.getContext("2d"); g.drawImage(src, 0, 0, w || src.width, h || src.height, 0, 0, 24, 24);
    const d = g.getImageData(0, 0, 24, 24).data;
    let sum = 0, max = 0;
    for (let i = 0; i < d.length; i += 4) { const l = (d[i] * 2 + d[i + 1] * 3 + d[i + 2]) / 6; sum += l; if (l > max) max = l; }
    return sum / (d.length / 4) < 14 && max < 45;
  } catch (e) { return false; }   // не смогли прочитать — считаем, что всё нормально
}

// Кадр из видео для превью (на 1-й секунде или в середине короткого видео).
// iPhone не грузит видео, которого нет на странице, — поэтому вставляем его невидимым и «включаем» без звука.
// Если кадр вышел чёрным (не успел отрисоваться или видео начинается с темноты) — пробуем чуть дальше, до 4 раз.
// source — файл (при загрузке) или ссылка. Не получилось — null
function videoThumb(source) {
  return new Promise(resolve => {
    const v = document.createElement("video");
    const isFile = source instanceof Blob;
    const src = isFile ? URL.createObjectURL(source) : source;
    let finished = false, tries = 0;
    const done = blob => {
      if (finished) return; finished = true;
      clearTimeout(timer); v.pause(); v.removeAttribute("src"); v.load(); v.remove();
      if (isFile) URL.revokeObjectURL(src);
      resolve(blob);
    };
    const timer = setTimeout(() => done(null), 20000);
    v.muted = true; v.defaultMuted = true; v.playsInline = true; v.setAttribute("playsinline", ""); v.preload = "auto";
    if (!isFile) v.crossOrigin = "anonymous";   // чужой адрес: без этого кадр нельзя сохранить в картинку
    v.style.cssText = "position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none";
    document.body.appendChild(v);
    const len = () => (isFinite(v.duration) && v.duration > 0 ? v.duration : 3);
    const grab = () => {
      if (finished || !v.videoWidth) return;
      try {
        const k = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
        const c = document.createElement("canvas");
        c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k);
        c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
        if (isBlackCanvas(c) && ++tries < 4) {
          // Чёрный кадр — ещё раз чуть дальше по видео
          try { v.currentTime = Math.min(len() - 0.05, v.currentTime + Math.max(0.4, len() / 5)); } catch (e) { done(null); }
          return;
        }
        if (isBlackCanvas(c)) return done(null);   // так и не получилось — пусть лучше будет заглушка, чем чёрный квадрат
        c.toBlob(b => done(b), "image/jpeg", 0.8);
      } catch (e) { done(null); }
    };
    v.onloadedmetadata = () => {
      // Safari рисует кадр только после того, как видео хоть раз «поиграло» — коротко включаем и сразу ставим на паузу
      const p = v.play(); if (p) p.then(() => v.pause()).catch(() => {});
      try { v.currentTime = Math.min(1, len() / 3); } catch (e) {}
    };
    v.onseeked = () => setTimeout(grab, 150);
    v.onerror = () => done(null);
    v.src = src;
    v.load();
  });
}

// ---------- Починка превью видео ----------
// У видео, загруженных с iPhone до починки, превью либо нет, либо оно чёрное.
// Сайт проверяет превью каждого видео на экране: нет или чёрное — делает кадр сам, на этом устройстве,
// и сразу подставляет. Если видео твоё — заодно сохраняет новое превью в хранилище, чтобы у всех было нормально
const vthumbLocal = {};   // id видео → готовое превью (blob-ссылка), чтобы не делать дважды
let vthumbQueue = Promise.resolve();
const vthumbQueued = new Set();
const vthumbFixedKey = "korefany-vthumb-fixed";
const vthumbFixed = (() => { try { return new Set(JSON.parse(localStorage.getItem(vthumbFixedKey) || "[]")); } catch (e) { return new Set(); } })();

function applyVthumb(el, u) {
  if (el.tagName === "VIDEO") el.poster = u;
  else { el.src = u; el.classList.add("loaded"); el.closest(".tile, .pv-slide")?.classList.add("has-vthumb"); }
}

function queueVthumb(m, replace) {
  if (vthumbQueued.has(m.id)) return;
  vthumbQueued.add(m.id);
  vthumbQueue = vthumbQueue.then(async () => {
    await signed([m.path]);
    const blob = await videoThumb(url(m.path));
    if (!blob) return;
    const u = vthumbLocal[m.id] = URL.createObjectURL(blob);
    document.querySelectorAll(`[data-vthumb="${m.id}"]`).forEach(el => applyVthumb(el, u));
    // Своё видео — сохраняем новое превью для всех (один раз на устройство)
    if (m.owner !== me() || vthumbFixed.has(m.id)) return;
    const tp = thumbPath(m);
    // Новый файл просто ложится поверх старого
    try { await putFile(BUCKET, tp, blob, "image/jpeg"); } catch (e) { return; }
    vthumbFixed.add(m.id);
    try { localStorage.setItem(vthumbFixedKey, JSON.stringify([...vthumbFixed])); } catch (e) {}
    delete state.urls[tp];
    // В памяти телефона (sw.js) лежит старое чёрное превью — убираем, чтобы взялось новое
    try { (await caches.open("korefany-pics-v1")).delete(`https://pics.korefany/${BUCKET}/${tp}`); } catch (e) {}
  }).catch(() => {});
}

function fixVideoThumbs() {
  document.querySelectorAll("[data-vthumb]:not([data-vchecked])").forEach(el => {
    el.dataset.vchecked = "1";
    const id = el.dataset.vthumb, m = state.media.find(x => x.id === id); if (!m) return;
    if (vthumbLocal[id]) return applyVthumb(el, vthumbLocal[id]);
    const t = url(thumbPath(m));
    if (!t) return queueVthumb(m, false);
    // Превью есть — проверяем, не чёрное ли оно (отдельная загрузка с разрешением на чтение пикселей)
    const probe = new Image();
    probe.crossOrigin = "anonymous";
    probe.onload = () => { if (isBlackCanvas(probe, probe.naturalWidth, probe.naturalHeight)) queueVthumb(m, true); };
    probe.onerror = () => queueVthumb(m, false);
    probe.src = t;
  });
}
// Видео появляются на странице в разных местах (лента, галерея, профиль, просмотр) — следим за всеми
let vthumbTimer = null;
new MutationObserver(() => { clearTimeout(vthumbTimer); vthumbTimer = setTimeout(fixVideoThumbs, 400); })
  .observe(document.body, { childList: true, subtree: true });

// ---------- Переключение страниц ----------

// Номер текущего перехода. Если быстро тыкать по меню, медленная старая страница
// может догрузиться позже новой — по номеру понимаем, что её показывать уже не надо
let routeSeq = 0;

async function route() {
  if (!state.session) return viewLogin();
  const seq = ++routeSeq;
  closeViewer(true);
  document.querySelector(".gs-wrap")?.remove();   // шторка «Фильтр и порядок» галереи
  clearInterval(coverTimer);   // ушли с ленты — обложка больше не листается
  feedObserver?.disconnect();  // и посты больше не подгружаем
  feedKeeper?.disconnect(); feedKeeper = null;
  // Ссылки на аватарки и обложки живут час: если сайт открыт давно, тихо берём свежие
  await signed(state.profiles.flatMap(x => [x.avatar_path, x.cover_path]).filter(Boolean));
  if (typeof chatLeave === "function") chatLeave();   // вышли из переписки — меню снова видно
  const h = location.hash.replace(/^#/, "") || "/";
  try {
    if (h === "/") await viewFeed();
    else if (h === "/people") await viewPeople();
    else if (h.startsWith("/p/")) await viewPerson(h.slice(3));
    else if (h === "/quotes") viewQuotes();
    else if (h === "/chats") await viewChats();
    else if (h.startsWith("/chat/")) await viewChat(h.slice(6));
    else if (h === "/top") await viewTop();
    else if (h === "/money") await viewMoney();
    else if (h.startsWith("/money/")) await viewMoneyTrip(h.slice(7));
    else if (h === "/upload") viewUpload();
    else if (h === "/me") await viewMe();
    else location.hash = "#/";
  } catch (err) {
    if (seq === routeSeq) $app.innerHTML = `<p class="loading">Что-то сломалось: ${esc(err.message || err)}. Обнови страницу.</p>`;
  }
  if (seq === routeSeq) window.scrollTo(0, 0);
}

// Подходит ли страница к текущему адресу (для защиты от устаревших переходов в shell)
const PAGE_OF = { feed: ["/"], people: ["/people", "/p/"], chats: ["/chats", "/chat/"], quotes: ["/quotes"], top: ["/top"], money: ["/money"], "": ["/me", "/upload"] };
function pageMatches(active) {
  const h = location.hash.replace(/^#/, "") || "/";
  const list = PAGE_OF[active]; if (!list) return true;
  return list.some(x => x === "/" ? h === "/" : h === x || h.startsWith(x));
}
window.addEventListener("hashchange", route);

// Проверяем, открывается ли Supabase напрямую. Если провайдер его режет,
// работаем через посредника (на Netlify — файл _redirects, на Cloudflare — Worker из config.js).
// Выбор запоминается: если в прошлый раз Supabase напрямую не открывался, сразу идём через посредника
// и не ждём по 5 секунд при каждом запуске. Напрямую перепроверяем раз в сутки
async function pickServer() {
  if (!KOREFANY.proxyUrl) return KOREFANY.url;   // посредника нет — сразу напрямую
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem("korefany-server") || "null"); } catch (e) {}
  // Посредника перепроверяем через 20 минут: чаще всего это был короткий сбой Supabase или интернета,
  // а в запасном режиме сообщения приходят с задержкой
  const fresh = saved && Date.now() - saved.at < (saved.proxy ? 20 * 60e3 : 864e5);
  if (fresh && saved.proxy) return KOREFANY.proxyUrl;
  // Вчера напрямую работало — стартуем напрямую сразу, а проверяем в фоне.
  // Если вдруг перестало, запоминаем посредника и перезапускаем сайт уже через него
  if (fresh) {
    directWorks().then(ok => { if (!ok && navigator.onLine) location.reload(); });
    return KOREFANY.url;
  }
  return (await directWorks()) ? KOREFANY.url : KOREFANY.proxyUrl;
}
async function directWorks() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  let ok = false;
  try {
    const r = await fetch(KOREFANY.url + "/auth/v1/health", { headers: { apikey: KOREFANY.key }, signal: ctrl.signal });
    ok = r.ok;
  } catch (e) {}
  finally { clearTimeout(t); }
  // Без интернета вообще ничего не запоминаем — это не блокировка
  if (ok || navigator.onLine) try { localStorage.setItem("korefany-server", JSON.stringify({ proxy: !ok, at: Date.now() })); } catch (e) {}
  return ok;
}

async function start() {
  const server = await pickServer();
  state.direct = server === KOREFANY.url;
  sb = supabase.createClient(server, KOREFANY.key, {
    auth: {
      // Один и тот же ключ входа при любом пути, чтобы не разлогинивало при переключении
      storageKey: "sb-jvyitolecgbldlxypwcz-auth-token",
      persistSession: true,      // вход хранится в браузере, после закрытия вкладки не слетает
      autoRefreshToken: true,    // вход сам продлевается, пока сайт открыт
      detectSessionInUrl: false
    }
  });
  listenAuth();
}

// Supabase не любит, когда внутри этого обработчика сразу ждут другие запросы,
// поэтому сама загрузка запускается следующим шагом через setTimeout
function listenAuth() { sb.auth.onAuthStateChange((event, session) => {
  const was = state.session?.user?.id;
  state.session = session;
  // Вход продлился (новый ключ) — отдаём его и отдельному живому каналу, иначе он отвалится через час
  if (liveSb && session) liveSb.realtime.setAuth(session.access_token);
  setTimeout(async () => {
    if (!session) {
      // Вышли (или вход истёк) — закрываем всё открытое, иначе экран входа остался бы с классами переписки
      stopLive(); closeViewer(true); if (typeof chatLeave === "function") chatLeave();
      state.profiles = []; state.media = []; state.meTab = "profile";
      history.replaceState(null, "", "#/");   // после нового входа — сразу лента
      return viewLogin();
    }
    if (was !== session.user.id) {
      // Уже заходил с этого устройства — показываем сохранённое сразу, свежее догрузится в фоне
      const cached = readCache();
      if (cached) {
        route();
        startLive();
        syncPush();
        refreshInBackground(cached);
        return;
      }
      // Мерцающие заготовки ленты, пока грузятся данные (такие же стоят в index.html)
      const heights = [180, 240, 150, 210, 230, 160, 200, 170];
      $app.innerHTML = `<div class="loading skeleton" aria-label="Загружаю"><div class="sk-top"></div><div class="sk-body">
        <div class="sk sk-cover"></div>
        <div class="sk-grid">${heights.map(h => `<div class="sk" style="height:${h}px"></div>`).join("")}</div>
      </div></div>`;
      // Если сервер молчит 20 секунд, не крутим загрузку вечно, а говорим, что делать
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 20000));
      try {
        // Лента и мессенджер грузятся одновременно; мессенджер не мешает остальному сайту
        const chats = loadChats().catch(() => { chat.ready = false; });
        await Promise.race([loadAll(), timeout]);
        await chats;
        saveCache();
      }
      catch (err) {
        $app.innerHTML = err.message === "timeout"
          ? `<div class="loading"><p><b>Сервер не отвечает.</b></p><p>Переключись с мобильного интернета на Wi‑Fi или включи VPN, потом обнови страницу.</p></div>`
          : `<p class="loading">Не получилось загрузить: ${esc(err.message)}</p>`;
        return;
      }
      route();
      startLive();
      syncPush();
    }
  }, 0);
}); }

// ---------- Живые обновления ----------
// Если Supabase открывается напрямую, изменения прилетают сразу (Realtime).
// Если нет (работаем через обход), сайт сам проверяет новое каждые 15 секунд.

let liveChannel = null, pollTimer = null, liveSb = null;

// Клиент для живого канала. Обычно это тот же sb. Но если обычные запросы идут через посредника (Netlify),
// живой канал всё равно пробуем открыть напрямую: посредник его не пропускает, а напрямую он часто работает
// (например, когда Supabase просто моргнул при запуске). Без живого канала нет «печатает» и «в сети»
function liveClient() {
  if (state.direct) return sb;
  if (!liveSb) {
    liveSb = supabase.createClient(KOREFANY.url, KOREFANY.key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "korefany-live-auth" }
    });
    // У этого клиента своего входа нет, и при запуске он сбросил бы ключ канала на анонимный — возвращаем наш
    liveSb.auth.onAuthStateChange(() => setTimeout(() => liveSb.realtime.setAuth(state.session?.access_token), 0));
  }
  liveSb.realtime.setAuth(state.session?.access_token);   // канал видит то же, что и я (правила доступа)
  return liveSb;
}

function startLive() {
  if (liveChannel) return;
  const cl = liveClient();
  // Пока канал не поднялся — на всякий случай проверяем новое раз в 15 секунд (в запасном режиме)
  if (!state.direct) startPolling();
  // presence key — мой id: по нему остальные видят, что я на сайте
  liveChannel = cl.channel("korefany-live", { config: { presence: { key: me() } } })
    .on("presence", { event: "sync" }, () => chatOnPresence(liveChannel.presenceState()))
    .on("postgres_changes", { event: "*", schema: "public", table: "chat_reads" }, p => chatOnRead(p.new))
    .on("postgres_changes", { event: "*", schema: "public", table: "comments" }, p => onComment(p.eventType, p.new, p.old))
    .on("postgres_changes", { event: "*", schema: "public", table: "media_reactions" }, p => onReact(p.eventType, p.new, p.old))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "media" }, p => onNewStuff("media", p.new))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "quotes" }, p => onNewStuff("quote", p.new))
    .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, p => chatOnMessage(p.eventType, p.new, p.old))
    .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, p => chatOnReact(p.eventType, p.new, p.old))
    .on("postgres_changes", { event: "*", schema: "public", table: "chat_members" }, () => chatOnMembers())
    .on("broadcast", { event: "typing" }, ({ payload }) => chatOnTyping(payload))
    .on("postgres_changes", { event: "*", schema: "public", table: "poll_votes" }, p => chatOnVote(p.eventType, p.new, p.old))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chats" }, p => chatOnChatUpdate(p.new))
    .subscribe(status => {
      if (status === "SUBSCRIBED") {
        liveChannel.track({ at: new Date().toISOString() });   // «я в сети»
        // Канал работает — проверка раз в 15 секунд больше не нужна, всё приходит само
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      }
      // Живой канал не поднялся — переходим на проверку раз в 15 секунд и через минуту пробуем снова
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        cl.removeChannel(liveChannel); liveChannel = null; startPolling();
        setTimeout(() => { if (state.session && !liveChannel) startLive(); }, 60000);
      }
    });
}

function stopLive() {
  if (liveChannel) { liveClient().removeChannel(liveChannel); liveChannel = null; }
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(poll, 15000);
}
// Вернулся во вкладку — сразу проверяем новое (подписываемся один раз, а не при каждом входе)
document.addEventListener("visibilitychange", () => { if (!document.hidden && pollTimer) poll(); });

// Проверка новых данных: сравниваем с тем, что уже есть на странице
async function poll() {
  if (document.hidden || !state.session) return;
  // Комментарии: целиком тянем только новые, а для поиска удалённых хватает списка id — это в разы меньше данных.
  // Всё порциями по 1000: если взять только первую тысячу, остальные посчитались бы удалёнными
  const lastC = state.comments.reduce((a, x) => x.created_at > a ? x.created_at : a, "1970-01-01T00:00:00Z");
  const [cNew, cIds, r, m, q] = await Promise.all([
    sb.from("comments").select("*").gte("created_at", lastC).order("created_at"),
    fetchAll(() => sb.from("comments").select("id").order("created_at")),
    fetchAll(() => sb.from("media_reactions").select("*").order("created_at")),
    sb.from("media").select("id, owner, created_at").order("created_at", { ascending: false }).limit(20),
    sb.from("quotes").select("id, added_by, created_at").order("created_at", { ascending: false }).limit(20)
  ]);
  // Удалённые ищем только среди тех, что были до этой проверки: только что пришедшего в списке id может ещё не быть
  const before = state.comments.slice();
  (cNew.data || []).forEach(x => onComment("INSERT", x));   // повторы onComment отсеет сам
  if (cIds.data) {
    const alive = new Set(cIds.data.map(x => x.id));
    before.filter(x => !alive.has(x.id)).forEach(x => onComment("DELETE", null, x));
  }
  if (r.data) {
    const key = x => `${x.media_id}|${x.user_id}|${x.emoji}`;
    const fresh = new Set(r.data.map(key)), have = new Set(state.mr.map(key));
    r.data.filter(x => !have.has(key(x))).forEach(x => onReact("INSERT", x));
    state.mr.filter(x => !fresh.has(key(x))).forEach(x => onReact("DELETE", null, x));
  }
  (m.data || []).filter(x => !state.media.some(y => y.id === x.id)).forEach(x => onNewStuff("media", x));
  (q.data || []).filter(x => !state.quotes.some(y => y.id === x.id)).forEach(x => onNewStuff("quote", x));
  await chatPoll();
}

// Пришёл новый или удалённый комментарий
function onComment(type, n, o) {
  if (type === "INSERT") {
    if (!n || state.comments.some(c => c.id === n.id)) return;   // свой уже добавлен при отправке
    state.comments.push(n);
    if (state.viewing === n.media_id) {
      const m = state.media.find(x => x.id === n.media_id);
      const listEl = document.querySelector(".viewer .c-list");
      if (m && listEl) {
        listEl.querySelector(".c-empty")?.remove();
        listEl.insertAdjacentHTML("beforeend", commentHtml(n, m, 0, true));
        listEl.lastElementChild.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    } else {
      const m = state.media.find(x => x.id === n.media_id);
      if (m && m.owner === me() && n.author !== me())
        notifyBanner({ who: n.author, title: `${nameOf(n.author)} · комментарий к твоему фото`, text: n.text, onOpen: () => openViewer(m.id) });
    }
    paintCommentCount(n.media_id);
    refreshPost(n.media_id);
  }
  if (type === "DELETE") {
    const id = o?.id; if (!id) return;
    const c = state.comments.find(x => x.id === id); if (!c) return;
    state.comments = state.comments.filter(x => x.id !== id);
    const item = document.querySelector(`.viewer [data-cid="${id}"]`);
    if (item) { item.classList.add("bye"); setTimeout(() => item.remove(), 280); }
    paintCommentCount(c.media_id);
    refreshPost(c.media_id);
  }
}

function paintCommentCount(mediaId) {
  if (state.viewing !== mediaId) return;
  // Счётчиков может быть два: у заголовка комментариев и на кнопке 💬 в просмотре на телефоне
  const n = state.comments.filter(c => c.media_id === mediaId).length;
  document.querySelectorAll(".viewer .c-count").forEach(el => { el.textContent = n || ""; });
}

// Пришла новая или снятая реакция
function onReact(type, n, o) {
  const r = type === "INSERT" ? n : o; if (!r) return;
  const same = x => x.media_id === r.media_id && x.user_id === r.user_id && x.emoji === r.emoji;
  if (type === "INSERT") { if (state.mr.some(same)) return; state.mr.push(r); }
  else { const i = state.mr.findIndex(same); if (i < 0) return; state.mr.splice(i, 1); }
  paintReact("m", r.media_id, r.emoji);
  if (type === "INSERT" && r.user_id !== me()) liveReact(r);
}

// Живые реакции: друг поставил реакцию на фото, которое у тебя сейчас на экране, —
// над кнопкой всплывает его эмодзи с именем и улетает вверх
function liveReact(r) {
  const btns = [...document.querySelectorAll(`[data-react="m"][data-id="${r.media_id}"][data-emoji="${r.emoji}"]`)];
  const btn = btns.find(b => { const x = b.getBoundingClientRect(); return x.width && x.bottom > 0 && x.top < innerHeight; });
  if (!btn || document.hidden) return;
  const x = btn.getBoundingClientRect();
  const s = document.createElement("span");
  s.className = "live-react";
  s.innerHTML = `<i>${EMOJI[r.emoji] || "✨"}</i><b>${esc(nameOf(r.user_id))}</b>`;
  s.style.left = x.left + x.width / 2 + "px"; s.style.top = x.top + "px";
  document.body.appendChild(s);
  setTimeout(() => s.remove(), 2200);
}

// Цифры набегают от нуля: статистика на обложке и в профиле, очки в «Топе».
// Один раз на число — когда страница перерисовывается после обновления данных, заново не считают
const countedOnce = new Set();
function countUp(root = document) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  root.querySelectorAll("[data-count]").forEach((el, i) => {
    const n = Number(el.dataset.count), key = `${location.hash}|${i}|${n}`;
    if (!(n >= 2) || countedOnce.has(key)) return;
    countedOnce.add(key);
    const start = performance.now(), dur = Math.min(1400, 600 + n * 8);
    const step = t => {
      const k = Math.min(1, (t - start) / dur), e = 1 - Math.pow(1 - k, 3);   // быстро в начале, плавно к концу
      el.textContent = Math.round(n * e);
      if (k < 1 && el.isConnected) requestAnimationFrame(step); else el.textContent = n;
    };
    el.textContent = "0";
    requestAnimationFrame(step);
    setTimeout(() => { el.textContent = n; }, dur + 300);   // если вкладка была скрыта и кадры не шли — всё равно покажем число
  });
}

// Параллакс обложки ленты: при прокрутке фото уезжает медленнее страницы и темнеет, надпись тает
let parallaxOn = false;
function wireParallax() {
  if (parallaxOn || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  parallaxOn = true;
  let queued = false;
  addEventListener("scroll", () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const cover = document.getElementById("cover"); if (!cover) return;
      const r = cover.getBoundingClientRect();
      if (r.bottom < -50 || r.top > innerHeight) return;
      cover.style.setProperty("--px", Math.min(1, Math.max(0, -r.top / r.height)).toFixed(3));
    });
  }, { passive: true });
}

// Кто-то добавил фото или цитату: показываем плашку, чтобы не дёргать страницу под рукой.
// О каждой новинке говорим один раз: в запасном режиме проверка каждые 15 секунд видит её снова
const announced = new Set();
// Фото из одной пачки приходят по одному — копим их 4 секунды и показываем один баннер на всю пачку
const mediaBatch = new Map();   // кто загрузил → { photos, videos, timer }
function mediaText(photos, videos) {
  if (photos + videos === 1) return videos ? "загрузил новое видео 🎬" : "загрузил новое фото 📸";
  return "загрузил " + [photos && `${photos} фото`, videos && `${videos} видео`].filter(Boolean).join(" и ");
}
function onNewStuff(kind, row) {
  const who = kind === "media" ? row.owner : row.added_by;
  if (who === me() || announced.has(row.id)) return;
  announced.add(row.id);
  const open = async () => { await loadAll(); location.hash = kind === "media" ? "#/" : "#/quotes"; route(); };
  if (kind !== "media") return notifyBanner({ who, title: nameOf(who), text: "добавил цитату — нажми, чтобы посмотреть", onOpen: open });
  const b = mediaBatch.get(who) || { photos: 0, videos: 0, timer: null };
  row.kind === "video" ? b.videos++ : b.photos++;
  clearTimeout(b.timer);
  b.timer = setTimeout(() => {
    mediaBatch.delete(who);
    notifyBanner({ who, title: nameOf(who), text: `${mediaText(b.photos, b.videos)} — нажми, чтобы посмотреть`, onOpen: open });
  }, 4000);
  mediaBatch.set(who, b);
}

// ---------- Потянул страницу вниз — обновление (на телефоне) ----------
// Сверху выезжает неоновая «К»: тянешь дальше — она загорается, отпустил — сайт подтягивает свежее
(function pullToRefresh() {
  const PULL = 100;   // на сколько пикселей потянуть, чтобы сработало
  let sx = 0, sy = 0, pull = 0, active = false, busy = false;
  const ind = document.createElement("div");
  ind.className = "ptr"; ind.innerHTML = "<span>К</span>";
  document.body.appendChild(ind);
  const allowed = () => state.session && !busy && scrollY <= 0 && !document.getElementById("viewer") &&
    !document.body.classList.contains("in-chat") && matchMedia("(pointer: coarse)").matches;
  const reset = () => { ind.className = "ptr"; ind.style.transform = ""; ind.style.opacity = ""; };
  document.addEventListener("touchstart", e => {
    active = e.touches.length === 1 && allowed();
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; pull = 0;
  }, { passive: true });
  document.addEventListener("touchmove", e => {
    if (!active) return;
    const dx = Math.abs(e.touches[0].clientX - sx);
    pull = Math.max(0, e.touches[0].clientY - sy);
    // Листают вбок (обложку, постеры в галерее) — это не обновление
    if (dx > 24 && dx > pull) { active = false; return reset(); }
    const p = Math.min(1, pull / PULL);
    ind.classList.add("drag");
    ind.classList.toggle("ready", p >= 1);
    ind.style.transform = `translate(-50%, ${Math.min(pull * .55, 70) - 56}px) scale(${.6 + p * .4})`;
    ind.style.opacity = p;
  }, { passive: true });
  document.addEventListener("touchend", async () => {
    if (!active) return;
    active = false;
    if (pull < PULL) return reset();
    busy = true;
    ind.className = "ptr spin"; ind.style.transform = ""; ind.style.opacity = "";
    navigator.vibrate?.(15);
    try { await Promise.all([loadAll(), loadChats().catch(() => {})]); saveCache(); paintChatBadge(); } catch (e) {}
    await route();
    busy = false;
    reset();
  });
})();

// ---------- Обновление сайта ----------
// Приложение с экрана «Домой» на iPhone не перезагружается, а просто «просыпается» со старой версией.
// Поэтому, когда возвращаешься в него, сверяем номер версии (?v= в index.html) с сайтом и обновляемся сами
const APP_VERSION = +((document.querySelector('script[src*="app.js?v="]')?.getAttribute("src") || "").match(/v=(\d+)/) || [])[1] || 0;
let updateCheckedAt = 0;
async function checkUpdate() {
  if (!APP_VERSION || Date.now() - updateCheckedAt < 60000) return;
  updateCheckedAt = Date.now();
  try {
    const html = await (await fetch("./?check=" + Date.now(), { cache: "no-store" })).text();
    const v = +(html.match(/app\.js\?v=(\d+)/) || [])[1];
    if (!v || v <= APP_VERSION) return;
    // Если человек что-то пишет, не перезагружаем под рукой, а предлагаем кнопкой
    const typing = [...document.querySelectorAll("textarea, input[type=text]")].some(x => x.value.trim()) ||
      (typeof rec !== "undefined" && rec);   // идёт запись голосового — тоже не перезагружаем
    if (typing) toast("Вышла новая версия сайта", "Обновить", () => location.reload());
    else location.reload();
  } catch (e) {}
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkUpdate(); });
setInterval(() => { if (!document.hidden) checkUpdate(); }, 10 * 60 * 1000);

// ---------- Уведомление внутри сайта: баннер сверху, как на iPhone ----------
// Аватарка, кто и где, начало сообщения. Нажал — открылось, смахнул вверх — убрал, сам уходит через 4 секунды.
// Новый баннер заменяет предыдущий. Внизу ничего не закрывает — там кнопки отправки и меню
let bannerTimer = null;
function notifyBanner({ who, title, text, onOpen }) {
  document.querySelector(".nbanner")?.remove();
  clearTimeout(bannerTimer);
  const b = document.createElement("div");
  b.className = "nbanner"; b.setAttribute("role", "status");
  b.innerHTML = `${who ? avatar(who) : `<span class="ava nb-k">К</span>`}
    <div class="nb-main"><b>${esc(title)}</b><span>${esc(text)}</span></div><time>сейчас</time>`;
  document.body.appendChild(b);
  const hide = (up = true) => {
    clearTimeout(bannerTimer);
    if (!b.isConnected || b.classList.contains("out")) return;
    b.classList.add(up ? "out" : "out-fade");
    setTimeout(() => b.remove(), 300);
  };
  bannerTimer = setTimeout(hide, 4000);
  b.onclick = () => { hide(false); onOpen?.(); };
  // Смахнуть вверх — убрать: баннер едет за пальцем
  let sy = 0, dy = 0;
  b.addEventListener("touchstart", e => { sy = e.touches[0].clientY; dy = 0; clearTimeout(bannerTimer); b.style.transition = "none"; }, { passive: true });
  b.addEventListener("touchmove", e => { dy = Math.min(0, e.touches[0].clientY - sy); b.style.transform = `translate(-50%, ${dy}px)`; }, { passive: true });
  b.addEventListener("touchend", () => {
    b.style.transition = ""; b.style.transform = "";
    if (dy < -25) { hide(); b.onclick = null; } else bannerTimer = setTimeout(hide, 2500);
  });
}

// Неоновая плашка снизу экрана — для коротких сообщений («Сохранено», ошибки)
function toast(text, action, onAction) {
  document.querySelector(".toast")?.remove();
  const t = document.createElement("div");
  t.className = "toast";
  t.innerHTML = `<span>${esc(text)}</span>${action ? `<button type="button">${esc(action)}</button>` : ""}`;
  document.body.appendChild(t);
  const hide = () => { t.classList.add("out"); setTimeout(() => t.remove(), 300); };
  if (action) t.querySelector("button").onclick = () => { hide(); onAction(); };
  setTimeout(hide, action ? 6000 : 2500);   // короткие «Сохранено» не висят над кнопками
}

start();
