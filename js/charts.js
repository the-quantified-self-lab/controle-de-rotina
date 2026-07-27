/* ============================================================
   ANÁLISE — agregações + gráficos SVG (sem bibliotecas externas)
   Toda interpretação sobre os dados vive aqui. O registro diário
   permanece neutro: só coleta horários.
   ============================================================ */
"use strict";

const NS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs = {}, children = []) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) {
    if (attrs[k] === null || attrs[k] === undefined || attrs[k] === false) continue;
    e.setAttribute(k, attrs[k]);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    e.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return e;
}

// ---------- agregação ----------
const diaTemDados = (d) =>
  !!d && ((d.sono && (d.sono.acordou || d.sono.deitou || d.sono.dormiu)) ||
    (d.tarefas || []).some((t) => t.inicio || t.fim));

function filtrarPeriodo(dias, nDias) {
  if (nDias === "tudo") return dias.filter(diaTemDados);
  const limite = addDias(hojeISO(), -(Number(nDias) - 1));
  return dias.filter((d) => d.date >= limite && diaTemDados(d));
}

/* Resumo de um dia: minutos por categoria, tempo útil, expediente
   (somando interrupções do escritório) e desvios de sono. */
function resumirDia(d) {
  const grade = {};
  (d.grade || []).forEach((g) => { grade[g.id] = g; });
  const porCat = {};
  let previstoUtil = 0;

  (d.tarefas || []).forEach((t) => {
    const g = grade[t.id];
    if (!g) return;
    const dur = diffMin(t.inicio, t.fim);
    if (dur === null) return;
    porCat[g.cat] = (porCat[g.cat] || 0) + dur;
  });
  (d.grade || []).forEach((g) => { if (g.cat === "tempo_util") previstoUtil += diffMin(g.inicio, g.fim) || 0; });

  let interrupcoes = 0;
  (d.interrupcoes || []).forEach((i) => { const x = diffMin(i.inicio, i.fim); if (x !== null) interrupcoes += x; });

  const tempoUtilBruto = porCat.tempo_util || 0;
  const anc = d.ancoras || {};
  return {
    date: d.date,
    tipo_dia: d.tipo_dia,
    excecao: !!(d.chave_mestra && d.chave_mestra.ativa),
    porCat,
    interrupcoes,
    tempoUtil: Math.max(0, tempoUtilBruto - interrupcoes),
    tempoUtilBruto,
    tempoUtilPrevisto: previstoUtil,
    expediente: (porCat.expediente || 0) + interrupcoes,
    treino: porCat.treino || 0,
    desvioAcordar: desvioCircular(d.sono?.acordou, anc.acordar),
    desvioDormir: desvioCircular(d.sono?.dormiu, anc.dormir),
    sono: d.sono || {},
    metaSono: diffMin(anc.dormir, anc.acordar),
    // preenchido por vincularSono(): depende do "dormir" da véspera
    sonoMin: null,
  };
}

/* O sono de um dia vai do "dormir" da véspera até o "acordar" de hoje.
   Recebe o índice de TODOS os dias para que o primeiro dia do período
   ainda consiga enxergar a véspera, mesmo fora do recorte. */
function vincularSono(resumos, porData) {
  resumos.forEach((r) => {
    const vespera = porData[addDias(r.date, -1)];
    const dormiuOntem = vespera && vespera.sono ? vespera.sono.dormiu || "" : "";
    r.sonoMin = diffMin(dormiuOntem, r.sono.acordou || "");
    r.dormiuOntem = dormiuOntem;
  });
  return resumos;
}

/* Estatística por tarefa: n, média, desvio padrão, mediana, mín, máx
   e desvio médio frente ao tempo previsto na grade. */
function estatisticasPorTarefa(dias) {
  const acc = {};
  dias.forEach((d) => {
    const grade = {}; (d.grade || []).forEach((g) => { grade[g.id] = g; });
    (d.tarefas || []).forEach((t) => {
      const g = grade[t.id];
      if (!g) return;
      const dur = diffMin(t.inicio, t.fim);
      if (dur === null) return;
      if (!acc[g.id]) acc[g.id] = { id: g.id, nome: g.nome, cat: g.cat, durs: [], previstos: [] };
      acc[g.id].durs.push(dur);
      const p = diffMin(g.inicio, g.fim);
      if (p !== null) acc[g.id].previstos.push(p);
    });
  });
  return Object.values(acc).map((a) => {
    const m = media(a.durs);
    const prev = media(a.previstos);
    return {
      ...a, n: a.durs.length, media: m, desvio: desvioPadrao(a.durs), mediana: mediana(a.durs),
      min: Math.min(...a.durs), max: Math.max(...a.durs),
      previsto: prev, desvioMeta: m !== null && prev !== null ? m - prev : null,
      total: a.durs.reduce((s, v) => s + v, 0),
    };
  }).sort((a, b) => b.total - a.total);
}

// ---------- gráficos ----------
const CH = { w: 720, h: 240, ml: 46, mr: 12, mt: 14, mb: 30 };

function molduraSVG(titulo, conteudo, alturaExtra = 0) {
  const box = el("section", { class: "chart-card" });
  box.appendChild(el("h3", { class: "chart-title", text: titulo }));
  const wrap = el("div", { class: "chart-scroll" });
  wrap.appendChild(conteudo);
  box.appendChild(wrap);
  return box;
}
const vazio = (msg) => el("p", { class: "empty", text: msg });

/* Barras verticais: Tempo Útil por dia, com linha da meta prevista. */
function graficoTempoUtil(resumos) {
  if (!resumos.length) return vazio("Sem registros no período.");
  const { w, h, ml, mr, mt, mb } = CH;
  const larguraMin = Math.max(w, resumos.length * 26);
  const iw = larguraMin - ml - mr, ih = h - mt - mb;
  const maxY = Math.max(60, ...resumos.map((r) => Math.max(r.tempoUtil, r.tempoUtilPrevisto))) * 1.1;
  const x = (i) => ml + (iw / resumos.length) * (i + 0.5);
  const y = (v) => mt + ih - (v / maxY) * ih;
  const bw = Math.max(4, Math.min(22, (iw / resumos.length) * 0.62));

  const svg = svgEl("svg", { viewBox: `0 0 ${larguraMin} ${h}`, class: "chart", width: larguraMin, height: h, role: "img" });

  // grade horizontal + rótulos em horas
  const passo = maxY > 600 ? 120 : 60;
  for (let v = 0; v <= maxY; v += passo) {
    svg.appendChild(svgEl("line", { x1: ml, x2: larguraMin - mr, y1: y(v), y2: y(v), class: "grid" }));
    svg.appendChild(svgEl("text", { x: ml - 8, y: y(v) + 4, class: "axis", "text-anchor": "end" }, `${Math.round(v / 60)}h`));
  }

  resumos.forEach((r, i) => {
    const alt = Math.max(0, y(0) - y(r.tempoUtil));
    const bateuMeta = r.tempoUtilPrevisto > 0 && r.tempoUtil >= r.tempoUtilPrevisto;
    svg.appendChild(svgEl("rect", {
      x: x(i) - bw / 2, y: y(r.tempoUtil), width: bw, height: alt, rx: 3,
      class: "bar " + (r.excecao ? "bar-excecao" : bateuMeta ? "bar-ok" : "bar-abaixo"),
    }, [svgEl("title", {}, `${formatarDataBR(r.date)}\nTempo útil: ${formatDuracao(r.tempoUtil)}\nPrevisto: ${formatDuracao(r.tempoUtilPrevisto)}`)]));
    // marca da meta do dia
    if (r.tempoUtilPrevisto > 0) {
      svg.appendChild(svgEl("line", {
        x1: x(i) - bw / 2 - 2, x2: x(i) + bw / 2 + 2, y1: y(r.tempoUtilPrevisto), y2: y(r.tempoUtilPrevisto), class: "meta-tick",
      }));
    }
  });

  // rótulos do eixo X (esparsos para não poluir)
  const passoX = Math.ceil(resumos.length / 12);
  resumos.forEach((r, i) => {
    if (i % passoX) return;
    svg.appendChild(svgEl("text", { x: x(i), y: h - 10, class: "axis", "text-anchor": "middle" }, formatarDataCurta(r.date)));
  });
  return svg;
}

/* Barras verticais: horas de sono por dia, com linha da meta. */
function graficoSonoHoras(resumos) {
  const pts = resumos.filter((r) => r.sonoMin !== null);
  if (!pts.length) return vazio("Sem noites completas no período. O sono precisa do horário de dormir da véspera e do acordar do dia.");

  const { h, ml, mr, mt, mb } = CH;
  const w = Math.max(720, pts.length * 26);
  const iw = w - ml - mr, ih = h - mt - mb;
  const meta = pts.find((p) => p.metaSono)?.metaSono || 480;
  const maxY = Math.max(meta, ...pts.map((p) => p.sonoMin)) * 1.12;
  const x = (i) => ml + (iw / pts.length) * (i + 0.5);
  const y = (v) => mt + ih - (v / maxY) * ih;
  const bw = Math.max(4, Math.min(22, (iw / pts.length) * 0.62));

  const svg = svgEl("svg", { viewBox: `0 0 ${w} ${h}`, class: "chart", width: w, height: h, role: "img" });
  for (let v = 0; v <= maxY; v += 120) {
    svg.appendChild(svgEl("line", { x1: ml, x2: w - mr, y1: y(v), y2: y(v), class: "grid" }));
    svg.appendChild(svgEl("text", { x: ml - 8, y: y(v) + 4, class: "axis", "text-anchor": "end" }, `${Math.round(v / 60)}h`));
  }
  pts.forEach((p, i) => {
    svg.appendChild(svgEl("rect", {
      x: x(i) - bw / 2, y: y(p.sonoMin), width: bw, height: Math.max(0, y(0) - y(p.sonoMin)), rx: 3,
      class: "bar " + (p.sonoMin >= meta ? "bar-sono-ok" : "bar-sono-baixo"),
    }, [svgEl("title", {}, `${formatarDataBR(p.date)}\nDormiu ${p.dormiuOntem || "—"} → acordou ${p.sono.acordou || "—"}\nSono: ${formatDuracao(p.sonoMin)}`)]));
  });
  // linha da meta
  svg.appendChild(svgEl("line", { x1: ml, x2: w - mr, y1: y(meta), y2: y(meta), class: "meta-linha" }));
  svg.appendChild(svgEl("text", { x: w - mr, y: y(meta) - 5, class: "axis", "text-anchor": "end" }, `meta ${formatDuracao(meta)}`));

  const passoX = Math.ceil(pts.length / 12);
  pts.forEach((p, i) => {
    if (i % passoX) return;
    svg.appendChild(svgEl("text", { x: x(i), y: h - 10, class: "axis", "text-anchor": "middle" }, formatarDataCurta(p.date)));
  });
  return svg;
}

/* Barras horizontais: horas acumuladas por categoria. */
function graficoCategorias(resumos) {
  const totais = {};
  resumos.forEach((r) => { for (const c in r.porCat) totais[c] = (totais[c] || 0) + r.porCat[c]; });
  const linhas = Object.entries(totais).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (!linhas.length) return vazio("Sem registros no período.");

  const max = Math.max(...linhas.map((l) => l[1]));
  const alturaLinha = 34, w = 720, ml = 108, mr = 70;
  const h = linhas.length * alturaLinha + 12;
  const svg = svgEl("svg", { viewBox: `0 0 ${w} ${h}`, class: "chart", width: w, height: h, role: "img" });

  linhas.forEach(([cat, v], i) => {
    const y = i * alturaLinha + 8;
    const larg = ((w - ml - mr) * v) / max;
    const info = CATEGORIAS[cat] || { label: cat, cor: "#94a3b8" };
    svg.appendChild(svgEl("text", { x: ml - 10, y: y + 15, class: "axis", "text-anchor": "end" }, info.label));
    svg.appendChild(svgEl("rect", { x: ml, y, width: Math.max(2, larg), height: 20, rx: 4, fill: info.cor, opacity: 0.85 },
      [svgEl("title", {}, `${info.label}: ${formatDuracao(v)}`)]));
    svg.appendChild(svgEl("text", { x: ml + larg + 8, y: y + 15, class: "axis" }, formatDuracao(v)));
  });
  return svg;
}

/* Dispersão/linha: desvio das âncoras de sono ao longo do tempo. */
function graficoSono(resumos) {
  const pts = resumos.filter((r) => r.desvioAcordar !== null || r.desvioDormir !== null);
  if (!pts.length) return vazio("Sem horários de sono registrados no período.");

  const { ml, mr, mt, mb } = CH;
  const h = 220;
  const w = Math.max(720, pts.length * 26);
  const iw = w - ml - mr, ih = h - mt - mb;
  const vals = [];
  pts.forEach((p) => { [p.desvioAcordar, p.desvioDormir].forEach((v) => { if (v !== null) vals.push(v); }); });
  const lim = Math.max(30, Math.ceil(Math.max(...vals.map(Math.abs)) / 15) * 15);
  const x = (i) => ml + (iw / pts.length) * (i + 0.5);
  const y = (v) => mt + ih / 2 - (v / lim) * (ih / 2);

  const svg = svgEl("svg", { viewBox: `0 0 ${w} ${h}`, class: "chart", width: w, height: h, role: "img" });
  // faixa de tolerância visual (±15 min) e linha do zero
  svg.appendChild(svgEl("rect", { x: ml, y: y(15), width: iw, height: y(-15) - y(15), class: "faixa-ok" }));
  svg.appendChild(svgEl("line", { x1: ml, x2: w - mr, y1: y(0), y2: y(0), class: "zero" }));
  [lim, -lim].forEach((v) => svg.appendChild(
    svgEl("text", { x: ml - 8, y: y(v) + 4, class: "axis", "text-anchor": "end" }, formatDelta(v))));
  svg.appendChild(svgEl("text", { x: ml - 8, y: y(0) + 4, class: "axis", "text-anchor": "end" }, "0"));

  const serie = (campo, cor, nome) => {
    const d = [];
    pts.forEach((p, i) => { if (p[campo] !== null) d.push([x(i), y(p[campo]), p]); });
    if (d.length > 1) {
      svg.appendChild(svgEl("polyline", {
        points: d.map(([px, py]) => `${px},${py}`).join(" "), fill: "none", stroke: cor, "stroke-width": 1.6, opacity: 0.55,
      }));
    }
    d.forEach(([px, py, p]) => svg.appendChild(svgEl("circle", { cx: px, cy: py, r: 3.4, fill: cor },
      [svgEl("title", {}, `${formatarDataBR(p.date)}\n${nome}: ${formatDelta(p[campo])}`)])));
  };
  serie("desvioAcordar", "#f59e0b", "Acordar");
  serie("desvioDormir", "#0ea5e9", "Dormir");

  const passoX = Math.ceil(pts.length / 12);
  pts.forEach((p, i) => {
    if (i % passoX) return;
    svg.appendChild(svgEl("text", { x: x(i), y: h - 8, class: "axis", "text-anchor": "middle" }, formatarDataCurta(p.date)));
  });
  return svg;
}

function legendaSono() {
  const wrap = el("div", { class: "legenda" });
  [["Acordar", "#f59e0b"], ["Dormir", "#0ea5e9"]].forEach(([n, c]) => {
    wrap.appendChild(el("span", { class: "leg-item" }, [
      el("i", { class: "leg-dot", style: `background:${c}` }), n,
    ]));
  });
  wrap.appendChild(el("span", { class: "leg-nota", text: "faixa clara = ±15min da meta" }));
  return wrap;
}
