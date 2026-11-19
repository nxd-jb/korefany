// Корефаны: уведомления, жалобы, админка, приглашения, удаление аккаунта, правка цитат, сходки,
// «В этот день», итоги года и журнал ошибок. Пользуется общими вещами из app.js и chat.js.
// Таблицы — supabase/22_v132.sql. Пока он не выполнен, всё это прячется (state.v132 = false).

// ---------- Шторка: общая для жалобы, правки цитаты, удаления аккаунта ----------
// Устроена как шторка галереи (.gs-wrap): на телефоне снизу и тянется пальцем, на компьютере окно по центру
function openSheet(html, label) {
  document.querySelector(".gs-wrap")?.remove();
  const w = document.createElement("div");
  w.className = "gs-wrap";
  w.innerHTML = `<div class="pv-dim" data-gs-close></div>
    <div class="gs-sheet" role="dialog" aria-label="${esc(label)}"><div class="pv-grab" data-gs-close></div>${html}</div>`;
  document.body.appendChild(w);
  wireSheetDrag(w, w.querySelector(".gs-sheet"), closeGallerySheet);
  w.querySelectorAll("[data-gs-close]").forEach(b => b.addEventListener("click", closeGallerySheet));
  void w.offsetWidth; w.classList.add("open");
  return w;
}
const sayIn = (el, text, ok = false) => { if (el) { el.className = "msg" + (ok ? " ok" : " err"); el.textContent = text; } };

// ---------- Жалобы ----------
const REPORT_WHAT = { media: "фото", comment: "комментарий", message: "сообщение", quote: "цитату", profile: "человека" };
const REPORT_REASONS = ["Обидно или оскорбительно", "Личное — не хочу, чтобы это видели", "Спам или мусор", "Другое"];
function openReport(kind, target) {
  const w = openSheet(`<form class="sheet-form" id="repForm">
      <div class="gs-h"><h3>Пожаловаться на ${REPORT_WHAT[kind] || "это"}</h3></div>
      <p class="msg">Жалобу увидит только админ. Тот, на кого жалуешься, не узнает, кто её отправил.</p>
      <div class="chips">${REPORT_REASONS.map((r, i) => `<button type="button" class="chip" data-reason="${esc(r)}" aria-pressed="${i === 0}">${esc(r)}</button>`).join("")}</div>
      <label>Подробнее (по желанию)<textarea id="repText" maxlength="250" placeholder="Что не так?"></textarea></label>
      <div class="row"><button type="submit" class="btn primary">Отправить жалобу</button><p class="msg" id="repMsg"></p></div>
    </form>`, "Жалоба");
  w.querySelectorAll("[data-reason]").forEach(b => b.onclick = () => w.querySelectorAll("[data-reason]").forEach(x => x.setAttribute("aria-pressed", x === b)));
  w.querySelector("#repForm").onsubmit = async e => {
    e.preventDefault();
    const btn = e.target.querySelector("[type=submit]"); if (btn.disabled) return;
    btn.disabled = true;
    const reason = [w.querySelector("[data-reason][aria-pressed=true]")?.dataset.reason, w.querySelector("#repText").value.trim()].filter(Boolean).join(": ");
    const { error } = await sb.from("reports").insert({ kind, target, reason: reason.slice(0, 300) || null });
    if (error) { btn.disabled = false; return sayIn(w.querySelector("#repMsg"), "Не отправилось — попробуй ещё раз"); }
    closeGallerySheet();
    toast("Жалоба отправлена. Спасибо!");
  };
}
document.addEventListener("click", e => {
  const r = e.target.closest("[data-report]");
  if (r) { e.preventDefault(); e.stopPropagation(); const [kind, id] = r.dataset.report.split("|"); openReport(kind, id); }
}, true);

// ---------- Центр уведомлений ----------
// Колокольчик в шапке: комментарии к твоим фото, ответы, упоминания, отметки, реакции, цитаты, траты, сходки
state.notifs = [];
const NOTIF_KINDS = [
  ["comment", "Комментарии к моим фото"], ["reply", "Ответы на мои комментарии"], ["mention", "Меня упомянули (@имя)"],
  ["tag", "Меня отметили на фото"], ["react", "Реакции на мои фото"], ["quote", "Мои цитаты"],
  ["money", "Траты в «Счёте» на меня"], ["event", "Новые сходки"]
];
function notifText(n) {
  const t = n.text ? `: ${n.text}` : "";
  return {
    comment: `прокомментировал твоё фото${t}`, reply: `ответил на твой комментарий${t}`, mention: `упомянул тебя${t}`,
    tag: "отметил тебя на фото", react: `оценил твоё фото ${EMOJI[n.text] || ""}`, quote: `добавил твою цитату${t}`,
    money: `записал трату на тебя${t}`, event: `зовёт на сходку${t}`, report: `новая жалоба${t}`
  }[n.kind] || "что-то произошло";
}
function notifLink(n) {
  if (n.media_id) return `#/m/${n.media_id}`;
  return { quote: "#/quotes", money: `#/money/${n.target}`, event: "#/events", report: "#/admin" }[n.kind] || "#/";
}
async function loadNotifs() {
  if (!state.v132 || state.offline) return;
  const { data, error } = await sb.from("notifications").select("*").order("created_at", { ascending: false }).limit(100);
  if (error) return;
  state.notifs = data || [];
  paintBell();
  if (location.hash === "#/notifications") paintNotifs();
}
function paintBell() {
  const n = (state.notifs || []).filter(x => !x.read).length;
  document.querySelectorAll("[data-bell-badge]").forEach(b => { b.textContent = n > 99 ? "99+" : n || ""; b.hidden = !n; });
}
// Комментарий к моему фото и так показывает баннер (onComment) — здесь он не нужен второй раз
function onNotification(n) {
  if (!n || n.user_id !== me() || state.notifs.some(x => x.id === n.id)) return;
  state.notifs.unshift(n);
  paintBell();
  if (location.hash === "#/notifications") paintNotifs();
  else if (n.kind !== "comment") notifyBanner({ who: n.actor, title: nameOf(n.actor), text: notifText(n), onOpen: () => { location.hash = notifLink(n); } });
}
async function viewNotifications() {
  if (!state.v132) { shell("notifications", `<div class="empty">Уведомления появятся после обновления базы.</div>`); return; }
  shell("notifications", `
    <div class="head" style="justify-content:space-between"><div><h1>Уведомления</h1><p class="sub">Что произошло, пока тебя не было</p></div>
      <button type="button" class="btn" data-notif-all>Прочитать все</button></div>
    <div id="notifList" class="notif-list"></div>
    <p class="msg notif-hint">Что присылать на телефон, настраивается в <a href="#/me" data-goto-notify>Профиль → Уведомления</a>.</p>`);
  await loadNotifs();
  paintNotifs();
  // Открыл — значит увидел: через секунду всё отмечается прочитанным (розовые точки ещё видны)
  setTimeout(markNotifsRead, 1200);
}
function paintNotifs() {
  const box = document.getElementById("notifList"); if (!box) return;
  const list = state.notifs || [];
  box.innerHTML = list.length ? list.map(n => {
    const m = n.media_id && state.media.find(x => x.id === n.media_id), t = m && url(thumbPath(m));
    return `<a class="notif${n.read ? "" : " unread"}" href="${notifLink(n)}">
      ${avatar(n.actor)}<span class="notif-main"><b>${esc(nameOf(n.actor))}</b> ${esc(notifText(n))}<small>${ago(n.created_at)}</small></span>
      ${t ? `<img src="${t}" alt="">` : ""}</a>`;
  }).join("") : `<div class="empty">Пока тихо. Когда кто-то прокомментирует твоё фото или отметит тебя, это появится здесь.</div>`;
}
async function markNotifsRead() {
  const ids = (state.notifs || []).filter(n => !n.read).map(n => n.id);
  if (!ids.length) return;
  const { error } = await sb.from("notifications").update({ read: true }).in("id", ids.slice(0, 100));
  if (error) return;
  state.notifs.forEach(n => { if (ids.includes(n.id)) n.read = true; });
  paintBell();
}
// Блок «Что присылать на телефон» — во вкладке «Уведомления» профиля
function notifKindsHtml() {
  if (!state.v132) return "";
  return `<div class="card"><h2 style="margin:0">Что присылать на телефон</h2>
    <p class="msg">В колокольчике на сайте видно всё. Выключенное просто не будет приходить уведомлением на телефон.</p>
    <div class="notif-kinds">${NOTIF_KINDS.map(([k, t]) => `<label class="toggle"><input type="checkbox" data-notif-kind="${k}" ${(profile(me())?.notify_off || []).includes(k) ? "" : "checked"}><span>${t}</span></label>`).join("")}</div></div>`;
}
document.addEventListener("click", async e => {
  if (e.target.closest("[data-notif-all]")) { await markNotifsRead(); paintNotifs(); }
  if (e.target.closest("[data-goto-notify]")) state.meTab = "notify";
});
document.addEventListener("change", async e => {
  const cb = e.target.closest("[data-notif-kind]"); if (!cb) return;
  const off = [...document.querySelectorAll("[data-notif-kind]")].filter(x => !x.checked).map(x => x.dataset.notifKind);
  const { error } = await sb.from("profiles").update({ notify_off: off }).eq("id", me());
  if (error) { cb.checked = !cb.checked; return toast("Не сохранилось — попробуй ещё раз"); }
  const p = profile(me()); if (p) p.notify_off = off;
  toast("Сохранено");
});

// ---------- Приглашение по ссылке и новый пароль по ссылке ----------
// Ссылку делает админ (страница «Админка»), человек открывает её и сам придумывает имя и пароль
const inviteApi = async body => {
  const { data, error } = await sb.functions.invoke("invite", { body });
  if (error) { let msg = error.message; try { msg = (await error.context.json()).error || msg; } catch (er) {} throw new Error(msg); }
  return data;
};
const inviteLink = code => location.href.split("#")[0] + "#/invite/" + code;
async function viewInvite(code) {
  $app.innerHTML = `<div class="login"><h1 class="sign" aria-label="Корефаны">КОРЕФ<span class="broken">А</span>НЫ</h1>
    <p class="tagline">только для своих</p><div class="card" id="invBox"><p class="msg">Проверяю ссылку…</p></div></div>`;
  const box = document.getElementById("invBox");
  let info;
  try { info = await inviteApi({ op: "check", code }); } catch (e) { info = { ok: false, error: "Не получилось проверить ссылку. Проверь интернет или включи VPN." }; }
  if (!info.ok) { box.innerHTML = `<p class="msg err">${esc(info.error)}</p><a class="btn" href="#/">На главную</a>`; return; }
  const reset = info.kind === "reset";
  box.innerHTML = `<form id="invForm" class="sheet-form">
      <h2 style="margin:0">${reset ? `Новый пароль${info.name ? ` для ${esc(info.name)}` : ""}` : "Тебя позвали в Корефаны 🎉"}</h2>
      ${reset ? "" : `<label>Как тебя зовут<input type="text" id="invName" maxlength="40" required autocomplete="nickname"></label>
      <label>Почта (для входа)<input type="email" id="invEmail" required autocomplete="username"></label>`}
      <label>${reset ? "Новый пароль" : "Придумай пароль"}, минимум 8 символов<input type="password" id="invPass" minlength="8" required autocomplete="new-password"></label>
      <button class="btn primary" type="submit">${reset ? "Сохранить и войти" : "Войти в Корефаны"}</button>
      <p class="msg" id="invMsg"></p></form>`;
  document.getElementById("invForm").onsubmit = async e => {
    e.preventDefault();
    const btn = e.target.querySelector("[type=submit]"); if (btn.disabled) return;
    btn.disabled = true; sayIn(document.getElementById("invMsg"), "Секунду…", true);
    const password = document.getElementById("invPass").value;
    try {
      const r = await inviteApi({ op: "accept", code, password,
        name: document.getElementById("invName")?.value.trim(), email: document.getElementById("invEmail")?.value.trim() });
      history.replaceState(null, "", "#/");
      try { localStorage.setItem("korefany-email", r.email); } catch (er) {}
      const { error } = await sb.auth.signInWithPassword({ email: r.email, password });
      if (error) { viewLogin(); toast("Готово! Теперь войди с новым паролем"); }
    } catch (err) { btn.disabled = false; sayIn(document.getElementById("invMsg"), err.message || String(err)); }
  };
}

// ---------- Удаление своего аккаунта ----------
function openDeleteMe() {
  const w = openSheet(`<form class="sheet-form" id="delMeForm">
      <div class="gs-h"><h3>Удалить аккаунт</h3></div>
      <p class="msg">Удалятся профиль, все твои фото и видео, сообщения, комментарии, цитаты и траты. <b>Вернуть их будет нельзя.</b></p>
      <label>Чтобы подтвердить, напиши УДАЛИТЬ<input type="text" id="delMeWord" autocomplete="off"></label>
      <div class="row"><button type="submit" class="btn danger">Удалить навсегда</button><button type="button" class="btn" data-gs-close>Отмена</button><p class="msg" id="delMeMsg"></p></div>
    </form>`, "Удалить аккаунт");
  w.querySelector("#delMeForm").onsubmit = async e => {
    e.preventDefault();
    if (w.querySelector("#delMeWord").value.trim().toUpperCase() !== "УДАЛИТЬ") return sayIn(w.querySelector("#delMeMsg"), "Напиши слово УДАЛИТЬ");
    const btn = e.target.querySelector("[type=submit]"); btn.disabled = true;
    try {
      await inviteApi({ op: "delete_me", confirm: "УДАЛИТЬ" });
      await unlinkPushDevice();
      try { await caches.delete("korefany-pics-v1"); } catch (er) {}
      await clearCache();
      closeGallerySheet();
      await sb.auth.signOut();
    } catch (err) { btn.disabled = false; sayIn(w.querySelector("#delMeMsg"), "Не получилось: " + (err.message || err)); }
  };
}

// ---------- Админка: приглашения, люди, жалобы, журнал ошибок ----------
async function viewAdmin() {
  if (!isAdmin()) { shell("", `<div class="empty">Эта страница только для админа.</div>`); return; }
  shell("", `<div><h1>Админка</h1><p class="sub">Видишь её только ты</p></div>
    <section class="card"><h2 style="margin:0">Позвать в Корефаны</h2>
      <p class="msg">Ссылка одноразовая и действует 7 дней. Человек сам придумает имя, почту и пароль.</p>
      <div class="row"><input type="text" id="invNote" maxlength="80" placeholder="Для кого (видишь только ты)"><button type="button" class="btn primary" data-inv-new>Сделать ссылку</button></div>
      <div id="invOut"></div><div id="invList" class="adm-list"></div></section>
    <section class="card"><h2 style="margin:0">Люди</h2><div id="admPeople" class="adm-list"></div></section>
    <section class="card"><h2 style="margin:0">Жалобы</h2><div id="admReports" class="adm-list"><p class="msg">Загружаю…</p></div></section>
    <section class="card"><h2 style="margin:0">Журнал ошибок</h2><p class="msg">Ошибки, которые случились у людей на сайте. По ним я нахожу баги, которые не видно на стенде.</p>
      <div id="admErrors" class="adm-list"><p class="msg">Загружаю…</p></div></section>`);
  paintAdminPeople();
  loadAdminLists();
}
function paintAdminPeople() {
  const box = document.getElementById("admPeople"); if (!box) return;
  box.innerHTML = state.profiles.map(p => `<div class="adm-row">${avatar(p.id)}<b>${esc(p.name)}${state.admins.includes(p.id) ? " · админ" : ""}</b>
    <span class="adm-acts">${p.id === me() ? "" : `<button type="button" class="link-btn" data-adm-reset="${p.id}">ссылка на новый пароль</button>
      <button type="button" class="link-btn danger-t" data-adm-remove="${p.id}">убрать из компании</button>`}</span></div>`).join("");
}
async function loadAdminLists() {
  const [inv, rep, err] = await Promise.all([
    sb.from("invites").select("*").order("created_at", { ascending: false }).limit(30),
    sb.from("reports").select("*").order("created_at", { ascending: false }).limit(50),
    sb.from("client_errors").select("*").order("created_at", { ascending: false }).limit(60)
  ]);
  const il = document.getElementById("invList");
  if (il) il.innerHTML = (inv.data || []).filter(x => x.kind === "join").map(x => `<div class="adm-row"><span>${esc(x.note || "без подписи")}</span>
    <small>${x.used_at ? `использована · ${esc(nameOf(x.used_by))}` : new Date(x.expires_at) < new Date() ? "срок вышел" : `действует до ${dayText(x.expires_at)}`}</small>
    ${x.used_at ? "" : `<button type="button" class="link-btn" data-inv-del="${x.id}">отозвать</button>`}</div>`).join("");
  const rl = document.getElementById("admReports");
  if (rl) rl.innerHTML = rep.error ? `<p class="msg err">Не загрузилось</p>` : (rep.data || []).length ? rep.data.map(r => `<div class="adm-row${r.status === "new" ? " unread" : ""}">
      <span><b>${esc(nameOf(r.author))}</b> пожаловался на ${REPORT_WHAT[r.kind] || r.kind}${r.reason ? `: ${esc(r.reason)}` : ""}<small>${ago(r.created_at)}</small></span>
      <span class="adm-acts"><button type="button" class="link-btn" data-rep-open="${r.kind}|${r.target}">открыть</button>
      ${r.status === "new" ? `<button type="button" class="link-btn" data-rep-done="${r.id}">разобрано</button>` : "<small>разобрано</small>"}</span></div>`).join("")
    : `<p class="msg">Жалоб нет 👌</p>`;
  const el = document.getElementById("admErrors");
  if (el) el.innerHTML = err.error ? `<p class="msg err">Не загрузилось</p>` : (err.data || []).length ? `<div class="row"><button type="button" class="btn" data-err-clear>Очистить журнал</button></div>` +
    err.data.map(x => `<div class="adm-row err-row"><span><b>${esc(x.message)}</b><small>${esc(nameOf(x.user_id))} · v${x.version || "?"} · ${esc(x.page || "")} · ${ago(x.created_at)}</small>
      <small>${esc(x.where_ || "")}</small><small>${esc(x.device || "")}</small></span></div>`).join("")
    : `<p class="msg">Ошибок нет 👌</p>`;
}
async function openReported(kind, id) {
  if (kind === "media") return location.hash = `#/m/${id}`;
  if (kind === "profile") return location.hash = `#/p/${id}`;
  if (kind === "quote") return location.hash = "#/quotes";
  if (kind === "comment") { const c = state.comments.find(x => x.id === id); return c ? (location.hash = `#/m/${c.media_id}`) : toast("Комментарий уже удалён"); }
  if (kind === "message") {
    const { data } = await sb.from("messages").select("chat_id, text").eq("id", id).maybeSingle();
    if (!data) return toast("Сообщение уже удалено");
    location.hash = `#/chat/${data.chat_id}`;
  }
}
document.addEventListener("click", async e => {
  const t = e.target;
  if (t.closest("[data-inv-new]")) {
    const btn = t.closest("[data-inv-new]"); btn.disabled = true;
    try {
      const { code, days } = await inviteApi({ op: "create", kind: "join", note: document.getElementById("invNote")?.value.trim() });
      showLink(document.getElementById("invOut"), inviteLink(code), `Ссылка действует ${days} дней и сработает один раз. Отправь её человеку.`);
      loadAdminLists();
    } catch (err) { toast("Не получилось: " + (err.message || err)); }
    btn.disabled = false;
    return;
  }
  const rs = t.closest("[data-adm-reset]");
  if (rs) {
    rs.disabled = true;
    try {
      const { code, days } = await inviteApi({ op: "create", kind: "reset", for_user: rs.dataset.admReset });
      const w = openSheet(`<div class="gs-h"><h3>Новый пароль для ${esc(nameOf(rs.dataset.admReset))}</h3></div><div id="rsOut"></div>`, "Новый пароль");
      showLink(w.querySelector("#rsOut"), inviteLink(code), `По ссылке ${esc(nameOf(rs.dataset.admReset))} сам придумает новый пароль. Действует ${days} дня, один раз.`);
    } catch (err) { toast("Не получилось: " + (err.message || err)); }
    rs.disabled = false;
    return;
  }
  const rm = t.closest("[data-adm-remove]");
  if (rm) {
    const id = rm.dataset.admRemove;
    if (rm.textContent !== "точно? всё его удалится") { rm.textContent = "точно? всё его удалится"; return; }
    rm.disabled = true;
    try { await inviteApi({ op: "remove", user: id }); await reloadProfiles(); toast("Убран из компании"); viewAdmin(); }
    catch (err) { rm.disabled = false; toast("Не получилось: " + (err.message || err)); }
    return;
  }
  const idel = t.closest("[data-inv-del]");
  if (idel) { await sb.from("invites").delete().eq("id", idel.dataset.invDel); return loadAdminLists(); }
  const ro = t.closest("[data-rep-open]");
  if (ro) { const [k, id] = ro.dataset.repOpen.split("|"); return openReported(k, id); }
  const rd = t.closest("[data-rep-done]");
  if (rd) {
    // Ответ с select показывает, правда ли строка поменялась: пустой — база не дала закрыть (раньше молча ничего не происходило)
    rd.disabled = true;
    const { data, error } = await sb.from("reports").update({ status: "done" }).eq("id", rd.dataset.repDone).select("id");
    if (error || !data?.length) {
      rd.disabled = false;
      return toast(error ? "Не получилось: " + (error.message || error.code) : "База не дала закрыть жалобу — проверь, что ты админ");
    }
    const row = rd.closest(".adm-row"); row?.classList.remove("unread"); rd.outerHTML = "<small>разобрано</small>";
    return;
  }
  if (t.closest("[data-err-clear]")) {
    const b = t.closest("[data-err-clear]");
    if (b.textContent !== "Точно очистить?") { b.textContent = "Точно очистить?"; return; }
    await sb.from("client_errors").delete().gte("id", 0); return loadAdminLists();
  }
});
function showLink(box, link, note) {
  if (!box) return;
  box.innerHTML = `<div class="inv-link"><input type="text" readonly value="${esc(link)}" aria-label="Ссылка"><button type="button" class="btn primary" data-copy-link>Скопировать</button></div><p class="msg">${note}</p>`;
  const inp = box.querySelector("input");
  box.querySelector("[data-copy-link]").onclick = async () => {
    try { await navigator.clipboard.writeText(link); toast("Ссылка скопирована"); }
    catch (er) { inp.select(); toast("Выдели и скопируй ссылку"); }
  };
}

// ---------- Правка своей цитаты ----------
function openQuoteEdit(id) {
  const q = state.quotes.find(x => x.id === id); if (!q) return;
  const w = openSheet(`<form class="sheet-form" id="qeForm">
      <div class="gs-h"><h3>Изменить ${q.kind === "joke" ? "шутку" : "цитату"}</h3></div>
      <div class="row"><button type="button" class="tab" data-qek="quote" aria-pressed="${q.kind === "quote"}">Цитата</button>
        <button type="button" class="tab" data-qek="joke" aria-pressed="${q.kind === "joke"}">Шутка</button></div>
      <label>Текст<textarea id="qeText" maxlength="1000" required>${esc(q.text)}</textarea></label>
      <label>Кто сказал<div class="chips">
        <button type="button" class="chip" data-qew="" aria-pressed="${!q.author_id}">Кто-то</button>
        ${state.profiles.map(p => `<button type="button" class="chip" data-qew="${p.id}" aria-pressed="${q.author_id === p.id}">${avatar(p.id)}${esc(p.name)}</button>`).join("")}</div></label>
      <label>Где и когда<input type="text" id="qeCtx" maxlength="120" value="${esc(q.context || "")}"></label>
      <div class="row"><button type="submit" class="btn primary">Сохранить</button><p class="msg" id="qeMsg"></p></div></form>`, "Изменить цитату");
  autoGrow(w.querySelector("#qeText"));
  const single = sel => w.querySelectorAll(sel).forEach(b => b.onclick = () => w.querySelectorAll(sel).forEach(x => x.setAttribute("aria-pressed", x === b)));
  single("[data-qek]"); single("[data-qew]");
  w.querySelector("#qeForm").onsubmit = async e => {
    e.preventDefault();
    const text = w.querySelector("#qeText").value.trim(); if (!text) return sayIn(w.querySelector("#qeMsg"), "Текст не может быть пустым");
    const row = { kind: w.querySelector("[data-qek][aria-pressed=true]").dataset.qek, text,
      author_id: w.querySelector("[data-qew][aria-pressed=true]").dataset.qew || null, context: w.querySelector("#qeCtx").value.trim() || null };
    const { error } = await sb.from("quotes").update(row).eq("id", id);
    if (error) return sayIn(w.querySelector("#qeMsg"), "Не сохранилось — попробуй ещё раз");
    Object.assign(q, row); saveCache(); closeGallerySheet(); route(); toast("Сохранено");
  };
}
document.addEventListener("click", e => { const b = e.target.closest("[data-editq]"); if (b) openQuoteEdit(b.dataset.editq); });

// ---------- Сходки: когда, где, кто идёт ----------
const EV_ANS = [["yes", "Иду"], ["maybe", "Может быть"], ["no", "Не смогу"]];
async function viewEvents() {
  const [ev, go] = await Promise.all([
    sb.from("events").select("*").order("starts_at"),
    sb.from("event_going").select("*")
  ]);
  if (ev.error) { shell("", `<div class="empty">Сходки появятся после обновления базы.</div>`); return; }
  const now = Date.now() - 6 * 3600e3;   // идущая сейчас сходка ещё 6 часов считается будущей
  const future = ev.data.filter(x => new Date(x.starts_at) >= now), past = ev.data.filter(x => new Date(x.starts_at) < now).reverse();
  const card = x => {
    const ans = (go.data || []).filter(g => g.event_id === x.id), mine = ans.find(g => g.user_id === me())?.answer;
    const d = new Date(x.starts_at);
    return `<article class="card ev">
      <div class="ev-date"><b>${d.getDate()}</b><span>${MONTHS_OF[d.getMonth()].slice(0, 3)}</span></div>
      <div class="ev-main"><h3>${esc(x.title)}</h3>
        <p class="msg">${d.toLocaleDateString("ru-RU", { weekday: "long" })}, ${d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}${x.place ? ` · ${esc(x.place)}` : ""} · зовёт ${esc(nameOf(x.created_by))}</p>
        ${x.note ? `<p>${esc(x.note)}</p>` : ""}
        <div class="row">${EV_ANS.map(([k, t]) => `<button type="button" class="tab" data-ev="${x.id}|${k}" aria-pressed="${mine === k}">${t} ${ans.filter(g => g.answer === k).length || ""}</button>`).join("")}</div>
        <div class="ev-who">${ans.filter(g => g.answer === "yes").map(g => avatar(g.user_id)).join("")}</div>
        ${x.created_by === me() || isAdmin() ? `<button type="button" class="link-btn" data-ev-del="${x.id}">удалить</button>` : ""}
      </div></article>`;
  };
  shell("", `<div class="head" style="justify-content:space-between"><div><h1>Сходки</h1><p class="sub">Когда и где собираемся — и кто придёт</p></div>
      <button type="button" class="btn primary" data-ev-new>+ Сходка</button></div>
    <form class="card sheet-form" id="evForm" hidden>
      <label>Что<input type="text" id="evTitle" maxlength="80" required placeholder="Например: шашлыки на даче"></label>
      <div class="row"><label>Когда<input type="datetime-local" id="evAt" required></label><label>Где<input type="text" id="evPlace" maxlength="120" placeholder="Адрес или место"></label></div>
      <label>Подробности<textarea id="evNote" maxlength="500" placeholder="Что взять с собой, во сколько сбор"></textarea></label>
      <div class="row"><button type="submit" class="btn primary">Позвать всех</button><p class="msg" id="evMsg"></p></div></form>
    ${future.length ? future.map(card).join("") : `<div class="empty">Ближайших сходок нет. Позови всех первым!</div>`}
    ${past.length ? `<h2>Прошедшие</h2>${past.slice(0, 10).map(card).join("")}` : ""}`);
  const f = document.getElementById("evForm");
  f.onsubmit = async e => {
    e.preventDefault();
    const at = document.getElementById("evAt").value;
    if (!at) return sayIn(document.getElementById("evMsg"), "Выбери дату и время");
    const btn = f.querySelector("[type=submit]"); if (btn.disabled) return; btn.disabled = true;
    const { error } = await sb.from("events").insert({ title: document.getElementById("evTitle").value.trim(), starts_at: new Date(at).toISOString(),
      place: document.getElementById("evPlace").value.trim() || null, note: document.getElementById("evNote").value.trim() || null });
    btn.disabled = false;
    if (error) return sayIn(document.getElementById("evMsg"), "Не сохранилось — попробуй ещё раз");
    toast("Сходка создана — всем придёт уведомление"); viewEvents();
  };
}
document.addEventListener("click", async e => {
  if (e.target.closest("[data-ev-new]")) { const f = document.getElementById("evForm"); if (f) { f.hidden = !f.hidden; if (!f.hidden) document.getElementById("evTitle").focus(); } return; }
  const a = e.target.closest("[data-ev]");
  if (a) {
    const [event_id, answer] = a.dataset.ev.split("|");
    const { error } = await sb.from("event_going").upsert({ event_id, user_id: me(), answer });
    if (error) return toast("Не сохранилось — проверь связь");
    return viewEvents();
  }
  const d = e.target.closest("[data-ev-del]");
  if (d) { if (d.textContent !== "точно удалить?") { d.textContent = "точно удалить?"; return; } await sb.from("events").delete().eq("id", d.dataset.evDel); viewEvents(); }
});

// ---------- «В этот день»: фото, снятые в этот же день в прошлые годы ----------
function onThisDayHtml() {
  const t = new Date(), list = state.media.filter(m => {
    const d = toDate(m.taken_at || m.created_at);
    return d.getDate() === t.getDate() && d.getMonth() === t.getMonth() && d.getFullYear() < t.getFullYear();
  });
  if (!list.length) return "";
  const years = [...new Set(list.map(m => toDate(m.taken_at || m.created_at).getFullYear()))].sort((a, b) => b - a);
  const ago1 = t.getFullYear() - years[0];
  return `<section class="otd"><h2>В этот день <small>${ago1} ${plural(ago1, ["год", "года", "лет"])} назад${years.length > 1 ? " и раньше" : ""}</small></h2>
    <div class="otd-strip">${list.slice(0, 12).map(m => `<button type="button" class="otd-t" data-open="${m.id}" aria-label="Открыть">
      ${url(thumbPath(m)) ? `<img src="${url(thumbPath(m))}" alt="" loading="lazy">` : "🖼"}<span>${toDate(m.taken_at || m.created_at).getFullYear()}</span></button>`).join("")}</div></section>`;
}
// Ссылки на превью для «В этот день» берутся заранее (лента зовёт это до отрисовки)
async function prepOnThisDay() {
  const t = new Date();
  const list = state.media.filter(m => { const d = toDate(m.taken_at || m.created_at); return d.getDate() === t.getDate() && d.getMonth() === t.getMonth() && d.getFullYear() < t.getFullYear(); });
  if (list.length) await signed(list.slice(0, 12).map(thumbPath));
}

// ---------- Итоги года ----------
async function viewYear(y) {
  y = +y || new Date().getFullYear();
  const inYear = iso => new Date(iso).getFullYear() === y;
  const media = state.media.filter(m => inYear(m.taken_at || m.created_at));
  const count = (list, f) => { const c = new Map(); list.forEach(x => { const k = f(x); if (k) c.set(k, (c.get(k) || 0) + 1); }); return [...c].sort((a, b) => b[1] - a[1]); };
  const uploaders = count(media, m => m.owner), stars = count(media.flatMap(m => m.people.map(p => ({ p }))), x => x.p);
  const rc = countBy(state.mr.filter(r => inYear(r.created_at)), "media_id");
  const best = [...media].sort((a, b) => (rc.get(b.id) || 0) - (rc.get(a.id) || 0)).slice(0, 9);
  const months = count(media, m => toDate(m.taken_at || m.created_at).getMonth() + 1);
  const quotes = state.quotes.filter(q => inYear(q.created_at));
  const laughs = countBy(state.qr.filter(r => r.emoji === "laugh"), "quote_id");
  const topQuote = [...quotes].sort((a, b) => (laughs.get(b.id) || 0) - (laughs.get(a.id) || 0))[0];
  const person = (list, unit) => list[0] && profile(list[0][0]) ? `<a class="yr-p" href="#/p/${list[0][0]}">${avatar(list[0][0], true)}<b>${esc(nameOf(list[0][0]))}</b><small>${list[0][1]} ${plural(list[0][1], unit)}</small></a>` : `<p class="msg">—</p>`;
  const years = [...new Set(state.media.map(m => toDate(m.taken_at || m.created_at).getFullYear()))].sort();
  shell("top", `<div class="head" style="justify-content:space-between"><div><h1>Итоги ${y}</h1><p class="sub">Как прошёл год у корефанов</p></div>
      <div class="row">${years.map(x => `<a class="tab" href="#/year/${x}" aria-pressed="${x === y}">${x}</a>`).join("")}</div></div>
    ${!media.length ? `<div class="empty">В ${y} году фото пока нет.</div>` : `
    <div class="yr-stats"><div><b data-count="${media.length}">${media.length}</b><span>фото и видео</span></div>
      <div><b data-count="${state.mr.filter(r => inYear(r.created_at)).length}">${state.mr.filter(r => inYear(r.created_at)).length}</b><span>реакций</span></div>
      <div><b data-count="${quotes.length}">${quotes.length}</b><span>цитат</span></div>
      <div><b>${months[0] ? MONTHS[months[0][0] - 1] : "—"}</b><span>самый фотогеничный месяц</span></div></div>
    <div class="yr-people"><div class="card"><h3>📸 Фотограф года</h3>${person(uploaders, ["загрузка", "загрузки", "загрузок"])}</div>
      <div class="card"><h3>⭐ Звезда года</h3>${person(stars, ["отметка", "отметки", "отметок"])}</div></div>
    ${topQuote ? `<section><h2>Цитата года</h2>${quoteCard(topQuote)}</section>` : ""}
    <section><h2>Лучшие фото года</h2>${await grid(best, "", true)}</section>`}`);
  state.current = best;
}

// ---------- Журнал ошибок (п. 34): что сломалось у людей, пишется в базу ----------
// Одинаковые ошибки — один раз, не больше 10 за запуск. Видит только админ (страница «Админка»)
const errSent = new Set();
function logError(message, where) {
  message = String(message || "").slice(0, 500);
  if (!message || /ResizeObserver loop|Script error\.?$|stale|AbortError|NotAllowedError/i.test(message)) return;
  if (errSent.has(message) || errSent.size >= 10 || !state.session || state.offline || !state.v132) return;
  errSent.add(message);
  sb.from("client_errors").insert({ message, where_: String(where || "").slice(0, 300), version: APP_VERSION || null,
    device: navigator.userAgent.slice(0, 300), page: location.hash.slice(0, 200) }).then(() => {}, () => {});
}
addEventListener("error", e => { if (e.message) logError(e.message, `${(e.filename || "").split("/").pop()}:${e.lineno}:${e.colno}`); });
addEventListener("unhandledrejection", e => logError(e.reason?.message || e.reason, (e.reason?.stack || "").split("\n")[1]?.trim()));

// ---------- Правая колонка ленты на широком экране (пункт 29, вариант Б) ----------
// Кто в сети, ближайшие дни рождения и сходки, лидер месяца, свежие цитаты. На телефоне и узком экране её нет
function feedAsideHtml() {
  const online = state.profiles.filter(p => p.id !== me() && chat.online?.has(p.id));
  const soon = state.profiles.map(p => {
    const md = bdayMD(p); if (!md) return null;
    const now = new Date(), d = new Date(now.getFullYear(), md[0] - 1, md[1]);
    if (d < new Date(now.getFullYear(), now.getMonth(), now.getDate())) d.setFullYear(d.getFullYear() + 1);
    const days = Math.round((d - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5);
    return days <= 30 ? { p, days } : null;
  }).filter(Boolean).sort((a, b) => a.days - b.days).slice(0, 3);
  const now = new Date(), stats = allMonthStats().get(now.getFullYear() * 12 + now.getMonth()) || {};
  const lead = leaderOf(stats, "score");
  const quotes = state.quotes.slice(0, 2);
  const when = d => d === 0 ? "сегодня" : d === 1 ? "завтра" : `через ${d} ${plural(d, ["день", "дня", "дней"])}`;
  return `<section class="fa-card" data-fa-online><h3>В сети</h3>${online.length
      ? online.map(p => `<a class="fa-row" href="#/p/${p.id}"><span class="ava-wrap is-online">${avatar(p.id)}</span>${esc(p.name)}</a>`).join("")
      : `<p class="msg">Сейчас никого</p>`}</section>
    <section class="fa-card"><h3>Скоро</h3><div id="faSoon">${soon.map(x => `<a class="fa-row" href="#/p/${x.p.id}">🎂 ${esc(x.p.name)}<small>${when(x.days)}</small></a>`).join("") || `<p class="msg">Ближайших праздников нет</p>`}</div>
      ${state.v132 ? `<a class="link-btn" href="#/events">Все сходки →</a>` : ""}</section>
    ${lead ? `<section class="fa-card"><h3>Лидер месяца</h3><a class="fa-row" href="#/top">${avatar(lead[0])}<b>${esc(nameOf(lead[0]))}</b><small>👑 ${lead[1].score}</small></a></section>` : ""}
    ${quotes.length ? `<section class="fa-card"><h3>Свежие цитаты</h3>${quotes.map(q => `<a class="fa-q" href="#/quotes">«${esc(q.text.slice(0, 90))}${q.text.length > 90 ? "…" : ""}»<small>${q.author_id ? esc(nameOf(q.author_id)) : "Кто-то"}</small></a>`).join("")}</section>` : ""}`;
}
// Ближайшие сходки догружаются в колонку отдельно (их нет в сохранённых данных)
async function fillAsideEvents() {
  if (!state.v132 || state.offline || !document.getElementById("faSoon")) return;
  const { data } = await sb.from("events").select("id, title, starts_at").gte("starts_at", new Date(Date.now() - 6 * 3600e3).toISOString()).order("starts_at").limit(2);
  const box = document.getElementById("faSoon"); if (!box || !data?.length) return;
  box.insertAdjacentHTML("afterbegin", data.map(e => {
    const d = new Date(e.starts_at);
    return `<a class="fa-row" href="#/events">📅 ${esc(e.title)}<small>${d.getDate()} ${MONTHS_OF[d.getMonth()]}</small></a>`;
  }).join(""));
  box.querySelector(".msg")?.remove();
}
// Кто-то зашёл или вышел — обновляем «В сети» в колонке
function paintAsideOnline() {
  const el = document.querySelector("[data-fa-online]"); if (!el) return;
  const tmp = document.createElement("div"); tmp.innerHTML = feedAsideHtml();
  el.replaceWith(tmp.querySelector("[data-fa-online]"));
}

// ---------- Экран «нет связи», «ошибка» (пункт 27, вариант А) ----------
// Один вид для всех разделов: неоновая «К», понятное объяснение и кнопка
function errorScreen(title, text, button = "Повторить", action = "location.reload()") {
  return `<div class="err-screen" role="alert"><div class="err-k" aria-hidden="true">К</div><b>${esc(title)}</b><p>${text}</p>
    ${button ? `<button type="button" class="btn primary" onclick="${action}">${esc(button)}</button>` : ""}</div>`;
}

// ---------- Кто поставил реакцию (правка 17А) ----------
// Компьютер: навёл на реакцию — через долю секунды окошко с именами. Телефон: долгое нажатие на реакцию
// (обычное нажатие по-прежнему ставит или снимает свою)
const RX_SEL = "[data-react], [data-mreact], [data-clike]";
function reactorsOf(el) {
  if (el.dataset.react) return reactsOf(el.dataset.react, el.dataset.id).filter(r => r.emoji === el.dataset.emoji).map(r => r.user_id);
  if (el.dataset.mreact) return (chat.reacts || []).filter(r => r.message_id === el.dataset.mreact && r.emoji === el.dataset.emoji).map(r => r.user_id);
  if (el.dataset.clike) return (state.clikes || []).filter(r => r.comment_id === el.dataset.clike).map(r => r.user_id);
  return [];
}
let rxTip = null, rxTimer = 0, rxFor = null, rxEatClick = 0;
function hideRxTip() { clearTimeout(rxTimer); rxTip?.remove(); rxTip = null; rxFor = null; }
function showRxTip(el) {
  const ids = [...new Set(reactorsOf(el))];
  if (!ids.length || !el.isConnected) return false;
  hideRxTip(); rxFor = el;
  const emoji = el.dataset.clike ? "♥" : el.dataset.mreact ? emo(el.dataset.emoji) : (EMOJI[el.dataset.emoji] || el.dataset.emoji);
  rxTip = document.createElement("div");
  rxTip.className = "rx-tip"; rxTip.setAttribute("role", "tooltip");
  rxTip.innerHTML = `<div class="rx-tip-h">${emoji} <b>${ids.length}</b></div>` +
    ids.slice(0, 12).map(u => `<div class="rx-tip-p">${avatar(u)}<span>${esc(u === me() ? "Ты" : nameOf(u))}</span></div>`).join("") +
    (ids.length > 12 ? `<div class="rx-tip-more">и ещё ${ids.length - 12}</div>` : "");
  document.body.appendChild(rxTip);
  const r = el.getBoundingClientRect(), t = rxTip.getBoundingClientRect();
  const left = Math.min(innerWidth - t.width - 8, Math.max(8, r.left + r.width / 2 - t.width / 2));
  const top = r.top - t.height - 8 >= 8 ? r.top - t.height - 8 : r.bottom + 8;
  rxTip.style.left = left + "px"; rxTip.style.top = top + "px";
  return true;
}
if (matchMedia("(hover: hover) and (pointer: fine)").matches) {
  document.addEventListener("mouseover", e => {
    const el = e.target.closest?.(RX_SEL);
    if (el === rxFor) return;
    hideRxTip();
    if (el) rxTimer = setTimeout(() => showRxTip(el), 350);
  });
}
// Долгое нажатие на телефоне
let rxPress = 0, rxX = 0, rxY = 0;
document.addEventListener("touchstart", e => {
  const el = e.target.closest?.(RX_SEL);
  if (rxTip && !e.target.closest(".rx-tip")) hideRxTip();
  clearTimeout(rxPress);
  if (!el || e.touches.length > 1) return;
  rxX = e.touches[0].clientX; rxY = e.touches[0].clientY;
  rxPress = setTimeout(() => { if (showRxTip(el)) { rxEatClick = Date.now(); navigator.vibrate?.(12); } }, 450);
}, { passive: true });
document.addEventListener("touchmove", e => { if (Math.hypot(e.touches[0].clientX - rxX, e.touches[0].clientY - rxY) > 10) clearTimeout(rxPress); }, { passive: true });
document.addEventListener("touchend", () => clearTimeout(rxPress), { passive: true });
// Отпустил палец после долгого нажатия — это не «поставить реакцию»
document.addEventListener("click", e => {
  if (Date.now() - rxEatClick < 800 && e.target.closest(RX_SEL)) { e.preventDefault(); e.stopImmediatePropagation(); rxEatClick = 0; }
}, true);
document.addEventListener("contextmenu", e => { if (Date.now() - rxEatClick < 800 && e.target.closest(RX_SEL)) e.preventDefault(); });
addEventListener("scroll", hideRxTip, true);
addEventListener("hashchange", hideRxTip);
