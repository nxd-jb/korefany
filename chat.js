// Корефаны: мессенджер. Общий чат, личка, группы, фото, ответы и реакции.
// Пользуется общими вещами из app.js: sb, state, shell, avatar, esc, toast и т.д.
// Страницы: #/chats список чатов, #/chat/<id> переписка.

const CHAT_BUCKET = "chat";
const chat = {
  ready: true,       // false, если таблицы мессенджера ещё не созданы
  list: [],          // чаты, которые я вижу
  members: {},       // chat_id -> [user_id]
  reads: {},         // chat_id -> когда я последний раз читал
  last: {},          // chat_id -> последнее сообщение
  unread: {},        // chat_id -> сколько непрочитанных
  open: null,        // id открытого чата
  messages: [],      // сообщения открытого чата, старые сверху
  reacts: [],        // реакции на них
  urls: {},          // временные ссылки на фото из чатов
  replyTo: null,     // на какое сообщение отвечаем
  panel: null,       // какая панель открыта в списке: "dm" или "group"
  lastPoll: null,
  seen: new Set(),   // id сообщений, которые уже учли
  otherReads: {},    // открытый чат: user_id -> докуда прочитал (для галочек)
  firstUnread: null, // открытый чат: id первого непрочитанного (полоска «Новые сообщения»)
  newBelow: 0,       // сколько новых пришло, пока листаешь историю (счётчик на кнопке «вниз»)
  online: new Set(), // кто сейчас на сайте
  votes: []          // голоса в опросах открытого чата: { message_id, user_id, option }
};

// ---------- Звук нового сообщения ----------
// Файл sounds/message.mp3. Играет, когда пишет кто-то другой; выключается в профиле.

const msgSound = new Audio("sounds/message.mp3");
msgSound.preload = "auto";
let lastSoundAt = 0;

function soundOn() { try { return localStorage.getItem("korefany-sound") !== "off"; } catch (e) { return true; } }
function setSoundOn(on) { try { localStorage.setItem("korefany-sound", on ? "on" : "off"); } catch (e) {} }

// Громкость 0…1, по умолчанию 40%. Своя на каждом устройстве.
// iPhone не даёт менять громкость у самого <audio>, поэтому звук идёт через Web Audio с регулятором (GainNode)
let audioCtx = null, gainNode = null;
function soundVolume() {
  try { const v = parseFloat(localStorage.getItem("korefany-volume")); return isNaN(v) ? 0.4 : v; } catch (e) { return 0.4; }
}
function setSoundVolume(v) {
  try { localStorage.setItem("korefany-volume", String(v)); } catch (e) {}
  applyVolume();
}
function applyVolume() {
  const v = soundVolume();
  if (gainNode) { msgSound.volume = 1; gainNode.gain.value = v; }
  else msgSound.volume = Math.min(1, v);
}
function setupAudio() {
  if (audioCtx) return;
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  try {
    audioCtx = new AC();
    gainNode = audioCtx.createGain();
    audioCtx.createMediaElementSource(msgSound).connect(gainNode).connect(audioCtx.destination);
  } catch (e) { audioCtx = null; gainNode = null; }
  applyVolume();
}
applyVolume();

function playMessageSound(force = false) {
  if (!force && !soundOn()) return;
  const now = Date.now();
  if (!force && now - lastSoundAt < 1500) return;   // пачка сообщений — один звук, а не трещотка
  lastSoundAt = now;
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  msgSound.currentTime = 0;
  msgSound.play().catch(() => {});
}

// iPhone и браузеры разрешают звук только после первого нажатия на странице.
// Поэтому при первом касании тихо «будим» звук, чтобы потом он играл сам.
function unlockSound() {
  setupAudio();
  audioCtx?.resume?.();
  msgSound.muted = true;
  msgSound.play().then(() => { msgSound.pause(); msgSound.currentTime = 0; msgSound.muted = false; })
    .catch(() => { msgSound.muted = false; });
}
document.addEventListener("pointerdown", unlockSound, { once: true });
document.addEventListener("keydown", unlockSound, { once: true });

const CLIP_ICON = `<svg viewBox="0 0 24 24"><path d="M20 11.5l-8.3 8.3a5 5 0 0 1-7-7l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.4 8.4a1.7 1.7 0 0 1-2.4-2.4l7.7-7.7"/></svg>`;
const MIC_ICON = `<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>`;
const ATTACH_ICON = `<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="12" cy="12" r="3.5"/><path d="M8 5l1.5-2h5L16 5"/></svg>`;
const timeText = iso => { const d = new Date(iso); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`; };

// ---------- Данные ----------

async function loadChats() {
  const [c, mem, rd, msg] = await Promise.all([
    sb.from("chats").select("*"),
    sb.from("chat_members").select("*"),
    sb.from("chat_reads").select("*").eq("user_id", me()),
    sb.from("messages").select("id, chat_id, author, text, image_path, audio_path, poll, created_at").order("created_at", { ascending: false }).limit(500)
  ]);
  if (c.error) { chat.ready = false; return; }
  chat.ready = true;
  chat.list = c.data;
  chat.members = {};
  (mem.data || []).forEach(m => (chat.members[m.chat_id] = chat.members[m.chat_id] || []).push(m.user_id));
  chat.reads = {};
  (rd.data || []).forEach(r => { chat.reads[r.chat_id] = r.last_read_at; });
  chat.last = {}; chat.unread = {};
  (msg.data || []).forEach(m => {
    chat.seen.add(m.id);
    if (!chat.last[m.chat_id]) chat.last[m.chat_id] = m;
    if (m.author !== me() && (!chat.reads[m.chat_id] || m.created_at > chat.reads[m.chat_id]))
      chat.unread[m.chat_id] = (chat.unread[m.chat_id] || 0) + 1;
  });
  // Время самого свежего сообщения по часам сервера: с него проверяем новое в запасном режиме
  chat.lastPoll = msg.data?.[0]?.created_at || "1970-01-01T00:00:00Z";
  paintChatBadge();
}

async function chatSigned(paths) {
  const now = Date.now();
  const need = [...new Set(paths.filter(Boolean))].filter(p => !chat.urls[p] || chat.urls[p].until < now);
  // Порциями по 100, как и в ленте: в переписке бывает 200 сообщений с фото и голосовыми
  for (let i = 0; i < need.length; i += 100) {
    const { data } = await sb.storage.from(CHAT_BUCKET).createSignedUrls(need.slice(i, i + 100), 3600);
    (data || []).forEach(r => { if (r.signedUrl) chat.urls[r.path] = { url: r.signedUrl, until: now + 50 * 60 * 1000 }; });
  }
}
const chatUrl = p => chat.urls[p]?.url || "";

async function markRead(chatId) {
  chat.reads[chatId] = new Date().toISOString();
  chat.unread[chatId] = 0;
  paintChatBadge();
  if (typeof refreshChatSide === "function") refreshChatSide();
  await sb.from("chat_reads").upsert({ chat_id: chatId, user_id: me(), last_read_at: chat.reads[chatId] });
}

// Счётчик непрочитанных на пункте «Чаты» в меню
function paintChatBadge() {
  const total = Object.values(chat.unread).reduce((a, b) => a + b, 0);
  document.querySelectorAll("[data-chat-badge]").forEach(b => {
    b.textContent = total > 99 ? "99+" : total || "";
    b.hidden = !total;
  });
}

// ---------- Как показывать чат ----------

const otherIn = c => (chat.members[c.id] || []).find(u => u !== me());
function chatTitle(c) {
  if (c.kind === "general") return "Общий чат";
  if (c.kind === "group") return c.title || "Группа";
  return nameOf(otherIn(c));
}
function chatAvatar(c) {
  if (c.kind === "general") return `<span class="ava chat-ava general">К</span>`;
  if (c.kind === "direct") return avatar(otherIn(c));
  const t = (c.title || "Г").trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
  return `<span class="ava chat-ava group">${esc(t)}</span>`;
}
function chatSubtitle(c) {
  if (c.kind === "general") return `${state.profiles.length} ${plural(state.profiles.length, ["корефан", "корефана", "корефанов"])}`;
  if (c.kind === "direct") return profile(otherIn(c))?.status || "личная переписка";
  const ids = chat.members[c.id] || [];
  return ids.map(nameOf).join(", ");
}
// Короткая подпись сообщения для списка чатов, ответов, уведомлений и поиска
function msgSummary(m) {
  if (!m) return "";
  if (m.text) return m.text;
  if (m.image_path) return "📷 Фото";
  if (m.audio_path) return "🎤 Голосовое";
  if (m.poll) return "📊 " + (m.poll.question || "Опрос");
  return "";
}

function preview(m) {
  if (!m) return "Сообщений пока нет";
  const who = m.author === me() ? "Ты" : nameOf(m.author);
  return `${who}: ${msgSummary(m)}`;
}
function shortTime(iso) {
  const d = new Date(iso), now = new Date();
  if (d.toDateString() === now.toDateString()) return timeText(iso);
  return `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ---------- Список чатов ----------

// Левая колонка: заголовок, кнопки «Написать» и «+ Группа», панели и список чатов.
// На компьютере она стоит слева и в списке, и в переписке; на телефоне — отдельным экраном
function chatListHtml(activeId) {
  const sorted = [...chat.list].sort((a, b) => {
    if (a.kind === "general") return -1;
    if (b.kind === "general") return 1;
    return ((chat.last[b.id] || b).created_at).localeCompare((chat.last[a.id] || a).created_at);
  });
  const others = state.profiles.filter(p => p.id !== me());
  const pick = (attr) => others.map(p => `<button type="button" class="chip" ${attr}="${p.id}" aria-pressed="false">${avatar(p.id)}${esc(p.name)}</button>`).join("");
  return `
    <div class="cs-head">
      <h1>Чаты</h1>
      <div class="row">
        <button type="button" class="btn icon-btn" data-panel="dm" title="Написать" aria-label="Написать">✎</button>
        <button type="button" class="btn primary icon-btn" data-panel="group" title="Новая группа" aria-label="Новая группа">+</button>
      </div>
    </div>
    ${chat.panel === "dm" ? `<div class="chat-panel"><p class="label-sm">Кому написать?</p><div class="chips">${
      others.map(p => `<button type="button" class="chip" data-dm="${p.id}">${avatar(p.id)}${esc(p.name)}</button>`).join("")}</div></div>` : ""}
    ${chat.panel === "group" ? `<form class="chat-panel" id="groupForm">
      <label>Название группы<input type="text" id="gTitle" maxlength="60" required placeholder="Например: Поездка на Байкал"></label>
      <label>Кто в группе<div class="chips">${pick("data-gm")}</div></label>
      <div class="row"><button type="submit" class="btn primary">Создать</button><p class="msg" id="gMsg"></p></div>
    </form>` : ""}
    <div class="chat-list">${sorted.map((c, i) => {
      const n = chat.unread[c.id] || 0, last = chat.last[c.id];
      const who = c.kind === "direct" ? otherIn(c) : null;
      return `<a class="chat-row${n ? " unread" : ""}${c.id === activeId ? " active" : ""}" href="#/chat/${c.id}" style="--i:${Math.min(i, 20)}">
        <span class="ava-wrap${who && chat.online.has(who) ? " is-online" : ""}" ${who ? `data-online-user="${who}"` : ""}>${chatAvatar(c)}</span>
        <div class="cr-main"><b>${esc(chatTitle(c))}</b><span>${esc(preview(last))}</span></div>
        <div class="cr-side">${last ? `<time>${shortTime(last.created_at)}</time>` : ""}${n ? `<i class="cr-badge">${n > 99 ? "99+" : n}</i>` : ""}</div>
      </a>`;
    }).join("")}</div>`;
}

async function viewChats() {
  if (!chat.ready) { shell("chats", `<div class="empty">Мессенджер ещё не включён. Нужно выполнить файл 07_messenger.sql в Supabase.</div>`); return; }
  document.body.classList.add("chats-page");
  shell("chats", `<div class="chat-layout">
    <aside class="chat-side">${chatListHtml(null)}</aside>
    <section class="chat-main pick-main"><div class="pick"><span>💬</span><p>Выбери чат слева</p></div></section>
  </div>`);
  wireGroupForm();
}

function wireGroupForm() {
  const gf = document.getElementById("groupForm");
  if (gf) {
    gf.querySelectorAll("[data-gm]").forEach(b => b.onclick = () => b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") !== "true"));
    gf.onsubmit = async e => {
      e.preventDefault();
      const members = [...gf.querySelectorAll('[data-gm][aria-pressed="true"]')].map(b => b.dataset.gm);
      const msg = document.getElementById("gMsg");
      if (!members.length) { msg.className = "msg err"; msg.textContent = "Выбери хотя бы одного корефана."; return; }
      const { data, error } = await sb.rpc("create_group", { title: document.getElementById("gTitle").value.trim(), members });
      if (error) { msg.className = "msg err"; msg.textContent = "Не получилось создать группу."; return; }
      chat.panel = null;
      await loadChats();
      location.hash = `#/chat/${data}`;
    };
  }
}

async function openDirect(userId) {
  const { data, error } = await sb.rpc("open_direct", { other: userId });
  if (error) { toast("Не получилось открыть личку"); return; }
  chat.panel = null;
  if (!chat.list.some(c => c.id === data)) await loadChats();
  location.hash = `#/chat/${data}`;
}

// ---------- Переписка ----------

async function viewChat(id) {
  let c = chat.list.find(x => x.id === id);
  if (!c) { await loadChats(); c = chat.list.find(x => x.id === id); }
  if (!c) { shell("chats", `<div class="empty">Такого чата нет или ты в нём не состоишь. <a href="#/chats">Ко всем чатам</a></div>`); return; }
  chat.open = id; chat.replyTo = null; chat.newBelow = 0;
  document.body.classList.add("in-chat", "chats-page");

  const [m, rd] = await Promise.all([
    sb.from("messages").select("*").eq("chat_id", id).order("created_at", { ascending: false }).limit(200),
    sb.from("chat_reads").select("*").eq("chat_id", id)
  ]);
  chat.messages = (m.data || []).reverse();
  // Докуда прочитали остальные — для галочек ✓✓ на моих сообщениях
  chat.otherReads = {};
  (rd.data || []).forEach(r => { if (r.user_id !== me()) chat.otherReads[r.user_id] = r.last_read_at; });
  const ids = chat.messages.map(x => x.id);
  const pollIds = chat.messages.filter(x => x.poll).map(x => x.id);
  const [r, v] = await Promise.all([
    ids.length ? sb.from("message_reactions").select("*").in("message_id", ids) : { data: [] },
    pollIds.length ? sb.from("poll_votes").select("*").in("message_id", pollIds) : { data: [] }
  ]);
  chat.reacts = r.data || [];
  chat.votes = v.data || [];
  await chatSigned(chat.messages.flatMap(x => [x.image_path, x.audio_path]));

  // Первое непрочитанное чужое сообщение — над ним будет полоска «Новые сообщения»
  const lastRead = chat.reads[id];
  chat.firstUnread = lastRead ? chat.messages.find(x => x.author !== me() && x.created_at > lastRead)?.id : null;

  shell("chats", `<div class="chat-layout">
    <aside class="chat-side">${chatListHtml(id)}</aside>
    <section class="chat-main">
      <header class="chat-head">
        <a href="#/chats" class="btn back" aria-label="Ко всем чатам">←</a>
        ${c.kind === "direct" ? `<a href="#/p/${otherIn(c)}" class="ch-who">` : `<div class="ch-who">`}
          <span class="ava-wrap" ${c.kind === "direct" ? `data-online-user="${otherIn(c)}"` : ""}>${chatAvatar(c)}</span>
          <div><b>${esc(chatTitle(c))}</b><span id="chSub">${esc(chatSubtitle(c))}</span></div>
        ${c.kind === "direct" ? `</a>` : `</div>`}
        <button type="button" class="btn icon-btn" data-csearch aria-label="Поиск по переписке" title="Поиск">🔍</button>
        ${c.kind === "group" ? `<button type="button" class="btn" data-addppl>+ Люди</button>` : ""}
      </header>
      <div class="add-ppl" id="addPpl" hidden></div>
      <div class="c-search" id="cSearch" hidden></div>
      <div class="pin-bar" id="pinBar" hidden></div>
      <div class="msgs" id="msgs"><div class="msgs-in" id="msgsIn">${renderMessages(c)}</div></div>
      <button type="button" class="to-bottom" id="toBottom" aria-label="Вниз" hidden>
        <svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg><i class="tb-count" hidden></i>
      </button>
      <form class="composer" id="composer">
        <div class="reply-bar" id="replyBar" hidden></div>
        <div class="poll-form" id="pollForm" hidden></div>
        <div class="rec-bar" id="recBar" hidden><i class="rec-dot"></i><b id="recTime">0:00</b><span class="rec-hint">← свайп влево — отмена</span></div>
        <div class="comp-row">
          <div class="attach-wrap">
            <button type="button" class="attach" id="attach" aria-label="Прикрепить">${CLIP_ICON}</button>
            <div class="attach-menu" id="attachMenu" hidden>
              <button type="button" data-attach="photo">📷 Фото</button>
              <button type="button" data-attach="poll">📊 Опрос</button>
            </div>
          </div>
          <input type="file" id="chatFile" accept="image/*,.heic,.heif" hidden>
          <div class="pill"><textarea rows="1" maxlength="2000" placeholder="Сообщение..." aria-label="Сообщение"></textarea></div>
          <button type="submit" class="c-send mic-mode" id="sendBtn" aria-label="Голосовое: зажми и говори">${MIC_ICON}</button>
        </div>
      </form>
    </section>
  </div>`);

  wireGroupForm();
  const box = document.getElementById("msgs");
  // Открыли чат — сразу в самый низ, к последнему сообщению
  box.scrollTop = box.scrollHeight;
  wireComposer(c);
  wireChatScroll();
  stickToBottom(box);
  paintPin(c);
  wireSwipeReply();
  paintTicks();
  paintPresence();
  markRead(id);
}

function chatLeave() {
  // Ушли из чата во время записи голосового — запись выбрасываем и выключаем микрофон
  if (rec) stopRecording(false);
  chat.open = null; chat.replyTo = null;
  document.body.classList.remove("in-chat", "chats-page");
}

function dateLabel(iso) {
  const d = new Date(iso), now = new Date();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return "Сегодня";
  if (d.toDateString() === y.toDateString()) return "Вчера";
  return dayText(iso);
}

function renderMessages(c) {
  if (!chat.messages.length) return `<p class="msgs-empty">Здесь пока тихо. Напиши первым 👋</p>`;
  return chat.messages.map((m, i) => msgHtml(m, chat.messages[i - 1], c, false, chat.messages[i + 1])).join("");
}

const linkify = s => s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');

// Сообщения подряд от одного человека в пределах 5 минут склеиваются в один блок
const sameRunAs = (a, b) => a && b && a.author === b.author &&
  new Date(a.created_at).toDateString() === new Date(b.created_at).toDateString() &&
  Math.abs(new Date(b.created_at) - new Date(a.created_at)) < 5 * 60 * 1000;

// Только эмодзи (до трёх) — показываем крупно, без пузыря
function isJumbo(text) {
  const t = (text || "").trim(); if (!t || t.length > 24) return false;
  const parts = typeof Intl.Segmenter === "function"
    ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(t)].map(s => s.segment).filter(s => s.trim())
    : Array.from(t.replace(/\s/g, ""));
  return parts.length <= 3 && parts.every(p => /\p{Extended_Pictographic}/u.test(p));
}

// next: следующее сообщение. Если оно из того же блока, у этого нет «хвостика» и аватарки
function msgHtml(m, prev, c, isNew = false, next = null) {
  const mine = m.author === me();
  const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
  const sameRun = sameRunAs(prev, m);
  const tail = !sameRunAs(m, next);
  const showWho = !mine && c.kind !== "direct";
  const head = showWho && !sameRun;
  const jumbo = !m.image_path && !m.reply_to && !m.audio_path && !m.poll && isJumbo(m.text);
  const meta = `<time>${timeText(m.created_at)}</time>${mine ? `<i class="tick" data-tick="${m.id}">✓</i>` : ""}`;
  const orig = m.reply_to ? chat.messages.find(x => x.id === m.reply_to) : null;
  return `${newDay ? `<div class="day-sep"><span>${dateLabel(m.created_at)}</span></div>` : ""}
  ${m.id === chat.firstUnread ? `<div class="new-sep" id="newSep"><span>Новые сообщения</span></div>` : ""}
  <div class="msg${mine ? " mine" : ""}${sameRun ? " run" : ""}${tail ? " tail" : ""}${jumbo ? " jumbo" : ""}${isNew ? " new" : ""}" data-mid="${m.id}" style="${ucStyle(m.author)}">
    ${showWho ? `<a href="#/p/${m.author}" class="m-ava">${avatar(m.author)}</a>` : ""}
    <div class="m-body">
      ${head ? `<span class="m-name">${esc(nameOf(m.author))}</span>` : ""}
      <div class="bubble" data-bubble>
        ${m.reply_to ? `<button type="button" class="m-reply" data-jump="${m.reply_to}">
          <b>${orig ? esc(nameOf(orig.author)) : "Сообщение"}</b><span>${orig ? esc(msgSummary(orig)) : "удалено"}</span></button>` : ""}
        ${m.image_path ? `<img class="m-img" src="${chatUrl(m.image_path)}" data-zoom="${esc(m.image_path)}" alt="Фото" loading="lazy">` : ""}
        ${m.audio_path ? voiceHtml(m) : ""}
        ${Array.isArray(m.poll?.options) ? `<div class="poll" data-poll="${m.id}">${pollInner(m)}</div>` : ""}
        ${m.text ? `<p class="m-text">${jumbo ? esc(m.text) : linkify(esc(m.text))}<span class="m-meta">${meta}</span></p>`
          : m.image_path && !m.audio_path && !m.poll ? `<span class="m-meta on-img">${meta}</span>`
          : `<span class="m-meta m-meta-block">${meta}</span>`}
      </div>
      <div class="m-reacts" data-mreacts="${m.id}">${msgReactsHtml(m.id)}</div>
      <div class="m-actions">
        ${Object.entries(EMOJI).map(([k, e]) => `<button type="button" data-mact="react" data-emoji="${k}" aria-label="Реакция">${e}</button>`).join("")}
        <button type="button" data-mact="reply">Ответить</button>
        <button type="button" data-mact="pin" title="Закрепить вверху чата">📌</button>
        ${mine ? `<button type="button" data-mact="del" class="danger">Удалить</button>` : ""}
      </div>
    </div>
  </div>`;
}

function msgReactsHtml(id) {
  const rs = chat.reacts.filter(r => r.message_id === id);
  return Object.entries(EMOJI).map(([k, e]) => {
    const n = rs.filter(r => r.emoji === k).length; if (!n) return "";
    const mine = rs.some(r => r.emoji === k && r.user_id === me());
    return `<button type="button" class="m-react" data-mreact="${id}" data-emoji="${k}" aria-pressed="${mine}">${e} ${n}</button>`;
  }).join("");
}
function paintMsgReacts(id) {
  const el = document.querySelector(`[data-mreacts="${id}"]`);
  if (!el) return;
  el.innerHTML = msgReactsHtml(id);
  el.querySelectorAll(".m-react").forEach(b => { b.classList.add("pop"); });
}

// ---------- Отправка ----------

function wireComposer(c) {
  const form = document.getElementById("composer");
  const ta = form.querySelector("textarea"), send = document.getElementById("sendBtn");
  const file = document.getElementById("chatFile"), menu = document.getElementById("attachMenu");
  // Пустое поле — кнопка становится микрофоном (как в Telegram), есть текст — снова «отправить»
  const refresh = () => {
    autoGrow(ta);
    const has = !!ta.value.trim();
    send.classList.toggle("mic-mode", !has);
    send.innerHTML = has ? SEND_ICON : MIC_ICON;
    send.setAttribute("aria-label", has ? "Отправить" : "Голосовое: зажми и говори");
    if (has) sendTyping(c.id);
  };
  ta.oninput = refresh;
  ta.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey && !matchMedia("(pointer: coarse)").matches) { e.preventDefault(); submit(); } };
  form.onsubmit = e => { e.preventDefault(); if (!send.classList.contains("mic-mode")) submit(); };

  // Скрепка: фото или опрос
  document.getElementById("attach").onclick = e => { e.stopPropagation(); menu.hidden = !menu.hidden; };
  menu.querySelector('[data-attach="photo"]').onclick = () => { menu.hidden = true; file.click(); };
  menu.querySelector('[data-attach="poll"]').onclick = () => { menu.hidden = true; openPollForm(c); };
  file.onchange = async () => { const f = file.files[0]; file.value = ""; if (f) await sendMessage(c, { file: f }); };

  wireVoice(c, send);

  const submit = async () => {
    const text = ta.value.trim(); if (!text) return;
    ta.value = ""; refresh();
    await sendMessage(c, { text });
    ta.focus();
  };
}

// ---------- Голосовые: зажал микрофон — пишешь, отпустил — отправилось, свайп влево — отмена ----------

// Меню скрепки закрывается нажатием в любом другом месте
document.addEventListener("click", e => { if (!e.target.closest(".attach-wrap")) document.getElementById("attachMenu")?.setAttribute("hidden", ""); });

let rec = null;
function wireVoice(c, btn) {
  let pressing = false, sx = 0;
  btn.addEventListener("contextmenu", e => { if (btn.classList.contains("mic-mode")) e.preventDefault(); });
  btn.addEventListener("pointerdown", async e => {
    if (!btn.classList.contains("mic-mode")) return;
    e.preventDefault();
    pressing = true; sx = e.clientX;
    try { btn.setPointerCapture(e.pointerId); } catch (err) {}
    await startRecording(c, () => pressing);
  });
  btn.addEventListener("pointermove", e => {
    if (rec && e.clientX < sx - 80) { stopRecording(false); navigator.vibrate?.(20); toast("Голосовое отменено"); }
  });
  const up = () => { if (!pressing) return; pressing = false; if (rec) stopRecording(true); };
  btn.addEventListener("pointerup", up);
  btn.addEventListener("pointercancel", up);
}

async function startRecording(c, stillPressed) {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast("Этот браузер не умеет записывать голос"); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { toast("Нет доступа к микрофону — разреши его в настройках браузера"); return; }
  // Пока браузер спрашивал разрешение, кнопку уже отпустили — тогда в следующий раз просто зажми снова
  if (!stillPressed()) { stream.getTracks().forEach(t => t.stop()); toast("Микрофон разрешён. Теперь зажми кнопку и говори"); return; }
  const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/aac"].find(t => MediaRecorder.isTypeSupported?.(t)) || "";
  const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  rec = { c, mr, stream, chunks, start: Date.now(), mime: mr.mimeType || mime || "audio/webm" };
  mr.start(250);
  navigator.vibrate?.(15);
  // Полоска записи: красная точка и таймер. Больше 2 минут не пишем
  const bar = document.getElementById("recBar"), time = document.getElementById("recTime");
  document.getElementById("composer").classList.add("recording");
  bar.hidden = false;
  rec.timer = setInterval(() => {
    const s = Math.floor((Date.now() - rec.start) / 1000);
    time.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    if (s >= 120) stopRecording(true);
  }, 200);
}

function stopRecording(send) {
  if (!rec) return;
  const r = rec; rec = null;
  clearInterval(r.timer);
  document.getElementById("recBar")?.setAttribute("hidden", "");
  document.getElementById("recTime") && (document.getElementById("recTime").textContent = "0:00");
  document.getElementById("composer")?.classList.remove("recording");
  r.mr.onstop = async () => {
    r.stream.getTracks().forEach(t => t.stop());
    const dur = (Date.now() - r.start) / 1000;
    if (!send) return;
    if (dur < 0.8) { toast("Слишком коротко. Зажми и говори"); return; }
    await sendMessage(r.c, { audio: new Blob(r.chunks, { type: r.mime }), duration: Math.round(dur * 10) / 10 });
  };
  r.mr.stop();
}

// Плеер голосового: кнопка ▶, «волна» из полосок (своя у каждого сообщения) и время
// Значки ▶ и ❚❚ рисуем сами: iPhone показывает символ ▶ как синий эмодзи-квадрат, и он ещё и съезжал.
// Какой из двух виден, решает класс .playing (style.css)
const VOICE_ICONS = `<svg class="i-play" viewBox="0 0 24 24"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>` +
  `<svg class="i-pause" viewBox="0 0 24 24"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>`;
const voicePlayer = new Audio();
let voicePlaying = null;
function voiceHtml(m) {
  let h = 0; for (const ch of m.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const bars = Array.from({ length: 30 }, (_, i) => { h = (h * 1103515245 + 12345) >>> 0; return 25 + (h % 75); });
  const d = Math.round(m.audio_duration || 0);
  return `<div class="voice" data-voice="${m.id}" style="--p:0%">
    <button type="button" class="v-play" data-vplay="${m.id}" aria-label="Слушать">${VOICE_ICONS}</button>
    <div class="v-wave" data-vseek="${m.id}">${bars.map(b => `<i style="height:${b}%"></i>`).join("")}</div>
    <span class="v-time">${Math.floor(d / 60)}:${String(d % 60).padStart(2, "0")}</span>
  </div>`;
}
async function toggleVoice(id, seekFrac = null) {
  const m = chat.messages.find(x => x.id === id); if (!m) return;
  const el = document.querySelector(`[data-voice="${id}"]`);
  if (voicePlaying !== id) {
    await chatSigned([m.audio_path]);   // ссылка живёт час: если чат открыт давно, берём свежую
    document.querySelectorAll(".voice.playing").forEach(v => { v.classList.remove("playing"); v.querySelectorAll(".v-wave i.on").forEach(b => b.classList.remove("on")); });
    voicePlayer.src = chatUrl(m.audio_path);
    voicePlaying = id;
  }
  if (seekFrac !== null && voiceLength()) voicePlayer.currentTime = voiceLength() * seekFrac;
  if (voicePlayer.paused || seekFrac !== null) {
    if (audioCtx?.state === "suspended") audioCtx.resume();
    voicePlayer.play().catch(() => toast("Не получилось воспроизвести"));
    el?.classList.add("playing");
  } else {
    voicePlayer.pause();
    el?.classList.remove("playing");
  }
}
// Голосовые, записанные в Chrome (webm), браузер считает бесконечными: длину тогда берём из базы
function voiceLength() {
  if (isFinite(voicePlayer.duration) && voicePlayer.duration > 0) return voicePlayer.duration;
  return chat.messages.find(x => x.id === voicePlaying)?.audio_duration || 0;
}
voicePlayer.addEventListener("timeupdate", () => {
  const el = voicePlaying && document.querySelector(`[data-voice="${voicePlaying}"]`), len = voiceLength(); if (!el || !len) return;
  const bars = el.querySelectorAll(".v-wave i"), lit = Math.round(Math.min(1, voicePlayer.currentTime / len) * bars.length);
  bars.forEach((b, i) => b.classList.toggle("on", i < lit));
  const left = Math.max(0, Math.ceil(len - voicePlayer.currentTime));
  el.querySelector(".v-time").textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
});
voicePlayer.addEventListener("ended", () => {
  const el = voicePlaying && document.querySelector(`[data-voice="${voicePlaying}"]`);
  const m = chat.messages.find(x => x.id === voicePlaying);
  if (el) { el.classList.remove("playing"); el.querySelectorAll(".v-wave i.on").forEach(b => b.classList.remove("on"));
    const d = Math.round(m?.audio_duration || 0); el.querySelector(".v-time").textContent = `${Math.floor(d / 60)}:${String(d % 60).padStart(2, "0")}`; }
  voicePlaying = null;
});

// ---------- Опросы ----------

function openPollForm(c) {
  const box = document.getElementById("pollForm"); if (!box) return;
  box.innerHTML = `
    <div class="pf-head"><b>📊 Новый опрос</b><button type="button" class="link-btn" data-pf-cancel aria-label="Отменить">✕</button></div>
    <input type="text" id="pfQ" maxlength="140" placeholder="Вопрос, например: куда идём в субботу?">
    <div class="pf-opts" id="pfOpts">
      <input type="text" class="pf-opt" maxlength="60" placeholder="Вариант 1">
      <input type="text" class="pf-opt" maxlength="60" placeholder="Вариант 2">
    </div>
    <div class="row">
      <button type="button" class="btn" data-pf-add>+ Вариант</button>
      <button type="button" class="btn primary" data-pf-send>Отправить опрос</button>
      <span class="msg err" id="pfMsg"></span>
    </div>`;
  box.hidden = false;
  document.getElementById("pfQ").focus();
  box.querySelector("[data-pf-cancel]").onclick = () => { box.hidden = true; box.innerHTML = ""; };
  box.querySelector("[data-pf-add]").onclick = () => {
    const opts = document.getElementById("pfOpts");
    if (opts.children.length >= 6) return;
    opts.insertAdjacentHTML("beforeend", `<input type="text" class="pf-opt" maxlength="60" placeholder="Вариант ${opts.children.length + 1}">`);
    opts.lastElementChild.focus();
  };
  box.querySelector("[data-pf-send]").onclick = async () => {
    const question = document.getElementById("pfQ").value.trim();
    const options = [...box.querySelectorAll(".pf-opt")].map(i => i.value.trim()).filter(Boolean);
    const err = document.getElementById("pfMsg");
    if (!question) { err.textContent = "Напиши вопрос"; return; }
    if (options.length < 2) { err.textContent = "Нужно хотя бы два варианта"; return; }
    box.hidden = true; box.innerHTML = "";
    await sendMessage(c, { poll: { question, options } });
  };
}

function pollInner(m) {
  const votes = (chat.votes || []).filter(v => v.message_id === m.id);
  const total = votes.length;
  const mineV = votes.find(v => v.user_id === me());
  return `<b class="p-q">📊 ${esc(m.poll.question)}</b>
    ${m.poll.options.map((o, i) => {
      const n = votes.filter(v => v.option === i).length;
      const pct = total ? Math.round(n / total * 100) : 0;
      return `<button type="button" class="p-opt${mineV?.option === i ? " chosen" : ""}" data-pvote="${m.id}" data-opt="${i}" style="--pct:${pct}%">
        <span>${mineV?.option === i ? "✓ " : ""}${esc(o)}</span><i>${total ? pct + "%" : ""}</i></button>`;
    }).join("")}
    <span class="p-total">${total ? `${total} ${plural(total, ["голос", "голоса", "голосов"])}` : "Пока никто не голосовал"}</span>`;
}
function paintPoll(id) {
  const m = chat.messages.find(x => x.id === id), el = document.querySelector(`[data-poll="${id}"]`);
  if (m && el) el.innerHTML = pollInner(m);
}
// Голос: нажал на вариант — выбрал, нажал на свой ещё раз — забрал голос, нажал на другой — передумал
async function votePoll(id, option) {
  const mineV = chat.votes.find(v => v.message_id === id && v.user_id === me());
  const { error } = mineV && mineV.option === option
    ? await sb.from("poll_votes").delete().eq("message_id", id).eq("user_id", me())
    : await sb.from("poll_votes").upsert({ message_id: id, user_id: me(), option }, { onConflict: "message_id,user_id" });
  if (error) { toast("Голос не засчитался, попробуй ещё раз"); return; }
  chat.votes = chat.votes.filter(v => !(v.message_id === id && v.user_id === me()));
  if (!(mineV && mineV.option === option)) chat.votes.push({ message_id: id, user_id: me(), option });
  paintPoll(id);
}
function chatOnVote(type, n, o) {
  const r = type === "DELETE" ? o : n; if (!r || !chat.messages.some(m => m.id === r.message_id)) return;
  chat.votes = chat.votes.filter(v => !(v.message_id === r.message_id && v.user_id === r.user_id));
  if (type !== "DELETE") chat.votes.push(r);
  paintPoll(r.message_id);
}

// ---------- Закреплённое сообщение ----------

async function paintPin(c) {
  const bar = document.getElementById("pinBar"); if (!bar || !c) return;
  const id = c.pinned_message;
  if (!id) { bar.hidden = true; bar.innerHTML = ""; return; }
  let m = chat.messages.find(x => x.id === id);
  if (!m) { const r = await sb.from("messages").select("*").eq("id", id).maybeSingle(); m = r.data; }
  if (!m) { bar.hidden = true; return; }
  bar.innerHTML = `<button type="button" class="pin-main" data-pin-jump="${m.id}">
      <span class="pin-ico">📌</span><span class="pin-txt"><b>Закреплено · ${esc(nameOf(m.author))}</b><span>${esc(msgSummary(m))}</span></span></button>
    <button type="button" class="link-btn" data-unpin aria-label="Открепить">✕</button>`;
  bar.hidden = false;
}
async function pinMessage(id) {
  const c = chat.list.find(x => x.id === chat.open); if (!c) return;
  const next = c.pinned_message === id ? null : id;   // повторно на закреплённом — открепить
  const { error } = await sb.rpc("pin_message", { p_chat: c.id, p_message: next });
  if (error) { toast("Не получилось закрепить"); return; }
  c.pinned_message = next;
  paintPin(c);
}
function chatOnChatUpdate(row) {
  if (!row) return;
  const c = chat.list.find(x => x.id === row.id); if (!c) return;
  const changed = c.pinned_message !== row.pinned_message;
  Object.assign(c, row);
  if (changed && chat.open === c.id) paintPin(c);
}

// ---------- Поиск по переписке ----------

let searchTimer = null, searchSeq = 0;
function toggleSearch() {
  const box = document.getElementById("cSearch"); if (!box) return;
  if (!box.hidden) { box.hidden = true; box.innerHTML = ""; return; }
  box.innerHTML = `<div class="cs-row"><input type="search" id="csQ" placeholder="Поиск по переписке..." autocomplete="off">
    <button type="button" class="link-btn" data-csearch aria-label="Закрыть поиск">✕</button></div><div class="cs-res" id="csRes"></div>`;
  box.hidden = false;
  const q = document.getElementById("csQ");
  q.focus();
  q.oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => runSearch(q.value.trim()), 300); };
  q.onkeydown = e => { if (e.key === "Escape") toggleSearch(); };
}
async function runSearch(q) {
  const res = document.getElementById("csRes"); if (!res) return;
  if (q.length < 2) { searchSeq++; res.innerHTML = ""; return; }
  const like = "%" + q.replace(/[\\%_]/g, s => "\\" + s) + "%";
  const seq = ++searchSeq;
  const r = await sb.from("messages").select("*").eq("chat_id", chat.open).ilike("text", like).order("created_at", { ascending: false }).limit(30);
  if (seq !== searchSeq) return;   // пока искали, запрос уже поменяли — старый ответ не показываем
  const data = (r.data || []).filter(m => m.text);   // голосовые и опросы без текста в поиск не попадают
  const hl = s => esc(s).replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), x => `<mark>${x}</mark>`);
  res.innerHTML = data.length
    ? data.map(m => `<button type="button" class="cs-hit" data-search-jump="${m.id}" data-at="${m.created_at}">
        <span class="cs-who">${esc(nameOf(m.author))} · ${shortTime(m.created_at)}</span><span class="cs-txt">${hl(m.text.length > 120 ? m.text.slice(0, 120) + "…" : m.text)}</span></button>`).join("")
    : `<p class="msg">Ничего не нашлось</p>`;
}
// Перейти к сообщению: если оно далеко в истории, подгружаем переписку начиная с него
async function jumpToMessage(id, createdAt) {
  let el = document.querySelector(`[data-mid="${id}"]`);
  if (!el && createdAt) {
    const c = chat.list.find(x => x.id === chat.open);
    const [older, newer] = await Promise.all([
      sb.from("messages").select("*").eq("chat_id", chat.open).lt("created_at", createdAt).order("created_at", { ascending: false }).limit(20),
      sb.from("messages").select("*").eq("chat_id", chat.open).gte("created_at", createdAt).order("created_at").limit(300)
    ]);
    chat.messages = [...(older.data || []).reverse(), ...(newer.data || [])];
    chat.firstUnread = null;
    // Реакции и голоса в опросах для подгруженных сообщений, иначе они показались бы пустыми
    const ids = chat.messages.map(x => x.id), pollIds = chat.messages.filter(x => x.poll).map(x => x.id);
    const [r, v] = await Promise.all([
      ids.length ? sb.from("message_reactions").select("*").in("message_id", ids) : { data: [] },
      pollIds.length ? sb.from("poll_votes").select("*").in("message_id", pollIds) : { data: [] }
    ]);
    chat.reacts = r.data || []; chat.votes = v.data || [];
    await chatSigned(chat.messages.flatMap(x => [x.image_path, x.audio_path]));
    document.getElementById("msgsIn").innerHTML = renderMessages(c);
    paintTicks();
    el = document.querySelector(`[data-mid="${id}"]`);
  }
  if (!el) return;
  chat.atBottom = false;   // ушли вверх к сообщению — не тянем обратно вниз, когда догрузятся фото
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
}

async function sendMessage(c, { text = null, file = null, audio = null, duration = null, poll = null }) {
  const box = document.getElementById("msgs");
  const replyTo = chat.replyTo;
  setReply(null);
  // Пока отправляется — полупрозрачный пузырь с мерцанием
  const temp = document.createElement("div");
  temp.className = "msg mine pending";
  const what = file ? "📷 Отправляю фото..." : audio ? "🎤 Отправляю голосовое..." : poll ? "📊 Отправляю опрос..." : null;
  temp.innerHTML = `<div class="m-body"><div class="bubble">${what ? `<div class="m-img-pending">${what}</div>` : `<p class="m-text">${esc(text)}<span class="m-meta"><time>${timeText(new Date().toISOString())}</time><i class="tick">🕓</i></span></p>`}</div></div>`;
  const inner = document.getElementById("msgsIn");
  inner.querySelector(".msgs-empty")?.remove();
  inner.appendChild(temp);
  box.scrollTop = box.scrollHeight;

  try {
    let image_path = null, audio_path = null;
    if (file) {
      const blob = await resizeImage(file, 1920, 0.85);
      image_path = `${c.id}/${me()}-${crypto.randomUUID()}.jpg`;
      const up = await sb.storage.from(CHAT_BUCKET).upload(image_path, blob, { contentType: "image/jpeg" });
      if (up.error) throw up.error;
      await chatSigned([image_path]);
    }
    if (audio) {
      const ext = /mp4|aac|m4a/.test(audio.type) ? "m4a" : /ogg/.test(audio.type) ? "ogg" : "webm";
      audio_path = `${c.id}/${me()}-${crypto.randomUUID()}.${ext}`;
      const up = await sb.storage.from(CHAT_BUCKET).upload(audio_path, audio, { contentType: audio.type || "audio/webm" });
      if (up.error) throw up.error;
      await chatSigned([audio_path]);
    }
    const row = { chat_id: c.id, text, image_path, reply_to: replyTo };
    if (audio_path) Object.assign(row, { audio_path, audio_duration: duration });
    if (poll) row.poll = poll;
    const { data, error } = await sb.from("messages").insert(row).select().single();
    if (error) throw error;
    temp.remove();
    addMessage(data);
  } catch (err) {
    temp.classList.remove("pending");
    temp.classList.add("failed");
    temp.querySelector(".bubble").insertAdjacentHTML("beforeend", `<span class="m-fail">Не отправилось</span>`);
  }
}

// Добавить сообщение в открытый чат (своё после отправки или чужое из живых обновлений)
function addMessage(m) {
  if (chat.messages.some(x => x.id === m.id)) return;
  const c = chat.list.find(x => x.id === m.chat_id);
  const box = document.getElementById("msgs"), inner = document.getElementById("msgsIn");
  if (!c || !box || !inner) return;
  // Был ли человек внизу переписки до прихода сообщения (запоминается при каждой прокрутке)
  const nearBottom = chat.atBottom !== false;
  const prev = chat.messages[chat.messages.length - 1];
  chat.messages.push(m);
  inner.querySelector(".msgs-empty")?.remove();
  // Новое сообщение продолжает блок — у предыдущего убираем «хвостик»
  if (sameRunAs(prev, m)) document.querySelector(`[data-mid="${prev.id}"]`)?.classList.remove("tail");
  inner.insertAdjacentHTML("beforeend", msgHtml(m, prev, c, true));
  if (nearBottom || m.author === me()) { box.scrollTop = box.scrollHeight; chat.atBottom = true; }
  else { chat.newBelow++; paintToBottom(); }   // листаешь историю — копим счётчик на кнопке «вниз»
  chat.last[m.chat_id] = m;
  paintTicks();
  refreshChatSide();   // в списке слева обновится последнее сообщение
}

// ---------- Галочки ✓ / ✓✓ ----------
// ✓ — отправлено, ✓✓ (голубые) — кто-то из собеседников открыл чат после этого сообщения
function paintTicks() {
  const reads = Object.values(chat.otherReads || {});
  chat.messages.forEach(m => {
    if (m.author !== me()) return;
    const el = document.querySelector(`[data-tick="${m.id}"]`); if (!el) return;
    const read = reads.some(t => t >= m.created_at);
    if (read && !el.classList.contains("read")) { el.textContent = "✓✓"; el.classList.add("read"); }
    else if (!read) { el.textContent = "✓"; el.classList.remove("read"); }
  });
}
function chatOnRead(r) {
  if (!r || r.user_id === me() || r.chat_id !== chat.open) return;
  chat.otherReads[r.user_id] = r.last_read_at;
  paintTicks();
}

// Вернулся во вкладку с открытым чатом — всё, что пришло, пока был в другом месте, считается прочитанным
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && chat.open && chat.unread[chat.open]) markRead(chat.open);
});

// ---------- Кнопка «вниз» ----------
function wireChatScroll() {
  const box = document.getElementById("msgs"), btn = document.getElementById("toBottom");
  if (!box || !btn) return;
  chat.atBottom = true;
  box.addEventListener("scroll", () => {
    const dist = box.scrollHeight - box.scrollTop - box.clientHeight;
    chat.atBottom = dist < 160;
    btn.hidden = dist < 300 && !chat.newBelow;
    if (dist < 160) { chat.newBelow = 0; paintToBottom(); btn.hidden = true; }
  }, { passive: true });
  btn.onclick = () => {
    box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
    // Если плавная прокрутка не сработала (так бывает в фоне), просто прыгаем вниз
    setTimeout(() => {
      if (box.scrollHeight - box.scrollTop - box.clientHeight > 40) box.scrollTop = box.scrollHeight;
      chat.atBottom = true; chat.newBelow = 0; paintToBottom(); btn.hidden = true;
    }, 700);
  };
}
// Фото в переписке догружаются уже после открытия, а на телефоне ещё выезжает клавиатура —
// из-за этого чат «уплывал» вверх от последнего сообщения. Пока человек внизу, держим его внизу
let bottomObserver = null;
function stickToBottom(box) {
  bottomObserver?.disconnect();
  if (!window.ResizeObserver) return;
  bottomObserver = new ResizeObserver(() => {
    if (!document.body.contains(box)) { bottomObserver.disconnect(); return; }
    if (chat.atBottom !== false) box.scrollTop = box.scrollHeight;
  });
  bottomObserver.observe(box);
  bottomObserver.observe(document.getElementById("msgsIn"));
}

function paintToBottom() {
  const btn = document.getElementById("toBottom"); if (!btn) return;
  const n = btn.querySelector(".tb-count");
  n.textContent = chat.newBelow > 99 ? "99+" : chat.newBelow;
  n.hidden = !chat.newBelow;
  if (chat.newBelow) { btn.hidden = false; btn.classList.remove("pop"); void btn.offsetWidth; btn.classList.add("pop"); }
}

// ---------- Свайп влево по сообщению — ответить ----------
function wireSwipeReply() {
  const box = document.getElementById("msgs"); if (!box) return;
  let el = null, sx = 0, sy = 0, dx = 0, locked = null;
  box.addEventListener("touchstart", e => {
    const msg = e.target.closest(".msg[data-mid]"); if (!msg) return;
    el = msg; sx = e.touches[0].clientX; sy = e.touches[0].clientY; dx = 0; locked = null;
  }, { passive: true });
  box.addEventListener("touchmove", e => {
    if (!el) return;
    const x = e.touches[0].clientX - sx, y = e.touches[0].clientY - sy;
    if (locked === null && (Math.abs(x) > 8 || Math.abs(y) > 8)) locked = Math.abs(x) > Math.abs(y) ? "x" : "y";
    if (locked !== "x") return;
    dx = Math.max(-80, Math.min(0, x));
    el.style.transform = `translateX(${dx}px)`;
    el.classList.toggle("swiping", dx < -50);
  }, { passive: true });
  box.addEventListener("touchend", () => {
    if (!el) return;
    el.style.transition = "transform .25s"; el.style.transform = "";
    const done = el, go = dx < -50;
    setTimeout(() => { done.style.transition = ""; done.classList.remove("swiping"); }, 260);
    if (go) {
      const m = chat.messages.find(x => x.id === done.dataset.mid);
      if (m) { setReply(m); navigator.vibrate?.(12); }
    }
    el = null;
  });
}

// ---------- Кто в сети ----------
// Список приходит из живого канала (presence). В запасном режиме (через посредника) точек нет
function chatOnPresence(st) {
  chat.online = new Set(Object.keys(st || {}));
  paintPresence();
}
function paintPresence() {
  document.querySelectorAll("[data-online-user]").forEach(el => el.classList.toggle("is-online", chat.online.has(el.dataset.onlineUser)));
  const c = chat.list.find(x => x.id === chat.open), sub = document.getElementById("chSub");
  if (!c || !sub || sub.closest(".typing")) return;
  if (sub.classList.contains("typing")) return;
  if (c.kind === "direct") {
    const on = chat.online.has(otherIn(c));
    sub.textContent = on ? "в сети" : chatSubtitle(c);
    sub.classList.toggle("online", on);
  } else {
    const ids = c.kind === "general" ? state.profiles.map(p => p.id) : (chat.members[c.id] || []);
    const n = ids.filter(u => u !== me() && chat.online.has(u)).length;
    sub.textContent = chatSubtitle(c) + (n ? ` · ${n} в сети` : "");
  }
}

function setReply(m) {
  chat.replyTo = m ? m.id : null;
  const bar = document.getElementById("replyBar"); if (!bar) return;
  if (!m) { bar.hidden = true; bar.innerHTML = ""; return; }
  bar.innerHTML = `<div><b>↩ ${esc(nameOf(m.author))}</b><span>${esc(msgSummary(m))}</span></div>
    <button type="button" class="link-btn" data-reply-cancel aria-label="Отменить ответ">✕</button>`;
  bar.hidden = false;
  document.querySelector("#composer textarea")?.focus();
}

async function toggleMsgReact(id, emoji, fromEl) {
  const mine = chat.reacts.find(r => r.message_id === id && r.user_id === me() && r.emoji === emoji);
  const { error } = mine
    ? await sb.from("message_reactions").delete().eq("message_id", id).eq("user_id", me()).eq("emoji", emoji)
    : await sb.from("message_reactions").insert({ message_id: id, emoji });
  if (error) return;
  if (!mine && fromEl) burst(fromEl, EMOJI[emoji]);
  const i = chat.reacts.findIndex(r => r.message_id === id && r.user_id === me() && r.emoji === emoji);
  if (mine && i >= 0) chat.reacts.splice(i, 1);
  if (!mine && i < 0) chat.reacts.push({ message_id: id, user_id: me(), emoji });
  paintMsgReacts(id);
}

async function deleteMessage(id) {
  const m = chat.messages.find(x => x.id === id); if (!m) return;
  const { error } = await sb.from("messages").delete().eq("id", id);
  if (error) { toast("Не получилось удалить"); return; }
  // Файл фото или голосового тоже стираем, чтобы не занимал место
  const files = [m.image_path, m.audio_path].filter(Boolean);
  if (files.length) sb.storage.from(CHAT_BUCKET).remove(files);
  removeMessage(id);
}
function removeMessage(id) {
  chat.messages = chat.messages.filter(x => x.id !== id);
  // Удалили закреплённое — полоска сверху тоже пропадает
  const c = chat.list.find(x => x.id === chat.open);
  if (c && c.pinned_message === id) { c.pinned_message = null; paintPin(c); }
  const el = document.querySelector(`[data-mid="${id}"]`);
  if (el) { el.classList.add("bye"); setTimeout(() => el.remove(), 280); }
}

// ---------- Нажатия в мессенджере ----------

document.addEventListener("click", async e => {
  const dm = e.target.closest("[data-dm]"); if (dm) return openDirect(dm.dataset.dm);
  const panel = e.target.closest("[data-panel]");
  if (panel) { chat.panel = chat.panel === panel.dataset.panel ? null : panel.dataset.panel; return refreshChatSide(true); }
  if (!chat.open) return;

  const act = e.target.closest("[data-mact]");
  if (act) {
    const id = act.closest("[data-mid]").dataset.mid;
    const m = chat.messages.find(x => x.id === id);
    act.closest(".msg").classList.remove("active");
    if (act.dataset.mact === "react") return toggleMsgReact(id, act.dataset.emoji, act.closest(".msg").querySelector(".bubble"));
    if (act.dataset.mact === "reply") return setReply(m);
    if (act.dataset.mact === "del") return deleteMessage(id);
    if (act.dataset.mact === "pin") return pinMessage(id);
  }
  const pill = e.target.closest("[data-mreact]"); if (pill) return toggleMsgReact(pill.dataset.mreact, pill.dataset.emoji, pill);
  // Голосовые: ▶/❚❚ и перемотка нажатием по «волне»
  const vp = e.target.closest("[data-vplay]"); if (vp) return toggleVoice(vp.dataset.vplay);
  const vs = e.target.closest("[data-vseek]");
  if (vs) { const r = vs.getBoundingClientRect(); return toggleVoice(vs.dataset.vseek, Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))); }
  // Опросы
  const pv = e.target.closest("[data-pvote]"); if (pv) return votePoll(pv.dataset.pvote, Number(pv.dataset.opt));
  // Закреплённое: нажал — перейти к сообщению, ✕ — открепить
  const pj = e.target.closest("[data-pin-jump]");
  if (pj) { const m = chat.messages.find(x => x.id === pj.dataset.pinJump); return jumpToMessage(pj.dataset.pinJump, m?.created_at || (await sb.from("messages").select("created_at").eq("id", pj.dataset.pinJump).maybeSingle()).data?.created_at); }
  if (e.target.closest("[data-unpin]")) { const c = chat.list.find(x => x.id === chat.open); if (c?.pinned_message) return pinMessage(c.pinned_message); return; }
  // Поиск
  if (e.target.closest("[data-csearch]")) return toggleSearch();
  const sj = e.target.closest("[data-search-jump]"); if (sj) return jumpToMessage(sj.dataset.searchJump, sj.dataset.at);
  if (e.target.closest("[data-reply-cancel]")) return setReply(null);
  const zoom = e.target.closest("[data-zoom]");
  if (zoom) { await chatSigned([zoom.dataset.zoom]); return openLightbox(chatUrl(zoom.dataset.zoom)); }
  // Нажал на цитату в ответе — к исходному сообщению, даже если оно далеко в истории
  const jump = e.target.closest("[data-jump]");
  if (jump) {
    const id = jump.dataset.jump;
    if (document.querySelector(`[data-mid="${id}"]`)) return jumpToMessage(id);
    const r = await sb.from("messages").select("created_at").eq("id", id).maybeSingle();
    if (r.data) jumpToMessage(id, r.data.created_at);
    return;
  }
  if (e.target.closest("[data-addppl]")) return toggleAddPeople();
  const addOne = e.target.closest("[data-addone]");
  if (addOne) {
    const { error } = await sb.rpc("add_to_group", { chat: chat.open, members: [addOne.dataset.addone] });
    if (!error) { await loadChats(); viewChat(chat.open); }
    return;
  }
  // Нажатие на пузырь показывает реакции и «Ответить»
  const bubble = e.target.closest("[data-bubble]");
  document.querySelectorAll(".msg.active").forEach(x => { if (!bubble || x !== bubble.closest(".msg")) x.classList.remove("active"); });
  if (bubble && !e.target.closest("a")) {
    const msg = bubble.closest(".msg");
    // У самого верхнего сообщения меню не помещается сверху — показываем его снизу
    const box = document.getElementById("msgs");
    msg.classList.toggle("below", bubble.getBoundingClientRect().top - box.getBoundingClientRect().top < 64);
    msg.classList.toggle("active");
  }
});

function toggleAddPeople() {
  const box = document.getElementById("addPpl"); if (!box) return;
  if (!box.hidden) { box.hidden = true; return; }
  const inside = chat.members[chat.open] || [];
  const out = state.profiles.filter(p => !inside.includes(p.id));
  box.innerHTML = out.length
    ? `<p class="msg">Кого добавить?</p><div class="chips">${out.map(p => `<button type="button" class="chip" data-addone="${p.id}">${avatar(p.id)}${esc(p.name)}</button>`).join("")}</div>`
    : `<p class="msg">Все корефаны уже в группе.</p>`;
  box.hidden = false;
}

function openLightbox(src) {
  if (!src) return;
  const lb = document.createElement("div");
  lb.className = "lightbox";
  lb.innerHTML = `<button type="button" class="btn lb-close" aria-label="Закрыть">✕</button><img src="${src}" alt="">`;
  const close = () => { lb.classList.add("out"); setTimeout(() => lb.remove(), 200); document.removeEventListener("keydown", onKey); };
  const onKey = e => { if (e.key === "Escape") close(); };
  lb.onclick = close;   // нажатие куда угодно, в том числе на крестик, закрывает
  document.addEventListener("keydown", onKey);
  document.body.appendChild(lb);
}

// ---------- «Печатает...» ----------
// Пока пишешь, раз в 2 секунды сообщаем остальным через живой канал. Сохранять в базу не нужно.

let typingSentAt = 0, typingTimer = null;
function sendTyping(chatId) {
  if (!liveChannel) return;                 // в запасном режиме (через посредника) не работает
  const now = Date.now();
  if (now - typingSentAt < 2000) return;
  typingSentAt = now;
  liveChannel.send({ type: "broadcast", event: "typing", payload: { chat: chatId, user: me() } });
}

function chatOnTyping(p) {
  if (!p || p.user === me() || p.chat !== chat.open) return;
  const el = document.getElementById("chSub"); if (!el) return;
  if (!el.dataset.orig) el.dataset.orig = el.textContent;
  el.classList.add("typing");
  el.innerHTML = `${esc(nameOf(p.user))} печатает<i></i><i></i><i></i>`;
  clearTimeout(typingTimer);
  typingTimer = setTimeout(stopTyping, 3500);
}
function stopTyping() {
  const el = document.getElementById("chSub");
  if (el && el.dataset.orig) { el.textContent = el.dataset.orig; el.classList.remove("typing"); delete el.dataset.orig; }
}

// ---------- Живые обновления (вызываются из app.js) ----------

function chatOnMessage(type, n, o) {
  if (!chat.ready) return;
  if (type === "INSERT" && n) {
    // Одно и то же сообщение может прийти дважды (живой канал и проверка) — считаем один раз
    if (chat.seen.has(n.id)) return;
    chat.seen.add(n.id);
    if (n.created_at > chat.lastPoll) chat.lastPoll = n.created_at;
    const known = chat.list.some(c => c.id === n.chat_id);
    if (!known) { loadChats().then(() => refreshChatSide()); }
    if (n.author !== me()) playMessageSound();
    chat.last[n.chat_id] = n;
    if (chat.open === n.chat_id) {
      if (n.author !== me()) stopTyping();   // сообщение пришло — «печатает» больше не нужно
      addMessage(n);
      if (n.image_path) chatSigned([n.image_path]).then(() => {
        const img = document.querySelector(`[data-mid="${n.id}"] .m-img`); if (img) img.src = chatUrl(n.image_path);
      });
      if (!document.hidden) markRead(n.chat_id);
      else if (n.author !== me()) chat.unread[n.chat_id] = (chat.unread[n.chat_id] || 0) + 1;   // прочтём, когда вернётся во вкладку
    } else if (n.author !== me() && known) {
      chat.unread[n.chat_id] = (chat.unread[n.chat_id] || 0) + 1;
      paintChatBadge();
      const c = chat.list.find(x => x.id === n.chat_id);
      const where = c.kind === "direct" ? "" : ` в «${chatTitle(c)}»`;
      toast(`${nameOf(n.author)}${where}: ${msgSummary(n)}`, "Открыть", () => { location.hash = `#/chat/${n.chat_id}`; });
      refreshChatSide();
    }
  }
  if (type === "DELETE" && o?.id) {
    if (chat.open === o.chat_id || chat.messages.some(x => x.id === o.id)) removeMessage(o.id);
  }
}

function chatOnReact(type, n, o) {
  const r = type === "INSERT" ? n : o; if (!r || !chat.messages.some(m => m.id === r.message_id)) return;
  const same = x => x.message_id === r.message_id && x.user_id === r.user_id && x.emoji === r.emoji;
  if (type === "INSERT") { if (chat.reacts.some(same)) return; chat.reacts.push(r); }
  else { const i = chat.reacts.findIndex(same); if (i < 0) return; chat.reacts.splice(i, 1); }
  paintMsgReacts(r.message_id);
}

function chatOnMembers() { loadChats().then(() => refreshChatSide()); }

// Перерисовать левую колонку со списком чатов, не трогая открытую переписку.
// force — даже если открыта панель (нажали «Написать» или «+ Группа»)
function refreshChatSide(force = false) {
  const side = document.querySelector(".chat-side"); if (!side) return;
  if (!force && chat.panel) return;   // не сбиваем форму новой группы, пока её заполняют
  side.classList.add("no-anim");      // при обновлении строки не выезжают заново
  side.innerHTML = chatListHtml(chat.open);
  wireGroupForm();
  paintPresence();
}

// Запасной режим без живого канала: раз в 15 секунд проверяем новое
async function chatPoll() {
  if (!chat.ready || !chat.lastPoll) return;
  const { data } = await sb.from("messages").select("*").gt("created_at", chat.lastPoll).order("created_at");
  (data || []).forEach(m => { chatOnMessage("INSERT", m); if (m.created_at > chat.lastPoll) chat.lastPoll = m.created_at; });
  if (chat.open) {
    const ids = chat.messages.map(x => x.id);
    if (!ids.length) return;
    const [still, r] = await Promise.all([
      sb.from("messages").select("id").in("id", ids),
      sb.from("message_reactions").select("*").in("message_id", ids)
    ]);
    if (still.data) {
      const alive = new Set(still.data.map(x => x.id));
      ids.filter(id => !alive.has(id)).forEach(id => removeMessage(id));
    }
    if (r.data) {
      const key = x => `${x.message_id}|${x.user_id}|${x.emoji}`;
      const fresh = new Set(r.data.map(key)), have = new Set(chat.reacts.map(key));
      r.data.filter(x => !have.has(key(x))).forEach(x => chatOnReact("INSERT", x));
      chat.reacts.filter(x => !fresh.has(key(x))).forEach(x => chatOnReact("DELETE", null, x));
    }
    // Галочки «прочитано» в запасном режиме тоже обновляем раз в 15 секунд
    const rr = await sb.from("chat_reads").select("*").eq("chat_id", chat.open);
    (rr.data || []).forEach(chatOnRead);
    // Голоса в опросах и закреплённое сообщение
    const pollIds = chat.messages.filter(x => x.poll).map(x => x.id);
    if (pollIds.length) {
      const pv = await sb.from("poll_votes").select("*").in("message_id", pollIds);
      if (pv.data) { chat.votes = pv.data; pollIds.forEach(paintPoll); }
    }
    const ch = await sb.from("chats").select("*").eq("id", chat.open).maybeSingle();
    if (ch.data) chatOnChatUpdate(ch.data);
  }
}
