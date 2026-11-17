// Корефаны: переключение страниц, запуск, вход, живые обновления, догон пропущенного, обновление сайта, баннеры.
// Подключается последним из частей бывшего app.js: в самом конце start() запускает сайт.

// ---------- Переключение страниц ----------

// Номер текущего перехода. Если быстро тыкать по меню, медленная старая страница
// может догрузиться позже новой — по номеру понимаем, что её показывать уже не надо
let routeSeq = 0;

async function route() {
  const inv = location.hash.match(/^#\/invite\/([\w-]+)/);
  if (inv && (!state.session || state.offline)) return viewInvite(inv[1]);
  if (!state.session) return viewLogin();
  const seq = ++routeSeq;
  closeViewer(true);
  document.querySelector(".gs-wrap")?.remove();   // шторка «Фильтр и порядок» галереи
  document.querySelector(".lightbox")?.remove();  // фото из чата на весь экран не остаётся висеть над новой страницей
  clearInterval(coverTimer);   // ушли с ленты — обложка больше не листается
  feedObserver?.disconnect();  // и посты больше не подгружаем
  feedKeeper?.disconnect(); feedKeeper = null;
  // Ссылки на аватарки и обложки живут час: если сайт открыт давно, тихо берём свежие
  await signed(state.profiles.flatMap(x => [x.avatar_path, x.cover_path]).filter(Boolean));
  if (typeof chatLeave === "function") chatLeave();   // вышли из переписки — меню снова видно
  const h = location.hash.replace(/^#/, "") || "/";
  if (h !== "/") { state.fnew = false; state.fnewList = null; }   // ушёл из ленты — «Новые для тебя» закрываются
  try {
    // Переписка и «Счёт» на телефоне не хранятся — без связи их не открыть. Говорим об этом сразу, а не ждём ответа сервера
    if (state.offline && /^\/(chat\/|money)/.test(h)) {
      shell(h.startsWith("/money") ? "money" : "chats", `<div class="empty" data-offline>Нет связи. Этот раздел откроется, когда появится интернет.
        <a href="${h.startsWith("/money") ? "#/" : "#/chats"}">${h.startsWith("/money") ? "В ленту" : "К списку чатов"}</a></div>`);
    }
    else if (h === "/") await viewFeed();
    else if (h.startsWith("/m/")) await viewOne(h.slice(3));
    else if (h.startsWith("/new/")) { const [who, last, n] = h.slice(5).split("/"); await viewBatch(who, last, n); }
    else if (h === "/people") await viewPeople();
    else if (h.startsWith("/p/")) await viewPerson(h.slice(3));
    else if (h === "/quotes") viewQuotes();
    else if (h === "/search" || h.startsWith("/search/")) viewSearch(decodeURIComponent(h.slice(8)));
    else if (h === "/chats") await viewChats();
    else if (h.startsWith("/chat/")) await viewChat(h.slice(6));
    else if (h === "/top") await viewTop();
    else if (h === "/money") await viewMoney();
    else if (h.startsWith("/money/")) await viewMoneyTrip(h.slice(7));
    else if (h === "/upload") viewUpload();
    else if (h === "/me") await viewMe();
    else if (h === "/notifications") await viewNotifications();
    else if (h === "/admin") await viewAdmin();
    else if (h === "/events") await viewEvents();
    else if (h.startsWith("/year")) await viewYear(h.slice(6));
    else if (h.startsWith("/invite/")) { location.hash = "#/"; toast("Ты уже вошёл — ссылка-приглашение нужна новому человеку"); }
    else location.hash = "#/";
  } catch (err) {
    if (seq === routeSeq) $app.innerHTML = `<p class="loading">Что-то сломалось: ${esc(err.message || err)}. Обнови страницу.</p>`;
  }
  if (seq === routeSeq) window.scrollTo(0, 0);
}

// Подходит ли страница к текущему адресу (для защиты от устаревших переходов в shell)
const PAGE_OF = { feed: ["/", "/new/", "/m/"],people: ["/people", "/p/"], chats: ["/chats", "/chat/"], quotes: ["/quotes"], search: ["/search"], top: ["/top", "/year"], money: ["/money"], "": ["/me", "/upload", "/admin", "/events"], notifications: ["/notifications"] };
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
  // Вход на устройстве есть, а сервер молчит: библиотека Supabase пробует продлить вход до 30 секунд и всё это время
  // ничего не сообщает. Столько ждать незачем — через 2,5 секунды считаем, что связи нет, и показываем сохранённое.
  // Ответит позже — сайт сам перейдёт в обычный режим (см. onAuth)
  setTimeout(() => { if (!state.authSeen && keptSession()) onAuth("INITIAL_SESSION", null, true); }, 2500);
}

// Вход, сохранённый на устройстве (его кладёт туда Supabase). Нужен, когда сервер не ответил при запуске
const AUTH_KEY = "sb-jvyitolecgbldlxypwcz-auth-token";
function keptSession() {
  try { const s = JSON.parse(localStorage.getItem(AUTH_KEY) || "null"); return s?.user?.id && s.refresh_token ? s : null; }
  catch (e) { return null; }
}

// Полоска «Нет связи»: интернета нет или сервер не ответил при запуске. Нажатие — попробовать ещё раз
function paintNet() {
  const down = !!state.session && (state.offline || !navigator.onLine);
  let bar = document.getElementById("netbar");
  if (!down) { bar?.remove(); return; }
  if (!bar) {
    bar = document.createElement("button");
    bar.type = "button"; bar.id = "netbar"; bar.className = "netbar";
    bar.innerHTML = `<i></i><span>Нет связи — показываю сохранённое</span>`;
    bar.onclick = retryNet;
    document.body.appendChild(bar);
  }
}
// Пробуем продлить вход: получится — Supabase сам сообщит об этом, и сайт догрузит свежее (см. listenAuth)
function retryNet() { if (state.offline) sb.auth.getSession().catch(() => {}); else catchUp(); }
window.addEventListener("offline", paintNet);
window.addEventListener("online", () => { paintNet(); retryNet(); });
// Пока сервер недоступен, тихо пробуем сами раз в 20 секунд (когда сайт на экране)
setInterval(() => { if (state.offline && !document.hidden) retryNet(); }, 20000);

function listenAuth() { sb.auth.onAuthStateChange((event, session) => onAuth(event, session)); }

// Supabase не любит, когда внутри этого обработчика сразу ждут другие запросы,
// поэтому сама загрузка запускается следующим шагом через setTimeout.
// state.shown — чьи сохранённые данные уже на экране; state.live — для кого сайт уже работает с сервером
// (живой канал, свежие данные). guess — событие не от Supabase, а наша догадка «сервер молчит» (см. start)
function onAuth(event, session, guess = false) {
  if (!guess) state.authSeen = true;
  // Сервер не ответил при запуске (нет сети, провайдер режет Supabase): продлить вход не удалось, и Supabase сообщает,
  // что входа нет, — хотя на устройстве он цел. Раньше в этот момент открывался экран входа, и человек зря вводил пароль.
  // Теперь остаёмся в аккаунте, показываем сохранённое и ждём связи. Настоящий выход (SIGNED_OUT) стирает сохранённый вход
  let offline = false;
  if (!session && event !== "SIGNED_OUT") { const kept = keptSession(); if (kept) { session = kept; offline = true; } }
  state.session = session; state.offline = offline;
  if (offline && state.live) { state.live = null; stopLive(); }   // связь пропала — вернётся, поднимем всё заново
  paintNet();
  // Вход продлился (новый ключ) — отдаём его и отдельному живому каналу, иначе он отвалится через час
  if (liveSb && session) liveSb.realtime.setAuth(session.access_token);
  setTimeout(async () => {
    if (!session) {
      // Вышли (или вход истёк) — закрываем всё открытое, иначе экран входа остался бы с классами переписки
      stopLive(); closeViewer(true); if (typeof chatLeave === "function") chatLeave();
      state.profiles = []; state.media = []; state.meTab = "profile";
      state.shown = state.live = null;
      // Открыли ссылку-приглашение — показываем её, а не экран входа
      const inv = location.hash.match(/^#\/invite\/([\w-]+)/);
      if (inv) return viewInvite(inv[1]);
      history.replaceState(null, "", "#/");   // после нового входа — сразу лента
      return viewLogin();
    }
    const id = session.user.id;
    if (state.shown !== id) {
      // Уже заходил с этого устройства — показываем сохранённое сразу, свежее догрузится в фоне
      const cached = await readCache();
      if (cached) {
        state.shown = id;
        route();
        if (offline) return;   // без связи — только сохранённое; остальное запустится, когда она вернётся
        state.live = id;
        startLive();
        syncPush();
        refreshInBackground(cached);
        return;
      }
      if (offline) {
        // Связи нет, и сохранённого на этом устройстве тоже нет — показать нечего. Экран входа тут не нужен: вход цел.
        // Сервер ответит — этот же обработчик загрузит сайт как обычно
        $app.innerHTML = `<div class="loading"><p><b>Нет связи с сервером.</b></p><p>Проверь интернет или включи VPN — сайт откроется сам, как только связь появится.</p>
          <p><button type="button" class="btn primary" onclick="location.reload()">Попробовать ещё раз</button></p></div>`;
        return;
      }
      // Мерцающие заготовки ленты, пока грузятся данные (такие же стоят в index.html)
      const heights = [180, 240, 150, 210, 230, 160, 200, 170];
      $app.innerHTML = `<div class="loading skeleton" aria-label="Загружаю"><div class="sk-top"></div><div class="sk-body">
        <div class="sk sk-cover"></div>
        <div class="sk-grid">${heights.map(h => `<div class="sk" style="height:${h}px"></div>`).join("")}</div>
      </div></div>`;
      // Если сервер молчит 20 секунд, не крутим загрузку вечно, а говорим, что делать
      // Таймер убираем, когда загрузилось: иначе через 20 секунд он «падал» впустую (ошибка без обработчика)
      let tmr = null;
      const timeout = new Promise((_, reject) => { tmr = setTimeout(() => reject(new Error("timeout")), 20000); });
      try {
        // Лента и мессенджер грузятся одновременно; мессенджер не мешает остальному сайту
        const chats = loadChats().catch(() => { chat.ready = false; });
        await Promise.race([loadAll(), timeout]);
        clearTimeout(tmr);
        await chats;
        saveCache();
      }
      catch (err) {
        $app.innerHTML = err.message === "timeout"
          ? `<div class="loading"><p><b>Сервер не отвечает.</b></p><p>Переключись с мобильного интернета на Wi‑Fi или включи VPN, потом обнови страницу.</p></div>`
          : `<p class="loading">Не получилось загрузить: ${esc(err.message)}</p>`;
        return;
      }
      state.shown = state.live = id;
      route();
      startLive();
      syncPush();
    } else if (!offline && state.live !== id) {
      // На экране было сохранённое (связи не было), а теперь сервер ответил и вход продлился:
      // поднимаем живой канал и догружаем свежее. null — «перерисуй, даже если данные те же»: ссылки на фото устарели
      state.live = id;
      startLive();
      syncPush();
      if (document.querySelector("[data-offline]")) route();   // на экране «Нет связи» — открываем раздел по-настоящему
      refreshInBackground(null);
    }
  }, 0);
}

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
  if (typeof loadNotifs === "function") loadNotifs();
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
    .on("postgres_changes", { event: "*", schema: "public", table: "comment_likes" }, p => onCommentLike(p.eventType, p.new, p.old))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, p => onNotification(p.new))
    .on("postgres_changes", { event: "*", schema: "public", table: "media" }, p => onMediaChange(p.eventType, p.new, p.old))
    .on("postgres_changes", { event: "*", schema: "public", table: "quotes" }, p => onQuoteChange(p.eventType, p.new, p.old))
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
        // Канал поднялся не в первый раз (был обрыв) — добираем то, что прошло мимо, пока он лежал
        if (liveWasUp) catchUp();
        liveWasUp = true;
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
  pollTimer = setInterval(() => poll(), 15000);
}

// ---------- Догнать пропущенное ----------
// Пока телефон спал или не было связи, живой канал ничего не приносит, а то, что случилось за это время, он потом
// не досылает. Поэтому, когда вернулся в приложение, появилась сеть или канал переподключился, сразу забираем всё
// сами: сообщения, комментарии, реакции, новые фото, а заодно чужие правки и удаления
let hiddenAt = 0, caughtAt = 0, liveWasUp = false;
async function catchUp() {
  if (!state.session || state.offline || document.hidden || Date.now() - caughtAt < 5000) return;
  caughtAt = Date.now();
  try { await poll(true, true); } catch (e) {}
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  // Отходил меньше чем на три секунды — живой канал ничего не потерял
  if (pollTimer || Date.now() - hiddenAt > 3000) catchUp();
});
// С живым каналом отметки на фото, реакции на цитаты и профили сверяем раз в пять минут (у них своих живых событий нет)
setInterval(() => { if (!document.hidden && !pollTimer) syncSlow().catch(() => {}); }, 5 * 60e3);

// Проверка новых данных: сравниваем с тем, что уже есть на странице.
// Каждые 15 секунд тянем только новое (комментарии и реакции позже последних известных). Раз в минуту — полная
// сверка: что удалили. Раньше все реакции перекачивались каждые 15 секунд — при тысячах реакций это сотни мегабайт
// за вечер с одного открытого сайта (у Supabase на бесплатном тарифе лимит трафика)
let pollCount = 0;
// full — полная сверка (что удалили и изменили); по расписанию она идёт каждый четвёртый раз.
// quiet — догоняем пропущенное: сообщения встают на место без звука и баннера на каждое
async function poll(full, quiet = false) {
  if (document.hidden || !state.session || state.offline) return;
  if (typeof full !== "boolean") full = pollCount++ % 4 === 0;
  const newest = list => list.reduce((a, x) => x.created_at > a ? x.created_at : a, "1970-01-01T00:00:00Z");
  // Удалённые ищем только среди того, что знали до запроса: пришедшее по живому каналу, пока он шёл, в ответ могло не попасть
  const before = state.comments.slice(), mrBefore = state.mr.slice();
  // Порциями по 1000: если взять только первую тысячу, остальные при полной сверке посчитались бы удалёнными
  const [cNew, cIds, rNew, rAll, m, q] = await Promise.all([
    sb.from("comments").select("*").gte("created_at", newest(state.comments)).order("created_at"),
    full ? fetchAll(() => sb.from("comments").select("id").order("created_at")) : null,
    full ? null : sb.from("media_reactions").select("*").gte("created_at", newest(state.mr)).order("created_at"),
    full ? fetchAll(() => sb.from("media_reactions").select("media_id, user_id, emoji, created_at").order("created_at")) : null,
    sb.from("media").select("id, owner, kind, created_at").order("created_at", { ascending: false }).limit(20),
    sb.from("quotes").select("id, added_by, created_at").order("created_at", { ascending: false }).limit(20)
  ]);
  (cNew.data || []).forEach(x => onComment("INSERT", x));   // повторы onComment отсеет сам
  if (cIds?.data && !cIds.partial) {
    const alive = new Set(cIds.data.map(x => x.id));
    before.filter(x => !alive.has(x.id)).forEach(x => onComment("DELETE", null, x));
  }
  const key = x => `${x.media_id}|${x.user_id}|${x.emoji}`;
  const r = rAll || rNew;
  if (r?.data) {
    const have = new Set(state.mr.map(key));
    r.data.filter(x => !have.has(key(x))).forEach(x => onReact("INSERT", x));
    if (rAll && !rAll.partial) { const fresh = new Set(rAll.data.map(key)); mrBefore.filter(x => !fresh.has(key(x))).forEach(x => onReact("DELETE", null, x)); }
  }
  (m.data || []).filter(x => !state.media.some(y => y.id === x.id)).forEach(x => onNewStuff("media", x));
  (q.data || []).filter(x => !state.quotes.some(y => y.id === x.id)).forEach(x => onNewStuff("quote", x));
  await chatPoll(quiet);
  if (full) { await syncSlow(quiet); if (typeof loadNotifs === "function") loadNotifs(); }
}

// Сверка того, о чём живой канал не сообщает: чужие правки фото (подпись, дата, отметки), удалённые фото и цитаты,
// реакции на цитаты, профили (имя, аватарка, статус, цвет). force — сверить прямо сейчас (вернулся в приложение)
let slowAt = 0;
async function syncSlow(force = false) {
  if (!state.session || state.offline || (!force && Date.now() - slowAt < 120e3)) return;
  slowAt = Date.now();
  // Сверяем только то, что знали до запроса: загруженное, пока он шёл, в ответ могло не попасть
  const before = state.media.slice(), quotesBefore = state.quotes.slice();
  const [m, q, qr, p] = await Promise.all([
    fetchAll(() => sb.from("media").select("id, caption, taken_at, media_people(person_id)").order("created_at")),
    fetchAll(() => sb.from("quotes").select("id").order("created_at")),
    state.reactsReady ? fetchAll(() => sb.from("quote_reactions").select("*").order("created_at")) : { data: null },
    sb.from("profiles").select("*").order("name")
  ]);
  // Чего нет в ответе — возможно, удалено. Перед тем как убрать у себя, переспрашиваем базу именно про эти записи:
  // длинный список приходит частями, и запись могла «выпасть» между ними, хотя на самом деле она на месте
  const reallyGone = async (table, ids) => {
    if (!ids.length || ids.length > 100) return [];
    const { data, error } = await sb.from(table).select("id").in("id", ids);
    if (error) return [];
    const alive = new Set(data.map(x => x.id));
    return ids.filter(id => !alive.has(id));
  };
  if (m.data && !m.partial) {
    const fresh = new Map(m.data.map(x => [x.id, x]));
    before.forEach(cur => {
      const f = fresh.get(cur.id);
      if (f) mediaEdited(cur.id, { caption: f.caption, taken_at: f.taken_at, people: (f.media_people || []).map(r => r.person_id) });
    });
    (await reallyGone("media", before.filter(x => !fresh.has(x.id)).map(x => x.id))).forEach(mediaGone);
  }
  if (q.data && !q.partial) {
    const alive = new Set(q.data.map(x => x.id));
    (await reallyGone("quotes", quotesBefore.filter(x => !alive.has(x.id)).map(x => x.id))).forEach(quoteGone);
  }
  if (qr.data && !qr.partial) {
    const key = r => `${r.quote_id}|${r.user_id}|${r.emoji}`;
    const was = new Set(state.qr.map(key)), now = new Set(qr.data.map(key));
    const changed = [...state.qr.filter(r => !now.has(key(r))), ...qr.data.filter(r => !was.has(key(r)))];
    if (changed.length) {
      state.qr = qr.data;
      new Set(changed.map(r => `${r.quote_id}|${r.emoji}`)).forEach(k => { const [id, emoji] = k.split("|"); paintReact("q", id, emoji); });
    }
  }
  if (p.data?.length) {
    const strip = list => JSON.stringify(list.map(({ last_seen, ...x }) => x));
    const changed = strip(p.data) !== strip(state.profiles);
    state.profiles = p.data;
    // Новое имя или аватарка появятся при следующем переходе по сайту — страницу под рукой не перерисовываем
    if (changed) await signed(state.profiles.flatMap(x => [x.avatar_path, x.cover_path]).filter(Boolean));
  }
  saveCache();
}

// Живые события о фото и цитатах: новое, изменённое, удалённое
function onMediaChange(type, n, o) {
  if (type === "INSERT" && n) return onNewStuff("media", n);
  if (type === "UPDATE" && n) return mediaEdited(n.id, { caption: n.caption, taken_at: n.taken_at });
  if (type === "DELETE" && o?.id) mediaGone(o.id);
}
function onQuoteChange(type, n, o) {
  if (type === "INSERT" && n) return onNewStuff("quote", n);
  if (type === "DELETE" && o?.id) quoteGone(o.id);
}

// Кто-то изменил фото: подпись, дату или отметки. Обновляем на месте — пост в ленте и открытый просмотр
function mediaEdited(id, { caption, taken_at, people }) {
  const m = state.media.find(x => x.id === id); if (!m) return;
  const samePeople = !people || (people.length === m.people.length && people.every(p => m.people.includes(p)));
  if ((caption || null) === (m.caption || null) && (taken_at || null) === (m.taken_at || null) && samePeople) return;
  Object.assign(m, { caption: caption || null, taken_at: taken_at || null });
  if (people) m.people = people;
  // Это фото сейчас редактируют или под ним пишут комментарий — не перерисовываем из-под рук, обновится при закрытии
  const busy = document.querySelector(".me-wrap") || (state.viewing === id && document.querySelector(".viewer textarea")?.value.trim());
  if (!busy) refreshMediaEverywhere(m);
}

// Кто-то удалил своё фото: убираем его у себя отовсюду, где оно сейчас видно
function mediaGone(id) {
  if (!state.media.some(x => x.id === id)) return;
  state.media = state.media.filter(x => x.id !== id);
  state.comments = state.comments.filter(c => c.media_id !== id);
  state.mr = state.mr.filter(r => r.media_id !== id);
  if (state.viewing === id) { closeViewer(); toast("Это фото только что удалили"); }
  // Списки ленты трогаем, только когда просмотр закрыт: открытый просмотр листает по своему списку
  if (!document.getElementById("viewer")) {
    const f = state.feed, i = f?.list?.findIndex(x => x.id === id) ?? -1;
    if (i >= 0) { f.list.splice(i, 1); if (i < f.shown) f.shown--; }
    [state.fnewList, state.current].forEach(l => { const k = l?.findIndex?.(x => x.id === id) ?? -1; if (k >= 0) l.splice(k, 1); });
  }
  document.querySelector(`[data-post="${id}"]`)?.remove();
  document.querySelectorAll(`.tile[data-open="${id}"]`).forEach(el => el.remove());
  saveCache();
  paintNewCounts();
}

function quoteGone(id) {
  if (!state.quotes.some(q => q.id === id)) return;
  state.quotes = state.quotes.filter(q => q.id !== id);
  state.qr = state.qr.filter(r => r.quote_id !== id);
  document.querySelector(`[data-quote="${id}"]`)?.remove();
  saveCache();
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
  if (type === "UPDATE" && n) {
    const c = state.comments.find(x => x.id === n.id);
    if (c && (c.text !== n.text || c.edited_at !== n.edited_at)) { Object.assign(c, { text: n.text, edited_at: n.edited_at }); repaintComment(c.id); refreshPost(c.media_id); }
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
  // Браузер умеет анимацию от прокрутки — параллакс сделан в style.css и идёт без скрипта, плавнее
  if (window.CSS?.supports?.("animation-timeline: view()")) return;
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
  if (kind === "media" && !state.media.some(m => m.id === row.id)) mergeNewMediaSoon();
  if (who === me() || announced.has(row.id)) return;
  announced.add(row.id);
  // Нажал на баннер о фото — открывается пачка этого человека, а не вся лента
  const open = kind === "media"
    ? async () => { await mergeNewMedia(); location.hash = `#/new/${who}`; route(); }
    : async () => { await loadAll(); location.hash = "#/quotes"; route(); };
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

// Новые фото приходят по одному (живой канал или проверка раз в 15 секунд). Через 4 секунды после последнего
// забираем из базы всё, что новее известного, — сразу с отметками, кто на фото, — и тихо добавляем.
// Кнопка «Смотреть новые фото» и вкладка «Новое» обновляются сами, а лента под рукой не перерисовывается
let mergeTimer = null, merging = null;
function mergeNewMediaSoon() { clearTimeout(mergeTimer); mergeTimer = setTimeout(mergeNewMedia, 4000); }
async function mergeNewMedia() {
  clearTimeout(mergeTimer);
  if (merging) return merging.catch(() => {});   // уже забираем — ждём тот же запрос, второй не нужен
  merging = (async () => {
    const since = state.media.reduce((a, m) => m.created_at > a ? m.created_at : a, "1970-01-01T00:00:00Z");
    const { data, error } = await sb.from("media").select("*, media_people(person_id)").gt("created_at", since).order("created_at", { ascending: false });
    if (error || !data?.length) return;
    const have = new Set(state.media.map(m => m.id));
    const fresh = data.filter(x => !have.has(x.id)).map(toMedia);
    if (!fresh.length) return;
    state.media = [...fresh, ...state.media];
    saveCache();
    paintNewCounts();
  })();
  try { await merging; } catch (e) {} finally { merging = null; }
}
// Сколько нового — на кнопке над лентой и на вкладках галереи (без перерисовки остальной страницы)
function paintNewCounts() {
  const bar = document.getElementById("feedBar");
  if (bar && !(state.fnew && state.fnewList)) bar.outerHTML = feedBarHtml();
  const tabs = document.querySelector("#galleryGrid .g-tabs");
  if (tabs) {
    const { kind } = galleryView(), f = state.galleryFilter;
    const base = ofKind(f ? tagged(f) : state.media, kind);
    tabs.outerHTML = galleryTabsHtml(base.length, base.filter(isNew).length);
  }
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
