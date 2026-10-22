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
const dataRaw = () => JSON.stringify([state.profiles, state.media, state.quotes, state.mr, state.qr, state.comments,
  state.quotesReady, state.reactsReady, state.commentsReady, chat.ready, chat.list, chat.members, chat.last, chat.unread]);

function saveCache() {
  if (!me()) return null;
  const raw = dataRaw();
  const now = Date.now();
  const urls = Object.fromEntries(Object.entries(state.urls).filter(([, v]) => v.until > now + 5 * 60e3));
  const chatUrls = Object.fromEntries(Object.entries(chat.urls).filter(([, v]) => v.until > now + 5 * 60e3));
  try {
    localStorage.setItem(cacheKey(), JSON.stringify({ v: 1, raw, urls, chatUrls, reads: chat.reads, lastPoll: chat.lastPoll }));
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
    Object.assign(chat, { ready: chReady, list, members, last, unread, reads: c.reads || {}, lastPoll: c.lastPoll });
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
  const calm = !document.getElementById("viewer") && scrollY < 40 && !document.activeElement?.matches?.("input, textarea") &&
    !/^\/(chat|upload|me)/.test(h);
  if (calm) route();
}
// Ушёл из приложения — запоминаем, что накопилось (новые комментарии, реакции)
document.addEventListener("visibilitychange", () => { if (document.hidden && state.session) saveCache(); });

// Файлы закрытые, поэтому для показа берём временные ссылки на час
async function signed(paths) {
  const now = Date.now();
  const need = [...new Set(paths.filter(Boolean))].filter(p => !state.urls[p] || state.urls[p].until < now);
  // Порции по 100 уходят одновременно, а не по очереди
  await Promise.all(Array.from({ length: Math.ceil(need.length / 100) }, async (_, i) => {
    const part = need.slice(i * 100, i * 100 + 100);
    const { data } = await sb.storage.from(BUCKET).createSignedUrls(part, 3600);
    // Файла нет (например, среднего размера у старого фото) — запоминаем пустую ссылку, чтобы не спрашивать снова
    if (data) data.forEach(r => { if (r.path) state.urls[r.path] = { url: r.signedUrl || "", until: now + 50 * 60 * 1000 }; });
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
  top: `<svg viewBox="0 0 24 24"><path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M9.5 17h5v4h-5z"/></svg>`
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
      </nav>
      <a href="#/upload" class="cta-up" title="Загрузить">${ICONS.plus}<span>Загрузить</span></a>
      <a href="#/top" class="me-m top-m" title="Топ месяца">${ICONS.top}</a>
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
}
window.addEventListener("resize", () => { navIndicator = null; moveNavIndicator(); });
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
      ${t ? `<img src="${t}" alt="" loading="lazy">` : `<span class="noimg">${m.kind === "video" ? "▶" : "🖼"}</span>`}
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
  if (!list.length) return;
  await appendPosts();
  // Когда долистали до низа — подгружаем следующие посты
  feedObserver?.disconnect();
  feedObserver = new IntersectionObserver(async es => {
    if (es[0].isIntersecting && state.feed.shown < state.feed.list.length) await appendPosts();
  }, { rootMargin: "800px" });
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
  feed.insertAdjacentHTML("beforeend", html);
  const more = document.getElementById("feedMore");
  if (more) more.textContent = f.shown < f.list.length ? "Загружаю ещё..." : "Это всё. Дальше история только начинается 🔥";
  // Низ ленты всё ещё на экране (короткие посты или быстрая прокрутка) — догружаем следующую порцию сами
  if (more && f.shown < f.list.length && more.getBoundingClientRect().top < innerHeight + 800) setTimeout(appendPosts, 50);
}

function postHtml(m, i = 0) {
  const cc = state.comments.filter(c => c.media_id === m.id).length;
  return `<article class="post" data-post="${m.id}" style="--i:${i}">
    <header class="post-head">
      <a href="#/p/${m.owner}" class="post-who" style="${ucStyle(m.owner)}">${avatar(m.owner)}<div><b>${esc(nameOf(m.owner))}</b><span>${dayText(m.taken_at || m.created_at)}</span></div></a>
    </header>
    <div class="post-media" data-post-media="${m.id}">${m.kind === "video"
      ? `<video src="${url(m.path)}" poster="${url(thumbPath(m))}" controls playsinline preload="none"></video>`
      : `<img src="${url(midPath(m)) || url(m.path)}" alt="${esc(m.caption || "")}" loading="lazy" decoding="async">`}</div>
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
  postTap = { id, timer: setTimeout(() => { postTap = { id: null, timer: null }; openViewer(id); }, 260) };
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
  const stat = (n, forms) => `<div><b>${n}</b><span>${plural(n, forms)}</span></div>`;
  return `<section class="cover" id="cover">
    ${slides.map((m, i) => `<div class="cover-slide${i === 0 ? " on" : ""}" data-cover-open="${m.id}">
      <img class="cs-bg" src="${url(thumbPath(m)) || url(m.path)}" alt="">
      <img class="cs-fg" ${i < 2 ? "src" : "data-src"}="${url(midPath(m)) || url(m.path)}" alt="" decoding="async">
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
    if (id) openViewer(id);
  });
  restart();
}

// Галерея: сверху корефаны-постеры работают как фильтр, снизу все фото и видео ровной сеткой.
// Нажал на корефана — остались только фото с ним, нажал ещё раз — снова все
const tagged = id => state.media.filter(m => m.people.includes(id));

async function viewPeople() {
  const rcOf = countBy(state.mr, "media_id"), months = allMonthStats();
  const bestOf = id => tagged(id).sort((a, b) => (rcOf.get(b.id) || 0) - (rcOf.get(a.id) || 0))[0];
  const covers = state.profiles.map(p => bestOf(p.id)).filter(Boolean);
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

// Перерисовать только сетку и подсветку постеров, без перезагрузки всей страницы
async function renderGallery() {
  const f = state.galleryFilter;
  document.querySelectorAll("[data-gfilter]").forEach(b => b.setAttribute("aria-pressed", b.dataset.gfilter === f));
  document.getElementById("posters")?.classList.toggle("filtered", !!f);
  const list = [...(f ? tagged(f) : state.media)].sort((a, b) => (b.taken_at || b.created_at).localeCompare(a.taken_at || a.created_at));
  state.current = list;
  const box = document.getElementById("galleryGrid"); if (!box) return;
  const title = f ? `Фото, где есть ${esc(nameOf(f))}` : "Все фото и видео";
  box.innerHTML = `
    <div class="gallery-head"><h2>${title} <span class="g-count">${list.length}</span></h2>
      ${f ? `<button type="button" class="link-btn g-reset" data-gfilter-reset>Показать все</button>` : ""}</div>
    ${await grid(list, f ? `Фото, где есть ${esc(nameOf(f))}, пока нет. Загрузи и отметь.` : `Пока пусто. <a href="#/upload">Загрузи первое фото</a>.`, true)}`;
}

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
  const stat = (n, forms) => `<div><b>${n}</b><span>${plural(n, forms)}</span></div>`;
  const cover = p.cover_path && url(p.cover_path);
  const pq = p.pinned_quote && state.quotes.find(q => q.id === p.pinned_quote);
  return `<section class="phero" style="${ucStyle(id)}">
    <div class="phero-cover">
      ${cover ? `<img src="${cover}" alt="">` : ""}
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

const NOMS = [
  { key: "score", icon: "👑", title: "Корефан месяца", unit: ["очко", "очка", "очков"] },
  { key: "uploads", icon: "📸", title: "Фотограф месяца", unit: ["загрузка", "загрузки", "загрузок"] },
  { key: "tags", icon: "⭐", title: "Звезда месяца", unit: ["отметка", "отметки", "отметок"] },
  { key: "laughs", icon: "😂", title: "Комик месяца", unit: ["😂", "😂", "😂"] }
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
  const leader = key => leaderOf(stats, key);

  const noms = NOMS.map((n, i) => {
    const l = leader(n.key);
    if (!l) return `<div class="nom${i === 0 ? " main" : ""}"><div><span class="t">${n.title}</span><b>Пока никого</b></div></div>`;
    const v = l[1][n.key];
    return `<a class="nom${i === 0 ? " main" : ""}" href="#/p/${l[0]}">${avatar(l[0], i === 0)}<div>
      <span class="t">${n.title}</span><b>${esc(nameOf(l[0]))}</b><span>${v} ${plural(v, n.unit)}</span></div></a>`;
  }).join("");

  shell("top", `
    <div class="head" style="justify-content:space-between">
      <div><h1>Топ месяца</h1><p class="sub">${MONTHS[m]} ${y}</p></div>
      <div class="row">
        <button type="button" class="btn" data-tm="-1" aria-label="Прошлый месяц">←</button>
        <button type="button" class="btn" data-tm="1" aria-label="Следующий месяц" ${isNow ? "disabled" : ""}>→</button>
      </div>
    </div>
    ${state.reactsReady ? "" : `<div class="empty">Реакции ещё не включены. Нужно выполнить файл 03_reactions.sql в Supabase.</div>`}
    <section><h2>Номинации</h2><div class="noms">${noms}</div>
      <p class="msg" style="margin-top:10px">Очки корефана месяца: загрузки + отметки на фото + реакции на его фото + 😂 на его цитатах ×2</p></section>
    <section><h2>Лучшие фото и видео</h2>${await grid(best, "В этом месяце ещё никто не ставил реакций. Открой любое фото и жми 😂 🔥 ❤️")}</section>`);
  state.current = best;

  document.querySelectorAll("[data-tm]").forEach(b => b.onclick = () => {
    let mm = m + Number(b.dataset.tm), yy = y;
    if (mm < 0) { mm = 11; yy--; } if (mm > 11) { mm = 0; yy++; }
    state.topMonth = { y: yy, m: mm };
    viewTop();
  });
}

function viewUpload() {
  shell("", `
    <div><h1>Загрузить</h1><p class="sub">Фото сожмутся сами. Видео до ${KOREFANY.maxVideoMb} МБ.</p></div>
    <form class="card" id="upForm">
      <div class="drop" id="drop" tabindex="0">Нажми или перетащи сюда фото и видео</div>
      <input type="file" id="files" accept="image/*,video/*,.heic,.heif" multiple hidden>
      <div class="picked" id="picked"></div>
      <label>Кто на них?
        <div class="chips" id="tagChips">${state.profiles.map(p =>
          `<button type="button" class="chip" data-tag="${p.id}" aria-pressed="false">${avatar(p.id)}${esc(p.name)}</button>`).join("")}</div>
      </label>
      <label>Подпись<textarea id="caption" maxlength="500" placeholder="Что тут происходит?"></textarea></label>
      <label>Когда это было<input type="date" id="takenAt"></label>
      <div class="progress" id="upProg" hidden><i></i></div>
      <div class="row"><button type="submit" class="btn primary" id="upBtn" disabled>Загрузить</button><p class="msg" id="upMsg"></p></div>
    </form>`);

  let files = [];
  const pick = (list, keepDate = false) => {
    // HEIC с айфона Windows иногда отдаёт без типа, поэтому смотрим и на расширение
    files = [...list].filter(f => f.type.startsWith("image/") || f.type.startsWith("video/") || isHeic(f));
    document.getElementById("picked").innerHTML = files.map(f =>
      f.type.startsWith("video/") ? `<div>▶ видео</div>` :
      isHeic(f) ? `<div>HEIC</div>` :
      `<div style="background-image:url(${URL.createObjectURL(f)})"></div>`).join("");
    document.getElementById("upBtn").disabled = !files.length;
    // Дата по умолчанию: когда снят первый файл. Берём местную дату, а не по Гринвичу:
    // иначе утреннее фото в Ангарске (UTC+8) попадало бы во вчерашний день
    if (files[0] && !keepDate) {
      const d = new Date(files[0].lastModified), p2 = n => String(n).padStart(2, "0");
      document.getElementById("takenAt").value = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
    }
  };
  const drop = document.getElementById("drop"), input = document.getElementById("files");
  drop.onclick = () => input.click();
  drop.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } };
  input.onchange = () => pick(input.files);
  drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); pick(e.dataTransfer.files); };

  document.getElementById("tagChips").onclick = e => {
    const b = e.target.closest("[data-tag]"); if (!b) return;
    b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") !== "true");
  };

  document.getElementById("upForm").onsubmit = async e => {
    e.preventDefault();
    const btn = document.getElementById("upBtn"), msg = document.getElementById("upMsg");
    const tags = [...document.querySelectorAll('[data-tag][aria-pressed="true"]')].map(b => b.dataset.tag);
    const caption = document.getElementById("caption").value.trim();
    const takenAt = document.getElementById("takenAt").value || null;
    btn.disabled = true; msg.className = "msg";
    const failed = [];
    const prog = document.getElementById("upProg"), bar = prog.querySelector("i");
    prog.hidden = false;
    for (let i = 0; i < files.length; i++) {
      msg.textContent = `Загружаю ${i + 1} из ${files.length}...`;
      bar.style.width = `${Math.max(6, (i + 0.5) / files.length * 100)}%`;
      try { await uploadOne(files[i], { tags, caption, takenAt }); }
      catch (err) { failed.push({ file: files[i], text: `${files[i].name}: ${err.message || err}` }); }
      bar.style.width = `${(i + 1) / files.length * 100}%`;
    }
    await loadAll();
    if (failed.length) {
      msg.className = "msg err";
      msg.textContent = `Не загрузилось ${failed.length}: ${failed.map(f => f.text).join("; ")}`;
      // В списке оставляем только то, что не загрузилось: повторное нажатие не задублирует уже загруженное
      pick(failed.map(f => f.file), true);
      btn.disabled = false;
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
    if (old) await sb.storage.from(BUCKET).remove([old]);
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
      const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg" });
      if (error) throw error;
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

// dir: -1 пришли свайпом назад, 1 вперёд, 0 просто открыли
async function openViewer(id, dir = 0) {
  let list = state.current || state.media;
  if (!list.some(m => m.id === id)) list = state.media;
  const idx = list.findIndex(m => m.id === id);
  const m = list[idx]; if (!m) return;
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
      ? `<video src="${url(m.path)}" controls autoplay playsinline></video>`
      : `<img src="${url(m.path)}" alt="${esc(m.caption)}">`}</div>
    <aside class="info">
      ${m.caption ? `<p class="caption">${esc(m.caption)}</p>` : ""}
      <p class="msg">${dayText(m.taken_at || m.created_at)} · загрузил ${esc(nameOf(m.owner))}</p>
      ${reactButtons("m", m.id)}
      ${m.people.length ? `<div><h2>На фото</h2><div class="chips">${m.people.map(p =>
        `<a class="chip" href="#/p/${p}">${avatar(p)}${esc(nameOf(p))}</a>`).join("")}</div></div>` : ""}
      ${m.owner === me() ? `<div><button class="btn danger" data-del="${m.id}">Удалить</button></div>` : ""}
      ${commentsBlock(m)}
    </aside>`;
  const fresh = !document.getElementById("viewer");
  document.body.appendChild(el);
  document.body.classList.add("viewer-open");   // страница под просмотром не прокручивается
  // Кнопка «Назад» на телефоне закрывает просмотр, а не уводит со страницы
  if (fresh && !history.state?.viewer) history.pushState({ viewer: true }, "");
  wireComments(el, m);
  wireDoubleTap(el, m);

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
// silent: закрыть без шага «назад» в истории (когда уходим по ссылке или уже нажали «Назад»)
function closeViewer(silent = false) {
  const el = document.getElementById("viewer");
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
  const listEl = el.querySelector(".c-list"), countEl = el.querySelector(".c-count");
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
    countEl.textContent = state.comments.filter(c => c.media_id === m.id).length;
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
  const countEl = document.querySelector(".viewer .c-count");
  if (countEl && c) countEl.textContent = state.comments.filter(x => x.media_id === c.media_id).length || "";
  if (c) refreshPost(c.media_id);
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
    document.querySelector(".viewer .c-form textarea")?.focus();
    return;
  }
  const open = e.target.closest("[data-open]"); if (open) return openViewer(open.dataset.open);
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
    await sb.storage.from(BUCKET).remove([m.path, thumbPath(m), midPath(m)].filter(Boolean));
    closeViewer(); await loadAll(); route();
  }
});
document.addEventListener("keydown", e => {
  // Постер-фильтр в галерее выбирается и с клавиатуры
  if ((e.key === "Enter" || e.key === " ") && e.target.matches?.("[data-gfilter]")) { e.preventDefault(); e.target.click(); return; }
  if (!document.getElementById("viewer")) return;
  if (e.target.closest("textarea, input")) return;   // пишут комментарий — стрелки не листают
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
    ext = "jpg";
  }

  const path = `${me()}/${id}.${ext}`;
  let r = await sb.storage.from(BUCKET).upload(path, main, { contentType: isVideo ? file.type : "image/jpeg" });
  if (r.error) throw r.error;
  await Promise.all([
    thumb && sb.storage.from(BUCKET).upload(`${me()}/${id}_t.jpg`, thumb, { contentType: "image/jpeg" }),
    mid && sb.storage.from(BUCKET).upload(`${me()}/${id}_m.jpg`, mid, { contentType: "image/jpeg" })
  ]);

  r = await sb.from("media").insert({ id, path, kind: isVideo ? "video" : "photo", caption: caption || null, taken_at: takenAt });
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

// Кадр из видео для превью. Если не получилось, будет значок ▶
function videoThumb(file) {
  return new Promise(resolve => {
    const v = document.createElement("video");
    const src = URL.createObjectURL(file);
    const done = blob => { URL.revokeObjectURL(src); resolve(blob); };
    const timer = setTimeout(() => done(null), 8000);
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = src;
    v.onloadeddata = () => { v.currentTime = Math.min(1, (v.duration || 2) / 2); };
    v.onseeked = () => {
      const k = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k);
      c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
      clearTimeout(timer);
      c.toBlob(done, "image/jpeg", 0.8);
    };
    v.onerror = () => { clearTimeout(timer); done(null); };
  });
}

// ---------- Переключение страниц ----------

// Номер текущего перехода. Если быстро тыкать по меню, медленная старая страница
// может догрузиться позже новой — по номеру понимаем, что её показывать уже не надо
let routeSeq = 0;

async function route() {
  if (!state.session) return viewLogin();
  const seq = ++routeSeq;
  closeViewer(true);
  clearInterval(coverTimer);   // ушли с ленты — обложка больше не листается
  feedObserver?.disconnect();  // и посты больше не подгружаем
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
    else if (h === "/upload") viewUpload();
    else if (h === "/me") await viewMe();
    else location.hash = "#/";
  } catch (err) {
    if (seq === routeSeq) $app.innerHTML = `<p class="loading">Что-то сломалось: ${esc(err.message || err)}. Обнови страницу.</p>`;
  }
  if (seq === routeSeq) window.scrollTo(0, 0);
}

// Подходит ли страница к текущему адресу (для защиты от устаревших переходов в shell)
const PAGE_OF = { feed: ["/"], people: ["/people", "/p/"], chats: ["/chats", "/chat/"], quotes: ["/quotes"], top: ["/top"], "": ["/me", "/upload"] };
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
  // Посредника перепроверяем чаще (раз в 6 часов): вдруг тогда просто моргнул интернет
  const fresh = saved && Date.now() - saved.at < (saved.proxy ? 6 * 3600e3 : 864e5);
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
  setTimeout(async () => {
    if (!session) { stopLive(); state.profiles = []; state.media = []; return viewLogin(); }
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

let liveChannel = null, pollTimer = null;

function startLive() {
  if (liveChannel || pollTimer) return;
  if (!state.direct) return startPolling();
  // presence key — мой id: по нему остальные видят, что я на сайте
  liveChannel = sb.channel("korefany-live", { config: { presence: { key: me() } } })
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
      if (status === "SUBSCRIBED") liveChannel.track({ at: new Date().toISOString() });   // «я в сети»
      // Живой канал не поднялся — переходим на проверку раз в 15 секунд
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { sb.removeChannel(liveChannel); liveChannel = null; startPolling(); }
    });
}

function stopLive() {
  if (liveChannel) { sb.removeChannel(liveChannel); liveChannel = null; }
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
      if (m && m.owner === me() && n.author !== me()) toast(`${nameOf(n.author)} прокомментировал твоё фото`, "Открыть", () => openViewer(m.id));
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
  const el = document.querySelector(".viewer .c-count");
  if (el) el.textContent = state.comments.filter(c => c.media_id === mediaId).length || "";
}

// Пришла новая или снятая реакция
function onReact(type, n, o) {
  const r = type === "INSERT" ? n : o; if (!r) return;
  const same = x => x.media_id === r.media_id && x.user_id === r.user_id && x.emoji === r.emoji;
  if (type === "INSERT") { if (state.mr.some(same)) return; state.mr.push(r); }
  else { const i = state.mr.findIndex(same); if (i < 0) return; state.mr.splice(i, 1); }
  paintReact("m", r.media_id, r.emoji);
}

// Кто-то добавил фото или цитату: показываем плашку, чтобы не дёргать страницу под рукой.
// О каждой новинке говорим один раз: в запасном режиме проверка каждые 15 секунд видит её снова
const announced = new Set();
function onNewStuff(kind, row) {
  const who = kind === "media" ? row.owner : row.added_by;
  if (who === me() || announced.has(row.id)) return;
  announced.add(row.id);
  toast(kind === "media" ? `${nameOf(who)} загрузил новое` : `${nameOf(who)} добавил цитату`, "Показать", async () => {
    await loadAll(); location.hash = kind === "media" ? "#/" : "#/quotes"; route();
  });
}

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
    const typing = [...document.querySelectorAll("textarea, input[type=text]")].some(x => x.value.trim());
    if (typing) toast("Вышла новая версия сайта", "Обновить", () => location.reload());
    else location.reload();
  } catch (e) {}
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkUpdate(); });
setInterval(() => { if (!document.hidden) checkUpdate(); }, 10 * 60 * 1000);

// Неоновая плашка снизу экрана
function toast(text, action, onAction) {
  document.querySelector(".toast")?.remove();
  const t = document.createElement("div");
  t.className = "toast";
  t.innerHTML = `<span>${esc(text)}</span>${action ? `<button type="button">${esc(action)}</button>` : ""}`;
  document.body.appendChild(t);
  const hide = () => { t.classList.add("out"); setTimeout(() => t.remove(), 300); };
  if (action) t.querySelector("button").onclick = () => { hide(); onAction(); };
  setTimeout(hide, 8000);
}

start();
