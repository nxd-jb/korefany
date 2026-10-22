// Адрес проекта в Supabase и публичный ключ.
// Этот ключ специально сделан для сайта, его можно хранить в коде.
// Ключ service_role / secret сюда НИКОГДА не вставлять.

// Запасной путь, если провайдер блокирует supabase.co: запросы идут через Netlify (файл _redirects),
// а он сам пересылает их в Supabase. Работает, где бы ни лежал сайт: на Netlify, GitHub Pages или где-то ещё
const NETLIFY_PROXY = "https://korefany.netlify.app/sb";

window.KOREFANY = {
  url: "https://jvyitolecgbldlxypwcz.supabase.co",
  key: "sb_publishable_HxAh45teG6Bt3uHshRECzQ_PiT7QkRR",
  proxyUrl: NETLIFY_PROXY,
  maxVideoMb: 50
};
