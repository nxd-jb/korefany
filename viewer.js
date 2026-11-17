// Корефаны: просмотр фото, шторки, «Поделиться», правка фото, комментарии, загрузка файлов, превью видео. Часть бывшего app.js.

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
        : `<button type="button" class="btn" data-edit-media="${m.id}">👥 Отметить, кто на фото</button>` +
          (isAdmin() ? `<button class="btn danger" data-del="${m.id}">Удалить</button>` : "") +
          (state.v132 ? `<button type="button" class="btn" data-report="media|${m.id}" aria-label="Пожаловаться">🚩</button>` : "")}
        <button type="button" class="btn" data-share="${m.id}">${SHARE_ICON} Поделиться</button></div>
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
    ${m.owner === me() || isAdmin() ? `<button type="button" class="pv-del" data-del="${m.id}" aria-label="Удалить">Удалить</button>`
      : state.v132 ? `<button type="button" class="pv-del pv-rep" data-report="media|${m.id}" aria-label="Пожаловаться">🚩</button>` : ""}`;
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
      ${state.commentsReady ? `<button type="button" class="react pv-cbtn" data-pv-comments aria-label="Комментарии">💬<span class="c-count">${cc || ""}</span></button>` : ""}
      <button type="button" class="react pv-share" data-share="${m.id}" aria-label="Поделиться">${SHARE_ICON}</button></div>
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
  wireSheetDrag(el.querySelector(".pv-sheet-wrap"), el.querySelector(".pv-sheet"), closePvSheet);
  if (fromEl && m.kind === "photo") flyIn(fromEl, el);
}

function openPvSheet() {
  const w = document.querySelector(".viewer .pv-sheet-wrap"); if (!w) return false;
  clearSheetDrag(w);
  w.hidden = false;
  void w.offsetWidth;   // сначала шторка появляется внизу, потом выезжает
  w.classList.add("open");
  return true;
}
function closePvSheet() {
  const w = document.querySelector(".viewer .pv-sheet-wrap"); if (!w || w.hidden || !w.classList.contains("open")) return;
  w.classList.remove("open");
  document.activeElement?.blur?.();
  setTimeout(() => { if (!w.classList.contains("open")) { w.hidden = true; clearSheetDrag(w); } }, 400);
}

// ---------- Шторки снизу: стянуть пальцем ----------
// Комментарии, «Что смотреть», «Изменить фото», «Участники». На телефоне шторку тянут вниз за полоску сверху,
// за заголовок или за любое место, если список внутри уже прокручен до верха. Шторка едет за пальцем,
// фон под ней светлеет. Отпустил ниже трети или смахнул быстро — закрылась, иначе мягко вернулась.
// Страница под шторкой при этом не двигается (раньше палец тянул её, и окно «улетало» вверх)
function wireSheetDrag(wrap, sheet, close) {
  if (!wrap || !sheet || wrap.dataset.drag) return;
  wrap.dataset.drag = "1";
  const dim = wrap.querySelector(".pv-dim");
  let y0 = 0, dy = 0, mode = null, scroller = null, lastY = 0, lastT = 0, speed = 0;
  wrap.addEventListener("touchstart", e => {
    if (e.touches.length !== 1 || !PHONE.matches) { mode = "off"; return; }
    y0 = lastY = e.touches[0].clientY; lastT = performance.now(); dy = 0; speed = 0; mode = null;
    // Поле ввода не трогаем: в нём свой текст и своя прокрутка
    if (e.target.closest("textarea, input, select")) { mode = "off"; return; }
    // Ближайший прокручиваемый список внутри шторки (комментарии или сама шторка, если она длинная)
    scroller = null;
    for (let el = e.target; el && el !== wrap; el = el.parentElement) {
      if (el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY)) { scroller = el; break; }
    }
  }, { passive: true });
  wrap.addEventListener("touchmove", e => {
    if (mode === "off" || e.touches.length !== 1) return;
    const y = e.touches[0].clientY, d = y - y0;
    if (!mode) {
      if (Math.abs(d) < 6) { if (!scroller) e.preventDefault(); return; }
      // Тянем шторку вниз, если тянут вниз и список (если он есть) уже в самом верху. Иначе — обычная прокрутка списка
      mode = d > 0 && (!scroller || scroller.scrollTop <= 0) ? "drag" : scroller ? "off" : "hold";
      if (mode === "drag") { sheet.style.transition = "none"; if (dim) dim.style.transition = "none"; }
    }
    if (mode === "hold") { e.preventDefault(); return; }   // тянут вверх за полоску — страница под шторкой не едет
    if (mode !== "drag") return;
    e.preventDefault();
    const now = performance.now();
    speed = (y - lastY) / Math.max(1, now - lastT); lastY = y; lastT = now;
    // Вверх шторка тянется туго, вниз — ровно за пальцем
    dy = d > 0 ? d : -Math.min(24, -d * .2);
    sheet.style.transform = `translateY(${dy}px)`;
    if (dim) dim.style.opacity = String(Math.max(0, 1 - Math.max(0, dy) / (sheet.offsetHeight || 1)));
  }, { passive: false });
  const end = () => {
    if (mode !== "drag") { mode = null; return; }
    mode = null;
    const h = sheet.offsetHeight || 1;
    const shut = dy > h * .3 || (speed > .45 && dy > 24);
    // Отпустил: шторка доезжает сама. Чем быстрее смахнул, тем короче доводка
    const t = shut ? Math.max(.16, Math.min(.32, (h - dy) / Math.max(1.2, speed * 1000) )) : .34;
    sheet.style.transition = `transform ${t}s cubic-bezier(.32, .72, 0, 1)`;
    if (dim) dim.style.transition = `opacity ${t}s ease`;
    if (shut) {
      sheet.style.transform = "translateY(100%)";
      if (dim) dim.style.opacity = "0";
      navigator.vibrate?.(6);
      close();
    } else {
      sheet.style.transform = "";
      if (dim) dim.style.opacity = "";
      setTimeout(() => { if (!mode) clearSheetDrag(wrap, true); }, t * 1000 + 30);
    }
  };
  wrap.addEventListener("touchend", end);
  wrap.addEventListener("touchcancel", end);
}
// Убрать следы перетаскивания (при следующем открытии шторка выезжает как обычно)
function clearSheetDrag(wrap, keepPlace = false) {
  wrap?.querySelectorAll(".pv-sheet, .gs-sheet, .me-sheet, .mem-sheet, .pv-dim").forEach(el => {
    el.style.transition = ""; if (!keepPlace) { el.style.transform = ""; el.style.opacity = ""; }
  });
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

// ---------- Ссылка на одно фото и «Отправить в чат» ----------
// У каждого фото свой адрес #/m/<id>: им можно поделиться в чате, по нему же ведут уведомления о комментариях.
// Открывается лента, а поверх неё — это фото
const SHARE_ICON = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>`;
const mediaLink = id => location.href.split("#")[0] + "#/m/" + id;
async function viewOne(id) {
  if (!state.media.some(m => m.id === id)) await mergeNewMedia();
  await viewFeed();
  if (!state.media.some(m => m.id === id)) return toast("Этого фото больше нет — его удалили");
  openViewer(id);
}
function openShareSheet(id) {
  const m = state.media.find(x => x.id === id); if (!m) return;
  document.querySelector(".gs-wrap")?.remove();
  const chats = (chat.ready ? chat.list : []).slice().sort((a, b) => (chat.last[b.id]?.created_at || "").localeCompare(chat.last[a.id]?.created_at || ""));
  const w = document.createElement("div");
  w.className = "gs-wrap share-wrap";
  w.innerHTML = `<div class="pv-dim" data-gs-close></div>
    <div class="gs-sheet" role="dialog" aria-label="Поделиться"><div class="pv-grab" data-gs-close></div>
      <div class="gs-h"><h3>Поделиться ${m.kind === "video" ? "видео" : "фото"}</h3></div>
      <button type="button" class="btn share-copy" data-share-copy="${id}">🔗 Скопировать ссылку</button>
      ${chats.length ? `<div class="gs-h"><h3>Отправить в чат</h3></div>
      <div class="share-chats">${chats.map(c => `<button type="button" class="share-chat" data-share-to="${c.id}">
        <span class="ava-wrap">${typeof chatAvatar === "function" ? chatAvatar(c) : ""}</span><b>${esc(chatTitle(c))}</b></button>`).join("")}</div>` : ""}
    </div>`;
  document.body.appendChild(w);
  wireSheetDrag(w, w.querySelector(".gs-sheet"), closeGallerySheet);
  void w.offsetWidth; w.classList.add("open");
  w.dataset.media = id;
}
document.addEventListener("click", async e => {
  const sh = e.target.closest("[data-share]");
  if (sh) { e.preventDefault(); e.stopPropagation(); return openShareSheet(sh.dataset.share); }
  const cp = e.target.closest("[data-share-copy]");
  if (cp) {
    const link = mediaLink(cp.dataset.shareCopy);
    try { await navigator.clipboard.writeText(link); toast("Ссылка скопирована"); }
    catch (err) { toast(link); }
    return closeGallerySheet();
  }
  const to = e.target.closest("[data-share-to]");
  if (to) {
    const id = to.closest(".share-wrap")?.dataset.media; if (!id) return;
    to.disabled = true;
    const { error } = await sb.from("messages").insert({ chat_id: to.dataset.shareTo, text: mediaLink(id) });
    to.disabled = false;
    if (error) return toast("Не отправилось — проверь связь и попробуй ещё раз");
    closeGallerySheet();
    toast(`Отправлено в «${chatTitle(chat.list.find(c => c.id === to.dataset.shareTo) || {})}»`, "Открыть чат", () => { location.hash = "#/chat/" + to.dataset.shareTo; });
  }
}, true);

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
  const close = () => { w.classList.remove("open"); setTimeout(() => w.remove(), 320); };
  wireSheetDrag(w, w.querySelector(".me-sheet"), close);
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
  if (post) { post.outerHTML = postHtml(m, 0, !state.feed?.fresh); pvShowLoaded(document.querySelector(`[data-post="${m.id}"]`)); if (feedKeeper) keepNear(document.getElementById("feed") || document); }
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

// @Имя в тексте подсвечиваем (имена корефанов целиком, длинные сначала, чтобы «Влад» не съел «Владос»)
function mentionify(html) {
  const names = state.profiles.map(p => p.name).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!names.length) return html;
  const re = new RegExp("@(" + names.map(n => esc(n).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "gi");
  return html.replace(re, '<b class="c-at">@$1</b>');
}
function commentHtml(c, m, i = 0, isNew = false) {
  const mine = c.author === me();
  const likes = state.clikes.filter(l => l.comment_id === c.id), liked = likes.some(l => l.user_id === me());
  const parent = c.reply_to ? state.comments.find(x => x.id === c.reply_to) : null;
  return `<div class="c-item${mine ? " mine" : ""}${isNew ? " new" : ""}" data-cid="${c.id}" style="--i:${Math.min(i, 15)}">
    <a href="#/p/${c.author}">${avatar(c.author)}</a>
    <div class="c-bubble">
      <div class="c-head"><b>${esc(nameOf(c.author))}</b><span>${ago(c.created_at)}${c.edited_at ? " · изм." : ""}</span></div>
      ${c.reply_to ? `<p class="c-quote">↩ ${parent ? `<b>${esc(nameOf(parent.author))}</b> ${esc(parent.text.slice(0, 80))}` : "комментарий удалён"}</p>` : ""}
      <p class="c-text">${mentionify(esc(c.text))}</p>
      <div class="c-acts">
        ${state.v132 ? `<button type="button" class="c-like" data-clike="${c.id}" aria-pressed="${liked}" aria-label="Нравится">♥<span>${likes.length || ""}</span></button>
        <button type="button" class="link-btn" data-creply="${c.id}">ответить</button>` : ""}
        ${mine && state.v132 ? `<button type="button" class="link-btn" data-cedit="${c.id}">изменить</button>` : ""}
        ${mine || isAdmin() ? `<button type="button" class="link-btn" data-delc="${c.id}">удалить</button>` : ""}
        ${!mine && state.v132 ? `<button type="button" class="link-btn" data-report="comment|${c.id}">пожаловаться</button>` : ""}
      </div>
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
      <div class="c-mode" hidden></div>
      <div class="c-mention" hidden></div>
      <div class="pill"><textarea rows="1" maxlength="500" placeholder="Написать комментарий..." aria-label="Комментарий"></textarea></div>
      <button type="submit" class="c-send" aria-label="Отправить" disabled>${SEND_ICON}</button>
    </form>
  </section>`;
}

function wireComments(el, m) {
  const form = el.querySelector(".c-form"); if (!form) return;
  const ta = form.querySelector("textarea"), send = form.querySelector(".c-send");
  const listEl = el.querySelector(".c-list"), mode = form.querySelector(".c-mode"), ment = form.querySelector(".c-mention");
  // Ответ на комментарий или правка своего — полоска над полем, ✕ отменяет
  let replyTo = null, editing = null;
  const setMode = (kind, c) => {
    replyTo = kind === "reply" ? c.id : null; editing = kind === "edit" ? c.id : null;
    mode.hidden = !kind;
    mode.innerHTML = kind ? `<span>${kind === "reply" ? `↩ Ответ: <b>${esc(nameOf(c.author))}</b>` : "✎ Изменение комментария"}</span><button type="button" class="link-btn" data-cmode-x aria-label="Отменить">✕</button>` : "";
    if (kind === "edit") { ta.value = c.text; }
    else if (kind === "reply" && !ta.value.trim()) ta.value = c.author !== me() ? `@${nameOf(c.author)} ` : "";
    else if (!kind && editing === null) {}
    ta.oninput(); ta.focus();
  };
  form.wireReply = id => { const c = state.comments.find(x => x.id === id); if (c) setMode("reply", c); };
  form.wireEdit = id => { const c = state.comments.find(x => x.id === id); if (c) setMode("edit", c); };
  mode.addEventListener("click", e => { if (e.target.closest("[data-cmode-x]")) { if (editing) ta.value = ""; setMode(null); } });
  // @ — подсказка с именами: нажал на имя — оно встаёт в текст
  const paintMention = () => {
    const before = ta.value.slice(0, ta.selectionStart ?? ta.value.length), q = before.match(/@([^\s@]{0,20})$/);
    const list = q ? state.profiles.filter(p => p.id !== me() && low(p.name).startsWith(low(q[1]))).slice(0, 6) : [];
    ment.hidden = !list.length;
    ment.innerHTML = list.map(p => `<button type="button" class="chip" data-mention="${esc(p.name)}">${avatar(p.id)}${esc(p.name)}</button>`).join("");
  };
  ment.addEventListener("mousedown", e => e.preventDefault());   // поле не теряет фокус
  ment.addEventListener("click", e => {
    const b = e.target.closest("[data-mention]"); if (!b) return;
    const pos = ta.selectionStart ?? ta.value.length, before = ta.value.slice(0, pos).replace(/@[^\s@]*$/, "@" + b.dataset.mention + " ");
    ta.value = before + ta.value.slice(pos); ta.selectionStart = ta.selectionEnd = before.length;
    ta.oninput(); ta.focus();
  });
  // Поле растёт вместе с текстом
  ta.oninput = () => { autoGrow(ta); send.disabled = !ta.value.trim(); paintMention(); };
  // Enter отправляет, Shift+Enter — новая строка. На телефоне Enter — просто новая строка, отправка кнопкой
  ta.onkeydown = e => {
    if (e.key === "Escape" && (replyTo || editing)) { e.stopPropagation(); if (editing) ta.value = ""; setMode(null); return; }
    if (e.key === "Enter" && !e.shiftKey && !matchMedia("(pointer: coarse)").matches) { e.preventDefault(); submit(); }
  };
  form.onsubmit = e => { e.preventDefault(); submit(); };
  const submit = async () => {
    const text = ta.value.trim(); if (!text || send.classList.contains("flying")) return;
    send.disabled = true; send.classList.add("flying");
    if (editing) {
      const id = editing;
      const { error } = await sb.from("comments").update({ text, edited_at: new Date().toISOString() }).eq("id", id);
      send.classList.remove("flying");
      if (error) { send.disabled = false; return toast("Не сохранилось — попробуй ещё раз"); }
      const c = state.comments.find(x => x.id === id); if (c) { c.text = text; c.edited_at = new Date().toISOString(); }
      ta.value = ""; setMode(null);
      repaintComment(id); refreshPost(m.id);
      return;
    }
    const row = { media_id: m.id, text };
    if (replyTo) row.reply_to = replyTo;
    const { data, error } = await sb.from("comments").insert(row).select().single();
    send.classList.remove("flying");
    if (error) { send.disabled = false; ta.placeholder = "Не отправилось, попробуй ещё раз"; return; }
    ta.value = ""; setMode(null);
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
// Перерисовать один комментарий на месте (правка, лайк)
function repaintComment(id) {
  const c = state.comments.find(x => x.id === id), el = document.querySelector(`.viewer [data-cid="${id}"]`);
  const m = c && state.media.find(x => x.id === c.media_id);
  if (el && m) { el.outerHTML = commentHtml(c, m); }
}
async function toggleCommentLike(btn) {
  const id = btn.dataset.clike, mine = state.clikes.find(l => l.comment_id === id && l.user_id === me());
  btn.disabled = true;
  const { error } = mine
    ? await sb.from("comment_likes").delete().eq("comment_id", id).eq("user_id", me())
    : await sb.from("comment_likes").insert({ comment_id: id });
  btn.disabled = false;
  if (error && error.code !== "23505") return toast("Не сохранилось — проверь связь");
  state.clikes = mine ? state.clikes.filter(l => l !== mine) : [...state.clikes, { comment_id: id, user_id: me() }];
  if (!mine) burst(btn, "♥");
  repaintComment(id);
}
function onCommentLike(type, n, o) {
  const r = type === "INSERT" ? n : o; if (!r) return;
  const same = l => l.comment_id === r.comment_id && l.user_id === r.user_id;
  if (type === "INSERT") { if (state.clikes.some(same)) return; state.clikes.push({ comment_id: r.comment_id, user_id: r.user_id }); }
  else { if (!state.clikes.some(same)) return; state.clikes = state.clikes.filter(l => !same(l)); }
  repaintComment(r.comment_id);
}
document.addEventListener("click", e => {
  const like = e.target.closest("[data-clike]"); if (like) return toggleCommentLike(like);
  const rep = e.target.closest("[data-creply]"); if (rep) return rep.closest(".viewer")?.querySelector(".c-form")?.wireReply?.(rep.dataset.creply);
  const ed = e.target.closest("[data-cedit]"); if (ed) return ed.closest(".viewer")?.querySelector(".c-form")?.wireEdit?.(ed.dataset.cedit);
});

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
    const id = delq.dataset.delq;
    const { error } = await sb.from("quotes").delete().eq("id", id);
    if (error) { delq.disabled = false; delq.textContent = "не вышло, ещё раз?"; return; }
    // Убираем у себя, а не перекачиваем все данные сайта заново
    state.quotes = state.quotes.filter(q => q.id !== id);
    state.qr = state.qr.filter(r => r.quote_id !== id);
    saveCache(); route();
    return;
  }
  const del = e.target.closest("[data-del]");
  if (del) {
    // Удаление в два нажатия, чтобы не стереть случайно
    if (del.textContent !== "Точно удалить?") { del.textContent = "Точно удалить?"; return; }
    const m = state.media.find(x => x.id === del.dataset.del); if (!m) return;
    del.disabled = true;
    // Сначала запись в базе, потом файлы: если удаление не прошло, пост не останется без картинки
    const { error } = await sb.from("media").delete().eq("id", m.id);
    if (error) { del.disabled = false; del.textContent = "Не удалилось, ещё раз?"; return; }
    removeFiles(BUCKET, [m.path, thumbPath(m), midPath(m)].filter(Boolean));
    state.media = state.media.filter(x => x.id !== m.id);
    state.comments = state.comments.filter(c => c.media_id !== m.id);
    state.mr = state.mr.filter(r => r.media_id !== m.id);
    saveCache();
    closeViewer(); route();
    toast("Удалено");
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

async function uploadOne(file, { id = crypto.randomUUID(), album = null, tags, caption, takenAt }) {
  const isVideo = file.type.startsWith("video/");
  let main, thumb, mid = null, ext, dims = null;

  if (isVideo) {
    if (file.size > KOREFANY.maxVideoMb * 1024 * 1024) throw new Error(`видео больше ${KOREFANY.maxVideoMb} МБ`);
    main = file;
    ext = (file.name.split(".").pop() || "mp4").toLowerCase();
    thumb = await videoThumb(file);
  } else {
    const img = await decodeImage(file);
    dims = { width: img.width, height: img.height };
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

  const row = { id, path, kind: isVideo ? "video" : "photo", caption: caption || null, taken_at: takenAt, ...(album ? { album } : {}) };
  let r = await sb.from("media").insert(dims && !sizeColsMissing ? { ...row, ...dims } : row);
  // В базе ещё нет колонок размера (не выполнен 22_v132.sql) — повторяем без них
  if (r.error && (dims || album) && /width|height|album|column/i.test(r.error.message || "")) { sizeColsMissing = true; const { album: _a, ...plain } = row; r = await sb.from("media").insert(plain); }
  // 23505 — запись с таким номером уже есть: прошлая попытка на самом деле дошла, просто ответ потерялся
  if (r.error && r.error.code !== "23505") {
    const check = await sb.from("media").select("id").eq("id", id).maybeSingle();
    if (!check.data) {
      // Записи точно нет — убираем загруженные файлы, чтобы не лежали в хранилище без поста.
      // Проверить не вышло (нет связи) — оставляем: повтор пойдёт под тем же номером и ляжет поверх
      if (!check.error) removeFiles(BUCKET, [path, `${me()}/${id}_t.jpg`, `${me()}/${id}_m.jpg`]);
      throw r.error;
    }
  }
  // Отметки — отдельным запросом, с одной повторной попыткой. Не сохранились — фото всё равно уже в ленте,
  // отметить можно там. Раньше такое фото считалось незагруженным, и повтор создавал его второй раз
  let tagsFailed = false;
  if (tags.length) {
    const rows = tags.map(person_id => ({ media_id: id, person_id }));
    const put = async () => { const x = await sb.from("media_people").insert(rows); return x.error && x.error.code !== "23505" ? x.error : null; };
    tagsFailed = !!(await put()) && !!(await put());
  }
  return { tagsFailed };
}

// Открыть любую картинку: JPG, PNG, WebP, GIF, AVIF, BMP, HEIC с айфона.
// Пробуем по очереди: быстрый способ браузера, обычную картинку, а для HEIC — конвертер.
const isHeic = f => /image\/hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name || "");

// Дата съёмки, записанная внутри JPEG (EXIF DateTimeOriginal), как «2024-06-13». Нет — null.
// iPhone отдаёт выбранному из галереи файлу время выбора, а не съёмки, поэтому без этого почти все фото
// получали дату загрузки и в ленте «по дате события» вставали не на своё место
async function exifDate(file) {
  try {
    if (!/jpe?g/i.test(file.type) && !/\.jpe?g$/i.test(file.name || "")) return null;
    const v = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if (v.getUint16(0) !== 0xFFD8) return null;
    for (let p = 2; p + 10 < v.byteLength;) {
      const marker = v.getUint16(p), len = v.getUint16(p + 2);
      if ((marker & 0xFF00) !== 0xFF00 || marker === 0xFFDA) return null;   // дальше уже сама картинка
      if (marker === 0xFFE1 && v.getUint32(p + 4) === 0x45786966) {          // блок «Exif»
        const t = p + 10, le = v.getUint16(t) === 0x4949;                     // II — порядок байт Intel, MM — Motorola
        const u16 = o => v.getUint16(t + o, le), u32 = o => v.getUint32(t + o, le);
        const find = (ifd, tag) => { const n = u16(ifd); for (let i = 0; i < n; i++) if (u16(ifd + 2 + i * 12) === tag) return ifd + 2 + i * 12; return -1; };
        const text = e => String.fromCharCode(...new Uint8Array(v.buffer, t + u32(e + 8), 10));
        const ifd0 = u32(4), sub = find(ifd0, 0x8769);                        // 0x8769 — ссылка на блок с датой съёмки
        const e = sub >= 0 ? find(u32(sub + 8), 0x9003) : -1;                 // 0x9003 — DateTimeOriginal
        const d = (e >= 0 ? text(e) : find(ifd0, 0x0132) >= 0 ? text(find(ifd0, 0x0132)) : "").match(/^(\d{4}):(\d{2}):(\d{2})/);
        return d && d[1] > "1900" ? `${d[1]}-${d[2]}-${d[3]}` : null;
      }
      p += 2 + len;
    }
  } catch (e) {}
  return null;
}

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
// Одновременно играет только одно: включили видео — остальные видео и голосовое встают на паузу.
// play не всплывает, поэтому ловим его на document в фазе перехвата
function pauseOtherMedia(except) {
  document.querySelectorAll("video:not([data-helper])").forEach(v => { if (v !== except && !v.paused) v.pause(); });
  if (typeof stopVoice === "function") stopVoice();
}
document.addEventListener("play", e => {
  const v = e.target;
  if (v.tagName === "VIDEO" && !v.hasAttribute("data-helper")) pauseOtherMedia(v);
}, true);

function videoThumb(source) {
  return new Promise(resolve => {
    const v = document.createElement("video");
    v.dataset.helper = "";   // служебное: его короткий запуск не должен останавливать то, что смотрит человек
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

const vthumbOk = new Set();   // у этих видео превью уже проверено и нормальное — при каждой перерисовке не проверяем заново
function fixVideoThumbs() {
  document.querySelectorAll("[data-vthumb]:not([data-vchecked])").forEach(el => {
    el.dataset.vchecked = "1";
    const id = el.dataset.vthumb, m = state.media.find(x => x.id === id); if (!m) return;
    if (vthumbLocal[id]) return applyVthumb(el, vthumbLocal[id]);
    if (vthumbOk.has(id)) return;
    const t = url(thumbPath(m));
    if (!t) return queueVthumb(m, false);
    // Превью есть — проверяем, не чёрное ли оно (отдельная загрузка с разрешением на чтение пикселей)
    const probe = new Image();
    probe.crossOrigin = "anonymous";
    probe.onload = () => {
      if (!isBlackCanvas(probe, probe.naturalWidth, probe.naturalHeight)) return vthumbOk.add(id);
      // Чёрное превью могло остаться в памяти телефона, а хозяин видео его уже исправил — убираем, чтобы взялось свежее
      window.caches?.open("korefany-pics-v1").then(c => c.delete(`https://pics.korefany/${BUCKET}/${thumbPath(m)}`)).catch(() => {});
      queueVthumb(m, true);
    };
    probe.onerror = () => queueVthumb(m, false);
    probe.src = t;
  });
}
// Видео появляются на странице в разных местах (лента, галерея, профиль, просмотр) — следим за всеми
let vthumbTimer = null;
new MutationObserver(() => { clearTimeout(vthumbTimer); vthumbTimer = setTimeout(fixVideoThumbs, 400); })
  .observe(document.body, { childList: true, subtree: true });
