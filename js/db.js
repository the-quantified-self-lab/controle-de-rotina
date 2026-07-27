/* ============================================================
   PERSISTÊNCIA — IndexedDB
   Stores:
     dias   (keyPath "date")  -> um registro por dia, isolado
     config (keyPath "k")     -> grades editáveis, âncoras, prefs, sync
   ============================================================ */
"use strict";

const DB_NAME = "controle_rotina_pwa";
const DB_VERSION = 1;
const STORE_DIAS = "dias";
const STORE_CFG = "config";
const SCHEMA_VERSION = 2;

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_DIAS)) db.createObjectStore(STORE_DIAS, { keyPath: "date" });
      if (!db.objectStoreNames.contains(STORE_CFG)) db.createObjectStore(STORE_CFG, { keyPath: "k" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

/* Executa fn(store) numa transação e resolve com o RESULTADO da request
   (ou undefined em put/delete). Importante: nunca resolver com o próprio
   IDBRequest — um get sem resultado precisa devolver undefined, não um
   objeto truthy. */
function tx(store, mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let req;
    try { req = fn(s); } catch (e) { reject(e); return; }
    let valor;
    if (req && typeof req === "object" && "onsuccess" in req) {
      req.onsuccess = () => { valor = req.result; };
    }
    t.oncomplete = () => resolve(valor);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

// ---------- dias ----------
const salvarDia = (dia) => {
  dia.atualizado_em = new Date().toISOString();
  return tx(STORE_DIAS, "readwrite", (s) => s.put(dia));
};
const carregarDia = (date) => tx(STORE_DIAS, "readonly", (s) => s.get(date)).then((r) => r || null).catch(() => null);
const listarDias = () => tx(STORE_DIAS, "readonly", (s) => s.getAll())
  .then((r) => (r || []).sort((a, b) => a.date.localeCompare(b.date)));
const listarDatas = () => tx(STORE_DIAS, "readonly", (s) => s.getAllKeys()).then((r) => r || []);
const apagarDia = (date) => tx(STORE_DIAS, "readwrite", (s) => s.delete(date));

// ---------- config ----------
const setCfg = (k, v) => tx(STORE_CFG, "readwrite", (s) => s.put({ k, v }));
const getCfg = (k, fallback = null) =>
  tx(STORE_CFG, "readonly", (s) => s.get(k)).then((r) => (r && r.v !== undefined ? r.v : fallback)).catch(() => fallback);

/* Config do usuário (grades + âncoras). Mescla com o padrão para que
   novas chaves adicionadas em versões futuras não fiquem faltando. */
async function carregarConfig() {
  const salva = await getCfg("rotina", null);
  const base = configPadrao();
  if (!salva) return base;
  return {
    ancoras: { ...base.ancoras, ...(salva.ancoras || {}) },
    grades: { ...base.grades, ...(salva.grades || {}) },
  };
}
const salvarConfig = (cfg) => setCfg("rotina", cfg);
const resetarConfig = () => setCfg("rotina", configPadrao());

// ---------- criação de dia (com snapshot da grade) ----------
function criarDiaVazio(date, cfg, tipoForcado) {
  const tipo = tipoForcado || inferirTipoDia(date);
  const grade = (cfg.grades[tipo] || []).map((t) => ({ ...t }));
  return {
    date,
    tipo_dia: tipo,
    schema: SCHEMA_VERSION,
    observacao: "",
    // snapshot: congela a grade e as âncoras vigentes hoje
    grade,
    ancoras: { ...cfg.ancoras },
    sono: { acordou: "", deitou: "", dormiu: "" },
    chave_mestra: { ativa: false, tipo: "dia_inteiro", inicio: "", fim: "", motivo: "" },
    tarefas: grade.map((t) => ({ id: t.id, inicio: "", fim: "", obs: "" })),
    interrupcoes: [],
    criado_em: new Date().toISOString(),
    atualizado_em: new Date().toISOString(),
  };
}

/* Normaliza dias vindos de import/versões antigas e garante que toda
   tarefa da grade tenha uma entrada correspondente. */
function normalizarDia(d, cfg) {
  if (!d) return d;
  if (!Array.isArray(d.grade) || !d.grade.length) {
    const tipo = d.tipo_dia || inferirTipoDia(d.date);
    d.grade = (cfg.grades[tipo] || []).map((t) => ({ ...t }));
  }
  if (!d.ancoras) d.ancoras = { ...cfg.ancoras };
  if (!d.sono) d.sono = { acordou: "", deitou: "", dormiu: "" };
  if (d.sono.deitou === undefined) d.sono.deitou = "";
  if (!d.chave_mestra) d.chave_mestra = { ativa: false, tipo: "dia_inteiro", inicio: "", fim: "", motivo: "" };
  if (!Array.isArray(d.interrupcoes)) d.interrupcoes = Array.isArray(d.interrupcoes_escritorio) ? d.interrupcoes_escritorio : [];
  delete d.interrupcoes_escritorio;
  if (!Array.isArray(d.tarefas)) d.tarefas = [];
  // compat: versão antiga usava timestamp_inicio/timestamp_fim/observacao
  d.tarefas = d.tarefas.map((t) => ({
    id: t.id,
    inicio: t.inicio !== undefined ? t.inicio : (t.timestamp_inicio || ""),
    fim: t.fim !== undefined ? t.fim : (t.timestamp_fim || ""),
    obs: t.obs !== undefined ? t.obs : (t.observacao || ""),
  }));
  const existentes = new Set(d.tarefas.map((t) => t.id));
  d.grade.forEach((g) => { if (!existentes.has(g.id)) d.tarefas.push({ id: g.id, inicio: "", fim: "", obs: "" }); });
  d.schema = SCHEMA_VERSION;
  return d;
}

// ---------- export / import ----------
function baixarBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function exportarJSON() {
  const dias = await listarDias();
  const cfg = await carregarConfig();
  const payload = { exported_at: new Date().toISOString(), schema_version: SCHEMA_VERSION, config: cfg, dias };
  baixarBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
    `rotina_backup_${hojeISO()}.json`);
  return dias.length;
}

const csvEsc = (v) => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

/* CSV long-format: uma linha por item (tarefa / sono / interrupção). */
function montarLinhasCSV(dias) {
  const dows = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
  const linhas = [];
  for (const d of dias) {
    const dow = dows[new Date(d.date + "T00:00:00").getDay()];
    const ch = d.chave_mestra || {};
    const chAtiva = ch.ativa ? "sim" : "nao";
    const gradeById = {};
    (d.grade || []).forEach((g) => { gradeById[g.id] = g; });

    (d.grade || []).forEach((g) => {
      const t = (d.tarefas || []).find((x) => x.id === g.id) || {};
      const dur = diffMin(t.inicio, t.fim);
      const plan = diffMin(g.inicio, g.fim);
      linhas.push([
        d.date, dow, d.tipo_dia, "tarefa", g.id, g.nome, g.cat,
        t.inicio || "", t.fim || "", dur === null ? "" : dur,
        g.inicio, g.fim, plan === null ? "" : plan,
        dur === null || plan === null ? "" : dur - plan,
        t.obs || "", d.observacao || "", chAtiva, ch.tipo || "", ch.motivo || "",
      ]);
    });

    const anc = d.ancoras || {};
    [["acordou", "Acordar", anc.acordar], ["deitou", "Deitar", anc.deitar], ["dormiu", "Dormir", anc.dormir]]
      .forEach(([k, nome, meta]) => {
        const v = (d.sono || {})[k] || "";
        const desvio = v && meta ? desvioCircular(v, meta) : null;
        linhas.push([
          d.date, dow, d.tipo_dia, "sono", k, nome, "sono",
          v, "", "", meta || "", "", "", desvio === null ? "" : desvio,
          "", d.observacao || "", chAtiva, ch.tipo || "", ch.motivo || "",
        ]);
      });

    (d.interrupcoes || []).forEach((i) => {
      const dur = diffMin(i.inicio, i.fim);
      linhas.push([
        d.date, dow, d.tipo_dia, "interrupcao", i.id || "", "Interrupção do escritório", "expediente",
        i.inicio || "", i.fim || "", dur === null ? "" : dur,
        "", "", "", "", i.motivo || "", d.observacao || "", chAtiva, ch.tipo || "", ch.motivo || "",
      ]);
    });
  }
  return linhas;
}

const CSV_HEADER = [
  "date", "dia_semana", "tipo_dia", "kind", "item_id", "item_nome", "categoria",
  "inicio_real", "fim_real", "duracao_min",
  "inicio_previsto", "fim_previsto", "duracao_prevista_min", "desvio_min",
  "observacao_item", "observacao_dia", "chave_mestra", "chave_mestra_tipo", "chave_mestra_motivo",
];

async function exportarCSV() {
  const dias = await listarDias();
  const linhas = montarLinhasCSV(dias).map((l) => l.map(csvEsc).join(","));
  const conteudo = "﻿" + [CSV_HEADER.join(",")].concat(linhas).join("\n");
  baixarBlob(new Blob([conteudo], { type: "text/csv;charset=utf-8" }), `rotina_${hojeISO()}.csv`);
  return dias.length;
}

async function importarJSON(file) {
  const texto = await file.text();
  const data = JSON.parse(texto);
  if (!data.dias || !Array.isArray(data.dias)) throw new Error("Formato inválido: falta o campo 'dias'.");
  const cfg = await carregarConfig();
  let n = 0;
  for (const dia of data.dias) {
    if (!dia || !dia.date) continue;
    delete dia._derivado;
    await salvarDia(normalizarDia(dia, cfg));
    n++;
  }
  if (data.config && data.config.grades) await salvarConfig(data.config);
  return n;
}
