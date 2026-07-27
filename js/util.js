/* ============================================================
   HELPERS compartilhados (tempo, datas, DOM)
   ============================================================ */
"use strict";

// ---------- tempo ----------
function parseHHMM(s) {
  if (!s || !/^\d{1,2}:\d{2}$/.test(s)) return null;
  const [h, m] = s.split(":").map(Number);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/* Duração entre dois horários. Se o fim for menor que o início,
   assume virada de meia-noite (ex.: 23:30 -> 00:15 = 45 min). */
function diffMin(inicio, fim) {
  const a = parseHHMM(inicio), b = parseHHMM(fim);
  if (a === null || b === null) return null;
  return b >= a ? b - a : 24 * 60 - a + b;
}

/* Desvio em minutos entre um horário e sua meta, pelo caminho mais curto
   no relógio de 24h. Positivo = depois da meta, negativo = antes. */
function desvioCircular(valor, meta) {
  const v = parseHHMM(valor), m = parseHHMM(meta);
  if (v === null || m === null) return null;
  let d = v - m;
  if (d > 12 * 60) d -= 24 * 60;
  if (d < -12 * 60) d += 24 * 60;
  return d;
}

function formatDuracao(min) {
  if (min === null || min === undefined || isNaN(min)) return "—";
  const sinal = min < 0 ? "−" : "";
  const abs = Math.abs(Math.round(min));
  const h = Math.floor(abs / 60), m = abs % 60;
  if (h === 0) return `${sinal}${m}min`;
  if (m === 0) return `${sinal}${h}h`;
  return `${sinal}${h}h${String(m).padStart(2, "0")}`;
}

function formatDelta(min) {
  if (min === null || min === undefined || isNaN(min)) return "";
  const s = min > 0 ? "+" : min < 0 ? "−" : "±";
  return s + formatDuracao(Math.abs(min)).replace("−", "");
}

/* Máscara de digitação HH:MM — insere ":" sozinho. */
function mascaraHora(v) {
  const d = String(v).replace(/\D/g, "").slice(0, 4);
  if (d.length <= 2) return d;
  return d.slice(0, 2) + ":" + d.slice(2);
}

const horaAgora = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

// ---------- datas ----------
const isoDe = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const hojeISO = () => isoDe(new Date());
const addDias = (iso, n) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return isoDe(d); };
const dowDe = (iso) => new Date(iso + "T00:00:00").getDay();

const DOW_CURTO = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MESES_CURTO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function formatarDataBR(iso) {
  const d = new Date(iso + "T00:00:00");
  return `${DOW_CURTO[d.getDay()]}, ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}
function formatarDataCurta(iso) {
  const d = new Date(iso + "T00:00:00");
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function inicioSemana(iso) { // segunda-feira
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return isoDe(d);
}

// ---------- estatística ----------
function media(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null; }
function desvioPadrao(arr) { // amostral (n-1)
  if (arr.length < 2) return null;
  const m = media(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}
function mediana(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b), i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
}

// ---------- DOM ----------
function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const k in attrs) {
    const v = attrs[k];
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else if (k === "value") e.value = v;
    else if (k === "checked" || k === "disabled" || k === "selected") e[k] = !!v;
    else e.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    e.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return e;
}
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const escapeHTML = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- toast ----------
let _toastTimer = null;
function toast(msg, tipo = "info") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.className = "toast show " + tipo;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { t.className = "toast"; }, 3200);
}
