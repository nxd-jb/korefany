// Корефаны: «Счёт» — общие траты на поездку или сходку и кто кому сколько должен.
// Пользуется общими вещами из app.js: sb, state, shell, avatar, esc, toast, nameOf и т.д.
// Страницы: #/money — все кассы, #/money/<id> — одна касса. Таблицы — 17_money.sql.
// Все суммы внутри считаем в копейках (целыми числами), чтобы не было ошибок округления

const money = {
  ready: true,   // false, если 17_money.sql ещё не выполнен
  trips: [],     // кассы: { id, title, members[], closed, created_by, created_at }
  items: [],     // траты: { id, trip_id, payer, amount, title, shares[], created_by, created_at }
  paid: [],      // возвраты: { id, trip_id, from_user, to_user, amount, created_by, created_at }
  newOpen: false // открыта ли форма «Новая касса»
};

const cents = x => Math.round(Number(x) * 100);
const rub = c => {
  const v = Math.abs(c) / 100;
  return new Intl.NumberFormat("ru-RU", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(v) + " ₽";
};

async function loadMoney() {
  const [t, i, p] = await Promise.all([
    sb.from("money_trips").select("*").order("created_at", { ascending: false }),
    sb.from("money_items").select("*").order("created_at", { ascending: false }),
    sb.from("money_paid").select("*").order("created_at", { ascending: false })
  ]);
  money.ready = !t.error;
  money.trips = t.data || []; money.items = i.data || []; money.paid = p.data || [];
}

// Баланс каждого в кассе: плюс — ему должны, минус — он должен.
// Трата делится поровну; лишние копейки (1000 ₽ на троих) достаются первым в списке, чтобы сумма сходилась точно
function tripBalances(tripId) {
  const bal = new Map();
  const add = (id, c) => bal.set(id, (bal.get(id) || 0) + c);
  money.items.filter(x => x.trip_id === tripId).forEach(x => {
    const total = cents(x.amount), n = x.shares.length, part = Math.floor(total / n);
    add(x.payer, total);
    x.shares.forEach((u, k) => add(u, -(part + (k < total - part * n ? 1 : 0))));
  });
  // Вернул долг: отдавший «доплатил», получивший «получил своё»
  money.paid.filter(x => x.trip_id === tripId).forEach(x => { add(x.from_user, cents(x.amount)); add(x.to_user, -cents(x.amount)); });
  return bal;
}

// Кто кому сколько: самому большому должнику — к самому большому кредитору, пока все не в расчёте.
// Так переводов получается минимум (или почти минимум)
function settleUp(bal) {
  const plus = [...bal].filter(([, c]) => c > 0).map(([id, c]) => ({ id, c })).sort((a, b) => b.c - a.c);
  const minus = [...bal].filter(([, c]) => c < 0).map(([id, c]) => ({ id, c: -c })).sort((a, b) => b.c - a.c);
  const out = [];
  let i = 0, j = 0;
  while (i < minus.length && j < plus.length) {
    const c = Math.min(minus[i].c, plus[j].c);
    if (c > 0) out.push({ from: minus[i].id, to: plus[j].id, c });
    minus[i].c -= c; plus[j].c -= c;
    if (!minus[i].c) i++;
    if (!plus[j].c) j++;
  }
  return out;
}

const tripTotal = tripId => money.items.filter(x => x.trip_id === tripId).reduce((s, x) => s + cents(x.amount), 0);

// Моё положение одной строкой: «тебе должны 1 250 ₽» / «ты должен 300 ₽» / «в расчёте»
function myStatus(tripId) {
  const c = tripBalances(tripId).get(me()) || 0;
  if (c > 0) return `<span class="mo-plus">тебе должны ${rub(c)}</span>`;
  if (c < 0) return `<span class="mo-minus">ты должен ${rub(c)}</span>`;
  return `<span class="mo-even">в расчёте</span>`;
}

const noMoneySql = `<div class="empty">«Счёт» ещё не включён. Нужно выполнить файл 17_money.sql в Supabase.</div>`;

// ---------- Все кассы ----------

async function viewMoney() {
  await loadMoney();
  if (!money.ready) { shell("money", noMoneySql); return; }
  shell("money", `
    <div class="head" style="justify-content:space-between">
      <div><h1>Счёт</h1><p class="sub">Общие траты на поездки и сходки — сайт сам посчитает, кто кому сколько должен</p></div>
      <button type="button" class="btn primary" data-mo-new>+ Новая касса</button>
    </div>
    <form class="card mo-new" id="moNew" ${money.newOpen ? "" : "hidden"}>
      <label>Название<input type="text" id="moTitle" maxlength="60" placeholder="Например: Байкал 2024" required></label>
      <label>Кто участвует
        <div class="chips">${state.profiles.map(p => `<button type="button" class="chip" data-mo-member="${p.id}" aria-pressed="true">${avatar(p.id)}${esc(p.name)}</button>`).join("")}</div>
      </label>
      <div class="row"><button type="submit" class="btn primary">Создать</button><button type="button" class="btn" data-mo-new>Отмена</button><p class="msg" id="moNewMsg"></p></div>
    </form>
    ${money.trips.length ? `<div class="mo-list">${money.trips.map(t => `
      <a class="mo-trip card${t.closed ? " closed" : ""}" href="#/money/${t.id}">
        <div class="mo-trip-top"><b>${esc(t.title)}</b>${t.closed ? `<span class="mo-badge">закрыта</span>` : ""}</div>
        <div class="mo-avas">${t.members.slice(0, 8).map(id => avatar(id)).join("")}</div>
        <div class="mo-trip-bottom"><span class="msg">Всего ${rub(tripTotal(t.id))}</span>${myStatus(t.id)}</div>
      </a>`).join("")}</div>`
      : `<div class="empty">Пока ни одной кассы. Едете куда-то вместе? Создай кассу и записывайте, кто за что платил.</div>`}`);

  const form = document.getElementById("moNew");
  form.querySelectorAll("[data-mo-member]").forEach(b => b.onclick = () => b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") !== "true"));
  form.onsubmit = async e => {
    e.preventDefault();
    const msg = document.getElementById("moNewMsg"), btn = form.querySelector('button[type="submit"]');
    const title = document.getElementById("moTitle").value.trim();
    const members = [...form.querySelectorAll('[data-mo-member][aria-pressed="true"]')].map(b => b.dataset.moMember);
    if (!title) { msg.className = "msg err"; msg.textContent = "Придумай название."; return; }
    if (members.length < 2) { msg.className = "msg err"; msg.textContent = "Нужно хотя бы двое участников."; return; }
    if (btn.disabled) return;
    btn.disabled = true;
    const { data, error } = await sb.from("money_trips").insert({ title, members }).select().single();
    btn.disabled = false;
    if (error) { msg.className = "msg err"; msg.textContent = "Не получилось создать. Попробуй ещё раз."; return; }
    money.newOpen = false;
    location.hash = `#/money/${data.id}`;
  };
}

// Одна трата в форме — отдельный блок со своим всем: сколько, за что, кто платил и на кого делим.
// Пример: домик 25 000 ₽ снял Костя — делим на всех; продукты 5 000 ₽ купил Влад — делим на Влада, Костю и Мишу.
// «+» справа от «За что» добавляет новый блок, «✕» у второго и следующих — убирает
function moEntry(trip, n) {
  const people = state.profiles.map(p => p.id);
  return `<div class="mo-entry" data-mo-entry>
    ${n > 1 ? `<div class="mo-entry-head"><b>Трата ${n}</b><button type="button" class="link-btn" data-mo-entry-del aria-label="Убрать эту трату">✕ убрать</button></div>` : ""}
    <div class="mo-add-row">
      <label>Сколько<input type="text" class="mo-amount" inputmode="decimal" placeholder="25000" autocomplete="off"></label>
      <label>За что<input type="text" class="mo-what" maxlength="80" placeholder="${n > 1 ? "Продукты, бензин..." : "Домик, шашлык..."}"></label>
      <button type="button" class="mo-row-btn add" data-mo-entry-add aria-label="Добавить ещё трату" title="Ещё трата (свой плательщик и свои участники)">+</button>
    </div>
    <label>Кто платил
      <div class="chips">${people.map(pid => `<button type="button" class="chip" data-mo-payer="${pid}" aria-pressed="${pid === me()}">${avatar(pid)}${esc(nameOf(pid))}</button>`).join("")}</div>
    </label>
    <label>На кого делим поровну
      <div class="chips">${people.map(pid => `<button type="button" class="chip" data-mo-share="${pid}" aria-pressed="${trip.members.includes(pid)}">${avatar(pid)}${esc(nameOf(pid))}</button>`).join("")}</div>
    </label>
  </div>`;
}

// ---------- Одна касса ----------

async function viewMoneyTrip(id) {
  await loadMoney();
  if (!money.ready) { shell("money", noMoneySql); return; }
  const t = money.trips.find(x => x.id === id);
  if (!t) { shell("money", `<div class="empty">Такой кассы нет. <a href="#/money">Ко всем кассам</a></div>`); return; }
  const items = money.items.filter(x => x.trip_id === id), paid = money.paid.filter(x => x.trip_id === id);
  const bal = tripBalances(id), plan = settleUp(bal), mine = t.created_by === me();
  const people = [...new Set([...t.members, ...items.flatMap(x => [x.payer, ...x.shares])])].filter(profile);
  const myC = bal.get(me()) || 0;

  shell("money", `
    <div class="head" style="justify-content:space-between">
      <div><a href="#/money" class="link-btn">← Все кассы</a><h1>${esc(t.title)}${t.closed ? ` <span class="mo-badge">закрыта</span>` : ""}</h1>
        <p class="sub">Всего потрачено ${rub(tripTotal(id))} · ${people.length} ${plural(people.length, ["участник", "участника", "участников"])}</p></div>
      ${mine ? `<div class="row">
        <button type="button" class="btn" data-mo-close>${t.closed ? "Открыть снова" : "Закрыть кассу"}</button>
        <button type="button" class="btn danger" data-mo-del-trip>Удалить</button></div>` : ""}
    </div>

    <section class="card mo-me ${myC > 0 ? "plus" : myC < 0 ? "minus" : "even"}">
      <span class="msg">${myC > 0 ? "Тебе должны" : myC < 0 ? "Ты должен" : "Ты в расчёте"}</span>
      ${myC ? `<b>${rub(myC)}</b>` : `<b>👌</b>`}
    </section>

    <section>
      <h2>Кто кому переводит</h2>
      ${plan.length ? `<div class="mo-plan">${plan.map(p => `
        <div class="mo-pay${p.from === me() || p.to === me() ? " me" : ""}">
          <span class="mo-who">${avatar(p.from)}<b>${esc(nameOf(p.from))}</b></span>
          <span class="mo-arrow">→ ${rub(p.c)} →</span>
          <span class="mo-who">${avatar(p.to)}<b>${esc(nameOf(p.to))}</b></span>
          ${p.from === me() || p.to === me()
            ? `<button type="button" class="btn mo-done" data-mo-paid="${p.from}|${p.to}|${p.c}" title="Отметить, что деньги переведены">✓ Вернул</button>` : ""}
        </div>`).join("")}</div>`
        : `<div class="empty">${items.length ? "Все в расчёте 🎉" : "Пока нет трат — добавь первую ниже."}</div>`}
    </section>

    ${t.closed ? "" : `<form class="card mo-add" id="moAdd">
      <h2 style="margin:0">+ Трата</h2>
      <div class="mo-entries" id="moEntries">${moEntry(t, 1)}</div>
      <div class="row"><button type="submit" class="btn primary">Добавить</button><p class="msg" id="moAddMsg"></p></div>
    </form>`}

    <section>
      <h2>Траты · ${items.length}</h2>
      ${items.length ? `<div class="mo-items">${items.map(x => `
        <div class="mo-item">
          ${avatar(x.payer)}
          <div class="mo-item-main">
            <b>${esc(x.title || "Без названия")}</b>
            <span class="msg">${esc(nameOf(x.payer))} заплатил · делим на ${x.shares.length}: ${x.shares.map(u => esc(nameOf(u))).join(", ")}</span>
          </div>
          <div class="mo-item-side"><b>${rub(cents(x.amount))}</b>
            ${x.created_by === me() ? `<button type="button" class="link-btn" data-mo-del-item="${x.id}">удалить</button>` : ""}</div>
        </div>`).join("")}</div>` : `<p class="msg">Пока пусто.</p>`}
    </section>

    ${paid.length ? `<section>
      <h2>Уже вернули</h2>
      <div class="mo-items">${paid.map(x => `
        <div class="mo-item">
          ${avatar(x.from_user)}
          <div class="mo-item-main"><b>${esc(nameOf(x.from_user))} → ${esc(nameOf(x.to_user))}</b><span class="msg">${dayText(x.created_at)}</span></div>
          <div class="mo-item-side"><b>${rub(cents(x.amount))}</b>
            ${x.created_by === me() ? `<button type="button" class="link-btn" data-mo-del-paid="${x.id}">отменить</button>` : ""}</div>
        </div>`).join("")}</div>
    </section>` : ""}`);

  const form = document.getElementById("moAdd");
  if (!form) return;
  const entries = form.querySelector("#moEntries");
  // Нумерация блоков «Трата 2», «Трата 3» после удаления одного из середины
  const renumber = () => [...entries.children].forEach((b, i) => { const h = b.querySelector(".mo-entry-head b"); if (h) h.textContent = `Трата ${i + 1}`; });
  entries.onclick = e => {
    const entry = e.target.closest("[data-mo-entry]"); if (!entry) return;
    // Кто платил — один в каждой трате, на кого делим — сколько угодно
    const payerBtn = e.target.closest("[data-mo-payer]");
    if (payerBtn) return entry.querySelectorAll("[data-mo-payer]").forEach(x => x.setAttribute("aria-pressed", x === payerBtn));
    const shareBtn = e.target.closest("[data-mo-share]");
    if (shareBtn) return shareBtn.setAttribute("aria-pressed", shareBtn.getAttribute("aria-pressed") !== "true");
    if (e.target.closest("[data-mo-entry-add]")) {
      if (entries.children.length >= 10) return;
      entries.insertAdjacentHTML("beforeend", moEntry(t, entries.children.length + 1));
      const fresh = entries.lastElementChild;
      fresh.scrollIntoView({ behavior: "smooth", block: "center" });
      fresh.querySelector(".mo-amount").focus({ preventScroll: true });
      return;
    }
    if (e.target.closest("[data-mo-entry-del]")) { entry.remove(); renumber(); }
  };
  form.onsubmit = async e => {
    e.preventDefault();
    const msg = document.getElementById("moAddMsg"), btn = form.querySelector('button[type="submit"]');
    const fail = t => { msg.className = "msg err"; msg.textContent = t; };
    // Каждый блок — своя трата со своим плательщиком и своими участниками. Пустые блоки пропускаем
    const rows = [...form.querySelectorAll("[data-mo-entry]")].map((b, i) => ({
      n: i + 1,
      raw: b.querySelector(".mo-amount").value.replace(/\s/g, "").replace(",", "."),
      title: b.querySelector(".mo-what").value.trim(),
      payer: b.querySelector('[data-mo-payer][aria-pressed="true"]')?.dataset.moPayer,
      shares: [...b.querySelectorAll('[data-mo-share][aria-pressed="true"]')].map(x => x.dataset.moShare)
    })).filter(r => r.raw || r.title);
    if (!rows.length) return fail("Напиши сумму, например 1500 или 349,90.");
    for (const r of rows) {
      const name = r.title ? `«${r.title}»` : `трате ${r.n}`;
      r.amount = Math.round(parseFloat(r.raw) * 100) / 100;
      if (!(r.amount > 0) || r.amount >= 1e7) return fail(`Сумма в ${name} должна быть числом, например 1500 или 349,90.`);
      if (!r.payer) return fail(`Выбери, кто платил в ${name}.`);
      if (!r.shares.length) return fail(`Выбери, на кого делим ${name}.`);
    }
    if (btn.disabled) return;
    btn.disabled = true;
    const { error } = await sb.from("money_items").insert(rows.map(r => ({ trip_id: id, payer: r.payer, amount: r.amount, title: r.title || null, shares: r.shares })));
    btn.disabled = false;
    if (error) return fail("Не сохранилось. Попробуй ещё раз.");
    const sum = rows.reduce((s, r) => s + cents(r.amount), 0);
    toast(rows.length > 1 ? `Записал ${rows.length} ${plural(rows.length, ["трату", "траты", "трат"])} на ${rub(sum)}` : `Записал: ${rub(sum)}`);
    viewMoneyTrip(id);
  };
}

// ---------- Нажатия ----------

document.addEventListener("click", async e => {
  if (e.target.closest("[data-mo-new]")) {
    money.newOpen = !money.newOpen;
    const f = document.getElementById("moNew");
    if (f) { f.hidden = !money.newOpen; if (money.newOpen) document.getElementById("moTitle")?.focus(); }
    return;
  }
  const tripId = (location.hash.match(/^#\/money\/(.+)$/) || [])[1];
  // «Вернул»: записываем перевод — долг у обоих сразу пересчитывается
  const pd = e.target.closest("[data-mo-paid]");
  if (pd && tripId) {
    const [from_user, to_user, c] = pd.dataset.moPaid.split("|");
    if (pd.textContent.trim() !== "Точно?") { pd.textContent = "Точно?"; return; }
    pd.disabled = true;
    const { error } = await sb.from("money_paid").insert({ trip_id: tripId, from_user, to_user, amount: Number(c) / 100 });
    if (error) { toast("Не получилось отметить"); pd.disabled = false; return; }
    toast("Отмечено: долг закрыт 🤝");
    return viewMoneyTrip(tripId);
  }
  // Удаление — в два нажатия, чтобы не стереть случайно
  const twice = (b, label) => { if (b.textContent.trim() !== label) { b.textContent = label; return false; } b.disabled = true; return true; };
  const di = e.target.closest("[data-mo-del-item]");
  if (di && twice(di, "точно?")) {
    await sb.from("money_items").delete().eq("id", di.dataset.moDelItem);
    return viewMoneyTrip(tripId);
  }
  const dp = e.target.closest("[data-mo-del-paid]");
  if (dp && twice(dp, "точно?")) {
    await sb.from("money_paid").delete().eq("id", dp.dataset.moDelPaid);
    return viewMoneyTrip(tripId);
  }
  if (e.target.closest("[data-mo-close]") && tripId) {
    const t = money.trips.find(x => x.id === tripId); if (!t) return;
    await sb.from("money_trips").update({ closed: !t.closed }).eq("id", tripId);
    return viewMoneyTrip(tripId);
  }
  const dt = e.target.closest("[data-mo-del-trip]");
  if (dt && tripId && twice(dt, "Удалить вместе со всеми тратами?")) {
    const { error } = await sb.from("money_trips").delete().eq("id", tripId);
    if (error) { toast("Не получилось удалить"); dt.disabled = false; return; }
    location.hash = "#/money";
  }
});
