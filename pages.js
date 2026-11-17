// Корефаны: «Топ», загрузка, профиль, вход. Часть бывшего app.js.

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
    return st[id] || (st[id] = { uploads: 0, tags: 0, laughs: 0, likes: 0, score: 0, at: {} });
  };
  // at[поле] — когда человек набрал своё значение (время последнего засчитанного события): при ничьей побеждает тот, кто раньше
  const add = (v, key, when) => { v[key]++; if (!v.at[key] || when > v.at[key]) v.at[key] = when; };
  state.media.forEach(x => { const k = monthKey(x.created_at); add(s(k, x.owner), "uploads", x.created_at); x.people.forEach(p => add(s(k, p), "tags", x.created_at)); });
  state.mr.forEach(r => { const x = mediaById.get(r.media_id); if (x) add(s(monthKey(r.created_at), x.owner), "likes", r.created_at); });
  state.qr.forEach(r => {
    if (r.emoji !== "laugh") return;
    const q = quoteById.get(r.quote_id); if (q?.author_id) add(s(monthKey(r.created_at), q.author_id), "laughs", r.created_at);
  });
  months.forEach(st => Object.values(st).forEach(v => {
    v.score = v.uploads + v.tags + v.likes + v.laughs * 2;
    v.at.score = ["uploads", "tags", "likes", "laughs"].map(k => v.at[k] || "").sort().pop();
  }));
  return months;
}

// Очки за один месяц (для «Топа») и фото, загруженные в этом месяце
function monthStats(y, m) {
  const k = y * 12 + m;
  return { stats: allMonthStats().get(k) || {}, monthMedia: state.media.filter(x => monthKey(x.created_at) === k) };
}
// Порядок в номинации. Ничья: выше тот, у кого больше общий счёт месяца, а если и он равен — кто набрал раньше
const byNom = key => (a, b) => b[1][key] - a[1][key] || b[1].score - a[1].score || String(a[1].at[key] || "").localeCompare(String(b[1].at[key] || ""));
const rankIn = (stats, key) => Object.entries(stats).filter(([id, v]) => v[key] > 0 && profile(id)).sort(byNom(key));
const leaderOf = (stats, key) => rankIn(stats, key)[0];

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
  await signed(best.flatMap(x => [thumbPath(x), midPath(x), x.kind === "photo" ? x.path : null]).filter(Boolean));

  // Награды месяца — коллекционные карточки: листаются свайпом, нажатие переворачивает.
  // Спереди победитель, на обороте — кто был рядом (топ-5) и за что дают награду
  const rankOf = key => rankIn(stats, key);
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
        <a class="th-year" href="#/year/${y}">🎆 Итоги ${y} года →</a>
      </div>
      <div class="th-stats">
        ${stat(monthMedia.length, "фото и видео", "#ff4fd8")}
        ${stat(reacts, plural(reacts, ["реакция", "реакции", "реакций"]), "#3ee6ff")}
        ${stat(active, "корефанов в деле", "#ffd34f")}
      </div>
    </div>
    ${state.reactsReady ? "" : `<div class="empty">Реакции ещё не включены. Нужно выполнить файл 03_reactions.sql в Supabase.</div>`}
    <section class="awards"><h2>Награды месяца</h2>${noms}</section>
    <section class="best"><h2>Лучшие фото и видео</h2><div id="bestBox"></div></section>`);
  state.current = state.topBest = best;
  paintBest();
  wireAwards();

  document.querySelectorAll("[data-tm]").forEach(b => b.onclick = () => {
    let mm = m + Number(b.dataset.tm), yy = y;
    if (mm < 0) { mm = 11; yy--; } if (mm > 11) { mm = 0; yy++; }
    state.topMonth = { y: yy, m: mm };
    viewTop();
  });
}

// «Лучшие фото и видео» месяца. На компьютере — гармошка: полосы на всю ширину, наведёшь — полоса
// плавно раскрывается, нажмёшь на раскрытую — откроется фото. На телефоне — карусель в 3D на всю ширину
// экрана: в центре фото, соседние выглядывают по краям, листается свайпом
const PHONE = matchMedia("(max-width: 700px)");
function paintBest() {
  const box = document.getElementById("bestBox"); if (!box) return;
  const list = state.topBest || [];
  if (!list.length) { box.innerHTML = `<div class="empty">В этом месяце ещё никто не ставил реакций. Открой любое фото и жми 😂 🔥 ❤️</div>`; return; }
  const rcOf = countBy(state.mr, "media_id"), ccOf = countBy(state.comments, "media_id");
  // Снизу превью (грузится мгновенно), поверх проступает чёткое фото. У видео — только превью
  const pic = m => {
    const t = url(thumbPath(m)), big = m.kind === "photo" ? url(midPath(m)) || url(m.path) : "";
    return `<span class="b-pic">${m.kind === "video"
      ? `<img class="b-ph" ${t ? `src="${t}"` : ""} data-vthumb="${m.id}" alt="" decoding="async"><span class="play">▶ видео</span>`
      : `${t ? `<img class="b-ph" src="${t}" alt="" decoding="async">` : ""}${big ? `<img class="b-full fade" src="${big}" alt="" decoding="async">` : ""}`}</span>`;
  };
  const who = m => {
    const rc = rcOf.get(m.id) || 0, cc = ccOf.get(m.id) || 0;
    return `<span class="b-who">${avatar(m.owner)}<b>${esc(nameOf(m.owner))}</b>
      <span class="b-stats"><span>🔥 ${rc}</span>${cc ? `<span>💬 ${cc}</span>` : ""}</span></span>`;
  };
  const label = (m, i) => `Место ${i + 1}: ${esc(nameOf(m.owner))}${m.caption ? `, ${esc(m.caption)}` : ""}`;
  const rank = i => i < 3 ? ` r${i + 1}` : "";

  if (PHONE.matches) {
    box.innerHTML = `<div class="b-car">
      <div class="b-stage">${list.map((m, i) => `<button type="button" class="b-card${rank(i)}" data-best="${i}" style="${ucStyle(m.owner)}" aria-label="${label(m, i)}">
        ${pic(m)}<span class="b-num">${i + 1}</span></button>`).join("")}</div>
      <div class="b-under"><div class="b-cur"></div>
        ${list.length > 1 ? `<div class="b-dots">${list.map(() => "<i></i>").join("")}</div>` : ""}</div>
    </div>`;
    return wireBestCarousel(box, list, who);
  }
  box.innerHTML = `<div class="b-acc">${list.map((m, i) => `<button type="button" class="b-item${i ? "" : " on"}${rank(i)}" data-best="${i}" style="--i:${i};${ucStyle(m.owner)}" aria-label="${label(m, i)}">
      ${pic(m)}<span class="b-num">${i + 1}</span>
      <span class="b-info">${m.caption ? `<span class="b-cap">${esc(m.caption)}</span>` : ""}${who(m)}</span>
      <span class="b-mini">${avatar(m.owner)}</span></button>`).join("")}</div>`;
  wireBestAccordion(box, list);
}
PHONE.addEventListener?.("change", () => paintBest());

function wireBestAccordion(box, list) {
  const items = [...box.querySelectorAll(".b-item")];
  let cur = 0, hover = null;
  const show = i => { if (i === cur) return; cur = i; items.forEach((b, k) => b.classList.toggle("on", k === i)); };
  items.forEach((b, i) => {
    // Небольшая задержка: когда мышь просто пролетает над полосами, они не дёргаются
    b.addEventListener("mouseenter", () => { clearTimeout(hover); hover = setTimeout(() => show(i), 70); });
    b.addEventListener("mouseleave", () => clearTimeout(hover));
    b.addEventListener("focus", () => show(i));
    b.addEventListener("click", () => {
      clearTimeout(hover);
      if (i !== cur) return show(i);
      openViewer(list[i].id, 0, b.querySelector(".b-full.loaded") || b.querySelector(".b-ph"));
    });
  });
}

function wireBestCarousel(box, list, who) {
  const stage = box.querySelector(".b-stage"), cards = [...stage.children];
  const dots = [...box.querySelectorAll(".b-dots i")], under = box.querySelector(".b-cur");
  // От трёх фото карусель идёт по кругу: у первого слева видно последнее, и по бокам никогда не пусто
  const n = list.length, loop = n >= 3;
  let cur = 0;
  const go = i => {
    cur = loop ? (i + n) % n : Math.max(0, Math.min(n - 1, i));
    cards.forEach((c, k) => {
      let off = k - cur;
      if (loop) { off = (off + n) % n; if (off > n / 2) off -= n; }
      const a = Math.abs(off);
      c.style.setProperty("--off", off);
      c.style.setProperty("--side", Math.sign(off));
      c.style.zIndex = 10 - a;
      c.classList.toggle("on", !off);
      c.classList.toggle("far", a > 1);
      c.tabIndex = a > 1 ? -1 : 0;
    });
    dots.forEach((d, k) => d.classList.toggle("on", k === cur));
    under.innerHTML = `${list[cur].caption ? `<span class="b-cap">${esc(list[cur].caption)}</span>` : ""}${who(list[cur])}`;
  };
  go(0);
  // Свайп: карточки едут за пальцем, отпустил — перелистнулось (или вернулось, если сдвинул чуть-чуть)
  let x0 = 0, y0 = 0, dx = 0, mode = null, moved = false;
  stage.addEventListener("touchstart", e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; mode = null; moved = false; }, { passive: true });
  stage.addEventListener("touchmove", e => {
    const mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
    if (!mode && Math.abs(mx) + Math.abs(my) > 8) mode = Math.abs(mx) > Math.abs(my) ? "x" : "y";
    if (mode !== "x") return;
    e.preventDefault();
    moved = true;
    // Если фото меньше трёх, у краёв сопротивление, как в настоящей карусели
    dx = !loop && ((cur === 0 && mx > 0) || (cur === n - 1 && mx < 0)) ? mx / 3 : mx;
    stage.classList.add("drag");
    stage.style.setProperty("--dx", dx + "px");
  }, { passive: false });
  const end = () => {
    if (mode !== "x") return;
    stage.classList.remove("drag");
    stage.style.setProperty("--dx", "0px");
    if (Math.abs(dx) > 50) go(cur + (dx < 0 ? 1 : -1));
    mode = null;
  };
  stage.addEventListener("touchend", end);
  stage.addEventListener("touchcancel", end);
  cards.forEach((c, i) => c.addEventListener("click", () => {
    if (moved) { moved = false; return; }   // это был свайп, а не нажатие
    if (i !== cur) return go(i);
    openViewer(list[i].id, 0, c.querySelector(".b-full.loaded") || c.querySelector(".b-ph"));
  }));
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
      <label class="toggle up-album" id="upAlbumRow" hidden><input type="checkbox" id="upAlbum" checked><span>Одним постом — фото листаются внутри, а не идут подряд по одному</span></label>
      <div class="progress" id="upProg" hidden><i></i></div>
      <p class="msg up-usage" id="upUsage"></p>
      <div class="row"><button type="submit" class="btn primary" id="upBtn" disabled>Загрузить</button><p class="msg" id="upMsg"></p></div>
    </form>`);

  // Сколько места занято (п. 33): видео весят больше всех фото вместе — видно заранее
  filesApi({ op: "usage" }).then(u => {
    const el = document.getElementById("upUsage"); if (!el || !u?.total) return;
    el.textContent = `Твои фото и видео занимают ${(u.mine / 1048576).toFixed(0)} МБ, всего у компании ${(u.total / 1048576).toFixed(0)} МБ.`;
  }).catch(() => {});
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
    // Настоящая дата съёмки из самого фото — если человек ещё не поставил дату сам
    fresh.filter(it => it.kind === "photo").forEach(it => exifDate(it.file).then(d => {
      if (!d || it.dateSet || !items.includes(it)) return;
      it.takenAt = d;
      if (items[cur] === it && $("takenAt")) $("takenAt").value = d;
    }));
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
      const mb = it.file.size / 1048576, big = mb > KOREFANY.maxVideoMb;
      box.innerHTML = `<video src="${it.vurl}" controls muted playsinline preload="metadata"></video>
        <p class="up-size${big ? " err" : ""}">${mb.toFixed(1)} МБ${big ? ` — больше ${KOREFANY.maxVideoMb} МБ, такое видео не загрузится. Обрежь его в галерее телефона` : ""}</p>`;
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
    $("upAlbumRow").hidden = items.length < 2 || !state.v132;
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
  $("takenAt").onchange = () => { if (items[cur]) { items[cur].takenAt = $("takenAt").value; items[cur].dateSet = true; } };

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
    if (e.target.closest("[data-up-alldate]")) { const d = items[cur].takenAt; items.forEach(it => { it.takenAt = d; it.dateSet = true; }); return say(`Дата поставлена на все ${items.length}`); }
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
    let noTags = 0;
    // Одна пачка — один альбом (если галочка стоит). Повторная попытка после сбоя попадёт в тот же альбом
    const album = total > 1 && state.v132 && $("upAlbum").checked ? (items[0].album ||= crypto.randomUUID()) : null;
    for (let i = 0; i < total; i++) {
      const it = items[i];
      msg.textContent = `Загружаю ${i + 1} из ${total}...`;
      bar.style.width = `${Math.max(6, (i + 0.5) / total * 100)}%`;
      // Номер у файла один на все попытки: если первая на самом деле дошла, повтор не создаст второй такой же пост
      it.id = it.id || crypto.randomUUID();
      try {
        const res = await uploadOne(it.file, { id: it.id, album, tags: it.tags, caption: it.caption.trim(), takenAt: it.takenAt || null });
        if (res.tagsFailed) noTags++;
        forget(it);
      }
      catch (err) { failed.push({ it, text: `${it.file.name}: ${err.message || err}` }); }
      bar.style.width = `${(i + 1) / total * 100}%`;
    }
    // Одно уведомление всем на всю пачку: «Костя загрузил 12 фото и 2 видео» (а не 14 штук подряд)
    if (failed.length < total) sb.rpc("announce_media").then(() => {}, () => {});
    // Связь пропала в самом конце — файлы уже загружены, просто лента обновится позже. Раньше форма тут зависала навсегда
    try { await loadAll(); } catch (err) { mergeNewMediaSoon(); }
    busy = false;
    if (noTags) setTimeout(() => toast(`Отметки не сохранились у ${noTags} из ${total} — поставь их в ленте кнопкой 👥`), 400);
    // Пока грузилось, человек ушёл на другую страницу — формы уже нет, сообщаем плашкой
    if (!e.target.isConnected) {
      toast(failed.length ? `Не загрузилось ${failed.length} из ${total}. Открой «Загрузить» и выбери их снова` : `Загружено: ${total} ${plural(total, ["файл", "файла", "файлов"])}`);
      return;
    }
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
      if (error) {
        // Не сохранилось — подсветка возвращается на прежний цвет
        box.querySelectorAll("[data-color]").forEach(x => x.setAttribute("aria-pressed", x.dataset.color === (profile(me())?.color || "pink")));
        return toast("Не получилось сменить цвет");
      }
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
      await reloadProfiles().catch(() => {}); viewMe();
      toast("Сохранено");
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
      ${isAdmin() ? `<div class="card"><h2 style="margin:0">Админка</h2><p class="msg">Приглашения, новые пароли, жалобы и журнал ошибок.</p><div><a class="btn primary" href="#/admin">Открыть админку</a></div></div>` : ""}
      ${state.v132 ? `<div class="card"><h2 style="margin:0">Удалить аккаунт</h2>
        <p class="msg">Удалятся твой профиль, все твои фото, видео, сообщения, комментарии и цитаты. Вернуть их будет нельзя.</p>
        <div><button class="btn danger" id="delMe" type="button">Удалить аккаунт…</button></div></div>` : ""}
      <p class="msg">Версия сайта: ${APP_VERSION || "?"}</p>`;
    document.getElementById("delMe")?.addEventListener("click", openDeleteMe);
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
      await clearCache();
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
    if (old) removeFiles(BUCKET, [old]);
    await reloadProfiles().catch(() => {}); viewMe();
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
    const btn = e.target.querySelector('button[type="submit"]'), msg = document.getElementById("loginMsg");
    if (btn.disabled) return;   // второе нажатие, пока идёт проверка, ничего не делает
    const email = document.getElementById("email").value.trim();
    btn.disabled = true; btn.textContent = "Вхожу…"; msg.textContent = "";
    let error = null;
    try { ({ error } = await sb.auth.signInWithPassword({ email, password: document.getElementById("password").value })); }
    catch (err) { error = err; }
    if (error) {
      btn.disabled = false; btn.textContent = "Войти";
      // Раньше любая ошибка называлась «неверный пароль» — даже когда просто не было интернета
      const noNet = !navigator.onLine || !error.status || error.status >= 500 || /fetch|network/i.test(error.message || "");
      msg.textContent = noNet ? "Нет связи с сервером. Проверь интернет (или включи VPN) и попробуй ещё раз."
        : error.status === 429 ? "Слишком много попыток подряд. Подожди минуту и попробуй снова."
        : "Не пускает: неверная почта или пароль.";
      return;
    }
    try { localStorage.setItem("korefany-email", email); } catch (e) {}
  };
}
