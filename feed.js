// Корефаны: лента, «новое для тебя», галерея, поиск, цитаты. Часть бывшего app.js — общие вещи берёт оттуда.

// ---------- Новое для тебя ----------
// Что ты уже видел, помнит само устройство: общая отметка «Всё видел» (base), у каждого корефана — «до этого времени
// всё посмотрено» (by) и отдельные посмотренные фото (ids). Новое — чужие фото, загруженные позже отметок и ещё не
// открытые. Свои фото новыми не бывают. Отдельные фото нужны, чтобы просмотр свежей пачки не «съедал» более старую,
// которую ты ещё не видел
const NEW_DAYS = 3;   // при первом запуске новым считается то, что загрузили за последние три дня
const ms = d => new Date(d).getTime() || 0;
function seenMarks() {
  if (state.seen?.uid === me()) return state.seen;
  let v = null;
  try { v = JSON.parse(localStorage.getItem("korefany-seen-" + me()) || "null"); } catch {}
  const first = !v || typeof v.base !== "number";
  state.seen = { uid: me(), base: first ? Date.now() - NEW_DAYS * 864e5 : v.base, by: (!first && v.by) || {}, ids: new Set((!first && v.ids) || []) };
  if (first) saveSeen();
  return state.seen;
}
function saveSeen() {
  const s = state.seen;
  try { localStorage.setItem("korefany-seen-" + s.uid, JSON.stringify({ base: s.base, by: s.by, ids: [...s.ids] })); } catch {}
}
const isNew = m => {
  if (!me() || m.owner === me()) return false;
  const s = seenMarks();
  return ms(m.created_at) > Math.max(s.base, s.by[m.owner] || 0) && !s.ids.has(m.id);
};
// Новые сверху — по времени загрузки, а не по дате снимка
const byAdded = (a, b) => ms(b.created_at) - ms(a.created_at);
const newMedia = () => state.media.filter(isNew).sort(byAdded);
function markViewed(list) {
  const s = seenMarks();
  list.forEach(m => { if (isNew(m)) s.ids.add(m.id); });
  // У кого посмотрено всё новое — отдельные отметки заменяем одной «до этого времени», чтобы список не рос
  const owners = new Set(state.media.filter(m => s.ids.has(m.id)).map(m => m.owner));
  owners.forEach(o => {
    const fresh = state.media.filter(m => m.owner === o && ms(m.created_at) > Math.max(s.base, s.by[o] || 0));
    if (!fresh.every(m => s.ids.has(m.id))) return;
    s.by[o] = fresh.reduce((t, m) => Math.max(t, ms(m.created_at)), s.by[o] || 0);
    fresh.forEach(m => s.ids.delete(m.id));
  });
  // Удалённые фото из отметок убираем
  if (state.media.length) { const alive = new Set(state.media.map(m => m.id)); s.ids.forEach(id => { if (!alive.has(id)) s.ids.delete(id); }); }
  saveSeen();
}
function markAllViewed() {
  const s = seenMarks();
  s.base = state.media.reduce((t, m) => Math.max(t, ms(m.created_at)), s.base);
  s.by = {}; s.ids.clear();
  saveSeen();
}
// Новое по людям: [[кто, [его фото...]], ...], первым — кто загрузил позже всех
function byOwner(list) {
  const map = new Map();
  for (const m of list) { if (!map.has(m.owner)) map.set(m.owner, []); map.get(m.owner).push(m); }
  return [...map.entries()];
}
// «12 фото и 1 видео»
function countText(list) {
  const v = list.filter(m => m.kind === "video").length, p = list.length - v;
  return [p && `${p} фото`, v && `${v} видео`].filter(Boolean).join(" и ");
}
// «сегодня в 21:46», «вчера в 9:05», иначе «24 октября 2026»
function whenText(d) {
  const x = new Date(d), t = new Date(), y = new Date(t); y.setDate(t.getDate() - 1);
  const hm = `${x.getHours()}:${String(x.getMinutes()).padStart(2, "0")}`;
  if (x.toDateString() === t.toDateString()) return `сегодня в ${hm}`;
  if (x.toDateString() === y.toDateString()) return `вчера в ${hm}`;
  return dayText(x);
}

// Лента «как это было»: посты как в Инстаграме, новые сверху, между месяцами — подпись месяца.
// Посты подгружаются порциями по мере прокрутки, чтобы не грузить сразу все фото
const FEED_STEP = 10;
let feedObserver = null;

// Порядок ленты выбирается в шторке и запоминается на устройстве
const F_SORTS = [["taken", "По дате события", "когда снято"], ["added", "По дате добавления", "когда загрузили"],
  ["top", "Популярные", "больше реакций"], ["talk", "Обсуждаемые", "больше комментариев"], ["rnd", "Вперемешку", ""]];
function feedSort() {
  if (!state.fsort) {
    let v = null;
    try { v = localStorage.getItem("korefany-feed-sort"); } catch {}
    state.fsort = F_SORTS.some(s => s[0] === v) ? v : "taken";
  }
  return state.fsort;
}
function feedList(sort) {
  const list = [...state.media];
  if (sort === "taken") return list.sort((a, b) => (b.taken_at || b.created_at).localeCompare(a.taken_at || a.created_at));
  if (sort === "added") return list.sort(byAdded);
  return sortMedia(list, sort);
}
// Альбом (п. 18): фото одной пачки — один пост, они листаются внутри. В ленте остаётся первое фото альбома
const albumOf = m => m.album ? state.media.filter(x => x.album === m.album).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)) : [m];
function foldAlbums(list) {
  const seen = new Set();
  return list.filter(m => !m.album || (!seen.has(m.album) && seen.add(m.album)));
}
// Для просмотра на весь экран альбом разворачивается обратно: листаешь все его фото подряд
const unfoldAlbums = list => list.flatMap(m => m.album ? albumOf(m) : [m]);
const SORT_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"/></svg>`;

// Над лентой: синяя «Смотреть новые фото» и значок порядка (или полоска «Новые для тебя», когда они открыты)
function feedBarHtml() {
  if (!state.media.length) return "";
  if (state.fnew && state.fnewList) return `<div class="newsbar" id="feedBar"><span>Новые для тебя <b>${state.fnewList.length}</b></span>
      <button type="button" class="link-btn" data-seen-all>Всё видел</button>
      <button type="button" class="newsbar-x" data-fnew-close aria-label="Показать всю ленту">✕</button></div>`;
  const n = newMedia().length, sort = feedSort(), sortName = F_SORTS.find(s => s[0] === sort)[1];
  return `<div class="feed-top" id="feedBar"><div class="feedbar${n ? "" : " only-sort"}">
      ${n ? `<button type="button" class="newbtn" data-fnew>Смотреть новые фото <em>${n}</em></button>` : ""}
      <button type="button" class="sortbtn" data-fsheet aria-label="Порядок ленты: ${sortName}" title="Порядок ленты">${SORT_ICON}${n ? "" : `<span>${sortName}</span>`}</button>
      ${state.v132 ? `<a class="sortbtn ev-btn" href="#/events" aria-label="Сходки" title="Сходки">📅</a>` : ""}
    </div>
    ${n && sort !== "taken" ? `<p class="feedsub">Порядок: <b>${sortName.toLowerCase()}</b></p>` : ""}</div>`;
}

async function viewFeed() {
  // «Новые для тебя»: список запоминается, когда нажал кнопку, — посмотренные посты не пропадают из-под пальца
  const fresh = state.fnew && state.fnewList;
  const sort = feedSort();
  const list = fresh ? state.fnewList : foldAlbums(feedList(sort));
  state.feed = { list, shown: 0, lastMonth: null, months: !fresh && sort === "taken", fresh };
  state.current = fresh ? list : unfoldAlbums(list);
  // На телефоне кнопка над обложкой — видна сразу. На компьютере — под обложкой, над колонкой постов
  const bar = feedBarHtml(), top = PHONE.matches;
  if (!fresh) await prepOnThisDay();
  shell("feed", `
    ${bdayBanner()}
    ${fresh ? "" : onThisDayHtml()}
    ${top ? bar : ""}
    ${fresh ? "" : await coverHtml()}
    ${top ? "" : bar}
    ${list.length ? `<div class="feed" id="feed"></div><div class="feed-more" id="feedMore"></div>`
      : fresh ? `<div class="empty">Ничего нового, ты всё видел. <button type="button" class="link-btn" data-fnew-close>Показать всю ленту</button></div>`
      : `<div class="empty">Пока ничего нет. <a href="#/upload">Загрузи первое фото</a>, и с него начнётся история.</div>`}`);
  if (!fresh) { startCover(); wireParallax(); }
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
  try { await signed(part.flatMap(m => (f.fresh ? [m] : albumOf(m)).flatMap(x => [x.path, thumbPath(x), midPath(x)]))); } finally { f.loading = false; }
  if (!document.body.contains(feed)) return;
  let html = "";
  part.forEach((m, i) => {
    // Подписи месяцев только в порядке «по дате события»: в остальных месяцы идут вперемешку
    const month = f.months && monthOf(m);
    if (month && month !== f.lastMonth) { html += `<div class="feed-month"><span>${month}</span></div>`; f.lastMonth = month; }
    html += postHtml(m, i, !f.fresh);
  });
  // В «Новых для тебя» показанные посты считаются посмотренными (метку «НОВОЕ» они уже получили)
  if (f.fresh) markViewed(part);
  // Выплывают только первые посты. Догруженные при прокрутке встают сразу, иначе при быстрой прокрутке
  // их ловишь полупрозрачными и с задержкой
  if (f.shown > part.length) html = html.replaceAll(`<article class="post"`, `<article class="post quiet"`);
  feed.insertAdjacentHTML("beforeend", html);
  keepNear(feed);
  const more = document.getElementById("feedMore");
  if (more) {
    if (f.shown < f.list.length) more.textContent = "Загружаю ещё...";
    else if (f.fresh) more.innerHTML = `Ты всё посмотрел ✓ <button type="button" class="link-btn" data-fnew-close>Показать всю ленту</button>`;
    else more.textContent = "Это всё. Дальше история только начинается 🔥";
  }
  // Низ ленты всё ещё на экране (короткие посты или быстрая прокрутка) — догружаем следующую порцию сами
  if (more && f.shown < f.list.length && more.getBoundingClientRect().top < innerHeight + 1600) setTimeout(appendPosts, 50);
}

function postHtml(m, i = 0, asAlbum = false) {
  const items = asAlbum ? albumOf(m) : [m];
  const slide = x => `<div class="post-media" data-post-media="${x.id}">${x.kind === "video"
      ? videoTag(x, `controls playsinline style="aspect-ratio:${mediaSize(x.id)?.join(" / ") || "4 / 5"}"`)
      : postPicture(x)}</div>`;
  const first = items[0];
  return `<article class="post${items.length > 1 ? " is-album" : ""}" data-post="${m.id}" data-alb-cur="${first.id}" style="--i:${i}">
    <header class="post-head">
      <a href="#/p/${m.owner}" class="post-who" style="${ucStyle(m.owner)}">${avatar(m.owner)}<div><b>${esc(nameOf(m.owner))}</b><span>${dayText(m.taken_at || m.created_at)}${items.length > 1 ? ` · ${items.length} ${plural(items.length, ["фото", "фото", "фото"])}` : ""}</span></div></a>
      ${items.some(isNew) ? `<span class="post-new">Новое</span>` : ""}
      <button type="button" class="post-edit" data-edit-media="${m.id}" aria-label="${m.owner === me() ? "Изменить: кто на фото, подпись, дата" : "Отметить, кто на фото"}" title="${m.owner === me() ? "Изменить" : "Отметить, кто на фото"}">${m.owner === me() ? "✎" : "👥"}</button>
    </header>
    ${items.length > 1 ? `<div class="alb"><div class="alb-track" data-alb>${items.map(slide).join("")}</div>
      <span class="alb-count">1 / ${items.length}</span>
      <div class="alb-dots">${items.map((x, k) => `<i class="${k ? "" : "on"}"></i>`).join("")}</div></div>` : slide(m)}
    <div class="post-body">${postBody(first)}</div>
  </article>`;
}
function postBody(m) {
  const cc = state.comments.filter(c => c.media_id === m.id).length;
  return `<div class="post-actions">
        ${reactButtons("m", m.id)}
        ${state.commentsReady ? `<button type="button" class="react post-cbtn" data-post-comment="${m.id}" aria-label="Комментарии">💬<span data-ccount="${m.id}">${cc || ""}</span></button>` : ""}
      </div>
      ${m.caption ? `<p class="post-cap"><b>${esc(nameOf(m.owner))}</b> ${esc(m.caption)}</p>` : ""}
      ${m.people.length ? `<p class="post-people">На фото: ${m.people.map(p => `<a href="#/p/${p}">${esc(nameOf(p))}</a>`).join(", ")}</p>` : ""}
      <div class="post-comments" data-cprev="${m.id}">${commentsPreview(m)}</div>`;
}
// Листаешь альбом — реакции, подпись и комментарии под ним меняются на текущее фото
document.addEventListener("scroll", e => {
  const track = e.target.closest?.("[data-alb]"); if (!track) return;
  clearTimeout(track._t);
  track._t = setTimeout(() => {
    const k = Math.round(track.scrollLeft / track.clientWidth), post = track.closest(".post");
    const slide = track.children[k]; if (!slide || !post) return;
    const id = slide.dataset.postMedia, m = state.media.find(x => x.id === id); if (!m || post.dataset.albCur === id) return;
    post.dataset.albCur = id;
    post.querySelector(".alb-count").textContent = `${k + 1} / ${track.children.length}`;
    post.querySelectorAll(".alb-dots i").forEach((d, j) => d.classList.toggle("on", j === k));
    post.querySelector(".post-body").innerHTML = postBody(m);
  }, 80);
}, true);

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
  if (sizes[id]) return sizes[id];
  // Размер записан в базе при загрузке (22_v132.sql) — тогда лента не прыгает даже на новом телефоне
  const m = state.media.find(x => x.id === id);
  return m?.width && m?.height ? [m.width, m.height] : undefined;
}
// Своё фото без размера в базе — дописываем один раз (у старых фото его нет). Колонок нет — тихо перестаём
let sizeColsMissing = false;
const sizeSaved = new Set();
function saveSizeToDb(id, w, h) {
  const m = state.media.find(x => x.id === id);
  if (sizeColsMissing || !m || m.owner !== me() || m.width || sizeSaved.has(id) || state.offline) return;
  sizeSaved.add(id);
  sb.from("media").update({ width: w, height: h }).eq("id", id).then(({ error }) => {
    if (error && /width|column/i.test(error.message || "")) sizeColsMissing = true;
    else if (!error) Object.assign(m, { width: w, height: h });
  });
}
function rememberSize(id, w, h) {
  if (id && w && h) saveSizeToDb(id, w, h);
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
  // Чёткое фото в посте проявилось — размытое превью под ним больше не нужно. Убираем его: на iPhone каждое
  // такое превью держало в памяти ещё одну картинку и размытый слой, и от этого лента падала из-за нехватки памяти
  if (el.classList?.contains("full") && el.classList.contains("fade")) {
    const box = el.closest(".post-media"), ph = box?.querySelector("img.ph");
    if (ph) setTimeout(() => {
      if (!el.isConnected || el.dataset.sleep || !el.complete || !el.naturalWidth) return;
      box.classList.add("solid"); ph.remove();
    }, 450);
  }
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
    { rootMargin: "1200px 0px" });   // полтора экрана телефона вверх и вниз: проснуться фото успевают, а в памяти их вдвое меньше
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
  // Фото из альбома, которое сейчас не на экране, — подвал не трогаем: он покажет свежее при пролистывании
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
    const btn = el.closest(".post")?.querySelector(`[data-react="m"][data-id="${id}"][data-emoji="heart"]`);
    if (btn && btn.getAttribute("aria-pressed") !== "true") toggleReact(btn);
    return;
  }
  clearTimeout(postTap.timer);
  postTap = { id, timer: setTimeout(() => { postTap = { id: null, timer: null }; openViewer(id, 0, el.querySelector("img.full.loaded, img.full:not(.fade)") || el.querySelector("img.ph")); }, 260) };
}

// Обложка ленты: случайные фото сменяют друг друга, плюс счётчики.
// Каждое фото видно целиком, а по бокам — его же размытая копия, чтобы ничего не обрезалось
const COVER_COUNT = 12, COVER_EVERY = 5000;
let coverTimer = null, coverSeen = null;

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
    <div class="cover-stage">${slides.map((m, i) => {
      // Сразу грузим только первое фото и соседей (второе и последнее), остальные — когда до них дойдёт очередь
      const now = i < 2 || i === slides.length - 1 ? "src" : "data-src";
      return `<div class="cover-slide${i === 0 ? " on" : ""}" data-cover-open="${m.id}">
      <img class="cs-bg" ${now}="${url(thumbPath(m)) || url(m.path)}" alt="" decoding="async">
      <img class="cs-fg fade" ${now}="${url(midPath(m)) || url(m.path)}" alt="" decoding="async">
    </div>`;
    }).join("")}</div>
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
  // В памяти держим только текущее фото обложки и двух соседей. Раньше за пару минут подгружались все 12 больших фото
  // и так и оставались в памяти, даже когда ты далеко внизу ленты, — iPhone от этого перезагружал сайт
  const at = i => slides[(i + slides.length) % slides.length];
  const load = i => at(i).querySelectorAll("img[data-src]").forEach(img => { img.src = img.dataset.src; img.removeAttribute("data-src"); });
  const unload = s => s.querySelectorAll("img[src]").forEach(img => { img.dataset.src = img.getAttribute("src"); img.removeAttribute("src"); });
  const near = s => [-1, 0, 1].some(d => at(cur + d) === s);
  const tidy = () => slides.forEach(s => { if (!near(s) && !s.classList.contains("leaving")) unload(s); });
  const go = (n, dir) => {
    n = (n + slides.length) % slides.length;
    if (n === cur) return;
    load(n); load(n + 1); load(n - 1);
    const out = slides[cur], inn = slides[n];
    // Новое фото ставим сбоку без анимации, потом плавно заезжает, а старое уезжает в другую сторону.
    // Уезжающий слайд рисуется, пока едет (.leaving), потом перестаёт — рисуются только видимые
    clearTimeout(inn.leaveTimer); inn.classList.remove("leaving");
    inn.style.transition = "none"; inn.style.transform = `translateX(${dir * 100}%)`;
    void inn.offsetWidth;
    inn.style.transition = ""; inn.style.transform = "";
    inn.classList.add("on");
    out.classList.remove("on"); out.classList.add("leaving"); out.style.transform = `translateX(${-dir * 100}%)`;
    clearTimeout(out.leaveTimer); out.leaveTimer = setTimeout(() => { out.classList.remove("leaving"); tidy(); }, 950);
    dots[cur]?.classList.remove("on"); dots[n]?.classList.add("on");
    cur = n;
  };
  // Обложку не видно (долистал вниз) — фото на ней не листаются. А когда она дальше полутора экранов,
  // её фото выгружаются совсем и возвращаются заранее, ещё до того, как ты до неё долистаешь обратно
  const inView = () => { const r = cover.getBoundingClientRect(); return r.bottom > -200 && r.top < innerHeight + 200; };
  coverSeen?.disconnect();
  coverSeen = window.IntersectionObserver ? new IntersectionObserver(es => {
    if (es[0].isIntersecting) { load(cur); load(cur + 1); load(cur - 1); }
    else slides.forEach(unload);
  }, { rootMargin: "1500px 0px" }) : null;
  coverSeen?.observe(cover);
  const restart = () => {
    clearInterval(coverTimer);
    coverTimer = setInterval(() => {
      if (!document.body.contains(cover)) { clearInterval(coverTimer); coverSeen?.disconnect(); return; }
      if (!document.hidden && inView()) go(cur + 1, 1);
    }, COVER_EVERY);
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
    <section id="galleryGrid" data-cols="${galleryCols()}"></section>`);
  await renderGallery();
  wireGalleryPinch(document.getElementById("galleryGrid"));
}

// ---------- Щипок в галерее, как в «Фото» на iPhone (только на телефоне) ----------
// Свёл пальцы — фото мельче и больше в ряд (2 → 3 → 5 → 9), развёл — крупнее. На 5 и 9 видны подписи месяцев.
// Сетка едет за пальцами, а при смене размера фото под пальцами остаётся на месте
const G_LEVELS = [2, 3, 5, 9];
function galleryCols() {
  let n = 3;
  try { n = +localStorage.getItem("korefany-gcols") || 3; } catch {}
  return G_LEVELS.includes(n) ? n : 3;
}
function wireGalleryPinch(box) {
  if (!box) return;
  let start = null, lastPinch = 0, raf = 0;
  const EASE = "transform .42s cubic-bezier(.22, 1, .36, 1)";
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const gridEl = () => box.querySelector(".grid.sq");
  // Слой для масштаба нужен только на время жеста: постоянный will-change на длинной сетке
  // заставляет iPhone держать в памяти огромную картинку, и всё дёргается
  const settle = g => {
    const done = e => { if (e && e.target !== g) return; g.removeEventListener("transitionend", done); if (!start) g.style.willChange = ""; };
    g.addEventListener("transitionend", done);
    setTimeout(done, 600);
  };
  box.addEventListener("touchstart", e => {
    if (e.touches.length !== 2 || !PHONE.matches || !gridEl()) return;
    const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2, my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    // Во вкладке «Новое» сеток несколько (по человеку) — масштабируем ту, что под пальцами
    const g = document.elementFromPoint(mx, my)?.closest("#galleryGrid .grid.sq") || gridEl(), r = g.getBoundingClientRect();
    const i = G_LEVELS.indexOf(galleryCols());
    start = { d: dist(e.touches), mx, my, ratio: 1, g, canIn: i > 0, canOut: i < G_LEVELS.length - 1 };
    // Фото под пальцами: после смены размера сетки возвращаем его на то же место экрана
    start.anchor = document.elementFromPoint(mx, my)?.closest(".tile");
    g.style.willChange = "transform";
    g.style.transformOrigin = `${mx - r.left}px ${my - r.top}px`;
    g.style.transition = "none";
  }, { passive: true });
  box.addEventListener("touchmove", e => {
    if (!start || e.touches.length !== 2) return;
    e.preventDefault();   // иначе iPhone приближает всю страницу
    let r = dist(e.touches) / start.d;
    // Дальше крупнее или мельче нельзя — сетка тянется «резинкой», а не упирается
    if (r > 1 && !start.canIn) r = 1 + (r - 1) * .25;
    if (r < 1 && !start.canOut) r = 1 - (1 - r) * .25;
    // Мягкий предел вместо жёсткого: чем дальше, тем туже
    r = r > 1 ? 1 + 1.4 * Math.tanh((r - 1) / 1.4) : 1 - .6 * Math.tanh((1 - r) / .6);
    start.ratio = r;
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (start) start.g.style.transform = `scale(${start.ratio})`; });
  }, { passive: false });
  const end = () => {
    if (!start) return;
    cancelAnimationFrame(raf); raf = 0;
    const { ratio, g, anchor, my } = start; start = null; lastPinch = Date.now();
    const from = galleryCols(), i = G_LEVELS.indexOf(from);
    // Свёл заметно — на шаг мельче, сильно — на два; развёл — наоборот
    const step = ratio < .55 ? 2 : ratio < .85 ? 1 : ratio > 1.8 ? -2 : ratio > 1.18 ? -1 : 0;
    const to = G_LEVELS[Math.max(0, Math.min(G_LEVELS.length - 1, i + step))];
    if (to === from) {
      g.style.transition = EASE;
      g.style.transform = "";
      settle(g);
      return;
    }
    try { localStorage.setItem("korefany-gcols", to); } catch {}
    box.dataset.cols = to;
    // Новая сетка сначала того же масштаба, что был под пальцами, и плавно садится на место.
    // Мерить место фото можно только без масштаба
    g.style.transition = "none";
    g.style.transform = "";
    if (anchor?.isConnected) {
      const a = anchor.getBoundingClientRect();
      scrollBy(0, a.top + a.height / 2 - my);
      const r = g.getBoundingClientRect(), ar = anchor.getBoundingClientRect();
      g.style.transformOrigin = `${ar.left + ar.width / 2 - r.left}px ${ar.top + ar.height / 2 - r.top}px`;
    }
    g.style.transform = `scale(${ratio * to / from})`;
    void g.offsetWidth;
    g.style.transition = EASE;
    g.style.transform = "";
    settle(g);
  };
  box.addEventListener("touchend", e => { if (start && e.touches.length < 2) end(); });
  box.addEventListener("touchcancel", end);
  // Пальцы отпустили не одновременно — второй не должен «нажать» на фото
  box.addEventListener("click", e => { if (Date.now() - lastPinch < 400) { e.stopPropagation(); e.preventDefault(); } }, true);
  // Safari приближает страницу своим жестом, даже если touchmove отменён — гасим и его
  box.addEventListener("gesturestart", e => e.preventDefault());
  // Подсказка один раз на устройство
  if (PHONE.matches) {
    let seen = false;
    try { seen = localStorage.getItem("korefany-pinch-hint"); localStorage.setItem("korefany-pinch-hint", "1"); } catch {}
    if (!seen) setTimeout(() => box.isConnected && toast("Сведи или разведи пальцы — фото станут мельче или крупнее"), 1200);
  }
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

// Вкладки над сеткой галереи: «Все · N» и «Новое · N»
const galleryTabsHtml = (all, fresh) => `<div class="g-tabs" role="tablist">
    <button type="button" class="g-tab" role="tab" data-gnew="0" aria-selected="${!state.gnew}">Все · ${all}</button>
    <button type="button" class="g-tab new" role="tab" data-gnew="1" aria-selected="${!!state.gnew}">${fresh ? `<i></i>` : ""}Новое · ${fresh}</button>
  </div>`;

// Перерисовать только сетку и подсветку постеров, без перезагрузки всей страницы.
// gallerySeq: быстро переключили несколько раз — сетку рисует только последний вызов
let gallerySeq = 0;
async function renderGallery() {
  const seq = ++gallerySeq;
  const f = state.galleryFilter, { kind, sort } = galleryView();
  document.querySelectorAll("[data-gfilter]").forEach(b => b.setAttribute("aria-pressed", b.dataset.gfilter === f));
  document.getElementById("posters")?.classList.toggle("filtered", !!f);
  const base = ofKind(f ? tagged(f) : state.media, kind);
  const fresh = base.filter(isNew).sort(byAdded);
  const list = state.gnew ? fresh : sortMedia([...base], sort);
  state.current = list;
  paintGallerySheet();
  const box = document.getElementById("galleryGrid"); if (!box) return;
  const tabs = galleryTabsHtml(base.length, fresh.length);
  if (state.gnew) {
    // Новое по людям: кто загрузил и сколько, под этим — его фото
    const groups = byOwner(fresh);
    const parts = await Promise.all(groups.map(async ([who, items]) => `
      <a class="new-who" href="#/new/${who}" style="${ucStyle(who)}">${avatar(who)}<b>${esc(nameOf(who))}</b>
        <span>${whenText(items[0].created_at)} · ${countText(items)}</span></a>
      ${await grid(items, "", true)}`));
    if (seq !== gallerySeq || !box.isConnected) return;
    box.innerHTML = `${tabs}
      ${fresh.length
        ? `<div class="new-bar"><span>Фото, которые ты ещё не видел${f ? `, где есть ${esc(nameOf(f))}` : ""}</span><button type="button" class="link-btn" data-seen-all>Всё видел</button></div>${parts.join("")}`
        : `<div class="empty">Ничего нового, ты всё видел ✓</div>`}`;
    return;
  }
  const what = kind === "video" ? "Видео" : kind === "photo" ? "Фото" : "Фото и видео";
  const title = f ? `${what}, где есть ${esc(nameOf(f))}` : kind === "all" ? "Все фото и видео" : `Только ${what.toLowerCase()}`;
  const changed = kind !== "all" || sort !== "new";
  const gridHtml = await grid(list, f ? `${what}, где есть ${esc(nameOf(f))}, пока нет.${kind === "all" ? " Загрузи и отметь." : ""}`
    : kind === "video" ? "Видео пока нет." : `Пока пусто. <a href="#/upload">Загрузи первое фото</a>.`, true,
    { months: sort === "new" || sort === "old", who: true });
  if (seq !== gallerySeq || !box.isConnected) return;
  box.innerHTML = `${tabs}
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
  wireSheetDrag(w, w.querySelector(".gs-sheet"), closeGallerySheet);
  void w.offsetWidth; w.classList.add("open");
  w.querySelector(".gs-kind[aria-pressed=true]")?.focus({ preventScroll: true });
}
function closeGallerySheet() {
  const w = document.querySelector(".gs-wrap"); if (!w) return;
  w.classList.remove("open"); setTimeout(() => w.remove(), 320);
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
  const tab = e.target.closest("[data-gnew]");
  if (tab) { state.gnew = tab.dataset.gnew === "1"; return renderGallery(); }
  if (e.target.closest("[data-gsheet]")) return openGallerySheet();
  if (!e.target.closest(".gs-wrap")) return;
  const k = e.target.closest("[data-gs-kind]"), s = e.target.closest("[data-gs-sort]");
  if (k) { setGalleryView({ kind: k.dataset.gsKind }); renderGallery(); }
  else if (s) { setGalleryView({ sort: s.dataset.gsSort }); renderGallery(); }
  else if (e.target.closest("[data-gs-reset]")) { setGalleryView({ kind: "all", sort: "new" }); renderGallery(); }
  else if (e.target.closest("[data-gs-close]")) closeGallerySheet();
});

// Шторка «Что смотреть» в ленте: новые для тебя и порядок. Устроена как шторка галереи
function openFeedSheet() {
  document.querySelector(".gs-wrap")?.remove();
  const n = newMedia().length, sort = feedSort();
  const w = document.createElement("div");
  w.className = "gs-wrap";
  w.innerHTML = `<div class="pv-dim" data-gs-close></div>
    <div class="gs-sheet" role="dialog" aria-label="Что смотреть"><div class="pv-grab" data-gs-close></div>
      <div class="gs-h"><h3>Что смотреть</h3></div>
      ${n ? `<button type="button" class="fs-new" data-fnew><span>Новые для тебя</span><em>${n}</em></button>` : ""}
      <div class="gs-sorts" role="radiogroup" aria-label="Порядок ленты">${F_SORTS.map(([s, label, hint]) =>
        `<button type="button" class="gs-sort" role="radio" data-fs-sort="${s}" aria-checked="${sort === s}"><i></i>${label}${hint ? `<small>${hint}</small>` : ""}</button>`).join("")}</div>
    </div>`;
  document.body.appendChild(w);
  wireSheetDrag(w, w.querySelector(".gs-sheet"), closeGallerySheet);
  void w.offsetWidth; w.classList.add("open");
  w.querySelector(".gs-sort[aria-checked=true]")?.focus({ preventScroll: true });
}
function openFreshFeed() {
  state.fnew = true;
  state.fnewList = newMedia();
  closeGallerySheet();
  if ((location.hash.replace(/^#/, "") || "/") === "/") route(); else location.hash = "#/";
}
function closeFreshFeed() {
  state.fnew = false; state.fnewList = null;
  route();
}
document.addEventListener("click", e => {
  if (e.target.closest("[data-fsheet]")) return openFeedSheet();
  if (e.target.closest("[data-fnew]")) return openFreshFeed();
  if (e.target.closest("[data-fnew-close]")) return closeFreshFeed();
  const s = e.target.closest("[data-fs-sort]");
  if (s) {
    state.fsort = s.dataset.fsSort;
    if (state.fsort === "rnd") state.gshuffle = null;   // «Вперемешку» ещё раз — перемешать заново
    try { localStorage.setItem("korefany-feed-sort", state.fsort); } catch {}
    closeGallerySheet();
    state.fnew = false; state.fnewList = null;
    route();
    return;
  }
  // «Всё видел»: и в ленте, и в галерее
  if (e.target.closest("[data-seen-all]")) {
    markAllViewed();
    state.fnew = false; state.fnewList = null; state.gnew = false;
    toast("Готово: всё отмечено просмотренным");
    route();
  }
});

// Пачка одного человека: сюда ведут уведомления «Влад загрузил 12 фото».
// #/new/<кто>/<последнее фото пачки>/<сколько в пачке> — ровно та пачка; #/new/<кто> — что ты у него ещё не видел
// (а если всё видел — его последняя загрузка: фото, загруженные подряд с перерывами меньше двух часов)
const batchRetried = new Set();
async function viewBatch(owner, lastId, n) {
  let all = state.media.filter(m => m.owner === owner).sort(byAdded);
  let at = lastId ? all.findIndex(m => m.id === lastId) : -1;
  // Открыли из уведомления, а сайт показывает сохранённое на телефоне — этой пачки там ещё нет. Дозабираем новое
  if (lastId && at < 0 && !batchRetried.has(lastId)) {
    batchRetried.add(lastId);
    shell("feed", `<div class="loading">Загружаю новые фото...</div>`);
    await mergeNewMedia();
    all = state.media.filter(m => m.owner === owner).sort(byAdded);
    at = all.findIndex(m => m.id === lastId);
  }
  let list = at >= 0 ? all.slice(at, at + Math.max(1, Math.min(+n || 1, 500))) : all.filter(isNew);
  if (!list.length && all.length) {
    let i = 1;
    while (i < all.length && ms(all[i - 1].created_at) - ms(all[i].created_at) < 2 * 3600e3) i++;
    list = all.slice(0, i);
  }
  if (!list.length) {
    shell("feed", `<div class="empty">Тут пока пусто. <a href="#/">В ленту</a></div>`);
    return;
  }
  const [first, ...rest] = list;
  const big = first.kind === "photo" ? (midPath(first)) : thumbPath(first);
  await signed([big, first.path, thumbPath(first)]);
  // Кто ещё загрузил новое — показываем внизу, чтобы не возвращаться в ленту
  const others = byOwner(newMedia().filter(m => m.owner !== owner));
  const heroSrc = url(big) || (first.kind === "photo" ? url(first.path) : "");
  shell("feed", `
    <section class="batch" style="${ucStyle(owner)}">
      <div class="batch-head">
        <a href="#/" class="batch-back" aria-label="В ленту">‹</a>
        <a href="#/p/${owner}" class="batch-ava">${avatar(owner)}</a>
        <div><h1>${esc(nameOf(owner))}</h1><span>загрузил ${countText(list)} · ${whenText(first.created_at)}</span></div>
      </div>
      <button type="button" class="batch-hero" data-open="${first.id}" aria-label="${esc(first.caption || "Открыть")}">
        ${first.kind === "video" ? `<img class="${heroSrc ? "fade " : ""}vthumb" ${heroSrc ? `src="${heroSrc}"` : ""} data-vthumb="${first.id}" alt="">`
          : heroSrc ? `<img class="fade" src="${heroSrc}" alt="">` : `<span class="noimg">🖼</span>`}
        ${first.kind === "video" ? `<span class="play">▶ видео</span>` : ""}
        ${first.caption ? `<span class="batch-cap">${esc(first.caption)}</span>` : ""}
      </button>
      ${rest.length ? await grid(rest, "", true) : ""}
      <div class="batch-btns">
        <button type="button" class="btn primary" data-open="${first.id}">▶ Смотреть подряд</button>
        <a class="btn" href="#/people">Вся галерея</a>
      </div>
      ${others.map(([who, items]) => `<a class="batch-more" href="#/new/${who}">${avatar(who)}
        <span>Ещё новое: <b>${esc(nameOf(who))}</b> · ${countText(items)}</span><em>Открыть</em></a>`).join("")}
    </section>`);
  state.current = list;   // в просмотре листаются только фото этой пачки
  markViewed(list);
}

async function viewPerson(id) {
  const p = profile(id);
  if (!p) { shell("people", `<div class="empty">Такого корефана нет. <a href="#/people">Ко всем корефанам</a></div>`); return; }
  const list = state.media.filter(m => m.people.includes(id));
  const saidBy = state.quotes.filter(q => q.author_id === id);
  const badges = personBadges(id);
  shell("people", `
    ${profileHero(p, id === me() ? `<a class="btn" href="#/me">✎ Редактировать</a>`
      : (chat.ready ? `<button type="button" class="btn primary" data-dm="${id}">Написать</button>` : "") +
        (state.v132 ? `<button type="button" class="btn" data-report="profile|${id}">🚩</button>` : ""))}
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

// ---------- Поиск по сайту ----------
// Ищет среди уже загруженного: люди, подписи и отметки на фото, даты («июнь 2024», «2023»), цитаты и комментарии.
// Сервер не нужен — работает мгновенно и даже без связи
const low = x => String(x || "").toLowerCase().replace(/ё/g, "е");
let searchQ = "", searchTimer2 = null;
function viewSearch(q = searchQ) {
  searchQ = q;
  shell("search", `
    <div><h1>Поиск</h1><p class="sub">Люди, подписи, цитаты, комментарии и даты — например «Байкал», «июнь 2024» или имя корефана</p></div>
    <label class="search-box"><span class="visually-hidden">Что ищем</span>${ICONS.search}<input type="search" id="searchQ" value="${esc(q)}" placeholder="Что ищем?" autocomplete="off" enterkeyhint="search"></label>
    <div id="searchRes"></div>`);
  const inp = document.getElementById("searchQ");
  inp.oninput = () => { clearTimeout(searchTimer2); searchTimer2 = setTimeout(() => { searchQ = inp.value; history.replaceState(null, "", "#/search/" + encodeURIComponent(inp.value)); paintSearch(); }, 200); };
  if (!PHONE.matches || !q) inp.focus();
  paintSearch();
}
async function paintSearch() {
  const box = document.getElementById("searchRes"); if (!box) return;
  const words = low(searchQ).split(/\s+/).filter(Boolean);
  if (!words.length) { box.innerHTML = `<div class="empty">Начни печатать — результаты появятся сразу.</div>`; return; }
  const hit = text => { const t = low(text); return words.every(w => t.includes(w)); };
  const people = state.profiles.filter(p => hit(`${p.name} ${p.status || ""} ${p.bio || ""}`));
  const dateText = m => { const d = toDate(m.taken_at || m.created_at); return `${MONTHS[d.getMonth()]} ${dayText(m.taken_at || m.created_at)} ${d.getFullYear()}`; };
  const media = state.media.filter(m => hit(`${m.caption || ""} ${nameOf(m.owner)} ${m.people.map(nameOf).join(" ")} ${dateText(m)}`));
  const quotes = state.quotes.filter(q => hit(`${q.text} ${q.context || ""} ${q.author_id ? nameOf(q.author_id) : ""}`));
  const comments = state.comments.filter(c => hit(c.text)).slice(-30).reverse();
  const head = (t, n) => `<h2 class="sr-h">${t} <small>${n}</small></h2>`;
  const total = people.length + media.length + quotes.length + comments.length;
  const seq = ++searchSeq2;
  const gridHtml = media.length ? await grid(media.slice(0, 60), "", true) : "";
  if (seq !== searchSeq2 || !document.body.contains(box)) return;   // пока считали, запрос сменился
  state.current = media;
  box.innerHTML = !total ? `<div class="empty">Ничего не нашлось по «${esc(searchQ)}».</div>` : `
    ${people.length ? head("Корефаны", people.length) + `<div class="chips">${people.map(p => `<a class="chip" href="#/p/${p.id}">${avatar(p.id)}${esc(p.name)}</a>`).join("")}</div>` : ""}
    ${media.length ? head("Фото и видео", media.length) + gridHtml + (media.length > 60 ? `<p class="msg">Показаны первые 60 — уточни запрос.</p>` : "") : ""}
    ${quotes.length ? head("Цитаты и шутки", quotes.length) + `<div class="quotes">${quotes.slice(0, 20).map(quoteCard).join("")}</div>` : ""}
    ${comments.length ? head("Комментарии", comments.length) + `<div class="sr-comments">${comments.map(c => `<button type="button" class="sr-c" data-open="${c.media_id}">
        ${avatar(c.author)}<span><b>${esc(nameOf(c.author))}</b>${esc(c.text)}</span></button>`).join("")}</div>` : ""}`;
}
let searchSeq2 = 0;

// ---------- Цитаты и шутки ----------

function quoteCard(q) {
  const who = q.author_id ? `<a class="chip" href="#/p/${q.author_id}">${avatar(q.author_id)}${esc(nameOf(q.author_id))}</a>` : `<span class="chip">Кто-то</span>`;
  return `<article class="quote ${q.kind}" data-quote="${q.id}">
    <span class="kind">${q.kind === "joke" ? "Шутка" : "Цитата"}</span>
    <p class="qtext">${q.kind === "quote" ? "«" + esc(q.text) + "»" : esc(q.text)}</p>
    <div class="row">${who}${q.context ? `<span class="msg">${esc(q.context)}</span>` : ""}</div>
    ${reactButtons("q", q.id)}
    <div class="qmeta"><span>добавил ${esc(nameOf(q.added_by))}, ${dayText(q.created_at)}</span>
      ${q.added_by === me() && state.v132 ? `<button type="button" class="link-btn" data-editq="${q.id}">изменить</button>` : ""}
      ${q.added_by === me() || isAdmin() ? `<button type="button" class="link-btn" data-delq="${q.id}">удалить</button>` : ""}
      ${q.added_by !== me() && state.v132 ? `<button type="button" class="link-btn" data-report="quote|${q.id}">пожаловаться</button>` : ""}</div>
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
    const text = document.getElementById("qText").value.trim();
    if (!text) { btn.disabled = false; m.className = "msg err"; m.textContent = "Напиши, что было сказано."; return; }
    const { data, error } = await sb.from("quotes").insert({
      kind: document.querySelector('[data-qk][aria-pressed="true"]').dataset.qk,
      text,
      author_id: document.querySelector('[data-who][aria-pressed="true"]').dataset.who || null,
      context: document.getElementById("qContext").value.trim() || null
    }).select().single();
    if (error) { btn.disabled = false; m.className = "msg err"; m.textContent = "Не сохранилось. Попробуй ещё раз."; return; }
    // Новая цитата встаёт сверху сразу — без перекачки всех данных сайта
    if (!state.quotes.some(q => q.id === data.id)) state.quotes.unshift(data);
    saveCache(); viewQuotes();
  };
}
